import { agentConfigs } from "./agents/config";
import { agentRuntime } from "./runtime/agent-runtime";

for (const agent of agentConfigs) {
  agentRuntime.registerAgent(agent.id);
}
agentRuntime.start();

export { agentConfigs } from "./agents/config";
export {
  coordinatorAgent,
  executionAgent,
  reasoningAnalysisAgent,
  riskAgent,
  sentimentAgent,
  technicalAnalysisAgent,
} from "./agents/trading-agents";
export { runConsensusWorkflow } from "./workflows/consensus-workflow";
