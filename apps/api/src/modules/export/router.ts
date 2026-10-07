import { Router } from "express";
import { asyncHandler } from "../../lib/http";
import { currentUser, requireAuth } from "../../middleware/auth";
import { validate, validatedQuery } from "../../middleware/validate";
import { exportQuerySchema, type ExportQuery } from "./schema";
import * as service from "./service";

export const exportRouter = Router();

exportRouter.use(requireAuth);

exportRouter.get(
  "/observations",
  validate({ query: exportQuerySchema }),
  asyncHandler(async (req, res) => {
    const result = await service.exportObservations(currentUser(req).id, validatedQuery<ExportQuery>(req));
    res.setHeader("Content-Type", result.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
    res.send(result.body);
  }),
);
