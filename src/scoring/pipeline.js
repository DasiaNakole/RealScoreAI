import { classifyIntentFromMessage, calculateConfidenceScore, estimateBehaviorTrend } from "../ai/intelligence.js";
import { calculateLeadScore } from "./engine.js";

function nowIso() {
  return new Date().toISOString();
}

export function applyLeadEvent(lead, event) {
  const updated = {
    ...lead,
    signals: { ...lead.signals },
    events: [...lead.events, { ...event, createdAt: nowIso() }],
    updatedAt: nowIso(),
    aiIntentClassification: lead.aiIntentClassification || null,
    behaviorTrend: lead.behaviorTrend || "stable",
    confidenceScore: lead.confidenceScore || 50
  };

  switch (event.type) {
    case "RESPONSE_TIME_RECORDED":
      updated.signals.responseTimeMinutes = Number(event.value);
      break;
    case "MESSAGE_INTENT_UPDATED":
      updated.signals.messageIntent = String(event.value);
      updated.aiIntentClassification = {
        intent: updated.signals.messageIntent,
        confidence: 1,
        source: "manual_override",
        reason: "Agent manually set intent."
      };
      break;
    case "MESSAGE_RECEIVED": {
      const text = String(event.meta?.messageText || event.value || "");
      const classification = classifyIntentFromMessage(text, updated.signals.messageIntent);
      updated.signals.messageIntent = classification.intent;
      updated.aiIntentClassification = classification;
      break;
    }
    case "FOLLOW_THROUGH_UPDATED":
      updated.signals.followThroughRate = Number(event.value);
      break;
    case "ENGAGEMENT_TOUCH_RECORDED":
      updated.signals.weeklyEngagementTouches = Number(event.value);
      break;
    default:
      break;
  }

  const scored = calculateLeadScore(updated.signals);
  updated.score = scored.score;
  updated.bucket = scored.bucket;
  updated.whyScore = scored.whyScore;
  updated.behaviorTrend = estimateBehaviorTrend(updated.events, updated.signals);
  updated.confidenceScore = calculateConfidenceScore(updated);

  return updated;
}
