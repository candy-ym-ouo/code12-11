import { env } from "../../config/env";
import { LocalDiskStorage } from "./localDisk";

export type StorageVariant = "thumb" | "display" | "original";

export interface StorageAdapter {
  put(key: string, body: Buffer, variant: StorageVariant, contentType: string): Promise<void>;
  read(key: string, variant: StorageVariant): Promise<Buffer>;
  remove(key: string, variant: StorageVariant): Promise<void>;
  publicUrl(key: string, variant: StorageVariant): string;
}

export const storage: StorageAdapter = new LocalDiskStorage(env.uploadDir);
