import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import Components from "unplugin-vue-components/vite";
import { ElementPlusResolver } from "unplugin-vue-components/resolvers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue(), Components({ dts: false, resolvers: [ElementPlusResolver({ importStyle: "css" })] })],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/unit/**/*.spec.ts"],
    globals: true,
    // 让 Vite 处理 element-plus 及其样式导入，避免 Node 直接加载 .css
    server: {
      deps: {
        inline: ["element-plus", "@element-plus/icons-vue"],
      },
    },
  },
});
