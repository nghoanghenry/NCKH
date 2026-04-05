import dotenv from "dotenv";
import path from "node:path";
import bcrypt from "bcryptjs";
import { pool } from "../src/db.js";

dotenv.config({ path: path.resolve(".env") });

async function main() {
  const email = process.env.ADMIN_EMAIL || "admin@nckh.local";
  const password = process.env.ADMIN_PASSWORD || "Admin@123456";
  const fullName = process.env.ADMIN_FULL_NAME || "Default Admin";
  const rounds = Number(process.env.BCRYPT_SALT_ROUNDS || 10);
  const resetPassword = String(process.env.ADMIN_RESET_PASSWORD || "false").toLowerCase() === "true";

  const existed = await pool.query("SELECT id FROM users WHERE email = $1 LIMIT 1", [email]);
  if (existed.rowCount > 0) {
    if (resetPassword) {
      const passwordHash = await bcrypt.hash(password, rounds);
      await pool.query(
        "UPDATE users SET is_admin = TRUE, updated_at = now(), full_name = COALESCE(full_name, $2), password_hash = $3 WHERE email = $1",
        [email, fullName, passwordHash]
      );
      console.log(`Admin user password was reset: ${email}`);
    } else {
      await pool.query(
        "UPDATE users SET is_admin = TRUE, updated_at = now(), full_name = COALESCE(full_name, $2) WHERE email = $1",
        [email, fullName]
      );
      console.log(`Admin user already exists: ${email}`);
    }
    return;
  }

  const passwordHash = await bcrypt.hash(password, rounds);
  await pool.query(
    `INSERT INTO users (email, password_hash, full_name, is_admin)
     VALUES ($1, $2, $3, TRUE)`,
    [email, passwordHash, fullName]
  );

  console.log(`Created default admin: ${email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
