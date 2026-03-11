import type { AbilityDefinition, CardDefinition, CardInstance, CardKeyword, GameState } from "./types";
import { resolveCardArtUrl, type CardArtSize } from "./cardArtResolver";

export const getCardDefinition = (state: GameState, cardId: string): CardDefinition | null =>
  state.cardDefinitions[cardId] ?? null;

export const getCardName = (state: GameState, card: CardInstance): string =>
  getCardDefinition(state, card.cardId)?.name ?? card.name;

export const getCardCost = (state: GameState, card: CardInstance): number =>
  getCardDefinition(state, card.cardId)?.cost ?? card.cost ?? 0;

export const getCardPower = (state: GameState, card: CardInstance): number =>
  getCardDefinition(state, card.cardId)?.power ?? card.power ?? 0;

export const getCardLife = (state: GameState, card: CardInstance): number | undefined =>
  getCardDefinition(state, card.cardId)?.life;

export const getCardCounter = (state: GameState, card: CardInstance): number | undefined =>
  getCardDefinition(state, card.cardId)?.counter ?? card.counter;

export const getCardKeywords = (state: GameState, card: CardInstance): CardKeyword[] => {
  const fromCatalog = getCardDefinition(state, card.cardId)?.keywords;
  if (Array.isArray(fromCatalog)) return fromCatalog;
  return card.keywords ?? ([] as CardKeyword[]);
};

export const getCardAbilities = (state: GameState, card: CardInstance): AbilityDefinition[] => {
  const fromCatalog = getCardDefinition(state, card.cardId)?.abilities;
  if (Array.isArray(fromCatalog)) return fromCatalog;
  return card.abilities ?? [];
};

export const getCardArtUrlForCard = (state: GameState, card: CardInstance, size: CardArtSize = "medium"): string =>
  resolveCardArtUrl(getCardDefinition(state, card.cardId)?.art, size);
