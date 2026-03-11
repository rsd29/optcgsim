import type { AbilityDefinition, CardInstance, DomainEvent, GameState, PlayerId } from "../../game/types";
import { getCardAbilities as getPrintedAbilities, getCardKeywords } from "../../game/cardCatalog";

export type TriggeredAbilityCandidate = {
  sourceCard: CardInstance;
  sourcePlayerId: PlayerId;
  ability: AbilityDefinition;
};

export const collectIntrinsicAbilities = (state: GameState, card: CardInstance): AbilityDefinition[] => {
  const intrinsic: AbilityDefinition[] = [];
  if (getCardKeywords(state, card).includes("BLOCKER")) {
    intrinsic.push({
      abilityId: `INTRINSIC-${card.instanceId}-BLOCKER`,
      sourceCardId: card.cardId,
      timingClass: "ACTIVATED",
      conditions: [],
      costs: [],
      steps: [
        {
          id: "redirect_attack_to_self",
          kind: "REDIRECT_ATTACK_TO_SOURCE"
        }
      ],
      usageLimit: { kind: "NONE" },
      optional: false
    });
  }
  return intrinsic;
};

export const getCardAbilities = (state: GameState, card: CardInstance): AbilityDefinition[] => [
  ...getPrintedAbilities(state, card),
  ...collectIntrinsicAbilities(state, card)
];

export const collectTriggeredAbilitiesForEvent = (state: GameState, event: DomainEvent): TriggeredAbilityCandidate[] => {
  const candidates: TriggeredAbilityCandidate[] = [];
  const players = [state.players.P1, state.players.P2] as const;
  for (const player of players) {
    const allCards = [player.leader, ...player.characterArea];
    for (const card of allCards) {
        const abilities = getCardAbilities(state, card);
      for (const ability of abilities) {
        if (ability.timingClass !== "TRIGGERED") continue;
        if (!ability.trigger) continue;
        if (ability.trigger.event !== event.type) continue;
        candidates.push({
          sourceCard: card,
          sourcePlayerId: player.id,
          ability
        });
      }
    }
  }
  return candidates;
};
