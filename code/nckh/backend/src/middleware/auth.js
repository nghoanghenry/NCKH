import jwt from "jsonwebtoken";
import { config } from "../config.js";

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = payload;
    return next();
  } catch (_error) {
    return res.status(401).json({ message: "Invalid token" });
  }
}

export function requireAdmin(req, res, next) {
  const role = req.user?.role;
  if (role !== "ADMIN" && !req.user?.isAdmin) {
    return res.status(403).json({ message: "Forbidden" });
  }
  return next();
}

export function requireContributor(req, res, next) {
  const role = req.user?.role;
  if (role !== "ADMIN" && role !== "CONTRIBUTOR" && !req.user?.isAdmin) {
    return res.status(403).json({ message: "Forbidden" });
  }
  return next();
}
