import catalogKeys from '../data/material-catalog-keys.json';

const MATERIAL_CATALOG = new Set(catalogKeys as string[]);

export function isCatalogMaterial(key: string): boolean {
  return MATERIAL_CATALOG.has(key);
}

export function searchCatalogMaterials(
  search: string,
  limit: number,
): { key: string; name: string }[] {
  const needle = search.trim().toLowerCase();
  const results: { key: string; name: string }[] = [];

  for (const key of MATERIAL_CATALOG) {
    const name = key.replace(/([A-Z])/g, ' $1').trim();
    if (
      needle &&
      !key.toLowerCase().includes(needle) &&
      !name.toLowerCase().includes(needle)
    ) {
      continue;
    }
    results.push({ key, name });
    if (results.length >= limit) break;
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}
