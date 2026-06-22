/**
 * Utility functions for the Genshin Open Object Description (GOOD) format.
 */

/**
 * Converts a standard in-game name into a GOOD format PascalKey.
 * 
 * Rules:
 * 1. Remove all symbols from the name (e.g., ', ", -, etc.)
 * 2. Capitalize each word.
 * 3. Join words without spaces.
 * 
 * Examples:
 * - "Gladiator's Finale" -> "GladiatorsFinale"
 * - "Spirit Locket of Boreas" -> "SpiritLocketOfBoreas"
 * - '"The Catch"' -> "TheCatch"
 * 
 * @param name The original in-game name
 * @returns The GOOD format PascalKey
 */
export function toGoodKey(name: string): string {
  if (!name) return '';
  
  // Remove all non-alphanumeric and non-whitespace characters
  const cleanedName = name.replace(/[^a-zA-Z0-9\s]/g, '');
  
  // Split by whitespace, capitalize first letter, and join
  return cleanedName
    .split(/\s+/)
    .filter(word => word.length > 0)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}
