import { GameEngineServer } from "./gameEngineServer";
import type { ClientRequest, ServerMessage } from "../game/protocol";
import type { LocalSocketEndpoint } from "../network/localWebSocket";

export const attachEngineToSocket = (
  engine: GameEngineServer,
  socket: LocalSocketEndpoint<ClientRequest, ServerMessage>
): (() => void) => {
  const unbindEngine = engine.onStateUpdated((state) => {
    socket.send({
      type: "STATE_UPDATE",
      requestId: "ENGINE_PUSH",
      state
    });
  });

  const unbindSocket = socket.onMessage((request) => {
    try {
      const nextState = engine.processRequest(request);
      socket.send({
        type: "STATE_UPDATE",
        requestId: request.requestId,
        state: nextState
      });
    } catch (error) {
      socket.send({
        type: "ERROR",
        requestId: request.requestId,
        message: error instanceof Error ? error.message : "Unknown server error"
      });
    }
  });

  return () => {
    unbindSocket();
    unbindEngine();
  };
};
