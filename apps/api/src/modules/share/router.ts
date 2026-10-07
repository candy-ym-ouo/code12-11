import { Router } from "express";
import { z } from "zod";
import { asyncHandler, sendData } from "../../lib/http";
import { shareLimiter } from "../../middleware/rateLimit";
import { validate, validatedParams } from "../../middleware/validate";
import * as service from "./service";

export const shareRouter = Router();

shareRouter.get(
  "/:token",
  shareLimiter,
  validate({ params: z.object({ token: z.string().min(8).max(64) }) }),
  asyncHandler(async (req, res) => {
    const { token } = validatedParams<{ token: string }>(req);
    sendData(res, await service.getSharedView(token));
  }),
);
