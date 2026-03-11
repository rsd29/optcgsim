import type { CardInstance, EffectInstance, EffectStep, GameState, PlayerId, Zone } from "../../game/types";
import type { TriggeredAbilityCandidate } from "./abilities";
import { createDomainEvent } from "./domainEvents";
import { addLastingModifier } from "./modifiers";
import { createTargetPrompt } from "./prompts";
import { payAllCosts } from "./rules";
import { applyDomainEvent } from "./stateTransitions";

let effectCounter = 1;

export const resetEffectCounter = (): void => {
  effectCounter = 1;
};

const nextEffectId = (): string => {
  const id = `FX-${String(effectCounter).padStart(6, "0")}`;
  effectCounter += 1;
  return id;
};

export const createEffectInstanceFromTriggeredAbility = (candidate: TriggeredAbilityCandidate): EffectInstance => ({
  effectInstanceId: nextEffectId(),
  sourceCardInstanceId: candidate.sourceCard.instanceId,
  sourcePlayerId: candidate.sourcePlayerId,
  controllerPlayerId: candidate.sourcePlayerId,
  ability: candidate.ability,
  stepIndex: 0,
  waitingForSelection: false,
  createdAt: Date.now()
});

export const enqueueEffectInstances = (state: GameState, instances: EffectInstance[]): void => {
  if (instances.length === 0) return;
  for (const effect of instances) {
    applyDomainEvent(
      state,
      createDomainEvent("EFFECT_QUEUED", {
        effectInstanceId: effect.effectInstanceId,
        sourcePlayerId: effect.sourcePlayerId
      })
    );
  }
  state.effectsQueue.push(...instances);
};

const findCardOnBoard = (state: GameState, cardInstanceId: string): CardInstance | null => {
  for (const player of [state.players.P1, state.players.P2] as const) {
    if (player.leader.instanceId === cardInstanceId) return player.leader;
    const inChars = player.characterArea.find((c) => c.instanceId === cardInstanceId);
    if (inChars) return inChars;
  }
  return null;
};

const moveCardBetweenPublicZones = (
  state: GameState,
  playerId: PlayerId,
  from: Zone,
  to: Zone,
  cardInstanceId: string
): CardInstance | null => {
  const player = state.players[playerId];
  const zone = (z: Zone): CardInstance[] => {
    switch (z) {
      case "HAND":
        return player.hand;
      case "DECK":
        return player.deck;
      case "LIFE":
        return player.life;
      case "TRASH":
        return player.trash;
      case "CHARACTER_AREA":
        return player.characterArea;
      default:
        return [];
    }
  };
  const fromZone = zone(from);
  const idx = fromZone.findIndex((c) => c.instanceId === cardInstanceId);
  if (idx < 0) return null;
  const [card] = fromZone.splice(idx, 1);
  if (!card) return null;
  zone(to).push(card);
  applyDomainEvent(state, createDomainEvent("CARD_MOVED", { playerId, from, to, cardId: cardInstanceId }));
  return card;
};

const executeEffectStep = (state: GameState, effect: EffectInstance, step: EffectStep): boolean => {
  const controller = state.players[effect.controllerPlayerId];
  const resolveCardRef = (raw: unknown): string => {
    const value = String(raw ?? "");
    if (value === "$SOURCE") return effect.sourceCardInstanceId ?? "";
    return value;
  };
  switch (step.kind) {
    case "DRAW": {
      const amount = Number(step.params?.amount ?? 1);
      for (let i = 0; i < amount; i += 1) {
        const card = controller.deck.shift();
        if (!card) break;
        controller.hand.push(card);
        applyDomainEvent(state, createDomainEvent("CARD_DRAWN", { playerId: controller.id, card: card.name }));
      }
      return true;
    }
    case "REST_CARD": {
      const cardId = resolveCardRef(step.params?.cardInstanceId);
      const target = findCardOnBoard(state, cardId);
      if (!target) return true;
      target.rested = true;
      return true;
    }
    case "ACTIVATE_CARD": {
      const cardId = resolveCardRef(step.params?.cardInstanceId);
      const target = findCardOnBoard(state, cardId);
      if (!target) return true;
      target.rested = false;
      return true;
    }
    case "MOVE_CARD": {
      const cardId = resolveCardRef(step.params?.cardInstanceId);
      const from = String(step.params?.from ?? "HAND") as Zone;
      const to = String(step.params?.to ?? "TRASH") as Zone;
      moveCardBetweenPublicZones(state, controller.id, from, to, cardId);
      return true;
    }
    case "TRASH_CARD":
    case "KO_CARD": {
      const cardId = resolveCardRef(step.params?.cardInstanceId);
      moveCardBetweenPublicZones(state, controller.id, "CHARACTER_AREA", "TRASH", cardId);
      return true;
    }
    case "ADD_POWER": {
      const cardId = resolveCardRef(step.params?.cardInstanceId);
      const amount = Number(step.params?.amount ?? 0);
      const duration = String(step.params?.duration ?? "END_OF_TURN");
      addLastingModifier(state, {
        sourceCardInstanceId: effect.sourceCardInstanceId ?? cardId,
        affectedCardInstanceIds: [cardId],
        changes: { powerDelta: amount },
        expiresAt: duration === "END_OF_BATTLE" ? { type: "END_OF_BATTLE" } : { type: "END_OF_TURN", turnNumber: state.turnNumber }
      });
      return true;
    }
    case "SET_FLAG": {
      const cardId = resolveCardRef(step.params?.cardInstanceId);
      const flag = String(step.params?.flag ?? "");
      const value = step.params?.value;
      const duration = String(step.params?.duration ?? "END_OF_TURN");
      addLastingModifier(state, {
        sourceCardInstanceId: effect.sourceCardInstanceId ?? cardId,
        affectedCardInstanceIds: [cardId],
        changes: { [flag]: value },
        expiresAt: duration === "END_OF_BATTLE" ? { type: "END_OF_BATTLE" } : { type: "END_OF_TURN", turnNumber: state.turnNumber }
      });
      return true;
    }
    case "REVEAL_CARD": {
      // TODO: route to private-information-safe reveal channel.
      return true;
    }
    case "GAIN_DON": {
      const amount = Number(step.params?.amount ?? 1);
      for (let i = 0; i < amount; i += 1) {
        const don = controller.donDeck.shift();
        if (!don) break;
        controller.donActive.push(don);
      }
      return true;
    }
    case "ATTACH_DON": {
      const cardId = resolveCardRef(step.params?.cardInstanceId);
      const amount = Number(step.params?.amount ?? 1);
      if (!controller.attachedDon[cardId]) controller.attachedDon[cardId] = 0;
      const attachAmount = Math.min(amount, controller.donActive.length);
      controller.attachedDon[cardId] += attachAmount;
      for (let i = 0; i < attachAmount; i += 1) {
        controller.donActive.shift();
      }
      return true;
    }
    case "REMOVE_DON": {
      const cardId = resolveCardRef(step.params?.cardInstanceId);
      const amount = Number(step.params?.amount ?? 1);
      const current = controller.attachedDon[cardId] ?? 0;
      const removeAmount = Math.min(current, amount);
      controller.attachedDon[cardId] = Math.max(0, current - removeAmount);
      return true;
    }
    case "PROMPT_SELECT_TARGETS": {
      createTargetPrompt(
        state,
        effect.controllerPlayerId,
        String(step.params?.title ?? "Select targets"),
        "SELECT_TARGETS",
        ["CHARACTER_AREA"],
        Number(step.params?.minSelections ?? 1),
        Number(step.params?.maxSelections ?? 1),
        effect.effectInstanceId
      );
      effect.waitingForSelection = true;
      return false;
    }
    default:
      return true;
  }
};

export const resolveEffectQueue = (state: GameState): void => {
  while (state.effectsQueue.length > 0) {
    const effect = state.effectsQueue.shift();
    if (!effect) break;
    if (effect.stepIndex === 0) {
      const sourceCard = effect.sourceCardInstanceId ? findCardOnBoard(state, effect.sourceCardInstanceId) : undefined;
      const ruleContext =
        sourceCard !== null && sourceCard !== undefined
          ? {
              state,
              sourceCard,
              controllerPlayerId: effect.controllerPlayerId
            }
          : {
              state,
              controllerPlayerId: effect.controllerPlayerId
            };
      const canPay = payAllCosts(
        ruleContext,
        effect.ability.costs
      );
      if (!canPay) continue;
    }
    while (effect.stepIndex < effect.ability.steps.length) {
      const step = effect.ability.steps[effect.stepIndex];
      if (!step) break;
      const shouldContinue = executeEffectStep(state, effect, step);
      if (!shouldContinue) {
        state.effectsQueue.unshift(effect);
        break;
      }
      effect.stepIndex += 1;
    }
    if (effect.stepIndex >= effect.ability.steps.length) {
      applyDomainEvent(
        state,
        createDomainEvent("EFFECT_RESOLVED", {
          effectInstanceId: effect.effectInstanceId,
          sourcePlayerId: effect.sourcePlayerId
        })
      );
    }
  }
};
