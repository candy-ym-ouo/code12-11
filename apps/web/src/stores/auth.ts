import { defineStore } from "pinia";
import { authApi } from "@/api";
import { setAccessToken } from "@/api/client";
import type { User } from "@/types/models";

export const useAuthStore = defineStore("auth", {
  state: () => ({
    user: null as User | null,
    token: null as string | null,
    bootstrapped: false,
  }),
  getters: {
    isAuthenticated: (state) => Boolean(state.user && state.token),
    displayName: (state) => state.user?.displayName ?? "",
  },
  actions: {
    applySession(payload: { accessToken: string; user: User }) {
      this.token = payload.accessToken;
      this.user = payload.user;
      setAccessToken(payload.accessToken);
    },
    async login(email: string, password: string) {
      this.applySession(await authApi.login({ email, password }));
    },
    async register(email: string, password: string, displayName: string) {
      this.applySession(await authApi.register({ email, password, displayName }));
    },
    async logout() {
      try {
        await authApi.logout();
      } finally {
        this.user = null;
        this.token = null;
        setAccessToken(null);
      }
    },
    /** 应用启动时尝试用 refresh cookie 恢复会话 */
    async bootstrap() {
      if (this.bootstrapped) return;
      try {
        this.applySession(await authApi.refresh());
      } catch {
        this.user = null;
        this.token = null;
        setAccessToken(null);
      } finally {
        this.bootstrapped = true;
      }
    },
    clear() {
      this.user = null;
      this.token = null;
      setAccessToken(null);
    },
  },
});
