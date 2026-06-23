import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export const MAX_SUBSTATS: Record<string, number> = {
  "hp": 298.75,
  "hp_": 5.83,
  "atk": 19.45,
  "atk_": 5.83,
  "def": 23.15,
  "def_": 7.29,
  "eleMas": 23.31,
  "enerRech_": 6.48,
  "critRate_": 3.89,
  "critDMG_": 7.77
};

export function calculateRV(substats: { key: string; value: number }[]): number {
  let rv = 0;
  for (const s of substats || []) {
    const maxVal = MAX_SUBSTATS[s.key];
    if (maxVal && s.value) {
      rv += (s.value / maxVal) * 100;
    }
  }
  return Math.round(rv / 10) * 10;
}

async function updateRVs() {
  console.log('Fetching all artifacts to update RVs...');
  const artifacts = await prisma.accountArtifact.findMany({
    select: { id: true, substats: true, rv: true }
  });

  let count = 0;
  for (const art of artifacts) {
    const newRV = calculateRV(art.substats as any);
    if (newRV !== art.rv) {
      await prisma.accountArtifact.update({
        where: { id: art.id },
        data: { rv: newRV }
      });
      count++;
    }
  }
  
  console.log(`Updated RVs for ${count} artifacts.`);
}

updateRVs().catch(console.error).finally(() => prisma.$disconnect());
