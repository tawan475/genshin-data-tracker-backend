import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { DictionaryType } from '@prisma/client';
import { toGoodKey } from '../common/utils/good.util';

@Injectable()
export class DictionaryService implements OnModuleInit {
  private readonly logger = new Logger(DictionaryService.name);

  // Maps `${type}:${key}` -> id
  private readonly cache = new Map<string, number>();
  // Maps id -> key (useful for exporting)
  private readonly reverseCache = new Map<number, string>();
  // Maps inflight requests to prevent concurrent upserts
  private readonly pendingRequests = new Map<string, Promise<number>>();

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
    this.logger.log(`[Startup] Pre-loaded Dictionary Cache. Current size: ${this.cache.size} keys.`);
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

    if (this.pendingRequests.has(cacheKey)) {
      return this.pendingRequests.get(cacheKey)!;
    }

    const promise = (async () => {
      try {
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
      } catch (error: any) {
        if (error.code === 'P2002') {
          // Unique constraint failed. This implies another transaction beat us to it.
          // Fallback to fetch the freshly created entry.
          const entry = await this.prisma.dictionary.findUnique({
            where: {
              type_key: {
                type,
                key,
              },
            },
          });
          if (entry) {
            this.cache.set(cacheKey, entry.id);
            this.reverseCache.set(entry.id, entry.key);
            return entry.id;
          }
        }
        throw error;
      } finally {
        this.pendingRequests.delete(cacheKey);
      }
    })();

    this.pendingRequests.set(cacheKey, promise);
    return promise;
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
   * Bulk retrieves or creates IDs for given type and key pairs.
   */
  async getIdsBulk(requests: { type: DictionaryType; rawKey: string }[]): Promise<void> {
    const missing = new Map<string, { type: DictionaryType; key: string }>();
    const promisesToAwait: Promise<number>[] = [];

    for (const req of requests) {
      if (!req.rawKey) continue;
      const key = toGoodKey(req.rawKey);
      const cacheKey = `${req.type}:${key}`;
      
      if (this.cache.has(cacheKey)) {
        continue;
      }

      if (this.pendingRequests.has(cacheKey)) {
        promisesToAwait.push(this.pendingRequests.get(cacheKey)!);
      } else {
        missing.set(cacheKey, { type: req.type, key });
      }
    }

    if (missing.size === 0) {
      if (promisesToAwait.length > 0) await Promise.all(promisesToAwait);
      return;
    }

    const missingArr = Array.from(missing.values());
    
    // Set pending requests to avoid concurrent processing of the same keys
    const deferreds = new Map<string, { resolve: (id: number) => void; reject: (err: any) => void }>();
    
    for (const [cacheKey, _] of missing) {
      const promise = new Promise<number>((resolve, reject) => {
        deferreds.set(cacheKey, { resolve, reject });
      });
      this.pendingRequests.set(cacheKey, promise);
      promisesToAwait.push(promise);
    }

    try {
      await this.prisma.dictionary.createMany({
        data: missingArr.map(m => ({ type: m.type, key: m.key })),
        skipDuplicates: true,
      });

      // Split fetching by type to avoid complex OR clauses if there are many entries
      const types = Array.from(new Set(missingArr.map(m => m.type)));
      const newEntries: any[] = [];
      for (const t of types) {
        const keysForType = missingArr.filter(m => m.type === t).map(m => m.key);
        // SQLite limits IN clauses, we can chunk them
        const CHUNK_SIZE = 500;
        for (let i = 0; i < keysForType.length; i += CHUNK_SIZE) {
          const chunk = keysForType.slice(i, i + CHUNK_SIZE);
          const entries = await this.prisma.dictionary.findMany({
            where: {
              type: t,
              key: { in: chunk }
            }
          });
          newEntries.push(...entries);
        }
      }

      for (const entry of newEntries) {
        const cacheKey = `${entry.type}:${entry.key}`;
        this.cache.set(cacheKey, entry.id);
        this.reverseCache.set(entry.id, entry.key);
        
        // Resolve pending promise if it exists
        const def = deferreds.get(cacheKey);
        if (def) {
          def.resolve(entry.id);
          deferreds.delete(cacheKey);
        }
      }
      
      // Reject any that somehow weren't found
      for (const [cacheKey, def] of deferreds) {
        def.reject(new Error(`Bulk insert failed for ${cacheKey}`));
      }
    } catch (err) {
      for (const [cacheKey, def] of deferreds) {
        def.reject(err);
      }
      throw err;
    } finally {
      for (const cacheKey of missing.keys()) {
        this.pendingRequests.delete(cacheKey);
      }
    }

    if (promisesToAwait.length > 0) {
      await Promise.all(promisesToAwait);
    }
  }

  /**
   * Synchronously reverse-maps an ID back to its string key for exports.
   */
  getKey(id: number): string | undefined {
    return this.reverseCache.get(id);
  }
}
