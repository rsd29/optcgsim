import type { CardDefinition, CardInstance, DomainEventType, GameState, PlayerId, PlayerState } from "../game/types";
import type { ClientRequest } from "../game/protocol";
import { getCardCost, getCardLife } from "../game/cardCatalog";
import { DEMO_CARD_POOL } from "../game/mockCardPool";
import {
  closeBlockWindow,
  closeCounterWindowForResolution,
  completeCombat,
  createIdleCombatState,
  declareAttack,
  finalizeCombat,
  openBlockWindow,
  setBlockedTarget
} from "./core/combat";
import { createDomainEvent, resetDomainEventCounter } from "./core/domainEvents";
import { resetEffectCounter } from "./core/effects";
import { assertEngineInvariants } from "./core/invariants";
import { generateLegalActions } from "./core/legalActions";
import { expireBattleModifiers, expireTurnModifiers, getEffectivePower, getGrantedKeywords, resetModifierCounter } from "./core/modifiers";
import { resolvePrompt, resetPromptCounter } from "./core/prompts";
import { processRequestWithValidation } from "./core/requestProcessor";
import { applyDomainEvent } from "./core/stateTransitions";

const HAND_SIZE = 5;
const CHARACTER_AREA_LIMIT = 5;
const STARTING_DON = 10;
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
  const pool = DEMO_CARD_POOL.filter((card) => card.type === "CHARACTER");
  if (pool.length === 0) {
    throw new Error("DEMO_CARD_POOL has no character cards. Add at least one character card.");
  }

  const defs: CardDefinition[] = [];
  for (let i = 0; i < 50; i += 1) {
    const source = pool[randomInt(0, pool.length - 1)]!;
    defs.push({ ...source });
  }
  return defs;
};

const getDemoLeaderDefinition = (cardId: "L001"): CardDefinition => {
  const leader = DEMO_CARD_POOL.find((card) => card.cardId === cardId && card.type === "LEADER");
  if (!leader) {
    throw new Error(`Missing required leader definition ${cardId} in DEMO_CARD_POOL.`);
  }
  return leader;
};

const buildCardDefinitionsCatalog = (): Record<string, CardDefinition> => {
  const catalog: Record<string, CardDefinition> = {};
  for (const def of DEMO_CARD_POOL) {
    catalog[def.cardId] = def;
  }
  return catalog;
};

const makeCardInstance = (cardDef: CardDefinition, ownerId: PlayerId): CardInstance => ({
  instanceId: makeInstanceId("CARD"),
  cardId: cardDef.cardId,
  name: cardDef.name,
  type: cardDef.type,
  cost: cardDef.cost,
  power: cardDef.power,
  counter: cardDef.counter,
  keywords: cardDef.keywords,
  abilities: cardDef.abilities,
  ownerId,
  controllerId: ownerId,
  rested: false,
  summoningSick: false,
  attachedDon: 0,
  faceup: true
});

const makePlayer = (id: PlayerId, name: string): PlayerState => {
  const leader = makeCardInstance(getDemoLeaderDefinition("L001"), id);
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
    turnsTaken: 0,
    oncePerTurnUsage: {}
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
  cardDefinitions: buildCardDefinitionsCatalog(),
  players: {
    P1: makePlayer("P1", playerAName),
    P2: makePlayer("P2", playerBName)
  },
  combat: createIdleCombatState(),
  winnerId: null,
  loserId: null,
  log: [],
  domainEvents: [],
  effectsQueue: [],
  pendingSelection: null,
  pendingPrompt: null,
  lastingModifiers: [],
  legalActions: { P1: [], P2: [] },
  hooks: {
    canMulligan: false,
    pendingStartOfGameEffects: false,
    pendingResolution: false
  }
});

const playerList = (state: GameState): PlayerState[] => [state.players.P1, state.players.P2];
const opponentId = (playerId: PlayerId): PlayerId => (playerId === "P1" ? "P2" : "P1");

const CORE_EVENT_TYPES = new Set<DomainEventType>([
  "MATCH_CREATED",
  "ROLL_RESULT",
  "FIRST_PLAYER_SET",
  "DECK_SHUFFLED",
  "OPENING_HAND_DRAWN",
  "MULLIGAN_KEEP_HAND",
  "LIFE_SET",
  "TEST_START_WITH_TEN_DON",
  "TURN_REFRESHED",
  "TURN_STARTED",
  "PHASE_STARTED",
  "CARD_DRAWN",
  "CARD_DRAW_FAILED_EMPTY_DECK",
  "DON_ADDED",
  "CARD_PLAYED",
  "CHARACTER_PLAYED",
  "CHARACTER_REPLACED",
  "CARD_LEFT_HAND",
  "CARD_ENTERED_FIELD",
  "ATTACK_DECLARED",
  "ATTACKER_RESTED",
  "BLOCK_WINDOW_OPENED",
  "ATTACK_BLOCKED",
  "BLOCK_DECLARED",
  "BLOCK_PASSED",
  "BATTLE_RESOLVED",
  "CHARACTER_BATTLE_RESOLVED",
  "ATTACK_NO_DAMAGE",
  "CARD_KO",
  "CHARACTER_KO",
  "CARD_MOVED",
  "LIFE_TAKEN",
  "CARD_ADDED_TO_HAND_FROM_LIFE",
  "END_TURN_REQUESTED",
  "TURN_ENDED",
  "GAME_WON",
  "GAME_ENDED",
  "PROMPT_OPENED",
  "PROMPT_RESOLVED",
  "EFFECT_QUEUED",
  "EFFECT_RESOLVED"
]);

const pushLog = (state: GameState, type: string, payload?: Record<string, unknown>): void => {
  if (CORE_EVENT_TYPES.has(type as DomainEventType)) {
    applyDomainEvent(state, createDomainEvent(type as DomainEventType, payload as never));
    return;
  }
  if (type.startsWith("HOOK_")) {
    const hookPayload = payload ? { payload } : {};
    applyDomainEvent(
      state,
      createDomainEvent("HOOK", {
        name: type,
        ...hookPayload
      })
    );
    return;
  }
  applyDomainEvent(
    state,
    createDomainEvent("LEGACY_LOGGED", {
      originalType: type,
      payload: payload ?? {}
    })
  );
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

const hasBlockerKeyword = (state: GameState, card: CardInstance): boolean => getGrantedKeywords(state, card).includes("BLOCKER");

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
    if (request.type === "GET_STATE") return this.getState();

    const next = processRequestWithValidation(this.state, request, {
      startMatch: (playerAName, playerBName, testStartWithTenDon) => {
        instanceCounter = 1;
        donCounter = 1;
        resetDomainEventCounter();
        resetEffectCounter();
        resetModifierCounter();
        resetPromptCounter();
        const nextState = makeInitialState(playerAName, playerBName);
        this.setupMatch(nextState, testStartWithTenDon);
        this.runTurnStartPhases(nextState);
        return nextState;
      },
      playCharacter: (playerId, handIndex, replaceRef) =>
        this.playCharacter(this.getRequiredState(), playerId, handIndex, replaceRef),
      attackLeader: (playerId, attackerRef) => this.declareAttackLeader(this.getRequiredState(), playerId, attackerRef),
      attackCharacter: (playerId, attackerRef, defenderRef) =>
        this.declareAttackCharacter(this.getRequiredState(), playerId, attackerRef, defenderRef),
      blockAttack: (playerId, blockerRef) => this.blockAttack(this.getRequiredState(), playerId, blockerRef),
      passBlock: (playerId) => this.passBlock(this.getRequiredState(), playerId),
      endTurn: (playerId) => this.endTurn(this.getRequiredState(), playerId),
      autoMainStep: (playerId) => this.autoMainStep(this.getRequiredState(), playerId),
      autoPlay: (playerId, maxSteps) => {
        this.getRequiredState();
        for (let i = 0; i < maxSteps; i += 1) {
          const current = this.getRequiredState();
          if (current.status === "FINISHED") break;
          this.state = this.autoMainStep(current, playerId);
        }
        return this.getRequiredState();
      },
      resolvePrompt: (playerId, promptId, payload) => this.resolvePromptAction(this.getRequiredState(), playerId, promptId, payload)
    });
    this.state = next;
    if (this.state) {
      this.state.legalActions = generateLegalActions(this.state);
      assertEngineInvariants(this.state);
    }
    this.emitState();
    return this.getState();
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
      const leaderLife = player.leader.type === "LEADER" ? (getCardLife(state, player.leader) ?? 5) : 5;
      const lifeCards = drawFromDeck(player, leaderLife);
      player.life.push(...lifeCards);
      pushLog(state, "LIFE_SET", { playerId: player.id, count: lifeCards.length });
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
    state.combat = createIdleCombatState();
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
    const attack = state.combat.attack;
    if (!attack || attack.resolved) return state;
    if (state.combat.status !== "DAMAGE_RESOLUTION") return state;
    const attackingPlayer = state.players[attack.attackingPlayerId];
    const attacker =
      attackingPlayer.leader.instanceId === attack.attackerId
        ? attackingPlayer.leader
        : attackingPlayer.characterArea.find((c) => c.instanceId === attack.attackerId);
    if (!attacker) {
      throw new Error("Attack resolution failed because attacker was not found.");
    }
    const attackerPower = getEffectivePower(state, attacker);

    if (attack.target === "LEADER") {
      const defender = state.players[attack.defendingPlayerId];
      const defenderPower = getEffectivePower(state, defender.leader);
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

      const defenderPower = getEffectivePower(state, defender);
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
    expireBattleModifiers(state);
    state.combat = completeCombat(state.combat);
    state.combat = finalizeCombat(state.combat);
    state.combat = createIdleCombatState();
    return state;
  }

  private runSharedResolution(state: GameState): GameState {
    hook(state, "beforeActionResolve");
    if (state.combat.status === "COUNTER_WINDOW") {
      // Counter step is intentionally a no-op in MVP but keeps the state machine explicit.
      state.combat = closeCounterWindowForResolution(state.combat);
    }
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
      handIndex ?? player.hand.findIndex((card) => card.type === "CHARACTER" && getCardCost(state, card) <= player.donActive.length);
    const card = player.hand[candidateIndex];
    if (!card) throw new Error("No valid card found in hand at that index.");
    if (card.type !== "CHARACTER") throw new Error("Only character cards are playable.");
    const cardCost = getCardCost(state, card);
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
    pushLog(state, "CARD_PLAYED", { playerId, cardId: card.instanceId, cardName: card.name });
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
    if (state.combat.attack && !state.combat.attack.resolved) {
      throw new Error("Cannot declare another attack until the current block phase/attack is resolved.");
    }
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
    state.combat = declareAttack(state.combat, {
      attackerId: attacker.instanceId,
      attackingPlayerId: playerId,
      defendingPlayerId: defenderId,
      target: "LEADER"
    });
    state.combat = openBlockWindow(state.combat);
    state.priorityPlayerId = defenderId;
    pushLog(state, "ATTACK_DECLARED", { attackingPlayerId: playerId, defendingPlayerId: defenderId, attacker: attacker.name });
    pushLog(state, "ATTACKER_RESTED", { attackerId: attacker.instanceId });
    pushLog(state, "BLOCK_WINDOW_OPENED", { attackingPlayerId: playerId, defendingPlayerId: defenderId });
    hook(state, "onAttackDeclared", { attackingPlayerId: playerId, attackerId: attacker.instanceId });

    return state;
  }

  private declareAttackCharacter(
    state: GameState,
    playerId: PlayerId,
    attackerRef: "leader" | number | string,
    defenderRef: number | string
  ): GameState {
    guardMainPhaseForActive(state, playerId);
    if (state.combat.attack && !state.combat.attack.resolved) {
      throw new Error("Cannot declare another attack until the current block phase/attack is resolved.");
    }
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
    state.combat = declareAttack(state.combat, {
      attackerId: attacker.instanceId,
      attackingPlayerId: playerId,
      defendingPlayerId: defenderId,
      target: "CHARACTER",
      defendingCharacterId: defender.instanceId
    });
    state.combat = openBlockWindow(state.combat);
    state.priorityPlayerId = defenderId;
    pushLog(state, "ATTACK_DECLARED", {
      attackingPlayerId: playerId,
      defendingPlayerId: defenderId,
      attacker: attacker.name,
      targetType: "CHARACTER",
      targetCharacter: defender.name
    });
    pushLog(state, "ATTACKER_RESTED", { attackerId: attacker.instanceId });
    pushLog(state, "BLOCK_WINDOW_OPENED", { attackingPlayerId: playerId, defendingPlayerId: defenderId });
    hook(state, "onAttackDeclared", { attackingPlayerId: playerId, attackerId: attacker.instanceId });

    return state;
  }

  private blockAttack(state: GameState, playerId: PlayerId, blockerRef: number | string): GameState {
    if (state.status !== "IN_PROGRESS") throw new Error("Game is not in progress.");
    if (state.phase !== "MAIN") throw new Error("Block is only allowed during MAIN phase.");
    const attack = state.combat.attack;
    if (!attack || attack.resolved) throw new Error("No unresolved attack to block.");
    if (state.combat.status !== "BLOCK_WINDOW") throw new Error("Block phase is closed for this attack.");
    if (playerId !== attack.defendingPlayerId) throw new Error("Only the defending player can block this attack.");
    if (state.priorityPlayerId !== playerId) throw new Error("Defending player does not have priority to block.");

    const defender = state.players[playerId];
    const blocker = this.resolveCharacterOnField(defender, blockerRef);
    if (blocker.rested) throw new Error("Blocker must be active (not rested).");
    if (!hasBlockerKeyword(state, blocker)) throw new Error("Selected character does not have Blocker.");

    state.combat = setBlockedTarget(state.combat, blocker.instanceId);
    state.priorityPlayerId = attack.attackingPlayerId;

    pushLog(state, "ATTACK_BLOCKED", {
      defendingPlayerId: playerId,
      blockerId: blocker.instanceId,
      blockerName: blocker.name
    });
    pushLog(state, "BLOCK_DECLARED", {
      defendingPlayerId: playerId,
      blockerId: blocker.instanceId
    });
    hook(state, "onAttackBlocked", {
      defendingPlayerId: playerId,
      blockerId: blocker.instanceId
    });

    return this.runSharedResolution(state);
  }

  private passBlock(state: GameState, playerId: PlayerId): GameState {
    if (state.status !== "IN_PROGRESS") throw new Error("Game is not in progress.");
    if (state.phase !== "MAIN") throw new Error("Block pass is only allowed during MAIN phase.");
    const attack = state.combat.attack;
    if (!attack || attack.resolved) throw new Error("No unresolved attack to resolve.");
    if (state.combat.status !== "BLOCK_WINDOW") throw new Error("Block phase is already closed for this attack.");
    if (playerId !== attack.defendingPlayerId) throw new Error("Only the defending player can pass block.");
    if (state.priorityPlayerId !== playerId) throw new Error("Defending player does not have priority to pass block.");

    state.combat = closeBlockWindow(state.combat);
    state.priorityPlayerId = attack.attackingPlayerId;
    pushLog(state, "BLOCK_PASSED", { defendingPlayerId: playerId });

    return this.runSharedResolution(state);
  }

  private resolvePromptAction(
    state: GameState,
    playerId: PlayerId,
    promptId: string,
    payload: {
      selectedCardInstanceIds?: string[];
      selectedOptionId?: string;
      yesNoChoice?: boolean;
    }
  ): GameState {
    resolvePrompt(state, playerId, promptId, payload);
    return state;
  }

  private endTurn(state: GameState, playerId: PlayerId): GameState {
    guardMainPhaseForActive(state, playerId);
    pushLog(state, "END_TURN_REQUESTED", { playerId });
    state.phase = "END";
    hook(state, "onTurnEnd", { playerId, turn: state.turnNumber });
    pushLog(state, "TURN_ENDED", { playerId, turn: state.turnNumber });
    expireTurnModifiers(state, state.turnNumber);
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
    const playable = player.hand.findIndex((card) => card.type === "CHARACTER" && getCardCost(state, card) <= player.donActive.length);
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
