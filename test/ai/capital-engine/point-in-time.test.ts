import { describe, expect, it } from "bun:test";

import {
  createPitDataset,
  hashPitDataset,
  PitLeakageError,
  type PitPoint,
  type PitSentimentObservation,
  pitBarAt,
  pitBarsFromSimulationBars,
  pitSentimentFromObservations,
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

describe("pitSentimentFromObservations — news/sentiment axis", () => {
  const DAY = 24 * HOUR;

  function obs(
    id: string,
    fetchedAtMs: number,
    vaderCompound: number,
    source: "news" | "reddit" = "reddit",
  ): PitSentimentObservation {
    return { externalId: id, fetchedAtMs, source, vaderCompound };
  }

  /** Non-null view of a built sentiment dataset (throws instead of `!`). */
  function mustPit(
    dataset: ReturnType<typeof pitSentimentFromObservations>,
  ): NonNullable<ReturnType<typeof pitSentimentFromObservations>> {
    if (!dataset) {
      throw new Error("expected a dataset, got null");
    }
    return dataset;
  }

  it("stamps observations at their fetchedAt — the observation time", () => {
    const dataset = mustPit(
      pitSentimentFromObservations("BTC", [
        obs("r1", T0, 0.6),
        obs("n1", T0 + HOUR, -0.2, "news"),
      ]),
    );
    expect(dataset.points.map((p) => p.asOf)).toEqual([T0, T0 + HOUR]);
    expect(pitValueAt(dataset, T0 + HOUR - 1).value.redditCount).toBe(1);
    expect(pitValueAt(dataset, T0 + HOUR - 1).value.newsCount).toBe(0);
    expect(pitValueAt(dataset, T0 + HOUR).value.newsCount).toBe(1);
  });

  it("aggregates with the live tool's count-weighted unit-scale formula", () => {
    // 3 reddit posts at compound +0.6 → unit 0.8; 1 news item at 0.0 → 0.5.
    // Combined = (0.8*3 + 0.5*1) / 4 = 0.725 — exactly fetchMarketSignals.
    const dataset = mustPit(
      pitSentimentFromObservations("BTC", [
        obs("a", T0, 0.6),
        obs("b", T0, 0.6),
        obs("c", T0, 0.6),
        obs("d", T0, 0, "news"),
      ]),
    );
    const value = pitValueAt(dataset, T0).value;
    expect(value.redditCount).toBe(3);
    expect(value.newsCount).toBe(1);
    expect(value.socialVolume).toBe(4);
    expect(value.sentimentScore).toBe(0.725);
  });

  it("batches same-stamp arrivals into one point (strictly ascending stamps)", () => {
    // 50 messages fetched in one scrape pass share one fetchedAt stamp —
    // 50 points at the same stamp would be rejected by createPitDataset.
    const arrivals = Array.from({ length: 50 }, (_, i) =>
      obs(`m${i}`, T0, 0.1),
    );
    const dataset = mustPit(pitSentimentFromObservations("BTC", arrivals));
    expect(dataset.points).toHaveLength(1);
    expect(dataset.points[0].value.socialVolume).toBe(50);
  });

  it("ages observations out of the trailing window — a real step function", () => {
    // One burst at T0, one at T0 + 8d (outside the 7d window of the burst).
    const dataset = mustPit(
      pitSentimentFromObservations("BTC", [
        obs("old", T0, 0.9),
        obs("new", T0 + 8 * DAY, -0.5),
      ]),
    );
    expect(pitValueAt(dataset, T0 + DAY).value.socialVolume).toBe(1);
    // At the 8d stamp the burst has aged out: only the new observation counts.
    const later = pitValueAt(dataset, T0 + 8 * DAY).value;
    expect(later.socialVolume).toBe(1);
    expect(later.redditCount).toBe(1);
    expect(later.sentimentScore).toBe(0.25); // compound −0.5 → unit 0.25
  });

  it("dedupes repeated observations of the same message", () => {
    const dataset = mustPit(
      pitSentimentFromObservations("BTC", [
        obs("dup", T0, 0.5),
        obs("dup", T0 + HOUR, 0.5), // re-scraped, same id
      ]),
    );
    expect(dataset.points).toHaveLength(1);
    expect(dataset.points[0].value.socialVolume).toBe(1);
  });

  it("returns null for an empty archive — callers refuse, never fabricate", () => {
    expect(pitSentimentFromObservations("BTC", [])).toBeNull();
  });

  it("rejects observations with invalid stamps", () => {
    expect(() =>
      pitSentimentFromObservations("BTC", [obs("bad", Number.NaN, 0)]),
    ).toThrow(/invalid fetchedAt/);
  });

  it("hashes consistently with the rest of the PIT contract", () => {
    const a = mustPit(pitSentimentFromObservations("BTC", [obs("x", T0, 0.3)]));
    const b = mustPit(pitSentimentFromObservations("BTC", [obs("x", T0, 0.3)]));
    expect(hashPitDataset(a)).toBe(hashPitDataset(b));
  });
});
