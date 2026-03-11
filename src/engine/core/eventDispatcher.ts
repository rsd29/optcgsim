import type { DomainEvent, GameState } from "../../game/types";
import { collectTriggeredAbilitiesForEvent } from "./abilities";
import { createEffectInstanceFromTriggeredAbility, enqueueEffectInstances, resolveEffectQueue } from "./effects";

export const dispatchDomainEvent = (state: GameState, event: DomainEvent): void => {
  const triggered = collectTriggeredAbilitiesForEvent(state, event);
  if (triggered.length === 0) return;
  const instances = triggered.map(createEffectInstanceFromTriggeredAbility);
  enqueueEffectInstances(state, instances);
  resolveEffectQueue(state);
};
