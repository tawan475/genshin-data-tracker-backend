import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { calculateCV, calculateRV } from './src/common/utils/artifact.util';

dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function run() {
  console.log("Fetching artifacts...");
  const artifacts = await prisma.accountArtifact.findMany();
  console.log(`Updating ${artifacts.length} artifacts...`);
  
  let count = 0;
  for (const art of artifacts) {
    const cv = calculateCV((art.substats as any) || []);
    const rv = calculateRV((art.substats as any) || []);
    if (art.cv !== cv || art.rv !== rv) {
      await prisma.accountArtifact.update({
        where: { id: art.id },
        data: { cv, rv }
      });
      count++;
      if (count % 100 === 0) console.log(`Updated ${count} artifacts`);
    }
  }
  console.log(`Done! Updated ${count} artifacts.`);
  process.exit(0);
}

run().catch(console.error);
