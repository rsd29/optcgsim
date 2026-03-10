import type { CardDefinition } from "./types";

export type MockCharacterCard = Required<Pick<CardDefinition, "cardId" | "name" | "cost" | "power">>;

/**
 * Edit this list to control the mock card pool used by starter deck generation.
 * Deck creation will randomly pick from this list for each of the 50 slots.
 */
export const MOCK_CHARACTER_CARD_POOL: MockCharacterCard[] = [
  { cardId: "C001", name: "East Blue Fighter", cost: 1, power: 2000 },
  { cardId: "C002", name: "Grand Line Guard", cost: 2, power: 3000 },
  { cardId: "C003", name: "Sky Island Scout", cost: 2, power: 4000 },
  { cardId: "C004", name: "Water Seven Brawler", cost: 3, power: 5000 },
  { cardId: "C005", name: "Wano Blade", cost: 4, power: 6000 },
  { cardId: "C006", name: "Pirate Veteran", cost: 5, power: 7000 },
  { cardId: "C007", name: "Marine Heavy", cost: 1, power: 8000 },
  { cardId: "C008", name: "Red Line Charger", cost: 1, power: 4000 },
  { cardId: "C009", name: "Calm Belt Sniper", cost: 1, power: 5000 },
  { cardId: "C010", name: "New World Raider", cost: 1, power: 6000 },
  { cardId: "C0011", name: "Strong guy", cost: 1, power: 10000 },
];
