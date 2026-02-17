import { store } from "../data/store.js";

export function usageForAgent(agentId) {
  return store.usage[agentId] ?? {
    scoredEvents: 0,
    digestsSent: 0,
    reactivationsSent: 0,
    autoNurtureMoves: 0,
    nurtureEmailsSent: 0,
    followUpSuggestionsGenerated: 0,
    followUpEmailsSent: 0
  };
}
