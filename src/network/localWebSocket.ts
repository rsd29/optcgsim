type MessageHandler<T> = (message: T) => void;

export type LocalSocketEndpoint<Incoming, Outgoing> = {
  send: (message: Outgoing) => void;
  onMessage: (handler: MessageHandler<Incoming>) => () => void;
};

const cloneDeep = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const createLocalWebSocketPair = <ClientToServer, ServerToClient>(
  latencyMs = 10
): {
  client: LocalSocketEndpoint<ServerToClient, ClientToServer>;
  server: LocalSocketEndpoint<ClientToServer, ServerToClient>;
} => {
  const serverInbound = new Set<MessageHandler<ClientToServer>>();
  const clientInbound = new Set<MessageHandler<ServerToClient>>();

  const client: LocalSocketEndpoint<ServerToClient, ClientToServer> = {
    send(message) {
      const safeMessage = cloneDeep(message);
      window.setTimeout(() => {
        serverInbound.forEach((handler) => handler(safeMessage));
      }, latencyMs);
    },
    onMessage(handler) {
      clientInbound.add(handler);
      return () => clientInbound.delete(handler);
    }
  };

  const server: LocalSocketEndpoint<ClientToServer, ServerToClient> = {
    send(message) {
      const safeMessage = cloneDeep(message);
      window.setTimeout(() => {
        clientInbound.forEach((handler) => handler(safeMessage));
      }, latencyMs);
    },
    onMessage(handler) {
      serverInbound.add(handler);
      return () => serverInbound.delete(handler);
    }
  };

  return { client, server };
};
