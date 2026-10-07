/**
 * 样线调查核心数据模型
 *
 * 设计原则：
 * - 原始数据（路线、分段、录入批次、观测）只追加、不修改，保证任何结果可复核、可回放；
 * - 原子分段、时间线、归并结果全部由原始数据确定性地重新计算（reconcile），不持久化；
 * - 事后补录（retroactive）是带录入时刻的正常数据，对齐结果以观察时刻排序、以录入顺序定锚。
 */

/** WGS84 经纬度坐标（米制距离按大圆距离 haversine 计算） */
export interface LngLat {
  lng: number;
  lat: number;
}

/** 路线控制点。给出坐标时桩号可自动累计；也可直接给 chainage 覆盖 */
export interface Waypoint {
  id: string;
  name?: string;
  lng?: number;
  lat?: number;
  /** 桩号（米），从路线起点 0 起算；省略时按相邻控制点坐标距离累计 */
  chainage?: number;
}

/** 调查样线（固定路线） */
export interface Route {
  id: string;
  name: string;
  description?: string;
  waypoints: Waypoint[];
  createdAt: string;
}

/**
 * 一次分段记录所覆盖的桩号区间 [from, to)（米，左闭右开）。
 * 允许不同批次的分段彼此重叠——对齐时按重叠长度切分为原子分段。
 */
export interface Segment {
  id: string;
  routeId: string;
  /** 本次记录的分段编号/名称，例如「第3段」「K0+400~K0+800」 */
  label: string;
  fromM: number;
  toM: number;
  /** 该段实际调查的时间窗（可选，用于检查观察时刻是否落在调查时段内） */
  startedAt?: string;
  endedAt?: string;
  /** 录入批次 id（审计追踪） */
  batchId: string;
  /** 事后补录的分段 */
  retroactive: boolean;
  note?: string;
}

/** 单条物种观测 */
export interface Observation {
  id: string;
  routeId: string;
  /** 观察时刻（ISO 8601）；时间线按它排序 */
  observedAt: string;
  speciesCode: string;
  speciesName: string;
  /** 该次看到的数量（只/群/只数）。无精确数量时用 minCount~maxCount 区间 */
  count: number;
  minCount?: number;
  maxCount?: number;
  /** 观察位置：桩号（米）或坐标，至少给一种；给区间则表示沿线一段范围 */
  atM?: number;
  fromM?: number;
  toM?: number;
  lng?: number;
  lat?: number;
  segmentId?: string;
  observer?: string;
  weather?: string;
  note?: string;
  batchId: string;
  /** 录入时刻（ISO 8601），晚于 observedAt 超过阈值即视为事后补录 */
  enteredAt: string;
  retroactive: boolean;
}

/** 一次提交（当天现场录入 或 事后补录），批次只追加 */
export interface EntryBatch {
  id: string;
  routeId: string;
  source: "field" | "retroactive";
  enteredAt: string;
  recorder: string;
  note?: string;
}

/** 桩号原子分段：所有分段端点排序后切出的不可再分区间 */
export interface AtomicInterval {
  index: number;
  fromM: number;
  toM: number;
  /** 覆盖该原子分段的分段 id（可能来自不同批次、彼此重叠） */
  segmentIds: string[];
}

/** 归并后的一次「目击」（同一物种、时空相邻的多条观测对齐为一条） */
export interface Sighting {
  id: string;
  /** 锚点观测 id：同组中录入最早的观测，决定稳定 id */
  anchorObservationId: string;
  routeId: string;
  speciesCode: string;
  speciesName: string;
  observedAt: string;
  observationIds: string[];
  /** 自动合并时采用的数量（同物种同数量重复记录取一次） */
  resolvedCount: number;
  minCount?: number;
  maxCount?: number;
  fromM: number;
  toM: number;
  representativeM: number;
  atomicIndexes: number[];
  segmentIds: string[];
  batchIds: string[];
  observers: string[];
  status: "confirmed" | "auto-merged" | "conflict" | "unresolved";
  retroactive: boolean;
  /** 数量不一致等需要人工确认的原因 */
  conflictReason?: string;
  notes: string[];
}

export type IssueSeverity = "error" | "warning" | "info";

export interface ReviewIssue {
  code:
    | "SEGMENT_OVERLAP"
    | "SEGMENT_OUTSIDE_ROUTE"
    | "SEGMENT_REVERSED"
    | "OBSERVATION_OUTSIDE_SEGMENT"
    | "OBSERVATION_OUTSIDE_ROUTE"
    | "OBSERVATION_TIME_OUTSIDE_WINDOW"
    | "COUNT_MISMATCH"
    | "SIGHTING_SPATIALLY_MERGED"
    | "SIGHTING_TIME_SPREAD"
    | "RETROACTIVE_ENTRY"
    | "LARGE_CLUSTER"
    | "MISSING_LOCATION"
    | "DUPLICATED_ID";
  severity: IssueSeverity;
  message: string;
  batchId?: string;
  segmentId?: string;
  observationId?: string;
  sightingId?: string;
  relatedIds?: string[];
}

export interface SegmentStat {
  segmentId: string;
  label: string;
  fromM: number;
  toM: number;
  lengthM: number;
  retroactive: boolean;
  species: Record<string, number>;
  total: number;
  /** 该段被其他分段重叠覆盖的比例（0~1） */
  overlapRatio: number;
}

export interface SpeciesTotal {
  speciesCode: string;
  speciesName: string;
  count: number;
  sightings: number;
  unresolvedCount: number;
}

export interface Timeline {
  routeId: string;
  generatedAt: string;
  sightings: Sighting[];
}

export interface ReviewReport {
  routeId: string;
  generatedAt: string;
  totals: {
    segments: number;
    atomicIntervals: number;
    observations: number;
    sightings: number;
    batches: number;
    retroactiveObservations: number;
  };
  issues: ReviewIssue[];
  errorCount: number;
  warningCount: number;
}

/** 样线调查的完整可持久化状态（全部为只追加原始数据） */
export interface SurveyState {
  version: 1;
  route: Route;
  segments: Segment[];
  observations: Observation[];
  batches: EntryBatch[];
}
