export type GameStatus = "LOBBY" | "SETUP" | "MULLIGAN" | "IN_PROGRESS" | "FINISHED";
export type GamePhase = "SETUP" | "REFRESH" | "DRAW" | "DON" | "MAIN" | "END" | "FINISHED";
export type CardType = "LEADER" | "CHARACTER" | "EVENT" | "STAGE";
export type PlayerId = "P1" | "P2";

export type CardKeyword = "BLOCKER" | "RUSH" | "BANISH" | "DOUBLE_ATTACK";
export type CardColor = "RED" | "GREEN" | "BLUE" | "PURPLE" | "BLACK" | "YELLOW";
export type CardAttribute =
  | "SLASH"
  | "STRIKE"
  | "RANGED"
  | "SPECIAL"
  | "WISDOM"
  | "Slash"
  | "Strike"
  | "Ranged"
  | "Special"
  | "Wisdom";
export type CardArtReference = {
  assetId: string;
  variant?: string;
};

export type Zone =
  | "DECK"
  | "HAND"
  | "LIFE"
  | "TRASH"
  | "LEADER"
  | "CHARACTER_AREA"
  | "STAGE_AREA"
  | "DON_DECK"
  | "DON_ACTIVE"
  | "DON_RESTED";

export type TriggerEventType =
  | "TURN_STARTED"
  | "PHASE_STARTED"
  | "CARD_PLAYED"
  | "ATTACK_DECLARED"
  | "BLOCK_DECLARED"
  | "BLOCK_PASSED"
  | "BATTLE_RESOLVED"
  | "CARD_KO"
  | "CARD_MOVED"
  | "LIFE_TAKEN"
  | "TURN_ENDED";

export type ConditionDefinition = {
  id: string;
  type: string;
  params?: Record<string, unknown>;
};

export type CostDefinition = {
  id: string;
  type: string;
  params?: Record<string, unknown>;
};

export type SelectionDefinition = {
  id: string;
  source: "PUBLIC" | "PRIVATE";
  zone: Zone;
  min: number;
  max: number;
  filter?: Record<string, unknown>;
};

export type PromptKind = "SELECT_TARGETS" | "CHOOSE_MODE" | "YES_NO" | "SELECT_CARD" | "BATTLE_COUNTER";

export type PromptState = {
  promptId: string;
  kind: PromptKind;
  controllerPlayerId: PlayerId;
  title: string;
  allowAlternativeActions?: boolean;
  minSelections?: number;
  maxSelections?: number;
  options?: Array<{ id: string; label: string }>;
  zones?: Zone[];
  sourceEffectInstanceId?: string;
  createdAt: number;
};

export type EffectStep = {
  id: string;
  kind: string;
  params?: Record<string, unknown>;
  selection?: SelectionDefinition;
};

export type TriggerDefinition = {
  event: TriggerEventType;
  when?: "BEFORE" | "AFTER";
  optional?: boolean;
};

export type ExpirationRule = {
  type: "END_OF_TURN" | "END_OF_BATTLE" | "CUSTOM";
  turnNumber?: number;
  params?: Record<string, unknown>;
};

export type AbilityTimingClass = "STATIC" | "TRIGGERED" | "ACTIVATED" | "REPLACEMENT";

export type AbilityDefinition = {
  abilityId: string;
  sourceCardId?: string;
  timingClass: AbilityTimingClass;
  trigger?: TriggerDefinition;
  conditions?: ConditionDefinition[];
  costs?: CostDefinition[];
  steps: EffectStep[];
  usageLimit?: { kind: "NONE" | "ONCE_PER_TURN" | "CUSTOM"; key?: string };
  duration?: ExpirationRule;
  optional?: boolean;
};

export type LastingModifier = {
  modifierId: string;
  sourceCardInstanceId: string;
  affectedCardInstanceIds: string[];
  changes: Record<string, unknown>;
  expiresAt: ExpirationRule;
};

export type EffectInstance = {
  effectInstanceId: string;
  sourceCardInstanceId?: string;
  sourcePlayerId: PlayerId;
  controllerPlayerId: PlayerId;
  ability: AbilityDefinition;
  stepIndex: number;
  waitingForSelection: boolean;
  createdAt: number;
};

export type LegalActionType =
  | "PLAY_CHARACTER"
  | "ATTACK_LEADER"
  | "ATTACK_CHARACTER"
  | "BLOCK_ATTACK"
  | "PASS_BLOCK"
  | "END_TURN"
  | "RESOLVE_PROMPT";

export type LegalAction =
  | {
    type: "PLAY_CHARACTER";
    playerId: PlayerId;
    handIndexes: number[];
    playableCards: Array<{
      handIndex: number;
      cardInstanceId: string;
      cost: number;
    }>;
    replaceRequired: boolean;
    replaceableCharacterRefs: string[];
  }
  | {
    type: "ATTACK_LEADER";
    playerId: PlayerId;
    attackerRefs: Array<"leader" | string>;
    attackOptions: Array<{
      attackerRef: "leader" | string;
      target: "LEADER";
    }>;
  }
  | {
    type: "ATTACK_CHARACTER";
    playerId: PlayerId;
    attackerRefs: Array<"leader" | string>;
    defenderRefs: string[];
    attackOptions: Array<{
      attackerRef: "leader" | string;
      defenderRef: string;
      target: "CHARACTER";
    }>;
  }
  | {
    type: "BLOCK_ATTACK";
    playerId: PlayerId;
    blockerRefs: string[];
  }
  | {
    type: "PASS_BLOCK";
    playerId: PlayerId;
  }
  | {
    type: "END_TURN";
    playerId: PlayerId;
  }
  | {
    type: "RESOLVE_PROMPT";
    playerId: PlayerId;
    promptId: string;
  };

export type LegalActionsByPlayer = Record<PlayerId, LegalAction[]>;

export type DomainEventType =
  | "MATCH_CREATED"
  | "ROLL_RESULT"
  | "FIRST_PLAYER_SET"
  | "DECK_SHUFFLED"
  | "OPENING_HAND_DRAWN"
  | "MULLIGAN_KEEP_HAND"
  | "LIFE_SET"
  | "TEST_START_WITH_TEN_DON"
  | "TURN_REFRESHED"
  | "TURN_STARTED"
  | "PHASE_STARTED"
  | "CARD_DRAWN"
  | "CARD_DRAW_FAILED_EMPTY_DECK"
  | "DON_ADDED"
  | "CARD_PLAYED"
  | "CHARACTER_PLAYED"
  | "CHARACTER_REPLACED"
  | "CARD_LEFT_HAND"
  | "CARD_ENTERED_FIELD"
  | "ATTACK_DECLARED"
  | "ATTACKER_RESTED"
  | "BLOCK_WINDOW_OPENED"
  | "BLOCK_DECLARED"
  | "ATTACK_BLOCKED"
  | "BLOCK_PASSED"
  | "BATTLE_RESOLVED"
  | "CHARACTER_BATTLE_RESOLVED"
  | "ATTACK_NO_DAMAGE"
  | "CARD_KO"
  | "CHARACTER_KO"
  | "CARD_MOVED"
  | "LIFE_TAKEN"
  | "CARD_ADDED_TO_HAND_FROM_LIFE"
  | "END_TURN_REQUESTED"
  | "TURN_ENDED"
  | "GAME_WON"
  | "GAME_ENDED"
  | "PROMPT_OPENED"
  | "PROMPT_RESOLVED"
  | "EFFECT_QUEUED"
  | "EFFECT_RESOLVED"
  | "HOOK"
  | `HOOK_${string}`
  | "LEGACY_LOGGED";

export type DomainEventPayloadMap = {
  MATCH_CREATED: { id: string };
  TURN_STARTED: { playerId: PlayerId; turn: number };
  PHASE_STARTED: { playerId: PlayerId; phase: GamePhase };
  CARD_DRAWN: { playerId: PlayerId; card?: string };
  CARD_DRAW_FAILED_EMPTY_DECK: { playerId: PlayerId };
  DON_ADDED: { playerId: PlayerId; amount: number };
  CARD_PLAYED: { playerId: PlayerId; cardId: string; cardName: string };
  CHARACTER_PLAYED: { playerId: PlayerId; card: string; cost: number };
  CHARACTER_REPLACED: { playerId: PlayerId; replacedCardId: string; replacedCardName: string; incomingCardName: string };
  CARD_LEFT_HAND: { playerId: PlayerId; cardId: string };
  CARD_ENTERED_FIELD: { playerId: PlayerId; cardId: string };
  ATTACK_DECLARED: { attackingPlayerId: PlayerId; defendingPlayerId: PlayerId; attackerId: string };
  ATTACKER_RESTED: { attackerId: string };
  BLOCK_WINDOW_OPENED: { attackingPlayerId: PlayerId; defendingPlayerId: PlayerId };
  BLOCK_DECLARED: { defendingPlayerId: PlayerId; blockerId: string };
  ATTACK_BLOCKED: { defendingPlayerId: PlayerId; blockerId: string; blockerName: string };
  BLOCK_PASSED: { defendingPlayerId: PlayerId };
  BATTLE_RESOLVED: { attackerId: string; target: "LEADER" | "CHARACTER" };
  CHARACTER_BATTLE_RESOLVED: { attackerId: string; defenderId: string; attackerPower: number; defenderPower: number };
  ATTACK_NO_DAMAGE: Record<string, unknown>;
  CARD_KO: { playerId: PlayerId; cardId: string; cardName: string };
  CHARACTER_KO: { playerId: PlayerId; cardId: string; cardName: string };
  CARD_MOVED: { playerId: PlayerId; from: Zone; to: Zone; cardId: string };
  LIFE_TAKEN: { defendingPlayerId: PlayerId; remainingLife: number };
  CARD_ADDED_TO_HAND_FROM_LIFE: { defendingPlayerId: PlayerId; card: string };
  END_TURN_REQUESTED: { playerId: PlayerId };
  TURN_ENDED: { playerId: PlayerId; turn: number };
  GAME_WON: { winnerId: PlayerId; loserId: PlayerId; reason: string };
  GAME_ENDED: { winnerId: PlayerId; loserId: PlayerId; reason: string };
  PROMPT_OPENED: { promptId: string; playerId: PlayerId; kind: PromptKind };
  PROMPT_RESOLVED: { promptId: string; playerId: PlayerId };
  EFFECT_QUEUED: { effectInstanceId: string; sourcePlayerId: PlayerId };
  EFFECT_RESOLVED: { effectInstanceId: string; sourcePlayerId: PlayerId };
  HOOK: { name: string; payload?: Record<string, unknown> };
  ROLL_RESULT: Record<string, unknown>;
  FIRST_PLAYER_SET: { firstPlayerId: PlayerId };
  DECK_SHUFFLED: { playerId: PlayerId; size: number };
  OPENING_HAND_DRAWN: { playerId: PlayerId; count: number };
  MULLIGAN_KEEP_HAND: { playerId: PlayerId };
  LIFE_SET: { playerId: PlayerId; count: number };
  TEST_START_WITH_TEN_DON: { enabled: boolean };
  TURN_REFRESHED: { playerId: PlayerId };
  LEGACY_LOGGED: { originalType: string; payload: Record<string, unknown> };
};

export type DomainEvent<T extends DomainEventType = DomainEventType> = {
  id: string;
  type: T;
  payload: T extends keyof DomainEventPayloadMap ? DomainEventPayloadMap[T] : Record<string, unknown>;
  createdAt: number;
};

export type CardDefinition = {
  cardId: string;
  name: string;
  type: CardType;
  colors?: CardColor[] | undefined;
  subtypes?: string[] | undefined;
  attributes?: CardAttribute[] | undefined;
  cost?: number | undefined;
  power?: number | undefined;
  life?: number | undefined;
  counter?: number | undefined;
  keywords?: CardKeyword[] | undefined;
  text?: string | undefined;
  art?: CardArtReference | undefined;
  abilities?: AbilityDefinition[] | undefined;
};

export type CardInstance = {
  instanceId: string;
  cardId: string;
  name: string;
  type: CardType;
  // Transitional printed data copy: prefer definition lookup by cardId in new code.
  cost?: number | undefined;
  power?: number | undefined;
  counter?: number | undefined;
  keywords?: CardKeyword[] | undefined;
  abilities?: AbilityDefinition[] | undefined;
  ownerId: PlayerId;
  controllerId: PlayerId;
  rested: boolean;
  summoningSick?: boolean;
  attachedDon?: number | undefined;
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
  oncePerTurnUsage: Record<string, number>;
};

export type AttackState = {
  attackerId: string;
  attackingPlayerId: PlayerId;
  defendingPlayerId: PlayerId;
  target: "LEADER" | "CHARACTER";
  defendingCharacterId?: string | undefined;
  blockPhaseOpen: boolean;
  resolved: boolean;
};

export type CombatStatus =
  | "IDLE"
  | "ATTACK_DECLARED"
  | "BLOCK_WINDOW"
  | "COUNTER_WINDOW"
  | "DAMAGE_RESOLUTION"
  | "POST_BATTLE"
  | "COMPLETE";

export type CombatState = {
  combatId: number;
  status: CombatStatus;
  attack: AttackState | null;
};

export type PendingSelection = {
  effectInstanceId: string;
  selection: SelectionDefinition;
  controllerPlayerId: PlayerId;
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
  cardDefinitions: Record<string, CardDefinition>;
  players: Record<PlayerId, PlayerState>;
  combat: CombatState;
  winnerId: PlayerId | null;
  loserId: PlayerId | null;
  log: GameEvent[];
  domainEvents: DomainEvent[];
  effectsQueue: EffectInstance[];
  pendingSelection: PendingSelection | null;
  pendingPrompt: PromptState | null;
  lastingModifiers: LastingModifier[];
  legalActions: LegalActionsByPlayer;
  hooks: HookState;
};

export type ReadableCard = {
  handIndex: number;
  id: string;
  name: string;
  type: CardType;
  cost?: number | undefined;
  power?: number | undefined;
  counter?: number | undefined;
  artUrl: string;
  hasBlocker: boolean;
};

export type ReadableSnapshot = {
  match: {
    id: string;
    status: GameStatus;
    turnNumber: number;
    phase: GamePhase;
    activePlayerId: PlayerId;
    firstPlayerId: PlayerId;
    combatStatus: CombatStatus;
  };
  players: Array<{
    playerId: PlayerId;
    name: string;
    active: boolean;
    leaderPower: number;
    leaderArtUrl: string;
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
  activeHand: ReadableCard[];
  p1Hand: ReadableCard[];
  p2Hand: ReadableCard[];
  p1Characters: Array<{
    slot: number;
    id: string;
    name: string;
    cost?: number | undefined;
    power?: number | undefined;
    artUrl: string;
    rested: boolean;
    summoningSick: boolean;
    hasBlocker: boolean;
  }>;
  p2Characters: Array<{
    slot: number;
    id: string;
    name: string;
    cost?: number | undefined;
    power?: number | undefined;
    artUrl: string;
    rested: boolean;
    summoningSick: boolean;
    hasBlocker: boolean;
  }>;
  p1Don: Array<{
    id: string;
    rested: boolean;
  }>;
  p2Don: Array<{
    id: string;
    rested: boolean;
  }>;
  p1TrashTop: {
    id: string;
    name: string;
    artUrl: string;
  } | null;
  p2TrashTop: {
    id: string;
    name: string;
    artUrl: string;
  } | null;
  legalActionsByPlayer: Record<PlayerId, LegalActionType[]>;
  pendingPrompt: PromptState | null;
  currentAttack: AttackState | null;
  recentEvents: Array<{
    time: string;
    type: string;
    payload: string;
  }>;
};
