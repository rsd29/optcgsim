import type { GameState, PlayerId } from "./types";

export type ClientRequest =
  | {
      requestId: string;
      type: "START_MATCH";
      payload: { playerAName: string; playerBName: string; testStartWithTenDon?: boolean };
    }
  | {
      requestId: string;
      type: "PLAY_CHARACTER";
      payload: { playerId: PlayerId; handIndex?: number; replaceRef?: number | string };
    }
  | {
      requestId: string;
      type: "ATTACK_LEADER";
      payload: { playerId: PlayerId; attackerRef?: "leader" | number | string };
    }
  | {
      requestId: string;
      type: "ATTACK_CHARACTER";
      payload: { playerId: PlayerId; attackerRef: "leader" | number | string; defenderRef: number | string };
    }
  | {
      requestId: string;
      type: "END_TURN";
      payload: { playerId: PlayerId };
    }
  | {
      requestId: string;
      type: "AUTO_MAIN_STEP";
      payload: { playerId: PlayerId };
    }
  | {
      requestId: string;
      type: "AUTO_PLAY";
      payload: { playerId: PlayerId; maxSteps: number };
    }
  | {
      requestId: string;
      type: "GET_STATE";
      payload: Record<string, never>;
    };

export type ServerMessage =
  | {
      type: "STATE_UPDATE";
      requestId: string;
      state: GameState | null;
    }
  | {
      type: "ERROR";
      requestId: string;
      message: string;
    }
  | {
      type: "INFO";
      message: string;
    };
