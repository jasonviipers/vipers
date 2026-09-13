import { AgentGrid } from "@/components/dashboard/agent-grid";
import { ConsensusPanel } from "@/components/dashboard/consensus-panel";
import { EquityChart } from "@/components/dashboard/equity-chart";
import { LiveFeed } from "@/components/dashboard/live-feed";
import { PortfolioSummary } from "@/components/dashboard/portfolio-summary";
import { PositionsTable } from "@/components/dashboard/positions-table";
import { SignalChart } from "@/components/dashboard/signal-chart";
import { SignalFeed } from "@/components/dashboard/signal-feed";
import { TradesChart } from "@/components/dashboard/trades-chart";
import { TerminalLayout } from "@/components/terminal/terminal-layout";
import { APP_NAME } from "@/lib/constant";

export default function Home() {
  return (
    <TerminalLayout>
      <div className="flex h-full min-h-0 flex-col gap-px">
        <h1 className="sr-only">{APP_NAME}</h1>
        <PortfolioSummary />
        <div className="grid grid-cols-1 gap-px lg:grid-cols-2">
          <EquityChart />
          <SignalChart />
          <TradesChart />
          <AgentGrid />
        </div>
        <div className="grid flex-1 min-h-0 grid-cols-1 gap-px md:grid-cols-2 lg:grid-cols-3">
          <div className="flex min-h-0 flex-col gap-px lg:col-span-1">
            <LiveFeed />
          </div>
          <div className="flex min-h-0 flex-col gap-px lg:col-span-1">
            <SignalFeed />
          </div>
          <div className="flex min-h-0 flex-col gap-px md:col-span-2 lg:col-span-1">
            <PositionsTable />
            <ConsensusPanel />
          </div>
        </div>
      </div>
    </TerminalLayout>
  );
}
