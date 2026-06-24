import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OPTIMIZER_IDMAP = path.resolve(
  __dirname,
  '../../genshin-optimizer/libs/gi/dm/src/dm/material/MaterialExcelConfigData_idmap_gen.json',
);
const OUT_FILE = path.resolve(
  __dirname,
  '../src/common/data/material-catalog-keys.json',
);

function generateMaterialCatalog() {
  if (!fs.existsSync(OPTIMIZER_IDMAP)) {
    console.error(`Missing optimizer idmap at ${OPTIMIZER_IDMAP}`);
    process.exit(1);
  }

  const idmap = JSON.parse(fs.readFileSync(OPTIMIZER_IDMAP, 'utf8'));
  const keys = [
    ...new Set(
      Object.values(idmap).filter((key) => typeof key === 'string' && key.length > 0),
    ),
  ].sort((a, b) => a.localeCompare(b));

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(keys), 'utf8');
  console.log(`Wrote ${keys.length} material catalog keys to ${OUT_FILE}`);
}

generateMaterialCatalog();
