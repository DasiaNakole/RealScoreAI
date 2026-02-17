const POSITIVE_PATTERNS = [
  /ready to buy/i,
  /pre-?approved/i,
  /can we tour/i,
  /offer/i,
  /moving soon/i,
  /serious/i,
  /next steps/i
];

const NEGATIVE_PATTERNS = [
  /not interested/i,
  /stop (emailing|messaging|contacting)/i,
  /maybe later/i,
  /not now/i,
  /price too high/i,
  /just browsing/i
];

export function classifyIntentFromMessage(messageText = "", fallbackIntent = "unknown") {
  const text = String(messageText || "").trim();

  if (!text) {
    return {
      intent: fallbackIntent,
      confidence: 0.42,
      source: "ai_assisted_heuristic",
      reason: "No message text available; falling back to existing intent."
    };
  }

  const positiveHits = POSITIVE_PATTERNS.filter((pattern) => pattern.test(text)).length;
  const negativeHits = NEGATIVE_PATTERNS.filter((pattern) => pattern.test(text)).length;

  if (positiveHits >= 2) {
    return {
      intent: "hot",
      confidence: 0.88,
      source: "ai_assisted_heuristic",
      reason: "Message includes multiple high-buying-intent signals."
    };
  }

  if (positiveHits === 1) {
    return {
      intent: "warm",
      confidence: 0.73,
      source: "ai_assisted_heuristic",
      reason: "Message shows one clear buying-intent signal."
    };
  }

  if (negativeHits >= 2) {
    return {
      intent: "cold",
      confidence: 0.9,
      source: "ai_assisted_heuristic",
      reason: "Message includes multiple disengagement signals."
    };
  }

  if (negativeHits === 1) {
    return {
      intent: "neutral",
      confidence: 0.69,
      source: "ai_assisted_heuristic",
      reason: "Message shows hesitation or delayed interest."
    };
  }

  return {
    intent: "neutral",
    confidence: 0.55,
    source: "ai_assisted_heuristic",
    reason: "No strong positive or negative intent markers detected."
  };
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function calculateConfidenceScore(lead) {
  const signalValues = [
    lead.signals.responseTimeMinutes,
    lead.signals.messageIntent,
    lead.signals.followThroughRate,
    lead.signals.weeklyEngagementTouches
  ];

  const knownSignals = signalValues.filter((value) => value !== undefined && value !== null).length;
  const base = knownSignals / 4;

  const aiConfidence = lead.aiIntentClassification?.confidence ?? 0.5;
  const eventDepth = Math.min(lead.events.length / 8, 1);

  return Number((average([base, aiConfidence, eventDepth]) * 100).toFixed(1));
}

export function estimateBehaviorTrend(events = [], signals = {}) {
  const recent = events.slice(-6);
  let positive = 0;
  let negative = 0;

  for (const event of recent) {
    if (event.type === "MESSAGE_RECEIVED") {
      const classification = classifyIntentFromMessage(event.meta?.messageText || event.value || "", "neutral");
      if (classification.intent === "hot" || classification.intent === "warm") positive += 2;
      if (classification.intent === "cold") negative += 2;
    }

    if (event.type === "ENGAGEMENT_TOUCH_RECORDED" && Number(event.value) >= 3) positive += 1;
    if (event.type === "FOLLOW_THROUGH_UPDATED" && Number(event.value) >= 0.7) positive += 1;
    if (event.type === "RESPONSE_TIME_RECORDED" && Number(event.value) > 240) negative += 1;
  }

  if (signals.responseTimeMinutes <= 30) positive += 1;
  if (signals.responseTimeMinutes > 240) negative += 1;

  const delta = positive - negative;
  if (delta >= 2) return "rising";
  if (delta <= -2) return "declining";
  return "stable";
}
