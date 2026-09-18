"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  BarChart3,
  Bot,
  ChevronUp,
  LayoutGrid,
  MoreHorizontal,
  Settings,
  Shield,
  Target,
  Trophy,
  X,
  Zap,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ActiveBrokerSwitcher } from "@/components/settings/broker-accounts";
import {
  NotificationBadgeIcon,
  NotificationsList,
} from "@/components/terminal/notifications-list";
import { useHideOnScroll } from "@/hooks/use-hide-on-scroll";
import { useNotifications } from "@/hooks/use-notifications";
import { agentsDbQueries } from "@/lib/queries/agents-db";

const NAV_ITEMS = [
  { href: "/", label: "OVERVIEW", icon: BarChart3 },
  { href: "/agents", label: "AGENTS", icon: Bot },
  { href: "/signals", label: "SIGNALS", icon: Zap },
  { href: "/positions", label: "POSITIONS", icon: Target },
  { href: "/strategies", label: "STRATEGIES", icon: LayoutGrid },
  { href: "/consensus", label: "CONSENSUS", icon: Shield },
  { href: "/leaderboard", label: "LEADERBOARD", icon: Trophy },
  { href: "/settings", label: "SETTINGS", icon: Settings },
];

export function TerminalBottomNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const [notifsOpen, setNotifsOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const notifsRef = useRef<HTMLDivElement>(null);
  // Hide when scrolling down, reveal on scroll up. The layout scroller is
  // <main id="main-content">; window listener covers short/unspecialized
  // pages as a fallback.
  const { hidden } = useHideOnScroll({ scrollElementId: "main-content" });
  // Live fleet liveness; deduped with the agents view via the shared key.
  const { data: fleet } = useQuery(agentsDbQueries.fleet());
  const onlineCount = fleet?.onlineCount ?? 0;
  const totalAgents = fleet?.total ?? 0;
  const { unreadCount } = useNotifications();

  // Close the MORE panel on route change (setter is stable; pathname is
  // the trigger — closing on every navigation is the intent).
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional
  useEffect(() => {
    setMoreOpen(false);
    setNotifsOpen(false);
  }, [pathname]);

  // Close the MORE panel and NOTIFS sheet on outside tap
  useEffect(() => {
    function handleClickOutside(e: MouseEvent | TouchEvent) {
      const target = e.target as Node;
      if (moreRef.current && !moreRef.current.contains(target)) {
        setMoreOpen(false);
      }
      if (notifsRef.current && !notifsRef.current.contains(target)) {
        setNotifsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside, {
      passive: true,
    });
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, []);

  // The panels sit above the tab bar; opening one while the bar is
  // scroll-hidden would clip it, so opening a panel always reveals the bar.
  const barHidden = hidden && !moreOpen && !notifsOpen;

  const primary = NAV_ITEMS.slice(0, 3);
  const secondary = NAV_ITEMS.slice(3);

  return (
    <nav
      className={`sticky bottom-0 z-40 border-t border-border bg-card transition-transform duration-300 ease-in-out md:hidden ${
        barHidden ? "translate-y-full" : "translate-y-0"
      }`}
      style={{
        // iOS home-indicator inset: padding lives inside the bar so the
        // translated-away state still clears the gesture area.
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
      aria-label="Mobile navigation"
    >
      {/* NOTIFS sheet: shared notifications panel, sits above the tab bar */}
      {notifsOpen && (
        <div
          ref={notifsRef}
          className="absolute bottom-full left-0 right-0 border-t border-border bg-card shadow-lg shadow-black/40"
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <div className="flex items-center gap-2">
              <NotificationBadgeIcon size="md" />
              <span className="text-xs text-terminal-green">
                {unreadCount > 0 ? `${unreadCount} UNREAD` : "ALL READ"}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setNotifsOpen(false)}
              className="p-1 text-muted-foreground hover:text-foreground"
              aria-label="Close notifications panel"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <NotificationsList maxHeight="min(60vh, 24rem)" />
        </div>
      )}

      {/* MORE panel: secondary destinations + status, sits above the bar */}
      {moreOpen && (
        <div
          ref={moreRef}
          className="absolute bottom-full left-0 right-0 border-t border-border bg-card shadow-lg shadow-black/40"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <div className="flex items-center gap-2">
              <Activity className="h-3 w-3 text-terminal-green" />
              <span className="text-xs text-terminal-green">
                {onlineCount}/{totalAgents} ONLINE
              </span>
            </div>
            <button
              type="button"
              onClick={() => setMoreOpen(false)}
              className="p-1 text-muted-foreground hover:text-foreground"
              aria-label="Close navigation panel"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-px p-px">
            {secondary.map((item) => {
              const isActive = pathname === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href as Route}
                  className={`flex items-center gap-2 px-4 py-2.5 text-[10px] tracking-wider transition-colors ${
                    isActive
                      ? "bg-terminal-green/10 text-terminal-green"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                  }`}
                  aria-current={isActive ? "page" : undefined}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </Link>
              );
            })}
          </div>

          {/* Active broker switcher, same component as desktop header */}
          <div className="border-t border-border px-4 py-3">
            <span className="text-[10px] font-bold tracking-wider text-muted-foreground">
              ACTIVE BROKER
            </span>
            <div className="mt-2">
              <ActiveBrokerSwitcher />
            </div>
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex items-stretch justify-around">
        {primary.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href as Route}
              className={`flex flex-1 flex-col items-center gap-0.5 px-2 py-2 text-[9px] tracking-wider transition-colors ${
                isActive
                  ? "text-terminal-green"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}

        {/* NOTIFS: dedicated notifications sheet (no route) */}
        <button
          type="button"
          onClick={() => {
            setNotifsOpen((v) => !v);
            setMoreOpen(false);
          }}
          className={`relative flex flex-1 flex-col items-center gap-0.5 px-2 py-2 text-[9px] tracking-wider transition-colors ${
            notifsOpen
              ? "text-terminal-green"
              : "text-muted-foreground hover:text-foreground"
          }`}
          aria-expanded={notifsOpen}
          aria-label={
            unreadCount > 0
              ? `Notifications, ${unreadCount} unread`
              : "Notifications"
          }
        >
          <NotificationBadgeIcon size="md" />
          NOTIFS
        </button>

        {/* MORE: active if the current route is one of the secondary items */}
        <button
          type="button"
          onClick={() => {
            setMoreOpen(!moreOpen);
            setNotifsOpen(false);
          }}
          className={`flex flex-1 flex-col items-center gap-0.5 px-2 py-2 text-[9px] tracking-wider transition-colors ${
            moreOpen || secondary.some((item) => item.href === pathname)
              ? "text-terminal-green"
              : "text-muted-foreground hover:text-foreground"
          }`}
          aria-expanded={moreOpen}
        >
          {moreOpen ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <MoreHorizontal className="h-4 w-4" />
          )}
          MORE
        </button>
      </div>
    </nav>
  );
}
