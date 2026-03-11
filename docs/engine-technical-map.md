# 1. Codebase Map

## Important files and folders

- Engine orchestration: `src/engine/gameEngineServer.ts`
- New core engine scaffolding:
  - `src/engine/core/combat.ts`
  - `src/engine/core/domainEvents.ts`
  - `src/engine/core/stateTransitions.ts`
  - `src/engine/core/eventDispatcher.ts`
  - `src/engine/core/abilities.ts`
  - `src/engine/core/effects.ts`
  - `src/engine/core/invariants.ts`
- Engine transport adapter: `src/engine/engineSocketServer.ts`
- Protocol contract: `src/game/protocol.ts`
- Canonical types: `src/game/types.ts`
- Snapshot shaping: `src/game/snapshot.ts`
- Card pool/mock definitions: `src/game/mockCardPool.ts`
- Client API wrapper: `src/client/gameClient.ts`
- Local client wiring: `src/client/createLocalGameClient.ts`
- UI and interaction state: `src/App.tsx`
- Styling/layout: `src/styles.css`

## Authoritative ownership by concern

- **Rules + state mutation authority**: `src/engine/gameEngineServer.ts`
- **Type authority**: `src/game/types.ts`
- **Request/response contract authority**: `src/game/protocol.ts`
- **UI-readable projection authority**: `src/game/snapshot.ts`
- **Client transport + command API authority**: `src/client/gameClient.ts`
- **Card stat source authority (mock)**: `src/game/mockCardPool.ts`
- **UI interaction intent only (not final legality)**: `src/App.tsx`

## Dependency map

- `App.tsx` -> `createLocalGameClient()` -> `GameClientApi` methods
- `GameClientApi` -> sends `ClientRequest` objects (`protocol.ts`)
- Socket bridge -> `GameEngineServer.processRequest(...)`
- `GameEngineServer` uses:
  - `types.ts` for state structures
  - `core/*` for combat/events/effects/invariants scaffolding
  - `mockCardPool.ts` for deck generation
- Server emits full `GameState`
- Client receives `GameState` and calls `toReadableSnapshot(...)`
- UI renders from `ReadableSnapshot`

---

# 2. Runtime Flow

End-to-end runtime path for a user action (example: attack leader):

1. **UI interaction (`App.tsx`)**
   - User selects attacker card and target intent in local UI state (`selected`, `pendingAttack`, `selectedAttackTarget`).
   - User clicks action button in `renderActionPanel(...)`.
2. **Client command call (`App.tsx`)**
   - Calls `client.attackLeader(playerId, attackerRef)` from `GameClientApi`.
3. **Request construction (`src/client/gameClient.ts`)**
   - `send(...)` wraps payload with generated `requestId`.
   - Sends `ClientRequest`:
     - `type: "ATTACK_LEADER"`
     - `payload: { playerId, attackerRef }`
4. **Transport**
   - Local socket endpoint delivers request to server-side engine adapter.
5. **Engine entry (`GameEngineServer.processRequest`)**
   - Switch dispatches to `declareAttackLeader(...)`.
6. **Validation and mutation**
   - `guardMainPhaseForActive(...)` validates status/phase/active/priority.
   - Additional legality checks in `declareAttackLeader(...)`.
   - Mutates state (`attacker.rested`, `state.combat`, `priorityPlayerId`, logs/events).
7. **Post-request invariant check**
   - `assertEngineInvariants(state)` runs.
8. **State emission**
   - `emitState()` deep-clones and notifies listeners.
9. **Client receive (`gameClient.ts`)**
   - On `STATE_UPDATE`, client stores cloned `GameState`.
   - Calls `notifySnapshot()` which runs `toReadableSnapshot(state)`.
10. **UI re-render (`App.tsx`)**
   - `onSnapshot` listener updates React state.
   - Action panels/board/hands rerender from snapshot + local selection state.

Same flow shape applies to `PLAY_CHARACTER`, `BLOCK_ATTACK`, `PASS_BLOCK`, `END_TURN`, etc.

---

# 3. Canonical State Model

Canonical shape: `GameState` in `src/game/types.ts`.

## Match/global fields

- `id`
  - Meaning: match identifier.
  - Written by: `makeInitialState(...)`.
  - Read by: snapshot/UI/debug.
  - Role: authoritative.
- `status`
  - Values: `LOBBY | SETUP | MULLIGAN | IN_PROGRESS | FINISHED`.
  - Written by: setup, lethal resolution, phase transitions.
  - Read by: guards/UI.
  - Role: authoritative.
- `turnNumber`
  - Written by: setup and `endTurn(...)`.
  - Read by: turn display, first-turn DON logic.
  - Role: authoritative.
- `phase`
  - Written by: turn lifecycle methods.
  - Read by: action guards/UI.
  - Role: authoritative.
- `activePlayerId`
  - Written by: setup/end-turn.
  - Read by: legality guards/UI.
  - Role: authoritative.
- `priorityPlayerId`
  - Written by: setup, combat window shifts, end-turn.
  - Read by: guard functions + block checks.
  - Role: authoritative.
- `firstPlayerId`
  - Written by: setup roll outcome.
  - Read by: draw/don logic.
  - Role: authoritative.

## Per-player state (`players.P1`, `players.P2`)

- Zones:
  - `deck`, `hand`, `life`, `trash`, `characterArea`, `stageArea`, `leader`
- DON:
  - `donDeck`, `donActive`, `donRested`
- Meta:
  - `turnsTaken`, `isGoingFirst`, `roll`, `oncePerTurnUsage`, etc.

These are authoritative and mutated directly in engine handlers.

## Combat-related state

- `combat: CombatState`
  - `combatId`: incrementing combat sequence id.
  - `status`: `IDLE` etc.
  - `attack: AttackState | null`.
- `attack` subfields:
  - `attackerId`, attacker/defender player ids
  - target kind (`LEADER`/`CHARACTER`)
  - optional `defendingCharacterId`
  - `blockPhaseOpen`, `resolved`

Writers:
- attack declaration, block/pass handlers, resolution helpers in `core/combat.ts` and engine.

Readers:
- engine resolution logic, snapshot projection, UI action gating (`snapshot.currentAttack`).

## Logs/debug/effects

- `log: GameEvent[]`
  - User/debug-facing event stream (recent events shown in UI).
  - Now populated via `applyDomainEvent(...)`.
- `domainEvents: DomainEvent[]`
  - Engine-level event stream (first-class domain events).
- `effectsQueue: EffectInstance[]`
  - Future effect runtime queue (currently scaffold with minimal resolver).
- `pendingSelection`
  - Placeholder for future player prompts.
- `lastingModifiers`
  - Placeholder for continuous/duration modifications.
- `hooks: HookState`
  - Existing hook flags from MVP era.

## Winner/loser

- `winnerId`, `loserId`
  - Written in lethal branch of attack resolution.
  - Read by win display/terminal state logic.
  - authoritative.

## Derived/transitional fields

- `ReadableSnapshot.currentAttack` is derived from `state.combat.attack`.
- `ReadableSnapshot.activeHand` duplicates active player's hand projection (derived).
- `p1Hand`/`p2Hand`, `p1Don`/`p2Don` are projection-only derived fields.

---

# 4. Request Surface

All request types are defined in `src/game/protocol.ts` and routed in `GameEngineServer.processRequest(...)`.

## `GET_STATE`
- Entry: `GameClientApi.requestState()`.
- Validation: none.
- Mutation: none.
- Calls: `getState()`.
- Assumption: state may be null before match start.

## `START_MATCH`
- Entry: `GameClientApi.startMatch(...)`.
- Validation: implicit (names accepted as provided).
- Mutation:
  - resets id counters + event/effect counters
  - initializes full state (`makeInitialState`)
  - runs setup + turn start phases
- Calls:
  - `setupMatch(...)`
  - `runTurnStartPhases(...)`
  - `assertEngineInvariants(...)`
- Assumption: one in-memory match at a time.

## `PLAY_CHARACTER`
- Entry: `GameClientApi.playCharacter(...)`
- Validation:
  - `guardMainPhaseForActive`
  - card existence/type
  - cost <= active DON
  - replacement selection required if board full
- Mutation:
  - DON payment (`donActive -> donRested`)
  - hand -> field movement
  - optional replaced card KO
- Calls:
  - `resolveCharacterOnField(...)`, `koCharacter(...)`, `runSharedResolution(...)`
- Assumptions:
  - character area limit = 5
  - no global stack interaction yet

## `ATTACK_LEADER`
- Validation:
  - main-phase active/priority guard
  - unresolved combat guard (`state.combat.attack`)
  - attacker legality (not rested, not summoning sick, leader first-turn restriction)
- Mutation:
  - rest attacker
  - open combat block window
  - hand off priority to defender
- Calls:
  - `resolveAttacker(...)`
  - `openBlockWindow(...)`
- Assumption: one unresolved combat at a time.

## `ATTACK_CHARACTER`
- Same as leader attack, plus:
  - target defender character must already be rested.
- Mutation includes attack target set to character.

## `BLOCK_ATTACK`
- Validation:
  - in progress, main phase
  - combat status must be `BLOCK_WINDOW`
  - requester is defender and has priority
  - blocker exists, active, and has `BLOCKER` keyword
- Mutation:
  - redirect target to blocker
  - close block window to damage resolution
  - return priority to attacker
  - run shared resolution immediately
- Calls:
  - `resolveCharacterOnField(...)`
  - `setBlockedTarget(...)`
  - `runSharedResolution(...)`

## `PASS_BLOCK`
- Validation same window/priority constraints as block.
- Mutation:
  - close block window to damage resolution
  - run shared resolution.

## `END_TURN`
- Validation: main-phase active/priority guard.
- Mutation:
  - phase end events
  - increment ending player's `turnsTaken`
  - swap active/priority
  - increment turn
  - execute next player's turn start phases

## `AUTO_MAIN_STEP` / `AUTO_PLAY`
- Heuristic automation wrappers around same engine methods.
- `AUTO_PLAY` loops max steps.
- Uses same legality checks as underlying actions.

---

# 5. Match Setup and Turn Lifecycle

## Setup path

`START_MATCH` -> `setupMatch(...)`:

1. `status = SETUP`
2. roll both players until non-tie
3. assign first player (`firstPlayerId`, `activePlayerId`, `priorityPlayerId`)
4. shuffle both decks
5. draw opening hand (5 each)
6. set mulligan status and log keep-hand events (no real mulligan choices yet)
7. set life cards (5 each)
8. optional test mode gives both players all 10 DON active
9. transition to `IN_PROGRESS`, turn 1, phase `REFRESH`

Then `runTurnStartPhases(...)` runs immediately.

## Turn progression

`runTurnStartPhases(...)`:

- resets combat to idle
- sets priority to active player
- `REFRESH`
  - unrest all active player's field characters and leader
  - clear summoning sickness on existing field characters
  - move all rested DON to active DON
- `DRAW`
  - draw 1 card (or fail log if deck empty)
- `DON`
  - add DON: first turn of first player = 1, otherwise 2
- `MAIN`
  - action phase where play/attack/end turn happen

`END_TURN`:
- set phase `END`
- increment ending player's `turnsTaken`
- swap active/priority to opponent
- increment `turnNumber`
- rerun turn start phases

---

# 6. Combat System

## Attack declaration

- Leader or character attack is declared in `declareAttackLeader` / `declareAttackCharacter`.
- Attacker is rested immediately.
- Engine writes `state.combat = openBlockWindow(...)`.
- `priorityPlayerId` switches to defender.

## Leader vs character attack differences

- Leader attack target starts as `LEADER`.
- Character attack requires selected defender character to already be rested and sets target as `CHARACTER` with `defendingCharacterId`.

## Blocking

- Defender may:
  - `BLOCK_ATTACK` with active blocker character
  - `PASS_BLOCK`
- Both require combat status = `BLOCK_WINDOW` and defender priority.
- Block rewrites attack target to blocker and moves combat to `DAMAGE_RESOLUTION`.
- Pass moves combat to `DAMAGE_RESOLUTION` unchanged.

## Resolution

`resolveAttackIfNeeded(...)` runs during `runSharedResolution(...)` only when `combat.status === "DAMAGE_RESOLUTION"`.

- Finds attacker by `attackerId`.
- If target `LEADER`:
  - compare attacker power vs leader power
  - if successful and defender has life: pop life card to hand
  - else if no life: declare winner/loser and finish
- If target `CHARACTER`:
  - compare attacker power vs defender character power
  - attacker >= defender -> KO defender to trash

Then:
- hook/log damage resolved
- combat marked complete then reset to idle.

## Current limitations / simplifications

- No counter window runtime yet.
- Blocking immediately leads to resolution; no interleaved chain.
- No replacement/prevention handling.
- No triggered response stack during battle windows.
- Blocker does not rest on block in current implementation.

---

# 7. Effects / Hooks / Ability Support

What exists now:

- **Hooks**: yes (`hook(...)` in engine), emitted as `HOOK_*` events.
  - They are still mostly telemetry/event emission, not a full effect language runtime.
- **Event model**: yes, first-class `DomainEvent` now exists.
  - `pushLog(...)` feeds `applyDomainEvent(...)`.
- **Ability model**: scaffold exists in `types.ts`:
  - `AbilityDefinition`, `TriggerDefinition`, `EffectStep`, etc.
- **Effect queue**: scaffold exists:
  - `GameState.effectsQueue`
  - queue insertion and resolver loop in `core/effects.ts`
- **Timing windows**: partial:
  - combat statuses include placeholders (`COUNTER_WINDOW`, etc.)
  - actual runtime windows implemented only for block/damage today.
- **Modifier system**: scaffold only:
  - `LastingModifier` type + state array, no evaluator/executor.
- **Source tracking**: partial:
  - `EffectInstance` stores source ids/player ids.

Where they plug in now:

- `stateTransitions.applyDomainEvent(...)` -> `eventDispatcher.dispatchDomainEvent(...)`
- `dispatchDomainEvent(...)` -> `collectTriggeredAbilitiesForEvent(...)`
- triggered candidates -> effect instances -> queue -> minimal resolver

What is executable today:

- Real procedural rules in `gameEngineServer.ts` still perform all gameplay outcomes.
- Effect queue currently does not apply card effect steps.

---

# 8. Current Hard-Coded Rule Paths

Procedural areas in `gameEngineServer.ts`:

- Character play flow: `playCharacter(...)`
- Attack declaration: `declareAttackLeader(...)`, `declareAttackCharacter(...)`
- Block/pass: `blockAttack(...)`, `passBlock(...)`
- Damage/life/KO/win: `resolveAttackIfNeeded(...)`
- Setup/turn progression: `setupMatch(...)`, `runTurnStartPhases(...)`, `endTurn(...)`

Scaling impact:

- Good for MVP clarity and deterministic behavior.
- Poor fit for many-card effect diversity because every new edge case risks branching these handlers.
- Without shifting to event/effect resolution pipeline, complex “you may / if you do / instead / until” will explode handler complexity.

---

# 9. UI Coupling

`App.tsx` currently holds temporary interaction state:

- `selected`
- `pendingAttack`
- `selectedAttackTarget`
- `pendingReplace`

Engine-owned legality:
- final action guard/rejections in server methods.

Client/UI-owned interaction workflow:
- multi-click selection, target staging, and button visibility.

Coupling risk:
- UI still encodes assumptions about legal targeting (`canSelectAsAttackTarget`, block selection expectations).
- Combat projection uses legacy-like `currentAttack` alias from snapshot, even though engine stores combat under `state.combat`.

Net:
- engine remains authoritative for rule enforcement, but UI still embeds rule-shaped interaction assumptions that could drift as effect windows expand.

---

# 10. Type System and Drift Audit

## Current compile state

- `npm run build` currently passes.

## Drift areas and risk hot spots

1. **Domain event typing is intentionally loose**
   - `DomainEventType` includes `(string & {})`, allowing arbitrary strings.
   - Practical for migration, but weakens compile guarantees.
2. **Dual event concepts**
   - `log: GameEvent[]` and `domainEvents: DomainEvent[]` coexist.
   - `log` is currently populated from domain events; could diverge if bypassed.
3. **Combat projection compatibility shim**
   - snapshot still exports `currentAttack` while canonical model is `combat`.
4. **Ability/effect schema breadth exceeds runtime support**
   - many types exist without full executors/validators yet.

No hard compile-time mismatches currently, but these are structural drift risks.

---

# 11. Known Missing Core Game Systems

- **Domain event system (strict contracts)**
  - Exists structurally, but payload schemas and exhaustive typing per event are missing.
- **Triggered ability runtime**
  - Trigger collection exists; condition/cost execution and robust ordering are missing.
- **Activated ability runtime**
  - No request path for activate-main/battle abilities yet.
- **Static/continuous effect system**
  - No runtime evaluator applying static modifiers continuously.
- **Effect resolution queue or stack**
  - Queue exists; no true response stack/priority-chain model.
- **Combat state machine (full)**
  - Combat statuses exist; only subset is active.
- **Counter step**
  - Placeholder only.
- **Event cards**
  - No cast/resolve path for event card type.
- **Trigger from life**
  - No life trigger window or trigger card execution.
- **Lasting modifier system**
  - Types exist; no active modifier application engine.
- **Duration/expiration handling**
  - `ExpirationRule` exists; no scheduler/sweeper.
- **Replacement/prevention framework**
  - No interception layer for “instead/prevent/reduce” effects.
- **Hidden information / reveal / search handling**
  - No prompt model for private zone operations.
- **Target legality revalidation**
  - Not done at each effect-step execution (effect runtime not built yet).
- **Once-per-turn tracking (runtime enforcement)**
  - Field exists (`oncePerTurnUsage`), enforcement not integrated.
- **Source-aware effect resolution**
  - Source fields exist; no hard source-presence checks per step.
- **Invariant validation**
  - Basic invariants exist; many zone/accounting invariants still absent.
- **Legal action generation**
  - No canonical engine API returning legal moves/windows.
- **Engine-level prompt/choice system for optional effects**
  - No pending prompt protocol for “you may”, “choose”, hidden selections.

---

# 12. Extension Points

Where future effect engine should plug in:

- **Emit engine events**
  - already centralized via `pushLog -> applyDomainEvent`.
  - continue migrating all rule mutations through domain-event application.
- **Collect triggered abilities**
  - `dispatchDomainEvent(...)` and `collectTriggeredAbilitiesForEvent(...)`.
- **Queue effect instances**
  - `enqueueEffectInstances(...)` in `core/effects.ts`.
- **Combat windows**
  - `CombatState.status` and transition helpers in `core/combat.ts`.
- **Static modifier checks**
  - future `modifiers` module should apply before legality checks and before battle power comparisons.
- **Optional choices representation**
  - `pendingSelection` should evolve into prompt system with request/response loop in protocol.

---

# 13. Recommended Next Refactors

## Immediate fixes

1. Tighten `DomainEventType` into explicit union + typed payload map.
2. Ensure no direct state mutation path bypasses domain-event application for key gameplay transitions.
3. Add minimal unit tests around combat transitions and block window invariants.

## Short-term structural improvements

1. Add `legalActions` engine module returning current legal requests per player/window.
2. Introduce `requestProcessor` to split:
   - request validation
   - command translation
   - event emission
3. Replace UI-side legality assumptions with server-provided legal action hints.

## Medium-term effect-engine groundwork

1. Implement effect-step executor primitives (`DRAW`, `REST`, `MOVE_CARD`, `KO`, `POWER_MOD`).
2. Add condition and cost evaluators.
3. Add prompt/selection round-trips for optional/hidden choices.
4. Activate counter window status transitions.

## Long-term architecture upgrades

1. Add replacement/prevention interception layer.
2. Add full static/continuous modifier recompute pipeline.
3. Add robust timing windows and chain ordering policy.
4. Add script-level test harness for card timing edge cases.

---

# 14. Invariants

Current and target invariants to enforce:

- exactly one active player (`P1` or `P2`)
- exactly one priority holder (`P1` or `P2`)
- combat status/attack payload consistency:
  - `IDLE` => no attack
  - non-`IDLE` => attack exists
- no new attack declaration while combat unresolved
- defender-only action access in block window
- character area max 5
- card must exist in exactly one zone at a time
- DON accounting consistency (`donDeck + donActive + donRested` stable unless explicit moves)
- target legality should be revalidated at effect-step execution
- once-per-turn limits must be tracked by source/ability key

---

# 15. Summary for External Assistant

Today’s engine is a **single authoritative mutable-state engine** with request handlers in `GameEngineServer`, now partially refactored to include a real `combat` sub-state, first-class domain events, and effect/ability scaffolding. Core gameplay (setup, turns, play, attack, block, resolution, lethal) still executes procedurally in engine methods, while events are emitted and mirrored into logs/snapshots for UI.

Biggest architectural limits are not transport or rendering—they are runtime semantics: no full trigger/cost/selection/effect execution pipeline, no counter/replacement/prevention windows, no static modifier evaluator, and no engine prompt system for optional/hidden interactions.

Most sensible evolution path is incremental:
- keep current MVP loop intact,
- move to request->event->apply boundaries,
- build legal action generation + prompt/selection system,
- then expand effect-step execution and combat timing windows.

This codebase does **not** require a rewrite; it requires disciplined migration of procedural rule paths into the now-established event/combat/effect architecture.

