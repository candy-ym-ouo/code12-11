import { Router } from "express";
import { z } from "zod";
import { asyncHandler, sendData } from "../../lib/http";
import { currentUser, requireAuth } from "../../middleware/auth";
import { validate, validatedBody, validatedParams, validatedQuery } from "../../middleware/validate";
import {
  createPhenophaseSchema,
  createSpeciesSchema,
  importPresetSchema,
  listSpeciesQuerySchema,
  updatePhenophaseSchema,
  updateSpeciesSchema,
  type CreatePhenophaseInput,
  type CreateSpeciesInput,
  type UpdatePhenophaseInput,
  type UpdateSpeciesInput,
} from "./schema";
import * as service from "./service";

export const speciesRouter = Router();
export const phenophaseRouter = Router();

const idParams = z.object({ id: z.string().min(1) });

speciesRouter.use(requireAuth);

speciesRouter.get(
  "/",
  validate({ query: listSpeciesQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = validatedQuery<{ category?: string; q?: string; includePreset: boolean }>(req);
    sendData(res, await service.listSpecies(currentUser(req).id, query));
  }),
);

speciesRouter.post(
  "/",
  validate({ body: createSpeciesSchema }),
  asyncHandler(async (req, res) => {
    const species = await service.createSpecies(currentUser(req).id, validatedBody<CreateSpeciesInput>(req));
    sendData(res, species, undefined, 201);
  }),
);

speciesRouter.post(
  "/import-preset",
  validate({ body: importPresetSchema }),
  asyncHandler(async (req, res) => {
    const { presetId } = validatedBody<{ presetId: string }>(req);
    const species = await service.importPreset(currentUser(req).id, presetId);
    sendData(res, species, undefined, 201);
  }),
);

speciesRouter.get(
  "/:id",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    sendData(res, await service.getSpecies(currentUser(req).id, id));
  }),
);

speciesRouter.patch(
  "/:id",
  validate({ params: idParams, body: updateSpeciesSchema }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    const species = await service.updateSpecies(currentUser(req).id, id, validatedBody<UpdateSpeciesInput>(req));
    sendData(res, species);
  }),
);

speciesRouter.post(
  "/:id/archive",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    sendData(res, await service.setSpeciesArchived(currentUser(req).id, id, true));
  }),
);

speciesRouter.post(
  "/:id/unarchive",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    sendData(res, await service.setSpeciesArchived(currentUser(req).id, id, false));
  }),
);

speciesRouter.delete(
  "/:id",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    await service.deleteSpecies(currentUser(req).id, id);
    sendData(res, { ok: true });
  }),
);

speciesRouter.get(
  "/:id/phenophases",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    sendData(res, await service.listPhenophases(currentUser(req).id, id));
  }),
);

speciesRouter.post(
  "/:id/phenophases",
  validate({ params: idParams, body: createPhenophaseSchema }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    const phase = await service.createPhenophase(
      currentUser(req).id,
      id,
      validatedBody<CreatePhenophaseInput>(req),
    );
    sendData(res, phase, undefined, 201);
  }),
);

phenophaseRouter.use(requireAuth);

phenophaseRouter.patch(
  "/:id",
  validate({ params: idParams, body: updatePhenophaseSchema }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    const phase = await service.updatePhenophase(
      currentUser(req).id,
      id,
      validatedBody<UpdatePhenophaseInput>(req),
    );
    sendData(res, phase);
  }),
);

phenophaseRouter.delete(
  "/:id",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    await service.deletePhenophase(currentUser(req).id, id);
    sendData(res, { ok: true });
  }),
);
