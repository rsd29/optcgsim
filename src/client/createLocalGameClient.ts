import { attachEngineToSocket } from "../engine/engineSocketServer";
import { GameEngineServer } from "../engine/gameEngineServer";
import { createLocalWebSocketPair } from "../network/localWebSocket";
import type { ClientRequest, ServerMessage } from "../game/protocol";
import { createGameClient, type GameClientApi } from "./gameClient";

export const createLocalGameClient = (): GameClientApi => {
  const { client, server } = createLocalWebSocketPair<ClientRequest, ServerMessage>(15);
  const engine = new GameEngineServer();
  attachEngineToSocket(engine, server);
  return createGameClient(client);
};
