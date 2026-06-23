import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function clean() {
  console.log('Fetching all artifacts...');
  const artifacts = await prisma.accountArtifact.findMany({
    select: {
      id: true,
      genshinAccountId: true,
      setKey: true,
      slotKey: true,
      rarity: true,
      level: true,
      mainStatKey: true,
      substats: true,
    }
  });

  console.log(`Found ${artifacts.length} artifacts.`);

  const seen = new Set<string>();
  const toDelete: number[] = [];
  let updatedCount = 0;

  for (const art of artifacts) {
    const sortedSubstats = Array.isArray(art.substats) 
      ? [...(art.substats as any[])].sort((a, b) => (a.key || '').localeCompare(b.key || ''))
      : [];
      
    const hashObj = {
      setKey: art.setKey,
      slotKey: art.slotKey,
      rarity: art.rarity,
      level: art.level,
      mainStatKey: art.mainStatKey,
      substats: sortedSubstats.map(s => ({ key: s.key, value: s.value }))
    };
    
    const hash = crypto.createHash('sha256').update(JSON.stringify(hashObj)).digest('hex');
    const uniqueKey = `${art.genshinAccountId}_${hash}`;

    if (seen.has(uniqueKey)) {
      toDelete.push(art.id);
    } else {
      seen.add(uniqueKey);
      
      // Update hash in DB just to be safe so it matches the new format
      try {
        await prisma.accountArtifact.update({
          where: { id: art.id },
          data: { hash }
        });
        updatedCount++;
      } catch (e) {
        // Unique constraint might fail if the hash already exists for this account somehow
        toDelete.push(art.id);
      }
    }
  }

  console.log(`Updated hashes for ${updatedCount} unique artifacts.`);
  console.log(`Found ${toDelete.length} duplicates to delete.`);
  
  if (toDelete.length > 0) {
    // Delete in batches of 1000 to avoid query size limits
    const batchSize = 1000;
    for (let i = 0; i < toDelete.length; i += batchSize) {
      const batch = toDelete.slice(i, i + batchSize);
      await prisma.accountArtifact.deleteMany({
        where: { id: { in: batch } }
      });
    }
    console.log('Deleted duplicates successfully.');
  }
}

clean().catch(console.error).finally(() => prisma.$disconnect());
