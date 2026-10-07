import { Router } from "express";
import { z } from "zod";
import { asyncHandler, sendData } from "../../lib/http";
import { currentUser, requireAuth } from "../../middleware/auth";
import { validate, validatedBody, validatedParams, validatedQuery } from "../../middleware/validate";
import {
  createShareSchema,
  createSiteSchema,
  listSitesQuerySchema,
  updateSiteSchema,
  type CreateShareInput,
  type CreateSiteInput,
  type UpdateSiteInput,
} from "./schema";
import * as service from "./service";

export const siteRouter = Router();

const idParams = z.object({ id: z.string().min(1) });

siteRouter.use(requireAuth);

siteRouter.get(
  "/",
  validate({ query: listSitesQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = validatedQuery<{ includeArchived: boolean }>(req);
    const sites = await service.listSites(currentUser(req).id, query.includeArchived);
    sendData(res, sites);
  }),
);

siteRouter.post(
  "/",
  validate({ body: createSiteSchema }),
  asyncHandler(async (req, res) => {
    const site = await service.createSite(currentUser(req).id, validatedBody<CreateSiteInput>(req));
    sendData(res, site, undefined, 201);
  }),
);

siteRouter.get(
  "/:id",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    sendData(res, await service.getSite(currentUser(req).id, id));
  }),
);

siteRouter.patch(
  "/:id",
  validate({ params: idParams, body: updateSiteSchema }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    const site = await service.updateSite(currentUser(req).id, id, validatedBody<UpdateSiteInput>(req));
    sendData(res, site);
  }),
);

siteRouter.post(
  "/:id/archive",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    sendData(res, await service.setArchived(currentUser(req).id, id, true));
  }),
);

siteRouter.post(
  "/:id/unarchive",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    sendData(res, await service.setArchived(currentUser(req).id, id, false));
  }),
);

siteRouter.delete(
  "/:id",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    await service.deleteSite(currentUser(req).id, id);
    sendData(res, { ok: true });
  }),
);

siteRouter.post(
  "/:id/share",
  validate({ params: idParams, body: createShareSchema }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    const link = await service.createShareLink(currentUser(req).id, id, validatedBody<CreateShareInput>(req));
    sendData(res, link, undefined, 201);
  }),
);

siteRouter.get(
  "/:id/share-links",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    sendData(res, await service.listShareLinks(currentUser(req).id, id));
  }),
);

export const shareLinkRouter = Router();

shareLinkRouter.use(requireAuth);

shareLinkRouter.delete(
  "/:id",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    await service.revokeShareLink(currentUser(req).id, id);
    sendData(res, { ok: true });
  }),
);
