import type { GameState, PlayerId } from "./types";
import type { StartMatchRequestOptions } from "./pregame";

export type ClientRequest =
  | {
      requestId: string;
      type: "START_MATCH";
      payload: { playerAName: string; playerBName: string } & StartMatchRequestOptions;
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
      type: "BLOCK_ATTACK";
      payload: { playerId: PlayerId; blockerRef: number | string };
    }
  | {
      requestId: string;
      type: "PASS_BLOCK";
      payload: { playerId: PlayerId };
    }
  | {
      requestId: string;
      type: "RESOLVE_PROMPT";
      payload: {
        playerId: PlayerId;
        promptId: string;
        selectedCardInstanceIds?: string[] | undefined;
        selectedOptionId?: string | undefined;
        yesNoChoice?: boolean | undefined;
      };
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
    }
  | {
      requestId: string;
      type: "DECLARE_TIMEOUT_LOSS";
      payload: { loserId: PlayerId };
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
