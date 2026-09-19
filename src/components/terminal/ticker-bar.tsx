"use client";

import { useQuery } from "@tanstack/react-query";
import { TrendingDown, TrendingUp } from "lucide-react";
import { useTerminalAuthenticated } from "@/components/terminal/terminal-auth-context";
import { fmtPrice } from "@/lib/format";
import { quotesQueries, type TickerItem } from "@/lib/queries/quotes";

export function TickerBar() {
  const authed = useTerminalAuthenticated();
  const { data, isError, isPending } = useQuery(quotesQueries.live(authed));
  const items = data?.items ?? [];

  const row = (ariaHidden: boolean) => (
    <div
      className="flex shrink-0 items-center gap-8 whitespace-nowrap px-4"
      aria-hidden={ariaHidden || undefined}
    >
      {items.map((item) => (
        <TickerRow key={item.asset} item={item} />
      ))}
    </div>
  );

  return (
    <div
      className="flex h-8 items-center overflow-hidden border-b border-border bg-card"
      role="marquee"
      aria-label="Live market ticker"
    >
      {isError && items.length === 0 ? (
        <div className="flex w-full items-center gap-2 px-4 text-xs text-terminal-red">
          <span className="font-bold">MARKET FEED OFFLINE</span>
          <span className="text-terminal-dim">retrying...</span>
        </div>
      ) : isPending || items.length === 0 ? (
        <div className="flex w-full items-center gap-8 px-4 text-xs text-terminal-dim">
          <span className="animate-pulse">CONNECTING TO MARKET DATA...</span>
          <span className="animate-pulse">AWAITING QUOTES...</span>
        </div>
      ) : (
        <div className="animate-ticker flex w-max items-center">
          {row(false)}
          {row(true)}
        </div>
      )}
    </div>
  );
}

function TickerRow({ item }: { item: TickerItem }) {
  const up = item.changePct >= 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="font-bold text-foreground">{item.asset}</span>
      <span className="text-muted-foreground">
        {"$"}
        {fmtPrice(item.price)}
      </span>
      <span className={up ? "text-terminal-green" : "text-terminal-red"}>
        {up ? "+" : ""}
        {item.changePct.toFixed(2)}%
      </span>
      <span className="hidden text-terminal-dim sm:inline">
        VOL {item.volume}
      </span>
      <span className="hidden text-terminal-amber sm:inline">
        SIG {item.signalScore.toFixed(2)}
      </span>
      <span className="mx-2 text-terminal-dim">|</span>
      {up ? (
        <TrendingUp className="h-3 w-3 text-terminal-green" aria-hidden />
      ) : (
        <TrendingDown className="h-3 w-3 text-terminal-red" aria-hidden />
      )}
    </div>
  );
}
