"use client";

import { NuqsAdapter } from "nuqs/adapters/next/app";
import { QueryProvider } from "@/components/query-provider";
import { BrokerProvider } from "@/context/broker-context";
import { getQueryClient } from "@/lib/query-client";
import { TooltipProvider } from "./ui/tooltip";

export function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();

  return (
    <NuqsAdapter>
      <QueryProvider queryClient={queryClient}>
        <TooltipProvider>
          <BrokerProvider>{children}</BrokerProvider>
        </TooltipProvider>
      </QueryProvider>
    </NuqsAdapter>
  );
}
