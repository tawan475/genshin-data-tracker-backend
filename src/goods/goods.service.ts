import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateGoodDto } from './dto/create-good.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PaginatedResult } from '../common/interfaces/api-response.interface';
import * as crypto from 'crypto';
import { gzipSync } from 'zlib';

@Injectable()
export class GoodsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(genshinAccountId: number, dto: CreateGoodDto) {
    const account = await this.prisma.genshinAccount.findUnique({
      where: { id: genshinAccountId },
    });

    if (!account) {
      throw new NotFoundException('Genshin account not found');
    }

    return this.prisma.$transaction(async (tx) => {
      const artifactHashList: string[] = [];
      const artifactsToInsert: any[] = [];
      
      for (const artifact of dto.artifacts) {
        const sortedSubstats = Array.isArray(artifact.substats) 
          ? [...artifact.substats].sort((a, b) => (a.key || '').localeCompare(b.key || ''))
          : [];
          
        const hashObj = {
          setKey: artifact.setKey,
          slotKey: artifact.slotKey,
          rarity: artifact.rarity,
          level: artifact.level,
          mainStatKey: artifact.mainStatKey,
          substats: sortedSubstats.map(s => ({ key: s.key, value: s.value, initialValue: s.initialValue }))
        };
        
        const hash = crypto.createHash('sha256').update(JSON.stringify(hashObj)).digest('hex');
        artifactHashList.push(hash);
        
        artifactsToInsert.push({
          hash,
          genshinAccountId,
          setKey: artifact.setKey || 'Unknown',
          slotKey: artifact.slotKey || 'flower',
          level: artifact.level || 0,
          rarity: artifact.rarity || 5,
          mainStatKey: artifact.mainStatKey || '',
          location: artifact.location || '',
          lock: Boolean(artifact.lock),
          totalRolls: artifact.totalRolls || 0,
          astralMark: Boolean(artifact.astralMark),
          elixerCrafted: Boolean(artifact.elixerCrafted),
          substats: artifact.substats || []
        });
      }

      const uniqueArtifactsMap = new Map();
      for (const art of artifactsToInsert) {
        if (!uniqueArtifactsMap.has(art.hash)) {
          uniqueArtifactsMap.set(art.hash, art);
        }
      }
      const uniqueArtifacts = Array.from(uniqueArtifactsMap.values());

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
          where: { genshinAccountId, hash: { in: artifactHashList } },
          select: { id: true, hash: true }
        });
        const hashToId = new Map(resolvedArtifacts.map(a => [a.hash, a.id]));
        artifactIds = artifactHashList.map(h => hashToId.get(h)!).filter(Boolean);
      }

      const characters = dto.characters as any;
      const weapons = dto.weapons as any;
      const materials = dto.materials as any;
      const achievements = dto.gi_achievements as any;

      // Compute compressed file size
      const storedPayload = JSON.stringify({ characters, weapons, materials, achievements, artifactIds });
      const compressedFileSize = gzipSync(Buffer.from(storedPayload)).byteLength;

      const good = await tx.good.create({
        data: {
          format: dto.format,
          version: dto.version,
          source: dto.source,
          genshinAccountId,
          characters,
          weapons,
          materials,
          achievements,
          compressedFileSize,
          artifactIds
        },
      });

      return good;
    });
  }

  async findAllByAccount(
    genshinAccountId: number,
    pagination: PaginationDto,
  ): Promise<PaginatedResult> {
    const [edges, total] = await Promise.all([
      this.prisma.good.findMany({
        where: { genshinAccountId },
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.good.count({ where: { genshinAccountId } }),
    ]);

    return { edges, total };
  }

  async findOne(id: number) {
    return this.prisma.good.findUnique({
      where: { id }
    });
  }
}
