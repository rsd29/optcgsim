import { describe, expect, test } from "vitest";
import { GameEngineServer } from "../src/engine/gameEngineServer";
import {
  closeBlockWindow,
  closeCounterWindowForResolution,
  completeCombat,
  createIdleCombatState,
  declareAttack,
  finalizeCombat,
  openBlockWindow
} from "../src/engine/core/combat";
import { enqueueEffectInstances, resolveEffectQueue } from "../src/engine/core/effects";
import { generateLegalActionsForPlayer } from "../src/engine/core/legalActions";
import { expireTurnModifiers, getEffectivePower } from "../src/engine/core/modifiers";
import { openPrompt, resolvePrompt } from "../src/engine/core/prompts";
import { processRequestWithValidation } from "../src/engine/core/requestProcessor";
import type { CardInstance, GamePhase, GameState, GameStatus, PlayerId, PromptState } from "../src/game/types";

const makeCard = (
  input: Partial<CardInstance> & Pick<CardInstance, "instanceId" | "cardId" | "name" | "ownerId" | "type">
): CardInstance => ({
  instanceId: input.instanceId,
  cardId: input.cardId,
  name: input.name,
  type: input.type,
  cost: input.cost ?? 1,
  power: input.power ?? 1000,
  counter: input.counter ?? 0,
  keywords: input.keywords ?? [],
  abilities: input.abilities ?? [],
  ownerId: input.ownerId,
  controllerId: input.controllerId ?? input.ownerId,
  rested: input.rested ?? false,
  summoningSick: input.summoningSick ?? false,
  attachedDon: input.attachedDon ?? 0,
  faceup: input.faceup ?? true
});

const makeState = (phase: GamePhase = "MAIN", status: GameStatus = "IN_PROGRESS"): GameState => {
  const p1Leader = makeCard({
    instanceId: "P1-L",
    cardId: "L001",
    name: "P1 Leader",
    ownerId: "P1",
    type: "LEADER",
    power: 5000
  });
  const p2Leader = makeCard({
    instanceId: "P2-L",
    cardId: "L002",
    name: "P2 Leader",
    ownerId: "P2",
    type: "LEADER",
    power: 5000
  });
  return {
    id: "test",
    status,
    turnNumber: 1,
    phase,
    activePlayerId: "P1",
    priorityPlayerId: "P1",
    firstPlayerId: "P1",
    cardDefinitions: {},
    players: {
      P1: {
        id: "P1",
        name: "P1",
        deck: [],
        hand: [],
        life: [],
        trash: [],
        leader: p1Leader,
        characterArea: [],
        stageArea: null,
        donDeck: [],
        donActive: [],
        donRested: [],
        attachedDon: {},
        hasMulliganed: false,
        isGoingFirst: true,
        turnsTaken: 1,
        roll: 5,
        oncePerTurnUsage: {}
      },
      P2: {
        id: "P2",
        name: "P2",
        deck: [],
        hand: [],
        life: [],
        trash: [],
        leader: p2Leader,
        characterArea: [],
        stageArea: null,
        donDeck: [],
        donActive: [],
        donRested: [],
        attachedDon: {},
        hasMulliganed: false,
        isGoingFirst: false,
        turnsTaken: 1,
        roll: 3,
        oncePerTurnUsage: {}
      }
    },
    combat: createIdleCombatState(),
    log: [],
    winnerId: null,
    loserId: null,
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
  };
};

const makeHandlers = (state: GameState) => ({
  startMatch: () => state,
  playCharacter: () => state,
  attackLeader: () => state,
  attackCharacter: () => state,
  blockAttack: () => state,
  passBlock: () => state,
  endTurn: () => state,
  autoMainStep: () => state,
  autoPlay: () => state,
  resolvePrompt: () => state
});

const startEngine = (): { engine: GameEngineServer; state: GameState } => {
  const engine = new GameEngineServer();
  const state = engine.processRequest({
    requestId: "start",
    type: "START_MATCH",
    payload: { playerAName: "P1", playerBName: "P2", testStartWithTenDon: true }
  }) as GameState;
  return { engine, state };
};

describe("engine migration architecture", () => {
  test("legal actions expose block/pass in block window", () => {
    const state = makeState();
    const blocker = makeCard({
      instanceId: "P2-C-B",
      cardId: "C-BLK",
      name: "Blocker",
      ownerId: "P2",
      type: "CHARACTER",
      power: 2000,
      keywords: ["BLOCKER"],
      rested: false
    });
    state.players.P2.characterArea.push(blocker);
    state.combat = openBlockWindow(
      declareAttack(state.combat, {
        attackerId: state.players.P1.leader.instanceId,
        attackingPlayerId: "P1",
        defendingPlayerId: "P2",
        target: "LEADER"
      })
    );
    state.priorityPlayerId = "P2";
    const legal = generateLegalActionsForPlayer(state, "P2");
    expect(legal.some((a) => a.type === "BLOCK_ATTACK")).toBe(true);
    expect(legal.some((a) => a.type === "PASS_BLOCK")).toBe(true);
  });

  test("request processor rejects illegal block outside block window", () => {
    const state = makeState();
    expect(() =>
      processRequestWithValidation(
        state,
        {
          requestId: "x",
          type: "BLOCK_ATTACK",
          payload: { playerId: "P2", blockerRef: "P2-C-1" }
        },
        makeHandlers(state)
      )
    ).toThrow(/Illegal action/);
  });

  test("combat transitions run through declared/block/counter/damage/post/complete", () => {
    let combat = createIdleCombatState();
    combat = declareAttack(combat, {
      attackerId: "A1",
      attackingPlayerId: "P1",
      defendingPlayerId: "P2",
      target: "LEADER"
    });
    expect(combat.status).toBe("ATTACK_DECLARED");
    combat = openBlockWindow(combat);
    expect(combat.status).toBe("BLOCK_WINDOW");
    combat = closeBlockWindow(combat);
    expect(combat.status).toBe("COUNTER_WINDOW");
    combat = closeCounterWindowForResolution(combat);
    expect(combat.status).toBe("DAMAGE_RESOLUTION");
    combat = completeCombat(combat);
    expect(combat.status).toBe("POST_BATTLE");
    combat = finalizeCombat(combat);
    expect(combat.status).toBe("COMPLETE");
  });

  test("prompt opens and resolves through engine-owned prompt state", () => {
    const state = makeState();
    const prompt: PromptState = openPrompt(state, {
      kind: "YES_NO",
      controllerPlayerId: "P1",
      title: "Use effect?",
      options: [
        { id: "yes", label: "Yes" },
        { id: "no", label: "No" }
      ]
    });
    expect(state.pendingPrompt?.promptId).toBe(prompt.promptId);
    resolvePrompt(state, "P1", prompt.promptId, { yesNoChoice: true });
    expect(state.pendingPrompt).toBeNull();
  });

  test("effect queue executes primitive ADD_POWER and expires at end turn", () => {
    const state = makeState();
    const source = makeCard({
      instanceId: "P1-C-1",
      cardId: "C001",
      name: "Source",
      ownerId: "P1",
      type: "CHARACTER",
      power: 4000
    });
    state.players.P1.characterArea.push(source);
    enqueueEffectInstances(state, [
      {
        effectInstanceId: "FX-1",
        sourceCardInstanceId: source.instanceId,
        sourcePlayerId: "P1",
        controllerPlayerId: "P1",
        ability: {
          abilityId: "A1",
          sourceCardId: source.cardId,
          timingClass: "TRIGGERED",
          trigger: { event: "CARD_PLAYED" },
          steps: [
            {
              id: "s1",
              kind: "ADD_POWER",
              params: { cardInstanceId: "$SOURCE", amount: 1000, duration: "END_OF_TURN" }
            }
          ]
        },
        stepIndex: 0,
        waitingForSelection: false,
        createdAt: Date.now()
      }
    ]);
    resolveEffectQueue(state);
    expect(getEffectivePower(state, source)).toBe(5000);
    expireTurnModifiers(state, state.turnNumber);
    expect(getEffectivePower(state, source)).toBe(4000);
  });

  test("regression: declare attack then pass block resolves battle and emits events", () => {
    const { engine } = startEngine();
    let state = engine.getState() as GameState;
    const firstActive: PlayerId = state.activePlayerId;
    const second: PlayerId = firstActive === "P1" ? "P2" : "P1";

    state = engine.processRequest({
      requestId: "end-1",
      type: "END_TURN",
      payload: { playerId: firstActive }
    }) as GameState;
    state = engine.processRequest({
      requestId: "end-2",
      type: "END_TURN",
      payload: { playerId: second }
    }) as GameState;

    state = engine.processRequest({
      requestId: "atk",
      type: "ATTACK_LEADER",
      payload: { playerId: firstActive, attackerRef: "leader" }
    }) as GameState;
    expect(state.combat.status).toBe("BLOCK_WINDOW");

    state = engine.processRequest({
      requestId: "pass-block",
      type: "PASS_BLOCK",
      payload: { playerId: second }
    }) as GameState;

    expect(state.combat.status).toBe("IDLE");
    expect(state.domainEvents.some((e) => e.type === "ATTACK_DECLARED")).toBe(true);
    expect(state.domainEvents.some((e) => e.type === "BLOCK_PASSED")).toBe(true);
    expect(state.domainEvents.some((e) => e.type === "LIFE_TAKEN" || e.type === "ATTACK_NO_DAMAGE")).toBe(true);
  });

  test("leader is rested immediately after declaring an attack", () => {
    const { engine } = startEngine();
    let state = engine.getState() as GameState;
    const firstActive: PlayerId = state.activePlayerId;
    const second: PlayerId = firstActive === "P1" ? "P2" : "P1";

    // Advance until the first player can legally attack with leader.
    state = engine.processRequest({
      requestId: "end-a",
      type: "END_TURN",
      payload: { playerId: firstActive }
    }) as GameState;
    state = engine.processRequest({
      requestId: "end-b",
      type: "END_TURN",
      payload: { playerId: second }
    }) as GameState;

    expect(state.players[firstActive].leader.rested).toBe(false);

    state = engine.processRequest({
      requestId: "leader-atk",
      type: "ATTACK_LEADER",
      payload: { playerId: firstActive, attackerRef: "leader" }
    }) as GameState;

    expect(state.players[firstActive].leader.rested).toBe(true);
  });
});
