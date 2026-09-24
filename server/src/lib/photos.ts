// Server-side photo pipeline — ported from spikes/photos/src/pipeline.mjs:
// validate -> EXIF auto-rotate + strip -> store original (private) -> 400px thumbnail.
import sharp from "sharp";
import type { PhotoAngle } from "../db/types";

export const ANGLES: PhotoAngle[] = ["hairline", "crown", "parting", "temples", "shedding"];
export const MAX_BYTES = 8 * 1024 * 1024; // 8 MB (contract)
const THUMB_WIDTH = 400;

export class PhotoError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface StorageAdapter {
  putPrivate(path: string, bytes: Buffer, contentType: string): Promise<void>;
  getSignedUrl(path: string, expiresSec: number): Promise<string>;
  delete(path: string): Promise<void>;
}

export interface ProcessedUpload {
  storagePath: string; thumbPath: string;
  signedUrl: string; thumbUrl: string;
  thumbBytes: Buffer; width: number | null; height: number | null;
  strippedExif: boolean;
}

export async function processUpload(
  storage: StorageAdapter,
  opts: { scanId: string; angle: PhotoAngle; bytes: Buffer },
): Promise<ProcessedUpload> {
  const { scanId, angle, bytes } = opts;
  if (!ANGLES.includes(angle)) throw new PhotoError(422, "invalid angle");
  if (bytes.length > MAX_BYTES) throw new PhotoError(413, "Photo exceeds 8 MB after compression.");

  let meta;
  try {
    meta = await sharp(bytes).metadata();
  } catch {
    throw new PhotoError(415, "unsupported image type");
  }
  if (!["jpeg", "png", "webp"].includes(meta.format || "")) {
    throw new PhotoError(415, "unsupported image type");
  }

  // .rotate() applies EXIF orientation; NOT calling .withMetadata() strips all EXIF.
  const normalized = await sharp(bytes).rotate().jpeg({ quality: 82 }).toBuffer();
  const outMeta = await sharp(normalized).metadata();

  const base = `scans/${scanId}/${angle}`;
  const storagePath = `${base}.jpg`;
  const thumbPath = `${base}-thumb.jpg`;
  await storage.putPrivate(storagePath, normalized, "image/jpeg");

  const thumb = await sharp(normalized).resize({ width: THUMB_WIDTH }).jpeg({ quality: 75 }).toBuffer();
  await storage.putPrivate(thumbPath, thumb, "image/jpeg");

  const [signedUrl, thumbUrl] = await Promise.all([
    storage.getSignedUrl(storagePath, 900),
    storage.getSignedUrl(thumbPath, 900),
  ]);
  return {
    storagePath, thumbPath, signedUrl, thumbUrl, thumbBytes: thumb,
    width: outMeta.width ?? null, height: outMeta.height ?? null,
    strippedExif: !outMeta.exif,
  };
}

/** Supabase Storage adapter (private bucket 'scan-photos'). */
export function supabaseStorage(sb: { storage: any }): StorageAdapter {
  const bucket = "scan-photos";
  return {
    async putPrivate(path, bytes, contentType) {
      const { error } = await sb.storage.from(bucket).upload(path, bytes, { contentType, upsert: true });
      if (error) throw error;
    },
    async getSignedUrl(path, expiresSec) {
      const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, expiresSec);
      if (error || !data) throw error ?? new Error("signed url failed");
      return data.signedUrl;
    },
    async delete(path) {
      await sb.storage.from(bucket).remove([path]);
    },
  };
}

/** In-memory storage for tests / dev fallback. */
export function memoryStorage(): StorageAdapter & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>();
  return {
    files,
    async putPrivate(path, bytes) { files.set(path, bytes); },
    async getSignedUrl(path, expiresSec) { return `memory://scan-photos/${path}?exp=${expiresSec}`; },
    async delete(path) { files.delete(path); },
  };
}
