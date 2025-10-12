// --- normalize_species_strict.js ---
// Chuẩn hóa khóa loài trong species_info.json:
// 1. Bỏ dấu tiếng Việt
// 2. Viết thường toàn bộ
// 3. Thay khoảng trắng và ký tự đặc biệt bằng "_"

import fs from "fs";

// --- Hàm bỏ dấu & chuẩn hóa tên ---
function normalizeName(name) {
  return name
    .normalize("NFD") // Tách ký tự có dấu
    .replace(/[\u0300-\u036f]/g, "") // Xóa toàn bộ dấu
    .replace(/đ/g, "d") // thay đ
    .replace(/Đ/g, "d")
    .trim()
    .replace(/\s+/g, "_") // thay khoảng trắng thành _
    .replace(/[^\w]/g, "_") // thay ký tự đặc biệt thành _
    .toLowerCase();
}

// --- Đọc file species_info.json ---
const path = "./species_info.json";
const raw = fs.readFileSync(path, "utf8");
const data = JSON.parse(raw);

const newData = {};

for (const [key, value] of Object.entries(data)) {
  const newKey = normalizeName(key);
  value.name = value.name?.trim() || key;
  newData[newKey] = value;
}

fs.writeFileSync(
  "./species_info_normalized.json",
  JSON.stringify(newData, null, 2),
  "utf8"
);

console.log("✅ Đã tạo file species_info_normalized.json (bỏ dấu + dùng _) thành công!");
