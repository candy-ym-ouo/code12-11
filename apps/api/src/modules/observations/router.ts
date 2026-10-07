import { Router } from "express";
import { z } from "zod";
import { asyncHandler, sendData } from "../../lib/http";
import { currentUser, requireAuth } from "../../middleware/auth";
import { validate, validatedBody, validatedParams, validatedQuery } from "../../middleware/validate";
import {
  bulkObservationSchema,
  createObservationSchema,
  listObservationsQuerySchema,
  updateObservationSchema,
  type BulkObservationInput,
  type CreateObservationInput,
  type ListObservationsQuery,
  type UpdateObservationInput,
} from "./schema";
import * as service from "./service";

export const observationRouter = Router();

const idParams = z.object({ id: z.string().min(1) });

observationRouter.use(requireAuth);

observationRouter.get(
  "/",
  validate({ query: listObservationsQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = validatedQuery<ListObservationsQuery>(req);
    const { items, meta } = await service.listObservations(currentUser(req).id, query);
    sendData(res, items, meta);
  }),
);

observationRouter.post(
  "/",
  validate({ body: createObservationSchema }),
  asyncHandler(async (req, res) => {
    const input = validatedBody<CreateObservationInput>(req);
    const observation = await service.createObservation(currentUser(req).id, input);
    sendData(res, observation, undefined, 201);
  }),
);

observationRouter.post(
  "/bulk",
  validate({ body: bulkObservationSchema }),
  asyncHandler(async (req, res) => {
    const input = validatedBody<BulkObservationInput>(req);
    sendData(res, await service.bulkObservations(currentUser(req).id, input));
  }),
);

observationRouter.get(
  "/:id",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    sendData(res, await service.getObservation(currentUser(req).id, id));
  }),
);

observationRouter.patch(
  "/:id",
  validate({ params: idParams, body: updateObservationSchema }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    const observation = await service.updateObservation(
      currentUser(req).id,
      id,
      validatedBody<UpdateObservationInput>(req),
    );
    sendData(res, observation);
  }),
);

observationRouter.delete(
  "/:id",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    await service.deleteObservation(currentUser(req).id, id);
    sendData(res, { ok: true });
  }),
);

observationRouter.post(
  "/:id/publish",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    sendData(res, await service.publishObservation(currentUser(req).id, id));
  }),
);
