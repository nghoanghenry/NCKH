import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { config } from "./config.js";
import authRoutes from "./routes/auth.routes.js";
import speciesRoutes from "./routes/species.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import { requireAuth } from "./middleware/auth.js";

export function createApp() {
  const app = express();

  // Required when app is behind nginx so middleware uses the correct client IP.
  app.set("trust proxy", config.trustProxy);

  const allowAllOrigins = config.corsOrigins.includes("*");

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowAllOrigins || config.corsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        const corsError = new Error(`Not allowed by CORS: ${origin}`);
        corsError.status = 403;
        callback(corsError);
      },
      credentials: true,
    })
  );
  app.use(express.json({ limit: "10mb" }));
  app.use(morgan("dev"));
  app.use("/uploads", express.static(path.resolve(config.uploadRoot)));

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/auth", authLimiter, authRoutes);
  app.use("/api/species", speciesRoutes);
  app.use("/api/admin", requireAuth, adminRoutes);

  app.use((req, res) => {
    res.status(404).json({ message: `Route not found: ${req.method} ${req.path}` });
  });

  app.use((err, _req, res, _next) => {
    console.error(err);

    if (err?.status === 403 && String(err?.message || "").startsWith("Not allowed by CORS")) {
      return res.status(403).json({ message: "CORS origin is not allowed" });
    }

    // express.json() raises this when request body is malformed JSON
    if (err?.type === "entity.parse.failed") {
      return res.status(400).json({ message: "Invalid JSON payload" });
    }

    if (Number.isInteger(err?.status) && err.status >= 400 && err.status < 500) {
      return res.status(err.status).json({ message: err.message || "Bad request" });
    }

    res.status(500).json({ message: "Unhandled server error" });
  });

  return app;
}
