import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateGoodDto } from './dto/create-good.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PaginatedResult } from '../common/interfaces/api-response.interface';
import * as crypto from 'crypto';
import { gzipSync } from 'zlib';
import { DictionaryService } from '../dictionary/dictionary.service';
import { DataPacker, CHARACTER_SCHEMA, WEAPON_SCHEMA } from '../common/utils/data-packer.util';
import { DictionaryType } from '@prisma/client';
import {
  applyArtifactStateUpdates,
  buildArtifactStateUpdates,
  mergeArtifactMutableState,
  toArtifactMutableState,
  ArtifactMutableState,
} from '../common/utils/artifact.util';


@Injectable()
export class GoodsService {
  private readonly logger = new Logger(GoodsService.name);
  constructor(private readonly prisma: PrismaService, private readonly dictionaryService: DictionaryService) {}

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
      // hash -> the live state this payload reports for it. Existing rows are
      // never re-inserted, so this is the only place their state comes from.
      const desiredStateByHash = new Map<string, ArtifactMutableState>();
      
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

        const desiredState = toArtifactMutableState(artifact);
        // Two artifacts with identical stats share one row, so their live state
        // has to be collapsed. Merge rather than let the first occurrence win:
        // the payload's array order is not stable, so first-wins would flip the
        // shared row between uploads and issue an UPDATE on every unchanged
        // re-import.
        const previous = desiredStateByHash.get(hash);
        desiredStateByHash.set(
          hash,
          previous
            ? mergeArtifactMutableState(previous, desiredState)
            : desiredState,
        );

        artifactsToInsert.push({
          hash,
          genshinAccountId,
          setKey: artifact.setKey || 'Unknown',
          slotKey: artifact.slotKey || 'flower',
          level: artifact.level || 0,
          rarity: artifact.rarity || 5,
          mainStatKey: artifact.mainStatKey || '',
          ...desiredState,
          totalRolls: artifact.totalRolls || 0,
          elixerCrafted: Boolean(artifact.elixerCrafted),
          substats: artifact.substats || []
        });
      }

      const uniqueArtifactsMap = new Map();
      for (const art of artifactsToInsert) {
        const hash = art.hash as string;
        if (!uniqueArtifactsMap.has(hash)) {
          // Insert the *merged* state, not this occurrence's, so a freshly
          // inserted row already holds what the reconciliation below would
          // otherwise immediately UPDATE it to.
          uniqueArtifactsMap.set(hash, {
            ...art,
            ...desiredStateByHash.get(hash),
          });
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
          // The mutable columns come back with the id: they are what the
          // reconciliation below diffs against this payload.
          select: { id: true, hash: true, location: true, lock: true, astralMark: true }
        });
        const hashToId = new Map(resolvedArtifacts.map(a => [a.hash, a.id]));
        artifactIds = artifactHashList.map(h => hashToId.get(h)!).filter((x): x is number => typeof x === 'number');

        // location/lock/astralMark sit outside the content hash on purpose, so a
        // row that already exists still carries the state of whichever payload
        // first inserted it. Refresh the ones that actually moved (levelling,
        // which IS hashed, still mints a new row and is untouched here).
        const stateRows: {
          id: number;
          current: ArtifactMutableState;
          desired: ArtifactMutableState;
        }[] = [];
        for (const row of resolvedArtifacts) {
          const desired = desiredStateByHash.get(row.hash);
          if (desired) {
            stateRows.push({ id: row.id, current: row, desired });
          }
        }

        const stateUpdates = buildArtifactStateUpdates(stateRows);
        if (stateUpdates.length > 0) {
          const refreshed = await applyArtifactStateUpdates(
            stateUpdates,
            (ids, state) =>
              tx.accountArtifact.updateMany({
                where: { genshinAccountId, id: { in: ids } },
                data: state
              })
          );
          this.logger.debug(`Refreshed live state on ${refreshed} artifact(s).`);
        }
      }

      const charactersRaw = dto.characters as any[];
      const weaponsRaw = dto.weapons as any[];
      const materialsRaw = dto.materials as Record<string, number>;
      const achievements = dto.gi_achievements as any;

      const packer = new DataPacker(this.dictionaryService);
      
      this.logger.log(`Pre-resolving dictionaries for ${charactersRaw.length} characters, ${weaponsRaw.length} weapons, and ${Object.keys(materialsRaw).length} materials...`);
      // Pre-resolve all keys
      await packer.preResolve(CHARACTER_SCHEMA, charactersRaw);
      await packer.preResolve(WEAPON_SCHEMA, weaponsRaw);
      await this.dictionaryService.getIdsBulk(Object.keys(materialsRaw).map(k => ({ type: DictionaryType.MATERIAL, rawKey: k })));
      
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

      // Compute compressed file size
      const storedPayload = JSON.stringify({ characters: packedCharacters, weapons: packedWeapons, materials: packedMaterials, achievements, artifactIds });
      const compressedFileSize = gzipSync(Buffer.from(storedPayload)).byteLength;

      const good = await tx.good.create({
        data: {
          format: dto.format,
          version: dto.version,
          source: dto.source,
          genshinAccountId,
          characters: packedCharacters,
          weapons: packedWeapons,
          materials: packedMaterials,
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
