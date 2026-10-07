import { createApp } from "vue";
import { createPinia } from "pinia";
import "@/styles/base.css";
import "@/styles/theme.css";
import App from "@/App.vue";
import router from "@/router";
import { useAuthStore } from "@/stores/auth";
import { onUnauthorized } from "@/api/client";

const app = createApp(App);
const pinia = createPinia();

const auth = useAuthStore(pinia);

/**
 * 必须先完成会话恢复再安装路由：
 * 路由守卫依赖 isAuthenticated，若在恢复完成前触发首次导航，整页刷新会被误判为未登录。
 */
auth
  .bootstrap()
  .catch(() => undefined)
  .finally(() => {
    app.use(pinia);
    app.use(router);

    onUnauthorized(() => {
      auth.clear();
      if (router.currentRoute.value.name !== "login") {
        void router.push({ name: "login", query: { redirect: router.currentRoute.value.fullPath } });
      }
    });

    app.mount("#app");
  });
