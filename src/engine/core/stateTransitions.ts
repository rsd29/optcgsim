import type { DomainEvent, GameState } from "../../game/types";
import { dispatchDomainEvent } from "./eventDispatcher";

const EVENT_LOG_LIMIT = 200;
const DOMAIN_EVENT_LOG_LIMIT = 600;

export const applyDomainEvent = (state: GameState, event: DomainEvent): void => {
  state.domainEvents.push(event);
  if (state.domainEvents.length > DOMAIN_EVENT_LOG_LIMIT) {
    state.domainEvents.shift();
  }

  state.log.push({
    type: event.type,
    payload: event.payload,
    createdAt: event.createdAt
  });
  if (state.log.length > EVENT_LOG_LIMIT) {
    state.log.shift();
  }

  dispatchDomainEvent(state, event);
};
