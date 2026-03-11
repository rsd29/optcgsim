# Effects Engine Refactor Report

## Changelog
- Added a new request boundary in `src/engine/core/requestProcessor.ts` and delegated `GameEngineServer.processRequest` to it.
- Added canonical legal action generation in `src/engine/core/legalActions.ts` and persisted current legal actions in `GameState.legalActions`.
- Tightened domain-event typing with `DomainEventPayloadMap` and typed `createDomainEvent(...)`.
- Expanded combat flow to explicit states: `ATTACK_DECLARED -> BLOCK_WINDOW -> COUNTER_WINDOW -> DAMAGE_RESOLUTION -> POST_BATTLE -> COMPLETE`.
- Added prompt foundation in `src/engine/core/prompts.ts` and new request type `RESOLVE_PROMPT`.
- Added primitive effect step execution in `src/engine/core/effects.ts` with deterministic queue processing.
- Added condition/cost scaffolding in `src/engine/core/rules.ts`.
- Added lasting modifier foundation in `src/engine/core/modifiers.ts` and integrated effective power/expiry into combat+turn transitions.
- Added architecture-focused tests in `tests/engine-migration.test.ts`.

## A) Current architecture after your changes

### Request flow
1. UI sends a `ClientRequest` (`src/game/protocol.ts`) through the local client/socket layer.
2. `GameEngineServer.processRequest(...)` delegates non-read requests to `processRequestWithValidation(...)`.
3. `requestProcessor` checks current legality using `generateLegalActionsForPlayer(...)`.
4. If legal, `requestProcessor` calls explicit execution handlers (still in `GameEngineServer` during this phase).
5. Engine mutates authoritative `GameState`, runs shared resolution, recomputes `state.legalActions`, enforces invariants, and emits state update.

### Legal action flow
- `generateLegalActions(...)` computes actions from engine state only:
  - phase, active player, priority
  - combat status/window
  - prompt ownership
  - attack/target/block options
- `state.legalActions` is persisted each request cycle and also projected to snapshot as action types via `legalActionsByPlayer`.

### Event flow
- `pushLog(...)` now funnels through `applyDomainEvent(state, createDomainEvent(...))`.
- `createDomainEvent` uses typed payloads from `DomainEventPayloadMap`.
- `stateTransitions.applyDomainEvent(...)` appends:
  - `state.domainEvents` (typed stream)
  - legacy `state.log` (human event log)
- `eventDispatcher` still acts as trigger/effect bridge scaffold.

### Combat flow
- Attack declaration now goes through:
  - `declareAttack(...)`
  - `openBlockWindow(...)`
- Pass-block transitions:
  - `closeBlockWindow(...)` (into `COUNTER_WINDOW`)
  - shared resolution auto-advances via `closeCounterWindowForResolution(...)` (MVP no-op counter window)
- Damage resolves, then combat transitions:
  - `completeCombat(...)` (`POST_BATTLE`)
  - `finalizeCombat(...)` (`COMPLETE`)
  - reset back to idle `createIdleCombatState()`.

### Prompt flow
- Engine-side prompt state lives in `GameState.pendingPrompt`.
- Prompts are opened with `openPrompt(...)` and resolved by `resolvePrompt(...)`.
- Protocol now supports `RESOLVE_PROMPT`.
- Request processor validates `RESOLVE_PROMPT` legality and prompt ownership.

### Effect execution flow
- Trigger candidates produce `EffectInstance` objects.
- `enqueueEffectInstances(...)` appends queue + emits `EFFECT_QUEUED`.
- `resolveEffectQueue(...)` resolves FIFO:
  - pays costs once at step 0
  - executes primitive steps
  - can pause on prompt steps (`PROMPT_SELECT_TARGETS`)
  - emits `EFFECT_RESOLVED` when done.

### Modifier/expiration flow
- `addLastingModifier(...)` records temporary changes in `state.lastingModifiers`.
- `getEffectivePower(...)` now drives battle power comparison.
- Expiration hooks:
  - `expireBattleModifiers(...)` after damage resolution
  - `expireTurnModifiers(...)` on end-turn.

## B) Before vs after

### Before
- `GameEngineServer.processRequest` contained direct procedural branching for every request.
- UI still had to infer many legal options.
- Domain events were loosely shaped strings/payloads.
- Combat had partial state but not explicit window-to-window transitions.
- Effect queue and prompt flow were mostly stubs.
- Temporary modifiers were present in type but not integrated in core calculations.

### After
- Request validation/dispatch is moved behind a dedicated processor boundary.
- Legal action generation is centralized and state-driven.
- Event payloads are typed and core transitions emit domain events more consistently.
- Combat is explicitly windowed and counter-window is structurally present.
- Prompt state is engine-owned and request-resolved.
- Primitive effect steps and modifier lifecycle are executable foundations.

## C) Files changed

### New files
- `src/engine/core/legalActions.ts` - canonical legal action generation.
- `src/engine/core/requestProcessor.ts` - request validation and action dispatch boundary.
- `src/engine/core/prompts.ts` - engine prompt open/resolve flow.
- `src/engine/core/modifiers.ts` - lasting modifiers, effective value helpers, expiration.
- `src/engine/core/rules.ts` - condition/cost evaluation and payment scaffolding.
- `tests/engine-migration.test.ts` - architecture and regression tests.
- `effects-engine-refactor-report.md` - this report.

### Modified files
- `src/engine/gameEngineServer.ts` - delegated request processing, legal-action recomputation, prompt handling, combat transition updates, modifier integration, typed event funnel updates.
- `src/engine/core/combat.ts` - expanded combat status transitions.
- `src/engine/core/effects.ts` - primitive effect-step executor + event emission + prompt pause support.
- `src/engine/core/domainEvents.ts` - generic typed event creator.
- `src/engine/core/invariants.ts` - expanded invariant checks.
- `src/game/types.ts` - prompt/legal-action types, typed domain event map, `GameState`/snapshot shape updates.
- `src/game/protocol.ts` - `RESOLVE_PROMPT` request.
- `src/game/snapshot.ts` - exposes legal action types + pending prompt.
- `src/client/gameClient.ts` - `resolvePrompt(...)` API method.
- `src/game/mockCardPool.ts` - supports abilities in mock cards and includes one effect-system demo card.
- `package.json` / `package-lock.json` - test tooling (`vitest`).

## D) Remaining gaps
- Triggered ability collection is still broad; advanced trigger filtering and source/target legality revalidation are incomplete.
- Activated ability runtime is scaffold-level (no full legal-action surface or prompt-backed activation sequence yet).
- Replacement/prevention layer is not implemented.
- Hidden-information-safe prompt projection is foundational, not complete (no per-player private prompt channels yet).
- Counter step exists as a state transition but does not execute counter-card rules yet.
- Event card rules and life-trigger runtime are not implemented yet.
- `pendingSelection` legacy field still exists alongside new `pendingPrompt`.

## E) Verification checklist

- [x] Existing playable MVP loop remains functional (start -> turns -> attacks -> block/pass -> battle/life/win checks).
- [x] Request processor boundary exists and is wired.
- [x] Legal action generation is engine-side and persisted in state.
- [x] Combat uses formal status transitions including `COUNTER_WINDOW`.
- [x] Prompt state is engine-owned and resolvable via request.
- [x] Effect queue resolves primitive reusable steps.
- [x] Temporary power modifiers affect combat and expire.
- [x] Typed domain-event payload map added.
- [x] Automated tests added for key migration behaviors.
- [ ] Full One Piece timing windows and response priority stack are complete.
- [ ] Event cards, life triggers, and replacement/prevention rules are complete.

## F) Example walkthrough

Scenario: active player declares leader attack, defender passes block.

1. UI sends `ATTACK_LEADER`.
2. `requestProcessor` validates legality from `generateLegalActionsForPlayer`.
3. `GameEngineServer.declareAttackLeader(...)`:
   - validates attacker
   - rests attacker
   - `declareAttack(...)` then `openBlockWindow(...)`
   - hands priority to defender
   - emits `ATTACK_DECLARED`, `ATTACKER_RESTED`, `BLOCK_WINDOW_OPENED`.
4. Defender sends `PASS_BLOCK`.
5. `requestProcessor` validates `PASS_BLOCK` is legal.
6. `GameEngineServer.passBlock(...)`:
   - transitions `BLOCK_WINDOW -> COUNTER_WINDOW`
   - returns into shared resolution
7. Shared resolution auto-advances counter window to damage resolution (MVP path), runs battle, emits result events (`LIFE_TAKEN` or `ATTACK_NO_DAMAGE`, etc), then clears combat to idle.
8. Engine recomputes legal actions and emits authoritative state update.
9. UI rerenders from snapshot (`currentAttack`, `combatStatus`, `legalActionsByPlayer`, board/life changes).

## G) Risks
- Some logic is still in `GameEngineServer` handlers; request processor currently validates/routs rather than fully replacing handler internals.
- Event typing is tighter, but not all legacy log semantics are migrated into pure domain events yet.
- Effect primitives are intentionally minimal and need richer legality rechecks for complex chains.
- Prompt payload validation is minimal and should be hardened before hidden-information-heavy features.
- Modifier model currently focuses on power/flags; broader stat and targeting effects still need structured expansion.
