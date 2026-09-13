import type { Metadata } from "next";
import { SettingsView } from "@/components/pages/settings-view";
import { TerminalLayout } from "@/components/terminal/terminal-layout";

export const metadata: Metadata = {
  title: "Settings",
  description:
    "Configure platform preferences, manage broker account connections, API keys, notification settings, and display options for the QuantEx terminal.",
  alternates: {
    canonical: "https://viipers.com/settings",
  },
  openGraph: {
    title: "Settings | Viipers",
    description:
      "Configure platform preferences, broker connections, and notification settings.",
    url: "https://viipers.com/settings",
  },
  robots: {
    index: false,
    follow: false,
  },
};
export default function SettingsPage() {
  return (
    <TerminalLayout>
      <SettingsView />
    </TerminalLayout>
  );
}
