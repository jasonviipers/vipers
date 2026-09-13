"use client";

import { useQuery } from "@tanstack/react-query";
import { useColorScheme } from "@/context/color-scheme-context";
import { fmtInt } from "@/lib/format";
import { statusQueries } from "@/lib/queries/status";

const WIDTH = 560;
const HEIGHT = 208;
const PADDING = 4;

/**
 * Equity curve card: total-capital rollups from portfolio_snapshots
 * (oldest-first, max 60 points) served by /api/status. Pure SVG area chart —
 * no chart library, theme-aware via the color-scheme context.
 */
export function EquityChart() {
  const { definition } = useColorScheme();
  const accentColor = definition.colors.green;
  const { data, isError, isPending } = useQuery(statusQueries.summary());
  const points = data?.portfolio.equityHistory ?? [];

  const hasData = points.length >= 2;
  const values = points.map((pt) => pt.totalCapital);
  const min = hasData ? Math.min(...values) : 0;
  const max = hasData ? Math.max(...values) : 0;
  const range = max - min || 1;
  const peak = hasData ? max : 0;
  const avg = hasData ? values.reduce((s, v) => s + v, 0) / values.length : 0;
  const first = hasData ? values[0] : 0;
  const last = hasData ? values[values.length - 1] : 0;
  const trendPct = first > 0 ? ((last - first) / first) * 100 : 0;

  // Normalized polyline/area coordinates (y inverted so larger = higher).
  const coords = points.map((pt, i) => ({
    x:
      points.length > 1
        ? PADDING + (i / (points.length - 1)) * (WIDTH - PADDING * 2)
        : WIDTH / 2,
    y:
      HEIGHT -
      PADDING -
      ((pt.totalCapital - min) / range) * (HEIGHT - PADDING * 2),
  }));
  const linePath = coords
    .map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
    .join(" ");
  const areaPath =
    coords.length > 0
      ? `${linePath} L${coords[coords.length - 1].x.toFixed(1)},${HEIGHT} L${coords[0].x.toFixed(1)},${HEIGHT} Z`
      : "";

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
          {isPending ? "--" : `$${fmtInt(peak)}`}
        </span>
      </div>
      <div className="p-4">
        {isPending ? (
          <div
            className="animate-pulse bg-secondary"
            style={{ height: HEIGHT }}
            aria-hidden
          />
        ) : isError ? (
          <div
            className="flex items-center justify-center border border-terminal-red/30 bg-terminal-red/5 text-xs text-terminal-red"
            style={{ height: HEIGHT }}
          >
            EQUITY DATA UNAVAILABLE — retrying
          </div>
        ) : !hasData ? (
          <div
            className="flex items-center justify-center border border-dashed border-border text-xs text-terminal-dim"
            style={{ height: HEIGHT }}
          >
            NO SNAPSHOTS YET — rollups appear as the portfolio runs
          </div>
        ) : (
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
            {/* Current-value marker at the last point */}
            <circle
              cx={coords[coords.length - 1].x}
              cy={coords[coords.length - 1].y}
              r="3"
              fill={accentColor}
            />
          </svg>
        )}
        <div className="mt-2 flex items-center justify-end gap-4 text-xs">
          <span className="text-muted-foreground">
            PEAK{" "}
            <span className="font-bold text-terminal-green">
              ${fmtInt(peak)}
            </span>
          </span>
          <span className="text-muted-foreground">
            AVG{" "}
            <span className="font-bold text-foreground">${fmtInt(avg)}</span>
          </span>
          <span className="text-muted-foreground">
            TREND{" "}
            <span
              className={`font-bold ${
                trendPct >= 0 ? "text-terminal-green" : "text-terminal-red"
              }`}
            >
              {trendPct >= 0 ? "+" : ""}
              {trendPct.toFixed(1)}%
            </span>
          </span>
        </div>
      </div>
    </section>
  );
}
