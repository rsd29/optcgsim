import type { ClientRequest } from "../../game/protocol";
import type { GameState, LegalAction, PlayerId } from "../../game/types";
import { generateLegalActionsForPlayer } from "./legalActions";

export type RequestExecutionHandlers = {
  startMatch: (playerAName: string, playerBName: string, testStartWithTenDon: boolean) => GameState;
  playCharacter: (playerId: PlayerId, handIndex?: number, replaceRef?: number | string) => GameState;
  attackLeader: (playerId: PlayerId, attackerRef: "leader" | number | string) => GameState;
  attackCharacter: (playerId: PlayerId, attackerRef: "leader" | number | string, defenderRef: number | string) => GameState;
  blockAttack: (playerId: PlayerId, blockerRef: number | string) => GameState;
  passBlock: (playerId: PlayerId) => GameState;
  endTurn: (playerId: PlayerId) => GameState;
  declareTimeoutLoss: (loserId: PlayerId) => GameState;
  autoMainStep: (playerId: PlayerId) => GameState;
  autoPlay: (playerId: PlayerId, maxSteps: number) => GameState;
  resolvePrompt: (
    playerId: PlayerId,
    promptId: string,
    payload: {
      selectedCardInstanceIds?: string[];
      selectedOptionId?: string;
      yesNoChoice?: boolean;
    }
  ) => GameState;
};

const findLegalAction = <T extends LegalAction["type"]>(
  legalActions: LegalAction[],
  type: T
): Extract<LegalAction, { type: T }> | null => {
  const found = legalActions.find((action) => action.type === type);
  if (!found) return null;
  return found as Extract<LegalAction, { type: T }>;
};

const assertLegalActionExists = (legalActions: LegalAction[], playerId: PlayerId, type: LegalAction["type"]): void => {
  if (!legalActions.some((action) => action.type === type)) {
    throw new Error(`Illegal action: ${type} is not legal for ${playerId} right now.`);
  }
};

const assertPromptLockAllowsRequest = (state: GameState, request: ClientRequest): void => {
  const pendingPrompt = state.pendingPrompt;
  if (!pendingPrompt) return;
  if (pendingPrompt.allowAlternativeActions === true) return;
  if (request.type === "RESOLVE_PROMPT") return;
  if (request.type === "GET_STATE") return;
  if (request.type === "AUTO_MAIN_STEP" || request.type === "AUTO_PLAY") return;
  throw new Error("A mandatory prompt is pending. Resolve it before taking other actions.");
};

export const processRequestWithValidation = (
  state: GameState | null,
  request: ClientRequest,
  handlers: RequestExecutionHandlers
): GameState | null => {
  switch (request.type) {
    case "GET_STATE":
      return state;
    case "START_MATCH":
      return handlers.startMatch(
        request.payload.playerAName,
        request.payload.playerBName,
        request.payload.testStartWithTenDon === true
      );
    case "DECLARE_TIMEOUT_LOSS":
      if (!state) throw new Error("No match started yet.");
      return handlers.declareTimeoutLoss(request.payload.loserId);
    case "AUTO_MAIN_STEP":
      if (!state) throw new Error("No match started yet.");
      return handlers.autoMainStep(request.payload.playerId);
    case "AUTO_PLAY":
      if (!state) throw new Error("No match started yet.");
      return handlers.autoPlay(request.payload.playerId, request.payload.maxSteps);
    case "PLAY_CHARACTER":
      if (!state) throw new Error("No match started yet.");
      assertPromptLockAllowsRequest(state, request);
      {
        const legal = generateLegalActionsForPlayer(state, request.payload.playerId);
        assertLegalActionExists(legal, request.payload.playerId, "PLAY_CHARACTER");
        const playAction = findLegalAction(legal, "PLAY_CHARACTER");
        if (!playAction) throw new Error("Illegal action: PLAY_CHARACTER is not legal.");
        if (typeof request.payload.handIndex === "number") {
          const isPlayableRef = playAction.playableCards.some((entry) => entry.handIndex === request.payload.handIndex);
          if (!isPlayableRef) {
            throw new Error("Illegal hand index for PLAY_CHARACTER.");
          }
        }
        if (typeof request.payload.replaceRef === "string") {
          const canReplace = playAction.replaceableCharacterRefs.includes(request.payload.replaceRef);
          if (!canReplace) throw new Error("Illegal replace target for PLAY_CHARACTER.");
        }
        if (typeof request.payload.replaceRef === "number") {
          const inBounds =
            request.payload.replaceRef >= 0 && request.payload.replaceRef < playAction.replaceableCharacterRefs.length;
          if (!inBounds) throw new Error("Illegal replace target index for PLAY_CHARACTER.");
        }
      }
      return handlers.playCharacter(request.payload.playerId, request.payload.handIndex, request.payload.replaceRef);
    case "ATTACK_LEADER":
      if (!state) throw new Error("No match started yet.");
      assertPromptLockAllowsRequest(state, request);
      {
        const legal = generateLegalActionsForPlayer(state, request.payload.playerId);
        assertLegalActionExists(legal, request.payload.playerId, "ATTACK_LEADER");
        const attackLeaderAction = findLegalAction(legal, "ATTACK_LEADER");
        if (!attackLeaderAction) throw new Error("Illegal action: ATTACK_LEADER is not legal.");
        if (typeof request.payload.attackerRef === "string" && !attackLeaderAction.attackerRefs.includes(request.payload.attackerRef)) {
          throw new Error("Illegal attacker for ATTACK_LEADER.");
        }
      }
      return handlers.attackLeader(request.payload.playerId, request.payload.attackerRef ?? "leader");
    case "ATTACK_CHARACTER":
      if (!state) throw new Error("No match started yet.");
      assertPromptLockAllowsRequest(state, request);
      {
        const legal = generateLegalActionsForPlayer(state, request.payload.playerId);
        assertLegalActionExists(legal, request.payload.playerId, "ATTACK_CHARACTER");
        const attackCharacterAction = findLegalAction(legal, "ATTACK_CHARACTER");
        if (attackCharacterAction) {
          if (
            typeof request.payload.attackerRef === "string" &&
            !attackCharacterAction.attackerRefs.includes(request.payload.attackerRef)
          ) {
            throw new Error("Illegal attacker for ATTACK_CHARACTER.");
          }
          if (
            typeof request.payload.defenderRef === "string" &&
            !attackCharacterAction.defenderRefs.includes(request.payload.defenderRef)
          ) {
            throw new Error("Illegal defender target for ATTACK_CHARACTER.");
          }
        }
      }
      return handlers.attackCharacter(request.payload.playerId, request.payload.attackerRef, request.payload.defenderRef);
    case "BLOCK_ATTACK":
      if (!state) throw new Error("No match started yet.");
      assertPromptLockAllowsRequest(state, request);
      {
        const legal = generateLegalActionsForPlayer(state, request.payload.playerId);
        assertLegalActionExists(legal, request.payload.playerId, "BLOCK_ATTACK");
        const blockAction = findLegalAction(legal, "BLOCK_ATTACK");
        if (typeof request.payload.blockerRef === "string" && blockAction && !blockAction.blockerRefs.includes(request.payload.blockerRef)) {
          throw new Error("Illegal blocker.");
        }
      }
      return handlers.blockAttack(request.payload.playerId, request.payload.blockerRef);
    case "PASS_BLOCK":
      if (!state) throw new Error("No match started yet.");
      assertPromptLockAllowsRequest(state, request);
      {
        const legal = generateLegalActionsForPlayer(state, request.payload.playerId);
        assertLegalActionExists(legal, request.payload.playerId, "PASS_BLOCK");
      }
      return handlers.passBlock(request.payload.playerId);
    case "RESOLVE_PROMPT":
      if (!state) throw new Error("No match started yet.");
      {
        const legal = generateLegalActionsForPlayer(state, request.payload.playerId);
        assertLegalActionExists(legal, request.payload.playerId, "RESOLVE_PROMPT");
        const promptLegal = findLegalAction(legal, "RESOLVE_PROMPT");
        if (promptLegal && promptLegal.promptId !== request.payload.promptId) {
          throw new Error("Illegal prompt id.");
        }
      }
      const promptPayload = {
        ...(request.payload.selectedCardInstanceIds ? { selectedCardInstanceIds: request.payload.selectedCardInstanceIds } : {}),
        ...(request.payload.selectedOptionId ? { selectedOptionId: request.payload.selectedOptionId } : {}),
        ...(typeof request.payload.yesNoChoice === "boolean" ? { yesNoChoice: request.payload.yesNoChoice } : {})
      };
      return handlers.resolvePrompt(request.payload.playerId, request.payload.promptId, {
        ...promptPayload
      });
    case "END_TURN":
      if (!state) throw new Error("No match started yet.");
      assertPromptLockAllowsRequest(state, request);
      {
        const legal = generateLegalActionsForPlayer(state, request.payload.playerId);
        assertLegalActionExists(legal, request.payload.playerId, "END_TURN");
      }
      return handlers.endTurn(request.payload.playerId);
    default: {
      const _never: never = request;
      throw new Error(`Unhandled request ${(request as { type: string }).type}`);
    }
  }
};
