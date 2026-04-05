import express from "express";
import { query } from "../db.js";
import { buildGeometryFromRows } from "../utils/geometry.js";
import {
  ensureSpeciesI18nColumns,
  pickLocalizedField,
  resolveLanguage,
} from "../utils/speciesI18n.js";

const router = express.Router();

router.use(async (_req, _res, next) => {
  try {
    await ensureSpeciesI18nColumns();
    next();
  } catch (error) {
    next(error);
  }
});

function mapSpeciesRow(row, language = "vi") {
  const commonName = pickLocalizedField(
    row,
    language,
    "common_name",
    "common_name_vi",
    "common_name_en"
  );
  const habitat = pickLocalizedField(row, language, "habitat", "habitat_vi", "habitat_en");
  const diet = pickLocalizedField(row, language, "diet", "diet_vi", "diet_en");
  const description = pickLocalizedField(
    row,
    language,
    "description",
    "description_vi",
    "description_en"
  );
  const conservationStatus = pickLocalizedField(
    row,
    language,
    "conservation_status",
    "conservation_status_vi",
    "conservation_status_en"
  );
  const distribution = pickLocalizedField(
    row,
    language,
    "distribution",
    "distribution_vi",
    "distribution_en"
  );
  const category =
    pickLocalizedField(
      row,
      language,
      "category_name",
      "category_name_vi",
      "category_name_en"
    ) || row.category;

  return {
    id: row.id,
    slug: row.slug,
    commonName,
    commonNameVi: row.common_name_vi || row.common_name || null,
    commonNameEn: row.common_name_en || null,
    scientificName: row.scientific_name,
    category,
    habitat,
    habitatVi: row.habitat_vi || row.habitat || null,
    habitatEn: row.habitat_en || null,
    diet,
    dietVi: row.diet_vi || row.diet || null,
    dietEn: row.diet_en || null,
    description,
    descriptionVi: row.description_vi || row.description || null,
    descriptionEn: row.description_en || null,
    imageUrl: row.image_url,
    conservationStatus,
    conservationStatusVi: row.conservation_status_vi || row.conservation_status || null,
    conservationStatusEn: row.conservation_status_en || null,
    distribution,
    distributionVi: row.distribution_vi || row.distribution || null,
    distributionEn: row.distribution_en || null,
    sourceGroup: row.source_group,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function deserializePropertyValue(type, rawValue) {
  if (rawValue === null || rawValue === undefined) return null;

  if (type === "number") {
    const num = Number(rawValue);
    return Number.isNaN(num) ? rawValue : num;
  }

  if (type === "boolean") {
    return rawValue === "true";
  }

  if (type === "array" || type === "object") {
    try {
      return JSON.parse(rawValue);
    } catch (_error) {
      return rawValue;
    }
  }

  if (type === "null") {
    return null;
  }

  return rawValue;
}

async function loadSpeciesImages(speciesId) {
  const images = await query(
    `SELECT id, file_name, file_path, mime_type, file_size, sort_order, created_at
     FROM species_images
     WHERE species_id = $1
     ORDER BY sort_order ASC, id ASC`,
    [speciesId]
  );

  return images.rows.map((img) => ({
    id: img.id,
    fileName: img.file_name,
    url: img.file_path,
    mimeType: img.mime_type,
    fileSize: img.file_size,
    sortOrder: img.sort_order,
    createdAt: img.created_at,
  }));
}

async function loadSpeciesByClause(clause, value, language = "vi") {
  const speciesResult = await query(
    `SELECT
       s.*,
       COALESCE(sc.name, s.category) AS category_name,
       COALESCE(sc.name_vi, sc.name, s.category) AS category_name_vi,
       COALESCE(sc.name_en, sc.name_vi, sc.name, s.category) AS category_name_en
     FROM species s
     LEFT JOIN species_categories sc ON sc.id = s.category_id
     WHERE s.${clause} = $1
     LIMIT 1`,
    [value]
  );

  if (speciesResult.rowCount === 0) {
    return null;
  }

  const species = mapSpeciesRow(speciesResult.rows[0], language);

  const characteristics = await query(
    `SELECT value FROM species_characteristics WHERE species_id = $1 ORDER BY sort_order ASC, id ASC`,
    [species.id]
  );

  const threats = await query(
    `SELECT value FROM species_threats WHERE species_id = $1 ORDER BY sort_order ASC, id ASC`,
    [species.id]
  );

  const images = await loadSpeciesImages(species.id);

  return {
    ...species,
    images,
    characteristics: characteristics.rows.map((item) => item.value),
    threats: threats.rows.map((item) => item.value),
  };
}

router.get("/points", async (req, res) => {
  try {
    const language = resolveLanguage(req.query.lang);
    const slug = String(req.query.slug || "").trim();
    const category = String(req.query.category || "").trim();

    const whereClauses = [];
    const values = [];

    if (slug) {
      values.push(slug);
      whereClauses.push(`s.slug = $${values.length}`);
    }

    if (category) {
      values.push(category);
      whereClauses.push(`(
        COALESCE(sc.name_vi, sc.name, s.category) = $${values.length}
        OR COALESCE(sc.name_en, sc.name_vi, sc.name, s.category) = $${values.length}
        OR COALESCE(sc.name, s.category) = $${values.length}
        OR s.category = $${values.length}
      )`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    const result = await query(
      `SELECT
         s.id,
         s.slug,
         f.id AS marker_id,
         s.common_name,
        s.common_name_vi,
        s.common_name_en,
         s.scientific_name,
         COALESCE(sc.name, s.category) AS category_name,
         COALESCE(sc.name_vi, sc.name, s.category) AS category_name_vi,
         COALESCE(sc.name_en, sc.name_vi, sc.name, s.category) AS category_name_en,
         s.habitat,
        s.habitat_vi,
        s.habitat_en,
         s.diet,
        s.diet_vi,
        s.diet_en,
         s.description,
        s.description_vi,
        s.description_en,
         s.image_url,
        s.conservation_status,
        s.conservation_status_vi,
        s.conservation_status_en,
        s.distribution,
        s.distribution_vi,
        s.distribution_en,
        s.source_group,
         AVG(c.lon) AS lon,
         AVG(c.lat) AS lat
       FROM species s
       LEFT JOIN species_categories sc ON sc.id = s.category_id
       JOIN species_features f ON f.species_id = s.id
       JOIN species_coordinates c ON c.feature_id = f.id
       ${whereSql}
       GROUP BY s.id, f.id, sc.name, sc.name_vi, sc.name_en
       ORDER BY s.common_name ASC, f.id ASC`,
      values
    );

    const points = result.rows.map((row) => {
      const mapped = mapSpeciesRow(row, language);
      return {
        id: mapped.id,
        slug: mapped.slug,
        markerId: Number(row.marker_id || row.id),
        commonName: mapped.commonName,
        commonNameVi: mapped.commonNameVi,
        commonNameEn: mapped.commonNameEn,
        scientificName: mapped.scientificName,
        category: mapped.category,
        habitat: mapped.habitat,
        habitatVi: mapped.habitatVi,
        habitatEn: mapped.habitatEn,
        diet: mapped.diet,
        dietVi: mapped.dietVi,
        dietEn: mapped.dietEn,
        description: mapped.description,
        descriptionVi: mapped.descriptionVi,
        descriptionEn: mapped.descriptionEn,
        imageUrl: mapped.imageUrl,
        lon: Number(row.lon),
        lat: Number(row.lat),
      };
    });

    return res.json({ data: points });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/slug/:slug", async (req, res) => {
  try {
    const language = resolveLanguage(req.query.lang);
    const data = await loadSpeciesByClause("slug", req.params.slug, language);
    if (!data) {
      return res.status(404).json({ message: "Species not found" });
    }
    return res.json({ data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/:id/geojson", async (req, res) => {
  try {
    const language = resolveLanguage(req.query.lang);
    const speciesId = Number(req.params.id);
    if (Number.isNaN(speciesId)) {
      return res.status(400).json({ message: "Invalid species id" });
    }

    const speciesResult = await query(
      `SELECT id, common_name, common_name_vi, common_name_en FROM species WHERE id = $1`,
      [speciesId]
    );
    if (speciesResult.rowCount === 0) {
      return res.status(404).json({ message: "Species not found" });
    }

    const rowsResult = await query(
      `SELECT
         f.id AS feature_id,
         f.geom_type,
         c.part_index,
         c.ring_index,
         c.point_order,
         c.lon,
         c.lat
       FROM species_features f
       LEFT JOIN species_coordinates c ON c.feature_id = f.id
       WHERE f.species_id = $1
       ORDER BY f.id, c.part_index, c.ring_index, c.point_order`,
      [speciesId]
    );

    const grouped = new Map();
    for (const row of rowsResult.rows) {
      if (!grouped.has(row.feature_id)) {
        grouped.set(row.feature_id, {
          geomType: row.geom_type,
          rows: [],
        });
      }
      grouped.get(row.feature_id).rows.push(row);
    }

    const featureIds = [...grouped.keys()];
    const propertiesMap = new Map();

    if (featureIds.length > 0) {
      const propsResult = await query(
        `SELECT feature_id, prop_key, prop_type, prop_value
         FROM species_feature_properties
         WHERE feature_id = ANY($1::bigint[])
         ORDER BY id ASC`,
        [featureIds]
      );

      for (const row of propsResult.rows) {
        if (!propertiesMap.has(row.feature_id)) {
          propertiesMap.set(row.feature_id, {});
        }
        propertiesMap.get(row.feature_id)[row.prop_key] = deserializePropertyValue(row.prop_type, row.prop_value);
      }
    }

    const features = [];
    for (const [featureId, entry] of grouped.entries()) {
      const coordinateRows = entry.rows.filter(
        (item) => item.lon !== null && item.lon !== undefined && item.lat !== null && item.lat !== undefined
      );
      if (coordinateRows.length === 0) continue;

      const geometry = buildGeometryFromRows(entry.geomType, coordinateRows);
      if (!geometry) continue;

      features.push({
        type: "Feature",
        properties: {
          speciesId,
          speciesName: pickLocalizedField(
            speciesResult.rows[0],
            language,
            "common_name",
            "common_name_vi",
            "common_name_en"
          ),
          featureId,
          ...(propertiesMap.get(featureId) || {}),
        },
        geometry,
      });
    }

    return res.json({
      type: "FeatureCollection",
      features,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/:id/images", async (req, res) => {
  try {
    const speciesId = Number(req.params.id);
    if (Number.isNaN(speciesId)) {
      return res.status(400).json({ message: "Invalid species id" });
    }

    const images = await loadSpeciesImages(speciesId);
    return res.json({ data: images });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const language = resolveLanguage(req.query.lang);
    const speciesId = Number(req.params.id);
    if (Number.isNaN(speciesId)) {
      return res.status(400).json({ message: "Invalid species id" });
    }

    const data = await loadSpeciesByClause("id", speciesId, language);
    if (!data) {
      return res.status(404).json({ message: "Species not found" });
    }

    return res.json({ data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/", async (req, res) => {
  try {
    const language = resolveLanguage(req.query.lang);
    const limit = Math.min(Number(req.query.limit || 20), 200);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    const search = String(req.query.search || "").trim();

    const whereSql = search
      ? `WHERE s.common_name ILIKE $1 OR s.common_name_vi ILIKE $1 OR s.common_name_en ILIKE $1 OR s.scientific_name ILIKE $1 OR COALESCE(sc.name, s.category) ILIKE $1 OR COALESCE(sc.name_vi, sc.name, s.category) ILIKE $1 OR COALESCE(sc.name_en, sc.name_vi, sc.name, s.category) ILIKE $1`
      : "";

    const values = [];
    if (search) values.push(`%${search}%`);

    const countResult = await query(
      `SELECT COUNT(*)::INT AS total
       FROM species s
       LEFT JOIN species_categories sc ON sc.id = s.category_id
       ${whereSql}`,
      values
    );

    values.push(limit);
    values.push(offset);
    const listResult = await query(
      `SELECT
         s.*,
        COALESCE(sc.name, s.category) AS category_name,
        COALESCE(sc.name_vi, sc.name, s.category) AS category_name_vi,
        COALESCE(sc.name_en, sc.name_vi, sc.name, s.category) AS category_name_en
       FROM species s
       LEFT JOIN species_categories sc ON sc.id = s.category_id
       ${whereSql}
       ORDER BY s.id ASC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );

    return res.json({
      data: listResult.rows.map((row) => mapSpeciesRow(row, language)),
      meta: {
        total: countResult.rows[0].total,
        limit,
        offset,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
