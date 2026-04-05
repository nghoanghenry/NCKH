import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { body, validationResult } from "express-validator";
import { query } from "../db.js";
import { config } from "../config.js";

const router = express.Router();

function issueToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      isAdmin: user.is_admin,
    },
    config.jwtSecret,
    { expiresIn: "1d" }
  );
}

router.post(
  "/register",
  [
    body("email").isEmail().withMessage("email is invalid"),
    body("password").isLength({ min: 6 }).withMessage("password must be at least 6 chars"),
    body("fullName").optional().isString(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, fullName } = req.body;

    try {
      const exists = await query("SELECT id FROM users WHERE email = $1", [email]);
      if (exists.rowCount > 0) {
        return res.status(409).json({ message: "Email already exists" });
      }

      const hash = await bcrypt.hash(password, config.bcryptSaltRounds);
      const inserted = await query(
        `INSERT INTO users (email, password_hash, full_name)
         VALUES ($1, $2, $3)
         RETURNING id, email, full_name, is_admin`,
        [email, hash, fullName || null]
      );

      const user = inserted.rows[0];
      const token = issueToken(user);

      return res.status(201).json({
        token,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.full_name,
          isAdmin: user.is_admin,
        },
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.post(
  "/login",
  [
    body("email").isEmail().withMessage("email is invalid"),
    body("password").isString().withMessage("password is required"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    try {
      const userResult = await query(
        `SELECT id, email, password_hash, full_name, is_admin
         FROM users
         WHERE email = $1`,
        [email]
      );

      if (userResult.rowCount === 0) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      const user = userResult.rows[0];
      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      const token = issueToken(user);
      return res.json({
        token,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.full_name,
          isAdmin: user.is_admin,
        },
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

export default router;
