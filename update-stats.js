const { PrismaClient } = require('@prisma/client');
const { calculateCV, calculateRV } = require('./dist/common/utils/artifact.util');
const prisma = new PrismaClient();

async function run() {
  console.log("Fetching artifacts...");
  const artifacts = await prisma.accountArtifact.findMany();
  console.log(`Updating ${artifacts.length} artifacts...`);
  
  let count = 0;
  for (const art of artifacts) {
    const cv = calculateCV(art.substats || []);
    const rv = calculateRV(art.substats || []);
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
