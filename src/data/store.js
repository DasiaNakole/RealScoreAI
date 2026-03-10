import { calculateConfidenceScore, estimateBehaviorTrend } from "../ai/intelligence.js";
import { calculateLeadScore } from "../scoring/engine.js";

const agents = [{ id: "agent-1", name: "D. Mitchell" }];

const seedLeads = [
  {
    id: "lead-101",
    agentId: "agent-1",
    name: "Alyssa Carter",
    email: "alyssa@example.com",
    stage: "touring",
    lastActivityAt: "2026-02-15T15:00:00.000Z",
    signals: {
      responseTimeMinutes: 8,
      messageIntent: "hot",
      followThroughRate: 0.9,
      weeklyEngagementTouches: 6
    }
  },
  {
    id: "lead-102",
    agentId: "agent-1",
    name: "Marcus Lee",
    email: "marcus@example.com",
    stage: "new",
    lastActivityAt: "2026-02-12T15:00:00.000Z",
    signals: {
      responseTimeMinutes: 140,
      messageIntent: "warm",
      followThroughRate: 0.5,
      weeklyEngagementTouches: 2
    }
  },
  {
    id: "lead-103",
    agentId: "agent-1",
    name: "Isabella Hart",
    email: "isabella@example.com",
    stage: "nurture",
    lastActivityAt: "2026-02-08T15:00:00.000Z",
    signals: {
      responseTimeMinutes: 500,
      messageIntent: "cold",
      followThroughRate: 0.2,
      weeklyEngagementTouches: 0
    }
  },
  {
    id: "lead-104",
    agentId: "agent-1",
    name: "Noah Patel",
    email: "noah@example.com",
    stage: "qualified",
    lastActivityAt: "2026-02-14T15:00:00.000Z",
    signals: {
      responseTimeMinutes: 20,
      messageIntent: "warm",
      followThroughRate: 0.8,
      weeklyEngagementTouches: 4
    }
  },
  {
    id: "lead-105",
    agentId: "agent-1",
    name: "Grace Kim",
    email: "grace@example.com",
    stage: "new",
    lastActivityAt: "2026-02-11T15:00:00.000Z",
    signals: {
      responseTimeMinutes: 60,
      messageIntent: "neutral",
      followThroughRate: 0.45,
      weeklyEngagementTouches: 1
    }
  },
  {
    id: "lead-106",
    agentId: "agent-1",
    name: "Daniel Brooks",
    email: "daniel@example.com",
    stage: "new",
    lastActivityAt: "2026-02-15T12:00:00.000Z",
    signals: {
      responseTimeMinutes: 10,
      messageIntent: "hot",
      followThroughRate: 0.7,
      weeklyEngagementTouches: 5
    }
  }
];

const leads = seedLeads.map((lead) => {
  const scored = calculateLeadScore(lead.signals, { pipelineProgress: lead.pipelineProgress || {} });
  const base = {
    ...lead,
    score: scored.score,
    bucket: scored.bucket,
    whyScore: scored.whyScore,
    aiIntentClassification: {
      intent: lead.signals.messageIntent,
      confidence: 0.62,
      source: "bootstrap",
      reason: "Seed value initialized from provided intent."
    },
    behaviorTrend: "stable",
    events: [],
    lastNurtureEmailAt: null,
    lastSuggestedFollowUpAt: null
  };

  return {
    ...base,
    behaviorTrend: estimateBehaviorTrend(base.events, base.signals),
    confidenceScore: calculateConfidenceScore(base)
  };
});

const usage = {
  "agent-1": {
    scoredEvents: 0,
    digestsSent: 0,
    reactivationsSent: 0,
    autoNurtureMoves: 0,
    nurtureEmailsSent: 0,
    followUpSuggestionsGenerated: 0,
    followUpEmailsSent: 0
  }
};

function byAgent(agentId) {
  return leads.filter((lead) => lead.agentId === agentId);
}

function getLead(leadId) {
  return leads.find((lead) => lead.id === leadId);
}

function upsertLead(updatedLead) {
  const idx = leads.findIndex((lead) => lead.id === updatedLead.id);
  if (idx >= 0) leads[idx] = updatedLead;
  return updatedLead;
}

function incrementUsage(agentId, field, count = 1) {
  if (!usage[agentId]) {
    usage[agentId] = {
      scoredEvents: 0,
      digestsSent: 0,
      reactivationsSent: 0,
      autoNurtureMoves: 0,
      nurtureEmailsSent: 0,
      followUpSuggestionsGenerated: 0,
      followUpEmailsSent: 0
    };
  }
  usage[agentId][field] += count;
}

export const store = {
  agents,
  leads,
  usage,
  byAgent,
  getLead,
  upsertLead,
  incrementUsage
};
