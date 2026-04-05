import dotenv from "dotenv";
import path from "node:path";

dotenv.config();

const corsRaw = process.env.CORS_ORIGIN || "*";
const corsOrigins = corsRaw
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

export const config = {
  port: Number(process.env.PORT || 4000),
  databaseUrl: process.env.DATABASE_URL || "",
  jwtSecret: process.env.JWT_SECRET || "change_me",
  bcryptSaltRounds: Number(process.env.BCRYPT_SALT_ROUNDS || 10),
  corsOrigins,
  uploadRoot: process.env.UPLOAD_ROOT || path.resolve("uploads"),
};
