import { Injectable, NotFoundException, UnauthorizedException, ConflictException } from '@nestjs/common';
import { GenshinServer } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { gzipSync } from 'zlib';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PaginatedResult } from '../common/interfaces/api-response.interface';
import { PrismaService } from '../prisma.service';
import { DictionaryService } from '../dictionary/dictionary.service';
import { DataPacker, CHARACTER_SCHEMA, WEAPON_SCHEMA } from '../common/utils/data-packer.util';
import { DictionaryType } from '@prisma/client';

import { CreateGenshinAccountDto } from './dto/create-genshin-account.dto';

@Injectable()
export class GenshinAccountsService {
  constructor(private readonly prisma: PrismaService, private readonly dictionaryService: DictionaryService) {}

  async generateImportKey(userId: number, accountId: number) {
    const account = await this.prisma.genshinAccount.findUnique({
      where: { id: accountId, userId },
    });

    if (!account) {
      throw new NotFoundException('Genshin account not found');
    }

    const rawSecret = crypto.randomBytes(32).toString('hex');
    const importKey = `gdt_import_${accountId}_${rawSecret}`;
    
    const hashedSecret = await bcrypt.hash(rawSecret, 10);
    
    await this.prisma.genshinAccount.update({
      where: { id: accountId },
      data: { importKeyHash: hashedSecret },
    });

    return { importKey };
  }



  async create(userId: number, dto: CreateGenshinAccountDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const rawSecret = crypto.randomBytes(32).toString('hex');
    const hashedSecret = await bcrypt.hash(rawSecret, 10);

    const account = await this.prisma.genshinAccount.create({
      data: {
        accountName: dto.accountName,
        uid: dto.uid,
        server: dto.server,
        importKeyHash: hashedSecret,
        userId,
      },
    });

    const importKey = `gdt_import_${account.id}_${rawSecret}`;
    return { ...account, importKey };
  }

  async findAllByUser(
    userId: number,
    pagination: PaginationDto,
  ): Promise<PaginatedResult> {
    const [edges, total] = await Promise.all([
      this.prisma.genshinAccount.findMany({
        where: { userId },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.genshinAccount.count({ where: { userId } }),
    ]);

    return {
      edges,
      total,
      enum: {
        servers: {
          [GenshinServer.ASIA]: 'Asia',
          [GenshinServer.AMERICA]: 'America',
          [GenshinServer.EUROPE]: 'Europe',
          [GenshinServer.SAR]: 'TW/HK/MO',
        },
      },
    };
  }

  async findOne(id: number) {
    return this.prisma.genshinAccount.findUnique({
      where: { id },
    });
  }

  async update(userId: number, id: number, dto: any) {
    const account = await this.prisma.genshinAccount.findUnique({
      where: { id, userId },
    });

    if (!account) {
      throw new NotFoundException('Account not found');
    }

    return this.prisma.genshinAccount.update({
      where: { id },
      data: dto,
    });
  }

  async remove(userId: number, id: number, dto: any) {
    const account = await this.prisma.genshinAccount.findUnique({
      where: { id, userId },
    });

    if (!account) {
      throw new NotFoundException('Account not found');
    }

    if (account.accountName !== dto.accountName) {
      throw new UnauthorizedException('Account nickname does not match');
    }

    return this.prisma.genshinAccount.delete({
      where: { id },
    });
  }

  async importData(userId: number, id: number, file: any, timestamp?: string) {
    const account = await this.prisma.genshinAccount.findUnique({
      where: { id, userId },
    });

    if (!account) {
      throw new NotFoundException('Account not found');
    }
    return this.processImport(account.id, file, timestamp);
  }

  async importBulkData(userId: number, id: number, files: any[], timestamps: (string | undefined)[]) {
    const account = await this.prisma.genshinAccount.findUnique({
      where: { id, userId },
    });

    if (!account) {
      throw new NotFoundException('Account not found');
    }

    const results: { filename: string; status: string; message?: string }[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const timestamp = timestamps[i];
      try {
        await this.processImport(account.id, file, timestamp);
        results.push({ filename: file.originalname, status: 'success' });
      } catch (error: any) {
        results.push({ filename: file.originalname, status: 'error', message: error.message });
      }
    }

    return { results };
  }

  async importDataByKey(importKey: string, file: any, timestamp?: string) {
    if (!importKey.startsWith('gdt_import_')) {
      throw new UnauthorizedException('Invalid import key format');
    }
    const parts = importKey.split('_');
    if (parts.length !== 4) {
      throw new UnauthorizedException('Invalid import key format');
    }
    const accountId = parseInt(parts[2], 10);
    const rawSecret = parts[3];

    const account = await this.prisma.genshinAccount.findUnique({
      where: { id: accountId },
    });

    if (!account || !account.importKeyHash) {
      throw new UnauthorizedException('Invalid import key');
    }

    const isValid = await bcrypt.compare(rawSecret, account.importKeyHash);
    if (!isValid) {
      throw new UnauthorizedException('Invalid import key');
    }

    return this.processImport(account.id, file, timestamp);
  }

  async verifyImportKey(importKey: string) {
    if (!importKey.startsWith('gdt_import_')) {
      throw new UnauthorizedException('Invalid import key format');
    }
    const parts = importKey.split('_');
    if (parts.length !== 4) {
      throw new UnauthorizedException('Invalid import key format');
    }
    const accountId = parseInt(parts[2], 10);
    const rawSecret = parts[3];

    const account = await this.prisma.genshinAccount.findUnique({
      where: { id: accountId },
      select: { accountName: true, uid: true, server: true, importKeyHash: true },
    });

    if (!account || !account.importKeyHash) {
      throw new UnauthorizedException('Invalid import key');
    }

    const isValid = await bcrypt.compare(rawSecret, account.importKeyHash);
    if (!isValid) {
      throw new UnauthorizedException('Invalid import key');
    }

    return { 
      accountName: account.accountName || 'Unknown',
      uid: account.uid || 'N/A',
      server: account.server || 'N/A',
    };
  }

  private async processImport(accountId: number, file: any, timestamp?: string) {
    // Determine timestamp
    const importTimestamp = timestamp ? new Date(isNaN(Number(timestamp)) ? timestamp : Number(timestamp)) : new Date();

    // Parse JSON
    let parsedData: any;
    try {
      parsedData = JSON.parse(file.buffer.toString('utf-8'));
    } catch (e) {
      throw new Error('Invalid JSON file format');
    }

    // Process the parsed data (characters, artifacts, etc.)
    const existingSnapshot = await this.prisma.good.findFirst({
      where: {
        genshinAccountId: accountId,
        createdAt: importTimestamp,
        isDeleted: false,
      },
    });

    if (existingSnapshot) {
      throw new ConflictException('A snapshot with this exact timestamp already exists for this account.');
    }

    await this.prisma.$transaction(async (tx) => {
      const charactersRaw = Array.isArray(parsedData.characters) ? parsedData.characters : [];
      const weaponsRaw = Array.isArray(parsedData.weapons) ? parsedData.weapons : [];
      
      let materialsRaw: Record<string, number> = {};
      if (parsedData.materials && typeof parsedData.materials === 'object' && !Array.isArray(parsedData.materials)) {
        materialsRaw = parsedData.materials as Record<string, number>;
      }

      const packer = new DataPacker(this.dictionaryService);
      
      // Pre-resolve all keys
      await packer.preResolve(CHARACTER_SCHEMA, charactersRaw);
      await packer.preResolve(WEAPON_SCHEMA, weaponsRaw);
      
      const packedCharacters: Record<string, any[]> = {};
      for (const char of charactersRaw) {
        const id = await this.dictionaryService.getId(DictionaryType.CHARACTER, char.key);
        packedCharacters[id.toString()] = packer.pack(CHARACTER_SCHEMA, char);
      }

      const packedWeapons: any[][] = [];
      for (const weapon of weaponsRaw) {
        packedWeapons.push(packer.pack(WEAPON_SCHEMA, weapon));
      }

      const packedMaterials: Record<string, number> = {};
      for (const [key, val] of Object.entries(materialsRaw)) {
        if (typeof val === 'number') {
          const id = await this.dictionaryService.getId(DictionaryType.MATERIAL, key);
          packedMaterials[id.toString()] = val;
        }
      }

      const achievements = Array.isArray(parsedData.gi_achievements) ? parsedData.gi_achievements : (Array.isArray(parsedData.achievements) ? parsedData.achievements : []);

      const artifactHashList: string[] = [];
      const artifactsToInsert: any[] = [];
      
      if (Array.isArray(parsedData.artifacts)) {
        for (const art of parsedData.artifacts) {
          // Normalize substats for hashing
          const sortedSubstats = Array.isArray(art.substats) 
            ? [...art.substats].sort((a, b) => (a.key || '').localeCompare(b.key || ''))
            : [];
            
          const hashObj = {
            setKey: art.setKey,
            slotKey: art.slotKey,
            rarity: art.rarity,
            level: art.level,
            mainStatKey: art.mainStatKey,
            substats: sortedSubstats.map(s => ({ key: s.key, value: s.value, initialValue: s.initialValue }))
          };
          
          const hash = crypto.createHash('sha256').update(JSON.stringify(hashObj)).digest('hex');
          artifactHashList.push(hash);
          
          artifactsToInsert.push({
            hash,
            genshinAccountId: accountId,
            setKey: art.setKey || 'Unknown',
            slotKey: art.slotKey || 'flower',
            level: art.level || 0,
            rarity: art.rarity || 5,
            mainStatKey: art.mainStatKey || '',
            location: art.location || '',
            lock: Boolean(art.lock),
            totalRolls: art.totalRolls || 0,
            astralMark: Boolean(art.astralMark),
            elixerCrafted: Boolean(art.elixerCrafted),
            substats: art.substats || []
          });
        }
      }

      // Deduplicate artifactsToInsert in memory
      const uniqueArtifactsMap = new Map();
      for (const art of artifactsToInsert) {
        if (!uniqueArtifactsMap.has(art.hash)) {
          uniqueArtifactsMap.set(art.hash, art);
        }
      }
      const uniqueArtifacts = Array.from(uniqueArtifactsMap.values());

      // Create Many AccountArtifacts (skipDuplicates: true will ignore existing hashes)
      if (uniqueArtifacts.length > 0) {
        await tx.accountArtifact.createMany({
          data: uniqueArtifacts,
          skipDuplicates: true
        });
      }

      // Resolve artifact hashes to IDs
      let artifactIds: number[] = [];
      if (artifactHashList.length > 0) {
        const resolvedArtifacts = await tx.accountArtifact.findMany({
          where: { genshinAccountId: accountId, hash: { in: artifactHashList } },
          select: { id: true, hash: true }
        });
        const hashToId = new Map(resolvedArtifacts.map(a => [a.hash, a.id]));
        artifactIds = artifactHashList.map(h => hashToId.get(h)!).filter((x): x is number => typeof x === 'number');
      }

      // Compute compressed file size (gzip of stored payload)
      const storedPayload = JSON.stringify({ characters: packedCharacters, weapons: packedWeapons, materials: packedMaterials, achievements, artifactIds });
      const compressedFileSize = gzipSync(Buffer.from(storedPayload)).byteLength;

      // Create the Good snapshot with JSONB payloads
      await tx.good.create({
        data: {
          format: parsedData.format || 'GOOD',
          version: typeof parsedData.version === 'number' ? parsedData.version : 1,
          source: parsedData.source || 'Unknown',
          createdAt: importTimestamp,
          fileSize: file.size || 0,
          compressedFileSize,
          genshinAccountId: accountId,
          characters: packedCharacters,
          weapons: packedWeapons,
          materials: packedMaterials,
          achievements,
          artifactIds
        },
      });
    }, {
      maxWait: 15000, // 15 seconds to wait for a connection
      timeout: 120000, // 120 seconds to finish the transaction
    });
    
    return {
      message: 'Import processed successfully',
      timestamp: importTimestamp,
      fileSize: file.size,
    };
  }

  async getOverviewStats(
    userId: number,
    id: number,
    groupBy: 'hour' | 'day' | 'month' | 'year' = 'day',
    limit: number = 90,
  ) {
    const account = await this.prisma.genshinAccount.findUnique({
      where: { id, userId },
    });
    if (!account) {
      throw new NotFoundException('Account not found');
    }

    const snapshots = await this.prisma.good.findMany({
      where: { genshinAccountId: id, isDeleted: false },
      orderBy: { createdAt: 'asc' }
    });

    // Compute storage stats
    let totalFileSize = 0;
    let totalCompressedFileSize = 0;
    for (const snap of snapshots) {
      totalFileSize += snap.fileSize || 0;
      totalCompressedFileSize += snap.compressedFileSize || 0;
    }

    const moraId = await this.dictionaryService.getId(DictionaryType.MATERIAL, 'Mora');
    const primogemId = await this.dictionaryService.getId(DictionaryType.MATERIAL, 'Primogem');

    const timeline = snapshots.map(snap => {
      const mats = (snap.materials || {}) as Record<string, number>;
      const chars = (snap.characters || {}) as Record<string, any>;
      const weaps = (snap.weapons || []) as any[];

      return {
        timestamp: snap.createdAt,
        mora: mats[moraId.toString()] || 0,
        primogem: mats[primogemId.toString()] || 0,
        totalCharacters: Object.keys(chars).length,
        totalArtifacts: snap.artifactIds?.length || 0,
      };
    });

    // Aggregate by groupBy period, keeping the latest entry per group
    const grouped = new Map<string, (typeof timeline)[number]>();
    for (const entry of timeline) {
      const date = new Date(entry.timestamp);
      let key: string;
      switch (groupBy) {
        case 'year':
          key = `${date.getUTCFullYear()}`;
          break;
        case 'month':
          key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
          break;
        case 'hour':
          key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')} ${String(date.getUTCHours()).padStart(2, '0')}:00`;
          break;
        case 'day':
        default:
          key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
          break;
      }
      // Since snapshots are ordered asc, later entries overwrite earlier ones → keeps latest per group
      grouped.set(key, entry);
    }

    let aggregated: (typeof timeline)[number][] = [];
    if (timeline.length > 0) {
      let current = new Date(timeline[0].timestamp);
      // align current to start of the period
      switch (groupBy) {
        case 'year':
          current = new Date(Date.UTC(current.getUTCFullYear(), 0, 1));
          break;
        case 'month':
          current = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1));
          break;
        case 'hour':
          current = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate(), current.getUTCHours()));
          break;
        case 'day':
        default:
          current = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate()));
          break;
      }
      const end = new Date(); // fill gaps up to now
      let lastKnown = timeline[0];

      while (current <= end) {
        let key: string;
        switch (groupBy) {
          case 'year':
            key = `${current.getUTCFullYear()}`;
            break;
          case 'month':
            key = `${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, '0')}`;
            break;
          case 'hour':
            key = `${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, '0')}-${String(current.getUTCDate()).padStart(2, '0')} ${String(current.getUTCHours()).padStart(2, '0')}:00`;
            break;
          case 'day':
          default:
            key = `${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, '0')}-${String(current.getUTCDate()).padStart(2, '0')}`;
            break;
        }

        if (grouped.has(key)) {
          lastKnown = grouped.get(key)!;
        }
        // Always push a copy with the 'current' timestamp so the graph is uniformly spaced
        aggregated.push({ ...lastKnown, timestamp: new Date(current) });

        // Advance current by 1 unit
        switch (groupBy) {
          case 'year':
            current.setUTCFullYear(current.getUTCFullYear() + 1);
            break;
          case 'month':
            current.setUTCMonth(current.getUTCMonth() + 1);
            break;
          case 'hour':
            current.setUTCHours(current.getUTCHours() + 1);
            break;
          case 'day':
          default:
            current.setUTCDate(current.getUTCDate() + 1);
            break;
        }
      }
    }
    const limited = aggregated.slice(-limit);
    return {
      timeline: limited,
      storage: {
        totalSnapshots: snapshots.length,
        totalFileSize,
        totalCompressedFileSize,
      }
    };
  }

  async getSnapshots(userId: number, id: number, pagination: PaginationDto) {
    const account = await this.prisma.genshinAccount.findUnique({
      where: { id, userId },
    });
    if (!account) throw new NotFoundException('Account not found');

    const [items, total] = await Promise.all([
      this.prisma.good.findMany({
        where: { genshinAccountId: id, isDeleted: false },
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.take
      }),
      this.prisma.good.count({ where: { genshinAccountId: id, isDeleted: false } }),
    ]);

    const formattedItems = items.map(item => ({
      ...item,
      _count: {
        characters: Object.keys((item.characters || {}) as Record<string, any>).length,
        artifacts: item.artifactIds?.length || 0,
        weapons: ((item.weapons || []) as any[]).length,
        materials: Object.keys((item.materials || {}) as Record<string, any>).length,
        achievements: (item.achievements as any[])?.length || 0,
      }
    }));

    return {
      items: formattedItems,
      meta: {
        total,
        page: pagination.parsedPage,
        limit: pagination.parsedLimit,
        totalPages: Math.ceil(total / pagination.parsedLimit),
      },
    };
  }

  async exportLatestSnapshot(userId: number, accountId: number) {
    const account = await this.prisma.genshinAccount.findUnique({
      where: { id: accountId, userId },
    });
    if (!account) throw new NotFoundException('Account not found');

    const good = await this.prisma.good.findFirst({
      where: { genshinAccountId: accountId, isDeleted: false },
      orderBy: { createdAt: 'desc' }
    });

    if (!good) throw new NotFoundException('No snapshots found for this account');

    return this.exportSnapshot(userId, accountId, good.id);
  }

  async exportSnapshot(userId: number, accountId: number, snapshotId: number) {
    const account = await this.prisma.genshinAccount.findUnique({
      where: { id: accountId, userId },
    });
    if (!account) throw new NotFoundException('Account not found');

    const good = await this.prisma.good.findFirst({
      where: { id: snapshotId, genshinAccountId: accountId, isDeleted: false }
    });

    if (!good) throw new NotFoundException('Snapshot not found');

    let artifacts: any[] = [];
    if (good.artifactIds && good.artifactIds.length > 0) {
      const dbArtifacts = await this.prisma.accountArtifact.findMany({
        where: {
          genshinAccountId: accountId,
          id: { in: good.artifactIds }
        }
      });
      
      artifacts = dbArtifacts.map(a => ({
        setKey: a.setKey,
        slotKey: a.slotKey,
        level: a.level,
        rarity: a.rarity,
        mainStatKey: a.mainStatKey,
        location: a.location,
        lock: a.lock,
        substats: Array.isArray(a.substats) 
          ? a.substats.map((s: any) => ({ key: s.key, value: s.value })) 
          : []
      }));
    }

    const packer = new DataPacker(this.dictionaryService);
    
    let characters: any[] = [];
    const packedChars = (good.characters || {}) as Record<string, any[]>;
    for (const [idStr, arr] of Object.entries(packedChars)) {
      const obj = packer.unpack(CHARACTER_SCHEMA, arr);
      characters.push(obj);
    }
    
    let weapons: any[] = [];
    const packedWeapons = (good.weapons || []) as any[][];
    for (const arr of packedWeapons) {
      const obj = packer.unpack(WEAPON_SCHEMA, arr);
      weapons.push(obj);
    }
    
    let materials: Record<string, number> = {};
    const packedMaterials = (good.materials || {}) as Record<string, number>;
    for (const [idStr, val] of Object.entries(packedMaterials)) {
      const key = this.dictionaryService.getKey(parseInt(idStr, 10));
      if (key) materials[key] = val;
    }

    const result: any = {
      format: good.format,
      version: good.version,
      source: good.source,
      characters,
      artifacts,
      weapons,
      materials,
    };

    if (good.achievements && Array.isArray(good.achievements)) {
      result.achievements = good.achievements;
      result.gi_achievements = good.achievements;
    }

    return result;
  }

  async getMonthlyAnalysis(userId: number, accountId: number, month: number, year: number) {
    const account = await this.prisma.genshinAccount.findUnique({
      where: { id: accountId, userId },
    });
    if (!account) throw new NotFoundException('Account not found');

    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 1));

    const baselineSnapshot = await this.prisma.good.findFirst({
      where: { genshinAccountId: accountId, isDeleted: false, createdAt: { lt: startDate } },
      orderBy: { createdAt: 'desc' }
    });

    const monthSnapshots = await this.prisma.good.findMany({
      where: { genshinAccountId: accountId, isDeleted: false, createdAt: { gte: startDate, lt: endDate } },
      orderBy: { createdAt: 'asc' }
    });

    const dailySnapshotsMap = new Map<string, any>();
    for (const snap of monthSnapshots) {
      const date = snap.createdAt.toISOString().split('T')[0];
      dailySnapshotsMap.set(date, snap);
    }

    const sortedDays = Array.from(dailySnapshotsMap.keys()).sort();
    
    const allArtifactIds = new Set<number>();
    if (baselineSnapshot?.artifactIds) {
      baselineSnapshot.artifactIds.forEach(id => allArtifactIds.add(id));
    }
    for (const snap of dailySnapshotsMap.values()) {
      if (snap.artifactIds) {
        snap.artifactIds.forEach((id: number) => allArtifactIds.add(id));
      }
    }

    const idArray = Array.from(allArtifactIds);
    const idToArtInfo = new Map<number, { rarity: number; lock: boolean; location: string }>();

    if (idArray.length > 0) {
      const dbArtifacts = await this.prisma.accountArtifact.findMany({
        where: { genshinAccountId: accountId, id: { in: idArray } },
        select: { id: true, rarity: true, lock: true, location: true }
      });
      for (const art of dbArtifacts) {
        idToArtInfo.set(art.id, { rarity: art.rarity, lock: art.lock, location: art.location });
      }
    }

    const moraId = (await this.dictionaryService.getId(DictionaryType.MATERIAL, 'Mora')).toString();
    const primogemId = (await this.dictionaryService.getId(DictionaryType.MATERIAL, 'Primogem')).toString();
    const essenceId = (await this.dictionaryService.getId(DictionaryType.MATERIAL, 'Sanctifying Essence')).toString();
    const unctionId = (await this.dictionaryService.getId(DictionaryType.MATERIAL, 'Sanctifying Unction')).toString();

    const getSnapshotStats = (snap: any) => {
      if (!snap) return null;
      const mats = (snap.materials || {}) as Record<string, number>;
      
      const mora = mats[moraId] || 0;
      const primogem = mats[primogemId] || 0;
      
      const extract4 = mats[essenceId] || 0;
      const extract3 = mats[unctionId] || 0;
      
      let art3 = 0;
      let art4 = 0;
      if (snap.artifactIds) {
        for (const artId of snap.artifactIds) {
          const info = idToArtInfo.get(artId);
          if (info && !info.lock && info.location === '') {
            if (info.rarity === 3) art3++;
            else if (info.rarity === 4) art4++;
          }
        }
      }

      return {
        mora,
        primogem,
        art3,
        art4,
        artifactMoraWorth: (art4 * 2520) + (art3 * 1260),
        ext3: extract3,
        ext4: extract4,
        extractExp: (extract4 * 10000) + (extract3 * 2500)
      };
    };

    let prevStats = getSnapshotStats(baselineSnapshot);

    const rows: any[] = [];
    for (const day of sortedDays) {
      const snap = dailySnapshotsMap.get(day);
      const currStats = getSnapshotStats(snap)!;

      const diffMora = currStats.mora - (prevStats?.mora || 0);
      const diffPrimogem = currStats.primogem - (prevStats?.primogem || 0);
      const diffArt3 = currStats.art3 - (prevStats?.art3 || 0);
      const diffArt4 = currStats.art4 - (prevStats?.art4 || 0);
      const diffArtifactMoraWorth = currStats.artifactMoraWorth - (prevStats?.artifactMoraWorth || 0);
      const diffExt3 = currStats.ext3 - (prevStats?.ext3 || 0);
      const diffExt4 = currStats.ext4 - (prevStats?.ext4 || 0);
      const diffExtractExp = currStats.extractExp - (prevStats?.extractExp || 0);

      rows.push({
        date: day,
        mora: {
          total: currStats.mora,
          diff: diffMora
        },
        primogem: {
          total: currStats.primogem,
          diff: diffPrimogem
        },
        artifact: {
          totalWorth: currStats.artifactMoraWorth,
          diffWorth: diffArtifactMoraWorth,
          total3: currStats.art3,
          total4: currStats.art4,
          diff3: diffArt3,
          diff4: diffArt4
        },
        extract: {
          totalExp: currStats.extractExp,
          diffExp: diffExtractExp,
          total3: currStats.ext3,
          total4: currStats.ext4,
          diff3: diffExt3,
          diff4: diffExt4
        }
      });

      prevStats = currStats;
    }

    return {
      month,
      year,
      rows
    };
  }

  async deleteSnapshot(userId: number, accountId: number, snapshotId: number) {
    const account = await this.prisma.genshinAccount.findUnique({
      where: { id: accountId, userId },
    });
    if (!account) throw new NotFoundException('Account not found');

    const good = await this.prisma.good.findFirst({
      where: { id: snapshotId, genshinAccountId: accountId, isDeleted: false },
    });

    if (!good) throw new NotFoundException('Snapshot not found or does not belong to this account');

    try {
      await this.prisma.good.update({
        where: { id: snapshotId },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
        },
      });
    } catch (error: any) {
      if (error.code === 'P2025') {
        throw new NotFoundException('Snapshot already deleted');
      }
      throw error;
    }

    return { success: true };
  }
}
