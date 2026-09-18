"use client";

import {
  AlertTriangle,
  Bell,
  BellRing,
  Check,
  CheckCheck,
  Crosshair,
  Network,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { formatTimeAgo, useNotifications } from "@/hooks/use-notifications";
import type { FeedEvent } from "@/lib/queries/events";

/**
 * Shared notifications panel: header with unread count + "mark all read",
 * scrollable categorized list, sync-status footer. Rendered as a dropdown
 * by the header bell and as a bottom sheet by the mobile bottom-nav tab,
 * so both surfaces stay visually and behaviorally identical.
 */

const MAX_ITEMS = 20;

const CATEGORY_META: Record<
  FeedEvent["category"],
  { icon: typeof Zap; label: string; className: string }
> = {
  alert: {
    className: "text-terminal-red",
    icon: AlertTriangle,
    label: "ALERT",
  },
  consensus: {
    className: "text-terminal-gold",
    icon: Network,
    label: "CONSENSUS",
  },
  heartbeat: {
    className: "text-terminal-cyan",
    icon: ShieldCheck,
    label: "PIPELINE",
  },
  signal: {
    className: "text-terminal-amber",
    icon: Zap,
    label: "SIGNAL",
  },
  trade: {
    className: "text-terminal-green",
    icon: Crosshair,
    label: "TRADE",
  },
};

export function NotificationsList({ maxHeight }: { maxHeight: string }) {
  const {
    isRead,
    items,
    markRead,
    now,
    pending,
    readsPending,
    synced,
    unreadCount,
    unreadItems,
  } = useNotifications();

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border bg-secondary/50 px-3 py-2">
        <span className="text-[10px] font-bold tracking-wider text-foreground">
          NOTIFICATIONS
          {synced && (
            <span
              className="ml-2 text-terminal-green"
              title="Read state syncs across devices via your API key"
            >
              SYNCED
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={() => markRead(unreadItems.map((i) => i.id))}
          disabled={unreadCount === 0 || pending}
          className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${
            unreadCount === 0
              ? "cursor-not-allowed text-terminal-dim"
              : "text-terminal-green hover:text-foreground"
          }`}
        >
          <CheckCheck className="h-3 w-3" />
          Mark all read
        </button>
      </div>

      {/* List */}
      <div className="overflow-y-auto" style={{ maxHeight }}>
        {items.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-terminal-dim">
            NO EVENTS YET — notifications appear as the pipeline runs
          </div>
        ) : (
          items.slice(0, MAX_ITEMS).map((item) => {
            const meta = CATEGORY_META[item.category];
            const Icon = meta.icon;
            const unread = !isRead(item.id);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => markRead([item.id])}
                aria-label={`Mark notification as read: ${item.asset ?? ""} ${item.message}`.trim()}
                className={`flex w-full items-start gap-2.5 border-b border-border/50 px-3 py-2.5 text-left transition-colors last:border-b-0 ${
                  unread
                    ? "bg-terminal-amber/5 hover:bg-secondary/40"
                    : "hover:bg-secondary/30"
                }`}
              >
                <span className={`mt-0.5 shrink-0 ${meta.className}`}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span
                      className={`text-[9px] font-bold tracking-wider ${meta.className}`}
                    >
                      {meta.label}
                    </span>
                    {item.asset && (
                      <span className="text-[9px] font-bold text-foreground">
                        {item.asset}
                      </span>
                    )}
                    {unread ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-terminal-amber" />
                    ) : (
                      <Check className="h-2.5 w-2.5 text-terminal-dim" />
                    )}
                    <time
                      dateTime={item.timestamp}
                      className="ml-auto shrink-0 text-[9px] text-terminal-dim"
                      suppressHydrationWarning
                    >
                      {formatTimeAgo(item.timestamp, now)}
                    </time>
                  </span>
                  <span
                    className={`mt-0.5 block truncate text-[11px] leading-relaxed ${
                      unread ? "text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {item.message}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-border bg-secondary/50 px-3 py-1.5 text-center text-[9px] text-terminal-dim">
        {synced
          ? "READ STATE SYNCED TO YOUR ACCOUNT"
          : readsPending
            ? "CHECKING READ STATE…"
            : "READ STATE STORED LOCALLY — CONNECT AN API KEY TO SYNC"}
      </div>
    </div>
  );
}

/**
 * Bell icon with unread badge; shared by the header bell and the mobile
 * nav tab so the badge looks identical on both surfaces.
 */
export function NotificationBadgeIcon({
  className,
  size = "md",
}: {
  className?: string;
  /** md = nav tab glyph (h-4), sm = header button glyph (h-3.5). */
  size?: "sm" | "md";
}) {
  const { unreadCount, unreadItems } = useNotifications();

  const hasAlert = unreadItems.some((i) => i.category === "alert");
  const iconSize = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";

  return (
    <span className={`relative inline-flex ${className ?? ""}`}>
      {unreadCount > 0 ? (
        <BellRing className={iconSize} />
      ) : (
        <Bell className={iconSize} />
      )}
      {unreadCount > 0 && (
        <span
          aria-hidden
          className={`absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center px-1 text-[9px] font-bold ${
            hasAlert
              ? "bg-terminal-red text-primary-foreground"
              : "bg-terminal-amber text-primary-foreground"
          }`}
        >
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}
    </span>
  );
}
