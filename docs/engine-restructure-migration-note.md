# Engine Restructure Migration Note

## What Changed

- Added architecture blueprint: `docs/engine-restructure-plan.md`
- Added engine core scaffolding modules under `src/engine/core/`:
  - `combat.ts`
  - `domainEvents.ts`
  - `stateTransitions.ts`
  - `eventDispatcher.ts`
  - `abilities.ts`
  - `effects.ts`
  - `invariants.ts`
- Expanded `src/game/types.ts` to include:
  - combat state model
  - domain events
  - ability/effect schema scaffolding
  - lasting modifier and pending selection scaffolding
  - snapshot fields used by current UI (`p1Hand`, `p2Hand`, `p1Don`, `p2Don`, blocker flags)
- Refactored `src/engine/gameEngineServer.ts` to:
  - initialize/use `state.combat` instead of legacy attack holder
  - create/apply domain events through centralized transition layer
  - enforce runtime invariants after processed requests
- Updated `src/game/snapshot.ts` to map:
  - `currentAttack` from `state.combat.attack`
  - `combatStatus` in match projection

## What Is Still Stubbed / Transitional

- Effect queue resolver does not execute full step semantics yet.
- Trigger collection only supports basic structural matching.
- Counter window exists in combat state model but is not active gameplay yet.
- Replacement/prevention framework is not implemented.
- Legal actions generation API is not implemented.
- Domain event payload typing is still broad (not strict per-event schema yet).

## Systems Now Ready For Expansion

- Domain events are first-class and centrally applied.
- Combat has formal sub-state and transition helpers.
- Ability/effect schema exists for data-driven card definitions.
- Effect queue entrypoint exists for triggered ability insertion.
- Invariant enforcement entrypoint exists for hard rule validation.

