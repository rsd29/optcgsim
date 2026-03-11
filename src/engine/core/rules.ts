import type { AbilityDefinition, CardInstance, ConditionDefinition, CostDefinition, GameState, PlayerId } from "../../game/types";
import { getCardKeywords } from "../../game/cardCatalog";

export type RuleEvaluationContext = {
  state: GameState;
  sourceCard?: CardInstance;
  controllerPlayerId: PlayerId;
};

export const evaluateCondition = (ctx: RuleEvaluationContext, condition: ConditionDefinition): boolean => {
  switch (condition.type) {
    case "SOURCE_HAS_KEYWORD": {
      const keyword = condition.params?.keyword;
      if (!ctx.sourceCard || typeof keyword !== "string") return false;
      return getCardKeywords(ctx.state, ctx.sourceCard).includes(keyword as never);
    }
    case "PLAYER_HAS_ACTIVE_DON_AT_LEAST": {
      const min = condition.params?.min;
      if (typeof min !== "number") return false;
      return ctx.state.players[ctx.controllerPlayerId].donActive.length >= min;
    }
    default:
      return true;
  }
};

export const evaluateConditions = (ctx: RuleEvaluationContext, conditions: ConditionDefinition[] = []): boolean =>
  conditions.every((condition) => evaluateCondition(ctx, condition));

export const canPayCost = (ctx: RuleEvaluationContext, cost: CostDefinition): boolean => {
  const player = ctx.state.players[ctx.controllerPlayerId];
  switch (cost.type) {
    case "REST_DON": {
      const amount = Number(cost.params?.amount ?? 0);
      return player.donActive.length >= amount;
    }
    case "TRASH_HAND_CARD": {
      const amount = Number(cost.params?.amount ?? 1);
      return player.hand.length >= amount;
    }
    default:
      return true;
  }
};

export const canPayAllCosts = (ctx: RuleEvaluationContext, costs: CostDefinition[] = []): boolean =>
  costs.every((cost) => canPayCost(ctx, cost));

export const payCost = (ctx: RuleEvaluationContext, cost: CostDefinition): boolean => {
  const player = ctx.state.players[ctx.controllerPlayerId];
  switch (cost.type) {
    case "REST_DON": {
      const amount = Number(cost.params?.amount ?? 0);
      if (player.donActive.length < amount) return false;
      for (let i = 0; i < amount; i += 1) {
        const don = player.donActive.shift();
        if (don) player.donRested.push(don);
      }
      return true;
    }
    case "TRASH_HAND_CARD": {
      const amount = Number(cost.params?.amount ?? 1);
      if (player.hand.length < amount) return false;
      for (let i = 0; i < amount; i += 1) {
        const card = player.hand.shift();
        if (card) player.trash.push(card);
      }
      return true;
    }
    default:
      return true;
  }
};

export const payAllCosts = (ctx: RuleEvaluationContext, costs: CostDefinition[] = []): boolean => {
  if (!canPayAllCosts(ctx, costs)) return false;
  for (const cost of costs) {
    const ok = payCost(ctx, cost);
    if (!ok) return false;
  }
  return true;
};

export const canUseAbility = (ctx: RuleEvaluationContext, ability: AbilityDefinition): boolean => {
  if (!evaluateConditions(ctx, ability.conditions)) return false;
  if (!canPayAllCosts(ctx, ability.costs)) return false;
  return true;
};
