import type { CardInstance, GameState, LegalAction, LegalActionsByPlayer, PlayerId } from "../../game/types";
import { getCardCost, getCardKeywords } from "../../game/cardCatalog";

const opponentId = (playerId: PlayerId): PlayerId => (playerId === "P1" ? "P2" : "P1");

const canAttackWith = (state: GameState, playerId: PlayerId, card: CardInstance): boolean => {
  if (state.status !== "IN_PROGRESS") return false;
  if (state.phase !== "MAIN") return false;
  if (state.activePlayerId !== playerId) return false;
  if (state.priorityPlayerId !== playerId) return false;
  if (state.combat.attack) return false;
  if (card.rested) return false;
  if (card.type === "LEADER" && state.players[playerId].turnsTaken === 0) return false;
  if (card.type === "CHARACTER" && card.summoningSick) return false;
  return true;
};

const collectPlayAction = (state: GameState, playerId: PlayerId): LegalAction | null => {
  if (state.status !== "IN_PROGRESS") return null;
  if (state.phase !== "MAIN") return null;
  if (state.activePlayerId !== playerId) return null;
  if (state.priorityPlayerId !== playerId) return null;
  if (state.combat.attack) return null;
  const player = state.players[playerId];
  const playableCards = player.hand
    .map((card, i) => ({ card, i }))
    .filter(({ card }) => card.type === "CHARACTER" && getCardCost(state, card) <= player.donActive.length)
    .map(({ card, i }) => ({
      handIndex: i,
      cardInstanceId: card.instanceId,
      cost: getCardCost(state, card)
    }));
  const handIndexes = playableCards.map((c) => c.handIndex);
  if (handIndexes.length === 0) return null;
  return {
    type: "PLAY_CHARACTER",
    playerId,
    handIndexes,
    playableCards,
    replaceRequired: player.characterArea.length >= 5,
    replaceableCharacterRefs: player.characterArea.map((c) => c.instanceId)
  };
};

const collectAttackLeaderAction = (state: GameState, playerId: PlayerId): LegalAction | null => {
  const player = state.players[playerId];
  const attackerRefs: Array<"leader" | string> = [];
  if (canAttackWith(state, playerId, player.leader)) {
    attackerRefs.push("leader");
  }
  for (const card of player.characterArea) {
    if (canAttackWith(state, playerId, card)) {
      attackerRefs.push(card.instanceId);
    }
  }
  if (attackerRefs.length === 0) return null;
  return {
    type: "ATTACK_LEADER",
    playerId,
    attackerRefs,
    attackOptions: attackerRefs.map((attackerRef) => ({ attackerRef, target: "LEADER" as const }))
  };
};

const collectAttackCharacterAction = (state: GameState, playerId: PlayerId): LegalAction | null => {
  if (state.status !== "IN_PROGRESS") return null;
  if (state.phase !== "MAIN") return null;
  if (state.activePlayerId !== playerId) return null;
  if (state.priorityPlayerId !== playerId) return null;
  if (state.combat.attack) return null;
  const player = state.players[playerId];
  const opponent = state.players[opponentId(playerId)];
  const defenderRefs = opponent.characterArea.filter((c) => c.rested).map((c) => c.instanceId);
  if (defenderRefs.length === 0) return null;
  const attackerRefs: Array<"leader" | string> = [];
  if (canAttackWith(state, playerId, player.leader)) {
    attackerRefs.push("leader");
  }
  for (const card of player.characterArea) {
    if (canAttackWith(state, playerId, card)) {
      attackerRefs.push(card.instanceId);
    }
  }
  if (attackerRefs.length === 0) return null;
  const attackOptions: Array<{ attackerRef: "leader" | string; defenderRef: string; target: "CHARACTER" }> = [];
  for (const attackerRef of attackerRefs) {
    for (const defenderRef of defenderRefs) {
      attackOptions.push({ attackerRef, defenderRef, target: "CHARACTER" });
    }
  }
  return { type: "ATTACK_CHARACTER", playerId, attackerRefs, defenderRefs, attackOptions };
};

const collectBlockActions = (state: GameState, playerId: PlayerId): LegalAction[] => {
  const attack = state.combat.attack;
  if (!attack) return [];
  if (state.combat.status !== "BLOCK_WINDOW") return [];
  if (attack.defendingPlayerId !== playerId) return [];
  if (state.priorityPlayerId !== playerId) return [];
  const player = state.players[playerId];
  const blockers = player.characterArea
    .filter((c) => !c.rested && getCardKeywords(state, c).includes("BLOCKER"))
    .map((c) => c.instanceId);
  const actions: LegalAction[] = [{ type: "PASS_BLOCK", playerId }];
  if (blockers.length > 0) {
    actions.unshift({ type: "BLOCK_ATTACK", playerId, blockerRefs: blockers });
  }
  return actions;
};

const collectEndTurnAction = (state: GameState, playerId: PlayerId): LegalAction | null => {
  if (state.status !== "IN_PROGRESS") return null;
  if (state.phase !== "MAIN") return null;
  if (state.activePlayerId !== playerId) return null;
  if (state.priorityPlayerId !== playerId) return null;
  if (state.combat.attack) return null;
  return { type: "END_TURN", playerId };
};

export const generateLegalActionsForPlayer = (state: GameState, playerId: PlayerId): LegalAction[] => {
  if (state.pendingPrompt) {
    if (state.pendingPrompt.controllerPlayerId !== playerId) return [];
    const promptOnly: LegalAction[] = [{ type: "RESOLVE_PROMPT", playerId, promptId: state.pendingPrompt.promptId }];
    if (state.pendingPrompt.allowAlternativeActions !== true) {
      return promptOnly;
    }
    const alternatives: LegalAction[] = [];
    alternatives.push(...collectBlockActions(state, playerId));
    const play = collectPlayAction(state, playerId);
    if (play) alternatives.push(play);
    const attackLeader = collectAttackLeaderAction(state, playerId);
    if (attackLeader) alternatives.push(attackLeader);
    const attackCharacter = collectAttackCharacterAction(state, playerId);
    if (attackCharacter) alternatives.push(attackCharacter);
    const endTurn = collectEndTurnAction(state, playerId);
    if (endTurn) alternatives.push(endTurn);
    return [...promptOnly, ...alternatives];
  }

  const out: LegalAction[] = [];
  out.push(...collectBlockActions(state, playerId));
  const play = collectPlayAction(state, playerId);
  if (play) out.push(play);
  const attackLeader = collectAttackLeaderAction(state, playerId);
  if (attackLeader) out.push(attackLeader);
  const attackCharacter = collectAttackCharacterAction(state, playerId);
  if (attackCharacter) out.push(attackCharacter);
  const endTurn = collectEndTurnAction(state, playerId);
  if (endTurn) out.push(endTurn);
  return out;
};

export const generateLegalActions = (state: GameState): LegalActionsByPlayer => ({
  P1: generateLegalActionsForPlayer(state, "P1"),
  P2: generateLegalActionsForPlayer(state, "P2")
});
