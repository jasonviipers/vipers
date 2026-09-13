"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { fmtDollar, fmtPnl } from "@/lib/format";
import { openPositionsQueries } from "@/lib/queries/positions";

export function PositionsTable() {
  const { data, isError, isPending } = useQuery(openPositionsQueries.list());

  const openPositions = data?.items ?? [];

  return (
    <section
      aria-label="Open positions"
      className="flex shrink-0 flex-col border border-border bg-card"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <Tooltip>
          <TooltipTrigger
            render={
              <h2 className="text-xs font-bold tracking-wider text-foreground cursor-help">
                OPEN POSITIONS
              </h2>
            }
          />
          <TooltipContent
            side="bottom"
            sideOffset={6}
            className="bg-card text-muted-foreground border border-border text-xs max-w-64"
          >
            Currently active positions across all agents with entry prices,
            current values, and unrealized P&L
          </TooltipContent>
        </Tooltip>
        <span className="text-xs text-terminal-green">
          {isPending ? "..." : `${openPositions.length} active`}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px]">
          <caption className="sr-only">
            Open trading positions with entry price, current price, quantity,
            and profit/loss
          </caption>
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th scope="col" className="px-4 py-1.5 text-left font-normal">
                ASSET
              </th>
              <th scope="col" className="px-4 py-1.5 text-left font-normal">
                DIR
              </th>
              <th scope="col" className="px-4 py-1.5 text-right font-normal">
                ENTRY
              </th>
              <th scope="col" className="px-4 py-1.5 text-right font-normal">
                CURRENT
              </th>
              <th scope="col" className="px-4 py-1.5 text-right font-normal">
                QTY
              </th>
              <th scope="col" className="px-4 py-1.5 text-right font-normal">
                P&L
              </th>
              <th scope="col" className="px-4 py-1.5 text-right font-normal">
                P&L%
              </th>
              <th scope="col" className="px-4 py-1.5 text-left font-normal">
                AGENT
              </th>
            </tr>
          </thead>
          <tbody>
            {isPending ? (
              [0, 1, 2].map((i) => (
                <tr key={i} className="border-b border-border/50">
                  <td colSpan={8} className="px-4 py-2.5">
                    <div className="h-4 animate-pulse bg-secondary" />
                  </td>
                </tr>
              ))
            ) : isError ? (
              <tr className="border-b border-border/50">
                <td colSpan={8} className="px-4 py-3 text-xs text-terminal-red">
                  POSITIONS DATA UNAVAILABLE — retrying
                </td>
              </tr>
            ) : openPositions.length === 0 ? (
              <tr className="border-b border-border/50">
                <td colSpan={8} className="px-4 py-3 text-xs text-terminal-dim">
                  NO OPEN POSITIONS — approved proposals will appear here
                </td>
              </tr>
            ) : (
              openPositions.map((pos) => (
                <tr
                  key={pos.id}
                  className="border-b border-border/50 text-xs hover:bg-secondary/30 transition-colors cursor-pointer"
                >
                  <td className="px-4 py-2">
                    <span className="font-bold text-foreground">
                      {pos.asset}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`px-1.5 py-0.5 text-[10px] font-bold ${
                        pos.direction === "LONG"
                          ? "bg-terminal-green/10 text-terminal-green"
                          : "bg-terminal-red/10 text-terminal-red"
                      }`}
                    >
                      {pos.direction}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right text-muted-foreground">
                    {fmtDollar(pos.entryPrice)}
                  </td>
                  <td className="px-4 py-2 text-right text-foreground">
                    {pos.currentPrice !== null
                      ? fmtDollar(pos.currentPrice)
                      : "—"}
                  </td>
                  <td className="px-4 py-2 text-right text-muted-foreground">
                    {pos.quantity}
                  </td>
                  <td
                    className={`px-4 py-2 text-right font-bold ${
                      pos.pnl >= 0 ? "text-terminal-green" : "text-terminal-red"
                    }`}
                  >
                    {fmtPnl(pos.pnl)}
                  </td>
                  <td
                    className={`px-4 py-2 text-right ${
                      pos.pnlPct >= 0
                        ? "text-terminal-green"
                        : "text-terminal-red"
                    }`}
                  >
                    {pos.pnlPct >= 0 ? "+" : ""}
                    {pos.pnlPct.toFixed(2)}%
                  </td>
                  <td className="px-4 py-2 text-terminal-cyan text-[10px]">
                    {pos.agentName}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
