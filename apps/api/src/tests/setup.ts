import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// 每个测试文件独立一份 SQLite 文件与上传目录，互不干扰。
const workDir = mkdtempSync(path.join(os.tmpdir(), "nature-timeline-test-"));

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = `file:${path.join(workDir, "test.db")}`;
process.env.UPLOAD_DIR = path.join(workDir, "uploads");
process.env.JWT_SECRET = "test-secret-test-secret-test-secret-0123456789";
process.env.APP_ORIGIN = "http://localhost:5173";
process.env.LOG_LEVEL = "silent";

const apiRoot = path.resolve(__dirname, "../..");

// 部分 macOS 环境下 Prisma 无法自动创建 SQLite 文件，先手动建空文件。
writeFileSync(path.join(workDir, "test.db"), "");

execSync("npx prisma db push --skip-generate --accept-data-loss", {
  cwd: apiRoot,
  env: process.env,
  stdio: "pipe",
});

process.on("exit", () => {
  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {
    // 忽略清理失败
  }
});
