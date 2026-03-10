/// <reference types="vite/client" />

import type { GameClientApi } from "./client/gameClient";

declare global {
  interface Window {
    OPTCG: GameClientApi;
  }
}

export {};
