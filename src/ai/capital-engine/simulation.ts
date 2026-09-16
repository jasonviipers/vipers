export interface SimulationBar {
  ask: number;
  bid: number;
  close: number;
  high: number;
  low: number;
  open: number;
  timestamp: string;
  volume: number;
}

export interface SimulationOrder {
  direction: "LONG" | "SHORT";
  limitPrice?: number;
  quantity: number;
  submittedAt: string;
}

export interface SimulationConfig {
  feeBps: number;
  latencyBars: number;
  maxParticipationRate: number;
  slippageBps: number;
}

export interface SimulationFill {
  fee: number;
  fillPrice: number;
  filledQuantity: number;
  orderTimestamp: string;
  status: "FILLED" | "PARTIAL" | "REJECTED";
}

function assertFinitePositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be finite and non-negative`);
  }
}

export function simulateOrder(
  bars: SimulationBar[],
  order: SimulationOrder,
  config: SimulationConfig,
): SimulationFill {
  if (bars.length === 0) {
    return {
      fee: 0,
      fillPrice: 0,
      filledQuantity: 0,
      orderTimestamp: order.submittedAt,
      status: "REJECTED",
    };
  }
  assertFinitePositive("order quantity", order.quantity);
  assertFinitePositive("fee bps", config.feeBps);
  assertFinitePositive("slippage bps", config.slippageBps);
  if (!(config.maxParticipationRate > 0 && config.maxParticipationRate <= 1)) {
    throw new Error("max participation rate must be in (0, 1]");
  }
  if (!Number.isInteger(config.latencyBars) || config.latencyBars < 0) {
    throw new Error("latency bars must be a non-negative integer");
  }

  const index = bars.findIndex((bar) => bar.timestamp >= order.submittedAt);
  const fillBar = bars[index + config.latencyBars];
  if (!fillBar) {
    return {
      fee: 0,
      fillPrice: 0,
      filledQuantity: 0,
      orderTimestamp: order.submittedAt,
      status: "REJECTED",
    };
  }

  const availableQuantity = fillBar.volume * config.maxParticipationRate;
  const filledQuantity = Math.min(order.quantity, availableQuantity);
  if (!(filledQuantity > 0)) {
    return {
      fee: 0,
      fillPrice: 0,
      filledQuantity: 0,
      orderTimestamp: fillBar.timestamp,
      status: "REJECTED",
    };
  }

  const directionFactor = order.direction === "LONG" ? 1 : -1;
  const slippageFactor = 1 + (directionFactor * config.slippageBps) / 10_000;
  const marketPrice = order.direction === "LONG" ? fillBar.ask : fillBar.bid;
  const fillPrice = Number((marketPrice * slippageFactor).toFixed(8));
  if (order.limitPrice !== undefined) {
    const crossesLimit =
      order.direction === "LONG"
        ? fillPrice <= order.limitPrice
        : fillPrice >= order.limitPrice;
    if (!crossesLimit) {
      return {
        fee: 0,
        fillPrice: 0,
        filledQuantity: 0,
        orderTimestamp: fillBar.timestamp,
        status: "REJECTED",
      };
    }
  }

  const notional = fillPrice * filledQuantity;
  const fee = Number(((notional * config.feeBps) / 10_000).toFixed(8));
  return {
    fee,
    fillPrice,
    filledQuantity,
    orderTimestamp: fillBar.timestamp,
    status: filledQuantity < order.quantity ? "PARTIAL" : "FILLED",
  };
}

export function replayOrders(
  bars: SimulationBar[],
  orders: SimulationOrder[],
  config: SimulationConfig,
): SimulationFill[] {
  return orders.map((order) => simulateOrder(bars, order, config));
}
