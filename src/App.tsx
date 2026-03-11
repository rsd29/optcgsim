import { useEffect, useMemo, useState } from "react";
import type { ReactNode, SyntheticEvent } from "react";
import { createLocalGameClient } from "./client/createLocalGameClient";
import { getFallbackCardArtUrl } from "./game/cardArtResolver";
import type { PlayerId, ReadableSnapshot } from "./game/types";

const formatSnapshot = (snapshot: ReadableSnapshot | null): string =>
  snapshot ? JSON.stringify(snapshot, null, 2) : "No match running. Click Start Match.";

type RecentEvent = ReadableSnapshot["recentEvents"][number];

type SelectedEntity =
  | { kind: "HAND"; playerId: PlayerId; handIndex: number; cardName: string }
  | { kind: "LEADER"; playerId: PlayerId; cardName: string }
  | {
      kind: "CHARACTER";
      playerId: PlayerId;
      slot: number;
      cardId: string;
      cardName: string;
      rested: boolean;
      summoningSick: boolean;
      hasBlocker: boolean;
    };

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

const onCardArtError = (event: SyntheticEvent<HTMLImageElement>): void => {
  const img = event.currentTarget;
  if (img.dataset.fallbackApplied === "true") return;
  img.dataset.fallbackApplied = "true";
  img.src = getFallbackCardArtUrl();
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
    case "BLOCK_WINDOW_OPENED":
      return (
        <>
          <strong>{String(payload.defendingPlayerId ?? "")}</strong> may choose a blocker or pass.
        </>
      );
    case "ATTACK_BLOCKED":
      return (
        <>
          <strong>{String(payload.defendingPlayerId ?? "")}</strong> blocked with{" "}
          <strong>{String(payload.blockerName ?? "a blocker")}</strong>.
        </>
      );
    case "BLOCK_PASSED":
      return (
        <>
          <strong>{String(payload.defendingPlayerId ?? "")}</strong> passed block.
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
  const [showEventLog, setShowEventLog] = useState<boolean>(false);
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
  const donFor = (playerId: PlayerId) => (playerId === "P1" ? snapshot?.p1Don ?? [] : snapshot?.p2Don ?? []);
  const handFor = (playerId: PlayerId) => (playerId === "P1" ? snapshot?.p1Hand ?? [] : snapshot?.p2Hand ?? []);
  const trashTopFor = (playerId: PlayerId) => (playerId === "P1" ? snapshot?.p1TrashTop ?? null : snapshot?.p2TrashTop ?? null);
  const selectedCharacterLive =
    selected?.kind === "CHARACTER"
      ? boardFor(selected.playerId).find((card) => card.slot === selected.slot) ?? null
      : null;

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
    if (snapshot.currentAttack) return false;
    if (pendingAttack) return false;
    if (selected.playerId !== activePlayerId) return false;
    if (selected.kind === "LEADER") {
      const player = getPlayer(selected.playerId);
      return Boolean(player && player.turnsTaken > 0 && !player.leaderRested);
    }
    if (selected.kind === "CHARACTER") {
      if (!selectedCharacterLive) return false;
      return !selectedCharacterLive.rested && !selectedCharacterLive.summoningSick;
    }
    return false;
  })();

  const canConfirmAttack = Boolean(pendingAttack && selectedAttackTarget);
  const canConfirmReplace = Boolean(pendingReplace && replaceTargetSlot !== null);
  const defendingPlayerForCurrentAttack = snapshot?.currentAttack?.defendingPlayerId ?? null;
  const canBlockWithSelected = Boolean(
    snapshot &&
      snapshot.currentAttack &&
      selected?.kind === "CHARACTER" &&
      selected.playerId === snapshot.currentAttack.defendingPlayerId &&
      selectedCharacterLive?.hasBlocker &&
      !selectedCharacterLive.rested
  );
  const canPassBlock = Boolean(snapshot?.currentAttack && defendingPlayerForCurrentAttack);
  const selectedCardPreview = (() => {
    if (!snapshot || !selected) return null;
    if (selected.kind === "LEADER") {
      const player = getPlayer(selected.playerId);
      if (!player) return null;
      return { name: selected.cardName, artUrl: player.leaderArtUrl };
    }
    if (selected.kind === "HAND") {
      const card = handFor(selected.playerId).find((entry) => entry.handIndex === selected.handIndex);
      if (!card) return null;
      return { name: selected.cardName, artUrl: card.artUrl };
    }
    const card = boardFor(selected.playerId).find((entry) => entry.slot === selected.slot);
    if (!card) return null;
    return { name: selected.cardName, artUrl: card.artUrl };
  })();
  const renderFaceDownCharacterPile = (
    count: number,
    options?: {
      label?: string;
      maxVisible?: number;
      stagger?: boolean;
      className?: string;
      staggerOffsetPx?: number;
      staggerAxis?: "x" | "y";
      staggerDirection?: 1 | -1;
      nextCardOnTop?: boolean;
    }
  ): ReactNode => {
    const stagger = options?.stagger ?? true;
    const staggerOffsetPx = options?.staggerOffsetPx ?? 4;
    const staggerAxis = options?.staggerAxis ?? "x";
    const staggerDirection = options?.staggerDirection ?? 1;
    const nextCardOnTop = options?.nextCardOnTop ?? false;
    const visibleCards = stagger ? Math.max(1, Math.min(options?.maxVisible ?? 8, count)) : Math.max(1, count > 0 ? 1 : 0);
    return (
      <div className="face-down-pile-wrap">
        <div className={`card-shell pile-card face-down-pile ${options?.className ?? ""}`}>
          {Array.from({ length: visibleCards }, (_, i) => (
            <img
              key={`facedown-${options?.label ?? "pile"}-${i}`}
              src="/card-art/character-back.png"
              alt="Face-down card back"
              className="face-down-back-card"
              style={{
                transform: stagger
                  ? staggerAxis === "y"
                    ? `translateY(${i * staggerOffsetPx * staggerDirection}px)`
                    : `translateX(${i * staggerOffsetPx * staggerDirection}px)`
                  : "translate(0, 0)",
                zIndex: nextCardOnTop ? i + 1 : visibleCards - i
              }}
              onError={onCardArtError}
            />
          ))}
          <div className="pile-count-badge">{count}</div>
        </div>
        {options?.label ? <div className="pile-title">{options.label}</div> : null}
      </div>
    );
  };
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
                  summoningSick: card.summoningSick,
                  hasBlocker: card.hasBlocker
                })
              }
            >
              <img src={card.artUrl} alt={card.name} className="card-art-img" onError={onCardArtError} />
            </button>
          );
        })}
      </div>
    );
  };

  const renderField = (playerId: PlayerId, isOpponent: boolean): ReactNode => {
    const p = getPlayer(playerId);
    if (!p) return null;
    const donCards = donFor(playerId);
    const trashTop = trashTopFor(playerId);
    const visibleDonDeckCards = Math.max(1, Math.min(8, p.donDeck));
    const isActive = snapshot?.match.activePlayerId === playerId;
    const leaderSelected = selected?.kind === "LEADER" && selected.playerId === playerId;
    const leaderTargeted = selectedAttackTarget?.type === "LEADER" && selectedAttackTarget.playerId === playerId;
    const leaderTargetable = canSelectAsAttackTarget(playerId);

    return (
      <section className={`field-zone ${isActive ? "field-zone-active" : ""} ${isOpponent ? "field-opponent" : "field-player"}`}>
        <div className="pile-stack life-pile-overlay">
          {renderFaceDownCharacterPile(p.life, {
            maxVisible: 5,
            stagger: true,
            staggerOffsetPx: 28,
            staggerAxis: "x",
            staggerDirection: isOpponent ? -1 : 1,
            nextCardOnTop: false
          })}
        </div>
        <div className="field-row field-row-top">{renderCharacterRow(playerId)}</div>

        <div className="field-row field-row-middle">
          <div className="center-lane-pair">
            {isOpponent ? <div className="card-shell stage-zone">Stage (future)</div> : null}
            <button
              className={`card-shell card-face leader-card ${leaderSelected ? "card-selected" : ""} ${
                leaderTargeted ? "card-targeted" : ""
              } ${leaderTargetable ? "card-targetable" : ""} ${p.leaderRested ? "card-rested" : ""}`}
              onClick={() => handleCardClick({ kind: "LEADER", playerId, cardName: `${p.name} Leader` })}
            >
              <img src={p.leaderArtUrl} alt={`${p.name} Leader`} className="leader-card-art-full" onError={onCardArtError} />
            </button>
            {!isOpponent ? <div className="card-shell stage-zone">Stage (future)</div> : null}
          </div>
          <div className={`pile-stack deck-pile-stack ${isOpponent ? "opponent-deck-pile" : "player-deck-pile"}`}>
            {renderFaceDownCharacterPile(p.deck, { label: "Deck", stagger: false })}
          </div>
        </div>

        <div className="field-row field-row-bottom">
          <div className="pile-stack">
            <div className="card-shell pile-card don-deck-pile">
              {Array.from({ length: visibleDonDeckCards }, (_, i) => (
                <img
                  key={`${playerId}-don-deck-${i}`}
                  src="/card-art/don-deck-back.png"
                  alt="DON deck back"
                  className="don-deck-back-card"
                  style={{
                    transform: `translateX(${isOpponent ? -i * 6 : i * 6}px)`,
                    zIndex: visibleDonDeckCards - i
                  }}
                  onError={onCardArtError}
                />
              ))}
              <div className="don-deck-count-badge">{p.donDeck}</div>
            </div>
          </div>
          <div className="don-area">
            {donCards.map((don) => (
              <div key={don.id} className={`card-shell card-back don-card ${don.rested ? "card-rested" : ""}`}>
                <div className="don-mark">DON</div>
              </div>
            ))}
          </div>
          <div className="pile-stack">
            {trashTop ? (
              <div className="card-shell card-face pile-card trash-top-card">
                <img src={trashTop.artUrl} alt={`${trashTop.name} in trash`} className="card-art-img trash-top-art" onError={onCardArtError} />
                <div className="trash-count-badge">{p.trash}</div>
              </div>
            ) : (
              <div className="card-shell card-back pile-card trash-card">
                <div className="pile-inside">
                  <div className="pile-title">Trash</div>
                  <div className="pile-count-number">{p.trash}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    );
  };

  const renderHand = (playerId: PlayerId, className = "hand-ui"): ReactNode => {
    const player = getPlayer(playerId);
    const hand = handFor(playerId);
    return (
      <section className={className}>
        <h3>{player?.name ?? playerId} Hand</h3>
        {hand.length === 0 ? (
          <p>No cards in hand.</p>
        ) : (
          <div className="hand-strip">
            {hand.map((card) => {
              const isSelected =
                selected?.kind === "HAND" && selected.playerId === playerId && selected.handIndex === card.handIndex;
              return (
                <button
                  key={card.id}
                  className={`card-shell card-face hand-card ${isSelected ? "card-selected" : ""}`}
                  onClick={() =>
                    handleCardClick({
                      kind: "HAND",
                      playerId,
                      handIndex: card.handIndex,
                      cardName: card.name
                    })
                  }
                >
                  <img src={card.artUrl} alt={card.name} className="card-art-img" onError={onCardArtError} />
                </button>
              );
            })}
          </div>
        )}
      </section>
    );
  };

  const renderActionPanel = (playerId: PlayerId, panelTitle: string, className = "action-panel"): ReactNode => {
    const playerSelected = selected?.playerId === playerId ? selected : null;
    const playerPendingAttack = pendingAttack?.attackerPlayerId === playerId ? pendingAttack : null;
    const playerPendingReplace = pendingReplace?.playerId === playerId ? pendingReplace : null;
    const playerCanEndTurn = Boolean(snapshot && inMainPhase && activePlayerId === playerId && !snapshot.currentAttack);
    const playerCanPlaySelectedHand = Boolean(
      playerSelected && playerSelected.kind === "HAND" && inMainPhase && activePlayerId === playerId
    );
    const playerCanStartAttack = Boolean(
      playerSelected &&
        playerSelected.kind !== "HAND" &&
        playerSelected.playerId === playerId &&
        canStartAttack
    );
    const playerCanConfirmAttack = Boolean(playerPendingAttack && selectedAttackTarget && canConfirmAttack);
    const playerCanBlockWithSelected = Boolean(snapshot?.currentAttack && canBlockWithSelected && selected?.playerId === playerId);
    const playerCanPassBlock = Boolean(snapshot?.currentAttack && defendingPlayerForCurrentAttack === playerId && canPassBlock);
    const playerCanConfirmReplace = Boolean(playerPendingReplace && canConfirmReplace);

    return (
      <aside className={className} aria-label={`${panelTitle} action panel`}>
        <h2>{panelTitle}</h2>
        <div className="action-state">
          <div>
            Selected: <strong>{playerSelected ? playerSelected.cardName : "None"}</strong>
          </div>
          <div>
            Pending attack: <strong>{playerPendingAttack ? playerPendingAttack.attackerName : "None"}</strong>
          </div>
          <div>
            Target: <strong>{playerPendingAttack ? (selectedAttackTarget?.label ?? "None") : "None"}</strong>
          </div>
          <div>
            Replace: <strong>{playerPendingReplace ? playerPendingReplace.cardName : "None"}</strong>
          </div>
        </div>
        <div className="action-buttons">
          {playerCanEndTurn ? <button onClick={() => run(() => client.endTurn(playerId))}>End Turn</button> : null}

          {playerCanPlaySelectedHand ? (
            <button
              onClick={() => {
                if (!playerSelected || playerSelected.kind !== "HAND") return;
                const board = boardFor(playerSelected.playerId);
                if (board.length >= 5) {
                  setPendingReplace({
                    playerId: playerSelected.playerId,
                    handIndex: playerSelected.handIndex,
                    cardName: playerSelected.cardName
                  });
                  setReplaceTargetSlot(null);
                  return;
                }
                run(() => client.playCharacter(playerSelected.playerId, playerSelected.handIndex));
              }}
            >
              Play Card
            </button>
          ) : null}

          {playerCanStartAttack ? (
            <button
              onClick={() => {
                if (!playerSelected || playerSelected.kind === "HAND") return;
                if (playerSelected.kind === "LEADER") {
                  setPendingAttack({
                    attackerPlayerId: playerSelected.playerId,
                    attackerRef: "leader",
                    attackerType: "LEADER",
                    attackerName: playerSelected.cardName
                  });
                  setSelectedAttackTarget(null);
                } else {
                  setPendingAttack({
                    attackerPlayerId: playerSelected.playerId,
                    attackerRef: playerSelected.slot,
                    attackerType: "CHARACTER",
                    attackerName: playerSelected.cardName
                  });
                  setSelectedAttackTarget(null);
                }
              }}
            >
              Attack
            </button>
          ) : null}

          {playerPendingAttack ? <div className="action-hint">Select an opponent leader or rested character on the board.</div> : null}

          {playerCanConfirmAttack ? (
            <button
              onClick={() => {
                if (!playerPendingAttack || !selectedAttackTarget) return;
                if (selectedAttackTarget.type === "LEADER") {
                  run(() => client.attackLeader(playerPendingAttack.attackerPlayerId, playerPendingAttack.attackerRef));
                } else {
                  run(() =>
                    client.attackCharacter(playerPendingAttack.attackerPlayerId, playerPendingAttack.attackerRef, selectedAttackTarget.slot)
                  );
                }
                resetActionState();
              }}
            >
              Confirm Attack
            </button>
          ) : null}

          {snapshot?.currentAttack && defendingPlayerForCurrentAttack === playerId ? (
            <div className="action-hint">
              Defending player may block with an active character that has Blocker, or pass.
            </div>
          ) : null}

          {playerCanBlockWithSelected ? (
            <button
              onClick={() => {
                if (!selected || selected.kind !== "CHARACTER") return;
                run(() => client.blockAttack(selected.playerId, selected.slot));
                resetActionState();
              }}
            >
              Block With Selected
            </button>
          ) : null}

          {playerCanPassBlock ? (
            <button
              onClick={() => {
                if (!defendingPlayerForCurrentAttack) return;
                run(() => client.passBlock(defendingPlayerForCurrentAttack));
                resetActionState();
              }}
            >
              Pass Block
            </button>
          ) : null}

          {playerPendingReplace ? <div className="action-hint">Select one of your characters on board to replace.</div> : null}

          {playerCanConfirmReplace ? (
            <button
              onClick={() => {
                if (!playerPendingReplace || replaceTargetSlot === null) return;
                run(() => client.playCharacter(playerPendingReplace.playerId, playerPendingReplace.handIndex, replaceTargetSlot));
                resetActionState();
              }}
            >
              Confirm Replace
            </button>
          ) : null}

          {playerPendingAttack || playerPendingReplace ? <button onClick={resetActionState}>Cancel</button> : null}

          {!playerCanEndTurn &&
          !playerCanPlaySelectedHand &&
          !playerCanStartAttack &&
          !playerCanConfirmAttack &&
          !playerCanBlockWithSelected &&
          !playerCanPassBlock &&
          !playerCanConfirmReplace &&
          !playerPendingAttack &&
          !playerPendingReplace ? (
            <div className="action-hint">No available actions right now.</div>
          ) : null}
        </div>
      </aside>
    );
  };

  return (
    <main className="page page-layout">
      <section className="left-sidebar">
        {showEventLog ? (
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
        ) : null}
        <aside className="selected-card-panel" aria-label="Selected card preview">
          <h2>Selected Card</h2>
          {selectedCardPreview ? (
            <img
              src={selectedCardPreview.artUrl}
              alt={selectedCardPreview.name}
              className="selected-card-preview-img"
              onError={onCardArtError}
            />
          ) : (
            <p>Select a card to preview its art.</p>
          )}
        </aside>
      </section>

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
          <button onClick={() => setShowEventLog((prev) => !prev)}>
            {showEventLog ? "Hide What Just Happened" : "Show What Just Happened"}
          </button>
        </div>

        {error ? <p className="error">Error: {error}</p> : null}

        {!snapshot ? (
          <section className="text-mode-window">
            <p>No match running yet.</p>
          </section>
        ) : (
          <>
            {renderHand("P2", "hand-ui hand-ui-top")}
            <section className="board-table">
              {renderField("P2", true)}
              {renderField("P1", false)}
            </section>
            {renderHand("P1", "hand-ui")}

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

      <section className="action-panels">
        {renderActionPanel("P2", "P2 Actions", "action-panel action-panel-top")}
        {renderActionPanel("P1", "P1 Actions", "action-panel")}
      </section>
    </main>
  );
}

export default App;
