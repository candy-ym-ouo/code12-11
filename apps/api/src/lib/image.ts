import exifr from "exifr";
import sharp from "sharp";
import { ApiError } from "./http";

export const ALLOWED_IMAGE_MIME = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"];

const VARIANTS = [
  { name: "thumb", size: 480, quality: 75 },
  { name: "display", size: 1600, quality: 82 },
  { name: "original", size: 2560, quality: 88 },
] as const;

export type ProcessedImage = {
  thumb: Buffer;
  display: Buffer;
  original: Buffer;
  width: number;
  height: number;
  bytes: number;
  takenAt: Date | null;
};

/**
 * 图片处理管线：自动纠正方向 → 生成 thumb / display / original 三个 webp 变体。
 * 只在服务端根据解码结果判定成功与否，不信任文件扩展名。
 */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
  try {
    const outputs: Record<string, { buffer: Buffer; width: number; height: number }> = {};

    for (const variant of VARIANTS) {
      const result = await sharp(input, { failOn: "error", limitInputPixels: 100_000_000 })
        .rotate()
        .resize({ width: variant.size, height: variant.size, fit: "inside", withoutEnlargement: true })
        .webp({ quality: variant.quality })
        .toBuffer({ resolveWithObject: true });
      outputs[variant.name] = {
        buffer: result.data,
        width: result.info.width,
        height: result.info.height,
      };
    }

    let takenAt: Date | null = null;
    try {
      const exif = (await exifr.parse(input, ["DateTimeOriginal", "CreateDate"])) as
        | { DateTimeOriginal?: Date; CreateDate?: Date }
        | undefined;
      takenAt = exif?.DateTimeOriginal ?? exif?.CreateDate ?? null;
    } catch {
      takenAt = null;
    }

    return {
      thumb: outputs.thumb.buffer,
      display: outputs.display.buffer,
      original: outputs.original.buffer,
      width: outputs.display.width,
      height: outputs.display.height,
      bytes: outputs.original.buffer.length,
      takenAt,
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(422, "IMAGE_DECODE_FAILED", `图片无法解码：${(error as Error).message}`);
  }
}
