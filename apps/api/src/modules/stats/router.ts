import { Router } from "express";
import { asyncHandler, sendData } from "../../lib/http";
import { currentUser, requireAuth } from "../../middleware/auth";
import { validate, validatedQuery } from "../../middleware/validate";
import {
  compareQuerySchema,
  overviewQuerySchema,
  phenologyQuerySchema,
  weatherQuerySchema,
  type CompareQuery,
  type OverviewQuery,
  type PhenologyQuery,
  type WeatherQuery,
} from "./schema";
import * as service from "./service";

export const statsRouter = Router();

statsRouter.use(requireAuth);

statsRouter.get(
  "/compare",
  validate({ query: compareQuerySchema }),
  asyncHandler(async (req, res) => {
    sendData(res, await service.compare(currentUser(req).id, validatedQuery<CompareQuery>(req)));
  }),
);

statsRouter.get(
  "/phenology",
  validate({ query: phenologyQuerySchema }),
  asyncHandler(async (req, res) => {
    sendData(res, await service.phenology(currentUser(req).id, validatedQuery<PhenologyQuery>(req)));
  }),
);

statsRouter.get(
  "/weather",
  validate({ query: weatherQuerySchema }),
  asyncHandler(async (req, res) => {
    const result = await service.weather(currentUser(req).id, validatedQuery<WeatherQuery>(req));
    sendData(res, result);
  }),
);

statsRouter.get(
  "/overview",
  validate({ query: overviewQuerySchema }),
  asyncHandler(async (req, res) => {
    sendData(res, await service.overview(currentUser(req).id, validatedQuery<OverviewQuery>(req)));
  }),
);
