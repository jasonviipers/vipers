import type { Metadata } from "next";
import { Geist, Geist_Mono, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import type { Viewport } from "next";
import { Providers } from "@/components/providers";
import { ColorSchemeProvider } from "@/context/color-scheme-context";
import { cn } from "@/lib/utils";

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://viipers.app"),
  title: {
    default: "viipers | Agent Swarm Trading Terminal",
    template: "%s | viipers",
  },
  description:
    "Autonomous agent swarm trading platform with real-time signal analysis, consensus-driven execution, and multi-provider LLM intelligence.",
  generator: "v0.app",
  keywords: [
    "trading terminal",
    "agent swarm",
    "algorithmic trading",
    "AI trading",
    "signal analysis",
    "consensus trading",
    "multi-agent",
    "LLM intelligence",
    "quantitative trading",
    "automated trading",
  ],
  authors: [{ name: "viipers" }],
  creator: "viipers",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://viipers.com",
    siteName: "viipers",
    title: "viipers | Agent Swarm Trading Terminal",
    description:
      "Autonomous agent swarm trading platform with real-time signal analysis, consensus-driven execution, and multi-provider LLM intelligence.",
  },
  twitter: {
    card: "summary_large_image",
    title: "viipers | Agent Swarm Trading Terminal",
    description:
      "Autonomous agent swarm trading platform with real-time signal analysis, consensus-driven execution, and multi-provider LLM intelligence.",
  },
  icons: {
    icon: [
      {
        url: "/icon-light-32x32.png",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/icon-dark-32x32.png",
        media: "(prefers-color-scheme: dark)",
      },
      {
        url: "/icon.svg",
        type: "image/svg+xml",
      },
    ],
    apple: "/apple-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0e14",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "viipers",
  description:
    "Autonomous agent swarm trading platform with real-time signal analysis, consensus-driven execution, and multi-provider LLM intelligence.",
  url: "https://viipers.com",
  applicationCategory: "FinanceApplication",
  operatingSystem: "Any",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={cn(
        "h-full",
        "antialiased",
        geistSans.variable,
        geistMono.variable,
        "font-mono",
        jetbrainsMono.variable,
      )}
    >
      <body className="min-h-full flex flex-col">
        <Providers>
          <ColorSchemeProvider>{children}</ColorSchemeProvider>
        </Providers>
      </body>
    </html>
  );
}
