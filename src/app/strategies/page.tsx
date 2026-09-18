import type { Metadata } from "next";
import { StrategiesView } from "@/components/pages/strategies-view";
import { TerminalLayout } from "@/components/terminal/terminal-layout";

export const metadata: Metadata = {
  title: "Strategies",
  description:
    "Configure and backtest automated trading strategies with multi-agent consensus parameters, risk controls, and performance benchmarking tools.",
  alternates: {
    canonical: "https://viipers.com/strategies",
  },
  openGraph: {
    title: "Strategies | viipers",
    description:
      "Configure and backtest automated trading strategies with multi-agent consensus parameters.",
    url: "https://viipers.com/strategies",
  },
};

export default function StrategiesPage() {
  return (
    <TerminalLayout>
      <StrategiesView />
    </TerminalLayout>
  );
}
