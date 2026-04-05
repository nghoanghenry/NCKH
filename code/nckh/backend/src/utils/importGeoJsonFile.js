import fs from "node:fs";
import path from "node:path";
import { pool } from "../db.js";
import { toSlug } from "./slug.js";
import { geometryToCoordinateRows } from "./geometry.js";

const DEFAULT_CATEGORY = "Bo Sat";

function normalizeCategoryKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isPlantCategory(value) {
  const key = normalizeCategoryKey(value);
  return key.includes("thuc vat") || key === "plant" || key === "plants";
}

function normalizeFeatureName(properties) {
  return (
    properties.Species ||
    properties.species ||
    properties.name ||
    properties.Name ||
    properties["Ten loai"] ||
    properties["ten_loai"] ||
    properties["Tên loài"] ||
    "Khong ro"
  );
}

function normalizeScientificName(properties) {
  return (
    properties.scientific_name ||
    properties.ScientificName ||
    properties["Tên khoa học"] ||
    null
  );
}

function normalizeCategoryName(properties, defaultCategory) {
  const value =
    properties.category ||
    properties.Category ||
    properties.group ||
    defaultCategory ||
    DEFAULT_CATEGORY;

  const normalized = String(value).trim() || DEFAULT_CATEGORY;

  if (isPlantCategory(normalized)) {
    return null;
  }

  const normalizedKey = normalizeCategoryKey(normalized);
  if (normalizedKey === "khac" || normalizedKey === "other") {
    return DEFAULT_CATEGORY;
  }

  return normalized;
}

function normalizeDescription(properties) {
  return properties.description || properties.Description || null;
}

function detectPropertyType(value) {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "object") return "object";
  return "string";
}

function serializePropertyValue(value, type) {
  if (value === null || value === undefined) return null;
  if (type === "object" || type === "array") {
    return JSON.stringify(value);
  }
  return String(value);
}

async function ensureCategoryRecord(client, categoryName) {
  const normalizedName =
    String(categoryName || DEFAULT_CATEGORY).trim() || DEFAULT_CATEGORY;

  const existing = await client.query(
    `SELECT id, name, name_vi, name_en
     FROM species_categories
     WHERE LOWER(name) = LOWER($1)
        OR LOWER(COALESCE(name_vi, '')) = LOWER($1)
        OR LOWER(COALESCE(name_en, '')) = LOWER($1)
     LIMIT 1`,
    [normalizedName]
  );

  if (existing.rowCount > 0) {
    const row = existing.rows[0];
    return {
      id: row.id,
      name: row.name,
      nameVi: row.name_vi || row.name || null,
      nameEn: row.name_en || null,
    };
  }

  const result = await client.query(
    `INSERT INTO species_categories (name, name_vi)
     VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE
     SET name_vi = COALESCE(species_categories.name_vi, EXCLUDED.name_vi),
         updated_at = now()
     RETURNING id, name, name_vi, name_en`,
    [normalizedName, normalizedName]
  );

  return {
    id: result.rows[0].id,
    name: result.rows[0].name,
    nameVi: result.rows[0].name_vi || result.rows[0].name || null,
    nameEn: result.rows[0].name_en || null,
  };
}

async function upsertSpecies(client, payload) {
  const {
    slug,
    commonName,
    commonNameVi,
    commonNameEn,
    scientificName,
    categoryName,
    categoryId,
    habitat,
    habitatVi,
    habitatEn,
    diet,
    dietVi,
    dietEn,
    description,
    descriptionVi,
    descriptionEn,
    imageUrl,
    sourceGroup,
  } = payload;

  const sql = `
    INSERT INTO species (
      slug, common_name, common_name_vi, common_name_en, scientific_name,
      category, category_id, habitat, habitat_vi, habitat_en, diet, diet_vi,
      diet_en, description, description_vi, description_en, image_url, source_group
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
    ON CONFLICT (slug) DO UPDATE SET
      common_name = EXCLUDED.common_name,
      common_name_vi = COALESCE(EXCLUDED.common_name_vi, species.common_name_vi),
      common_name_en = COALESCE(EXCLUDED.common_name_en, species.common_name_en),
      scientific_name = COALESCE(EXCLUDED.scientific_name, species.scientific_name),
      category = COALESCE(EXCLUDED.category, species.category),
      category_id = COALESCE(EXCLUDED.category_id, species.category_id),
      habitat = COALESCE(EXCLUDED.habitat, species.habitat),
      habitat_vi = COALESCE(EXCLUDED.habitat_vi, species.habitat_vi),
      habitat_en = COALESCE(EXCLUDED.habitat_en, species.habitat_en),
      diet = COALESCE(EXCLUDED.diet, species.diet),
      diet_vi = COALESCE(EXCLUDED.diet_vi, species.diet_vi),
      diet_en = COALESCE(EXCLUDED.diet_en, species.diet_en),
      description = COALESCE(EXCLUDED.description, species.description),
      description_vi = COALESCE(EXCLUDED.description_vi, species.description_vi),
      description_en = COALESCE(EXCLUDED.description_en, species.description_en),
      image_url = COALESCE(EXCLUDED.image_url, species.image_url),
      source_group = COALESCE(EXCLUDED.source_group, species.source_group),
      updated_at = now()
    RETURNING id
  `;

  const values = [
    slug,
    commonName,
    commonNameVi || null,
    commonNameEn || null,
    scientificName,
    categoryName,
    categoryId,
    habitat || null,
    habitatVi || null,
    habitatEn || null,
    diet || null,
    dietVi || null,
    dietEn || null,
    description || null,
    descriptionVi || null,
    descriptionEn || null,
    imageUrl || null,
    sourceGroup || null,
  ];

  const result = await client.query(sql, values);
  return result.rows[0].id;
}

async function insertFeatureProperties(client, featureId, properties) {
  const entries = Object.entries(properties || {});
  for (const [key, value] of entries) {
    const propType = detectPropertyType(value);
    const propValue = serializePropertyValue(value, propType);
    await client.query(
      `INSERT INTO species_feature_properties (feature_id, prop_key, prop_type, prop_value)
       VALUES ($1, $2, $3, $4)`,
      [featureId, key, propType, propValue]
    );
  }
}

async function truncateGeoData(client) {
  await client.query("DELETE FROM species_feature_properties");
  await client.query("DELETE FROM species_coordinates");
  await client.query("DELETE FROM species_features");
}

export async function importGeoJsonFile(filePath, options = {}) {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found: ${absolutePath}`);
  }

  const raw = fs.readFileSync(absolutePath, "utf-8");
  const parsed = JSON.parse(raw);
  if (parsed.type !== "FeatureCollection") {
    throw new Error("Only FeatureCollection is supported");
  }

  const defaultCategory = options.defaultCategory || null;
  const sourceGroup = options.sourceGroup || path.basename(absolutePath);
  const truncate = options.truncate === true;

  if (isPlantCategory(sourceGroup) || isPlantCategory(defaultCategory)) {
    return { imported: 0, filePath: absolutePath, skipped: "plant-category" };
  }

  const client = await pool.connect();
  let imported = 0;

  try {
    await client.query("BEGIN");

    if (truncate) {
      await truncateGeoData(client);
    }

    for (const feature of parsed.features || []) {
      if (!feature?.geometry?.type || !feature?.geometry?.coordinates) {
        continue;
      }

      const props = feature.properties || {};
      const commonName = String(normalizeFeatureName(props)).trim() || "Khong ro";
      const slug = toSlug(commonName) || `species-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      const categoryName = normalizeCategoryName(props, defaultCategory);
      if (!categoryName) {
        continue;
      }

      const categoryRecord = await ensureCategoryRecord(client, categoryName);
      const categoryDisplayName =
        categoryRecord.nameVi || categoryRecord.nameEn || categoryRecord.name;

      const speciesId = await upsertSpecies(client, {
        slug,
        commonName,
        commonNameVi: commonName,
        commonNameEn: null,
        scientificName: normalizeScientificName(props),
        categoryName: categoryDisplayName,
        categoryId: categoryRecord.id,
        habitat: props.habitat || null,
        habitatVi: props.habitat || null,
        habitatEn: null,
        diet: props.diet || null,
        dietVi: props.diet || null,
        dietEn: null,
        description: normalizeDescription(props),
        descriptionVi: normalizeDescription(props),
        descriptionEn: null,
        imageUrl: props.image || props.image_url || null,
        sourceGroup,
      });

      const featureInsert = await client.query(
        `INSERT INTO species_features (species_id, geom_type) VALUES ($1, $2) RETURNING id`,
        [speciesId, feature.geometry.type]
      );

      const featureId = featureInsert.rows[0].id;
      const rows = geometryToCoordinateRows(feature.geometry.type, feature.geometry.coordinates);

      for (const row of rows) {
        await client.query(
          `INSERT INTO species_coordinates (feature_id, part_index, ring_index, point_order, lon, lat)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [featureId, row.partIndex, row.ringIndex, row.pointOrder, row.lon, row.lat]
        );
      }

      await insertFeatureProperties(client, featureId, props);
      imported += 1;
    }

    await client.query("COMMIT");
    return { imported, filePath: absolutePath };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function importGeoJsonDirectory(dirPath, options = {}) {
  const absoluteDir = path.resolve(dirPath);
  if (!fs.existsSync(absoluteDir)) {
    throw new Error(`Directory not found: ${absoluteDir}`);
  }

  const files = fs
    .readdirSync(absoluteDir)
    .filter((file) => file.toLowerCase().endsWith(".geojson") || file.toLowerCase().endsWith(".json"));

  const results = [];
  let truncated = false;

  for (const file of files) {
    const fullPath = path.join(absoluteDir, file);
    try {
      const result = await importGeoJsonFile(fullPath, {
        sourceGroup: file,
        defaultCategory: options.defaultCategory,
        truncate: options.truncate === true && !truncated,
      });
      truncated = truncated || options.truncate === true;
      results.push(result);
    } catch (error) {
      if (String(error.message || "").includes("Only FeatureCollection is supported")) {
        continue;
      }
      throw error;
    }
  }

  return {
    totalFiles: results.length,
    totalImported: results.reduce((acc, item) => acc + item.imported, 0),
    results,
  };
}
