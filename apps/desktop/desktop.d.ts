import type { LyntarIpcApi } from '@lyntar/contracts';

declare global {
  interface Window {
    lyntar: LyntarIpcApi;
  }
}

export {};
