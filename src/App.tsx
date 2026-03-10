import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { createLocalGameClient } from "./client/createLocalGameClient";
import type { PlayerId, ReadableSnapshot } from "./game/types";

const formatSnapshot = (snapshot: ReadableSnapshot | null): string =>
  snapshot ? JSON.stringify(snapshot, null, 2) : "No match running. Click Start Match.";

type RecentEvent = ReadableSnapshot["recentEvents"][number];

type SelectedEntity =
  | { kind: "HAND"; playerId: PlayerId; handIndex: number; cardName: string }
  | { kind: "LEADER"; playerId: PlayerId; cardName: string }
  | { kind: "CHARACTER"; playerId: PlayerId; slot: number; cardId: string; cardName: string; rested: boolean; summoningSick: boolean };

type PendingAttack = {
  attackerPlayerId: PlayerId;
  attackerRef: "leader" | number;
  attackerType: "LEADER" | "CHARACTER";
  attackerName: string;
};

type PendingReplace = { playerId: PlayerId; handIndex: number; cardName: string };

type AttackTarget =
  | { type: "LEADER"; playerId: PlayerId; label: string }
  | { type: "CHARACTER"; playerId: PlayerId; slot: number; label: string };

const parsePayload = (payload: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(payload) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const humanEvent = (event: RecentEvent): ReactNode => {
  const payload = parsePayload(event.payload);
  const player = String(payload.playerId ?? payload.attackingPlayerId ?? "");
  const defender = String(payload.defendingPlayerId ?? "");
  const card = String(payload.card ?? payload.cardName ?? payload.targetCharacter ?? "");

  switch (event.type) {
    case "TURN_ENDED":
      return (
        <>
          <strong>{player}</strong> ended their turn.
        </>
      );
    case "DON_ADDED":
      return (
        <>
          <strong>{player}</strong> gained <strong>{String(payload.amount ?? "?")}</strong> DON.
        </>
      );
    case "CARD_DRAWN":
      return (
        <>
          <strong>{player}</strong> drew <strong>{String(payload.card ?? "a card")}</strong>.
        </>
      );
    case "CHARACTER_PLAYED":
      return (
        <>
          <strong>{player}</strong> played <strong>{card}</strong> (cost <strong>{String(payload.cost ?? "?")}</strong>).
        </>
      );
    case "ATTACK_DECLARED":
      return (
        <>
          <strong>{player}</strong> declared an attack with <strong>{String(payload.attacker ?? "attacker")}</strong>
          {defender ? (
            <>
              {" "}
              against <strong>{defender}</strong>
            </>
          ) : null}
          .
        </>
      );
    case "LIFE_TAKEN":
      return (
        <>
          <strong>{String(payload.defendingPlayerId ?? "")}</strong> lost a life card (remaining:{" "}
          <strong>{String(payload.remainingLife ?? "?")}</strong>).
        </>
      );
    case "CHARACTER_KO":
      return (
        <>
          <strong>{String(payload.cardName ?? "Character")}</strong> was KO'd and moved to <strong>Trash</strong>.
        </>
      );
    case "CHARACTER_REPLACED":
      return (
        <>
          <strong>{String(payload.playerId ?? "")}</strong> replaced <strong>{String(payload.replacedCardName ?? "a character")}</strong>{" "}
          with <strong>{String(payload.incomingCardName ?? "a new character")}</strong>. Replaced card moved to <strong>Trash</strong>.
        </>
      );
    case "ATTACK_NO_DAMAGE":
      return (
        <>
          Attack resolved but <strong>no damage</strong> was dealt (power check failed).
        </>
      );
    case "GAME_WON":
      return (
        <>
          <strong>{String(payload.winnerId ?? "Winner")}</strong> wins the game. <strong>{String(payload.reason ?? "")}</strong>
        </>
      );
    case "TEST_START_WITH_TEN_DON":
      return (
        <>
          Test mode enabled: both players start with <strong>10 active DON</strong>.
        </>
      );
    default:
      return (
        <>
          <strong>{event.type}</strong> happened.
        </>
      );
  }
};

function App() {
  const [snapshot, setSnapshot] = useState<ReadableSnapshot | null>(null);
  const [error, setError] = useState<string>("");
  const [testStartWithTenDon, setTestStartWithTenDon] = useState<boolean>(true);
  const [selected, setSelected] = useState<SelectedEntity | null>(null);
  const [pendingAttack, setPendingAttack] = useState<PendingAttack | null>(null);
  const [pendingReplace, setPendingReplace] = useState<PendingReplace | null>(null);
  const [selectedAttackTarget, setSelectedAttackTarget] = useState<AttackTarget | null>(null);
  const [replaceTargetSlot, setReplaceTargetSlot] = useState<number | null>(null);

  const client = useMemo(() => createLocalGameClient(), []);

  useEffect(() => {
    window.OPTCG = client;
    client.help();
    client.connect();
    const unSubSnapshot = client.onSnapshot((nextSnapshot) => setSnapshot(nextSnapshot));
    const unSubError = client.onError((message) => setError(message));
    return () => {
      unSubSnapshot();
      unSubError();
      client.disconnect();
    };
  }, [client]);

  const activePlayerId: PlayerId = snapshot?.match.activePlayerId ?? "P1";
  const inMainPhase = Boolean(snapshot && snapshot.match.status === "IN_PROGRESS" && snapshot.match.phase === "MAIN");

  const run = (action: () => void) => {
    try {
      action();
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  const getPlayer = (playerId: PlayerId) => snapshot?.players.find((p) => p.playerId === playerId) ?? null;
  const boardFor = (playerId: PlayerId) => (playerId === "P1" ? snapshot?.p1Characters ?? [] : snapshot?.p2Characters ?? []);
  const isPlayersTurn = (playerId: PlayerId) => Boolean(snapshot && snapshot.match.status === "IN_PROGRESS" && snapshot.match.activePlayerId === playerId);
  const opposingPlayerId = (playerId: PlayerId): PlayerId => (playerId === "P1" ? "P2" : "P1");

  useEffect(() => {
    if (!snapshot) return;
    if (snapshot.match.phase !== "MAIN") {
      setPendingAttack(null);
      setSelectedAttackTarget(null);
      setPendingReplace(null);
      setReplaceTargetSlot(null);
    }
  }, [snapshot]);

  const canSelectAsAttackTarget = (playerId: PlayerId, rested?: boolean): boolean => {
    if (!pendingAttack) return false;
    if (pendingAttack.attackerPlayerId === playerId) return false;
    return rested === undefined ? true : rested;
  };

  const handleCardClick = (entity: SelectedEntity): void => {
    if (!snapshot) return;
    if (pendingAttack) {
      if (entity.kind === "LEADER" && canSelectAsAttackTarget(entity.playerId)) {
        setSelectedAttackTarget({ type: "LEADER", playerId: entity.playerId, label: `${entity.cardName}` });
        return;
      }
      if (entity.kind === "CHARACTER" && canSelectAsAttackTarget(entity.playerId, entity.rested)) {
        setSelectedAttackTarget({
          type: "CHARACTER",
          playerId: entity.playerId,
          slot: entity.slot,
          label: `${entity.cardName} (#${entity.slot + 1})`
        });
        return;
      }
    }

    if (pendingReplace && entity.kind === "CHARACTER" && entity.playerId === pendingReplace.playerId) {
      setReplaceTargetSlot(entity.slot);
      return;
    }

    setSelected(entity);
  };

  const resetActionState = (): void => {
    setPendingAttack(null);
    setPendingReplace(null);
    setSelectedAttackTarget(null);
    setReplaceTargetSlot(null);
  };

  const canStartAttack = (() => {
    if (!snapshot || !selected || !inMainPhase) return false;
    if (pendingAttack) return false;
    if (selected.playerId !== activePlayerId) return false;
    if (selected.kind === "LEADER") {
      const player = getPlayer(selected.playerId);
      return Boolean(player && player.turnsTaken > 0 && !player.leaderRested);
    }
    if (selected.kind === "CHARACTER") {
      return !selected.rested && !selected.summoningSick;
    }
    return false;
  })();

  const canPlaySelectedHand = (() => {
    if (!snapshot || !selected || selected.kind !== "HAND") return false;
    return inMainPhase && selected.playerId === activePlayerId;
  })();

  const canEndTurn = Boolean(snapshot && inMainPhase);
  const canConfirmAttack = Boolean(pendingAttack && selectedAttackTarget);
  const canConfirmReplace = Boolean(pendingReplace && replaceTargetSlot !== null);
  const selectedIsOwnCard =
    selected !== null && selected.kind !== "HAND" ? selected.playerId === activePlayerId : selected?.playerId === activePlayerId;

  const renderCharacterRow = (playerId: PlayerId): ReactNode => {
    const board = boardFor(playerId);
    return (
      <div className="character-row">
        {Array.from({ length: 5 }, (_, slot) => {
          const card = board.find((c) => c.slot === slot);
          if (!card) {
            return (
              <div key={`${playerId}-empty-${slot}`} className="card-shell card-empty">
                <div className="empty-slot-label">Slot {slot + 1}</div>
              </div>
            );
          }

          const isSelected =
            selected?.kind === "CHARACTER" && selected.playerId === playerId && selected.cardId === card.id;
          const isTargeted =
            selectedAttackTarget?.type === "CHARACTER" &&
            selectedAttackTarget.playerId === playerId &&
            selectedAttackTarget.slot === slot;
          const isTargetable = canSelectAsAttackTarget(playerId, card.rested);

          return (
            <button
              key={card.id}
              className={`card-shell card-face field-card ${card.rested ? "card-rested" : ""} ${isSelected ? "card-selected" : ""} ${
                isTargeted ? "card-targeted" : ""
              } ${isTargetable ? "card-targetable" : ""}`}
              onClick={() =>
                handleCardClick({
                  kind: "CHARACTER",
                  playerId,
                  slot,
                  cardId: card.id,
                  cardName: card.name,
                  rested: card.rested,
                  summoningSick: card.summoningSick
                })
              }
            >
              <div className="card-art-placeholder">ART</div>
              <div className="card-title">{card.name}</div>
              <div className="card-stats">Cost {card.cost ?? 0}</div>
              <div className="card-stats">Power {card.power ?? "?"}</div>
            </button>
          );
        })}
      </div>
    );
  };

  const renderField = (playerId: PlayerId, isOpponent: boolean): ReactNode => {
    const p = getPlayer(playerId);
    if (!p) return null;
    const isActive = snapshot?.match.activePlayerId === playerId;
    const leaderSelected = selected?.kind === "LEADER" && selected.playerId === playerId;
    const leaderTargeted = selectedAttackTarget?.type === "LEADER" && selectedAttackTarget.playerId === playerId;
    const leaderTargetable = canSelectAsAttackTarget(playerId);

    return (
      <section className={`field-zone ${isActive ? "field-zone-active" : ""} ${isOpponent ? "field-opponent" : "field-player"}`}>
        <div className="field-row field-row-top">{renderCharacterRow(playerId)}</div>

        <div className="field-row field-row-middle">
          <div className="pile-stack">
            <div className="card-shell card-back pile-card">
              <div className="pile-inside">
                <div className="pile-title">Life</div>
                <div className="pile-count-number">{p.life}</div>
              </div>
            </div>
          </div>
          <div className="center-lane-pair">
            {isOpponent ? <div className="card-shell stage-zone">Stage (future)</div> : null}
            <button
              className={`card-shell card-face leader-card ${leaderSelected ? "card-selected" : ""} ${
                leaderTargeted ? "card-targeted" : ""
              } ${leaderTargetable ? "card-targetable" : ""}`}
              onClick={() => handleCardClick({ kind: "LEADER", playerId, cardName: `${p.name} Leader` })}
            >
              <div className="card-art-placeholder">LEADER ART</div>
              <div className="card-title">{p.name} Leader</div>
              <div className="card-stats">Power {p.leaderPower}</div>
            </button>
            {!isOpponent ? <div className="card-shell stage-zone">Stage (future)</div> : null}
          </div>
          <div className="pile-stack">
            <div className="card-shell card-back pile-card">
              <div className="pile-inside">
                <div className="pile-title">Deck</div>
                <div className="pile-count-number">{p.deck}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="field-row field-row-bottom">
          <div className="pile-stack">
            <div className="card-shell card-back pile-card">
              <div className="pile-inside">
                <div className="pile-title">DON Deck</div>
                <div className="pile-count-number">{p.donDeck}</div>
              </div>
            </div>
          </div>
          <div className="don-area">
            {Array.from({ length: p.donActive }, (_, idx) => (
              <div key={`${playerId}-don-active-${idx}`} className="card-shell card-back don-card">
                <div className="don-mark">DON</div>
              </div>
            ))}
            {Array.from({ length: p.donRested }, (_, idx) => (
              <div key={`${playerId}-don-rested-${idx}`} className="card-shell card-back don-card card-rested">
                <div className="don-mark">DON</div>
              </div>
            ))}
          </div>
          <div className="pile-stack">
            <div className="card-shell card-back pile-card trash-card">
              <div className="pile-inside">
                <div className="pile-title">Trash</div>
                <div className="pile-count-number">{p.trash}</div>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  };

  const activeHandOwner = activePlayerId;

  return (
    <main className="page page-layout">
      <aside className="event-log-panel" aria-label="Human readable action log">
        <h2>What Just Happened</h2>
        {!snapshot ? (
          <p>No actions yet.</p>
        ) : (
          <div className="event-list">
            {[...snapshot.recentEvents].reverse().map((event, idx) => (
              <div key={`${event.time}-${event.type}-${idx}`} className="event-item">
                <span className="event-time">{event.time}</span>
                <span className="event-text">{humanEvent(event)}</span>
              </div>
            ))}
          </div>
        )}
      </aside>

      <section className="main-content">
        <h1>OPTCG Shell Console (React + TypeScript)</h1>
        <div className="controls">
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={testStartWithTenDon}
              onChange={(e) => setTestStartWithTenDon(e.target.checked)}
            />
            <span>Testing: start both players with 10 DON</span>
          </label>
          <button onClick={() => run(() => client.startMatch("Luffy", "Kaido", { testStartWithTenDon }))}>Start Match</button>
          <button onClick={() => run(() => client.print())}>Print To Console</button>
        </div>

        {error ? <p className="error">Error: {error}</p> : null}

        {!snapshot ? (
          <section className="text-mode-window">
            <p>No match running yet.</p>
          </section>
        ) : (
          <>
            <section className="board-table">
              {renderField("P2", true)}
              {renderField("P1", false)}
            </section>

            <section className="hand-ui">
              <h3>{getPlayer(activeHandOwner)?.name ?? activeHandOwner} Hand</h3>
              {snapshot.activeHand.length === 0 ? (
                <p>No cards in hand.</p>
              ) : (
                  <div className="hand-strip">
                  {snapshot.activeHand.map((card) => {
                    const isSelected =
                      selected?.kind === "HAND" &&
                      selected.playerId === activeHandOwner &&
                      selected.handIndex === card.handIndex;
                    return (
                      <button
                        key={card.id}
                        className={`card-shell card-face hand-card ${isSelected ? "card-selected" : ""}`}
                        onClick={() =>
                          handleCardClick({
                            kind: "HAND",
                            playerId: activeHandOwner,
                            handIndex: card.handIndex,
                            cardName: card.name
                          })
                        }
                      >
                        <div className="card-art-placeholder">CARD ART</div>
                        <div className="card-title">{card.name}</div>
                        <div className="card-stats">Cost {card.cost ?? 0}</div>
                        <div className="card-stats">Power {card.power ?? "?"}</div>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="console-window" aria-label="Game state console output">
              <pre>{formatSnapshot(snapshot)}</pre>
            </section>
            <div className="turn-indicator-left">
              Turn <strong>{snapshot.match.turnNumber}</strong> | Phase <strong>{snapshot.match.phase}</strong> | Active{" "}
              <strong>{snapshot.match.activePlayerId}</strong>
            </div>
          </>
        )}
      </section>

      <aside className="action-panel" aria-label="Action panel">
        <h2>Actions</h2>
        <div className="action-state">
          <div>
            Selected: <strong>{selected ? selected.cardName : "None"}</strong>
          </div>
          <div>
            Pending attack: <strong>{pendingAttack ? pendingAttack.attackerName : "None"}</strong>
          </div>
          <div>
            Target: <strong>{selectedAttackTarget ? selectedAttackTarget.label : "None"}</strong>
          </div>
          <div>
            Replace: <strong>{pendingReplace ? pendingReplace.cardName : "None"}</strong>
          </div>
        </div>
        <div className="action-buttons">
          <button disabled={!canEndTurn} onClick={() => run(() => client.endTurn(activePlayerId))}>
            End Turn
          </button>

          {selected?.kind === "HAND" ? (
            <button
              disabled={!canPlaySelectedHand}
              onClick={() => {
                if (!selected || selected.kind !== "HAND") return;
                const board = boardFor(selected.playerId);
                if (board.length >= 5) {
                  setPendingReplace({ playerId: selected.playerId, handIndex: selected.handIndex, cardName: selected.cardName });
                  setReplaceTargetSlot(null);
                  return;
                }
                run(() => client.playCharacter(selected.playerId, selected.handIndex));
              }}
            >
              Play Card
            </button>
          ) : null}

          {selected && selectedIsOwnCard && (selected.kind === "LEADER" || selected.kind === "CHARACTER") ? (
            <button
              disabled={!canStartAttack}
              onClick={() => {
                if (!selected) return;
                if (selected.kind === "LEADER") {
                  setPendingAttack({
                    attackerPlayerId: selected.playerId,
                    attackerRef: "leader",
                    attackerType: "LEADER",
                    attackerName: selected.cardName
                  });
                  setSelectedAttackTarget(null);
                }
                if (selected.kind === "CHARACTER") {
                  setPendingAttack({
                    attackerPlayerId: selected.playerId,
                    attackerRef: selected.slot,
                    attackerType: "CHARACTER",
                    attackerName: selected.cardName
                  });
                  setSelectedAttackTarget(null);
                }
              }}
            >
              Attack
            </button>
          ) : null}

          {pendingAttack ? (
            <div className="action-hint">Select an opponent leader or rested character on the board.</div>
          ) : null}

          {pendingAttack ? (
            <button
              disabled={!canConfirmAttack}
              onClick={() => {
                if (!pendingAttack || !selectedAttackTarget) return;
                if (selectedAttackTarget.type === "LEADER") {
                  run(() => client.attackLeader(pendingAttack.attackerPlayerId, pendingAttack.attackerRef));
                } else {
                  run(() => client.attackCharacter(pendingAttack.attackerPlayerId, pendingAttack.attackerRef, selectedAttackTarget.slot));
                }
                resetActionState();
              }}
            >
              Confirm Attack
            </button>
          ) : null}

          {pendingReplace ? (
            <div className="action-hint">Select one of your characters on board to replace.</div>
          ) : null}

          {pendingReplace ? (
            <button
              disabled={!canConfirmReplace}
              onClick={() => {
                if (!pendingReplace || replaceTargetSlot === null) return;
                run(() => client.playCharacter(pendingReplace.playerId, pendingReplace.handIndex, replaceTargetSlot));
                resetActionState();
              }}
            >
              Confirm Replace
            </button>
          ) : null}

          <button disabled={!pendingAttack && !pendingReplace} onClick={resetActionState}>
            Cancel
          </button>
        </div>
      </aside>
    </main>
  );
}

export default App;
