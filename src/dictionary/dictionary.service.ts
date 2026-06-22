import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { DictionaryType } from '@prisma/client';
import { toGoodKey } from '../common/utils/good.util';

@Injectable()
export class DictionaryService implements OnModuleInit {
  // Maps `${type}:${key}` -> id
  private readonly cache = new Map<string, number>();
  // Maps id -> key (useful for exporting)
  private readonly reverseCache = new Map<number, string>();

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    await this.loadCache();
  }

  private async loadCache() {
    const entries = await this.prisma.dictionary.findMany();
    for (const entry of entries) {
      const cacheKey = `${entry.type}:${entry.key}`;
      this.cache.set(cacheKey, entry.id);
      this.reverseCache.set(entry.id, entry.key);
    }
    console.log(`Loaded ${this.cache.size} dictionary entries into cache.`);
  }

  /**
   * Retrieves the ID for a given type and key. 
   * Formats the key safely and checks the in-memory cache. 
   * If missing, performs a thread-safe upsert into the DB.
   */
  async getId(type: DictionaryType, rawKey: string): Promise<number> {
    const key = toGoodKey(rawKey);
    const cacheKey = `${type}:${key}`;
    
    // Lock-free instant cache hit
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    // Cache miss: safely upsert the value to the database
    const entry = await this.prisma.dictionary.upsert({
      where: {
        type_key: {
          type,
          key,
        },
      },
      update: {},
      create: {
        type,
        key,
      },
    });

    // Update caches
    this.cache.set(cacheKey, entry.id);
    this.reverseCache.set(entry.id, entry.key);

    return entry.id;
  }

  /**
   * Fast synchronous lookup of an ID for packing where missing keys are fatal (should use async getId first)
   */
  getIdSync(type: DictionaryType, rawKey: string): number {
    const key = toGoodKey(rawKey);
    const cacheKey = `${type}:${key}`;
    const id = this.cache.get(cacheKey);
    if (!id) throw new Error(`Key ${key} of type ${type} not found in dictionary cache. Must be initialized first.`);
    return id;
  }

  /**
   * Synchronously reverse-maps an ID back to its string key for exports.
   */
  getKey(id: number): string | undefined {
    return this.reverseCache.get(id);
  }
}
