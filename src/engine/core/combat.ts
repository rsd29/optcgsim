import type { AttackState, CombatState, PlayerId } from "../../game/types";

export const createIdleCombatState = (): CombatState => ({
  combatId: 0,
  status: "IDLE",
  attack: null
});

export const declareAttack = (
  currentCombat: CombatState,
  attack: Omit<AttackState, "blockPhaseOpen" | "resolved">
): CombatState => ({
  combatId: currentCombat.combatId + 1,
  status: "ATTACK_DECLARED",
  attack: {
    ...attack,
    blockPhaseOpen: false,
    resolved: false
  }
});

export const openBlockWindow = (combat: CombatState): CombatState => {
  if (!combat.attack) return combat;
  return {
    ...combat,
  status: "BLOCK_WINDOW",
  attack: {
      ...combat.attack,
    blockPhaseOpen: true,
      resolved: false
    }
  };
};

export const closeBlockWindow = (combat: CombatState): CombatState => {
  if (!combat.attack) return combat;
  return {
    ...combat,
    status: "COUNTER_WINDOW",
    attack: {
      ...combat.attack,
      blockPhaseOpen: false
    }
  };
};

export const closeCounterWindowForResolution = (combat: CombatState): CombatState => {
  if (!combat.attack) return combat;
  return {
    ...combat,
    status: "DAMAGE_RESOLUTION",
    attack: {
      ...combat.attack,
      blockPhaseOpen: false
    }
  };
};

export const setBlockedTarget = (combat: CombatState, defendingCharacterId: string): CombatState => {
  if (!combat.attack) return combat;
  return {
    ...combat,
    status: "DAMAGE_RESOLUTION",
    attack: {
      ...combat.attack,
      target: "CHARACTER",
      defendingCharacterId,
      blockPhaseOpen: false
    }
  };
};

export const completeCombat = (combat: CombatState): CombatState => {
  if (!combat.attack) return createIdleCombatState();
  return {
    ...combat,
    status: "POST_BATTLE",
    attack: {
      ...combat.attack,
      resolved: true,
      blockPhaseOpen: false
    }
  };
};

export const finalizeCombat = (combat: CombatState): CombatState => ({
  ...combat,
  status: "COMPLETE"
});

export const isCombatBlocking = (combat: CombatState): boolean =>
  combat.status === "BLOCK_WINDOW" && Boolean(combat.attack?.blockPhaseOpen);

export const canPlayerRespondToBlockWindow = (combat: CombatState, playerId: PlayerId): boolean =>
  isCombatBlocking(combat) && combat.attack?.defendingPlayerId === playerId;
