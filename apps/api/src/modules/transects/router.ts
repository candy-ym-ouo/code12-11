import { Router } from "express";
import { z } from "zod";
import { asyncHandler, sendData } from "../../lib/http";
import { currentUser, requireAuth } from "../../middleware/auth";
import { validate, validatedBody, validatedParams, validatedQuery } from "../../middleware/validate";
import {
  createEntrySchema,
  createTransectSchema,
  exportQuerySchema,
  listEntriesQuerySchema,
  listTransectsQuerySchema,
  replaceSegmentsSchema,
  resolveConflictSchema,
  timelineQuerySchema,
  updateEntrySchema,
  updateTransectSchema,
  type CreateEntryInput,
  type CreateTransectInput,
  type ExportQuery,
  type ResolveConflictInput,
  type SegmentInput,
  type UpdateEntryInput,
  type UpdateTransectInput,
} from "./schema";
import * as service from "./service";

const idParams = z.object({ id: z.string().min(1) });
const entryParams = z.object({ id: z.string().min(1), entryId: z.string().min(1) });

export const transectRouter = Router();

transectRouter.use(requireAuth);

// ---------- 路线 ----------

transectRouter.get(
  "/",
  validate({ query: listTransectsQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = validatedQuery<{ includeArchived: boolean }>(req);
    sendData(res, await service.listTransects(currentUser(req).id, query.includeArchived));
  }),
);

transectRouter.post(
  "/",
  validate({ body: createTransectSchema }),
  asyncHandler(async (req, res) => {
    const transect = await service.createTransect(
      currentUser(req).id,
      validatedBody<CreateTransectInput>(req),
    );
    sendData(res, transect, undefined, 201);
  }),
);

transectRouter.get(
  "/:id",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    sendData(res, await service.getTransect(currentUser(req).id, id));
  }),
);

transectRouter.patch(
  "/:id",
  validate({ params: idParams, body: updateTransectSchema }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    const transect = await service.updateTransect(
      currentUser(req).id,
      id,
      validatedBody<UpdateTransectInput>(req),
    );
    sendData(res, transect);
  }),
);

transectRouter.post(
  "/:id/archive",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    sendData(res, await service.setTransectArchived(currentUser(req).id, id, true));
  }),
);

transectRouter.post(
  "/:id/unarchive",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    sendData(res, await service.setTransectArchived(currentUser(req).id, id, false));
  }),
);

transectRouter.delete(
  "/:id",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    await service.deleteTransect(currentUser(req).id, id);
    sendData(res, { ok: true });
  }),
);

// ---------- 分段 ----------

transectRouter.get(
  "/:id/segments",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    sendData(res, await service.listSegments(currentUser(req).id, id));
  }),
);

transectRouter.put(
  "/:id/segments",
  validate({ params: idParams, body: replaceSegmentsSchema }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    const { segments } = validatedBody<{ segments: SegmentInput[] }>(req);
    sendData(res, await service.replaceSegments(currentUser(req).id, id, segments));
  }),
);

// ---------- 录入 ----------

transectRouter.get(
  "/:id/entries",
  validate({ params: idParams, query: listEntriesQuerySchema }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    const query = validatedQuery<{
      speciesName?: string;
      segmentId?: string;
      source?: string;
      from?: string;
      to?: string;
    }>(req);
    sendData(res, await service.listEntries(currentUser(req).id, id, query));
  }),
);

transectRouter.post(
  "/:id/entries",
  validate({ params: idParams, body: createEntrySchema }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    const entry = await service.createEntry(
      currentUser(req).id,
      id,
      validatedBody<CreateEntryInput>(req),
    );
    sendData(res, entry, undefined, 201);
  }),
);

transectRouter.get(
  "/:id/entries/:entryId",
  validate({ params: entryParams }),
  asyncHandler(async (req, res) => {
    const { id, entryId } = validatedParams<{ id: string; entryId: string }>(req);
    sendData(res, await service.getEntry(currentUser(req).id, id, entryId));
  }),
);

transectRouter.patch(
  "/:id/entries/:entryId",
  validate({ params: entryParams, body: updateEntrySchema }),
  asyncHandler(async (req, res) => {
    const { id, entryId } = validatedParams<{ id: string; entryId: string }>(req);
    const entry = await service.updateEntry(
      currentUser(req).id,
      id,
      entryId,
      validatedBody<UpdateEntryInput>(req),
    );
    sendData(res, entry);
  }),
);

transectRouter.delete(
  "/:id/entries/:entryId",
  validate({ params: entryParams }),
  asyncHandler(async (req, res) => {
    const { id, entryId } = validatedParams<{ id: string; entryId: string }>(req);
    sendData(res, await service.deleteEntry(currentUser(req).id, id, entryId));
  }),
);

/** 事后补录并替代一条既有录入：新录入按实际观测时间对齐，旧录入归档删除。 */
transectRouter.post(
  "/:id/entries/:entryId/replace",
  validate({ params: entryParams, body: createEntrySchema }),
  asyncHandler(async (req, res) => {
    const { id, entryId } = validatedParams<{ id: string; entryId: string }>(req);
    const entry = await service.backfillEntry(
      currentUser(req).id,
      id,
      entryId,
      validatedBody<CreateEntryInput>(req),
    );
    sendData(res, entry, undefined, 201);
  }),
);

// ---------- 时间线 ----------

transectRouter.get(
  "/:id/timeline",
  validate({ params: idParams, query: timelineQuerySchema }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    const query = validatedQuery<{
      speciesName?: string;
      segmentId?: string;
      from?: string;
      to?: string;
    }>(req);
    sendData(res, await service.getTimeline(currentUser(req).id, id, query));
  }),
);

// ---------- 导出 ----------

transectRouter.get(
  "/:id/export",
  validate({ params: idParams, query: exportQuerySchema }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    const query = validatedQuery<ExportQuery>(req);
    const result = await service.exportTransect(currentUser(req).id, id, query);
    res.setHeader("Content-Type", result.contentType);
    res.setHeader("Content-Disposition", result.contentDisposition);
    res.send(result.body);
  }),
);

// ============================================================
// 冲突复核（跨样线列表 + 处理）
// ============================================================

const listConflictsQuery = z.object({
  transectId: z.string().min(1).optional(),
  status: z.enum(["PENDING", "RESOLVED", "ALL"]).default("PENDING"),
});

export const transectConflictRouter = Router();

transectConflictRouter.use(requireAuth);

transectConflictRouter.get(
  "/",
  validate({ query: listConflictsQuery }),
  asyncHandler(async (req, res) => {
    const query = validatedQuery<{ transectId?: string; status: "PENDING" | "RESOLVED" | "ALL" }>(req);
    sendData(res, await service.listConflicts(currentUser(req).id, query.transectId, query.status));
  }),
);

transectConflictRouter.patch(
  "/:id",
  validate({ params: idParams, body: resolveConflictSchema }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    const conflict = await service.resolveConflict(
      currentUser(req).id,
      id,
      validatedBody<ResolveConflictInput>(req),
    );
    sendData(res, conflict);
  }),
);
