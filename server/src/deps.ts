// Shared dependency bundle injected into the express app (and tests).
import type { Store } from "./db/store";
import type { SmsProvider } from "./lib/sms";
import type { OtpService } from "./lib/otp";
import type { StorageAdapter, PublicStorageAdapter } from "./lib/photos";
import type { ChunkAssembler } from "./lib/chunks";

export interface Deps {
  store: Store;
  otp: OtpService;
  sms: SmsProvider;
  storage: StorageAdapter;
  /** Private 'profile-photos' bucket (profile pictures only). */
  profileStorage: StorageAdapter;
  /** Public 'kit-images' bucket (kit catalogue images; public-read). */
  kitStorage: PublicStorageAdapter;
  chunks: ChunkAssembler;
  jwtSecret: string;
  secureCookies: boolean;
}
