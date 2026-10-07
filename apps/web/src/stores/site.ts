import { defineStore } from "pinia";
import { siteApi } from "@/api";
import type { Site } from "@/types/models";

const STORAGE_KEY = "nature-timeline:selected-site";

export const useSiteStore = defineStore("site", {
  state: () => ({
    sites: [] as Site[],
    selectedSiteId: (localStorage.getItem(STORAGE_KEY) ?? "") as string,
    loading: false,
  }),
  getters: {
    selectedSite(state): Site | null {
      return state.sites.find((site) => site.id === state.selectedSiteId) ?? null;
    },
  },
  actions: {
    select(siteId: string) {
      this.selectedSiteId = siteId;
      if (siteId) localStorage.setItem(STORAGE_KEY, siteId);
      else localStorage.removeItem(STORAGE_KEY);
    },
    async fetch(includeArchived = false) {
      this.loading = true;
      try {
        this.sites = await siteApi.list(includeArchived);
        if (this.selectedSiteId && !this.sites.some((site) => site.id === this.selectedSiteId)) {
          this.select("");
        }
      } finally {
        this.loading = false;
      }
    },
    async create(payload: Record<string, unknown>) {
      const site = await siteApi.create(payload);
      this.sites.push(site);
      return site;
    },
    async update(id: string, payload: Record<string, unknown>) {
      const site = await siteApi.update(id, payload);
      const index = this.sites.findIndex((item) => item.id === id);
      if (index >= 0) this.sites[index] = site;
      return site;
    },
    async archive(id: string) {
      await siteApi.archive(id);
      await this.fetch(true);
    },
    async unarchive(id: string) {
      await siteApi.unarchive(id);
      await this.fetch(true);
    },
    async remove(id: string) {
      await siteApi.remove(id);
      this.sites = this.sites.filter((site) => site.id !== id);
      if (this.selectedSiteId === id) this.select("");
    },
  },
});
