import type { GameState } from "../../game/types";

export const assertEngineInvariants = (state: GameState): void => {
  if (state.activePlayerId !== "P1" && state.activePlayerId !== "P2") {
    throw new Error("Invariant violation: activePlayerId must be P1 or P2.");
  }
  if (state.priorityPlayerId !== "P1" && state.priorityPlayerId !== "P2") {
    throw new Error("Invariant violation: priorityPlayerId must be P1 or P2.");
  }
  if (state.combat.status === "IDLE" && state.combat.attack !== null) {
    throw new Error("Invariant violation: combat attack must be null while combat status is IDLE.");
  }
  if (state.combat.status !== "IDLE" && state.combat.attack === null) {
    throw new Error("Invariant violation: combat attack must exist while combat status is non-IDLE.");
  }
  if (!state.legalActions.P1 || !state.legalActions.P2) {
    throw new Error("Invariant violation: legal actions must be tracked for both players.");
  }
  if (state.pendingPrompt && state.pendingSelection) {
    throw new Error("Invariant violation: pendingPrompt and pendingSelection cannot both be active.");
  }
};
