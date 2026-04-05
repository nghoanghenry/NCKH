import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: path.resolve(".env") });

const { Pool } = pg;

async function main() {
  const sqlPath = path.resolve("scripts/schema.sql");
  const sql = fs.readFileSync(sqlPath, "utf-8");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    await pool.query(sql);
    console.log("Schema applied successfully.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
