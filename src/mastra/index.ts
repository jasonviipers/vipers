import { Mastra } from "@mastra/core/mastra";
import { PostgresStore } from "@mastra/pg";
import { env } from "@/env";

import {
  coordinatorAgent,
  executionAgent,
  reasoningAnalysisAgent,
  riskAgent,
  sentimentAgent,
  technicalAnalysisAgent,
} from "@/mastra/agents/trading-agents";
import { agentRuntime } from "@/mastra/runtime/agent-runtime";
import { consensusWorkflow } from "@/mastra/workflows/consensus-workflow";

const agents = {
  coordinatorAgent,
  executionAgent,
  reasoningAnalysisAgent,
  riskAgent,
  sentimentAgent,
  technicalAnalysisAgent,
};

export const mastra = new Mastra({
  agents,
  workflows: { consensusWorkflow },
  storage: new PostgresStore({
    id: "mastra-storage",
    connectionString: env.MASTRA_DATABASE_URL,
  }),
  server: {
    bodySizeLimit: 10 * 1024 * 1024, // 10 MB
  },
});

// Attach the process-wide agent runtime to the SAME PubSub bus the agents and
// workflow steps publish on, then register every configured agent so status,
// heartbeats and metrics are tracked for each one.
agentRuntime.attachPubSub(mastra.pubsub);
for (const agent of Object.values(agents)) {
  agentRuntime.registerAgent(agent.id);
}

// Handle startup errors explicitly
agentRuntime.start().catch((err) => {
  console.error("Agent runtime failed to start:", err);
});
