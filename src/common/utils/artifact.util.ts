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

export function calculateCV(substats: { key: string; value: number }[]): number {
  let cv = 0;
  for (const s of substats || []) {
    if (s.key === "critRate_") cv += (s.value * 2);
    if (s.key === "critDMG_") cv += s.value;
  }
  return Number(cv.toFixed(2));
}

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
