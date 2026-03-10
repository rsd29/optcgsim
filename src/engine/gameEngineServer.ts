import type { CardDefinition, CardInstance, GameState, PlayerId, PlayerState } from "../game/types";
import type { ClientRequest } from "../game/protocol";
import { MOCK_CHARACTER_CARD_POOL } from "../game/mockCardPool";

const HAND_SIZE = 5;
const LIFE_SIZE = 5;
const CHARACTER_AREA_LIMIT = 5;
const STARTING_DON = 10;
const EVENT_LOG_LIMIT = 200;

let instanceCounter = 1;
let donCounter = 1;

const cloneDeep = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const now = (): number => Date.now();
const randomInt = (min: number, max: number): number => Math.floor(Math.random() * (max - min + 1)) + min;

const makeInstanceId = (prefix: string): string => {
  const id = `${prefix}-${String(instanceCounter).padStart(5, "0")}`;
  instanceCounter += 1;
  return id;
};

const makeDonId = (playerId: PlayerId): string => {
  const id = `${playerId}-DON-${String(donCounter).padStart(3, "0")}`;
  donCounter += 1;
  return id;
};

const shuffle = <T,>(array: T[]): T[] => {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = copy[i];
    copy[i] = copy[j] as T;
    copy[j] = temp as T;
  }
  return copy;
};

const buildStarterDeckDefinitions = (): CardDefinition[] => {
  const pool = MOCK_CHARACTER_CARD_POOL;
  if (pool.length === 0) {
    throw new Error("MOCK_CHARACTER_CARD_POOL is empty. Add at least one mock card.");
  }

  const defs: CardDefinition[] = [];
  for (let i = 0; i < 50; i += 1) {
    const source = pool[randomInt(0, pool.length - 1)]!;
    defs.push({
      cardId: source.cardId,
      name: source.name,
      type: "CHARACTER",
      cost: source.cost,
      power: source.power
    });
  }
  return defs;
};

const buildLeaderDefinition = (playerName: string): CardDefinition => ({
  cardId: `LDR-${playerName.toUpperCase().replace(/[^A-Z0-9]/g, "")}`,
  name: `${playerName} Leader`,
  type: "LEADER",
  power: 5000
});

const makeCardInstance = (cardDef: CardDefinition, ownerId: PlayerId): CardInstance => ({
  instanceId: makeInstanceId("CARD"),
  cardId: cardDef.cardId,
  name: cardDef.name,
  type: cardDef.type,
  cost: cardDef.cost,
  power: cardDef.power,
  ownerId,
  controllerId: ownerId,
  rested: false,
  summoningSick: false,
  faceup: true
});

const makePlayer = (id: PlayerId, name: string): PlayerState => {
  const leader = makeCardInstance(buildLeaderDefinition(name), id);
  const deckDefs = buildStarterDeckDefinitions();
  const deck = deckDefs.map((def) => makeCardInstance(def, id));
  const donDeck = Array.from({ length: STARTING_DON }, () => ({ id: makeDonId(id) }));
  return {
    id,
    name,
    roll: null,
    deck,
    hand: [],
    life: [],
    trash: [],
    leader,
    characterArea: [],
    stageArea: null,
    donDeck,
    donActive: [],
    donRested: [],
    attachedDon: {},
    hasMulliganed: false,
    isGoingFirst: false,
    turnsTaken: 0
  };
};

const makeInitialState = (playerAName: string, playerBName: string): GameState => ({
  id: `MATCH-${now()}`,
  status: "LOBBY",
  turnNumber: 0,
  activePlayerId: "P1",
  priorityPlayerId: "P1",
  firstPlayerId: "P1",
  phase: "SETUP",
  players: {
    P1: makePlayer("P1", playerAName),
    P2: makePlayer("P2", playerBName)
  },
  currentAttack: null,
  winnerId: null,
  loserId: null,
  log: [],
  hooks: {
    canMulligan: false,
    pendingStartOfGameEffects: false,
    pendingResolution: false
  }
});

const playerList = (state: GameState): PlayerState[] => [state.players.P1, state.players.P2];
const opponentId = (playerId: PlayerId): PlayerId => (playerId === "P1" ? "P2" : "P1");

const pushLog = (state: GameState, type: string, payload?: Record<string, unknown>): void => {
  state.log.push({ type, payload: payload ?? {}, createdAt: now() });
  if (state.log.length > EVENT_LOG_LIMIT) {
    state.log.shift();
  }
};

const hook = (state: GameState, name: string, payload?: Record<string, unknown>): void => {
  pushLog(state, `HOOK_${name}`, payload);
};

const drawFromDeck = (player: PlayerState, amount: number): CardInstance[] => {
  const drawn: CardInstance[] = [];
  for (let i = 0; i < amount; i += 1) {
    const card = player.deck.shift();
    if (!card) break;
    drawn.push(card);
  }
  return drawn;
};

const guardMainPhaseForActive = (state: GameState, playerId: PlayerId): void => {
  if (state.status !== "IN_PROGRESS") throw new Error("Game is not in progress.");
  if (state.phase !== "MAIN") throw new Error("Action only allowed in MAIN phase.");
  if (state.activePlayerId !== playerId) throw new Error("Only the active player can do that.");
  if (state.priorityPlayerId !== playerId) throw new Error("Player does not have priority.");
};

export class GameEngineServer {
  private state: GameState | null = null;
  private listeners = new Set<(state: GameState) => void>();

  onStateUpdated(listener: (state: GameState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): GameState | null {
    return this.state ? cloneDeep(this.state) : null;
  }

  processRequest(request: ClientRequest): GameState | null {
    switch (request.type) {
      case "GET_STATE":
        return this.getState();
      case "START_MATCH":
        instanceCounter = 1;
        donCounter = 1;
        this.state = makeInitialState(request.payload.playerAName, request.payload.playerBName);
        this.setupMatch(this.state, request.payload.testStartWithTenDon === true);
        this.runTurnStartPhases(this.state);
        this.emitState();
        return this.getState();
      case "PLAY_CHARACTER":
        this.state = this.playCharacter(
          this.getRequiredState(),
          request.payload.playerId,
          request.payload.handIndex,
          request.payload.replaceRef
        );
        this.emitState();
        return this.getState();
      case "ATTACK_LEADER":
        this.state = this.declareAttackLeader(
          this.getRequiredState(),
          request.payload.playerId,
          request.payload.attackerRef ?? "leader"
        );
        this.emitState();
        return this.getState();
      case "ATTACK_CHARACTER":
        this.state = this.declareAttackCharacter(
          this.getRequiredState(),
          request.payload.playerId,
          request.payload.attackerRef,
          request.payload.defenderRef
        );
        this.emitState();
        return this.getState();
      case "END_TURN":
        this.state = this.endTurn(this.getRequiredState(), request.payload.playerId);
        this.emitState();
        return this.getState();
      case "AUTO_MAIN_STEP":
        this.state = this.autoMainStep(this.getRequiredState(), request.payload.playerId);
        this.emitState();
        return this.getState();
      case "AUTO_PLAY":
        this.getRequiredState();
        for (let i = 0; i < request.payload.maxSteps; i += 1) {
          const current = this.getRequiredState();
          if (current.status === "FINISHED") break;
          this.state = this.autoMainStep(current, request.payload.playerId);
        }
        this.emitState();
        return this.getState();
      default: {
        const _never: never = request;
        throw new Error(`Unhandled request ${(request as { type: string }).type}`);
      }
    }
  }

  private getRequiredState(): GameState {
    if (!this.state) throw new Error("No match started yet.");
    return this.state;
  }

  private emitState(): void {
    if (!this.state) return;
    const frozen = cloneDeep(this.state);
    this.listeners.forEach((listener) => listener(frozen));
  }

  private setupMatch(state: GameState, testStartWithTenDon: boolean): void {
    state.status = "SETUP";
    pushLog(state, "MATCH_CREATED", { id: state.id });

    const p1 = state.players.P1;
    const p2 = state.players.P2;
    do {
      p1.roll = randomInt(1, 6);
      p2.roll = randomInt(1, 6);
      pushLog(state, "ROLL_RESULT", { P1: p1.roll, P2: p2.roll });
    } while (p1.roll === p2.roll);

    const first = (p1.roll ?? 0) > (p2.roll ?? 0) ? p1 : p2;
    const second = first.id === "P1" ? p2 : p1;
    first.isGoingFirst = true;
    second.isGoingFirst = false;
    state.firstPlayerId = first.id;
    state.activePlayerId = first.id;
    state.priorityPlayerId = first.id;
    pushLog(state, "FIRST_PLAYER_SET", { firstPlayerId: first.id });

    for (const player of playerList(state)) {
      player.deck = shuffle(player.deck);
      pushLog(state, "DECK_SHUFFLED", { playerId: player.id, size: player.deck.length });
    }

    for (const player of playerList(state)) {
      const opening = drawFromDeck(player, HAND_SIZE);
      player.hand.push(...opening);
      pushLog(state, "OPENING_HAND_DRAWN", { playerId: player.id, count: opening.length });
    }

    state.status = "MULLIGAN";
    state.hooks.canMulligan = true;
    hook(state, "onBeforeMulligan");
    pushLog(state, "MULLIGAN_KEEP_HAND", { playerId: "P1" });
    pushLog(state, "MULLIGAN_KEEP_HAND", { playerId: "P2" });
    hook(state, "onAfterMulligan");

    state.hooks.pendingStartOfGameEffects = true;
    hook(state, "onStartOfGameEffects");
    state.hooks.pendingStartOfGameEffects = false;
    state.hooks.canMulligan = false;

    for (const player of playerList(state)) {
      const lifeCards = drawFromDeck(player, LIFE_SIZE);
      player.life.push(...lifeCards);
      pushLog(state, "LIFE_SET", { playerId: player.id, count: lifeCards.length });
    }

    if (testStartWithTenDon) {
      for (const player of playerList(state)) {
        player.donActive.push(...player.donDeck);
        player.donDeck = [];
      }
      pushLog(state, "TEST_START_WITH_TEN_DON", { enabled: true });
    }

    state.status = "IN_PROGRESS";
    state.turnNumber = 1;
    state.phase = "REFRESH";
    state.activePlayerId = state.firstPlayerId;
    state.priorityPlayerId = state.activePlayerId;
  }

  private runTurnStartPhases(state: GameState): void {
    const active = state.players[state.activePlayerId];
    state.currentAttack = null;
    state.priorityPlayerId = state.activePlayerId;

    hook(state, "onTurnStart", { playerId: active.id, turn: state.turnNumber });
    state.phase = "REFRESH";
    hook(state, "onRefreshPhaseStart", { playerId: active.id });

    active.characterArea.forEach((card) => {
      card.rested = false;
      card.summoningSick = false;
    });
    active.leader.rested = false;

    if (active.donRested.length > 0) {
      active.donActive.push(...active.donRested);
      active.donRested = [];
    }
    pushLog(state, "TURN_REFRESHED", { playerId: active.id });

    state.phase = "DRAW";
    hook(state, "onDrawPhaseStart", { playerId: active.id });
    const drawn = drawFromDeck(active, 1);
    if (drawn.length > 0) {
      active.hand.push(drawn[0] as CardInstance);
      pushLog(state, "CARD_DRAWN", { playerId: active.id, card: drawn[0]?.name });
    } else {
      pushLog(state, "CARD_DRAW_FAILED_EMPTY_DECK", { playerId: active.id });
    }

    state.phase = "DON";
    hook(state, "onDonPhaseStart", { playerId: active.id });
    const donToAdd = state.turnNumber === 1 && active.id === state.firstPlayerId ? 1 : 2;
    const addCount = Math.min(donToAdd, active.donDeck.length);
    for (let i = 0; i < addCount; i += 1) {
      const don = active.donDeck.shift();
      if (don) active.donActive.push(don);
    }
    pushLog(state, "DON_ADDED", { playerId: active.id, amount: addCount });

    state.phase = "MAIN";
    hook(state, "onMainPhaseStart", { playerId: active.id });
  }

  private checkWinLoss(state: GameState): GameState {
    hook(state, "beforeLethalCheck");
    if (state.winnerId && state.loserId) {
      state.status = "FINISHED";
    }
    hook(state, "afterLethalCheck");
    return state;
  }

  private resolveAttackIfNeeded(state: GameState): GameState {
    const attack = state.currentAttack;
    if (!attack || attack.resolved) return state;
    const attackingPlayer = state.players[attack.attackingPlayerId];
    const attacker =
      attackingPlayer.leader.instanceId === attack.attackerId
        ? attackingPlayer.leader
        : attackingPlayer.characterArea.find((c) => c.instanceId === attack.attackerId);
    if (!attacker) {
      throw new Error("Attack resolution failed because attacker was not found.");
    }
    const attackerPower = attacker.power ?? 0;

    if (attack.target === "LEADER") {
      const defender = state.players[attack.defendingPlayerId];
      const defenderPower = defender.leader.power ?? 0;
      if (attackerPower < defenderPower) {
        pushLog(state, "ATTACK_NO_DAMAGE", {
          target: "LEADER",
          attackingPlayerId: attack.attackingPlayerId,
          defendingPlayerId: attack.defendingPlayerId,
          attackerPower,
          defenderPower
        });
      } else {
        if (defender.life.length > 0) {
          const lifeCard = defender.life.pop();
          if (lifeCard) {
            defender.hand.push(lifeCard);
            pushLog(state, "LIFE_TAKEN", { defendingPlayerId: defender.id, remainingLife: defender.life.length });
            pushLog(state, "CARD_ADDED_TO_HAND_FROM_LIFE", { defendingPlayerId: defender.id, card: lifeCard.name });
            hook(state, "onLifeTaken", { playerId: defender.id, card: lifeCard.instanceId });
          }
        } else {
          state.winnerId = attack.attackingPlayerId;
          state.loserId = attack.defendingPlayerId;
          state.status = "FINISHED";
          pushLog(state, "GAME_WON", {
            winnerId: state.winnerId,
            loserId: state.loserId,
            reason: "Opponent took lethal damage with no life remaining."
          });
        }
      }
    }

    if (attack.target === "CHARACTER") {
      const defendingPlayer = state.players[attack.defendingPlayerId];
      const defender = defendingPlayer.characterArea.find((c) => c.instanceId === attack.defendingCharacterId);
      if (!defender) {
        throw new Error("Character attack failed because defender was not found on board.");
      }

      const defenderPower = defender.power ?? 0;
      pushLog(state, "CHARACTER_BATTLE_RESOLVED", {
        attackerId: attacker.instanceId,
        defenderId: defender.instanceId,
        attackerPower,
        defenderPower
      });

      if (attackerPower >= defenderPower) {
        this.koCharacter(state, defendingPlayer.id, defender.instanceId);
      } else {
        pushLog(state, "ATTACK_NO_DAMAGE", {
          target: "CHARACTER",
          attackerId: attacker.instanceId,
          defenderId: defender.instanceId,
          attackerPower,
          defenderPower
        });
      }
    }

    hook(state, "onDamageResolved", { attackerId: attack.attackerId });
    attack.resolved = true;
    state.currentAttack = null;
    return state;
  }

  private runSharedResolution(state: GameState): GameState {
    hook(state, "beforeActionResolve");
    state = this.resolveAttackIfNeeded(state);
    state = this.checkWinLoss(state);
    hook(state, "afterActionResolve");
    if (state.status === "FINISHED") state.phase = "FINISHED";
    return state;
  }

  private resolveAttacker(player: PlayerState, attackerRef: "leader" | number | string): CardInstance {
    if (attackerRef === "leader") return player.leader;
    if (typeof attackerRef === "number") {
      const card = player.characterArea[attackerRef];
      if (!card) throw new Error("Character index out of bounds.");
      return card;
    }
    const found = player.characterArea.find((c) => c.instanceId === attackerRef);
    if (!found) throw new Error("Attacker not found in character area.");
    return found;
  }

  private resolveCharacterOnField(player: PlayerState, characterRef: number | string): CardInstance {
    if (typeof characterRef === "number") {
      const card = player.characterArea[characterRef];
      if (!card) throw new Error("Character index out of bounds.");
      return card;
    }
    const found = player.characterArea.find((c) => c.instanceId === characterRef);
    if (!found) throw new Error("Character not found in character area.");
    return found;
  }

  private koCharacter(state: GameState, playerId: PlayerId, characterInstanceId: string): void {
    const player = state.players[playerId];
    const idx = player.characterArea.findIndex((c) => c.instanceId === characterInstanceId);
    if (idx < 0) {
      throw new Error("KO resolution failed: character not found.");
    }
    const [koCard] = player.characterArea.splice(idx, 1);
    if (!koCard) return;
    player.trash.push(koCard);
    pushLog(state, "CHARACTER_KO", {
      playerId,
      cardId: koCard.instanceId,
      cardName: koCard.name
    });
  }

  private playCharacter(state: GameState, playerId: PlayerId, handIndex?: number, replaceRef?: number | string): GameState {
    guardMainPhaseForActive(state, playerId);
    const player = state.players[playerId];
    const mustReplace = player.characterArea.length >= CHARACTER_AREA_LIMIT;
    let replacedCharacter: CardInstance | null = null;
    if (mustReplace) {
      if (replaceRef === undefined) {
        throw new Error("Character area is full. Choose a character to replace.");
      }
      replacedCharacter = this.resolveCharacterOnField(player, replaceRef);
    }

    const candidateIndex =
      handIndex ?? player.hand.findIndex((card) => card.type === "CHARACTER" && (card.cost ?? 0) <= player.donActive.length);
    const card = player.hand[candidateIndex];
    if (!card) throw new Error("No valid card found in hand at that index.");
    if (card.type !== "CHARACTER") throw new Error("Only character cards are playable.");
    const cardCost = card.cost ?? 0;
    if (cardCost > player.donActive.length) throw new Error("Not enough active DON to play this card.");

    for (let i = 0; i < cardCost; i += 1) {
      const don = player.donActive.shift();
      if (don) player.donRested.push(don);
    }

    if (replacedCharacter) {
      this.koCharacter(state, playerId, replacedCharacter.instanceId);
      pushLog(state, "CHARACTER_REPLACED", {
        playerId,
        replacedCardId: replacedCharacter.instanceId,
        replacedCardName: replacedCharacter.name,
        incomingCardName: card.name
      });
    }

    player.hand.splice(candidateIndex, 1);
    card.rested = false;
    card.summoningSick = true;
    player.characterArea.push(card);

    pushLog(state, "CHARACTER_PLAYED", { playerId, card: card.name, cost: cardCost });
    pushLog(state, "CARD_LEFT_HAND", { playerId, cardId: card.instanceId });
    pushLog(state, "CARD_ENTERED_FIELD", { playerId, cardId: card.instanceId });
    hook(state, "onCharacterPlayed", { playerId, cardId: card.instanceId });

    return this.runSharedResolution(state);
  }

  private declareAttackLeader(
    state: GameState,
    playerId: PlayerId,
    attackerRef: "leader" | number | string = "leader"
  ): GameState {
    guardMainPhaseForActive(state, playerId);
    const player = state.players[playerId];
    const defenderId = opponentId(playerId);
    const attacker = this.resolveAttacker(player, attackerRef);

    if (attacker.rested) throw new Error("Attacker is already rested.");
    if (attacker.type === "LEADER" && player.turnsTaken === 0) {
      throw new Error("Leader cannot attack on that player's first turn.");
    }
    if (attacker.type === "CHARACTER" && attacker.summoningSick) {
      throw new Error("Character cannot attack on the turn it is played.");
    }

    attacker.rested = true;
    state.currentAttack = {
      attackerId: attacker.instanceId,
      attackingPlayerId: playerId,
      defendingPlayerId: defenderId,
      target: "LEADER",
      resolved: false
    };
    pushLog(state, "ATTACK_DECLARED", { attackingPlayerId: playerId, defendingPlayerId: defenderId, attacker: attacker.name });
    pushLog(state, "ATTACKER_RESTED", { attackerId: attacker.instanceId });
    hook(state, "onAttackDeclared", { attackingPlayerId: playerId, attackerId: attacker.instanceId });

    return this.runSharedResolution(state);
  }

  private declareAttackCharacter(
    state: GameState,
    playerId: PlayerId,
    attackerRef: "leader" | number | string,
    defenderRef: number | string
  ): GameState {
    guardMainPhaseForActive(state, playerId);
    const player = state.players[playerId];
    const defenderId = opponentId(playerId);
    const defenderPlayer = state.players[defenderId];
    const attacker = this.resolveAttacker(player, attackerRef);
    const defender = this.resolveCharacterOnField(defenderPlayer, defenderRef);

    if (attacker.rested) throw new Error("Attacker is already rested.");
    if (attacker.type === "LEADER" && player.turnsTaken === 0) {
      throw new Error("Leader cannot attack on that player's first turn.");
    }
    if (attacker.summoningSick) throw new Error("Character cannot attack on the turn it is played.");
    if (!defender.rested) throw new Error("Character attacks can only target rested opponent characters.");

    attacker.rested = true;
    state.currentAttack = {
      attackerId: attacker.instanceId,
      attackingPlayerId: playerId,
      defendingPlayerId: defenderId,
      target: "CHARACTER",
      defendingCharacterId: defender.instanceId,
      resolved: false
    };
    pushLog(state, "ATTACK_DECLARED", {
      attackingPlayerId: playerId,
      defendingPlayerId: defenderId,
      attacker: attacker.name,
      targetType: "CHARACTER",
      targetCharacter: defender.name
    });
    pushLog(state, "ATTACKER_RESTED", { attackerId: attacker.instanceId });
    hook(state, "onAttackDeclared", { attackingPlayerId: playerId, attackerId: attacker.instanceId });

    return this.runSharedResolution(state);
  }

  private endTurn(state: GameState, playerId: PlayerId): GameState {
    guardMainPhaseForActive(state, playerId);
    pushLog(state, "END_TURN_REQUESTED", { playerId });
    state.phase = "END";
    hook(state, "onTurnEnd", { playerId, turn: state.turnNumber });
    pushLog(state, "TURN_ENDED", { playerId, turn: state.turnNumber });
    state.players[playerId].turnsTaken += 1;

    state.activePlayerId = opponentId(playerId);
    state.priorityPlayerId = state.activePlayerId;
    state.turnNumber += 1;
    state.phase = "REFRESH";
    this.runTurnStartPhases(state);
    return state;
  }

  private autoMainStep(state: GameState, playerId: PlayerId): GameState {
    guardMainPhaseForActive(state, playerId);
    const player = state.players[playerId];
    const playable = player.hand.findIndex((card) => card.type === "CHARACTER" && (card.cost ?? 0) <= player.donActive.length);
    if (playable >= 0 && player.characterArea.length < CHARACTER_AREA_LIMIT) {
      return this.playCharacter(state, playerId, playable);
    }
    const attackableCharIndex = player.characterArea.findIndex((c) => !c.rested && !c.summoningSick);
    if (attackableCharIndex >= 0) {
      return this.declareAttackLeader(state, playerId, attackableCharIndex);
    }
    if (!player.leader.rested && player.turnsTaken > 0) {
      return this.declareAttackLeader(state, playerId, "leader");
    }
    return this.endTurn(state, playerId);
  }
}
