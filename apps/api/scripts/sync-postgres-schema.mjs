/**
 * 由 SQLite schema 生成 PostgreSQL schema。
 * 两份文件的模型定义必须完全一致，只有 datasource provider 不同。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, "../prisma/schema.prisma");
const target = resolve(here, "../prisma/schema.postgres.prisma");

const content = readFileSync(source, "utf8");
if (!content.includes('provider = "sqlite"')) {
  throw new Error("未在 schema.prisma 中找到 sqlite provider，已中止以保护源文件");
}

const banner = [
  "// 该文件由 scripts/sync-postgres-schema.mjs 从 schema.prisma 生成，请勿手工编辑。",
  "// 生成命令：pnpm --filter @nature/api db:sync-schema",
  "",
].join("\n");

writeFileSync(target, banner + content.replace('provider = "sqlite"', 'provider = "postgresql"'), "utf8");
console.log(`已生成 ${target}`);
