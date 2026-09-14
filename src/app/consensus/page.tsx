import type { Metadata } from "next";
import { ConsensusView } from "@/components/pages/consensus-view";
import { TerminalLayout } from "@/components/terminal/terminal-layout";

export const metadata: Metadata = {
  title: "Consensus",
  description:
    "View multi-agent consensus decisions with voting breakdowns, proposal history, and real-time agreement metrics for trade execution governance.",
  alternates: {
    canonical: "https://quantex.app/consensus",
  },
  openGraph: {
    title: "Consensus | QuantEx",
    description:
      "View multi-agent consensus decisions with voting breakdowns and proposal history.",
    url: "https://quantex.app/consensus",
  },
};

export default function ConsensusPage() {
  return (
    <TerminalLayout>
      <ConsensusView />
    </TerminalLayout>
  );
}
