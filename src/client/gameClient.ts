import type { ClientRequest, ServerMessage } from "../game/protocol";
import type { StartMatchRequestOptions } from "../game/pregame";
import type { GameState, PlayerId, ReadableSnapshot } from "../game/types";
import { printSnapshotToConsole, toReadableSnapshot } from "../game/snapshot";
import type { LocalSocketEndpoint } from "../network/localWebSocket";

const cloneDeep = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const makeRequestId = (): string =>
  `REQ-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

export type GameClientApi = {
  raw: GameState | null;
  connect: () => void;
  disconnect: () => void;
  startMatch: (
    playerAName?: string,
    playerBName?: string,
    options?: StartMatchRequestOptions
  ) => void;
  playCharacter: (playerId: PlayerId, handIndex?: number, replaceRef?: number | string) => void;
  attackLeader: (playerId: PlayerId, attackerRef?: "leader" | number | string) => void;
  attackCharacter: (playerId: PlayerId, attackerRef: "leader" | number | string, defenderRef: number | string) => void;
  blockAttack: (playerId: PlayerId, blockerRef: number | string) => void;
  passBlock: (playerId: PlayerId) => void;
  resolvePrompt: (
    playerId: PlayerId,
    promptId: string,
    payload?: { selectedCardInstanceIds?: string[]; selectedOptionId?: string; yesNoChoice?: boolean }
  ) => void;
  endTurn: (playerId: PlayerId) => void;
  declareTimeoutLoss: (loserId: PlayerId) => void;
  autoMainStep: (playerId: PlayerId) => void;
  autoPlay: (playerId: PlayerId, maxSteps?: number) => void;
  requestState: () => void;
  state: () => GameState | null;
  snapshot: () => ReadableSnapshot | null;
  events: () => GameState["log"];
  print: () => void;
  help: () => void;
  onSnapshot: (listener: (snapshot: ReadableSnapshot | null) => void) => () => void;
  onError: (listener: (message: string) => void) => () => void;
};

export const createGameClient = (
  socket: LocalSocketEndpoint<ServerMessage, ClientRequest>
): GameClientApi => {
  let connected = false;
  let state: GameState | null = null;
  const snapshotListeners = new Set<(snapshot: ReadableSnapshot | null) => void>();
  const errorListeners = new Set<(message: string) => void>();
  let unsubscribeSocket: (() => void) | null = null;

  const notifySnapshot = (): void => {
    const snapshot = state ? toReadableSnapshot(state) : null;
    snapshotListeners.forEach((listener) => listener(snapshot ? cloneDeep(snapshot) : null));
  };

  const notifyError = (message: string): void => {
    errorListeners.forEach((listener) => listener(message));
  };

  const send = (request: Omit<ClientRequest, "requestId">): void => {
    if (!connected) throw new Error("Client is not connected.");
    socket.send({ ...request, requestId: makeRequestId() } as ClientRequest);
  };

  const api: GameClientApi = {
    raw: null,
    connect() {
      if (connected) return;
      connected = true;
      unsubscribeSocket = socket.onMessage((message) => {
        if (message.type === "STATE_UPDATE") {
          state = message.state ? cloneDeep(message.state) : null;
          api.raw = state ? cloneDeep(state) : null;
          notifySnapshot();
          if (state) {
            printSnapshotToConsole(state, `SERVER STATE UPDATE (${message.requestId})`);
          }
          return;
        }
        if (message.type === "ERROR") {
          notifyError(message.message);
          return;
        }
        if (message.type === "INFO") {
          console.info(message.message);
        }
      });
      api.requestState();
    },
    disconnect() {
      connected = false;
      unsubscribeSocket?.();
      unsubscribeSocket = null;
    },
    startMatch(playerAName = "Player A", playerBName = "Player B", options) {
      const payload: { playerAName: string; playerBName: string } & StartMatchRequestOptions = {
        playerAName,
        playerBName,
        ...(options ?? {})
      };
      send({
        type: "START_MATCH",
        payload
      });
    },
    playCharacter(playerId, handIndex, replaceRef) {
      send({
        type: "PLAY_CHARACTER",
        payload: { playerId, handIndex, replaceRef }
      });
    },
    attackLeader(playerId, attackerRef = "leader") {
      send({
        type: "ATTACK_LEADER",
        payload: { playerId, attackerRef }
      });
    },
    attackCharacter(playerId, attackerRef, defenderRef) {
      send({
        type: "ATTACK_CHARACTER",
        payload: { playerId, attackerRef, defenderRef }
      });
    },
    blockAttack(playerId, blockerRef) {
      send({
        type: "BLOCK_ATTACK",
        payload: { playerId, blockerRef }
      });
    },
    passBlock(playerId) {
      send({
        type: "PASS_BLOCK",
        payload: { playerId }
      });
    },
    resolvePrompt(playerId, promptId, payload) {
      send({
        type: "RESOLVE_PROMPT",
        payload: {
          playerId,
          promptId,
          selectedCardInstanceIds: payload?.selectedCardInstanceIds,
          selectedOptionId: payload?.selectedOptionId,
          yesNoChoice: payload?.yesNoChoice
        }
      });
    },
    endTurn(playerId) {
      send({
        type: "END_TURN",
        payload: { playerId }
      });
    },
    declareTimeoutLoss(loserId) {
      send({
        type: "DECLARE_TIMEOUT_LOSS",
        payload: { loserId }
      });
    },
    autoMainStep(playerId) {
      send({
        type: "AUTO_MAIN_STEP",
        payload: { playerId }
      });
    },
    autoPlay(playerId, maxSteps = 20) {
      send({
        type: "AUTO_PLAY",
        payload: { playerId, maxSteps }
      });
    },
    requestState() {
      send({
        type: "GET_STATE",
        payload: {}
      });
    },
    state() {
      return state ? cloneDeep(state) : null;
    },
    snapshot() {
      return state ? toReadableSnapshot(cloneDeep(state)) : null;
    },
    events() {
      return state ? cloneDeep(state.log) : [];
    },
    print() {
      if (!state) {
        console.log("No match running.");
        return;
      }
      printSnapshotToConsole(state, "CURRENT CLIENT VIEW");
    },
    help() {
      console.log("OPTCG client commands:");
      console.log("  OPTCG.connect()");
      console.log("  OPTCG.startMatch('Luffy', 'Kaido', { testStartWithTenDon: true })");
      console.log("  OPTCG.playCharacter('P1' | 'P2', handIndex?, replaceRef?)");
      console.log("  OPTCG.attackLeader('P1' | 'P2', attackerRef?)");
      console.log("  OPTCG.attackCharacter('P1' | 'P2', attackerRef, defenderRef)");
      console.log("  OPTCG.blockAttack('P1' | 'P2', blockerRef)");
      console.log("  OPTCG.passBlock('P1' | 'P2')");
      console.log("  OPTCG.resolvePrompt('P1' | 'P2', promptId, payload?)");
      console.log("  OPTCG.endTurn('P1' | 'P2')");
      console.log("  OPTCG.declareTimeoutLoss('P1' | 'P2')");
      console.log("  OPTCG.autoMainStep('P1' | 'P2')");
      console.log("  OPTCG.autoPlay('P1' | 'P2', maxSteps?)");
      console.log("  OPTCG.requestState()");
      console.log("  OPTCG.snapshot()");
      console.log("  OPTCG.state()");
      console.log("  OPTCG.events()");
      console.log("  OPTCG.raw");
    },
    onSnapshot(listener) {
      snapshotListeners.add(listener);
      return () => snapshotListeners.delete(listener);
    },
    onError(listener) {
      errorListeners.add(listener);
      return () => errorListeners.delete(listener);
    }
  };

  return api;
};
