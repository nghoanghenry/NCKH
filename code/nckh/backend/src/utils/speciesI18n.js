import { query } from "../db.js";

let ensureColumnsPromise = null;

export function resolveLanguage(input) {
  return String(input || "vi").toLowerCase() === "en" ? "en" : "vi";
}

export function pickLocalizedField(row, language, legacyKey, viKey, enKey) {
  const legacyValue = row?.[legacyKey] ?? null;
  const viValue = row?.[viKey] ?? null;
  const enValue = row?.[enKey] ?? null;

  if (language === "en") {
    return enValue || viValue || legacyValue;
  }

  return viValue || enValue || legacyValue;
}

export function ensureSpeciesI18nColumns() {
  if (!ensureColumnsPromise) {
    ensureColumnsPromise = query(`
      ALTER TABLE species ADD COLUMN IF NOT EXISTS common_name_vi VARCHAR(180);
      ALTER TABLE species ADD COLUMN IF NOT EXISTS common_name_en VARCHAR(180);

      ALTER TABLE species_categories ADD COLUMN IF NOT EXISTS name_vi VARCHAR(120);
      ALTER TABLE species_categories ADD COLUMN IF NOT EXISTS name_en VARCHAR(120);

      ALTER TABLE species ADD COLUMN IF NOT EXISTS habitat_vi TEXT;
      ALTER TABLE species ADD COLUMN IF NOT EXISTS habitat_en TEXT;

      ALTER TABLE species ADD COLUMN IF NOT EXISTS diet_vi TEXT;
      ALTER TABLE species ADD COLUMN IF NOT EXISTS diet_en TEXT;

      ALTER TABLE species ADD COLUMN IF NOT EXISTS description_vi TEXT;
      ALTER TABLE species ADD COLUMN IF NOT EXISTS description_en TEXT;

      ALTER TABLE species ADD COLUMN IF NOT EXISTS conservation_status_vi VARCHAR(120);
      ALTER TABLE species ADD COLUMN IF NOT EXISTS conservation_status_en VARCHAR(120);

      ALTER TABLE species ADD COLUMN IF NOT EXISTS distribution_vi TEXT;
      ALTER TABLE species ADD COLUMN IF NOT EXISTS distribution_en TEXT;

      UPDATE species
      SET
        common_name_vi = COALESCE(common_name_vi, common_name),
        habitat_vi = COALESCE(habitat_vi, habitat),
        diet_vi = COALESCE(diet_vi, diet),
        description_vi = COALESCE(description_vi, description),
        conservation_status_vi = COALESCE(conservation_status_vi, conservation_status),
        distribution_vi = COALESCE(distribution_vi, distribution);

      UPDATE species_categories
      SET name_vi = COALESCE(name_vi, name);
    `).catch((error) => {
      ensureColumnsPromise = null;
      throw error;
    });
  }

  return ensureColumnsPromise;
}
