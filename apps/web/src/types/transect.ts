// 样线调查模块类型（与后端 modules/transects 对应）

export type EntrySource = "MANUAL" | "BACKFILL";
export type ConflictResolution = "PENDING" | "KEEP_A" | "KEEP_B" | "SUM" | "DUPLICATE";

export interface Transect {
  id: string;
  name: string;
  code: string | null;
  siteId: string | null;
  description: string | null;
  lengthM: number;
  archivedAt: string | null;
  segmentCount: number;
  entryCount: number;
  pendingConflictCount: number;
  lastObservedAt: string | null;
  createdAt: string;
}

export interface TransectSegment {
  id: string;
  transectId?: string;
  orderIndex: number;
  startM: number;
  endM: number;
  name: string;
  habitat: string | null;
  geometry: number[][] | null;
}

export interface TransectEntry {
  id: string;
  transectId: string;
  speciesId: string | null;
  speciesName: string;
  category: string | null;
  segmentId: string | null;
  segmentName: string | null;
  startM: number;
  endM: number;
  count: number;
  startAt: string;
  endAt: string;
  observedAt: string;
  recordedAt: string;
  source: EntrySource;
  observer: string | null;
  notes: string | null;
  supersedesEntryId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SliceShare {
  entryId: string;
  count: number;
}

export interface TimelineSlice {
  key: string;
  speciesName: string;
  segmentId: string | null;
  segmentName: string | null;
  segmentOrder: number | null;
  startM: number;
  endM: number;
  startAt: string;
  endAt: string;
  shares: SliceShare[];
  totalRaw: number;
  totalResolved: number;
  conflictIds: string[];
  pending: boolean;
  source: EntrySource;
  observer: string | null;
  notes: string | null;
}

export interface TimelineSummary {
  totalRaw: number;
  totalResolved: number;
  pendingSlices: number;
  bySpecies: { speciesName: string; totalRaw: number; totalResolved: number; slices: number }[];
  bySegment: { segmentId: string; totalRaw: number; totalResolved: number }[];
}

export interface TimelineResponse {
  transect: Transect;
  segments: TransectSegment[];
  slices: TimelineSlice[];
  entries: TransectEntry[];
  summary: TimelineSummary;
}

export interface TransectConflict {
  id: string;
  transectId: string;
  transectName: string;
  speciesName: string;
  startM: number;
  endM: number;
  startAt: string;
  endAt: string;
  countA: number;
  countB: number;
  resolution: ConflictResolution;
  resolvedAt: string | null;
  resolvedNote: string | null;
  createdAt: string;
  entryA: TransectEntry | null;
  entryB: TransectEntry | null;
}

export interface EntryPayload {
  speciesName: string;
  speciesId?: string | null;
  category?: string | null;
  segmentId?: string | null;
  startM: number;
  endM: number;
  count: number;
  startAt: string;
  endAt?: string;
  observedAt?: string;
  observer?: string | null;
  notes?: string | null;
  source?: EntrySource;
}

export const RESOLUTION_LABELS: Record<Exclude<ConflictResolution, "PENDING">, string> = {
  KEEP_A: "保留先录入",
  KEEP_B: "保留后录入",
  SUM: "两批不同个体，求和",
  DUPLICATE: "同一批重复，去重",
};

export const SOURCE_LABELS: Record<EntrySource, string> = {
  MANUAL: "现场录入",
  BACKFILL: "事后补录",
};
