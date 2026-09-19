import type { Metadata } from "next";
import { Suspense } from "react";
import { ChannelsView } from "@/components/pages/channels-view";
import { TerminalLayout } from "@/components/terminal/terminal-layout";

export const metadata: Metadata = {
  title: "Channels",
  description:
    "Connect Reddit, Twitter/X, Discord, and Telegram so the Viipers agent fleet can read and act through your accounts. Authentication is handled by Composio connect links.",
  alternates: {
    canonical: "https://viipers.com/channels",
  },
  openGraph: {
    title: "Channels | Viipers",
    description:
      "Enable channel integrations for the agent fleet: Reddit, Twitter/X, Discord, Telegram.",
    url: "https://viipers.com/channels",
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default function ChannelsPage() {
  return (
    <TerminalLayout>
      {/* Suspense: ChannelsView reads ?connected=<slug> via useSearchParams,
          which must not block prerendering of the shell. */}
      <Suspense fallback={null}>
        <ChannelsView />
      </Suspense>
    </TerminalLayout>
  );
}
