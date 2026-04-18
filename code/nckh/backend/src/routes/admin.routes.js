import express from "express";
import bcrypt from "bcryptjs";
import path from "node:path";
import fs from "node:fs";
import { promises as fsPromises } from "node:fs";
import multer from "multer";
import { body, validationResult } from "express-validator";
import { pool, query } from "../db.js";
import { config } from "../config.js";
import { toSlug } from "../utils/slug.js";
import { buildGeometryFromRows, geometryToCoordinateRows } from "../utils/geometry.js";
import { importGeoJsonDirectory, importGeoJsonFile } from "../utils/importGeoJsonFile.js";
import {
  ensureSpeciesI18nColumns,
  pickLocalizedField,
  resolveLanguage,
} from "../utils/speciesI18n.js";
import { requireAdmin, requireContributor } from "../middleware/auth.js";

const router = express.Router();

router.use(async (_req, _res, next) => {
  try {
    await ensureSpeciesI18nColumns();
    next();
  } catch (error) {
    next(error);
  }
});

function validationError(res, req) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return true;
  }
  return false;
}

function normalizeOptionalString(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

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

function mapCategoryRow(row) {
  const nameVi = row.name_vi || row.name || null;
  const nameEn = row.name_en || null;

  return {
    id: row.id,
    name: nameVi || nameEn || row.name,
    nameVi,
    nameEn,
    speciesCount: Number(row.species_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapUserRow(row) {
  const role = row.role || (row.is_admin ? "ADMIN" : "USER");
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    isAdmin: role === "ADMIN",
    role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeFeatureProperty(value) {
  let propType = "string";
  if (value === null || value === undefined) propType = "null";
  else if (Array.isArray(value)) propType = "array";
  else if (typeof value === "number") propType = "number";
  else if (typeof value === "boolean") propType = "boolean";
  else if (typeof value === "object") propType = "object";

  const propValue =
    value === null || value === undefined
      ? null
      : propType === "array" || propType === "object"
        ? JSON.stringify(value)
        : String(value);

  return { propType, propValue };
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

const ALLOWED_GEOM_TYPES = new Set([
  "Point",
  "LineString",
  "Polygon",
  "MultiLineString",
  "MultiPolygon",
]);

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isValidLonLat(lon, lat) {
  return Number.isFinite(lon) && Number.isFinite(lat);
}

async function ensureCategoryRecord(categoryName) {
  const normalizedName = String(categoryName || "").trim();
  if (!normalizedName) {
    return null;
  }

  const existing = await query(
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

  const inserted = await query(
    `INSERT INTO species_categories (name, name_vi)
     VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE
     SET name_vi = COALESCE(species_categories.name_vi, EXCLUDED.name_vi),
         updated_at = now()
     RETURNING id, name, name_vi, name_en`,
    [normalizedName, normalizedName]
  );

  return {
    id: inserted.rows[0].id,
    name: inserted.rows[0].name,
    nameVi: inserted.rows[0].name_vi || inserted.rows[0].name || null,
    nameEn: inserted.rows[0].name_en || null,
  };
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

const imageStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const speciesId = req.params.id || req.params.speciesId;
    const dir = path.resolve(config.uploadRoot, "species", String(speciesId));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const safeExt = ext || ".jpg";
    const fileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`;
    cb(null, fileName);
  },
});

const imageUpload = multer({
  storage: imageStorage,
  limits: {
    files: 10,
    fileSize: 8 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      cb(new Error("Only image files are allowed"));
      return;
    }
    cb(null, true);
  },
});

router.get("/categories", async (_req, res) => {
  try {
    const result = await query(
      `SELECT
         c.id,
         c.name,
         c.name_vi,
         c.name_en,
         c.created_at,
         c.updated_at,
         COUNT(s.id)::INT AS species_count
       FROM species_categories c
       LEFT JOIN species s ON s.category_id = c.id
       GROUP BY c.id, c.name, c.name_vi, c.name_en
       ORDER BY COALESCE(c.name_vi, c.name_en, c.name) ASC`
    );

    return res.json({ data: result.rows.map(mapCategoryRow) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.post(
  "/categories",
  requireAdmin,
  [
    body("nameVi").optional().isString(),
    body("nameEn").optional().isString(),
  ],
  async (req, res) => {
    if (validationError(res, req)) return;

    try {
      const nameVi = normalizeOptionalString(req.body.nameVi ?? req.body.name);
      const nameEn = normalizeOptionalString(req.body.nameEn);
      const legacyName = nameVi || nameEn;

      if (!legacyName) {
        return res.status(400).json({ message: "At least one of nameVi/nameEn (or name) is required" });
      }

      const duplicateResult = await query(
        `SELECT id
         FROM species_categories
         WHERE LOWER(name) = LOWER($1)
            OR LOWER(COALESCE(name_vi, '')) = LOWER($1)
            OR LOWER(COALESCE(name_en, '')) = LOWER($1)
            OR LOWER(name) = LOWER($2)
            OR LOWER(COALESCE(name_vi, '')) = LOWER($2)
            OR LOWER(COALESCE(name_en, '')) = LOWER($2)
         LIMIT 1`,
        [nameVi || legacyName, nameEn || legacyName]
      );

      if (duplicateResult.rowCount > 0) {
        return res.status(409).json({ message: "Category already exists" });
      }

      const inserted = await query(
        `INSERT INTO species_categories (name, name_vi, name_en)
         VALUES ($1, $2, $3)
         RETURNING id, name, name_vi, name_en, created_at, updated_at`,
        [legacyName, nameVi, nameEn]
      );

      const countResult = await query(
        "SELECT COUNT(*)::INT AS species_count FROM species WHERE category_id = $1",
        [inserted.rows[0].id]
      );

      return res.status(201).json({
        data: mapCategoryRow({
          ...inserted.rows[0],
          species_count: countResult.rows[0].species_count,
        }),
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.put(
  "/categories/:id",
  requireContributor,
  [
    body("name").optional().isString(),
    body("nameVi").optional().isString(),
    body("nameEn").optional().isString(),
  ],
  async (req, res) => {
    if (validationError(res, req)) return;

    const categoryId = Number(req.params.id);
    if (Number.isNaN(categoryId)) {
      return res.status(400).json({ message: "Invalid category id" });
    }

    const hasNameField =
      Object.prototype.hasOwnProperty.call(req.body, "name") ||
      Object.prototype.hasOwnProperty.call(req.body, "nameVi") ||
      Object.prototype.hasOwnProperty.call(req.body, "nameEn");

    if (!hasNameField) {
      return res.status(400).json({ message: "No fields to update" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const existingResult = await client.query(
        `SELECT id, name, name_vi, name_en, created_at, updated_at
         FROM species_categories
         WHERE id = $1
         LIMIT 1`,
        [categoryId]
      );

      if (existingResult.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Category not found" });
      }

      const existing = existingResult.rows[0];

      const nextNameVi =
        Object.prototype.hasOwnProperty.call(req.body, "name") ||
        Object.prototype.hasOwnProperty.call(req.body, "nameVi")
          ? normalizeOptionalString(req.body.nameVi ?? req.body.name)
          : existing.name_vi || existing.name || null;

      const nextNameEn = Object.prototype.hasOwnProperty.call(req.body, "nameEn")
        ? normalizeOptionalString(req.body.nameEn)
        : existing.name_en || null;

      const nextLegacyName = nextNameVi || nextNameEn;
      if (!nextLegacyName) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "At least one of nameVi/nameEn (or name) is required" });
      }

      const duplicateResult = await client.query(
        `SELECT id
         FROM species_categories
         WHERE id <> $1
           AND (
             LOWER(name) = LOWER($2)
             OR LOWER(COALESCE(name_vi, '')) = LOWER($2)
             OR LOWER(COALESCE(name_en, '')) = LOWER($2)
             OR LOWER(name) = LOWER($3)
             OR LOWER(COALESCE(name_vi, '')) = LOWER($3)
             OR LOWER(COALESCE(name_en, '')) = LOWER($3)
           )
         LIMIT 1`,
        [categoryId, nextNameVi || nextLegacyName, nextNameEn || nextLegacyName]
      );

      if (duplicateResult.rowCount > 0) {
        await client.query("ROLLBACK");
        return res.status(409).json({ message: "Category already exists" });
      }

      const updateResult = await client.query(
        `UPDATE species_categories
         SET name = $1,
             name_vi = $2,
             name_en = $3,
             updated_at = now()
         WHERE id = $4
         RETURNING id, name, name_vi, name_en, created_at, updated_at`,
        [nextLegacyName, nextNameVi, nextNameEn, categoryId]
      );

      await client.query(
        `UPDATE species
         SET category = $1,
             updated_at = now()
         WHERE category_id = $2`,
        [nextNameVi || nextNameEn, categoryId]
      );

      const countResult = await client.query(
        "SELECT COUNT(*)::INT AS species_count FROM species WHERE category_id = $1",
        [categoryId]
      );

      await client.query("COMMIT");

      return res.json({
        updated: true,
        data: mapCategoryRow({
          ...updateResult.rows[0],
          species_count: countResult.rows[0].species_count,
        }),
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(error);
      return res.status(500).json({ message: "Internal server error" });
    } finally {
      client.release();
    }
  }
);

router.delete("/categories/:id", requireAdmin, async (req, res) => {
  const categoryId = Number(req.params.id);
  if (Number.isNaN(categoryId)) {
    return res.status(400).json({ message: "Invalid category id" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const categoryResult = await client.query(
      "SELECT id, name, name_vi, name_en FROM species_categories WHERE id = $1 LIMIT 1",
      [categoryId]
    );
    if (categoryResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Category not found" });
    }

    const linkedSpeciesResult = await client.query(
      "SELECT COUNT(*)::INT AS total FROM species WHERE category_id = $1",
      [categoryId]
    );
    const linkedSpecies = Number(linkedSpeciesResult.rows[0]?.total || 0);
    if (linkedSpecies > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        message: "Cannot delete category while it still has species",
        linkedSpecies,
      });
    }

    await client.query("DELETE FROM species_categories WHERE id = $1", [categoryId]);
    await client.query("COMMIT");

    return res.json({
      deleted: true,
      data: {
        id: categoryResult.rows[0].id,
        name:
          categoryResult.rows[0].name_vi ||
          categoryResult.rows[0].name_en ||
          categoryResult.rows[0].name,
        nameVi: categoryResult.rows[0].name_vi || categoryResult.rows[0].name,
        nameEn: categoryResult.rows[0].name_en || null,
        linkedSpecies: 0,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  } finally {
    client.release();
  }
});

router.get("/users", async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const callerRole = req.user?.role || (req.user?.isAdmin ? "ADMIN" : "USER");

    // Role visibility: ADMIN sees all, CONTRIBUTOR sees CONTRIBUTOR+USER, USER sees only USER
    let roleFilter = "";
    const values = [];
    if (callerRole === "CONTRIBUTOR") {
      roleFilter = search
        ? "WHERE (email ILIKE $1 OR COALESCE(full_name, '') ILIKE $1) AND role IN ('CONTRIBUTOR','USER')"
        : "WHERE role IN ('CONTRIBUTOR','USER')";
    } else if (callerRole !== "ADMIN") {
      roleFilter = search
        ? "WHERE (email ILIKE $1 OR COALESCE(full_name, '') ILIKE $1) AND role = 'USER'"
        : "WHERE role = 'USER'";
    } else {
      roleFilter = search ? "WHERE email ILIKE $1 OR COALESCE(full_name, '') ILIKE $1" : "";
    }
    if (search) values.push(`%${search}%`);

    const result = await query(
      `SELECT id, email, full_name, is_admin, role, created_at, updated_at
       FROM users
       ${roleFilter}
       ORDER BY id DESC`,
      values
    );

    return res.json({ data: result.rows.map(mapUserRow) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.post(
  "/users",
  requireAdmin,
  [
    body("email").isEmail().withMessage("email is invalid"),
    body("password").isLength({ min: 6 }).withMessage("password must be at least 6 chars"),
    body("fullName").optional().isString(),
    body("role").optional().isIn(["ADMIN", "CONTRIBUTOR", "USER"]).withMessage("role must be ADMIN, CONTRIBUTOR or USER"),
  ],
  async (req, res) => {
    if (validationError(res, req)) return;

    const { email, password, fullName, role } = req.body;
    const normalizedRole = role || "USER";
    const isAdmin = normalizedRole === "ADMIN";

    try {
      const exists = await query("SELECT id FROM users WHERE email = $1", [email]);
      if (exists.rowCount > 0) {
        return res.status(409).json({ message: "Email already exists" });
      }

      const hash = await bcrypt.hash(password, config.bcryptSaltRounds);
      const inserted = await query(
        `INSERT INTO users (email, password_hash, full_name, is_admin, role)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, email, full_name, is_admin, role, created_at, updated_at`,
        [email, hash, fullName || null, isAdmin, normalizedRole]
      );

      return res.status(201).json({ data: mapUserRow(inserted.rows[0]) });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.delete("/users/:id", requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  if (Number.isNaN(userId)) {
    return res.status(400).json({ message: "Invalid user id" });
  }

  if (Number(req.user?.id) === userId) {
    return res.status(400).json({ message: "Cannot delete current login account" });
  }

  try {
    const targetResult = await query(
      "SELECT id, email, full_name, is_admin, role, created_at, updated_at FROM users WHERE id = $1 LIMIT 1",
      [userId]
    );
    if (targetResult.rowCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    if (targetResult.rows[0].role === "ADMIN" || targetResult.rows[0].is_admin) {
      const adminCount = await query(
        "SELECT COUNT(*)::INT AS total FROM users WHERE role = 'ADMIN' OR is_admin = TRUE"
      );

      if (adminCount.rows[0].total <= 1) {
        return res.status(400).json({ message: "Cannot delete the last admin account" });
      }
    }

    await query("DELETE FROM users WHERE id = $1", [userId]);
    return res.json({ deleted: true, data: mapUserRow(targetResult.rows[0]) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/species", async (req, res) => {
  try {
    const language = resolveLanguage(req.query.lang);
    const limit = Math.min(Number(req.query.limit || 50), 200);
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
         COALESCE(sc.name_en, sc.name_vi, sc.name, s.category) AS category_name_en,
         COUNT(si.id)::INT AS image_count
       FROM species s
       LEFT JOIN species_categories sc ON sc.id = s.category_id
       LEFT JOIN species_images si ON si.species_id = s.id
       ${whereSql}
       GROUP BY s.id, sc.name, sc.name_vi, sc.name_en
       ORDER BY s.id DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );

    return res.json({
      data: listResult.rows.map((row) => ({
        ...mapSpeciesRow(row, language),
        imageCount: row.image_count,
      })),
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

router.get("/species/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    return res.status(400).json({ message: "Invalid species id" });
  }

  try {
    const language = resolveLanguage(req.query.lang);
    const speciesResult = await query(
      `SELECT
         s.*,
         COALESCE(sc.name, s.category) AS category_name,
         COALESCE(sc.name_vi, sc.name, s.category) AS category_name_vi,
         COALESCE(sc.name_en, sc.name_vi, sc.name, s.category) AS category_name_en
       FROM species s
       LEFT JOIN species_categories sc ON sc.id = s.category_id
       WHERE s.id = $1
       LIMIT 1`,
      [id]
    );
    if (speciesResult.rowCount === 0) {
      return res.status(404).json({ message: "Species not found" });
    }

    const images = await loadSpeciesImages(id);
    return res.json({ data: { ...mapSpeciesRow(speciesResult.rows[0], language), images } });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/species/:id/geojson", async (req, res) => {
  const speciesId = Number(req.params.id);
  if (Number.isNaN(speciesId)) {
    return res.status(400).json({ message: "Invalid species id" });
  }

  try {
    const language = resolveLanguage(req.query.lang);
    const speciesResult = await query(
      `SELECT id, slug, common_name, common_name_vi, common_name_en
       FROM species
       WHERE id = $1
       LIMIT 1`,
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
        propertiesMap.get(row.feature_id)[row.prop_key] = deserializePropertyValue(
          row.prop_type,
          row.prop_value
        );
      }
    }

    const speciesName = pickLocalizedField(
      speciesResult.rows[0],
      language,
      "common_name",
      "common_name_vi",
      "common_name_en"
    );

    const features = [];
    for (const [featureId, entry] of grouped.entries()) {
      const coordinateRows = entry.rows.filter(
        (item) =>
          item.lon !== null &&
          item.lon !== undefined &&
          item.lat !== null &&
          item.lat !== undefined
      );
      if (coordinateRows.length === 0) continue;

      const geometry = buildGeometryFromRows(entry.geomType, coordinateRows);
      if (!geometry) continue;

      features.push({
        type: "Feature",
        properties: {
          speciesId,
          speciesName,
          featureId,
          ...(propertiesMap.get(featureId) || {}),
        },
        geometry,
      });
    }

    return res.json({ type: "FeatureCollection", features });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/species/:id/positions", async (req, res) => {
  const speciesId = Number(req.params.id);
  if (Number.isNaN(speciesId)) {
    return res.status(400).json({ message: "Invalid species id" });
  }

  try {
    const language = resolveLanguage(req.query.lang);
    const limit = Math.min(Math.max(Number(req.query.limit || 500), 1), 5000);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    const speciesResult = await query(
      `SELECT id, slug, common_name, common_name_vi, common_name_en
       FROM species
       WHERE id = $1
       LIMIT 1`,
      [speciesId]
    );
    if (speciesResult.rowCount === 0) {
      return res.status(404).json({ message: "Species not found" });
    }

    const countResult = await query(
      `SELECT COUNT(*)::INT AS total
       FROM species_features f
       JOIN species_coordinates c ON c.feature_id = f.id
       WHERE f.species_id = $1`,
      [speciesId]
    );

    const summaryResult = await query(
      `SELECT
         f.id AS feature_id,
         f.geom_type,
         COUNT(c.id)::INT AS point_count,
         AVG(c.lon) AS centroid_lon,
         AVG(c.lat) AS centroid_lat
       FROM species_features f
       LEFT JOIN species_coordinates c ON c.feature_id = f.id
       WHERE f.species_id = $1
       GROUP BY f.id, f.geom_type
       ORDER BY f.id ASC`,
      [speciesId]
    );

    const coordinateRowsResult = await query(
      `SELECT
         f.id AS feature_id,
         f.geom_type,
         c.id AS coordinate_id,
         c.part_index,
         c.ring_index,
         c.point_order,
         c.lon,
         c.lat
       FROM species_features f
       JOIN species_coordinates c ON c.feature_id = f.id
       WHERE f.species_id = $1
       ORDER BY f.id, c.part_index, c.ring_index, c.point_order
       LIMIT $2 OFFSET $3`,
      [speciesId, limit, offset]
    );

    const featureIds = summaryResult.rows.map((row) => Number(row.feature_id));
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

        propertiesMap.get(row.feature_id)[row.prop_key] = deserializePropertyValue(
          row.prop_type,
          row.prop_value
        );
      }
    }

    const coordinates = coordinateRowsResult.rows.map((row) => ({
        coordinateId: Number(row.coordinate_id),
        featureId: Number(row.feature_id),
        geomType: row.geom_type,
        partIndex: Number(row.part_index || 0),
        ringIndex: Number(row.ring_index || 0),
        pointOrder: Number(row.point_order || 0),
        lon: Number(row.lon),
        lat: Number(row.lat),
      }));

    const featureSummary = summaryResult.rows.map((feature) => ({
      featureId: Number(feature.feature_id),
      geomType: feature.geom_type,
      pointCount: Number(feature.point_count || 0),
      centroidLon:
        feature.centroid_lon === null || feature.centroid_lon === undefined
          ? null
          : Number(feature.centroid_lon),
      centroidLat:
        feature.centroid_lat === null || feature.centroid_lat === undefined
          ? null
          : Number(feature.centroid_lat),
      properties: propertiesMap.get(Number(feature.feature_id)) || {},
    }));

    return res.json({
      data: {
        species: {
          id: speciesResult.rows[0].id,
          slug: speciesResult.rows[0].slug,
          commonName: pickLocalizedField(
            speciesResult.rows[0],
            language,
            "common_name",
            "common_name_vi",
            "common_name_en"
          ),
          commonNameVi:
            speciesResult.rows[0].common_name_vi || speciesResult.rows[0].common_name || null,
          commonNameEn: speciesResult.rows[0].common_name_en || null,
        },
        featureSummary,
        coordinates,
      },
      meta: {
        total: Number(countResult.rows[0].total || 0),
        limit,
        offset,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/species/:speciesId/features", requireContributor, async (req, res) => {
  const speciesId = Number(req.params.speciesId);
  if (Number.isNaN(speciesId)) {
    return res.status(400).json({ message: "Invalid species id" });
  }

  const geomType = String(req.body.geomType || "").trim();
  if (!geomType || !ALLOWED_GEOM_TYPES.has(geomType)) {
    return res.status(400).json({ message: "Invalid geomType" });
  }

  const properties = req.body.properties ?? {};
  if (!isPlainObject(properties)) {
    return res.status(400).json({ message: "properties must be an object" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const speciesResult = await client.query(
      "SELECT id FROM species WHERE id = $1 LIMIT 1",
      [speciesId]
    );
    if (speciesResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Species not found" });
    }

    const featureResult = await client.query(
      `INSERT INTO species_features (species_id, geom_type)
       VALUES ($1, $2)
       RETURNING id, species_id, geom_type`,
      [speciesId, geomType]
    );

    const feature = featureResult.rows[0];
    let insertedProperties = 0;

    for (const [key, value] of Object.entries(properties)) {
      if (!String(key).trim()) continue;
      const { propType, propValue } = serializeFeatureProperty(value);
      await client.query(
        `INSERT INTO species_feature_properties (feature_id, prop_key, prop_type, prop_value)
         VALUES ($1, $2, $3, $4)`,
        [feature.id, String(key), propType, propValue]
      );
      insertedProperties += 1;
    }

    await client.query("COMMIT");

    return res.status(201).json({
      data: {
        featureId: Number(feature.id),
        speciesId: Number(feature.species_id),
        geomType: feature.geom_type,
      },
      insertedProperties,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  } finally {
    client.release();
  }
});

router.put("/species/:speciesId/features/:featureId", requireContributor, async (req, res) => {
  const speciesId = Number(req.params.speciesId);
  const featureId = Number(req.params.featureId);

  if (Number.isNaN(speciesId) || Number.isNaN(featureId)) {
    return res.status(400).json({ message: "Invalid id" });
  }

  const hasGeomType = Object.prototype.hasOwnProperty.call(req.body, "geomType");
  const hasProperties = Object.prototype.hasOwnProperty.call(req.body, "properties");
  if (!hasGeomType && !hasProperties) {
    return res.status(400).json({ message: "No fields to update" });
  }

  const geomType = hasGeomType ? String(req.body.geomType || "").trim() : null;
  if (hasGeomType && (!geomType || !ALLOWED_GEOM_TYPES.has(geomType))) {
    return res.status(400).json({ message: "Invalid geomType" });
  }

  const properties = hasProperties ? req.body.properties : null;
  if (hasProperties && !isPlainObject(properties)) {
    return res.status(400).json({ message: "properties must be an object" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const featureResult = await client.query(
      `SELECT id, species_id, geom_type
       FROM species_features
       WHERE id = $1 AND species_id = $2
       LIMIT 1`,
      [featureId, speciesId]
    );

    if (featureResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Feature not found" });
    }

    if (hasGeomType) {
      await client.query(
        `UPDATE species_features
         SET geom_type = $2
         WHERE id = $1`,
        [featureId, geomType]
      );
    }

    let insertedProperties = 0;
    if (hasProperties) {
      await client.query(
        "DELETE FROM species_feature_properties WHERE feature_id = $1",
        [featureId]
      );

      for (const [key, value] of Object.entries(properties || {})) {
        if (!String(key).trim()) continue;
        const { propType, propValue } = serializeFeatureProperty(value);
        await client.query(
          `INSERT INTO species_feature_properties (feature_id, prop_key, prop_type, prop_value)
           VALUES ($1, $2, $3, $4)`,
          [featureId, String(key), propType, propValue]
        );
        insertedProperties += 1;
      }
    }

    await client.query("COMMIT");
    return res.json({
      updated: true,
      featureId,
      speciesId,
      geomType: hasGeomType ? geomType : featureResult.rows[0].geom_type,
      insertedProperties,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  } finally {
    client.release();
  }
});

router.delete("/species/:speciesId/features/:featureId", requireContributor, async (req, res) => {
  const speciesId = Number(req.params.speciesId);
  const featureId = Number(req.params.featureId);

  if (Number.isNaN(speciesId) || Number.isNaN(featureId)) {
    return res.status(400).json({ message: "Invalid id" });
  }

  try {
    const deleted = await query(
      `DELETE FROM species_features
       WHERE id = $1 AND species_id = $2
       RETURNING id`,
      [featureId, speciesId]
    );

    if (deleted.rowCount === 0) {
      return res.status(404).json({ message: "Feature not found" });
    }

    return res.json({ deleted: true, featureId, speciesId });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/species/:speciesId/coordinates", requireContributor, async (req, res) => {
  const speciesId = Number(req.params.speciesId);
  if (Number.isNaN(speciesId)) {
    return res.status(400).json({ message: "Invalid species id" });
  }

  const featureId = Number(req.body.featureId);
  const pointOrder = Number(req.body.pointOrder);
  const partIndex = Number(req.body.partIndex ?? 0);
  const ringIndex = Number(req.body.ringIndex ?? 0);
  const lon = Number(req.body.lon);
  const lat = Number(req.body.lat);

  if (
    Number.isNaN(featureId) ||
    Number.isNaN(pointOrder) ||
    Number.isNaN(partIndex) ||
    Number.isNaN(ringIndex) ||
    Number.isNaN(lon) ||
    Number.isNaN(lat)
  ) {
    return res.status(400).json({ message: "Invalid coordinate payload" });
  }

  if (!isNonNegativeInteger(partIndex) || !isNonNegativeInteger(ringIndex) || !isNonNegativeInteger(pointOrder)) {
    return res.status(400).json({ message: "partIndex/ringIndex/pointOrder must be non-negative integers" });
  }

  if (!isValidLonLat(lon, lat)) {
    return res.status(400).json({ message: "Longitude must be in [-180, 180] and latitude in [-90, 90]" });
  }

  try {
    const featureResult = await query(
      `SELECT id, geom_type
       FROM species_features
       WHERE id = $1 AND species_id = $2
       LIMIT 1`,
      [featureId, speciesId]
    );

    if (featureResult.rowCount === 0) {
      return res.status(404).json({ message: "Feature not found" });
    }

    const duplicateResult = await query(
      `SELECT id
       FROM species_coordinates
       WHERE feature_id = $1
         AND part_index = $2
         AND ring_index = $3
         AND point_order = $4
       LIMIT 1`,
      [featureId, partIndex, ringIndex, pointOrder]
    );

    if (duplicateResult.rowCount > 0) {
      return res.status(409).json({
        message: "Duplicate coordinate order for this feature",
      });
    }

    const inserted = await query(
      `INSERT INTO species_coordinates (feature_id, part_index, ring_index, point_order, lon, lat)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, feature_id, part_index, ring_index, point_order, lon, lat`,
      [featureId, partIndex, ringIndex, pointOrder, lon, lat]
    );

    const row = inserted.rows[0];
    return res.status(201).json({
      data: {
        coordinateId: Number(row.id),
        featureId: Number(row.feature_id),
        geomType: featureResult.rows[0].geom_type,
        partIndex: Number(row.part_index),
        ringIndex: Number(row.ring_index),
        pointOrder: Number(row.point_order),
        lon: Number(row.lon),
        lat: Number(row.lat),
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.put("/species/:speciesId/coordinates/:coordinateId", requireContributor, async (req, res) => {
  const speciesId = Number(req.params.speciesId);
  const coordinateId = Number(req.params.coordinateId);

  if (Number.isNaN(speciesId) || Number.isNaN(coordinateId)) {
    return res.status(400).json({ message: "Invalid id" });
  }

  const hasFeatureId = Object.prototype.hasOwnProperty.call(req.body, "featureId");
  const hasPartIndex = Object.prototype.hasOwnProperty.call(req.body, "partIndex");
  const hasRingIndex = Object.prototype.hasOwnProperty.call(req.body, "ringIndex");
  const hasPointOrder = Object.prototype.hasOwnProperty.call(req.body, "pointOrder");
  const hasLon = Object.prototype.hasOwnProperty.call(req.body, "lon");
  const hasLat = Object.prototype.hasOwnProperty.call(req.body, "lat");

  if (!hasFeatureId && !hasPartIndex && !hasRingIndex && !hasPointOrder && !hasLon && !hasLat) {
    return res.status(400).json({ message: "No fields to update" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const currentResult = await client.query(
      `SELECT
         c.id,
         c.feature_id,
         c.part_index,
         c.ring_index,
         c.point_order,
         c.lon,
         c.lat,
         f.geom_type
       FROM species_coordinates c
       JOIN species_features f ON f.id = c.feature_id
       WHERE c.id = $1 AND f.species_id = $2
       LIMIT 1`,
      [coordinateId, speciesId]
    );

    if (currentResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Coordinate not found" });
    }

    const current = currentResult.rows[0];

    let nextFeatureId = Number(current.feature_id);
    let nextGeomType = current.geom_type;

    if (hasFeatureId) {
      const parsedFeatureId = Number(req.body.featureId);
      if (Number.isNaN(parsedFeatureId)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "Invalid featureId" });
      }

      const targetFeatureResult = await client.query(
        `SELECT id, geom_type
         FROM species_features
         WHERE id = $1 AND species_id = $2
         LIMIT 1`,
        [parsedFeatureId, speciesId]
      );

      if (targetFeatureResult.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Feature not found" });
      }

      nextFeatureId = Number(targetFeatureResult.rows[0].id);
      nextGeomType = targetFeatureResult.rows[0].geom_type;
    }

    const nextPartIndex = hasPartIndex ? Number(req.body.partIndex) : Number(current.part_index);
    const nextRingIndex = hasRingIndex ? Number(req.body.ringIndex) : Number(current.ring_index);
    const nextPointOrder = hasPointOrder ? Number(req.body.pointOrder) : Number(current.point_order);
    const nextLon = hasLon ? Number(req.body.lon) : Number(current.lon);
    const nextLat = hasLat ? Number(req.body.lat) : Number(current.lat);

    if (
      Number.isNaN(nextPartIndex) ||
      Number.isNaN(nextRingIndex) ||
      Number.isNaN(nextPointOrder) ||
      Number.isNaN(nextLon) ||
      Number.isNaN(nextLat)
    ) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Invalid coordinate payload" });
    }

    if (!isNonNegativeInteger(nextPartIndex) || !isNonNegativeInteger(nextRingIndex) || !isNonNegativeInteger(nextPointOrder)) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        message: "partIndex/ringIndex/pointOrder must be non-negative integers",
      });
    }

    if (!isValidLonLat(nextLon, nextLat)) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        message: "Longitude must be in [-180, 180] and latitude in [-90, 90]",
      });
    }

    const duplicateResult = await client.query(
      `SELECT id
       FROM species_coordinates
       WHERE feature_id = $1
         AND part_index = $2
         AND ring_index = $3
         AND point_order = $4
         AND id <> $5
       LIMIT 1`,
      [nextFeatureId, nextPartIndex, nextRingIndex, nextPointOrder, coordinateId]
    );

    if (duplicateResult.rowCount > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        message: "Duplicate coordinate order for this feature",
      });
    }

    const updatedResult = await client.query(
      `UPDATE species_coordinates
       SET feature_id = $2,
           part_index = $3,
           ring_index = $4,
           point_order = $5,
           lon = $6,
           lat = $7
       WHERE id = $1
       RETURNING id, feature_id, part_index, ring_index, point_order, lon, lat`,
      [
        coordinateId,
        nextFeatureId,
        nextPartIndex,
        nextRingIndex,
        nextPointOrder,
        nextLon,
        nextLat,
      ]
    );

    await client.query("COMMIT");

    const row = updatedResult.rows[0];
    return res.json({
      updated: true,
      data: {
        coordinateId: Number(row.id),
        featureId: Number(row.feature_id),
        geomType: nextGeomType,
        partIndex: Number(row.part_index),
        ringIndex: Number(row.ring_index),
        pointOrder: Number(row.point_order),
        lon: Number(row.lon),
        lat: Number(row.lat),
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  } finally {
    client.release();
  }
});

router.delete("/species/:speciesId/coordinates/:coordinateId", requireAdmin, async (req, res) => {
  const speciesId = Number(req.params.speciesId);
  const coordinateId = Number(req.params.coordinateId);

  if (Number.isNaN(speciesId) || Number.isNaN(coordinateId)) {
    return res.status(400).json({ message: "Invalid id" });
  }

  try {
    const deleted = await query(
      `DELETE FROM species_coordinates c
       USING species_features f
       WHERE c.id = $1
         AND c.feature_id = f.id
         AND f.species_id = $2
       RETURNING c.id`,
      [coordinateId, speciesId]
    );

    if (deleted.rowCount === 0) {
      return res.status(404).json({ message: "Coordinate not found" });
    }

    return res.json({ deleted: true, coordinateId, speciesId });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/species", requireAdmin, async (req, res) => {
  const commonNameVi = normalizeOptionalString(req.body.commonNameVi ?? req.body.commonName);
  const commonNameEn = normalizeOptionalString(req.body.commonNameEn);

  if (!commonNameVi && !commonNameEn) {
    return res
      .status(400)
      .json({ message: "One of commonNameVi/commonNameEn (or commonName) is required" });
  }

  const scientificName = normalizeOptionalString(req.body.scientificName);
  const category = normalizeOptionalString(req.body.category);
  const habitatVi = normalizeOptionalString(req.body.habitatVi ?? req.body.habitat);
  const habitatEn = normalizeOptionalString(req.body.habitatEn);
  const dietVi = normalizeOptionalString(req.body.dietVi ?? req.body.diet);
  const dietEn = normalizeOptionalString(req.body.dietEn);
  const descriptionVi = normalizeOptionalString(req.body.descriptionVi ?? req.body.description);
  const descriptionEn = normalizeOptionalString(req.body.descriptionEn);
  const imageUrl = normalizeOptionalString(req.body.imageUrl);
  const conservationStatusVi = normalizeOptionalString(
    req.body.conservationStatusVi ?? req.body.conservationStatus
  );
  const conservationStatusEn = normalizeOptionalString(req.body.conservationStatusEn);
  const distributionVi = normalizeOptionalString(req.body.distributionVi ?? req.body.distribution);
  const distributionEn = normalizeOptionalString(req.body.distributionEn);
  const sourceGroup = normalizeOptionalString(req.body.sourceGroup);

  try {
    const rawSlug = normalizeOptionalString(req.body.slug);
    const seedName = commonNameVi || commonNameEn;
    const finalSlug = rawSlug ? toSlug(rawSlug) : toSlug(seedName);
    const categoryRecord = await ensureCategoryRecord(category);
    const categoryName =
      categoryRecord?.nameVi || categoryRecord?.nameEn || categoryRecord?.name || null;
    const inserted = await query(
      `INSERT INTO species (
        slug,
        common_name,
        common_name_vi,
        common_name_en,
        scientific_name,
        category,
        category_id,
        habitat,
        habitat_vi,
        habitat_en,
        diet,
        diet_vi,
        diet_en,
        description,
        description_vi,
        description_en,
        image_url,
        conservation_status,
        conservation_status_vi,
        conservation_status_en,
        distribution,
        distribution_vi,
        distribution_en,
        source_group
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24
      )
      RETURNING id`,
      [
        finalSlug,
        commonNameVi || commonNameEn,
        commonNameVi,
        commonNameEn,
        scientificName,
        categoryName,
        categoryRecord?.id || null,
        habitatVi,
        habitatVi,
        habitatEn,
        dietVi,
        dietVi,
        dietEn,
        descriptionVi,
        descriptionVi,
        descriptionEn,
        imageUrl,
        conservationStatusVi,
        conservationStatusVi,
        conservationStatusEn,
        distributionVi,
        distributionVi,
        distributionEn,
        sourceGroup,
      ]
    );

    return res.status(201).json({ id: inserted.rows[0].id });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.put("/species/:id", requireContributor, async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    return res.status(400).json({ message: "Invalid species id" });
  }

  const updates = [];
  const values = [];

  try {
    const has = (key) => Object.prototype.hasOwnProperty.call(req.body, key);

    if (Object.prototype.hasOwnProperty.call(req.body, "category")) {
      const categoryRecord = await ensureCategoryRecord(req.body.category);
      const categoryName =
        categoryRecord?.nameVi || categoryRecord?.nameEn || categoryRecord?.name || null;
      updates.push(`category = $${values.length + 1}`);
      values.push(categoryName);
      updates.push(`category_id = $${values.length + 1}`);
      values.push(categoryRecord?.id || null);
    }

    if (has("slug")) {
      const slugValue = normalizeOptionalString(req.body.slug);
      updates.push(`slug = $${values.length + 1}`);
      values.push(slugValue ? toSlug(slugValue) : null);
    }

    const hasCommonVi = has("commonName") || has("commonNameVi");
    const hasCommonEn = has("commonNameEn");
    if (hasCommonVi) {
      const commonNameVi = normalizeOptionalString(req.body.commonNameVi ?? req.body.commonName);
      const commonNameEn = hasCommonEn ? normalizeOptionalString(req.body.commonNameEn) : null;
      updates.push(`common_name_vi = $${values.length + 1}`);
      values.push(commonNameVi);
      updates.push(`common_name = $${values.length + 1}`);
      values.push(commonNameVi ?? commonNameEn);
    }
    if (hasCommonEn) {
      const commonNameEn = normalizeOptionalString(req.body.commonNameEn);
      updates.push(`common_name_en = $${values.length + 1}`);
      values.push(commonNameEn);
    }

    if (has("scientificName")) {
      updates.push(`scientific_name = $${values.length + 1}`);
      values.push(normalizeOptionalString(req.body.scientificName));
    }

    const hasHabitatVi = has("habitat") || has("habitatVi");
    const hasHabitatEn = has("habitatEn");
    if (hasHabitatVi) {
      const habitatVi = normalizeOptionalString(req.body.habitatVi ?? req.body.habitat);
      const habitatEn = hasHabitatEn ? normalizeOptionalString(req.body.habitatEn) : null;
      updates.push(`habitat_vi = $${values.length + 1}`);
      values.push(habitatVi);
      updates.push(`habitat = $${values.length + 1}`);
      values.push(habitatVi ?? habitatEn);
    }
    if (hasHabitatEn) {
      updates.push(`habitat_en = $${values.length + 1}`);
      values.push(normalizeOptionalString(req.body.habitatEn));
    }

    const hasDietVi = has("diet") || has("dietVi");
    const hasDietEn = has("dietEn");
    if (hasDietVi) {
      const dietVi = normalizeOptionalString(req.body.dietVi ?? req.body.diet);
      const dietEn = hasDietEn ? normalizeOptionalString(req.body.dietEn) : null;
      updates.push(`diet_vi = $${values.length + 1}`);
      values.push(dietVi);
      updates.push(`diet = $${values.length + 1}`);
      values.push(dietVi ?? dietEn);
    }
    if (hasDietEn) {
      updates.push(`diet_en = $${values.length + 1}`);
      values.push(normalizeOptionalString(req.body.dietEn));
    }

    const hasDescriptionVi = has("description") || has("descriptionVi");
    const hasDescriptionEn = has("descriptionEn");
    if (hasDescriptionVi) {
      const descriptionVi = normalizeOptionalString(req.body.descriptionVi ?? req.body.description);
      const descriptionEn = hasDescriptionEn
        ? normalizeOptionalString(req.body.descriptionEn)
        : null;
      updates.push(`description_vi = $${values.length + 1}`);
      values.push(descriptionVi);
      updates.push(`description = $${values.length + 1}`);
      values.push(descriptionVi ?? descriptionEn);
    }
    if (hasDescriptionEn) {
      updates.push(`description_en = $${values.length + 1}`);
      values.push(normalizeOptionalString(req.body.descriptionEn));
    }

    if (has("imageUrl")) {
      updates.push(`image_url = $${values.length + 1}`);
      values.push(normalizeOptionalString(req.body.imageUrl));
    }

    const hasConservationVi = has("conservationStatus") || has("conservationStatusVi");
    const hasConservationEn = has("conservationStatusEn");
    if (hasConservationVi) {
      const conservationVi = normalizeOptionalString(
        req.body.conservationStatusVi ?? req.body.conservationStatus
      );
      const conservationEn = hasConservationEn
        ? normalizeOptionalString(req.body.conservationStatusEn)
        : null;
      updates.push(`conservation_status_vi = $${values.length + 1}`);
      values.push(conservationVi);
      updates.push(`conservation_status = $${values.length + 1}`);
      values.push(conservationVi ?? conservationEn);
    }
    if (hasConservationEn) {
      updates.push(`conservation_status_en = $${values.length + 1}`);
      values.push(normalizeOptionalString(req.body.conservationStatusEn));
    }

    const hasDistributionVi = has("distribution") || has("distributionVi");
    const hasDistributionEn = has("distributionEn");
    if (hasDistributionVi) {
      const distributionVi = normalizeOptionalString(req.body.distributionVi ?? req.body.distribution);
      const distributionEn = hasDistributionEn
        ? normalizeOptionalString(req.body.distributionEn)
        : null;
      updates.push(`distribution_vi = $${values.length + 1}`);
      values.push(distributionVi);
      updates.push(`distribution = $${values.length + 1}`);
      values.push(distributionVi ?? distributionEn);
    }
    if (hasDistributionEn) {
      updates.push(`distribution_en = $${values.length + 1}`);
      values.push(normalizeOptionalString(req.body.distributionEn));
    }

    if (has("sourceGroup")) {
      updates.push(`source_group = $${values.length + 1}`);
      values.push(normalizeOptionalString(req.body.sourceGroup));
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: "No fields to update" });
    }

    values.push(id);

    const result = await query(
      `UPDATE species
       SET ${updates.join(", ")}, updated_at = now()
       WHERE id = $${values.length}
       RETURNING id`,
      values
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Species not found" });
    }

    return res.json({ updated: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.delete("/species/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    return res.status(400).json({ message: "Invalid species id" });
  }

  try {
    const result = await query("DELETE FROM species WHERE id = $1", [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Species not found" });
    }

    const folder = path.resolve(config.uploadRoot, "species", String(id));
    await fsPromises.rm(folder, { recursive: true, force: true });

    return res.json({ deleted: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/species/:id/images", async (req, res) => {
  const speciesId = Number(req.params.id);
  if (Number.isNaN(speciesId)) {
    return res.status(400).json({ message: "Invalid species id" });
  }

  try {
    const images = await loadSpeciesImages(speciesId);
    return res.json({ data: images });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/species/:id/images", requireContributor, imageUpload.array("images", 10), async (req, res) => {
  const speciesId = Number(req.params.id);
  if (Number.isNaN(speciesId)) {
    return res.status(400).json({ message: "Invalid species id" });
  }

  const files = req.files || [];
  if (files.length === 0) {
    return res.status(400).json({ message: "No images uploaded" });
  }

  try {
    const species = await query("SELECT id, image_url FROM species WHERE id = $1 LIMIT 1", [speciesId]);
    if (species.rowCount === 0) {
      return res.status(404).json({ message: "Species not found" });
    }

    const countResult = await query(
      "SELECT COUNT(*)::INT AS total FROM species_images WHERE species_id = $1",
      [speciesId]
    );
    const currentTotal = countResult.rows[0].total;

    if (currentTotal + files.length > 10) {
      for (const file of files) {
        await fsPromises.rm(file.path, { force: true });
      }
      return res.status(400).json({ message: "Each species can store maximum 10 images" });
    }

    let nextOrder = currentTotal;
    for (const file of files) {
      const urlPath = `/uploads/species/${speciesId}/${file.filename}`;
      await query(
        `INSERT INTO species_images (species_id, file_name, file_path, mime_type, file_size, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [speciesId, file.originalname, urlPath, file.mimetype, file.size, nextOrder]
      );
      nextOrder += 1;
    }

    if (!species.rows[0].image_url) {
      const firstImage = await query(
        `SELECT file_path FROM species_images WHERE species_id = $1 ORDER BY sort_order ASC, id ASC LIMIT 1`,
        [speciesId]
      );
      if (firstImage.rowCount > 0) {
        await query(`UPDATE species SET image_url = $2, updated_at = now() WHERE id = $1`, [speciesId, firstImage.rows[0].file_path]);
      }
    }

    const images = await loadSpeciesImages(speciesId);
    return res.status(201).json({ data: images });
  } catch (error) {
    console.error(error);
    for (const file of files) {
      await fsPromises.rm(file.path, { force: true });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.patch("/species/:speciesId/images/:imageId/primary", requireContributor, async (req, res) => {
  const speciesId = Number(req.params.speciesId);
  const imageId = Number(req.params.imageId);

  if (Number.isNaN(speciesId) || Number.isNaN(imageId)) {
    return res.status(400).json({ message: "Invalid id" });
  }

  try {
    const image = await query(
      "SELECT id, file_path FROM species_images WHERE id = $1 AND species_id = $2 LIMIT 1",
      [imageId, speciesId]
    );

    if (image.rowCount === 0) {
      return res.status(404).json({ message: "Image not found" });
    }

    await query("UPDATE species SET image_url = $2, updated_at = now() WHERE id = $1", [speciesId, image.rows[0].file_path]);
    return res.json({ updated: true, imageUrl: image.rows[0].file_path });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.delete("/species/:speciesId/images/:imageId", requireContributor, async (req, res) => {
  const speciesId = Number(req.params.speciesId);
  const imageId = Number(req.params.imageId);

  if (Number.isNaN(speciesId) || Number.isNaN(imageId)) {
    return res.status(400).json({ message: "Invalid id" });
  }

  try {
    const image = await query(
      "SELECT id, file_path FROM species_images WHERE id = $1 AND species_id = $2 LIMIT 1",
      [imageId, speciesId]
    );

    if (image.rowCount === 0) {
      return res.status(404).json({ message: "Image not found" });
    }

    await query("DELETE FROM species_images WHERE id = $1", [imageId]);

    const diskPath = path.resolve(config.uploadRoot, image.rows[0].file_path.replace(/^\/uploads\//, ""));
    await fsPromises.rm(diskPath, { force: true });

    const currentSpecies = await query("SELECT image_url FROM species WHERE id = $1", [speciesId]);
    if (currentSpecies.rowCount > 0 && currentSpecies.rows[0].image_url === image.rows[0].file_path) {
      const nextImage = await query(
        "SELECT file_path FROM species_images WHERE species_id = $1 ORDER BY sort_order ASC, id ASC LIMIT 1",
        [speciesId]
      );
      await query(
        "UPDATE species SET image_url = $2, updated_at = now() WHERE id = $1",
        [speciesId, nextImage.rowCount > 0 ? nextImage.rows[0].file_path : null]
      );
    }

    const images = await loadSpeciesImages(speciesId);
    return res.json({ deleted: true, data: images });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.post(
  "/species/:id/geojson",
  [body("geojson").exists(), body("replaceExisting").optional().isBoolean()],
  async (req, res) => {
    if (validationError(res, req)) return;

    const speciesId = Number(req.params.id);
    if (Number.isNaN(speciesId)) {
      return res.status(400).json({ message: "Invalid species id" });
    }

    const replaceExisting = req.body.replaceExisting !== false;
    let geojsonPayload = req.body.geojson;

    if (typeof geojsonPayload === "string") {
      try {
        geojsonPayload = JSON.parse(geojsonPayload);
      } catch (_error) {
        return res.status(400).json({ message: "Invalid geojson payload" });
      }
    }

    if (
      !geojsonPayload ||
      geojsonPayload.type !== "FeatureCollection" ||
      !Array.isArray(geojsonPayload.features)
    ) {
      return res.status(400).json({ message: "GeoJSON must be a FeatureCollection" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const species = await client.query("SELECT id FROM species WHERE id = $1", [speciesId]);
      if (species.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Species not found" });
      }

      if (replaceExisting) {
        await client.query("DELETE FROM species_features WHERE species_id = $1", [speciesId]);
      }

      let insertedFeatures = 0;
      let insertedCoordinates = 0;
      let insertedProperties = 0;

      for (const feature of geojsonPayload.features) {
        if (!feature?.geometry?.type || !feature?.geometry?.coordinates) {
          continue;
        }

        const featureInsert = await client.query(
          `INSERT INTO species_features (species_id, geom_type) VALUES ($1, $2) RETURNING id`,
          [speciesId, feature.geometry.type]
        );

        const featureId = featureInsert.rows[0].id;
        insertedFeatures += 1;

        const coordinateRows = geometryToCoordinateRows(feature.geometry.type, feature.geometry.coordinates);
        for (const row of coordinateRows) {
          await client.query(
            `INSERT INTO species_coordinates (feature_id, part_index, ring_index, point_order, lon, lat)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [featureId, row.partIndex, row.ringIndex, row.pointOrder, row.lon, row.lat]
          );
          insertedCoordinates += 1;
        }

        for (const [key, value] of Object.entries(feature.properties || {})) {
          const { propType, propValue } = serializeFeatureProperty(value);

          await client.query(
            `INSERT INTO species_feature_properties (feature_id, prop_key, prop_type, prop_value)
             VALUES ($1, $2, $3, $4)`,
            [featureId, key, propType, propValue]
          );
          insertedProperties += 1;
        }
      }

      await client.query("COMMIT");
      return res.status(201).json({
        ok: true,
        insertedFeatures,
        insertedCoordinates,
        insertedProperties,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(error);
      return res.status(500).json({ message: "Internal server error" });
    } finally {
      client.release();
    }
  }
);

router.post(
  "/species/:id/feature",
  [body("geomType").isString().isLength({ min: 1 }), body("coordinates").exists()],
  async (req, res) => {
    if (validationError(res, req)) return;

    const speciesId = Number(req.params.id);
    if (Number.isNaN(speciesId)) {
      return res.status(400).json({ message: "Invalid species id" });
    }

    const { geomType, coordinates, properties } = req.body;
    const propEntries = Object.entries(properties || {});

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const species = await client.query("SELECT id FROM species WHERE id = $1", [speciesId]);
      if (species.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Species not found" });
      }

      const feature = await client.query(
        `INSERT INTO species_features (species_id, geom_type) VALUES ($1, $2) RETURNING id`,
        [speciesId, geomType]
      );

      const featureId = feature.rows[0].id;
      const rows = geometryToCoordinateRows(geomType, coordinates);

      for (const row of rows) {
        await client.query(
          `INSERT INTO species_coordinates (feature_id, part_index, ring_index, point_order, lon, lat)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [featureId, row.partIndex, row.ringIndex, row.pointOrder, row.lon, row.lat]
        );
      }

      for (const [key, value] of propEntries) {
        const { propType, propValue } = serializeFeatureProperty(value);

        await client.query(
          `INSERT INTO species_feature_properties (feature_id, prop_key, prop_type, prop_value)
           VALUES ($1, $2, $3, $4)`,
          [featureId, key, propType, propValue]
        );
      }

      await client.query("COMMIT");
      return res.status(201).json({ featureId, insertedCoordinates: rows.length, insertedProperties: propEntries.length });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(error);
      return res.status(500).json({ message: "Internal server error" });
    } finally {
      client.release();
    }
  }
);

router.post(
  "/import",
  [
    body("filePath").optional().isString(),
    body("dirPath").optional().isString(),
    body("truncate").optional().isBoolean(),
  ],
  async (req, res) => {
    if (validationError(res, req)) return;

    const { filePath, dirPath, defaultCategory, truncate } = req.body;

    if (!filePath && !dirPath) {
      return res.status(400).json({ message: "Provide filePath or dirPath" });
    }

    try {
      if (filePath) {
        const result = await importGeoJsonFile(filePath, { defaultCategory, truncate: !!truncate });
        return res.json({ ok: true, result });
      }

      const result = await importGeoJsonDirectory(dirPath, { defaultCategory, truncate: !!truncate });
      return res.json({ ok: true, result });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: error.message || "Import failed" });
    }
  }
);

export default router;
