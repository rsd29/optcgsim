# OPTCG Engine Restructure Plan

This plan is tailored to the current codebase (`GameEngineServer`, request protocol, snapshot projection, React UI shell) and is intended as an implementation blueprint for scaling toward a full One Piece TCG effect engine.

---

## 1. Current Engine Structure Summary

- **Authoritative engine**: `src/engine/gameEngineServer.ts`
  - single mutable `GameState`
  - request switch (`START_MATCH`, `PLAY_CHARACTER`, `ATTACK_*`, `BLOCK_*`, `END_TURN`, auto modes)
  - direct procedural mutation per action
- **Transport**: local socket loop (`engineSocketServer` + `gameClient`)
- **Projection**: `toReadableSnapshot` in `src/game/snapshot.ts` maps full state to UI-friendly shape
- **UI logic**: `src/App.tsx` manages interaction intent (selection/targeting/pending attack) but engine validates legality
- **Logging/hooks**: event log exists; hooks were telemetry-only and not yet a true effect runtime

Recent scaffold introduced:
- `GameState.combat` formalized combat sub-state
- domain events stored in `state.domainEvents`
- effect queue + triggered ability collection stubs in `src/engine/core`

---

## 2. Why Current Structure Will Struggle With Full Effects

- **Request handlers still embed many game rules inline**, which grows exponentially with card complexity.
- **No true action->event->resolution boundary** for every rule path yet.
- **No full trigger windows pipeline** (counter, replacement, prevention, optional chains).
- **No generic legality revalidation** during delayed/chained effect resolution.
- **No private-information prompt layer** for searches/reveals/choice from hidden zones.
- **No robust modifier engine** for continuous/static and temporary effects with expiration.
- **No once-per-turn or source-scoped execution registry** at ability runtime depth.

---

## 3. Target Architecture Overview

Target runtime flow:

1. Receive `ClientRequest`
2. Validate against legal actions and current timing window
3. Translate into one or more **DomainEvents**
4. Apply events via centralized event application layer
5. Collect triggers from those events
6. Queue `EffectInstance`s
7. Resolve queue deterministically with legality checks and prompts
8. Emit updated state/snapshot

This is not full event sourcing; it is a pragmatic in-memory event-driven rules core.

---

## 4. Proposed Module Breakdown

Current and newly introduced engine core modules:

- `src/engine/core/combat.ts`
  - combat state helpers and transitions
- `src/engine/core/domainEvents.ts`
  - domain event creation/counters
- `src/engine/core/stateTransitions.ts`
  - centralized application of domain events to logs/state
- `src/engine/core/eventDispatcher.ts`
  - trigger collection entrypoint and effect queue injection
- `src/engine/core/abilities.ts`
  - card ability retrieval + trigger candidate collection
- `src/engine/core/effects.ts`
  - effect instance creation, queue operations, resolver stub
- `src/engine/core/invariants.ts`
  - runtime invariant enforcement points

Recommended near-term additions:
- `legalActions.ts` (engine-side legal move generation)
- `requestProcessor.ts` (map request -> command object -> domain events)
- `prompts.ts` (private selection and decision prompts)
- `modifiers.ts` (continuous/static/lasting modifier evaluation pipeline)

---

## 5. Proposed State Model Changes

Implemented in `src/game/types.ts`:

- `GameState.combat: CombatState`
  - statuses: `IDLE`, `ATTACK_DECLARED`, `BLOCK_WINDOW`, `COUNTER_WINDOW`, `DAMAGE_RESOLUTION`, `POST_BATTLE`, `COMPLETE`
- `GameState.domainEvents: DomainEvent[]`
- `GameState.effectsQueue: EffectInstance[]`
- `GameState.pendingSelection: PendingSelection | null`
- `GameState.lastingModifiers: LastingModifier[]`
- `PlayerState.oncePerTurnUsage`
- card-level keyword and ability scaffolding:
  - `CardKeyword`
  - `AbilityDefinition`, `TriggerDefinition`, `EffectStep`, etc.

Compatibility note:
- `ReadableSnapshot.currentAttack` remains for UI continuity, mapped from `state.combat.attack`.

---

## 6. Proposed Event System

### Domain Event Principles

- Domain events are now first-class objects (`id`, `type`, `payload`, `createdAt`).
- Engine log is now effectively a projection of domain events.
- Domain events are not only telemetry; they are consumed by trigger collection.

### Current Event Application

- `pushLog(...)` now creates and applies a domain event via `applyDomainEvent(...)`.
- `applyDomainEvent(...)`:
  - appends to `domainEvents`
  - appends to `log` (UI projection)
  - dispatches event for trigger collection/effect queueing

---

## 7. Proposed Combat State Machine

### Target statuses

- `IDLE`: no combat in progress
- `ATTACK_DECLARED`: attack created, pre-window hooks possible
- `BLOCK_WINDOW`: defender may block/pass
- `COUNTER_WINDOW`: reserved placeholder for battle counter/event timing
- `DAMAGE_RESOLUTION`: resolve battle/damage
- `POST_BATTLE`: post-resolution hooks/replacements
- `COMPLETE`: terminal combat state before reset

### Current implementation state

- Engine currently uses:
  - `BLOCK_WINDOW` on attack declaration
  - `DAMAGE_RESOLUTION` after block/pass
  - immediate transition to `COMPLETE` then reset to `IDLE` once resolved
- Counter window is scaffolded in type model but not active yet.

---

## 8. Proposed Ability/Effect Schema

Scaffolded schema now supports:

- timing classes: `STATIC | TRIGGERED | ACTIVATED | REPLACEMENT`
- trigger metadata
- conditions/costs/selections
- ordered `EffectStep[]`
- optional effects and usage limits
- expiration rules

Current runtime behavior:
- Trigger collection exists (`collectTriggeredAbilitiesForEvent`)
- Effect queue exists
- Effect execution is intentionally minimal (stub resolver with TODO)

This is intentional to avoid over-coding before legal action/prompt frameworks are in place.

---

## 9. Proposed Resolution Pipeline

Target:
- gather triggered abilities from emitted event
- construct `EffectInstance`s
- enqueue in deterministic order
- resolve each step:
  - validate source still legal
  - validate targets still legal
  - request selection if required
  - apply step
  - schedule lasting modifiers / expirations

Current:
- pipeline shape exists (`eventDispatcher -> effectsQueue -> resolveEffectQueue`)
- step execution is currently placeholder

---

# Known Missing Core Game Systems

1. **Generic event bus / domain event model**
   - domain events exist, but event-type taxonomy and payload contracts are still partially loose.
2. **Ability runtime**
   - no full runtime for costs, optional prompts, chained step resolution.
3. **Effect resolution queue / stack**
   - queue exists; no stack priority model for counter/reaction chains yet.
4. **Counter step**
   - combat status placeholder exists; no playable counter window implementation.
5. **Trigger from life**
   - life trigger/card trigger interactions not implemented.
6. **Event cards**
   - card type/events scaffolded but no event-card cast/resolve flow.
7. **Activated abilities**
   - schema supports it, engine path for `Activate: Main/Battle` not implemented.
8. **Static/continuous modifier system**
   - `LastingModifier` exists, but no evaluator that recomputes effective stats/flags.
9. **Temporary modifiers and expiration handling**
   - expiration schema exists; no expiration sweep or turn/battle expiry executor yet.
10. **Replacement/prevention framework**
   - no interception layer for “instead”, damage prevention, replacement effects.
11. **Search/reveal/private information handling**
   - no secure prompt channel or hidden-zone selection API.
12. **Once-per-turn tracking**
   - state field exists; usage accounting not integrated into ability runtime.
13. **Source-aware effect execution**
   - effect instances track source; legality and source-presence checks still TODO.
14. **Target legality revalidation during resolution**
   - not yet implemented across multi-step effects.
15. **Engine invariants / validation**
   - initial invariant checks added; broader validation suite still missing.
16. **Deterministic combat state machine**
   - combat states introduced; transitions still simplified and not fully windowed.
17. **Action generation / legal moves layer**
   - no canonical `getLegalActions(state, player)` yet.
18. **Test harness for card scripts and timing cases**
   - no dedicated script/timing tests for chained effect edge cases.

---

## 11. Migration Plan In Phases

### Phase 0 (done)
- Reconcile foundational type drift
- Add engine-core scaffolding modules
- Introduce combat state and domain event storage

### Phase 1 (in progress)
- Route all gameplay event emissions through domain event application
- Keep MVP flows working (play/attack/block/pass/end turn)

### Phase 2
- Introduce legal-actions layer and request processor boundary
- move App away from implicit rule hints toward server-provided legal intents

### Phase 3
- Implement counter window and prompt system
- add effect-step executor for core primitives (`DRAW`, `REST`, `KO`, `MOVE_CARD`, etc.)

### Phase 4
- Add modifier engine and expiration handling
- implement optional effects and “if you do” branch semantics

### Phase 5
- Add replacement/prevention interception framework
- flesh out event cards + life triggers + hidden info searches

---

## 12. Risks / Tradeoffs

- **Risk: partial migration complexity**
  - transitional code can contain dual concepts (legacy projections + new core).
- **Risk: event payload drift**
  - without strict event payload typing, runtime errors can hide.
- **Tradeoff: mutable state retained**
  - faster iteration now, but replay/debug tooling is weaker than immutable reducers.
- **Tradeoff: staged stubs**
  - architecture is now in place, but many systems intentionally non-final.

---

## 13. Suggested File/Folder Structure

Near-term target:

- `src/engine/gameEngineServer.ts` (thin orchestration)
- `src/engine/core/`
  - `combat.ts`
  - `domainEvents.ts`
  - `stateTransitions.ts`
  - `eventDispatcher.ts`
  - `abilities.ts`
  - `effects.ts`
  - `invariants.ts`
  - `legalActions.ts` (next)
  - `requestProcessor.ts` (next)
  - `prompts.ts` (next)
  - `modifiers.ts` (next)
- `src/game/`
  - `types.ts`
  - `protocol.ts`
  - `snapshot.ts`

---

## 14. Immediate Refactors: Now vs Later

### Do now
- keep compile-clean types in sync with runtime shape
- keep combat state authoritative in engine
- centralize all event append paths through domain-event application

### Do later
- full typed domain event payload map
- full effect-step executor and prompt handling
- legal action generation API
- replacement/prevention and counter stack implementation

---

## 15. Invariants the Engine Should Enforce

Current invariant checks should expand to:

- exactly one active and one priority player at any time
- non-idle combat must have an attack payload
- idle combat must not have attack payload
- cannot declare new attack while combat unresolved
- only defender can act during block window
- card-zone movement must preserve single ownership/location
- effect source and targets must be revalidated before each step
- once-per-turn limits must be enforced at runtime

These should become assertable in code and testable in deterministic unit tests.

