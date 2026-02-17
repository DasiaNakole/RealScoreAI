export function buildMonthlyNurtureEmail(lead) {
  const subject = `Still searching, ${lead.name.split(" ")[0]}?`; 
  const text = [
    `Hi ${lead.name},`,
    "",
    "Just checking in with a light monthly update. If your home search is active again, reply with your top 2 priorities and we will line up options fast.",
    "",
    "No rush at all. When timing is right, we are ready.",
    "",
    "- Your agent"
  ].join("\n");

  return { subject, text };
}

export function buildDailyDigestEmail(agentName, leads) {
  const subject = "Today's Top 5 Leads";
  const lines = leads.map((lead, idx) => `${idx + 1}. ${lead.name} (Score ${lead.score}) - ${lead.reason}`);

  const text = [
    `Hi ${agentName},`,
    "",
    "Today focus on these leads:",
    ...lines,
    "",
    "Open your dashboard for action recommendations."
  ].join("\n");

  return { subject, text };
}

export function buildSuggestedFollowUp(lead) {
  const first = lead.name.split(" ")[0] || lead.name;
  const intent = lead.signals.messageIntent;

  const subject = intent === "hot"
    ? `Next steps on your home search, ${first}`
    : `Quick follow-up on your search goals, ${first}`;

  const body = intent === "hot"
    ? `Hi ${first},\n\nGreat connecting with you. I lined up 3 options that match what you asked for. Would you like a quick 10-minute call today to pick the best one and schedule tours?\n\n- Your agent`
    : `Hi ${first},\n\nI wanted to quickly check in. If your timeline is still active, I can send a tighter shortlist based on your must-haves. Reply with your top priorities and target move date.\n\n- Your agent`;

  return { subject, body };
}

export function buildBetaEndingReminderEmail({ userName, plan, daysLeft }) {
  const first = String(userName || "there").split(" ")[0];
  const dayText = daysLeft === 1 ? "1 day" : `${daysLeft} days`;
  const subject = daysLeft === 1
    ? "RealScoreAI beta ends tomorrow"
    : `RealScoreAI beta ends in ${dayText}`;

  const text = [
    `Hi ${first},`,
    "",
    `Your RealScoreAI ${plan} beta access ends in ${dayText}.`,
    "",
    "If you want to keep your lead scores, history, and workflow active with no data loss, move to early adopter pricing before beta ends.",
    "",
    "Reply to this email if you want your early adopter plan link set up immediately.",
    "",
    "- RealScoreAI Team"
  ].join("\n");

  return { subject, text };
}
