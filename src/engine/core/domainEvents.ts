import type { DomainEvent, DomainEventPayloadMap, DomainEventType } from "../../game/types";

let domainEventCounter = 1;

export const resetDomainEventCounter = (): void => {
  domainEventCounter = 1;
};

export const createDomainEvent = <T extends DomainEventType>(
  type: T,
  payload: T extends keyof DomainEventPayloadMap ? DomainEventPayloadMap[T] : Record<string, unknown>
): DomainEvent<T> => {
  const id = `EVT-${String(domainEventCounter).padStart(6, "0")}`;
  domainEventCounter += 1;
  return {
    id,
    type,
    payload,
    createdAt: Date.now()
  };
};
