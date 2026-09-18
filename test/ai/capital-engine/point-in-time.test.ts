import { describe, expect, it } from "bun:test";

import {
  createPitDataset,
  hashPitDataset,
  PitLeakageError,
  type PitPoint,
  pitBarAt,
  pitBarsFromSimulationBars,
  pitValueAt,
} from "@/ai/capital-engine/point-in-time";
import type { SimulationBar } from "@/ai/capital-engine/simulation";

const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;

function pricePoints(
  stamps: Array<[number, number]>,
  source = "test-feed",
): Array<PitPoint<number>> {
  return stamps.map(([asOf, value]) => ({ asOf, source, value }));
}

describe("createPitDataset", () => {
  it("rejects unsorted or duplicate asOf stamps", () => {
    expect(() =>
      createPitDataset({
        asset: "BTC",
        points: pricePoints([
          [T0 + HOUR, 100],
          [T0, 90],
        ]),
      }),
    ).toThrow(/strictly ascending/);
    expect(() =>
      createPitDataset({
        asset: "BTC",
        points: pricePoints([
          [T0, 100],
          [T0, 101],
        ]),
      }),
    ).toThrow(/strictly ascending/);
  });

  it("rejects a retraction that ends before it begins and bad epochs", () => {
    expect(() =>
      createPitDataset({
        asset: "BTC",
        points: [{ asOf: T0 + HOUR, source: "s", validTo: T0, value: 1 }],
      }),
    ).toThrow(/cannot end before it begins/);
    expect(() =>
      createPitDataset({
        asset: "BTC",
        points: [{ asOf: Number.NaN, source: "s", value: 1 }],
      }),
    ).toThrow(/finite non-negative/);
    expect(() => createPitDataset({ asset: "  ", points: [] })).toThrow(
      /asset identifier/,
    );
    expect(() =>
      createPitDataset({
        asset: "BTC",
        points: [{ asOf: T0, source: " ", value: 1 }],
      }),
    ).toThrow(/requires a source/);
  });
});

describe("pitValueAt — as-of semantics", () => {
  const dataset = createPitDataset({
    asset: "BTC",
    points: pricePoints([
      [T0, 100],
      [T0 + HOUR, 110],
      [T0 + 2 * HOUR, 120],
    ]),
  });

  it("returns the latest stamp at or before the query", () => {
    expect(pitValueAt(dataset, T0).value).toBe(100);
    expect(pitValueAt(dataset, T0 + HOUR).value).toBe(110);
    expect(pitValueAt(dataset, T0 + HOUR + 1).value).toBe(110);
    expect(pitValueAt(dataset, T0 + 5 * HOUR).value).toBe(120);
  });

  it("refuses to leak data from before the dataset began", () => {
    expect(() => pitValueAt(dataset, T0 - 1)).toThrow(PitLeakageError);
  });

  it("refuses to leak into a retracted gap", () => {
    const retracted = createPitDataset({
      asset: "BTC",
      points: [
        { asOf: T0, source: "feed-a", validTo: T0 + HOUR, value: 100 },
        { asOf: T0 + 3 * HOUR, source: "feed-a", value: 130 },
      ],
    });
    // At the retraction boundary the old fact is gone and nothing replaced it yet.
    expect(() => pitValueAt(retracted, T0 + HOUR)).toThrow(PitLeakageError);
    expect(() => pitValueAt(retracted, T0 + 2 * HOUR)).toThrow(PitLeakageError);
    expect(pitValueAt(retracted, T0 + 3 * HOUR).value).toBe(130);
    expect(pitValueAt(retracted, T0 + HOUR - 1).value).toBe(100);
  });

  it("is exactly never-newer-than for decision moments mid-bar", () => {
    // A decision at T0 + HOUR - 1 must see 100, never 110 — the classic
    // lookahead bug PIT exists to prevent.
    expect(pitValueAt(dataset, T0 + HOUR - 1).value).toBe(100);
  });
});

describe("bar conversion and hashing", () => {
  const bars: SimulationBar[] = [
    {
      ask: 101,
      bid: 99,
      close: 100,
      high: 102,
      low: 98,
      open: 100,
      timestamp: new Date(T0).toISOString(),
      volume: 10,
    },
    {
      ask: 111,
      bid: 109,
      close: 110,
      high: 112,
      low: 108,
      open: 110,
      timestamp: new Date(T0 + HOUR).toISOString(),
      volume: 20,
    },
  ];

  it("converts simulator bars into a queryable PIT dataset", () => {
    const dataset = pitBarsFromSimulationBars("BTC", bars);
    expect(pitBarAt(dataset, T0).close).toBe(100);
    expect(pitBarAt(dataset, T0 + HOUR).close).toBe(110);
    expect(() => pitBarAt(dataset, T0 - 1)).toThrow(PitLeakageError);
  });

  it("rejects bars with unreadable timestamps", () => {
    expect(() =>
      pitBarsFromSimulationBars("BTC", [
        { ...bars[0], timestamp: "not-a-date" },
      ]),
    ).toThrow(/unreadable timestamp/);
  });

  it("hashes datasets canonically — identity is content, not order of construction", () => {
    const a = createPitDataset({
      asset: "BTC",
      points: pricePoints([[T0, 100]]),
    });
    const b = createPitDataset({
      asset: "BTC",
      points: pricePoints([[T0, 100]]),
    });
    expect(hashPitDataset(a)).toBe(hashPitDataset(b));

    const changed = createPitDataset({
      asset: "BTC",
      points: pricePoints([[T0, 101]]),
    });
    expect(hashPitDataset(changed)).not.toBe(hashPitDataset(a));
  });
});
