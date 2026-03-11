import type { CardInstance, CardKeyword, GameState, LastingModifier } from "../../game/types";
import { getCardKeywords, getCardPower } from "../../game/cardCatalog";

let modifierCounter = 1;

const nextModifierId = (): string => {
  const id = `MOD-${String(modifierCounter).padStart(6, "0")}`;
  modifierCounter += 1;
  return id;
};

export const resetModifierCounter = (): void => {
  modifierCounter = 1;
};

export const addLastingModifier = (
  state: GameState,
  input: Omit<LastingModifier, "modifierId">
): LastingModifier => {
  const modifier: LastingModifier = {
    ...input,
    modifierId: nextModifierId()
  };
  state.lastingModifiers.push(modifier);
  return modifier;
};

export const getEffectivePower = (state: GameState, card: CardInstance): number => {
  const base = getCardPower(state, card);
  const bonus = state.lastingModifiers.reduce((acc, mod) => {
    if (!mod.affectedCardInstanceIds.includes(card.instanceId)) return acc;
    const delta = mod.changes.powerDelta;
    return acc + (typeof delta === "number" ? delta : 0);
  }, 0);
  return base + bonus;
};

export const getGrantedKeywords = (state: GameState, card: CardInstance): CardKeyword[] => {
  const out = new Set<CardKeyword>(getCardKeywords(state, card));
  for (const mod of state.lastingModifiers) {
    if (!mod.affectedCardInstanceIds.includes(card.instanceId)) continue;
    const granted = mod.changes.grantedKeywords;
    if (Array.isArray(granted)) {
      for (const keyword of granted) {
        if (typeof keyword === "string") {
          out.add(keyword as CardKeyword);
        }
      }
    }
  }
  return [...out];
};

export const expireTurnModifiers = (state: GameState, turnNumber: number): void => {
  state.lastingModifiers = state.lastingModifiers.filter((mod) => {
    if (mod.expiresAt.type !== "END_OF_TURN") return true;
    return mod.expiresAt.turnNumber !== turnNumber;
  });
};

export const expireBattleModifiers = (state: GameState): void => {
  state.lastingModifiers = state.lastingModifiers.filter((mod) => mod.expiresAt.type !== "END_OF_BATTLE");
};
