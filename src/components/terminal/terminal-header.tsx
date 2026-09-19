"use client";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  BarChart3,
  Bot,
  LayoutGrid,
  LogOut,
  Radio,
  Settings,
  Shield,
  Target,
  Trophy,
  Zap,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ActiveBrokerSwitcher } from "@/components/settings/broker-accounts";
import { NotificationBell } from "@/components/terminal/notification-bell";
import { useTerminalAuthenticated } from "@/components/terminal/terminal-auth-context";
import { APP_NAME } from "@/lib/constant";
import { agentsDbQueries } from "@/lib/queries/agents-db";

const NAV_ITEMS = [
  { href: "/", label: "OVERVIEW", icon: BarChart3 },
  { href: "/agents", label: "AGENTS", icon: Bot },
  { href: "/signals", label: "SIGNALS", icon: Zap },
  { href: "/positions", label: "POSITIONS", icon: Target },
  { href: "/strategies", label: "STRATEGIES", icon: LayoutGrid },
  { href: "/channels", label: "CHANNELS", icon: Radio },
  { href: "/consensus", label: "CONSENSUS", icon: Shield },
  { href: "/leaderboard", label: "LEADERBOARD", icon: Trophy },
  { href: "/settings", label: "SETTINGS", icon: Settings },
];

export function TerminalHeader({ onSignOut }: { onSignOut?: () => void }) {
  const pathname = usePathname();
  const authed = useTerminalAuthenticated();
  const { data: fleet } = useQuery(agentsDbQueries.fleet(authed));
  const onlineCount = fleet?.onlineCount ?? 0;
  const totalAgents = fleet?.total ?? 0;

  return (
    <header className="flex items-center justify-between border-b border-border bg-card px-3 py-2 sm:px-4">
      <div className="flex items-center gap-3 sm:gap-6">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold tracking-widest text-terminal-green terminal-glow">
              {APP_NAME}
            </span>
          </div>
        </Link>

        {/* Desktop nav */}
        <nav
          className="hidden items-center gap-1 md:flex"
          aria-label="Main navigation"
        >
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href as Route}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs tracking-wide transition-colors ${
                  isActive
                    ? "bg-secondary text-terminal-green"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                }`}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon className="h-3 w-3" />
                <span className="hidden lg:inline">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="flex items-center gap-2 text-xs sm:gap-4">
        {/* Status info: visible on mobile too now that the sheet is gone */}
        <div className="flex items-center gap-2">
          <Activity className="h-3 w-3 text-terminal-green" />
          <span className="text-terminal-green">
            {onlineCount}/{totalAgents} ONLINE
          </span>
        </div>
        {/* Active broker quick-switcher; the bottom nav hosts it on mobile */}
        <div className="hidden sm:block">
          <ActiveBrokerSwitcher />
        </div>
        {/* Notifications: unread badge + dropdown, read state persists locally */}
        <NotificationBell />
        {onSignOut && (
          <button
            type="button"
            onClick={onSignOut}
            className="flex items-center gap-1.5 px-2 py-1.5 text-muted-foreground hover:text-terminal-red hover:bg-terminal-red/10 transition-colors border border-transparent hover:border-terminal-red/30 sm:px-2.5"
            title="Disconnect terminal"
          >
            <LogOut className="h-3 w-3" />
            <span className="hidden lg:inline">DISCONNECT</span>
          </button>
        )}
      </div>
    </header>
  );
}
