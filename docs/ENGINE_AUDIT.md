# OPTCG Engine Audit (Current Implementation)

This document describes the game engine and client flow exactly as it currently exists in code, including blocking/attacking/state lifecycle and current technical issues.

## 1) Current Architecture

- Core rules engine: `src/engine/gameEngineServer.ts`
- Network protocol contract: `src/game/protocol.ts`
- Canonical game/domain types: `src/game/types.ts`
- Snapshot projection for UI/debugging: `src/game/snapshot.ts`
- Client transport wrapper: `src/client/gameClient.ts`
- UI and local interaction/state machine: `src/App.tsx`

Engine model is **single in-memory mutable state object** (`GameState`) with command-style request processing (`processRequest` switch). There is no persistence or replay-from-events runtime.

## 2) Runtime Data Flow

1. UI calls `GameClientApi` method (ex: `attackLeader`).
2. Client sends `ClientRequest` over local socket with generated `requestId`.
3. `GameEngineServer.processRequest()` handles request and mutates server state.
4. Engine emits full cloned state via listeners.
5. Client receives `STATE_UPDATE`, stores a clone, emits `ReadableSnapshot` to UI.
6. UI re-renders from snapshot + local UI-only selection state.

Notes:
- Cloning strategy is JSON serialize/parse on both server and client.
- Server sends full state after each accepted action.

## 3) State Model (Engine Perspective)

Main state fields in active usage:

- Match/meta:
  - `status`: `LOBBY | SETUP | MULLIGAN | IN_PROGRESS | FINISHED`
  - `phase`: `SETUP | REFRESH | DRAW | DON | MAIN | END | FINISHED`
  - `turnNumber`
  - `firstPlayerId`, `activePlayerId`, `priorityPlayerId`
- Players (`P1`, `P2`):
  - zones: `deck`, `hand`, `life`, `trash`, `characterArea`, `leader`
  - don zones: `donDeck`, `donActive`, `donRested`
  - metadata: `turnsTaken`, `isGoingFirst`, etc.
- Combat:
  - `currentAttack` (nullable attack context)
  - currently used with fields: attacker id, attacker/defender players, target kind, optional defending character id, and block-phase tracking in engine logic
- Outcome:
  - `winnerId`, `loserId`
- Diagnostics:
  - append-only `log` capped at 200 events
  - `hooks` flags and hook log events

## 4) Request Surface (Protocol)

Accepted client actions:

- `START_MATCH`
- `PLAY_CHARACTER`
- `ATTACK_LEADER`
- `ATTACK_CHARACTER`
- `BLOCK_ATTACK`
- `PASS_BLOCK`
- `END_TURN`
- `AUTO_MAIN_STEP`
- `AUTO_PLAY`
- `GET_STATE`

Each action is synchronous and immediate in current runtime (no async stack/timing queue).

## 5) Match Setup + Turn Loop

### 5.1 `START_MATCH`

`processRequest("START_MATCH")` does:

1. Reset global counters for card/don IDs.
2. Create initial state with two players.
3. `setupMatch(...)`:
   - roll-off until tie breaks
   - assign first player / active / priority
   - shuffle each deck
   - draw opening hand (`HAND_SIZE = 5`)
   - pseudo-mulligan hooks/events (currently auto keep)
   - set life cards (`LIFE_SIZE = 5`)
   - optional test mode: move all DON to active
   - transition to `IN_PROGRESS`, `turnNumber = 1`, `phase = REFRESH`
4. `runTurnStartPhases(...)` executes refresh->draw->don->main.

### 5.2 `runTurnStartPhases`

For active player:

- Clears `currentAttack`
- Refreshes characters and leader (`rested = false`)
- Clears summoning sickness on existing field characters
- Moves all `donRested -> donActive`
- Draws 1 card
- Adds DON:
  - first turn of first player: +1
  - otherwise: +2
- Sets phase to `MAIN`

## 6) Action Guards

Primary gate for most active actions: `guardMainPhaseForActive(...)`

- state must be `IN_PROGRESS`
- phase must be `MAIN`
- requesting player must be `activePlayerId`
- requesting player must have `priorityPlayerId`

This means active-player actions are priority-gated even within main phase.

## 7) Attack/Block System (Current)

## 7.1 Attack Declaration

### Leader Attack (`declareAttackLeader`)

Checks:

- global main-phase guard
- prevents re-declare if `currentAttack` exists unresolved
- attacker exists and is not rested
- leader cannot attack on that player’s first turn (`turnsTaken === 0`)
- character attacker cannot be summoning sick

Effects:

- attacker becomes rested immediately
- `currentAttack` set with target `LEADER`
- block window opened
- priority passes to defending player
- logs: `ATTACK_DECLARED`, `ATTACKER_RESTED`, `BLOCK_WINDOW_OPENED`

### Character Attack (`declareAttackCharacter`)

Checks:

- same guard and unresolved-attack prevention
- target defender character must be rested

Effects:

- attacker rests
- `currentAttack` target set `CHARACTER` + defending character id
- block window opened
- priority passes to defender
- logs attack + block window events

## 7.2 Blocking Phase

### `BLOCK_ATTACK`

Checks:

- game in progress, phase `MAIN`
- unresolved `currentAttack` exists
- block window is open
- requester is defending player and has priority
- chosen blocker is in defending character area
- blocker is not rested
- blocker has blocker keyword (engine checks keyword array)

Effects:

- redirects attack target to `CHARACTER` and defender id = blocker
- closes block window
- returns priority to attacker
- logs `ATTACK_BLOCKED`, hook `onAttackBlocked`
- immediately runs shared resolution

### `PASS_BLOCK`

Checks similar to `BLOCK_ATTACK` but no blocker selection.

Effects:

- closes block window
- returns priority to attacker
- logs `BLOCK_PASSED`
- immediately runs shared resolution

## 7.3 Attack Resolution (`resolveAttackIfNeeded`)

Resolution only happens when:

- `currentAttack` exists
- not already resolved
- block phase is closed

Resolution behavior:

- Locate attacker from leader or character area by id.
- Compare attacker power against target:
  - Target `LEADER`:
    - if attacker power < leader power: `ATTACK_NO_DAMAGE`
    - else:
      - if defender has life: pop one life to hand; log + hook
      - if no life: set winner/loser, `status = FINISHED`, log `GAME_WON`
  - Target `CHARACTER`:
    - compare vs defender character power
    - if attacker >= defender: KO defender to trash
    - else log `ATTACK_NO_DAMAGE`
- mark attack resolved and clear `currentAttack`

## 7.4 Important Current Combat Constraints

- Only one unresolved attack can exist at a time.
- No additional attack declaration allowed until block/attack resolution completes.
- Blocking currently resolves directly into battle (no counter window yet).
- Blocker does not rest when blocking in current logic.

## 8) Play Character and DON Spending

`playCharacter(...)`:

- active/priority/main-phase guard
- optional replacement flow when board full (`CHARACTER_AREA_LIMIT = 5`)
- auto-select playable hand card if index not provided
- validates cost <= active DON count
- pays cost by moving `donActive -> donRested`
- if replacing: KO selected existing character
- move hand card to field, set `summoningSick = true`, `rested = false`
- logs field/hand events and hook
- runs shared resolution (for post-action lethal checks etc.)

## 9) End Turn

`endTurn(...)`:

- main-phase guard
- sets `phase = END`, logs/hook, increments `turnsTaken` for ending player
- swaps active/priority to opponent
- increments `turnNumber`
- calls `runTurnStartPhases` for new active player

## 10) Auto Modes

- `AUTO_MAIN_STEP`: naive bot-like step:
  1. play first affordable character if space
  2. else first attack-ready character attacks leader
  3. else leader attacks leader if legal
  4. else end turn
- `AUTO_PLAY`: loops `AUTO_MAIN_STEP` up to `maxSteps` or until finished.

## 11) UI Mechanics Coupling (Current)

UI in `App.tsx` contains local targeting workflow:

- local `selected`, `pendingAttack`, `selectedAttackTarget`, `pendingReplace`
- per-player action panels derived from global state + local selection
- buttons are now conditionally rendered (not disabled placeholders)
- two hands rendered (`P2` above board, `P1` below board)
- two action panels rendered (`P2` top, `P1` bottom)

UI logic enforces usability constraints, but engine is still final authority.

## 12) Logging and Hooks

Engine uses `pushLog(...)` for gameplay/audit events and `hook(...)` to emit `HOOK_*` events.

There is no effect stack executing hook logic yet; hooks are telemetry points (event traces), not executable card-effect handlers.

## 13) Known Structural Weak Spots / Audit Flags

These are immediate findings relevant to efficiency and correctness audit:

1. Type contract drift
   - Current runtime code expects fields like blocker keywords, block-phase attack flag, per-player hand/DON snapshot structures.
   - `src/game/types.ts` currently does not define these fields, causing compile-time breakages.
2. Full-state cloning on every hop
   - JSON deep clone on server `getState/emitState` and client ingestion.
   - Easy but expensive; loses richer types and can be hot under frequent updates.
3. Mutable monolith state
   - One mutable object with many in-place edits; hard to replay/rollback/time-travel.
4. Hard-coded procedural rules
   - Attacking/blocking/play are explicit code paths, not yet data-driven effect graph.
5. No deterministic effect queue/stack
   - Blocking exists, but no generic timing windows/stack for counters and replacement effects.
6. `AUTO_MAIN_STEP` is simplistic and coupled to current attack model
   - Can stall strategic behavior and does not reason about blocking/counter future windows.

## 14) Current Build Status (At Time of Audit)

`npm run build` currently fails with TypeScript errors due type drift between:

- `src/game/types.ts`
- `src/engine/gameEngineServer.ts`
- `src/game/snapshot.ts`
- `src/App.tsx`

Main mismatch areas:

- missing `keywords` on cards in type definitions
- missing `blockPhaseOpen` in `AttackState`
- missing snapshot fields used by UI (`p1Hand`, `p2Hand`, `p1Don`, `p2Don`, blocker flags)

This should be corrected first before further rule expansion.

## 15) Summary of "How the Game Works Right Now"

- Match starts, decks are randomized from mock pool, opening hand/life set.
- Turn loop auto-runs refresh/draw/don into main.
- Active player spends DON to play characters.
- Attack declaration rests attacker and opens block window for defender.
- Defender can block (with active blocker) or pass.
- Attack resolves immediately after block/pass:
  - leader damage converts life to hand until lethal
  - character battle KOs by power comparison
- Turn ends and opponent turn starts with full refresh.
- No counter phase yet; block is first and only defense window implemented.

