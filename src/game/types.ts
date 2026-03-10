export type GameStatus = "LOBBY" | "SETUP" | "MULLIGAN" | "IN_PROGRESS" | "FINISHED";
export type GamePhase = "SETUP" | "REFRESH" | "DRAW" | "DON" | "MAIN" | "END" | "FINISHED";
export type CardType = "LEADER" | "CHARACTER";
export type PlayerId = "P1" | "P2";

export type CardDefinition = {
  cardId: string;
  name: string;
  type: CardType;
  cost?: number | undefined;
  power?: number | undefined;
};

export type CardInstance = {
  instanceId: string;
  cardId: string;
  name: string;
  type: CardType;
  cost?: number | undefined;
  power?: number | undefined;
  ownerId: PlayerId;
  controllerId: PlayerId;
  rested: boolean;
  summoningSick?: boolean;
  faceup: boolean;
};

export type DonCard = { id: string };

export type PlayerState = {
  id: PlayerId;
  name: string;
  roll: number | null;
  deck: CardInstance[];
  hand: CardInstance[];
  life: CardInstance[];
  trash: CardInstance[];
  leader: CardInstance;
  characterArea: CardInstance[];
  stageArea: CardInstance | null;
  donDeck: DonCard[];
  donActive: DonCard[];
  donRested: DonCard[];
  attachedDon: Record<string, number>;
  hasMulliganed: boolean;
  isGoingFirst: boolean;
  turnsTaken: number;
};

export type AttackState = {
  attackerId: string;
  attackingPlayerId: PlayerId;
  defendingPlayerId: PlayerId;
  target: "LEADER" | "CHARACTER";
  defendingCharacterId?: string | undefined;
  resolved: boolean;
};

export type HookState = {
  canMulligan: boolean;
  pendingStartOfGameEffects: boolean;
  pendingResolution: boolean;
};

export type GameEvent = {
  type: string;
  payload?: Record<string, unknown>;
  createdAt: number;
};

export type GameState = {
  id: string;
  status: GameStatus;
  turnNumber: number;
  activePlayerId: PlayerId;
  priorityPlayerId: PlayerId;
  firstPlayerId: PlayerId;
  phase: GamePhase;
  players: Record<PlayerId, PlayerState>;
  currentAttack: AttackState | null;
  winnerId: PlayerId | null;
  loserId: PlayerId | null;
  log: GameEvent[];
  hooks: HookState;
};

export type ReadableSnapshot = {
  match: {
    id: string;
    status: GameStatus;
    turnNumber: number;
    phase: GamePhase;
    activePlayerId: PlayerId;
    firstPlayerId: PlayerId;
  };
  players: Array<{
    playerId: PlayerId;
    name: string;
    active: boolean;
    leaderPower: number;
    leaderRested: boolean;
    turnsTaken: number;
    life: number;
    hand: number;
    deck: number;
    trash: number;
    characters: number;
    donActive: number;
    donRested: number;
    donDeck: number;
  }>;
  activeHand: Array<{
    handIndex: number;
    id: string;
    name: string;
    type: CardType;
    cost?: number | undefined;
    power?: number | undefined;
  }>;
  p1Characters: Array<{
    slot: number;
    id: string;
    name: string;
    cost?: number | undefined;
    power?: number | undefined;
    rested: boolean;
    summoningSick: boolean;
  }>;
  p2Characters: Array<{
    slot: number;
    id: string;
    name: string;
    cost?: number | undefined;
    power?: number | undefined;
    rested: boolean;
    summoningSick: boolean;
  }>;
  currentAttack: AttackState | null;
  recentEvents: Array<{
    time: string;
    type: string;
    payload: string;
  }>;
};
