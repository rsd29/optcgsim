import type { PlayerId, ReadableSnapshot } from "./types";

export const DEFAULT_PLAYER_CLOCK_SECONDS = 25 * 60;
export const LOW_TIME_WARNING_SECONDS = 5 * 60;

export const getTimeControlPlayerId = (snapshot: ReadableSnapshot | null): PlayerId => {
  if (
    snapshot?.match.combatStatus &&
    (snapshot.match.combatStatus === "BLOCK_WINDOW" || snapshot.match.combatStatus === "COUNTER_WINDOW")
  ) {
    return snapshot.currentAttack?.defendingPlayerId ?? snapshot.match.activePlayerId;
  }
  return snapshot?.match.activePlayerId ?? "P1";
};
