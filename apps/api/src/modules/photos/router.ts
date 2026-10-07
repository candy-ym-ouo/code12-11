import crypto from "node:crypto";
import path from "node:path";
import { Router } from "express";
import { z } from "zod";
import { getOwnedObservation } from "../../lib/access";
import { ApiError, asyncHandler, sendData } from "../../lib/http";
import { processImage } from "../../lib/image";
import { prisma } from "../../lib/prisma";
import { storage } from "../../lib/storage";
import { currentUser, requireAuth } from "../../middleware/auth";
import { uploadLimiter } from "../../middleware/rateLimit";
import { photoUpload } from "../../middleware/upload";
import { validate, validatedBody, validatedParams } from "../../middleware/validate";
import { reorderPhotosSchema } from "../observations/schema";

export const observationPhotoRouter = Router();
export const photoRouter = Router();

const idParams = z.object({ id: z.string().min(1) });

observationPhotoRouter.use(requireAuth);
photoRouter.use(requireAuth);

function buildKey(observationDate: string, extension = "webp"): string {
  const [year, month] = observationDate.split("-");
  return `${year}/${month}/${crypto.randomUUID()}.${extension}`;
}

observationPhotoRouter.post(
  "/:id/photos",
  uploadLimiter,
  validate({ params: idParams }),
  photoUpload.array("files", 9),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = currentUser(req).id;
    const observation = await getOwnedObservation(userId, id);
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];

    if (!files.length) throw new ApiError(400, "VALIDATION_ERROR", "请至少选择一张图片");

    const existingCount = await prisma.observationPhoto.count({ where: { observationId: id } });
    if (existingCount + files.length > 9) {
      throw new ApiError(400, "VALIDATION_ERROR", `单条观测最多 9 张照片，当前已有 ${existingCount} 张`);
    }

    const succeeded: Array<{ id: string; originalName: string; thumbUrl: string; displayUrl: string }> = [];
    const failed: Array<{ originalName: string; reason: string }> = [];
    let sortOrder = existingCount;

    for (const file of files) {
      try {
        const processed = await processImage(file.buffer);
        const key = buildKey(observation.observationDate);
        await storage.put(key, processed.thumb, "thumb", "image/webp");
        await storage.put(key, processed.display, "display", "image/webp");
        await storage.put(key, processed.original, "original", "image/webp");

        const photo = await prisma.observationPhoto.create({
          data: {
            observationId: id,
            storageKey: key,
            thumbKey: key,
            displayKey: key,
            originalName: path.basename(file.originalname).slice(0, 200),
            mimeType: "image/webp",
            width: processed.width,
            height: processed.height,
            bytes: processed.bytes,
            takenAt: processed.takenAt,
            gpsStripped: true,
            sortOrder: sortOrder++,
          },
        });

        succeeded.push({
          id: photo.id,
          originalName: photo.originalName,
          thumbUrl: storage.publicUrl(photo.thumbKey, "thumb"),
          displayUrl: storage.publicUrl(photo.displayKey, "display"),
        });
      } catch (error) {
        failed.push({
          originalName: file.originalname,
          reason: error instanceof ApiError ? error.message : "图片处理失败",
        });
      }
    }

    sendData(res, { succeeded, failed }, undefined, succeeded.length ? 201 : 422);
  }),
);

observationPhotoRouter.patch(
  "/:id/photos/order",
  validate({ params: idParams, body: reorderPhotosSchema }),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = currentUser(req).id;
    await getOwnedObservation(userId, id);
    const { photoIds } = validatedBody<{ photoIds: string[] }>(req);

    const photos = await prisma.observationPhoto.findMany({ where: { observationId: id } });
    if (photos.length !== photoIds.length || photos.some((photo) => !photoIds.includes(photo.id))) {
      throw new ApiError(400, "VALIDATION_ERROR", "照片列表与当前观测不匹配");
    }

    await prisma.$transaction(
      photoIds.map((photoId, index) =>
        prisma.observationPhoto.update({ where: { id: photoId }, data: { sortOrder: index } }),
      ),
    );

    sendData(res, { ok: true });
  }),
);

photoRouter.delete(
  "/:id",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    const userId = currentUser(req).id;
    const photo = await prisma.observationPhoto.findFirst({
      where: { id, observation: { ownerId: userId } },
    });
    if (!photo) throw new ApiError(404, "NOT_FOUND", "照片不存在");

    await prisma.observationPhoto.delete({ where: { id } });
    await Promise.all([
      storage.remove(photo.thumbKey, "thumb"),
      storage.remove(photo.displayKey, "display"),
      storage.remove(photo.storageKey, "original"),
    ]);

    sendData(res, { ok: true });
  }),
);
