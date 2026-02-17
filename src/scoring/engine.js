const WEIGHTS = {
  responseTime: 0.3,
  messageIntent: 0.3,
  followThrough: 0.25,
  engagementConsistency: 0.15
};

const INTENT_MAP = {
  hot: 100,
  warm: 70,
  neutral: 45,
  cold: 20,
  unknown: 30
};

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

export function responseTimeScore(minutes) {
  if (minutes <= 5) return 100;
  if (minutes <= 30) return 85;
  if (minutes <= 120) return 60;
  if (minutes <= 480) return 40;
  return 20;
}

export function messageIntentScore(intent) {
  return INTENT_MAP[intent] ?? INTENT_MAP.unknown;
}

export function followThroughScore(rate) {
  return clamp(Math.round(rate * 100));
}

export function engagementConsistencyScore(weeklyTouches) {
  if (weeklyTouches >= 7) return 100;
  if (weeklyTouches >= 5) return 85;
  if (weeklyTouches >= 3) return 65;
  if (weeklyTouches >= 1) return 40;
  return 15;
}

function calcComponent(label, raw, weight, reason) {
  return {
    signal: label,
    raw,
    weight,
    weightedContribution: Number((raw * weight).toFixed(2)),
    reason
  };
}

export function calculateLeadScore(signals) {
  const response = responseTimeScore(signals.responseTimeMinutes);
  const intent = messageIntentScore(signals.messageIntent);
  const follow = followThroughScore(signals.followThroughRate);
  const engagement = engagementConsistencyScore(signals.weeklyEngagementTouches);

  const components = [
    calcComponent(
      "responseTime",
      response,
      WEIGHTS.responseTime,
      `Recent response time is ${signals.responseTimeMinutes} minute(s).`
    ),
    calcComponent(
      "messageIntent",
      intent,
      WEIGHTS.messageIntent,
      `Latest buyer intent is tagged as \"${signals.messageIntent}\".`
    ),
    calcComponent(
      "followThrough",
      follow,
      WEIGHTS.followThrough,
      `Follow-through completion rate is ${Math.round(signals.followThroughRate * 100)}%.`
    ),
    calcComponent(
      "engagementConsistency",
      engagement,
      WEIGHTS.engagementConsistency,
      `Lead had ${signals.weeklyEngagementTouches} touchpoint(s) this week.`
    )
  ];

  const score = Math.round(components.reduce((sum, item) => sum + item.weightedContribution, 0));
  const bucket = score >= 75 ? "today_focus" : score < 50 ? "low_value" : "at_risk";

  return {
    score,
    bucket,
    components,
    whyScore: buildWhyScore(score, components)
  };
}

export function buildWhyScore(score, components) {
  const strongest = [...components].sort((a, b) => b.weightedContribution - a.weightedContribution)[0];
  const weakest = [...components].sort((a, b) => a.weightedContribution - b.weightedContribution)[0];

  return {
    summary: `Score ${score}/100. Strongest: ${strongest.signal}. Weakest: ${weakest.signal}.`,
    strongest,
    weakest,
    details: components
  };
}
