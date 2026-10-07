import { http } from "./client";
import type { ApiList } from "./index";
import type {
  EntryPayload,
  TimelineResponse,
  Transect,
  TransectConflict,
  TransectEntry,
  TransectSegment,
} from "@/types/transect";

export const transectApi = {
  async list(includeArchived = false): Promise<Transect[]> {
    const { data } = await http.get<ApiList<Transect>>("/transects", {
      params: { includeArchived },
    });
    return data.data;
  },

  async get(id: string): Promise<Transect> {
    const { data } = await http.get<{ data: Transect }>(`/transects/${id}`);
    return data.data;
  },

  async create(payload: Partial<Transect>): Promise<Transect> {
    const { data } = await http.post<{ data: Transect }>("/transects", payload);
    return data.data;
  },

  async update(id: string, payload: Partial<Transect>): Promise<Transect> {
    const { data } = await http.patch<{ data: Transect }>(`/transects/${id}`, payload);
    return data.data;
  },

  async archive(id: string): Promise<void> {
    await http.post(`/transects/${id}/archive`, {});
  },

  async unarchive(id: string): Promise<void> {
    await http.post(`/transects/${id}/unarchive`, {});
  },

  async remove(id: string): Promise<void> {
    await http.delete(`/transects/${id}`);
  },

  async listSegments(transectId: string): Promise<TransectSegment[]> {
    const { data } = await http.get<ApiList<TransectSegment>>(`/transects/${transectId}/segments`);
    return data.data;
  },

  async replaceSegments(
    transectId: string,
    segments: (Omit<TransectSegment, "id"> & { id?: string })[],
  ): Promise<TransectSegment[]> {
    const { data } = await http.put<ApiList<TransectSegment>>(`/transects/${transectId}/segments`, {
      segments,
    });
    return data.data;
  },

  async listEntries(
    transectId: string,
    params: { speciesName?: string; segmentId?: string; source?: string } = {},
  ): Promise<TransectEntry[]> {
    const { data } = await http.get<ApiList<TransectEntry>>(`/transects/${transectId}/entries`, {
      params,
    });
    return data.data;
  },

  async createEntry(transectId: string, payload: EntryPayload): Promise<TransectEntry> {
    const { data } = await http.post<{ data: TransectEntry }>(`/transects/${transectId}/entries`, payload);
    return data.data;
  },

  async updateEntry(transectId: string, entryId: string, payload: EntryPayload): Promise<TransectEntry> {
    const { data } = await http.patch<{ data: TransectEntry }>(
      `/transects/${transectId}/entries/${entryId}`,
      payload,
    );
    return data.data;
  },

  async deleteEntry(transectId: string, entryId: string): Promise<void> {
    await http.delete(`/transects/${transectId}/entries/${entryId}`);
  },

  /** 事后补录并替代既有录入（后端自动标记 BACKFILL） */
  async replaceEntry(
    transectId: string,
    entryId: string,
    payload: EntryPayload,
  ): Promise<TransectEntry> {
    const { data } = await http.post<{ data: TransectEntry }>(
      `/transects/${transectId}/entries/${entryId}/replace`,
      payload,
    );
    return data.data;
  },

  async timeline(
    transectId: string,
    params: { speciesName?: string; segmentId?: string; from?: string; to?: string } = {},
  ): Promise<TimelineResponse> {
    const { data } = await http.get<{ data: TimelineResponse }>(`/transects/${transectId}/timeline`, {
      params,
    });
    return data.data;
  },

  async downloadExport(
    transectId: string,
    format: "csv" | "geojson",
    filename: string,
  ): Promise<void> {
    const response = await http.get(`/transects/${transectId}/export`, {
      params: { format },
      responseType: "blob",
    });
    const blobUrl = URL.createObjectURL(response.data as Blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(blobUrl);
  },
};

export const transectConflictApi = {
  async list(
    params: { transectId?: string; status?: "PENDING" | "RESOLVED" | "ALL" } = {},
  ): Promise<TransectConflict[]> {
    const { data } = await http.get<ApiList<TransectConflict>>("/transect-conflicts", { params });
    return data.data;
  },

  async resolve(
    id: string,
    payload: { resolution: "KEEP_A" | "KEEP_B" | "SUM" | "DUPLICATE"; note?: string | null },
  ): Promise<TransectConflict> {
    const { data } = await http.patch<{ data: TransectConflict }>(`/transect-conflicts/${id}`, payload);
    return data.data;
  },
};
