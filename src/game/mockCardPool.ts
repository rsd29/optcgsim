import type { CardDefinition } from "./types";

/**
 * Tiny starter pool for current MVP:
 * - 2 vanilla leaders
 * - a few vanilla characters
 * - 1 blocker
 * - 1 counter-focused vanilla body
 *
 * Notes:
 * - Counter cards are still just data for now unless gameplay wires counter timing.
 * - The blocker works immediately because the engine checks `keywords.includes("BLOCKER")`.
 */
export const DEMO_CARD_POOL: CardDefinition[] = [
  // =========================
  // Vanilla Leaders
  // =========================
  {
    cardId: "L001",
    name: "Monkey D. Luffy (Rainbow)",
    type: "LEADER",
    life: 5,
    power: 5000,
    colors: ["RED", "GREEN", "BLUE", "PURPLE", "BLACK", "YELLOW"],
    subtypes: ["Straw Hat Crew"],
    attributes: ["Strike"],
    art: { assetId: "OP01-001", variant: "default" },
    text: "By rule, this leader can only be used in the specified event."
  },
  // =========================
  // Real Character Cards
  // =========================
  {
    cardId: "OP13-090",
    name: "Hack",
    type: "CHARACTER",
    cost: 6,
    power: 7000,
    counter: 2000,
    colors: ["BLACK"],
    subtypes: ["Fish-Man", "Dressrosa", "Revolutionary Army"],
    attributes: ["Strike"],
    art: { assetId: "OP13-090", variant: "default" },
    text: ""
  },
  {
    cardId: "ST01-006",
    name: "Tony Tony.Chopper",
    type: "CHARACTER",
    cost: 1,
    power: 1000,
    colors: ["RED"],
    subtypes: ["Animal", "Straw Hat Crew"],
    attributes: ["Strike"],
    keywords: ["BLOCKER"],
    art: { assetId: "ST01-006", variant: "default" },
    text: "[Blocker]"
  }
];
