import multer from "multer";
import { env } from "../config/env";
import { ALLOWED_IMAGE_MIME } from "../lib/image";
import { ApiError } from "../lib/http";

export const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.maxFileSizeBytes,
    files: env.MAX_PHOTOS_PER_OBSERVATION,
  },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_IMAGE_MIME.includes(file.mimetype.toLowerCase())) {
      callback(new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", `不支持的图片类型：${file.mimetype}`));
      return;
    }
    callback(null, true);
  },
});
