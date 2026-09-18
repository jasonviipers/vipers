import type { Metadata } from "next";
import { LeaderboardView } from "@/components/pages/leaderboard-view";
import { TerminalLayout } from "@/components/terminal/terminal-layout";

export const metadata: Metadata = {
  title: "Leaderboard",
  description:
    "Agent performance rankings with competition standings, champion stats, win rate comparisons, and historical equity curves for all trading agents.",
  alternates: {
    canonical: "https://viipers.com/leaderboard",
  },
  openGraph: {
    title: "Leaderboard | viipers",
    description:
      "Agent performance rankings with competition standings and historical equity curves.",
    url: "https://viipers.com/leaderboard",
  },
};

export default function LeaderboardPage() {
  return (
    <TerminalLayout>
      <LeaderboardView />
    </TerminalLayout>
  );
}
