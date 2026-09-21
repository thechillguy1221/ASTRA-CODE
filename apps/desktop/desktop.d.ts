import type { AstraIpcApi } from '@astra/contracts';

declare global {
  interface Window {
    astra: AstraIpcApi;
  }
}

export {};
