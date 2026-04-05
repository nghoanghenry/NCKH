import path from "node:path";
import dotenv from "dotenv";
import { importGeoJsonDirectory, importGeoJsonFile } from "../src/utils/importGeoJsonFile.js";

dotenv.config({ path: path.resolve(".env") });

async function main() {
  const inputPath = process.argv[2];
  const category = process.argv[3];
  const truncateArg = process.argv[4];
  const truncate = String(truncateArg || "").toLowerCase() === "truncate";

  if (!inputPath) {
    console.error("Usage: node scripts/import-geojson-to-coordinates.js <file-or-dir> [defaultCategory] [truncate]");
    process.exit(1);
  }

  const resolved = path.resolve(inputPath);

  if (resolved.toLowerCase().endsWith(".geojson") || resolved.toLowerCase().endsWith(".json")) {
    const result = await importGeoJsonFile(resolved, { defaultCategory: category, truncate });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const result = await importGeoJsonDirectory(resolved, { defaultCategory: category, truncate });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
