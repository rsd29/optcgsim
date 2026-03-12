import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode, SyntheticEvent } from "react";
import { createLocalGameClient } from "./client/createLocalGameClient";
import { getFallbackCardArtUrl } from "./game/cardArtResolver";
import { DEFAULT_PLAYER_CLOCK_SECONDS, LOW_TIME_WARNING_SECONDS, getTimeControlPlayerId } from "./game/timeControl";
import type { PlayerId, ReadableSnapshot } from "./game/types";

const formatSnapshot = (snapshot: ReadableSnapshot | null): string =>
  snapshot ? JSON.stringify(snapshot, null, 2) : "No match running. Click Start Match.";
const formatClock = (totalSeconds: number): string => {
  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

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

type CombatPreviewCard = {
  playerId: PlayerId;
  name: string;
  artUrl: string;
  power: number | null;
};

type HandSortMode = "DEFAULT" | "COST" | "COUNTER_THEN_COST" | "TYPE_THEN_COST";
type PreGamePhase = "IDLE" | "READY" | "ROLLING" | "CHOOSING";
type PreGameReelState = {
  current: number;
  next: number;
  animating: boolean;
  stepKey: number;
  stepDurationMs: number;
};
type StartMode = "ROLL_FLOW" | "DEBUG_P1_FIRST";

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
const createInitialReelState = (): PreGameReelState => ({
  current: 1,
  next: 1,
  animating: false,
  stepKey: 0,
  stepDurationMs: 120
});

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
  const [p1ClockSeconds, setP1ClockSeconds] = useState<number>(DEFAULT_PLAYER_CLOCK_SECONDS);
  const [p2ClockSeconds, setP2ClockSeconds] = useState<number>(DEFAULT_PLAYER_CLOCK_SECONDS);
  const [timeoutDeclaredFor, setTimeoutDeclaredFor] = useState<PlayerId | null>(null);
  const [p1HandSortMode, setP1HandSortMode] = useState<HandSortMode>("DEFAULT");
  const [p2HandSortMode, setP2HandSortMode] = useState<HandSortMode>("DEFAULT");
  const [hoveredDeckPlayerId, setHoveredDeckPlayerId] = useState<PlayerId | null>(null);
  const [pendingStartMode, setPendingStartMode] = useState<StartMode | null>(null);
  const [preGamePhase, setPreGamePhase] = useState<PreGamePhase>("IDLE");
  const [p1Reel, setP1Reel] = useState<PreGameReelState>(createInitialReelState);
  const [p2Reel, setP2Reel] = useState<PreGameReelState>(createInitialReelState);
  const [preGameFinalRolls, setPreGameFinalRolls] = useState<{ P1: number; P2: number } | null>(null);
  const [preGameWinner, setPreGameWinner] = useState<PlayerId | null>(null);
  const preGameTimerIdsRef = useRef<number[]>([]);
  const preGameAnimationTokenRef = useRef<number>(0);

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
  const timeControlPlayerId: PlayerId = getTimeControlPlayerId(snapshot);
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

  useEffect(() => {
    if (!snapshot?.match.id) return;
    setP1ClockSeconds(DEFAULT_PLAYER_CLOCK_SECONDS);
    setP2ClockSeconds(DEFAULT_PLAYER_CLOCK_SECONDS);
    setTimeoutDeclaredFor(null);
  }, [snapshot?.match.id]);

  useEffect(() => {
    return () => {
      for (const timerId of preGameTimerIdsRef.current) {
        window.clearTimeout(timerId);
      }
      preGameTimerIdsRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!snapshot || snapshot.match.status !== "IN_PROGRESS") return;
    const tick = window.setInterval(() => {
      if (timeControlPlayerId === "P1") {
        setP1ClockSeconds((prev) => Math.max(0, prev - 1));
      } else {
        setP2ClockSeconds((prev) => Math.max(0, prev - 1));
      }
    }, 1000);
    return () => window.clearInterval(tick);
  }, [snapshot?.match.status, snapshot?.match.id, timeControlPlayerId]);

  useEffect(() => {
    if (!snapshot || snapshot.match.status !== "IN_PROGRESS") return;
    if (timeoutDeclaredFor) return;
    if (p1ClockSeconds <= 0) {
      run(() => client.declareTimeoutLoss("P1"));
      setTimeoutDeclaredFor("P1");
      return;
    }
    if (p2ClockSeconds <= 0) {
      run(() => client.declareTimeoutLoss("P2"));
      setTimeoutDeclaredFor("P2");
    }
  }, [snapshot?.match.status, p1ClockSeconds, p2ClockSeconds, timeoutDeclaredFor, client]);

  const canBeAttackTargetFor = (attackerPlayerId: PlayerId, targetPlayerId: PlayerId, rested?: boolean): boolean => {
    if (attackerPlayerId === targetPlayerId) return false;
    return rested === undefined ? true : rested;
  };

  const canSelectAsAttackTarget = (playerId: PlayerId, rested?: boolean): boolean => {
    if (!pendingAttack) return false;
    return canBeAttackTargetFor(pendingAttack.attackerPlayerId, playerId, rested);
  };

  const handSortModeFor = (playerId: PlayerId): HandSortMode => (playerId === "P1" ? p1HandSortMode : p2HandSortMode);
  const setHandSortModeFor = (playerId: PlayerId, mode: HandSortMode): void => {
    if (playerId === "P1") {
      setP1HandSortMode(mode);
    } else {
      setP2HandSortMode(mode);
    }
  };

  const sortHandCards = (cards: ReadableSnapshot["p1Hand"], mode: HandSortMode): ReadableSnapshot["p1Hand"] => {
    if (mode === "DEFAULT") return cards;
    const copy = [...cards];
    const safeCost = (value: number | undefined): number => (typeof value === "number" ? value : Number.MAX_SAFE_INTEGER);
    const safeCounter = (value: number | undefined): number => (typeof value === "number" ? value : 0);
    const typeBucket = (card: (typeof copy)[number]): number => {
      if (safeCounter(card.counter) > 0) return 0;
      if (card.type === "CHARACTER") return 1;
      if (card.type === "EVENT") return 2;
      return 3;
    };

    copy.sort((a, b) => {
      if (mode === "COST") {
        return safeCost(a.cost) - safeCost(b.cost) || a.name.localeCompare(b.name);
      }
      if (mode === "COUNTER_THEN_COST") {
        return safeCounter(b.counter) - safeCounter(a.counter) || safeCost(a.cost) - safeCost(b.cost) || a.name.localeCompare(b.name);
      }
      return (
        typeBucket(a) - typeBucket(b) ||
        safeCost(a.cost) - safeCost(b.cost) ||
        safeCounter(b.counter) - safeCounter(a.counter) ||
        a.name.localeCompare(b.name)
      );
    });
    return copy;
  };

  const clearPreGameTimers = (): void => {
    for (const timerId of preGameTimerIdsRef.current) {
      window.clearTimeout(timerId);
    }
    preGameTimerIdsRef.current = [];
  };

  const randomRoll = (): number => Math.floor(Math.random() * 12) + 1;

  const waitPreGame = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const id = window.setTimeout(resolve, ms);
      preGameTimerIdsRef.current.push(id);
    });

  const animateReelToTarget = async (
    playerId: PlayerId,
    from: number,
    target: number,
    token: number
  ): Promise<void> => {
    const setReel = playerId === "P1" ? setP1Reel : setP2Reel;
    const cycleCount = 1 + Math.floor(Math.random() * 2);
    const stepsToTarget = ((target - from + 12) % 12) || 12;
    const totalSteps = cycleCount * 12 + stepsToTarget;
    const fastMs = 50 + Math.floor(Math.random() * 12);
    const slowdownSteps = Math.min(6, Math.max(4, totalSteps - 1));
    const fastPhaseSteps = Math.max(0, totalSteps - slowdownSteps);
    const slowEndMs = 230 + Math.floor(Math.random() * 40);
    let current = from;

    for (let step = 0; step < totalSteps; step += 1) {
      if (preGameAnimationTokenRef.current !== token) return;
      const next = (current % 12) + 1;
      let stepDurationMs = fastMs;
      if (step >= fastPhaseSteps) {
        // Only slow down in the final handful of steps, near target.
        const slowStepIndex = step - fastPhaseSteps;
        const slowProgress = slowdownSteps <= 1 ? 1 : slowStepIndex / (slowdownSteps - 1);
        const easedSlow = Math.pow(slowProgress, 2.2);
        stepDurationMs = Math.round(fastMs + (slowEndMs - fastMs) * easedSlow);
      }

      setReel((prev) => ({
        current,
        next,
        animating: true,
        stepKey: prev.stepKey + 1,
        stepDurationMs
      }));
      await waitPreGame(stepDurationMs);
      if (preGameAnimationTokenRef.current !== token) return;
      current = next;
      setReel((prev) => ({
        ...prev,
        current,
        next: current,
        animating: false
      }));
      await waitPreGame(10);
    }
  };

  const startPreGameRoll = async (): Promise<void> => {
    clearPreGameTimers();
    preGameAnimationTokenRef.current += 1;
    const token = preGameAnimationTokenRef.current;
    let p1 = randomRoll();
    let p2 = randomRoll();
    while (p1 === p2) {
      p2 = randomRoll();
    }
    setPreGameFinalRolls({ P1: p1, P2: p2 });
    setPreGameWinner(p1 > p2 ? "P1" : "P2");
    setPreGamePhase("ROLLING");
    const p1Start = p1Reel.current;
    const p2Start = p2Reel.current;
    await Promise.all([animateReelToTarget("P1", p1Start, p1, token), animateReelToTarget("P2", p2Start, p2, token)]);
    if (preGameAnimationTokenRef.current !== token) return;
    setP1Reel((prev) => ({ ...prev, current: p1, next: p1, animating: false }));
    setP2Reel((prev) => ({ ...prev, current: p2, next: p2, animating: false }));
    clearPreGameTimers();
    setPreGamePhase("CHOOSING");
  };

  const resetUiForNewMatch = (): void => {
    clearPreGameTimers();
    preGameAnimationTokenRef.current += 1;
    setSnapshot(null);
    setError("");
    setSelected(null);
    setPendingAttack(null);
    setPendingReplace(null);
    setSelectedAttackTarget(null);
    setReplaceTargetSlot(null);
    setHoveredDeckPlayerId(null);
    setTimeoutDeclaredFor(null);
    setP1ClockSeconds(DEFAULT_PLAYER_CLOCK_SECONDS);
    setP2ClockSeconds(DEFAULT_PLAYER_CLOCK_SECONDS);
    setP1HandSortMode("DEFAULT");
    setP2HandSortMode("DEFAULT");
    setPreGameWinner(null);
    setPreGameFinalRolls(null);
    setPreGamePhase("IDLE");
    setP1Reel(createInitialReelState());
    setP2Reel(createInitialReelState());
  };

  const beginStartMode = (mode: StartMode): void => {
    const matchIsInProgress = Boolean(snapshot && snapshot.match.status === "IN_PROGRESS");
    if (matchIsInProgress) {
      setPendingStartMode(mode);
      return;
    }
    resetUiForNewMatch();
    if (mode === "ROLL_FLOW") {
      setPreGamePhase("READY");
      return;
    }
    run(() =>
      client.startMatch("Luffy", "Kaido", {
        testStartWithTenDon,
        firstPlayerId: "P1",
        initialClockSeconds: DEFAULT_PLAYER_CLOCK_SECONDS
      })
    );
  };

  const handlePreGameChoice = (winnerChoosesFirst: boolean): void => {
    if (!preGameFinalRolls || !preGameWinner) return;
    clearPreGameTimers();
    preGameAnimationTokenRef.current += 1;
    const firstPlayerId: PlayerId = winnerChoosesFirst ? preGameWinner : preGameWinner === "P1" ? "P2" : "P1";
    setPreGamePhase("IDLE");
    run(() =>
      client.startMatch("Luffy", "Kaido", {
        testStartWithTenDon,
        firstPlayerId,
        p1Roll: preGameFinalRolls.P1,
        p2Roll: preGameFinalRolls.P2,
        initialClockSeconds: DEFAULT_PLAYER_CLOCK_SECONDS
      })
    );
  };

  const startDebugMatchP1First = (): void => {
    beginStartMode("DEBUG_P1_FIRST");
  };

  const confirmQuitAndStart = (): void => {
    if (!pendingStartMode) return;
    const nextMode = pendingStartMode;
    setPendingStartMode(null);
    resetUiForNewMatch();
    if (nextMode === "ROLL_FLOW") {
      setPreGamePhase("READY");
      return;
    }
    run(() =>
      client.startMatch("Luffy", "Kaido", {
        testStartWithTenDon,
        firstPlayerId: "P1",
        initialClockSeconds: DEFAULT_PLAYER_CLOCK_SECONDS
      })
    );
  };

  const buildPendingAttackFromEntity = (entity: SelectedEntity): PendingAttack | null => {
    if (entity.kind === "HAND") return null;
    if (entity.kind === "LEADER") {
      return {
        attackerPlayerId: entity.playerId,
        attackerRef: "leader",
        attackerType: "LEADER",
        attackerName: entity.cardName
      };
    }
    return {
      attackerPlayerId: entity.playerId,
      attackerRef: entity.slot,
      attackerType: "CHARACTER",
      attackerName: entity.cardName
    };
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

    if (
      !pendingAttack &&
      selected &&
      selected.kind !== "HAND" &&
      canStartAttack &&
      selected.playerId === activePlayerId &&
      entity.kind === "LEADER" &&
      canBeAttackTargetFor(selected.playerId, entity.playerId)
    ) {
      const nextPendingAttack = buildPendingAttackFromEntity(selected);
      if (!nextPendingAttack) return;
      setPendingAttack(nextPendingAttack);
      setSelectedAttackTarget({ type: "LEADER", playerId: entity.playerId, label: `${entity.cardName}` });
      return;
    }

    if (
      !pendingAttack &&
      selected &&
      selected.kind !== "HAND" &&
      canStartAttack &&
      selected.playerId === activePlayerId &&
      entity.kind === "CHARACTER" &&
      canBeAttackTargetFor(selected.playerId, entity.playerId, entity.rested)
    ) {
      const nextPendingAttack = buildPendingAttackFromEntity(selected);
      if (!nextPendingAttack) return;
      setPendingAttack(nextPendingAttack);
      setSelectedAttackTarget({
        type: "CHARACTER",
        playerId: entity.playerId,
        slot: entity.slot,
        label: `${entity.cardName} (#${entity.slot + 1})`
      });
      return;
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
  const buildLeaderPreviewCard = (playerId: PlayerId, fallbackName?: string): CombatPreviewCard | null => {
    const player = getPlayer(playerId);
    if (!player) return null;
    return {
      playerId,
      name: fallbackName ?? `${playerId} Leader`,
      artUrl: player.leaderArtUrl,
      power: player.leaderPower
    };
  };
  const buildCharacterPreviewCardById = (playerId: PlayerId, cardId: string): CombatPreviewCard | null => {
    const card = boardFor(playerId).find((entry) => entry.id === cardId);
    if (!card) return null;
    return {
      playerId,
      name: card.name,
      artUrl: card.artUrl,
      power: card.power ?? null
    };
  };
  const buildCharacterPreviewCardBySlot = (playerId: PlayerId, slot: number): CombatPreviewCard | null => {
    const card = boardFor(playerId).find((entry) => entry.slot === slot);
    if (!card) return null;
    return {
      playerId,
      name: card.name,
      artUrl: card.artUrl,
      power: card.power ?? null
    };
  };
  const pendingAttackAttackerPreviewCard = (() => {
    if (!pendingAttack) return null;
    if (pendingAttack.attackerType === "LEADER") {
      return buildLeaderPreviewCard(pendingAttack.attackerPlayerId, pendingAttack.attackerName);
    }
    if (typeof pendingAttack.attackerRef !== "number") return null;
    return buildCharacterPreviewCardBySlot(pendingAttack.attackerPlayerId, pendingAttack.attackerRef);
  })();
  const selectedTargetPreviewCard = (() => {
    if (!selectedAttackTarget) return null;
    if (selectedAttackTarget.type === "LEADER") {
      return buildLeaderPreviewCard(selectedAttackTarget.playerId, selectedAttackTarget.label);
    }
    return buildCharacterPreviewCardBySlot(selectedAttackTarget.playerId, selectedAttackTarget.slot);
  })();
  const liveAttackAttackerPreviewCard = (() => {
    if (!snapshot?.currentAttack) return null;
    const attack = snapshot.currentAttack;
    const attackerCharacter = buildCharacterPreviewCardById(attack.attackingPlayerId, attack.attackerId);
    if (attackerCharacter) return attackerCharacter;
    return buildLeaderPreviewCard(attack.attackingPlayerId);
  })();
  const liveAttackDefenderPreviewCard = (() => {
    if (!snapshot?.currentAttack) return null;
    const attack = snapshot.currentAttack;
    if (attack.defendingCharacterId) {
      return buildCharacterPreviewCardById(attack.defendingPlayerId, attack.defendingCharacterId);
    }
    if (attack.target === "LEADER") {
      return buildLeaderPreviewCard(attack.defendingPlayerId);
    }
    return null;
  })();
  const combatPreview = (() => {
    if (snapshot?.currentAttack) {
      return {
        show: true,
        attacker: liveAttackAttackerPreviewCard,
        defender: liveAttackDefenderPreviewCard,
        attackerPlayerId: snapshot.currentAttack.attackingPlayerId
      };
    }
    if (pendingAttack) {
      return {
        show: true,
        attacker: pendingAttackAttackerPreviewCard,
        defender: selectedTargetPreviewCard,
        attackerPlayerId: pendingAttack.attackerPlayerId
      };
    }
    return {
      show: false,
      attacker: null,
      defender: null,
      attackerPlayerId: null
    };
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
                <img
                  src="/card-art/character-slot-jolly-roger.png"
                  alt={`Character slot ${slot + 1}`}
                  className="empty-slot-symbol"
                  onError={onCardArtError}
                />
                <div className="empty-slot-number">{slot + 1}</div>
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
          const isPendingAttacker =
            Boolean(
              pendingAttack &&
                pendingAttack.attackerPlayerId === playerId &&
                pendingAttack.attackerType === "CHARACTER" &&
                typeof pendingAttack.attackerRef === "number" &&
                pendingAttack.attackerRef === slot
            ) && !snapshot?.currentAttack;
          const isLiveAttacker = Boolean(
            snapshot?.currentAttack &&
              snapshot.currentAttack.attackingPlayerId === playerId &&
              snapshot.currentAttack.attackerId === card.id
          );
          const isPendingDefender =
            Boolean(
              pendingAttack &&
                selectedAttackTarget?.type === "CHARACTER" &&
                selectedAttackTarget.playerId === playerId &&
                selectedAttackTarget.slot === slot
            ) && !snapshot?.currentAttack;
          const isLiveDefender = Boolean(
            snapshot?.currentAttack &&
              snapshot.currentAttack.defendingPlayerId === playerId &&
              snapshot.currentAttack.defendingCharacterId === card.id
          );
          const isAttacker = isPendingAttacker || isLiveAttacker;
          const isDefender = isPendingDefender || isLiveDefender;

          return (
            <button
              key={card.id}
              className={`card-shell card-face field-card ${card.rested ? "card-rested" : ""} ${isSelected ? "card-selected" : ""} ${
                isTargeted ? "card-targeted" : ""
              } ${isTargetable ? "card-targetable" : ""} ${isAttacker ? "card-attacker" : ""} ${isDefender ? "card-defender" : ""}`}
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
    const pendingLeaderAttacker =
      Boolean(
        pendingAttack &&
          pendingAttack.attackerPlayerId === playerId &&
          pendingAttack.attackerType === "LEADER" &&
          pendingAttack.attackerRef === "leader"
      ) && !snapshot?.currentAttack;
    const liveLeaderAttacker = Boolean(
      snapshot?.currentAttack &&
        snapshot.currentAttack.attackingPlayerId === playerId &&
        !boardFor(playerId).some((card) => card.id === snapshot.currentAttack?.attackerId)
    );
    const pendingLeaderDefender =
      Boolean(
        pendingAttack &&
          selectedAttackTarget?.type === "LEADER" &&
          selectedAttackTarget.playerId === playerId
      ) && !snapshot?.currentAttack;
    const liveLeaderDefender = Boolean(
      snapshot?.currentAttack &&
        snapshot.currentAttack.defendingPlayerId === playerId &&
        snapshot.currentAttack.target === "LEADER" &&
        !snapshot.currentAttack.defendingCharacterId
    );
    const leaderIsAttacker = pendingLeaderAttacker || liveLeaderAttacker;
    const leaderIsDefender = pendingLeaderDefender || liveLeaderDefender;

    const lifePileNode = (
      <div className="pile-stack life-pile-layout">
        {renderFaceDownCharacterPile(p.life, {
          maxVisible: 5,
          stagger: true,
          staggerOffsetPx: 28,
          staggerAxis: "x",
          staggerDirection: isOpponent ? -1 : 1,
          nextCardOnTop: false
        })}
      </div>
    );

    return (
      <section className={`field-zone ${isActive ? "field-zone-active" : ""} ${isOpponent ? "field-opponent" : "field-player"}`}>
        <div className="field-row field-row-top">
          <div className="life-pile-slot life-pile-slot-left">{isOpponent ? null : lifePileNode}</div>
          {renderCharacterRow(playerId)}
          <div className="life-pile-slot life-pile-slot-right">{isOpponent ? lifePileNode : null}</div>
        </div>

        <div className="field-row field-row-middle">
          <div className="center-lane-pair">
            {isOpponent ? <div className="card-shell stage-zone">Stage (future)</div> : null}
            <button
              className={`card-shell card-face leader-card ${leaderSelected ? "card-selected" : ""} ${
                leaderTargeted ? "card-targeted" : ""
              } ${leaderTargetable ? "card-targetable" : ""} ${p.leaderRested ? "card-rested" : ""} ${
                leaderIsAttacker ? "card-attacker" : ""
              } ${leaderIsDefender ? "card-defender" : ""}`}
              onClick={() => handleCardClick({ kind: "LEADER", playerId, cardName: `${p.name} Leader` })}
            >
              <img src={p.leaderArtUrl} alt={`${p.name} Leader`} className="leader-card-art-full" onError={onCardArtError} />
            </button>
            {!isOpponent ? <div className="card-shell stage-zone">Stage (future)</div> : null}
          </div>
          <div
            className={`pile-stack deck-pile-stack ${isOpponent ? "opponent-deck-pile" : "player-deck-pile"} ${
              hoveredDeckPlayerId === playerId ? "deck-count-visible" : ""
            }`}
            onMouseEnter={() => setHoveredDeckPlayerId(playerId)}
            onMouseLeave={() => setHoveredDeckPlayerId((prev) => (prev === playerId ? null : prev))}
          >
            {renderFaceDownCharacterPile(p.deck, {
              stagger: true,
              maxVisible: 22,
              staggerAxis: "y",
              staggerOffsetPx: 1
            })}
          </div>
        </div>

        <div className="field-row field-row-bottom">
          <div className="pile-stack">
            <div className={`card-shell pile-card don-deck-pile ${p.donDeck === 0 ? "don-deck-pile-empty" : ""}`}>
              {p.donDeck > 0 ? (
                Array.from({ length: visibleDonDeckCards }, (_, i) => (
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
                ))
              ) : (
                <img src="/card-art/don-empty-symbol.png" alt="No DON cards remaining" className="don-deck-empty-symbol" onError={onCardArtError} />
              )}
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
    const hand = handFor(playerId);
    const handSortMode = handSortModeFor(playerId);
    const sortedHand = sortHandCards(hand, handSortMode);
    const playerLabel = playerId === "P1" ? "Player 1" : "Player 2";
    const handCountLabel = `${hand.length} ${hand.length === 1 ? "Card" : "Cards"}`;
    const staggerStartCount = 9;
    const shouldStagger = sortedHand.length >= staggerStartCount;
    const staggerOverlapPx = Math.min(44, Math.max(12, (sortedHand.length - staggerStartCount + 1) * 6));
    const handStripStyle: CSSProperties | undefined = shouldStagger
      ? ({ "--hand-stagger-overlap": `${staggerOverlapPx}px` } as CSSProperties)
      : undefined;
    return (
      <section className={className}>
        <h3>
          {playerLabel} Hand ({handCountLabel})
        </h3>
        {hand.length === 0 ? (
          <p>No cards in hand.</p>
        ) : (
          <div className={`hand-strip ${shouldStagger ? "hand-strip-staggered" : ""}`} style={handStripStyle}>
            {sortedHand.map((card) => {
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
        <div className="hand-sort-controls" role="group" aria-label={`${playerLabel} hand sorting controls`}>
          <button
            className={handSortMode === "DEFAULT" ? "hand-sort-btn hand-sort-btn-active" : "hand-sort-btn"}
            onClick={() => setHandSortModeFor(playerId, "DEFAULT")}
          >
            Default
          </button>
          <button
            className={handSortMode === "COST" ? "hand-sort-btn hand-sort-btn-active" : "hand-sort-btn"}
            onClick={() => setHandSortModeFor(playerId, "COST")}
          >
            Cost
          </button>
          <button
            className={handSortMode === "COUNTER_THEN_COST" ? "hand-sort-btn hand-sort-btn-active" : "hand-sort-btn"}
            onClick={() => setHandSortModeFor(playerId, "COUNTER_THEN_COST")}
          >
            Counter -&gt; Cost
          </button>
          <button
            className={handSortMode === "TYPE_THEN_COST" ? "hand-sort-btn hand-sort-btn-active" : "hand-sort-btn"}
            onClick={() => setHandSortModeFor(playerId, "TYPE_THEN_COST")}
          >
            Type -&gt; Cost
          </button>
        </div>
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

          {playerPendingAttack ? <div className="action-hint">Select an opponent leader or rested character on the board.</div> : null}

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

  const handleConfirmAttack = (): void => {
    if (!pendingAttack || !selectedAttackTarget) return;
    if (selectedAttackTarget.type === "LEADER") {
      run(() => client.attackLeader(pendingAttack.attackerPlayerId, pendingAttack.attackerRef));
    } else {
      run(() => client.attackCharacter(pendingAttack.attackerPlayerId, pendingAttack.attackerRef, selectedAttackTarget.slot));
    }
    resetActionState();
  };

  return (
    <main className="page page-layout page-layout-no-left-sidebar">
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
          <button onClick={() => beginStartMode("ROLL_FLOW")}>Start Match</button>
          <button onClick={startDebugMatchP1First}>Debug Start Match (P1 First)</button>
          <button onClick={() => run(() => client.print())}>Print To Console</button>
          <button onClick={() => setShowEventLog((prev) => !prev)}>
            {showEventLog ? "Hide What Just Happened" : "Show What Just Happened"}
          </button>
        </div>

        {preGamePhase !== "IDLE" ? (
          <section className="pregame-roll-panel" aria-label="Pre-game roll and turn choice">
            <div className="pregame-roll-split">
              <div
                className={`pregame-roll-side pregame-roll-side-p1 ${
                  preGamePhase === "CHOOSING" ? (preGameWinner === "P1" ? "pregame-roll-side-winner" : "pregame-roll-side-loser") : ""
                }`}
              >
                <h3>Player 1</h3>
                <div className={`pregame-roll-spinner ${preGamePhase === "ROLLING" ? "pregame-roll-spinner-rolling" : ""}`}>
                  <div className={`pregame-roll-ring ${preGamePhase === "ROLLING" ? "pregame-roll-ring-rolling" : ""}`} />
                  <div className="pregame-roll-window" style={{ "--reel-step-ms": `${p1Reel.stepDurationMs}ms` } as CSSProperties}>
                    <div className={`pregame-roll-number ${p1Reel.animating ? "pregame-roll-number-exit-down" : ""}`} key={`p1-cur-${p1Reel.stepKey}`}>
                      {p1Reel.current}
                    </div>
                    {p1Reel.animating ? (
                      <div className="pregame-roll-number pregame-roll-number-enter-from-top" key={`p1-next-${p1Reel.stepKey}`}>
                        {p1Reel.next}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className={`pregame-choice-slot ${preGamePhase === "CHOOSING" && preGameWinner === "P1" ? "pregame-choice-slot-active" : ""}`}>
                  <div className="pregame-choice-actions">
                    <button onClick={() => handlePreGameChoice(true)}>Go First</button>
                    <button onClick={() => handlePreGameChoice(false)}>Go Second</button>
                  </div>
                </div>
              </div>
              <div
                className={`pregame-roll-side pregame-roll-side-p2 ${
                  preGamePhase === "CHOOSING" ? (preGameWinner === "P2" ? "pregame-roll-side-winner" : "pregame-roll-side-loser") : ""
                }`}
              >
                <h3>Player 2</h3>
                <div className={`pregame-roll-spinner ${preGamePhase === "ROLLING" ? "pregame-roll-spinner-rolling" : ""}`}>
                  <div className={`pregame-roll-ring ${preGamePhase === "ROLLING" ? "pregame-roll-ring-rolling" : ""}`} />
                  <div className="pregame-roll-window" style={{ "--reel-step-ms": `${p2Reel.stepDurationMs}ms` } as CSSProperties}>
                    <div className={`pregame-roll-number ${p2Reel.animating ? "pregame-roll-number-exit-down" : ""}`} key={`p2-cur-${p2Reel.stepKey}`}>
                      {p2Reel.current}
                    </div>
                    {p2Reel.animating ? (
                      <div className="pregame-roll-number pregame-roll-number-enter-from-top" key={`p2-next-${p2Reel.stepKey}`}>
                        {p2Reel.next}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className={`pregame-choice-slot ${preGamePhase === "CHOOSING" && preGameWinner === "P2" ? "pregame-choice-slot-active" : ""}`}>
                  <div className="pregame-choice-actions">
                    <button onClick={() => handlePreGameChoice(true)}>Go First</button>
                    <button onClick={() => handlePreGameChoice(false)}>Go Second</button>
                  </div>
                </div>
              </div>
            </div>
            <div className="pregame-roll-meta">
              {preGamePhase === "READY" ? <button onClick={startPreGameRoll}>Start Roll</button> : null}
              {preGamePhase === "ROLLING" ? "Rolling 1-12..." : null}
              {preGamePhase === "CHOOSING" && preGameWinner ? `${preGameWinner} wins the roll. Choose turn order.` : null}
            </div>
          </section>
        ) : null}

        {error ? <p className="error">Error: {error}</p> : null}

        {!snapshot ? (
          <section className="text-mode-window">
            <p>No match running yet.</p>
          </section>
        ) : (
          <>
            {renderHand("P2", "hand-ui hand-ui-top")}
            <section className={`board-table ${timeControlPlayerId === "P2" ? "board-table-opponent-turn" : "board-table-player-turn"}`}>
              <div
                className={`turn-arrow ${snapshot.match.activePlayerId === "P2" ? "turn-arrow-top turn-arrow-opponent" : "turn-arrow-bottom turn-arrow-player"}`}
                aria-hidden="true"
              />
              {renderField("P2", true)}
              <div
                className={`board-center-strip ${
                  timeControlPlayerId === "P2" ? "board-center-strip-opponent-turn" : "board-center-strip-player-turn"
                }`}
              >
                <div
                  className={`center-clock ${timeControlPlayerId === "P1" ? "center-clock-active-player" : ""} ${
                    p1ClockSeconds <= LOW_TIME_WARNING_SECONDS ? "center-clock-low-time" : ""
                  }`}
                >
                  P1 {formatClock(p1ClockSeconds)}
                </div>
                <div className="center-turn-meta">
                  Turn <strong>{snapshot.match.turnNumber}</strong> - <strong>{snapshot.match.activePlayerId}</strong>'s turn
                </div>
                <div
                  className={`center-clock ${timeControlPlayerId === "P2" ? "center-clock-active-opponent" : ""} ${
                    p2ClockSeconds <= LOW_TIME_WARNING_SECONDS ? "center-clock-low-time" : ""
                  }`}
                >
                  P2 {formatClock(p2ClockSeconds)}
                </div>
              </div>
              {renderField("P1", false)}
            </section>
            {renderHand("P1", "hand-ui")}

            <details className="console-disclosure">
              <summary>Game State Console</summary>
              <section className="console-window" aria-label="Game state console output">
                <pre>{formatSnapshot(snapshot)}</pre>
              </section>
            </details>
          </>
        )}
      </section>

      <section className="action-panels">
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
        {renderActionPanel("P2", "P2 Actions", "action-panel action-panel-top")}
        {renderActionPanel("P1", "P1 Actions", "action-panel")}
        <aside
          className={`combat-preview-panel ${combatPreview.attackerPlayerId === "P2" ? "combat-preview-panel-top" : ""}`}
          aria-label="Combat preview"
        >
          <h2>Combat Preview</h2>
          {combatPreview.show ? (
            <div className="combat-preview-grid">
              <div className={`combat-preview-card ${combatPreview.attacker?.playerId === "P2" ? "combat-preview-card-top" : ""}`}>
                <h3>Attacker</h3>
                {combatPreview.attacker ? (
                  <>
                    <img
                      src={combatPreview.attacker.artUrl}
                      alt={combatPreview.attacker.name}
                      className="combat-preview-art"
                      onError={onCardArtError}
                    />
                    <div className="combat-preview-card-name">{combatPreview.attacker.name}</div>
                    <div className="combat-preview-power">Power: {combatPreview.attacker.power ?? "-"}</div>
                  </>
                ) : (
                  <div className="combat-preview-empty">No attacker selected.</div>
                )}
              </div>
              <div className={`combat-preview-card ${combatPreview.defender?.playerId === "P2" ? "combat-preview-card-top" : ""}`}>
                <h3>Defender</h3>
                {combatPreview.defender ? (
                  <>
                    <img
                      src={combatPreview.defender.artUrl}
                      alt={combatPreview.defender.name}
                      className="combat-preview-art"
                      onError={onCardArtError}
                    />
                    <div className="combat-preview-card-name">{combatPreview.defender.name}</div>
                    <div className="combat-preview-power">Power: {combatPreview.defender.power ?? "-"}</div>
                  </>
                ) : (
                  <div className="combat-preview-empty">Choose a target to attack.</div>
                )}
              </div>
            </div>
          ) : (
            <div className="action-hint">Start an attack to preview attacker and defender.</div>
          )}
          {canConfirmAttack ? (
            <button className="combat-preview-confirm" onClick={handleConfirmAttack}>
              Confirm Attack
            </button>
          ) : null}
        </aside>
      </section>
      {pendingStartMode ? (
        <div className="match-restart-modal-backdrop" role="presentation">
          <section className="match-restart-modal" role="dialog" aria-modal="true" aria-label="Confirm match restart">
            <h2>Quit Match?</h2>
            <p>Starting a new match will end the current one immediately.</p>
            <div className="match-restart-modal-actions">
              <button onClick={() => setPendingStartMode(null)}>Cancel</button>
              <button onClick={confirmQuitAndStart}>Quit Match</button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

export default App;
