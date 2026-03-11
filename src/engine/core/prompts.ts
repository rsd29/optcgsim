import type { GameState, PlayerId, PromptKind, PromptState } from "../../game/types";
import { createDomainEvent } from "./domainEvents";
import { applyDomainEvent } from "./stateTransitions";

let promptCounter = 1;

const nextPromptId = (): string => {
  const id = `PRM-${String(promptCounter).padStart(6, "0")}`;
  promptCounter += 1;
  return id;
};

export const resetPromptCounter = (): void => {
  promptCounter = 1;
};

export const openPrompt = (
  state: GameState,
  input: Omit<PromptState, "promptId" | "createdAt">
): PromptState => {
  const prompt: PromptState = {
    ...input,
    promptId: nextPromptId(),
    createdAt: Date.now()
  };
  state.pendingPrompt = prompt;
  applyDomainEvent(
    state,
    createDomainEvent("PROMPT_OPENED", {
      promptId: prompt.promptId,
      playerId: prompt.controllerPlayerId,
      kind: prompt.kind
    })
  );
  return prompt;
};

export const resolvePrompt = (
  state: GameState,
  playerId: PlayerId,
  promptId: string,
  _payload: {
    selectedCardInstanceIds?: string[];
    selectedOptionId?: string;
    yesNoChoice?: boolean;
  }
): void => {
  const prompt = state.pendingPrompt;
  if (!prompt) throw new Error("No pending prompt.");
  if (prompt.promptId !== promptId) throw new Error("Prompt id mismatch.");
  if (prompt.controllerPlayerId !== playerId) throw new Error("Only prompt controller can resolve this prompt.");
  state.pendingPrompt = null;
  applyDomainEvent(state, createDomainEvent("PROMPT_RESOLVED", { promptId, playerId }));
};

export const createYesNoPrompt = (
  state: GameState,
  controllerPlayerId: PlayerId,
  title: string,
  sourceEffectInstanceId?: string
): PromptState =>
  openPrompt(state, {
    kind: "YES_NO",
    controllerPlayerId,
    title,
    options: [
      { id: "yes", label: "Yes" },
      { id: "no", label: "No" }
    ],
    ...(sourceEffectInstanceId ? { sourceEffectInstanceId } : {})
  });

export const createTargetPrompt = (
  state: GameState,
  controllerPlayerId: PlayerId,
  title: string,
  kind: PromptKind,
  zones: PromptState["zones"],
  minSelections = 1,
  maxSelections = 1,
  sourceEffectInstanceId?: string
): PromptState =>
  openPrompt(state, {
    kind,
    controllerPlayerId,
    title,
    ...(zones ? { zones } : {}),
    minSelections,
    maxSelections,
    ...(sourceEffectInstanceId ? { sourceEffectInstanceId } : {})
  });
