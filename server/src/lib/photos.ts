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

/** Supabase Storage adapter bound to an arbitrary bucket. */
function bucketStorage(sb: { storage: any }, bucket: string): StorageAdapter {
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

/** Supabase Storage adapter (private bucket 'scan-photos'). */
export function supabaseStorage(sb: { storage: any }): StorageAdapter {
  return bucketStorage(sb, "scan-photos");
}

/** Supabase Storage adapter (private bucket 'profile-photos'). */
export function profilePhotosStorage(sb: { storage: any }): StorageAdapter {
  return bucketStorage(sb, "profile-photos");
}

export interface ProcessedProfilePhoto {
  storagePath: string;
  signedUrl: string;
}

/**
 * Profile photo pipeline: validate -> EXIF auto-rotate + strip ->
 * 512px cover-crop -> store (private profile-photos bucket, upsert so a
 * re-upload replaces the previous photo at a stable path).
 */
export async function processProfilePhoto(
  storage: StorageAdapter,
  opts: { userId: string; bytes: Buffer },
): Promise<ProcessedProfilePhoto> {
  const { userId, bytes } = opts;
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
  const normalized = await sharp(bytes)
    .rotate()
    .resize(512, 512, { fit: "cover" })
    .jpeg({ quality: 82 })
    .toBuffer();
  const storagePath = `profiles/${userId}.jpg`;
  await storage.putPrivate(storagePath, normalized, "image/jpeg");
  const signedUrl = await storage.getSignedUrl(storagePath, 900);
  return { storagePath, signedUrl };
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

/** Storage adapter for PUBLIC buckets (kit catalogue images): no signed URLs,
 *  getPublicUrl() works for anyone once the bucket flag is public=true. */
export interface PublicStorageAdapter {
  put(path: string, bytes: Buffer, contentType: string): Promise<void>;
  publicUrl(path: string): string;
  delete(path: string): Promise<void>;
}

/** Supabase Storage adapter (public bucket 'kit-images'). */
export function supabasePublicStorage(sb: { storage: any }, bucket: string): PublicStorageAdapter {
  return {
    async put(path, bytes, contentType) {
      const { error } = await sb.storage.from(bucket).upload(path, bytes, { contentType, upsert: true });
      if (error) throw error;
    },
    publicUrl(path) {
      const { data } = sb.storage.from(bucket).getPublicUrl(path);
      return data.publicUrl;
    },
    async delete(path) {
      await sb.storage.from(bucket).remove([path]);
    },
  };
}

/** In-memory public storage for tests / dev fallback. */
export function memoryPublicStorage(bucket = "kit-images"): PublicStorageAdapter & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>();
  return {
    files,
    async put(path, bytes) { files.set(path, bytes); },
    publicUrl(path) { return `memory://${bucket}/${path}`; },
    async delete(path) { files.delete(path); },
  };
}

export interface ProcessedKitImage {
  storagePath: string; thumbPath: string;
  imageUrl: string; thumbUrl: string;
  width: number | null; height: number | null;
  strippedExif: boolean;
}

/**
 * Kit catalogue image pipeline: validate -> EXIF auto-rotate + strip ->
 * normalized JPEG (max 1600px) -> store (PUBLIC kit-images bucket) ->
 * 400px thumbnail. Returns public URLs; the caller appends imageUrl to
 * kit.images[].
 */
export async function processKitImage(
  storage: PublicStorageAdapter,
  opts: { kitId: string; bytes: Buffer; filename?: string },
): Promise<ProcessedKitImage> {
  const { kitId, bytes, filename } = opts;
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
  const normalized = await sharp(bytes)
    .rotate()
    .resize({ width: 1600, withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
  const outMeta = await sharp(normalized).metadata();

  const stem = `kits/${kitId}/${Date.now()}-${(filename ?? "image").replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const storagePath = `${stem}.jpg`;
  const thumbPath = `${stem}-thumb.jpg`;
  await storage.put(storagePath, normalized, "image/jpeg");

  const thumb = await sharp(normalized).resize({ width: THUMB_WIDTH }).jpeg({ quality: 75 }).toBuffer();
  await storage.put(thumbPath, thumb, "image/jpeg");

  return {
    storagePath, thumbPath,
    imageUrl: storage.publicUrl(storagePath),
    thumbUrl: storage.publicUrl(thumbPath),
    width: outMeta.width ?? null, height: outMeta.height ?? null,
    strippedExif: !outMeta.exif,
  };
}

/** Recover the storage path from a public URL issued by publicUrl() above. */
export function pathFromPublicUrl(bucket: string, url: string): string {
  const marker = `/${bucket}/`;
  const i = url.indexOf(marker);
  if (i >= 0) return url.slice(i + marker.length);
  return url; // already a bare path
}
