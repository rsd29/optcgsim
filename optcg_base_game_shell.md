# OPTCG Base Game Shell Specification (MVP v0)

## Purpose
This document defines the **base playable shell** for a web-based multiplayer One Piece TCG prototype.

This version intentionally excludes most of the real game's complexity.

It is designed to support:
- two players
- simulated roll to determine first player
- starter decks with only vanilla leaders and vanilla character cards
- randomized deck order
- placeholder mulligan hook
- placeholder start-of-game effect hook
- turn order and turn loop
- DON gain
- card draw
- playing character cards
- attacking life only
- life pickup on hit
- lethal resolution
- win/lose result

This is the **dumb playable version** of the game. The goal is to make the full turn shell work before layering in effects, counters, blockers, triggers, and advanced timing.

---

# 1. Scope of MVP v0

## Included
- Match initialization
- Two-player game state
- Random roll to determine first player
- Deck shuffle
- Opening hand draw
- Placeholder mulligan step
- Life setup
- Leader setup
- Turn loop
- Refresh / Draw / DON / Main / End turn skeleton
- Play character from hand
- Attack leader only
- Damage takes life
- If player has 0 life and is hit again, they lose
- Win / lose state

## Excluded
- Counters
- Blockers
- Events
- Stages as actual playable cards
- Card effects
- On Play effects
- Triggers
- DON attachment bonuses beyond basic representation if not needed yet
- Character-vs-character battle
- Search / reveal / choose prompts
- On KO / On Attack / On Trash hooks resolving real effects
- Rule-exact advanced timing

---

# 2. Core Design Principles

## Server authoritative
- The server owns the true game state.
- Clients do not mutate game state directly.
- Clients send action intents.
- Server validates and applies state transitions.
- Server broadcasts updated player views.

## Build the shell first
- The first version must already be playable.
- Rules can be simplified as long as they are internally consistent.
- Hooks should exist even if they do nothing yet.

## Keep the action vocabulary small
Supported player actions for MVP v0:
- `PLAY_CHARACTER`
- `DECLARE_ATTACK_LEADER`
- `END_TURN`

Optional early utility/testing actions:
- `START_MATCH`
- `KEEP_HAND`
- `MULLIGAN_HAND`

---

# 3. Base Data Model

## GameState

```ts
export type GameState = {
  id: string
  status: "LOBBY" | "SETUP" | "MULLIGAN" | "IN_PROGRESS" | "FINISHED"
  turnNumber: number
  activePlayerId: string
  priorityPlayerId: string
  firstPlayerId: string
  phase: "SETUP" | "REFRESH" | "DRAW" | "DON" | "MAIN" | "END" | "FINISHED"
  players: Record<string, PlayerState>
  currentAttack: AttackState | null
  winnerId: string | null
  loserId: string | null
  log: GameEvent[]
  hooks: HookState
}
```

## PlayerState

```ts
export type PlayerState = {
  id: string
  name: string
  roll: number | null
  deck: CardInstance[]
  hand: CardInstance[]
  life: CardInstance[]
  trash: CardInstance[]
  leader: CardInstance
  characterArea: CardInstance[]
  stageArea: CardInstance | null
  donDeck: DonCard[]
  donActive: DonCard[]
  donRested: DonCard[]
  attachedDon: Record<string, number>
  hasMulliganed: boolean
  isGoingFirst: boolean
}
```

## CardInstance

```ts
export type CardInstance = {
  instanceId: string
  cardId: string
  name: string
  type: "LEADER" | "CHARACTER"
  cost?: number
  power?: number
  ownerId: string
  controllerId: string
  rested: boolean
  summoningSick?: boolean
  faceup: boolean
}
```

## DonCard

```ts
export type DonCard = {
  id: string
}
```

## AttackState

```ts
export type AttackState = {
  attackerId: string
  attackingPlayerId: string
  defendingPlayerId: string
  target: "LEADER"
  resolved: boolean
}
```

## HookState

```ts
export type HookState = {
  canMulligan: boolean
  pendingStartOfGameEffects: boolean
  pendingResolution: boolean
}
```

## GameEvent

```ts
export type GameEvent = {
  type: string
  payload?: Record<string, unknown>
  createdAt: number
}
```

---

# 4. Starter Deck Assumptions

For MVP v0, each player uses a prebuilt starter list with:
- 1 vanilla leader
- 50 vanilla character cards
- 10 DON cards in DON deck

Simplifications:
- no card effects
- no events
- no stages in active use
- all non-leader cards are characters
- each character has only:
  - name
  - cost
  - power

Example simplified card definition:

```ts
export type CardDefinition = {
  cardId: string
  name: string
  type: "LEADER" | "CHARACTER"
  cost?: number
  power?: number
}
```

---

# 5. Match Setup Flow

## 5.1 Create Match
1. Create empty `GameState`
2. Register Player A and Player B
3. Load starter deck definitions for each player
4. Convert deck definitions into `CardInstance[]`
5. Create 10 DON cards for each player
6. Set status to `SETUP`

## 5.2 Simulated Roll
1. Generate random roll for Player A
2. Generate random roll for Player B
3. If tie, reroll until different
4. Higher roll becomes first player
5. Set:
   - `firstPlayerId`
   - `activePlayerId`
   - `priorityPlayerId`
   - `player.isGoingFirst`

## 5.3 Shuffle Decks
1. Shuffle both players' decks
2. Emit log event: `DECK_SHUFFLED`

## 5.4 Draw Opening Hands
1. Draw 5 cards for Player A
2. Draw 5 cards for Player B
3. Move state to `MULLIGAN`
4. Set hook: `canMulligan = true`

## 5.5 Mulligan Hook (placeholder)
For v0:
- this may be a simple keep-only flow, or
- support both keep and mulligan if desired

Suggested shell:
1. Prompt both players: `KEEP_HAND` or `MULLIGAN_HAND`
2. If mulligan:
   - return hand to deck
   - shuffle
   - draw 5 new cards
   - set `hasMulliganed = true`
3. When both players are locked, continue

## 5.6 Start-of-Game Hook (placeholder)
This hook exists for future stages/leaders/effects.

For v0:
- no effects resolve
- simply mark hook as cleared

## 5.7 Set Life
After mulligans are locked:
1. Take top 5 cards from each player's deck
2. Place them face down into `life`
3. Leaders are already set separately
4. Set status to `IN_PROGRESS`
5. Set phase to `REFRESH`
6. Start turn 1

---

# 6. Turn Structure (MVP v0)

Each turn follows:
1. Refresh Phase
2. Draw Phase
3. DON Phase
4. Main Phase
5. End Phase

## 6.1 Turn Start
At turn start:
- `activePlayerId` is already set
- `priorityPlayerId = activePlayerId`
- `currentAttack = null`

---

# 7. Phase Rules

## 7.1 Refresh Phase
Purpose:
- reset active player's board to ready state

Steps:
1. Set all active player's characters `rested = false`
2. Move all attached/rested DON back to active pool only if that matches your simplified MVP representation
3. Clear expired turn-only flags if any
4. Emit `TURN_REFRESHED`
5. Advance to `DRAW`

## 7.2 Draw Phase
Purpose:
- active player draws 1 card

Simplified MVP rule requested:
- deal random card each turn

Implementation:
1. Draw 1 card from top of deck
2. Add to hand
3. Emit `CARD_DRAWN`
4. Advance to `DON`

Note:
If you later want exact One Piece rules, first player skips the very first draw. That can be added later.

## 7.3 DON Phase
Purpose:
- add DON for turn pacing

Requested simplification:
- going first gets 1 DON initially
- others get correct DON progression by simplified rule

Recommended MVP rule:
- On turn 1 for first player: add 1 DON active
- On all other turns: add 2 DON active, up to available DON remaining in DON deck

Steps:
1. Determine DON amount to add
2. Move DON from `donDeck` to `donActive`
3. Emit `DON_ADDED`
4. Advance to `MAIN`

## 7.4 Main Phase
Purpose:
- active player may perform actions until they end turn

Allowed actions in MVP v0:
- `PLAY_CHARACTER`
- `DECLARE_ATTACK_LEADER`
- `END_TURN`

Main phase loop:
1. Wait for active player action
2. Validate action legality
3. Apply action
4. Run end-of-action resolution check
5. If game not over, return to Main unless action ended turn

## 7.5 End Phase
Purpose:
- cleanly pass turn

Steps:
1. Emit `TURN_ENDED`
2. Switch `activePlayerId` to opponent
3. Set `priorityPlayerId = activePlayerId`
4. Increment turn number when appropriate
5. Set phase to `REFRESH`

---

# 8. Player Action Pipelines

## 8.1 Action: PLAY_CHARACTER

### Preconditions
- Current phase is `MAIN`
- Acting player is `activePlayerId`
- Acting player has priority
- Card exists in acting player's hand
- Card type is `CHARACTER`
- Player has enough active DON to pay cost
- Character area is not full

### Immediate Action Result
1. Rest required number of DON from `donActive` into `donRested`
2. Remove card from hand
3. Place card into `characterArea`
4. Set character state:
   - `rested = false`
   - `summoningSick = true`

### Generated Events
- `CHARACTER_PLAYED`
- `CARD_LEFT_HAND`
- `CARD_ENTERED_FIELD`

### Follow-up Resolution
For MVP v0:
- no On Play effects
- no reaction effects
- no queue processing
- return to Main Phase

---

## 8.2 Action: DECLARE_ATTACK_LEADER

### Preconditions
- Current phase is `MAIN`
- Acting player is `activePlayerId`
- Attacking card is on acting player's field
- Attacking card is either:
  - leader, or
  - character
- Attacker is not rested
- Attacker is allowed to attack under MVP rules
- For characters, `summoningSick` must be false unless later rules say otherwise
- Target is opponent leader only

### Immediate Action Result
1. Set attacker `rested = true`
2. Create `currentAttack`
3. Emit `ATTACK_DECLARED`

### Generated Events
- `ATTACK_DECLARED`
- `ATTACKER_RESTED`

### Follow-up Resolution
For MVP v0 there are:
- no blockers
- no counters
- no triggers

Proceed directly to battle resolution.

---

## 8.3 Action: END_TURN

### Preconditions
- Current phase is `MAIN`
- Acting player is `activePlayerId`
- Acting player has priority
- No unresolved required prompt or attack resolution is pending

### Immediate Action Result
1. Emit `END_TURN_REQUESTED`
2. Advance to End Phase

### Follow-up Resolution
1. Switch active player
2. Start next turn at Refresh Phase

---

# 9. Battle Resolution (Leader Only MVP)

This MVP only supports attacking the opponent leader/life.

## 9.1 Resolve Attack
Given `currentAttack`:
1. Determine attacking player
2. Determine defending player
3. Read attacker power
4. Because there are no counters/blockers, attack automatically proceeds to hit

## 9.2 Apply Damage
If defending player has life cards remaining:
1. Remove top life card from defending player's `life`
2. Add that card to defending player's hand
3. Emit `LIFE_TAKEN`
4. Emit `CARD_ADDED_TO_HAND_FROM_LIFE`

If defending player has 0 life before damage:
1. Attack is lethal
2. Defending player loses
3. Set game status to `FINISHED`
4. Set winner/loser IDs
5. Emit `GAME_WON`

## 9.3 Post-Attack Resolution
1. Mark `currentAttack.resolved = true`
2. Clear `currentAttack`
3. Run lethal check
4. If game not finished, return to Main Phase

---

# 10. End-of-Action Resolution Phase

After every successful player action, run a tiny shared resolution pass.

For MVP v0 this should do only the following:
1. Check if game is finished
2. Check if active attack must resolve
3. Check if life has reached 0 and next unresolved hit would be lethal later
4. Clear any completed temporary state
5. Return control to current phase/window

This is a placeholder for future expansion into:
- effect queues
- trigger windows
- prompted choices
- response windows

---

# 11. Win / Lose Resolution

## Lose condition
A player loses when:
- they would take damage while their life area is already empty

## Win condition
A player wins when:
- opponent loses by lethal leader hit

## UI result
At game end show:
- `You Win`
- `You Lose`
- optional reason: `Opponent took lethal damage with no life remaining`

---

# 12. Required Hooks to Leave Empty Now

These hooks should exist in the shell even if they do nothing yet.

## Start-of-game hooks
- `onBeforeMulligan`
- `onAfterMulligan`
- `onStartOfGameEffects`

## Turn hooks
- `onTurnStart`
- `onRefreshPhaseStart`
- `onDrawPhaseStart`
- `onDonPhaseStart`
- `onMainPhaseStart`
- `onTurnEnd`

## Card/action hooks
- `onCharacterPlayed`
- `onAttackDeclared`
- `onLifeTaken`
- `onDamageResolved`

## Resolution hooks
- `beforeActionResolve`
- `afterActionResolve`
- `beforeLethalCheck`
- `afterLethalCheck`

For MVP v0, these can simply emit events into the log and return.

---

# 13. Suggested Server Processing Pattern

## Core action processor

```ts
function processAction(state: GameState, action: PlayerAction): GameState {
  validateAction(state, action)
  const nextState = applyAction(state, action)
  const resolvedState = runSharedResolution(nextState)
  return resolvedState
}
```

## Shared resolution pass

```ts
function runSharedResolution(state: GameState): GameState {
  state = resolveAttackIfNeeded(state)
  state = checkWinLoss(state)
  return state
}
```

---

# 14. Suggested Build Order

## Step 1
Render static board:
- leader
- hand
- life
- field
- DON
- turn label

## Step 2
Implement setup:
- load decks
- roll order
- shuffle
- draw hand
- mulligan placeholder
- set life

## Step 3
Implement turn loop:
- refresh
- draw
- don
- main
- end turn

## Step 4
Implement `PLAY_CHARACTER`

## Step 5
Implement `DECLARE_ATTACK_LEADER`

## Step 6
Implement life pickup and lethal

## Step 7
Show end screen: win / lose

Only after this should you add:
- On Play effects
- Blockers
- Counters
- Character attacks
- Character KO battle rules
- Trigger windows
- Search/choice prompts

---

# 15. MVP v0 Success Criteria

The shell is successful when:
- two players can start a match
- first player is determined by random roll
- decks shuffle and hands are dealt
- life is set
- turns alternate properly
- DON is added each turn
- players can play characters if they can afford them
- players can attack opponent life
- life cards move to hand on hit
- lethal ends the game
- the UI displays win/lose state

At that point, you have a working dumb version of the game and a solid shell to grow into the full engine.

