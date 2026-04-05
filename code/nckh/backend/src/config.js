import dotenv from "dotenv";
import path from "node:path";

dotenv.config();

const corsRaw = process.env.CORS_ORIGIN || "*";
const corsOrigins = corsRaw
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

function parseTrustProxy(rawValue) {
  const raw = String(rawValue ?? "1").trim().toLowerCase();
  if (["false", "0", "off", "no"].includes(raw)) return false;
  if (["true", "on", "yes"].includes(raw)) return true;

  const asNumber = Number(raw);
  if (Number.isInteger(asNumber) && asNumber >= 0) {
    return asNumber;
  }

  // Accept named proxy settings like loopback/linklocal/uniquelocal if provided.
  return raw;
}

export const config = {
  port: Number(process.env.PORT || 4000),
  databaseUrl: process.env.DATABASE_URL || "",
  jwtSecret: process.env.JWT_SECRET || "change_me",
  bcryptSaltRounds: Number(process.env.BCRYPT_SALT_ROUNDS || 10),
  corsOrigins,
  uploadRoot: process.env.UPLOAD_ROOT || path.resolve("uploads"),
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
};
