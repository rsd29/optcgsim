import type { PlayerId } from "./types";

export type StartMatchRequestOptions = {
  testStartWithTenDon?: boolean;
  firstPlayerId?: PlayerId;
  p1Roll?: number;
  p2Roll?: number;
  initialClockSeconds?: number;
};
