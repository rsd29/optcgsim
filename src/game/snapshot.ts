import type { GameState, PlayerId, ReadableSnapshot } from "./types";

export const toReadableSnapshot = (state: GameState): ReadableSnapshot => {
  const active = state.players[state.activePlayerId];
  const playerSummary = (id: PlayerId) => {
    const p = state.players[id];
    return {
      playerId: p.id,
      name: p.name,
      active: state.activePlayerId === p.id,
      leaderPower: p.leader.power ?? 0,
      leaderRested: p.leader.rested,
      turnsTaken: p.turnsTaken,
      life: p.life.length,
      hand: p.hand.length,
      deck: p.deck.length,
      trash: p.trash.length,
      characters: p.characterArea.length,
      donActive: p.donActive.length,
      donRested: p.donRested.length,
      donDeck: p.donDeck.length
    };
  };

  const charRows = (id: PlayerId) =>
    state.players[id].characterArea.map((c, i) => ({
      slot: i,
      id: c.instanceId,
      name: c.name,
      cost: c.cost,
      power: c.power,
      rested: c.rested,
      summoningSick: c.summoningSick ?? false
    }));

  return {
    match: {
      id: state.id,
      status: state.status,
      turnNumber: state.turnNumber,
      phase: state.phase,
      activePlayerId: state.activePlayerId,
      firstPlayerId: state.firstPlayerId
    },
    players: [playerSummary("P1"), playerSummary("P2")],
    activeHand: active.hand.map((card, i) => ({
      handIndex: i,
      id: card.instanceId,
      name: card.name,
      type: card.type,
      cost: card.cost,
      power: card.power
    })),
    p1Characters: charRows("P1"),
    p2Characters: charRows("P2"),
    currentAttack: state.currentAttack,
    recentEvents: state.log.slice(-8).map((event) => ({
      time: new Date(event.createdAt).toLocaleTimeString(),
      type: event.type,
      payload: JSON.stringify(event.payload ?? {})
    }))
  };
};

export const printSnapshotToConsole = (state: GameState, label: string): void => {
  const snapshot = toReadableSnapshot(state);
  console.group(label);
  console.log(
    "Match %s | Status %s | Turn %d | Phase %s | Active %s",
    snapshot.match.id,
    snapshot.match.status,
    snapshot.match.turnNumber,
    snapshot.match.phase,
    snapshot.match.activePlayerId
  );
  console.table(snapshot.players);
  if (snapshot.p1Characters.length > 0) {
    console.log("P1 Characters");
    console.table(snapshot.p1Characters);
  }
  if (snapshot.p2Characters.length > 0) {
    console.log("P2 Characters");
    console.table(snapshot.p2Characters);
  }
  console.log("Active player hand:");
  console.table(snapshot.activeHand);
  if (snapshot.currentAttack) {
    console.log("Pending attack:", snapshot.currentAttack);
  }
  console.log("Recent events:");
  console.table(snapshot.recentEvents);
  console.groupEnd();
};
