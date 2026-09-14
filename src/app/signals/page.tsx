import type { Metadata } from "next";
import { SignalsView } from "@/components/pages/signals-view";
import { TerminalLayout } from "@/components/terminal/terminal-layout";

export const metadata: Metadata = {
  title: "Signals",
  description:
    "Live trading signal feed with confidence scoring, source attribution, and historical signal performance analysis across all connected data providers.",
  alternates: {
    canonical: "https://viipers.com/signals",
  },
  openGraph: {
    title: "Signals | Viipers",
    description:
      "Live trading signal feed with confidence scoring and historical performance analysis.",
    url: "https://viipers.com/signals",
  },
};

export default function SignalsPage() {
  return (
    <TerminalLayout>
      <SignalsView />
    </TerminalLayout>
  );
}
