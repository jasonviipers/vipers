import type { Metadata } from "next";
import { PositionsView } from "@/components/pages/positions-view";
import { TerminalLayout } from "@/components/terminal/terminal-layout";

export const metadata: Metadata = {
  title: "Positions",
  description:
    "Track open and closed trading positions with real-time P&L, risk metrics, entry and exit points, and detailed position history.",
  alternates: {
    canonical: "https://viipers.com/positions",
  },
  openGraph: {
    title: "Positions | Viipers",
    description:
      "Track open and closed trading positions with real-time P&L and risk metrics.",
    url: "https://viipers.com/positions",
  },
};

export default function PositionsPage() {
  return (
    <TerminalLayout>
      <PositionsView />
    </TerminalLayout>
  );
}
