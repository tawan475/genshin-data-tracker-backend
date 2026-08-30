import { Injectable, NotFoundException, UnauthorizedException, ConflictException, Logger, BadRequestException } from '@nestjs/common';
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
import {
  applyArtifactStateUpdates,
  buildArtifactStateUpdates,
  calculateCV,
  calculateRV,
  isSameArtifactState,
  mergeArtifactMutableState,
  toArtifactMutableState,
  ArtifactCacheEntry,
  ArtifactImportCache,
  ArtifactMutableState,
} from '../common/utils/artifact.util';
import { SnapshotExportService } from './snapshot-export.service';
import {
  aggregateTimelineByGroup,
  formatMaterialDisplayName,
} from '../common/utils/timeline-aggregation.util';
import { isCatalogMaterial } from '../common/utils/material-catalog.util';
import { importConfig } from '../common/config/import.config';
import { parseFilenameTimestamp } from '../common/utils/gdt-export.util';
import { resolveImportTimestamp } from '../common/utils/import-timestamp.util';

/** Shape of one artifact inside an uploaded GOOD file (untrusted input). */
interface RawImportArtifact {
  setKey?: string;
  slotKey?: string;
  level?: number;
  rarity?: number;
  mainStatKey?: string;
  location?: string;
  lock?: boolean;
  totalRolls?: number;
  astralMark?: boolean;
  elixerCrafted?: boolean;
  substats?: { key: string; value: number; initialValue?: number }[];
}

@Injectable()
export class GenshinAccountsService {
  private readonly logger = new Logger(GenshinAccountsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dictionaryService: DictionaryService,
    private readonly snapshotExportService: SnapshotExportService,
  ) {}

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

  async getDashboardSummary(userId: number) {
    const accounts = await this.prisma.genshinAccount.findMany({
      where: { userId },
      select: {
        id: true,
        accountName: true,
        uid: true,
        server: true,
        _count: {
          select: {
            goods: { where: { isDeleted: false } },
            accountArtifacts: true,
          },
        },
      },
    });

    const accountIds = accounts.map((a) => a.id);

    if (accountIds.length === 0) {
      return {
        summary: {
          totalAccounts: 0,
          activeAccounts: 0,
          totalSnapshots: 0,
          totalArtifacts: 0,
          totalCharacters: 0,
          totalStorageBytes: 0,
          totalCompressedBytes: 0,
          lastSyncAt: null,
        },
        accounts: [],
        recentActivity: [],
      };
    }

    const [storageAgg, totalArtifacts, latestGoods, recentActivity] =
      await Promise.all([
        this.prisma.good.aggregate({
          where: {
            genshinAccountId: { in: accountIds },
            isDeleted: false,
          },
          _sum: { fileSize: true, compressedFileSize: true },
          _count: { id: true },
          _max: { createdAt: true },
        }),
        this.prisma.accountArtifact.count({
          where: { genshinAccountId: { in: accountIds } },
        }),
        this.prisma.good.findMany({
          where: {
            genshinAccountId: { in: accountIds },
            isDeleted: false,
          },
          distinct: ['genshinAccountId'],
          orderBy: [{ genshinAccountId: 'asc' }, { createdAt: 'desc' }],
          select: {
            genshinAccountId: true,
            createdAt: true,
            characters: true,
          },
        }),
        this.prisma.good.findMany({
          where: {
            genshinAccountId: { in: accountIds },
            isDeleted: false,
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            genshinAccountId: true,
            createdAt: true,
            fileSize: true,
            characters: true,
            artifactIds: true,
            genshinAccount: { select: { accountName: true } },
          },
        }),
      ]);

    const latestByAccount = new Map(
      latestGoods.map((g) => [g.genshinAccountId, g]),
    );

    let totalCharacters = 0;
    for (const g of latestGoods) {
      totalCharacters += Object.keys(
        (g.characters || {}) as Record<string, unknown>,
      ).length;
    }

    const activeAccounts = accounts.filter((a) => a._count.goods > 0).length;

    const accountSummaries = accounts
      .map((acc) => {
        const latest = latestByAccount.get(acc.id);
        const characterCount = latest
          ? Object.keys(
              (latest.characters || {}) as Record<string, unknown>,
            ).length
          : 0;
        return {
          id: acc.id,
          accountName: acc.accountName,
          uid: acc.uid,
          server: acc.server,
          snapshotCount: acc._count.goods,
          artifactCount: acc._count.accountArtifacts,
          characterCount,
          lastSyncAt: latest?.createdAt ?? null,
        };
      })
      .sort((a, b) => {
        if (!a.lastSyncAt) return 1;
        if (!b.lastSyncAt) return -1;
        return (
          new Date(b.lastSyncAt).getTime() - new Date(a.lastSyncAt).getTime()
        );
      });

    return {
      summary: {
        totalAccounts: accounts.length,
        activeAccounts,
        totalSnapshots: storageAgg._count.id,
        totalArtifacts,
        totalCharacters,
        totalStorageBytes: storageAgg._sum.fileSize || 0,
        totalCompressedBytes: storageAgg._sum.compressedFileSize || 0,
        lastSyncAt: storageAgg._max.createdAt ?? null,
      },
      accounts: accountSummaries,
      recentActivity: recentActivity.map((item) => ({
        id: item.id,
        genshinAccountId: item.genshinAccountId,
        accountName: item.genshinAccount.accountName,
        createdAt: item.createdAt,
        fileSize: item.fileSize,
        _count: {
          characters: Object.keys(
            (item.characters || {}) as Record<string, unknown>,
          ).length,
          artifacts: item.artifactIds?.length || 0,
        },
      })),
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

  async importBulkData(
    userId: number, 
    id: number, 
    files: any[], 
    timestamps: (string | undefined)[],
    onProgress?: (data: { processed: number, total: number, filename: string, status: string, message?: string }) => void
  ) {
    if (files.length > importConfig.maxFiles) {
      throw new BadRequestException(
        `Maximum of ${importConfig.maxFiles} files allowed per bulk import.`,
      );
    }

    const account = await this.prisma.genshinAccount.findUnique({
      where: { id, userId },
    });

    if (!account) {
      throw new NotFoundException('Account not found');
    }

    const results: { filename: string; status: string; message?: string }[] = [];
    this.logger.log(`Starting bulk import for account ${id} with ${files.length} files`);
    let processedFiles = 0;
    const totalFiles = files.length;
    
    const notifyProgress = (filename: string, status: string, message?: string) => {
      processedFiles++;
      if (onProgress) {
        onProgress({ processed: processedFiles, total: totalFiles, filename, status, message });
      }
    };
    
    // 1. Pair up files with timestamps and compute Date objects for strict chronological sorting
    const fileEntries = files.map((file, idx) => {
      const ts = timestamps[idx];
      let dateObj = new Date();
      if (ts) {
        dateObj = new Date(isNaN(Number(ts)) ? ts : Number(ts));
      } else {
        const parsedDate = parseFilenameTimestamp(file.originalname);
        if (parsedDate) {
          dateObj = parsedDate;
        }
      }
      return { file, timestamp: ts, dateObj, originalIndex: idx };
    });

    // Sort chronologically (oldest first). Fallback to original array order if times are equal.
    fileEntries.sort((a, b) => {
      const timeDiff = a.dateObj.getTime() - b.dateObj.getTime();
      return timeDiff === 0 ? a.originalIndex - b.originalIndex : timeDiff;
    });

    const artifactCache: ArtifactImportCache = new Map();

    // location/lock/astralMark are a *current* value on a shared, content-addressed
    // row, not a per-snapshot one, so exactly one file may write them: the
    // chronologically newest, processed last and on its own (Phase 3).
    // Reconciling from every file would leave the stored value to whichever
    // member of a concurrent chunk happened to commit last (an arbitrary, often
    // older, snapshot), and would have several transactions UPDATE overlapping
    // id sets in different orders - the deadlock the hash-sorted INSERT below is
    // written to avoid. `getArtifacts()` reads these rows through the *latest*
    // snapshot's artifactIds, so the newest file is also the only one whose view
    // is ever displayed.
    const newestIndex = fileEntries.length - 1;

    // Phase 1: The Warm-Up (Process the chronologically first file sequentially)
    if (fileEntries.length > 0) {
      const firstEntry = fileEntries[0];
      this.logger.log(`[Phase 1] Processing absolute oldest file to warm up cache: ${firstEntry.file.originalname}`);
      try {
        // Only reconciles when it is also the newest file, i.e. a single-file bulk import.
        await this.processImport(account.id, firstEntry.file, firstEntry.timestamp, artifactCache, newestIndex === 0);
        results.push({ filename: firstEntry.file.originalname, status: 'success' });
        notifyProgress(firstEntry.file.originalname, 'success');
        this.logger.log(`[Phase 1] Successfully processed ${firstEntry.file.originalname}. Caches warmed up!`);
      } catch (error: any) {
        results.push({ filename: firstEntry.file.originalname, status: 'error', message: error.message });
        notifyProgress(firstEntry.file.originalname, 'error', error.message);
        this.logger.error(`[Phase 1] Error processing ${firstEntry.file.originalname}: ${error.message}`);
      }
    }

    // Phase 2: Concurrent Blast (Process the middle files; the newest is held back for Phase 3)
    const remainingEntries = fileEntries.slice(1, newestIndex);
    if (remainingEntries.length > 0) {
      this.logger.log(`[Phase 2] Processing remaining ${remainingEntries.length} files...`);
      const concurrencyLimit = importConfig.concurrencyLimit;
      for (let i = 0; i < remainingEntries.length; i += concurrencyLimit) {
        const chunk = remainingEntries.slice(i, i + concurrencyLimit);
        const chunkPromises = chunk.map(async (entry) => {
          this.logger.log(`[Phase 2] Processing file: ${entry.file.originalname}...`);
          try {
            await this.processImport(account.id, entry.file, entry.timestamp, artifactCache, false);
            results.push({ filename: entry.file.originalname, status: 'success' });
            this.logger.log(`[Phase 2] Successfully processed ${entry.file.originalname}`);
          } catch (error: any) {
            results.push({ filename: entry.file.originalname, status: 'error', message: error.message });
            notifyProgress(entry.file.originalname, 'error', error.message);
            this.logger.error(`[Phase 2] Error processing ${entry.file.originalname}: ${error.message}`);
          }
        });

        await Promise.allSettled(chunkPromises);
        
        // Find successes in this chunk and notify them (errors are handled in catch block)
        const successEntries = chunk.filter(entry => 
          results.some(r => r.filename === entry.file.originalname && r.status === 'success')
        );
        for (const entry of successEntries) {
          notifyProgress(entry.file.originalname, 'success');
        }
      }
    }

    // Phase 3: The chronologically newest file, sequentially and last, so that
    // its view of location/lock/astralMark is the one that survives and no other
    // transaction is updating the same rows at the same time.
    if (newestIndex > 0) {
      const newestEntry = fileEntries[newestIndex];
      const { originalname } = newestEntry.file as { originalname: string };
      this.logger.log(
        `[Phase 3] Processing newest file to settle live state: ${originalname}`,
      );
      try {
        await this.processImport(
          account.id,
          newestEntry.file,
          newestEntry.timestamp,
          artifactCache,
          true,
        );
        results.push({ filename: originalname, status: 'success' });
        notifyProgress(originalname, 'success');
        this.logger.log(`[Phase 3] Successfully processed ${originalname}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ filename: originalname, status: 'error', message });
        notifyProgress(originalname, 'error', message);
        this.logger.error(
          `[Phase 3] Error processing ${originalname}: ${message}`,
        );
      }
    }

    this.logger.log(`Completed bulk import for account ${id}.`);
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

  /**
   * @param reconcileState whether this file may refresh the mutable
   * location/lock/astralMark columns of artifact rows that already exist. True
   * for every single-file entry point (the desktop scanner uploads the live
   * inventory); false for the middle files of a bulk import, where only the
   * newest snapshot describes the *current* state - see `importBulkData`.
   */
  private async processImport(accountId: number, file: any, timestamp?: string, artifactCache?: ArtifactImportCache, reconcileState: boolean = true) {
    this.logger.debug(`Parsing JSON for file (size: ${(file.size / 1024 / 1024).toFixed(2)} MB)...`);
    // Parse JSON
    let parsedData: any;
    try {
      parsedData = JSON.parse(file.buffer.toString('utf-8'));
    } catch (e) {
      this.logger.error('Failed to parse JSON file');
      throw new Error('Invalid JSON file format');
    }

    // Resolved only once `parsedData` exists: when the uploader sent no
    // `timestamp` field we date the snapshot by the GOOD payload's own
    // timestamp, so scanner builds shipped before that field existed stop
    // being stamped with server receive time (and start hitting the duplicate
    // guard below on a re-upload).
    const importTimestamp = resolveImportTimestamp(timestamp, parsedData?.timestamp);

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

    const charactersRaw = Array.isArray(parsedData.characters) ? parsedData.characters : [];
    const weaponsRaw = Array.isArray(parsedData.weapons) ? parsedData.weapons : [];
    
    let materialsRaw: Record<string, number> = {};
    if (parsedData.materials && typeof parsedData.materials === 'object' && !Array.isArray(parsedData.materials)) {
      materialsRaw = parsedData.materials as Record<string, number>;
    }

    const packer = new DataPacker(this.dictionaryService);
    
    this.logger.debug(`Pre-resolving dictionaries for ${charactersRaw.length} characters, ${weaponsRaw.length} weapons, and ${Object.keys(materialsRaw).length} materials...`);
    // Pre-resolve all keys outside the transaction to prevent holding the connection
    await Promise.all([
      packer.preResolve(CHARACTER_SCHEMA, charactersRaw),
      packer.preResolve(WEAPON_SCHEMA, weaponsRaw),
      this.dictionaryService.getIdsBulk(Object.keys(materialsRaw).map(k => ({ type: DictionaryType.MATERIAL, rawKey: k })))
    ]);
    this.logger.debug(`Pre-resolving completed.`);

    // Applied to the shared cache only once the transaction has committed, so a
    // rolled back import cannot teach later files a state that was never stored.
    const artifactCacheRefresh: ArtifactCacheEntry[] = [];

    await this.prisma.$transaction(async (tx) => {
      this.logger.debug(`Starting DB transaction for import...`);
      
      this.logger.debug(`Packing ${charactersRaw.length} characters...`);
      const packedCharacters: Record<string, any[]> = {};
      for (const char of charactersRaw) {
        const id = await this.dictionaryService.getId(DictionaryType.CHARACTER, char.key);
        packedCharacters[id.toString()] = packer.pack(CHARACTER_SCHEMA, char);
      }

      this.logger.debug(`Packing ${weaponsRaw.length} weapons...`);
      const packedWeapons: any[][] = [];
      for (const weapon of weaponsRaw) {
        packedWeapons.push(packer.pack(WEAPON_SCHEMA, weapon));
      }

      this.logger.debug(`Packing ${Object.keys(materialsRaw).length} materials...`);
      const packedMaterials: Record<string, number> = {};
      for (const [key, val] of Object.entries(materialsRaw)) {
        if (typeof val === 'number') {
          const id = await this.dictionaryService.getId(DictionaryType.MATERIAL, key);
          packedMaterials[id.toString()] = val;
        }
      }

      const achievements = Array.isArray(parsedData.gi_achievements) ? parsedData.gi_achievements : (Array.isArray(parsedData.achievements) ? parsedData.achievements : []);

      const numArtifacts = Array.isArray(parsedData.artifacts) ? parsedData.artifacts.length : 0;
      this.logger.debug(`Hashing ${numArtifacts} artifacts...`);
      const artifactHashList: string[] = [];
      const artifactsToInsert: any[] = [];
      // hash -> the live state this snapshot reports for it. Kept separate from
      // artifactsToInsert because existing rows are never re-inserted.
      const desiredStateByHash = new Map<string, ArtifactMutableState>();
      
      if (Array.isArray(parsedData.artifacts)) {
        for (const art of parsedData.artifacts as RawImportArtifact[]) {
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

          const desiredState = toArtifactMutableState(art);
          // Two artifacts with identical stats share one row, so their live
          // state has to be collapsed. Merge rather than let the first
          // occurrence win: the uploaded array's order is not stable (irminsul
          // iterates a HashMap), so first-wins would flip the shared row
          // between uploads and issue an UPDATE on every unchanged re-import.
          const previous = desiredStateByHash.get(hash);
          desiredStateByHash.set(
            hash,
            previous
              ? mergeArtifactMutableState(previous, desiredState)
              : desiredState,
          );

          artifactsToInsert.push({
            hash,
            genshinAccountId: accountId,
            setKey: art.setKey || 'Unknown',
            slotKey: art.slotKey || 'flower',
            level: art.level || 0,
            rarity: art.rarity || 5,
            mainStatKey: art.mainStatKey || '',
            ...desiredState,
            totalRolls: art.totalRolls || 0,
            elixerCrafted: Boolean(art.elixerCrafted),
            substats: art.substats || [],
            cv: calculateCV(art.substats || []),
            rv: calculateRV(art.substats || [])
          });
        }
      }

      // Deduplicate artifactsToInsert in memory
      const uniqueArtifactsMap = new Map();
      for (const art of artifactsToInsert) {
        const hash = art.hash as string;
        if (!uniqueArtifactsMap.has(hash)) {
          if (!artifactCache || !artifactCache.has(hash)) {
            // Insert the *merged* state, not this occurrence's, so a freshly
            // inserted row already holds what the reconciliation below would
            // otherwise immediately UPDATE it to.
            uniqueArtifactsMap.set(hash, {
              ...art,
              ...desiredStateByHash.get(hash),
            });
          }
        }
      }
      const uniqueArtifacts = Array.from(uniqueArtifactsMap.values());
      
      // Sort artifacts alphabetically by hash to prevent Postgres deadlocks on concurrent INSERTS
      uniqueArtifacts.sort((a, b) => a.hash.localeCompare(b.hash));

      this.logger.debug(`Inserting ${uniqueArtifacts.length} unique artifacts (skipping duplicates)...`);
      // Create Many AccountArtifacts (skipDuplicates: true will ignore existing hashes)
      if (uniqueArtifacts.length > 0) {
        await tx.accountArtifact.createMany({
          data: uniqueArtifacts,
          skipDuplicates: true
        });
      }

      this.logger.debug(`Resolving artifact hashes to DB IDs...`);
      // Resolve artifact hashes to IDs
      let artifactIds: number[] = [];
      const resolvedByHash = new Map<string, ArtifactCacheEntry>();
      if (artifactHashList.length > 0) {
        const hashesToQuery: string[] = [];
        const seenHashes = new Set<string>();

        for (const h of artifactHashList) {
          if (seenHashes.has(h)) continue;
          seenHashes.add(h);
          const cached = artifactCache?.get(h);
          if (cached) {
            resolvedByHash.set(h, cached);
          } else {
            hashesToQuery.push(h);
          }
        }

        if (hashesToQuery.length > 0) {
          const CHUNK_SIZE = 500;
          const chunkPromises: Promise<ArtifactCacheEntry[]>[] = [];
          for (let i = 0; i < hashesToQuery.length; i += CHUNK_SIZE) {
            const chunk = hashesToQuery.slice(i, i + CHUNK_SIZE);
            chunkPromises.push(
              tx.accountArtifact.findMany({
                where: { genshinAccountId: accountId, hash: { in: chunk } },
                // The mutable columns come back with the id: they are what the
                // reconciliation below diffs against this snapshot.
                select: { id: true, hash: true, location: true, lock: true, astralMark: true }
              })
            );
          }
          const results = await Promise.all(chunkPromises);
          for (const res of results) {
            for (const row of res) {
              resolvedByHash.set(row.hash, row);
              artifactCache?.set(row.hash, row);
            }
          }
        }
        
        artifactIds = artifactHashList
          .map(h => resolvedByHash.get(h)?.id)
          .filter((x): x is number => typeof x === 'number');
      }

      // The content hash covers only the artifact's identity (set/slot/rarity/
      // level/mainstat/substats), so an existing row still carries the
      // location/lock/astralMark written by whichever snapshot first inserted
      // it. Re-equipping does not change the hash, so it has to be written here
      // or "equipped on" freezes at the first value ever seen. Levelling, which
      // IS hashed, still correctly mints a new row and is untouched by this.
      const artifactStateRows: {
        id: number;
        current: ArtifactMutableState;
        desired: ArtifactMutableState;
      }[] = [];
      if (reconcileState) {
        for (const entry of resolvedByHash.values()) {
          const desired = desiredStateByHash.get(entry.hash);
          if (desired) {
            artifactStateRows.push({ id: entry.id, current: entry, desired });
          }
        }
      }

      // Only rows that actually moved are written, so re-uploading an unchanged
      // inventory still issues zero UPDATEs.
      const artifactStateUpdates = buildArtifactStateUpdates(artifactStateRows);
      if (artifactStateUpdates.length > 0) {
        const refreshed = await applyArtifactStateUpdates(
          artifactStateUpdates,
          (ids, state) =>
            tx.accountArtifact.updateMany({
              where: { genshinAccountId: accountId, id: { in: ids } },
              data: state
            })
        );
        this.logger.debug(`Refreshed live state on ${refreshed} artifact(s).`);

        // Queue the cross-file cache up to match what was just written.
        if (artifactCache) {
          for (const entry of resolvedByHash.values()) {
            const desired = desiredStateByHash.get(entry.hash);
            if (desired && !isSameArtifactState(entry, desired)) {
              artifactCacheRefresh.push({ ...entry, ...desired });
            }
          }
        }
      }

      this.logger.debug(`Compressing payload...`);
      // Compute compressed file size (gzip of stored payload)
      const storedPayload = JSON.stringify({ characters: packedCharacters, weapons: packedWeapons, materials: packedMaterials, achievements, artifactIds });
      const compressedFileSize = gzipSync(Buffer.from(storedPayload)).byteLength;

      this.logger.debug(`Creating Good snapshot record...`);
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
      this.logger.debug(`Transaction successfully completed.`);
    }, {
      maxWait: 15000, // 15 seconds to wait for a connection
      timeout: 120000, // 120 seconds to finish the transaction
    });

    if (artifactCache) {
      for (const entry of artifactCacheRefresh) {
        artifactCache.set(entry.hash, entry);
      }
    }

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
      orderBy: { createdAt: 'asc' },
      select: {
        createdAt: true,
        fileSize: true,
        compressedFileSize: true,
        materials: true,
        characters: true,
        artifactIds: true
      }
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

    const artifactCount = await this.prisma.accountArtifact.count({
      where: { genshinAccountId: id },
    });

    const rawLatest =
      timeline.length > 0 ? timeline[timeline.length - 1] : null;

    return {
      timeline: limited,
      storage: {
        totalSnapshots: snapshots.length,
        totalFileSize,
        totalCompressedFileSize,
      },
      latest: rawLatest
        ? {
            timestamp: rawLatest.timestamp,
            mora: rawLatest.mora,
            primogem: rawLatest.primogem,
            totalCharacters: rawLatest.totalCharacters,
            totalArtifacts: rawLatest.totalArtifacts,
          }
        : null,
      inventory: {
        artifactCount,
      },
    };
  }

  async getStorageStats(userId: number, id: number) {
    const account = await this.prisma.genshinAccount.findUnique({
      where: { id, userId },
    });
    if (!account) throw new NotFoundException('Account not found');

    const storageAgg = await this.prisma.good.aggregate({
      where: { genshinAccountId: id, isDeleted: false },
      _sum: {
        fileSize: true,
        compressedFileSize: true,
      },
      _count: {
        id: true,
      },
    });

    return {
      storage: {
        totalSnapshots: storageAgg._count.id,
        totalFileSize: storageAgg._sum.fileSize || 0,
        totalCompressedFileSize: storageAgg._sum.compressedFileSize || 0,
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
        take: pagination.take,
        select: {
          id: true,
          format: true,
          version: true,
          source: true,
          createdAt: true,
          fileSize: true,
          compressedFileSize: true,
          characters: true,
          weapons: true,
          materials: true,
          achievements: true,
          artifactIds: true
        }
      }),
      this.prisma.good.count({ where: { genshinAccountId: id, isDeleted: false } }),
    ]);

    const formattedItems = items.map(item => {
      const { characters, weapons, materials, achievements, artifactIds, ...rest } = item;
      return {
        ...rest,
        _count: {
          characters: Object.keys((characters || {}) as Record<string, any>).length,
          artifacts: artifactIds?.length || 0,
          weapons: ((weapons || []) as any[]).length,
          materials: Object.keys((materials || {}) as Record<string, any>).length,
          achievements: (achievements as any[])?.length || 0,
        }
      };
    });

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
    const { payload } = await this.snapshotExportService.exportGoodJson(
      userId,
      accountId,
      snapshotId,
    );
    return payload;
  }

  async exportSnapshotFile(
    userId: number,
    accountId: number,
    snapshotId: number,
  ) {
    return this.snapshotExportService.exportGoodJson(
      userId,
      accountId,
      snapshotId,
    );
  }

  async getArtifacts(userId: number, id: number, sortBy: string, search: string | undefined, pagination: PaginationDto) {
    const account = await this.prisma.genshinAccount.findUnique({
      where: { id, userId },
    });
    if (!account) throw new NotFoundException('Account not found');

    const latestGood = await this.prisma.good.findFirst({
      where: { genshinAccountId: id, isDeleted: false },
      orderBy: { createdAt: 'desc' },
      select: { artifactIds: true }
    });

    const whereClause: any = { genshinAccountId: id };
    
    if (latestGood) {
      whereClause.id = { in: latestGood.artifactIds };
    } else {
      // If no valid export exists, return no artifacts
      whereClause.id = { in: [] };
    }

    if (search) {
      whereClause.setKey = { contains: search, mode: 'insensitive' };
    }

    const [items, total] = await Promise.all([
      this.prisma.accountArtifact.findMany({
        where: whereClause,
        orderBy: [{ [sortBy]: 'desc' }, { id: 'asc' }],
        skip: pagination.skip,
        take: pagination.take
      }),
      this.prisma.accountArtifact.count({ where: whereClause }),
    ]);

    return { 
      items, 
      meta: {
        total,
        page: pagination.parsedPage,
        limit: pagination.parsedLimit,
        totalPages: Math.ceil(total / pagination.parsedLimit) || 1,
      }
    };
  }

  /**
   * Day-by-day mora / primogem / fodder movement for one month.
   *
   * Mora, primogems and the extraction materials are genuinely historical: they
   * come from each day's `Good.materials`.
   *
   * The 3-star / 4-star fodder columns are NOT. "Fodder" is defined as `!lock &&
   * location === ''`, and those two columns live on the shared, content
   * addressed `AccountArtifact` row, which every import refreshes to the live
   * inventory - only the *set* of artifact ids per day is historical. So a past
   * day is counted by asking "which of the pieces that existed that day are
   * unlocked and unequipped TODAY", and locking or equipping a piece now shifts
   * the count for every past day it appears in. The response therefore must not
   * be presented as an immutable record of that month; see the audit notes for
   * `r-backend` #1 (freezing it means persisting per-snapshot state on `Good`,
   * a schema change).
   */
  async getMonthlyAnalysis(userId: number, accountId: number, month: number, year: number) {
    const account = await this.prisma.genshinAccount.findUnique({
      where: { id: accountId, userId },
    });
    if (!account) throw new NotFoundException('Account not found');

    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 1));

    const baselineSnapshot = await this.prisma.good.findFirst({
      where: { genshinAccountId: accountId, isDeleted: false, createdAt: { lt: startDate } },
      orderBy: { createdAt: 'desc' },
      select: {
        artifactIds: true
      }
    });

    const monthSnapshots = await this.prisma.good.findMany({
      where: { genshinAccountId: accountId, isDeleted: false, createdAt: { gte: startDate, lt: endDate } },
      orderBy: { createdAt: 'asc' },
      select: {
        createdAt: true,
        materials: true,
        artifactIds: true
      }
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
      // `rarity` is immutable (it is inside the content hash), but `lock` and
      // `location` are live columns: this map is today's state, applied to every
      // day below. See the note on getMonthlyAnalysis.
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

  async deleteSnapshots(userId: number, accountId: number, snapshotIds: number[], selectAll?: boolean | string) {
    await this.snapshotExportService.assertAccountOwnership(userId, accountId);

    const isSelectAll = this.snapshotExportService.isSelectAll(selectAll);

    if (!isSelectAll && (!snapshotIds || snapshotIds.length === 0)) {
      return { message: 'No snapshots provided for deletion' };
    }

    try {
      const whereClause = this.snapshotExportService.buildSnapshotWhereClause(
        accountId,
        snapshotIds,
        selectAll,
      );

      const result = await this.prisma.good.updateMany({
        where: whereClause,
        data: {
          isDeleted: true,
          deletedAt: new Date(),
        },
      });
      return { message: `Successfully deleted ${result.count} snapshots`, count: result.count };
    } catch (error: any) {
      if (error?.status === 400) throw error;
      this.logger.error('Failed to bulk delete snapshots', error.stack);
      throw new BadRequestException('Failed to delete snapshots');
    }
  }

  async getMaterialsCatalog(search: string | undefined, limit: number) {
    const cappedLimit = Math.min(Math.max(limit || 30, 1), 100);
    const items = this.dictionaryService.searchMaterialKeys(
      search || '',
      cappedLimit,
    );
    return { items };
  }

  async getMaterialsHistory(
    userId: number,
    accountId: number,
    keys: string[],
    groupBy: 'hour' | 'day' | 'month' | 'year' = 'day',
    limit = 365,
  ) {
    const account = await this.prisma.genshinAccount.findUnique({
      where: { id: accountId, userId },
    });
    if (!account) throw new NotFoundException('Account not found');

    if (keys.length === 0) {
      return { groupBy, series: [] };
    }

    const keyToId = new Map<string, string>();
    for (const rawKey of keys) {
      const id = await this.dictionaryService.getId(
        DictionaryType.MATERIAL,
        rawKey,
      );
      keyToId.set(rawKey, id.toString());
    }

    const snapshots = await this.prisma.good.findMany({
      where: { genshinAccountId: accountId, isDeleted: false },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true, materials: true },
    });

    const series = keys.map((key) => {
      const materialId = keyToId.get(key)!;
      const rawPoints = snapshots.map((snap) => {
        const mats = (snap.materials || {}) as Record<string, number>;
        return {
          timestamp: snap.createdAt,
          value: mats[materialId] || 0,
        };
      });

      const aggregated = aggregateTimelineByGroup(
        rawPoints,
        groupBy,
        limit,
      );

      return {
        key,
        name: formatMaterialDisplayName(key),
        points: aggregated.map((p) => ({
          timestamp: p.timestamp,
          count: p.value,
        })),
      };
    });

    return { groupBy, series };
  }

  async getCurrentMaterials(
    userId: number,
    accountId: number,
    search: string | undefined,
    sortBy: string,
    pagination: PaginationDto,
  ) {
    const account = await this.prisma.genshinAccount.findUnique({
      where: { id: accountId, userId },
    });
    if (!account) throw new NotFoundException('Account not found');

    const latestGood = await this.prisma.good.findFirst({
      where: { genshinAccountId: accountId, isDeleted: false },
      orderBy: { createdAt: 'desc' },
      select: { materials: true },
    });

    if (!latestGood) {
      return {
        items: [],
        meta: {
          total: 0,
          page: pagination.parsedPage,
          limit: pagination.parsedLimit,
          totalPages: 1,
        },
      };
    }

    const mats = (latestGood.materials || {}) as Record<string, number>;

    let items = Object.entries(mats)
      .map(([idStr, count]) => {
        const key = this.dictionaryService.getKey(parseInt(idStr, 10)) || idStr;
        const name = formatMaterialDisplayName(key);
        return { key, name, count };
      })
      .filter((item) => isCatalogMaterial(item.key));

    if (search) {
      const needle = search.toLowerCase();
      items = items.filter(
        (item) =>
          item.key.toLowerCase().includes(needle) ||
          item.name.toLowerCase().includes(needle),
      );
    }

    if (sortBy === 'name') {
      items.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      items.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    }

    const total = items.length;
    const paged = items.slice(pagination.skip, pagination.skip + pagination.take);

    return {
      items: paged,
      meta: {
        total,
        page: pagination.parsedPage,
        limit: pagination.parsedLimit,
        totalPages: Math.ceil(total / pagination.parsedLimit) || 1,
      },
    };
  }
}
