import { describe, expect, it } from "bun:test";

import {
  replayOrders,
  type SimulationBar,
  simulateOrder,
} from "@/ai/capital-engine/simulation";

const bars: SimulationBar[] = [
  {
    ask: 101,
    bid: 99,
    close: 100,
    high: 102,
    low: 98,
    open: 100,
    timestamp: "2027-01-01T00:00:00.000Z",
    volume: 10,
  },
  {
    ask: 111,
    bid: 109,
    close: 110,
    high: 112,
    low: 108,
    open: 110,
    timestamp: "2027-01-01T00:01:00.000Z",
    volume: 4,
  },
];

const config = {
  feeBps: 10,
  latencyBars: 1,
  maxParticipationRate: 0.5,
  slippageBps: 10,
};

describe("capital simulation", () => {
  it("models latency, ask-side slippage, fees, and partial fills", () => {
    const fill = simulateOrder(
      bars,
      {
        direction: "LONG",
        quantity: 5,
        submittedAt: bars[0].timestamp,
      },
      config,
    );
    expect(fill.status).toBe("PARTIAL");
    expect(fill.filledQuantity).toBe(2);
    expect(fill.fillPrice).toBeCloseTo(111.111);
    expect(fill.fee).toBeGreaterThan(0);
  });

  it("is deterministic for repeated replays", () => {
    const order = {
      direction: "SHORT" as const,
      quantity: 1,
      submittedAt: bars[0].timestamp,
    };
    expect(replayOrders(bars, [order], config)).toEqual(
      replayOrders(bars, [order], config),
    );
  });

  it("rejects an order when latency exceeds available data", () => {
    const fill = simulateOrder(
      bars,
      {
        direction: "LONG",
        quantity: 1,
        submittedAt: bars[1].timestamp,
      },
      config,
    );
    expect(fill.status).toBe("REJECTED");
    expect(fill.filledQuantity).toBe(0);
  });
});
