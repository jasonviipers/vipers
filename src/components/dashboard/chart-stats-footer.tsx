interface ChartStatsFooterProps {
  avg: number;
  peak: number;
  trendPct: number;
}

/**
 * PEAK / AVG / TREND readout shared by the signal and trades activity charts.
 */
export function ChartStatsFooter({
  avg,
  peak,
  trendPct,
}: ChartStatsFooterProps) {
  return (
    <div className="mt-2 flex items-center justify-end gap-4 text-xs">
      <span className="text-muted-foreground">
        PEAK <span className="font-bold text-terminal-cyan">{peak}</span>
      </span>
      <span className="text-muted-foreground">
        AVG <span className="font-bold text-foreground">{avg.toFixed(1)}</span>
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
  );
}
