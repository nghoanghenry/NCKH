import { createApp } from "./app.js";
import { config } from "./config.js";
import fs from "node:fs";
import path from "node:path";

const app = createApp();

fs.mkdirSync(path.resolve(config.uploadRoot), { recursive: true });

app.listen(config.port, () => {
  console.log(`Backend is running on http://localhost:${config.port}`);
});
