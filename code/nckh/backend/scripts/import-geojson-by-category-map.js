import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import dotenv from "dotenv";
import { importGeoJsonFile } from "../src/utils/importGeoJsonFile.js";

dotenv.config({ path: path.resolve(".env") });

function normalizeMappingEntry(entry) {
  const category = String(entry?.category || entry?.categoryName || "").trim();
  const filePath = String(entry?.filePath || entry?.geojsonFile || entry?.file || "").trim();
  const sourceGroup = entry?.sourceGroup ? String(entry.sourceGroup).trim() : null;

  if (!category) {
    throw new Error("Invalid mapping entry: missing category");
  }

  if (!filePath) {
    throw new Error(`Invalid mapping entry for category '${category}': missing filePath`);
  }

  return {
    category,
    filePath,
    sourceGroup,
  };
}

async function loadMappingFile(configPath) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Mapping file not found: ${configPath}`);
  }

  const moduleUrl = pathToFileURL(configPath).href;
  const loaded = await import(moduleUrl);
  const list = loaded.default || loaded.mappings || loaded.CATEGORY_FILE_MAP;

  if (!Array.isArray(list)) {
    throw new Error("Mapping file must export an array (default export)");
  }

  return list.map(normalizeMappingEntry);
}

async function main() {
  const mappingArg = process.argv[2] || "scripts/import-category-file-map.js";
  const truncateArg = String(process.argv[3] || "").toLowerCase();
  const truncate = truncateArg === "truncate";

  const mappingPath = path.resolve(mappingArg);
  const mappingDir = path.dirname(mappingPath);
  const mappings = await loadMappingFile(mappingPath);

  const results = [];
  let importedTotal = 0;
  let alreadyTruncated = false;

  for (const item of mappings) {
    const absoluteGeoJsonPath = path.isAbsolute(item.filePath)
      ? item.filePath
      : path.resolve(mappingDir, item.filePath);

    const result = await importGeoJsonFile(absoluteGeoJsonPath, {
      defaultCategory: item.category,
      sourceGroup: item.sourceGroup || path.basename(absoluteGeoJsonPath),
      truncate: truncate && !alreadyTruncated,
    });

    alreadyTruncated = alreadyTruncated || truncate;
    importedTotal += result.imported;
    results.push({
      category: item.category,
      filePath: absoluteGeoJsonPath,
      imported: result.imported,
    });
  }

  console.log(
    JSON.stringify(
      {
        mappingFile: mappingPath,
        processedFiles: results.length,
        totalImported: importedTotal,
        results,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
