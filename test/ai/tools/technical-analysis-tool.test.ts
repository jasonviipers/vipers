import { describe, expect, it } from "bun:test";
import {
  computeAtr,
  computeRsi,
  computeSma,
} from "@/ai/tools/technical-analysis-tool";

/**
 * Unit tests for the pure math in the technical-analysis tool. These feed
 * the ANALYSIS stage of the consensus pipeline, so a wrong RSI/trend read
 * becomes a wrong trade proposal — they must be exact.
 */
function risingCloses(n: number): number[] {
  return Array.from({ length: n }, (_, i) => 100 + i);
}

function fallingCloses(n: number): number[] {
  return Array.from({ length: n }, (_, i) => 200 - i);
}

function flatCloses(n: number): number[] {
  return Array.from({ length: n }, () => 100);
}

describe("computeSma", () => {
  it("averages the last N closes", () => {
    expect(computeSma([1, 2, 3, 4, 5], 5)).toBe(3);
    expect(computeSma([1, 2, 3, 4, 5], 2)).toBe(4.5);
    expect(computeSma([10, 20, 30, 40], 3)).toBe(30);
  });

  it("throws on insufficient history", () => {
    expect(() => computeSma([1, 2], 5)).toThrow("insufficient history for SMA");
  });
});

describe("computeRsi", () => {
  it("returns 100 for a monotonic rally (no losses)", () => {
    expect(computeRsi(risingCloses(30))).toBe(100);
  });

  it("returns 0 for a monotonic decline (no gains)", () => {
    expect(computeRsi(fallingCloses(30))).toBe(0);
  });

  it("returns 50 for flat closes (zero average gain and loss)", () => {
    expect(computeRsi(flatCloses(30))).toBe(50);
  });

  it("throws on insufficient history", () => {
    expect(() => computeRsi([1, 2, 3], 14)).toThrow(
      "insufficient history for RSI",
    );
  });
});

describe("computeAtr", () => {
  it("is zero for candles with no range", () => {
    const candles = flatCloses(20).map((close) => ({
      close,
      high: close,
      low: close,
      volume: 0,
    }));
    expect(computeAtr(candles)).toBe(0);
  });

  it("equals the constant true range for uniform candles", () => {
    // Every day: high=101, low=99, close=100 → TR = max(2, |1|, |-1|) = 2.
    const candles = Array.from({ length: 20 }, () => ({
      close: 100,
      high: 101,
      low: 99,
      volume: 0,
    }));
    expect(computeAtr(candles)).toBeCloseTo(2, 10);
  });

  it("throws on insufficient history", () => {
    const candles = [{ close: 1, high: 1, low: 1, volume: 0 }];
    expect(() => computeAtr(candles)).toThrow("insufficient history for ATR");
  });
});
