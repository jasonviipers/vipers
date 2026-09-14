"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { LightweightTimeSeriesChart } from "@/components/charts/lightweight-time-series-chart";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fmtDollar, fmtPnl } from "@/lib/format";
import {
  type ClosedPosition,
  closedPositionsQueries,
  type OpenPosition,
  openPositionsQueries,
} from "@/lib/queries/positions";
import { statusQueries } from "@/lib/queries/status";

// -- helpers ----------------------------------------------------------------

type Tab = "OPEN" | "CLOSED";

/** Unified table row so OPEN and CLOSED positions share one renderer. */
interface PositionRow {
  id: string;
  asset: string;
  direction: OpenPosition["direction"];
  agentName: string;
  entryPrice: number;
  /** Open: live mark from the price cache. Closed: derived exit mark. */
  markPrice: number | null;
  quantity: number;
  pnl: number;
  pnlPct: number;
  openedAt: string;
  closedAt?: string;
}

function openToRow(pos: OpenPosition): PositionRow {
  return {
    agentName: pos.agentName,
    asset: pos.asset,
    direction: pos.direction,
    entryPrice: pos.entryPrice,
    id: pos.id,
    markPrice: pos.currentPrice,
    openedAt: pos.openedAt,
    pnl: pos.pnl,
    pnlPct: pos.pnlPct,
    quantity: pos.quantity,
  };
}

function closedToRow(pos: ClosedPosition): PositionRow {
  return {
    agentName: pos.agentName,
    asset: pos.asset,
    closedAt: pos.closedAt,
    direction: pos.direction,
    entryPrice: pos.entryPrice,
    id: pos.id,
    markPrice: pos.exitPrice,
    openedAt: pos.openedAt,
    pnl: pos.pnl,
    pnlPct: pos.pnlPct,
    quantity: pos.quantity,
  };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
  });
}

function PnlText({ value, bold = true }: { value: number; bold?: boolean }) {
  return (
    <span
      className={`${bold ? "font-bold " : ""}${
        value >= 0 ? "text-terminal-green" : "text-terminal-red"
      }`}
    >
      {fmtPnl(value)}
    </span>
  );
}

function DirectionBadge({
  direction,
}: {
  direction: PositionRow["direction"];
}) {
  return (
    <span
      className={`px-1.5 py-0.5 text-[10px] font-bold ${
        direction === "LONG"
          ? "bg-terminal-green/10 text-terminal-green"
          : "bg-terminal-red/10 text-terminal-red"
      }`}
    >
      {direction}
    </span>
  );
}

// -- Position row -----------------------------------------------------------

function PositionTableRow({ pos, tab }: { pos: PositionRow; tab: Tab }) {
  return (
    <tr className="border-b border-border/50 text-xs transition-colors hover:bg-secondary/30">
      <td className="px-3 py-2.5 font-bold text-foreground sm:px-4">
        {pos.asset}
      </td>
      <td className="px-3 py-2.5 sm:px-4">
        <DirectionBadge direction={pos.direction} />
      </td>
      <td className="px-3 py-2.5 text-right text-muted-foreground sm:px-4">
        {fmtDollar(pos.entryPrice)}
      </td>
      <td className="px-3 py-2.5 text-right text-foreground sm:px-4">
        {pos.markPrice !== null ? fmtDollar(pos.markPrice) : "—"}
      </td>
      <td className="px-3 py-2.5 text-right text-muted-foreground sm:px-4">
        {pos.quantity}
      </td>
      <td className="px-3 py-2.5 text-right sm:px-4">
        <PnlText value={pos.pnl} />
      </td>
      <td
        className={`px-3 py-2.5 text-right sm:px-4 ${
          pos.pnlPct >= 0 ? "text-terminal-green" : "text-terminal-red"
        }`}
      >
        {pos.pnlPct >= 0 ? "+" : ""}
        {pos.pnlPct.toFixed(2)}%
      </td>
      <td className="px-3 py-2.5 text-[10px] text-terminal-cyan sm:px-4">
        {pos.agentName}
      </td>
      <td className="hidden px-4 py-2.5 text-[10px] whitespace-nowrap text-muted-foreground lg:table-cell">
        <time dateTime={pos.openedAt} suppressHydrationWarning>
          {formatDate(pos.openedAt)}
        </time>
      </td>
      {tab === "CLOSED" && (
        <td className="hidden px-4 py-2.5 text-[10px] whitespace-nowrap text-muted-foreground lg:table-cell">
          {pos.closedAt ? (
            <time dateTime={pos.closedAt} suppressHydrationWarning>
              {formatDate(pos.closedAt)}
            </time>
          ) : (
            "—"
          )}
        </td>
      )}
    </tr>
  );
}

function TableSkeleton({ cols }: { cols: number }) {
  return (
    <>
      {[0, 1, 2, 3, 4].map((i) => (
        <tr key={i} className="border-b border-border/50">
          <td colSpan={cols} className="px-4 py-2.5">
            <div className="h-4 animate-pulse bg-secondary" />
          </td>
        </tr>
      ))}
    </>
  );
}

// -- Main view --------------------------------------------------------------

export function PositionsView() {
  const [tab, setTab] = useState<Tab>("OPEN");

  const {
    data: openData,
    isError: openError,
    isPending: openPending,
  } = useQuery(openPositionsQueries.list());
  const {
    data: closedData,
    isError: closedError,
    isPending: closedPending,
  } = useQuery(closedPositionsQueries.list());
  const { data: status } = useQuery(statusQueries.summary());

  const rows = useMemo(() => {
    if (tab === "OPEN") {
      return (openData?.items ?? []).map(openToRow);
    }
    return (closedData?.items ?? []).map(closedToRow);
  }, [tab, openData, closedData]);
  const isError = tab === "OPEN" ? openError : closedError;
  const isPending = tab === "OPEN" ? openPending : closedPending;

  const netPnl = useMemo(
    () => rows.reduce((sum, pos) => sum + pos.pnl, 0),
    [rows],
  );
  const openCount = openData?.items.length ?? 0;
  const closedCount = closedData?.items.length ?? 0;

  // P&L curve from portfolio snapshots, rebased to the first snapshot so the
  // line reads as P&L change over the window rather than absolute capital.
  const pnlData = useMemo(() => {
    const equity = status?.portfolio.equityHistory ?? [];
    const baseline = equity[0]?.totalCapital ?? 0;
    return equity.map((point, index) => ({
      time: (index + 1) as number,
      value: point.totalCapital - baseline,
    }));
  }, [status?.portfolio.equityHistory]);

  const columnCount = tab === "OPEN" ? 9 : 10;

  return (
    <div className="flex h-full flex-col">
      <h1 className="sr-only">Trading Positions</h1>

      {/* P&L chart */}
      <div className="border-b border-border bg-card p-3 sm:p-4">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs font-bold tracking-wider text-foreground">
            P&L CURVE
          </span>
          <div className="flex items-center gap-4 text-xs">
            <span className="text-muted-foreground">
              TOTAL{" "}
              {status ? (
                <PnlText value={status.portfolio.totalPnl} />
              ) : (
                <span className="font-bold text-muted-foreground">—</span>
              )}
            </span>
            <span className="text-muted-foreground">
              TODAY{" "}
              {status ? (
                <PnlText value={status.portfolio.dailyPnl} />
              ) : (
                <span className="font-bold text-muted-foreground">—</span>
              )}
            </span>
          </div>
        </div>
        {pnlData.length >= 2 ? (
          <LightweightTimeSeriesChart
            type="area"
            data={pnlData}
            color="#00d4aa"
            areaTopColor="#00d4aa33"
            areaBottomColor="#00d4aa00"
            height={144}
            valueFormat={(value) => fmtPnl(value)}
          />
        ) : (
          <div
            className="flex items-center justify-center border border-dashed border-border text-xs text-terminal-dim"
            style={{ height: 144 }}
          >
            NO SNAPSHOTS YET — the curve fills in as the portfolio runs
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-px border-b border-border bg-card px-4">
        {(["OPEN", "CLOSED"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-xs tracking-wider transition-colors ${
              tab === t
                ? "border-b-2 border-terminal-green text-terminal-green"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t} ({t === "OPEN" ? openCount : closedCount})
          </button>
        ))}
        <div className="ml-auto flex items-center gap-4 text-xs">
          <span className="text-muted-foreground">
            NET P&L <PnlText value={netPnl} />
          </span>
        </div>
      </div>

      {/* Positions table */}
      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="overflow-x-auto">
            <table className="w-full min-w-180">
              <caption className="sr-only">
                {tab === "OPEN"
                  ? "Open trading positions with entry price, current price, quantity, and unrealized profit/loss"
                  : "Closed trading positions with entry price, exit price, quantity, and realized profit/loss"}
              </caption>
              <thead className="sticky top-0 z-10 bg-card">
                <tr className="border-b border-border text-[10px] text-muted-foreground">
                  <th
                    scope="col"
                    className="px-3 py-2 text-left font-normal tracking-wider sm:px-4"
                  >
                    ASSET
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2 text-left font-normal tracking-wider sm:px-4"
                  >
                    DIR
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2 text-right font-normal tracking-wider sm:px-4"
                  >
                    ENTRY
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2 text-right font-normal tracking-wider sm:px-4"
                  >
                    {tab === "OPEN" ? "CURRENT" : "EXIT"}
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2 text-right font-normal tracking-wider sm:px-4"
                  >
                    QTY
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2 text-right font-normal tracking-wider sm:px-4"
                  >
                    P&L
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2 text-right font-normal tracking-wider sm:px-4"
                  >
                    P&L%
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2 text-left font-normal tracking-wider sm:px-4"
                  >
                    AGENT
                  </th>
                  <th
                    scope="col"
                    className="hidden px-4 py-2 text-left font-normal tracking-wider lg:table-cell"
                  >
                    OPENED
                  </th>
                  {tab === "CLOSED" && (
                    <th
                      scope="col"
                      className="hidden px-4 py-2 text-left font-normal tracking-wider lg:table-cell"
                    >
                      CLOSED
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {isPending ? (
                  <TableSkeleton cols={columnCount} />
                ) : isError ? (
                  <tr>
                    <td
                      colSpan={columnCount}
                      className="px-4 py-3 text-xs text-terminal-red"
                    >
                      POSITIONS DATA UNAVAILABLE — retrying
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={columnCount}
                      className="px-4 py-3 text-xs text-terminal-dim"
                    >
                      {tab === "OPEN"
                        ? "NO OPEN POSITIONS — approved proposals will appear here"
                        : "NO CLOSED TRADES YET — history appears when positions are closed"}
                    </td>
                  </tr>
                ) : (
                  rows.map((pos) => (
                    <PositionTableRow key={pos.id} pos={pos} tab={tab} />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
