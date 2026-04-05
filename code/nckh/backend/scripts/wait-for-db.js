import path from "node:path";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: path.resolve(".env") });

const { Pool } = pg;
const timeoutMs = Number(process.env.DB_WAIT_TIMEOUT_MS || 120000);
const intervalMs = Number(process.env.DB_WAIT_INTERVAL_MS || 2000);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function canConnect(connectionString) {
  const pool = new Pool({ connectionString });
  try {
    await pool.query("SELECT 1");
    return true;
  } catch (_error) {
    return false;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
  }

  const startedAt = Date.now();
  let attempt = 0;

  while (Date.now() - startedAt <= timeoutMs) {
    attempt += 1;
    const ok = await canConnect(connectionString);
    if (ok) {
      console.log("Database is ready.");
      return;
    }

    console.log(
      `Waiting for database... attempt ${attempt} (elapsed ${Date.now() - startedAt}ms)`,
    );
    await sleep(intervalMs);
  }

  throw new Error(
    `Database is not ready after ${timeoutMs}ms. Increase DB_WAIT_TIMEOUT_MS if needed.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
