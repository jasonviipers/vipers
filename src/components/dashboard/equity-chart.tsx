"use client";

import { useQuery } from "@tanstack/react-query";
import { useColorScheme } from "@/context/color-scheme-context";
import { fmtDollar } from "@/lib/format";
import { statusQueries } from "@/lib/queries/status";

const WIDTH = 560;
const HEIGHT = 208;
const PADDING = 4;

interface Point {
  totalCapital: number;
}

interface EquityStats {
  peak: number;
  avg: number;
  trendPct: number;
}

interface EquityCoords {
  x: number;
  y: number;
}

function computeStats(points: Point[]): EquityStats {
  if (points.length < 2) return { peak: 0, avg: 0, trendPct: 0 };
  const values = points.map((pt) => pt.totalCapital);
  const peak = Math.max(...values);
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  const first = values[0];
  const trendPct =
    first > 0 ? ((values[values.length - 1] - first) / first) * 100 : 0;
  return { peak, avg, trendPct };
}

function computeCoords(points: Point[]): EquityCoords[] {
  if (points.length < 2) return [];
  const values = points.map((pt) => pt.totalCapital);
  const min = Math.min(...values);
  const range = Math.max(...values) - min || 1;
  return points.map((pt, i) => ({
    x: PADDING + (i / (points.length - 1)) * (WIDTH - PADDING * 2),
    y:
      HEIGHT -
      PADDING -
      ((pt.totalCapital - min) / range) * (HEIGHT - PADDING * 2),
  }));
}

function buildLinePath(coords: EquityCoords[]): string {
  return coords
    .map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
    .join(" ");
}

function buildAreaPath(coords: EquityCoords[], linePath: string): string {
  if (coords.length === 0) return "";
  return `${linePath} L${coords[coords.length - 1].x.toFixed(1)},${HEIGHT} L${coords[0].x.toFixed(1)},${HEIGHT} Z`;
}

function PendingState() {
  return (
    <div
      className="animate-pulse bg-secondary"
      style={{ height: HEIGHT }}
      aria-hidden
    />
  );
}

function ErrorState() {
  return (
    <div
      className="flex items-center justify-center border border-terminal-red/30 bg-terminal-red/5 text-xs text-terminal-red"
      style={{ height: HEIGHT }}
    >
      EQUITY DATA UNAVAILABLE — retrying
    </div>
  );
}

function EmptyState() {
  return (
    <div
      className="flex items-center justify-center border border-dashed border-border px-4 text-center text-xs text-terminal-dim"
      style={{ height: HEIGHT }}
    >
      NO SNAPSHOTS YET — rollups appear as the portfolio runs
    </div>
  );
}

function ChartSvg({
  accentColor,
  coords,
  linePath,
  areaPath,
  points,
  trendPct,
}: {
  accentColor: string;
  coords: EquityCoords[];
  linePath: string;
  areaPath: string;
  points: Point[];
  trendPct: number;
}) {
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="w-full"
      style={{ height: HEIGHT }}
      role="img"
      aria-label={`Equity curve from ${points.length} snapshots, trend ${trendPct.toFixed(1)} percent`}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="equity-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={`${accentColor}4d`} />
          <stop offset="100%" stopColor={`${accentColor}00`} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#equity-fill)" />
      <path
        d={linePath}
        fill="none"
        stroke={accentColor}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={coords[coords.length - 1].x}
        cy={coords[coords.length - 1].y}
        r="3"
        fill={accentColor}
      />
    </svg>
  );
}

function ChartStats({ peak, avg, trendPct }: EquityStats) {
  return (
    <div className="mt-2 flex items-center justify-end gap-4 text-xs">
      <span className="text-muted-foreground">
        PEAK{" "}
        <span className="font-bold text-terminal-green">{fmtDollar(peak)}</span>
      </span>
      <span className="text-muted-foreground">
        AVG <span className="font-bold text-foreground">{fmtDollar(avg)}</span>
      </span>
      <span className="text-muted-foreground">
        TREND{" "}
        <span
          className={`font-bold ${trendPct >= 0 ? "text-terminal-green" : "text-terminal-red"}`}
        >
          {trendPct >= 0 ? "+" : ""}
          {trendPct.toFixed(1)}%
        </span>
      </span>
    </div>
  );
}

export function EquityChart() {
  const { definition } = useColorScheme();
  const accentColor = definition.colors.green;
  const { data, isError, isPending } = useQuery(statusQueries.summary());
  const points = data?.portfolio.equityHistory ?? [];

  const hasData = points.length >= 2;
  const stats = computeStats(points);
  const coords = computeCoords(points);
  const linePath = buildLinePath(coords);
  const areaPath = buildAreaPath(coords, linePath);

  return (
    <section
      aria-label="Equity curve chart"
      className="flex flex-col border border-border bg-card"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <h2 className="text-xs font-bold tracking-wider text-foreground">
          EQUITY CURVE
        </h2>
        <span className="text-xs text-terminal-green">
          {isPending ? "--" : fmtDollar(stats.peak)}
        </span>
      </div>
      <div className="p-4">
        {isPending ? (
          <PendingState />
        ) : isError ? (
          <ErrorState />
        ) : !hasData ? (
          <EmptyState />
        ) : (
          <ChartSvg
            accentColor={accentColor}
            coords={coords}
            linePath={linePath}
            areaPath={areaPath}
            points={points}
            trendPct={stats.trendPct}
          />
        )}
        <ChartStats
          peak={stats.peak}
          avg={stats.avg}
          trendPct={stats.trendPct}
        />
      </div>
    </section>
  );
}
