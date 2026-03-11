import type { GameState, PlayerId, ReadableSnapshot } from "./types";
import { getCardArtUrlForCard, getCardCounter, getCardCost, getCardKeywords, getCardPower } from "./cardCatalog";

export const toReadableSnapshot = (state: GameState): ReadableSnapshot => {
  const active = state.players[state.activePlayerId];
  const playerSummary = (id: PlayerId) => {
    const p = state.players[id];
    return {
      playerId: p.id,
      name: p.name,
      active: state.activePlayerId === p.id,
      leaderPower: getCardPower(state, p.leader),
      leaderArtUrl: getCardArtUrlForCard(state, p.leader, "medium"),
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
      cost: getCardCost(state, c),
      power: getCardPower(state, c),
      artUrl: getCardArtUrlForCard(state, c, "medium"),
      rested: c.rested,
      summoningSick: c.summoningSick ?? false,
      hasBlocker: getCardKeywords(state, c).includes("BLOCKER")
    }));

  const donRows = (id: PlayerId) => {
    const p = state.players[id];
    return [
      ...p.donActive.map((d) => ({ id: d.id, rested: false })),
      ...p.donRested.map((d) => ({ id: d.id, rested: true }))
    ];
  };

  const handRows = (id: PlayerId) =>
    state.players[id].hand.map((card, i) => ({
      handIndex: i,
      id: card.instanceId,
      name: card.name,
      type: card.type,
      cost: getCardCost(state, card),
      power: getCardPower(state, card),
      counter: getCardCounter(state, card),
      artUrl: getCardArtUrlForCard(state, card, "medium"),
      hasBlocker: getCardKeywords(state, card).includes("BLOCKER")
    }));

  const trashTop = (id: PlayerId) => {
    const pile = state.players[id].trash;
    const card = pile.length > 0 ? pile[pile.length - 1] : null;
    if (!card) return null;
    return {
      id: card.instanceId,
      name: card.name,
      artUrl: getCardArtUrlForCard(state, card, "medium")
    };
  };

  return {
    match: {
      id: state.id,
      status: state.status,
      turnNumber: state.turnNumber,
      phase: state.phase,
      activePlayerId: state.activePlayerId,
      firstPlayerId: state.firstPlayerId,
      combatStatus: state.combat.status
    },
    players: [playerSummary("P1"), playerSummary("P2")],
    activeHand: active.hand.map((card, i) => ({
      handIndex: i,
      id: card.instanceId,
      name: card.name,
      type: card.type,
      cost: getCardCost(state, card),
      power: getCardPower(state, card),
      counter: getCardCounter(state, card),
      artUrl: getCardArtUrlForCard(state, card, "medium"),
      hasBlocker: getCardKeywords(state, card).includes("BLOCKER")
    })),
    p1Hand: handRows("P1"),
    p2Hand: handRows("P2"),
    p1Characters: charRows("P1"),
    p2Characters: charRows("P2"),
    p1Don: donRows("P1"),
    p2Don: donRows("P2"),
    p1TrashTop: trashTop("P1"),
    p2TrashTop: trashTop("P2"),
    legalActionsByPlayer: {
      P1: state.legalActions.P1.map((a) => a.type),
      P2: state.legalActions.P2.map((a) => a.type)
    },
    pendingPrompt: state.pendingPrompt,
    currentAttack: state.combat.attack,
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
