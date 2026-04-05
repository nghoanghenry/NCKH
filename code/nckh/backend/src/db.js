import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

if (!config.databaseUrl) {
  // Keep startup explicit if DB URL is missing.
  // Server can still start for health checks in some deploy flows.
  console.warn("DATABASE_URL is not set. DB queries will fail until configured.");
}

export const pool = new Pool({
  connectionString: config.databaseUrl,
});

export async function query(text, params = []) {
  return pool.query(text, params);
}
