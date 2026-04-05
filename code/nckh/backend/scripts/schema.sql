CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(120),
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS species_categories (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(120) UNIQUE NOT NULL,
    name_vi VARCHAR(120),
    name_en VARCHAR(120),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS species (
    id BIGSERIAL PRIMARY KEY,
    slug VARCHAR(180) UNIQUE NOT NULL,
    common_name VARCHAR(180) NOT NULL,
    common_name_vi VARCHAR(180),
    common_name_en VARCHAR(180),
    scientific_name VARCHAR(180),
    category VARCHAR(80),
    category_id BIGINT REFERENCES species_categories (id) ON DELETE SET NULL,
    habitat TEXT,
    habitat_vi TEXT,
    habitat_en TEXT,
    diet TEXT,
    diet_vi TEXT,
    diet_en TEXT,
    description TEXT,
    description_vi TEXT,
    description_en TEXT,
    image_url TEXT,
    conservation_status VARCHAR(120),
    conservation_status_vi VARCHAR(120),
    conservation_status_en VARCHAR(120),
    distribution TEXT,
    distribution_vi TEXT,
    distribution_en TEXT,
    source_group VARCHAR(120),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_species_category ON species (category);

CREATE INDEX IF NOT EXISTS idx_species_categories_name ON species_categories (name);

CREATE INDEX IF NOT EXISTS idx_species_categories_name_vi ON species_categories (name_vi);

CREATE INDEX IF NOT EXISTS idx_species_categories_name_en ON species_categories (name_en);

ALTER TABLE species ADD COLUMN IF NOT EXISTS category_id BIGINT;

ALTER TABLE species_categories
ADD COLUMN IF NOT EXISTS name_vi VARCHAR(120);

ALTER TABLE species_categories
ADD COLUMN IF NOT EXISTS name_en VARCHAR(120);

ALTER TABLE species
ADD COLUMN IF NOT EXISTS common_name_vi VARCHAR(180);

ALTER TABLE species
ADD COLUMN IF NOT EXISTS common_name_en VARCHAR(180);

ALTER TABLE species ADD COLUMN IF NOT EXISTS habitat_vi TEXT;

ALTER TABLE species ADD COLUMN IF NOT EXISTS habitat_en TEXT;

ALTER TABLE species ADD COLUMN IF NOT EXISTS diet_vi TEXT;

ALTER TABLE species ADD COLUMN IF NOT EXISTS diet_en TEXT;

ALTER TABLE species ADD COLUMN IF NOT EXISTS description_vi TEXT;

ALTER TABLE species ADD COLUMN IF NOT EXISTS description_en TEXT;

ALTER TABLE species
ADD COLUMN IF NOT EXISTS conservation_status_vi VARCHAR(120);

ALTER TABLE species
ADD COLUMN IF NOT EXISTS conservation_status_en VARCHAR(120);

ALTER TABLE species ADD COLUMN IF NOT EXISTS distribution_vi TEXT;

ALTER TABLE species ADD COLUMN IF NOT EXISTS distribution_en TEXT;

UPDATE species
SET
    common_name_vi = COALESCE(common_name_vi, common_name),
    habitat_vi = COALESCE(habitat_vi, habitat),
    diet_vi = COALESCE(diet_vi, diet),
    description_vi = COALESCE(description_vi, description),
    conservation_status_vi = COALESCE(
        conservation_status_vi,
        conservation_status
    ),
    distribution_vi = COALESCE(distribution_vi, distribution);

UPDATE species_categories SET name_vi = COALESCE(name_vi, name);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'species_category_id_fkey'
    ) THEN
        ALTER TABLE species
        ADD CONSTRAINT species_category_id_fkey FOREIGN KEY (category_id) REFERENCES species_categories (id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_species_category_id ON species (category_id);

INSERT INTO
    species_categories (name, name_vi)
SELECT DISTINCT
    TRIM(s.category) AS category_name,
    TRIM(s.category) AS category_name_vi
FROM species s
WHERE
    s.category IS NOT NULL
    AND TRIM(s.category) <> ''
ON CONFLICT (name) DO
UPDATE
SET
    name_vi = COALESCE(
        species_categories.name_vi,
        EXCLUDED.name_vi
    ),
    updated_at = now();

UPDATE species s
SET
    category_id = c.id
FROM species_categories c
WHERE
    s.category_id IS NULL
    AND s.category IS NOT NULL
    AND TRIM(s.category) <> ''
    AND c.name = TRIM(s.category);

INSERT INTO
    species_categories (name, name_vi, name_en)
VALUES (
        'Bo Sat',
        'Bo Sat',
        'Reptiles'
    )
ON CONFLICT (name) DO
UPDATE
SET
    name_vi = COALESCE(
        species_categories.name_vi,
        EXCLUDED.name_vi
    ),
    name_en = COALESCE(
        species_categories.name_en,
        EXCLUDED.name_en
    ),
    updated_at = now();

DELETE FROM species
WHERE
    LOWER(TRIM(COALESCE(category, ''))) IN ('thuc vat', 'thucvat')
    OR category_id IN (
        SELECT id
        FROM species_categories
        WHERE
            LOWER(TRIM(COALESCE(name, ''))) IN ('thuc vat', 'thucvat')
            OR LOWER(TRIM(COALESCE(name_vi, ''))) IN ('thuc vat', 'thucvat')
            OR LOWER(TRIM(COALESCE(name_en, ''))) IN ('plant', 'plants')
    );

UPDATE species
SET
    category = 'Bo Sat',
    category_id = (
        SELECT id
        FROM species_categories
        WHERE
            name = 'Bo Sat'
        LIMIT 1
    ),
    updated_at = now()
WHERE
    LOWER(TRIM(COALESCE(category, ''))) IN ('khac', 'other')
    OR category_id IN (
        SELECT id
        FROM species_categories
        WHERE
            LOWER(TRIM(COALESCE(name, ''))) IN ('khac', 'other')
            OR LOWER(TRIM(COALESCE(name_vi, ''))) IN ('khac')
            OR LOWER(TRIM(COALESCE(name_en, ''))) IN ('other')
    );

DELETE FROM species_categories
WHERE
    LOWER(TRIM(COALESCE(name, ''))) IN (
        'thuc vat',
        'thucvat',
        'khac',
        'other'
    )
    OR LOWER(TRIM(COALESCE(name_vi, ''))) IN ('thuc vat', 'thucvat', 'khac')
    OR LOWER(TRIM(COALESCE(name_en, ''))) IN ('plant', 'plants', 'other');

CREATE INDEX IF NOT EXISTS idx_species_common_name ON species (common_name);

CREATE INDEX IF NOT EXISTS idx_species_common_name_vi ON species (common_name_vi);

CREATE INDEX IF NOT EXISTS idx_species_common_name_en ON species (common_name_en);

CREATE TABLE IF NOT EXISTS species_characteristics (
    id BIGSERIAL PRIMARY KEY,
    species_id BIGINT NOT NULL REFERENCES species (id) ON DELETE CASCADE,
    sort_order INT NOT NULL DEFAULT 0,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS species_threats (
    id BIGSERIAL PRIMARY KEY,
    species_id BIGINT NOT NULL REFERENCES species (id) ON DELETE CASCADE,
    sort_order INT NOT NULL DEFAULT 0,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS species_features (
    id BIGSERIAL PRIMARY KEY,
    species_id BIGINT NOT NULL REFERENCES species (id) ON DELETE CASCADE,
    geom_type VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_geom_type CHECK (
        geom_type IN (
            'Point',
            'LineString',
            'Polygon',
            'MultiLineString',
            'MultiPolygon'
        )
    )
);

CREATE TABLE IF NOT EXISTS species_coordinates (
    id BIGSERIAL PRIMARY KEY,
    feature_id BIGINT NOT NULL REFERENCES species_features (id) ON DELETE CASCADE,
    part_index INT NOT NULL DEFAULT 0,
    ring_index INT NOT NULL DEFAULT 0,
    point_order INT NOT NULL,
    lon DOUBLE PRECISION NOT NULL,
    lat DOUBLE PRECISION NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_species_coordinates_feature ON species_coordinates (feature_id);

CREATE INDEX IF NOT EXISTS idx_species_coordinates_lon_lat ON species_coordinates (lon, lat);

CREATE TABLE IF NOT EXISTS species_feature_properties (
    id BIGSERIAL PRIMARY KEY,
    feature_id BIGINT NOT NULL REFERENCES species_features (id) ON DELETE CASCADE,
    prop_key TEXT NOT NULL,
    prop_type VARCHAR(20) NOT NULL DEFAULT 'string',
    prop_value TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_species_feature_properties_feature ON species_feature_properties (feature_id);

CREATE INDEX IF NOT EXISTS idx_species_feature_properties_key ON species_feature_properties (prop_key);

CREATE TABLE IF NOT EXISTS species_images (
    id BIGSERIAL PRIMARY KEY,
    species_id BIGINT NOT NULL REFERENCES species (id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    file_path TEXT NOT NULL,
    mime_type VARCHAR(120),
    file_size BIGINT,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_species_images_species ON species_images (species_id);

CREATE INDEX IF NOT EXISTS idx_species_images_sort ON species_images (species_id, sort_order, id);