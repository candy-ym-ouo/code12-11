import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// 跑构建产物 dist/cli.js（CI 中需先 build），避免从临时目录解析 tsx
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

function run(args: string[], cwd: string): { stdout: string; status: number } {
  try {
    const stdout = execFileSync(process.execPath, [cli, ...args], {
      cwd,
      encoding: "utf8",
    });
    return { stdout, status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; status?: number; stderr?: string };
    return { stdout: e.stdout ?? "", status: e.status ?? 1 };
  }
}

describe("CLI 端到端", () => {
  let dir: string;
  let book: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "yangxian-cli-"));
    book = join(dir, "survey.json");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("init → batch → segment → obs → timeline → review → export 全链路", () => {
    let r = run(["init", book, "--name", "CLI样线", "--length", "1000"], dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("1000.0 m");

    r = run(["batch", book, "--source", "field", "--recorder", "甲", "--at", "2026-10-07T06:55:00+08:00"], dir);
    expect(r.stdout.trim().startsWith("B0001")).toBe(true);

    r = run(["segment", book, "--batch", "B0001", "--label", "全程", "--from", "0", "--to", "1000"], dir);
    expect(r.stdout).toContain("SEG0001");

    r = run([
      "obs", book, "--batch", "B0001",
      "--time", "2026-10-07T07:10:00+08:00",
      "--species-code", "A", "--species-name", "白头鹎", "--count", "3",
      "--at", "400", "--observer", "甲",
    ], dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("O0001");

    // 补录批次 + 同一次目击的重复记录 → 自动合并
    r = run(["batch", book, "--source", "retroactive", "--recorder", "甲", "--at", "2026-10-08T20:00:00+08:00"], dir);
    expect(r.stdout.trim().startsWith("B0002")).toBe(true);
    r = run([
      "obs", book, "--batch", "B0002",
      "--time", "2026-10-07T07:12:00+08:00",
      "--species-code", "A", "--species-name", "白头鹎", "--count", "3",
      "--at", "405", "--observer", "甲", "--note", "补抄",
    ], dir);
    expect(r.status).toBe(0);

    r = run(["timeline", book, "--json"], dir);
    const tl = JSON.parse(r.stdout);
    expect(tl.sightings).toHaveLength(1);
    expect(tl.sightings[0].status).toBe("auto-merged");
    expect(tl.sightings[0].observationIds).toEqual(["O0001", "O0002"]);

    r = run(["review", book], dir);
    expect(r.status).toBe(0); // info/warning 不影响退出码
    expect(r.stdout).toContain("RETROACTIVE_ENTRY");

    // 数量冲突使 review 退出码为 2
    run([
      "obs", book, "--batch", "B0001",
      "--time", "2026-10-07T07:40:00+08:00",
      "--species-code", "B", "--species-name", "喜鹊", "--count", "4", "--at", "800", "--observer", "甲",
    ], dir);
    run([
      "obs", book, "--batch", "B0002",
      "--time", "2026-10-07T07:41:00+08:00",
      "--species-code", "B", "--species-name", "喜鹊", "--count", "9", "--at", "802", "--observer", "乙",
    ], dir);
    r = run(["review", book], dir);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("COUNT_MISMATCH");

    // 导出
    const out = join(dir, "export");
    r = run(["export", book, "--out", out], dir);
    expect(r.status).toBe(0);
    for (const f of ["observations.csv", "timeline.csv", "segments.csv", "timeline.json", "review.json", "summary.json", "sightings.geojson", "report.md"]) {
      expect(existsSync(join(out, f))).toBe(true);
    }
    const csv = readFileSync(join(out, "observations.csv"), "utf8");
    expect(csv.startsWith("﻿")).toBe(true);
  });

  it("未知命令与缺少参数返回非零退出码", () => {
    expect(run(["init", book, "--length", "100"], dir).status).toBe(1); // 缺 --name
    run(["init", book, "--name", "x", "--length", "100"], dir);
    expect(run(["frobnicate", book], dir).status).toBe(1);
  });

  it("import 从 CSV 批量导入观测", () => {
    run(["init", book, "--name", "导入样线", "--length", "1000"], dir);
    run(["batch", book, "--source", "retroactive", "--recorder", "甲", "--at", "2026-10-09T10:00:00+08:00"], dir);
    const csvPath = join(dir, "obs.csv");
    const csv =
      "观察时刻,物种代码,物种名称,数量,桩号m,记录者,备注\n" +
      "2026-10-07T07:00:00+08:00,A,白头鹎,2,300,甲,补录1\n" +
      "2026-10-07T07:20:00+08:00,B,翠鸟,1,700,甲,补录2\n";
    writeFileSync(csvPath, csv);
    const r = run(["import", book, "--batch", "B0001", "--csv", csvPath], dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("已导入 2");
    const tl = JSON.parse(run(["timeline", book, "--json"], dir).stdout);
    expect(tl.sightings).toHaveLength(2);
  });
});
