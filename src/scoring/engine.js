const WEIGHTS = {
  responseTime: 0.24,
  messageIntent: 0.24,
  followThrough: 0.2,
  engagementConsistency: 0.12,
  checklistProgress: 0.2
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

const CHECKLIST_STEPS = [
  "consultation",
  "exclusive_buyer_agreement",
  "preapproval",
  "home_search",
  "schedule_visits",
  "home_inspection",
  "appraisal",
  "sign_documents",
  "closing",
  "closed"
];

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

export function checklistProgressScore(progress = {}) {
  const completed = CHECKLIST_STEPS.filter((step) => Boolean(progress?.[step]));
  const completionRatio = completed.length / CHECKLIST_STEPS.length;

  let milestoneBonus = 0;
  if (progress?.exclusive_buyer_agreement) milestoneBonus += 5;
  if (progress?.preapproval) milestoneBonus += 10;
  if (progress?.schedule_visits) milestoneBonus += 5;
  if (progress?.closing) milestoneBonus += 5;
  if (progress?.closed) milestoneBonus += 5;

  return clamp(Math.round(completionRatio * 70 + milestoneBonus));
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

export function calculateLeadScore(signals, options = {}) {
  const pipelineProgress = options.pipelineProgress || {};
  const response = responseTimeScore(signals.responseTimeMinutes);
  const intent = messageIntentScore(signals.messageIntent);
  const follow = followThroughScore(signals.followThroughRate);
  const engagement = engagementConsistencyScore(signals.weeklyEngagementTouches);
  const checklist = checklistProgressScore(pipelineProgress);

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
    ),
    calcComponent(
      "checklistProgress",
      checklist,
      WEIGHTS.checklistProgress,
      `Checklist progress completed ${CHECKLIST_STEPS.filter((step) => Boolean(pipelineProgress?.[step])).length}/${CHECKLIST_STEPS.length} stage(s).`
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
