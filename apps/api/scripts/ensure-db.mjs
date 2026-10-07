/**
 * 兼容处理：部分 macOS 环境下 Prisma 无法自动创建 SQLite 文件，
 * 表现为 `Error: Schema engine error:`。这里在执行迁移前先把空文件建好。
 * 使用 PostgreSQL 时该脚本不做任何事。
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: resolve(apiRoot, ".env") });

const url = process.env.DATABASE_URL ?? "";

if (!url.startsWith("file:")) {
  console.log("DATABASE_URL 不是 SQLite，跳过本地文件创建");
  process.exit(0);
}

const raw = url.slice("file:".length).replace(/^\/\//, "");
// Prisma 将 SQLite 相对路径解析为相对 schema 文件所在目录（prisma/）
const target = isAbsolute(raw) ? raw : resolve(apiRoot, "prisma", raw);

mkdirSync(dirname(target), { recursive: true });
if (!existsSync(target)) {
  writeFileSync(target, "");
  console.log(`已创建 SQLite 文件：${target}`);
} else {
  console.log(`SQLite 文件已存在：${target}`);
}
