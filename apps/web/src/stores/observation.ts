import { defineStore } from "pinia";
import { observationApi, type ObservationQuery } from "@/api";
import type { Observation } from "@/types/models";

type Filters = {
  siteId: string;
  speciesId: string;
  phenophaseId: string;
  kind: string;
  status: "PUBLISHED" | "DRAFT";
  year: number | null;
  keyword: string;
  hasPhotos: boolean;
  sort: "date_desc" | "date_asc";
};

const defaultFilters = (): Filters => ({
  siteId: "",
  speciesId: "",
  phenophaseId: "",
  kind: "",
  status: "PUBLISHED",
  year: null,
  keyword: "",
  hasPhotos: false,
  sort: "date_desc",
});

export const useObservationStore = defineStore("observation", {
  state: () => ({
    filters: defaultFilters(),
    items: [] as Observation[],
    cursor: null as string | null,
    hasMore: false,
    loading: false,
    loaded: false,
    emptyReason: undefined as "NO_DATA" | "FILTERED_OUT" | undefined,
  }),
  getters: {
    groups(state) {
      const byYear = new Map<string, Map<string, Observation[]>>();
      for (const item of state.items) {
        const year = item.observationDate.slice(0, 4);
        const month = item.observationDate.slice(0, 7);
        const months = byYear.get(year) ?? new Map<string, Observation[]>();
        const list = months.get(month) ?? [];
        list.push(item);
        months.set(month, list);
        byYear.set(year, months);
      }
      return [...byYear.entries()].map(([year, months]) => ({
        year,
        months: [...months.entries()].map(([month, items]) => ({ month, items })),
      }));
    },
    activeFilterCount(state): number {
      let count = 0;
      if (state.filters.siteId) count += 1;
      if (state.filters.speciesId) count += 1;
      if (state.filters.phenophaseId) count += 1;
      if (state.filters.kind) count += 1;
      if (state.filters.year) count += 1;
      if (state.filters.keyword) count += 1;
      if (state.filters.hasPhotos) count += 1;
      if (state.filters.status === "DRAFT") count += 1;
      return count;
    },
  },
  actions: {
    buildQuery(cursor: string | null): ObservationQuery {
      const { year, keyword, hasPhotos, ...rest } = this.filters;
      return {
        ...rest,
        siteId: rest.siteId || undefined,
        speciesId: rest.speciesId || undefined,
        phenophaseId: rest.phenophaseId || undefined,
        kind: rest.kind || undefined,
        keyword: keyword || undefined,
        hasPhotos: hasPhotos || undefined,
        ...(year ? { from: `${year}-01-01`, to: `${year}-12-31` } : {}),
        limit: 20,
        cursor,
      };
    },
    async reload() {
      this.items = [];
      this.cursor = null;
      this.hasMore = false;
      this.loaded = false;
      await this.loadMore();
    },
    async loadMore() {
      if (this.loading || (this.loaded && !this.hasMore)) return;
      this.loading = true;
      try {
        const { items, meta } = await observationApi.list(this.buildQuery(this.cursor));
        this.items.push(...items);
        this.cursor = meta.nextCursor;
        this.hasMore = meta.hasMore;
        this.emptyReason = meta.emptyReason;
        this.loaded = true;
      } finally {
        this.loading = false;
      }
    },
    updateItem(observation: Observation) {
      const index = this.items.findIndex((item) => item.id === observation.id);
      if (index >= 0) this.items[index] = observation;
    },
    removeItem(id: string) {
      this.items = this.items.filter((item) => item.id !== id);
    },
    resetFilters() {
      const status = this.filters.status;
      this.filters = { ...defaultFilters(), status };
    },
  },
});
