import { defineStore } from "pinia";
import { speciesApi } from "@/api";
import type { Species } from "@/types/models";

export const useSpeciesStore = defineStore("species", {
  state: () => ({
    mine: [] as Species[],
    presets: [] as Species[],
    loading: false,
  }),
  getters: {
    byId(state) {
      return (id: string | null | undefined): Species | undefined => {
        if (!id) return undefined;
        return state.mine.find((item) => item.id === id) ?? state.presets.find((item) => item.id === id);
      };
    },
    byCategory() {
      return (category: string): Species[] => this.mine.filter((item) => item.category === category);
    },
  },
  actions: {
    async fetch(params: { category?: string; q?: string } = {}) {
      this.loading = true;
      try {
        const result = await speciesApi.list({ ...params, includePreset: true });
        this.mine = result.mine;
        this.presets = result.presets;
      } finally {
        this.loading = false;
      }
    },
    async create(payload: Record<string, unknown>) {
      const species = await speciesApi.create(payload);
      this.mine.push(species);
      return species;
    },
    async importPreset(presetId: string) {
      const species = await speciesApi.importPreset(presetId);
      this.mine.push(species);
      return species;
    },
    async update(id: string, payload: Record<string, unknown>) {
      const species = await speciesApi.update(id, payload);
      const index = this.mine.findIndex((item) => item.id === id);
      if (index >= 0) this.mine[index] = species;
      return species;
    },
    async archive(id: string) {
      await speciesApi.archive(id);
      this.mine = this.mine.filter((item) => item.id !== id);
    },
    async remove(id: string) {
      await speciesApi.remove(id);
      this.mine = this.mine.filter((item) => item.id !== id);
    },
    async addPhenophase(speciesId: string, payload: Record<string, unknown>) {
      const phase = await speciesApi.createPhenophase(speciesId, payload);
      const species = this.mine.find((item) => item.id === speciesId);
      species?.phenophases.push(phase);
      return phase;
    },
    async removePhenophase(speciesId: string, phenophaseId: string) {
      await speciesApi.deletePhenophase(phenophaseId);
      const species = this.mine.find((item) => item.id === speciesId);
      if (species) species.phenophases = species.phenophases.filter((phase) => phase.id !== phenophaseId);
    },
  },
});
