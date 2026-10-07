import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/tests/**/*.spec.ts"],
    setupFiles: ["src/tests/setup.ts"],
    hookTimeout: 60_000,
    testTimeout: 30_000,
    pool: "forks",
    poolOptions: {
      forks: { singleFork: false },
    },
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
      include: ["src/lib/**/*.ts", "src/modules/**/*.ts", "src/middleware/**/*.ts"],
      exclude: ["src/tests/**", "**/*.d.ts"],
      thresholds: {
        lines: 60,
        functions: 55,
        branches: 50,
        statements: 60,
      },
    },
  },
});
