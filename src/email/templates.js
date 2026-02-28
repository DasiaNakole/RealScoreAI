function agentSignature(agentName) {
  const clean = String(agentName || "").trim();
  return clean ? `- ${clean}` : "- RealScoreAI";
}

export function buildMonthlyNurtureEmail(lead, agentName = "") {
  const subject = `Still searching, ${lead.name.split(" ")[0]}?`; 
  const text = [
    `Hi ${lead.name},`,
    "",
    "Just checking in with a light monthly update. If your home search is active again, reply with your top 2 priorities and we will line up options fast.",
    "",
    "No rush at all. When timing is right, we are ready.",
    "",
    agentSignature(agentName)
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

export function buildSuggestedFollowUp(lead, agentName = "") {
  const first = String(lead?.name || "there").split(" ")[0] || "there";
  const intent = String(lead?.signals?.messageIntent || "unknown").toLowerCase();
  const score = Number(lead?.score || 0);
  const progress = lead?.pipelineProgress && typeof lead.pipelineProgress === "object" ? lead.pipelineProgress : {};

  const pipelineOrder = [
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

  let stage = "consultation";
  for (const step of pipelineOrder) {
    if (progress[step]) stage = step;
  }
  if (lead?.stage) {
    const normalizedStage = String(lead.stage).trim().toLowerCase();
    if (pipelineOrder.includes(normalizedStage)) stage = normalizedStage;
  }

  const urgencyLine = score >= 75
    ? "If your schedule allows, I can move this forward today."
    : score >= 50
      ? "If timing still works for you, I can help line up the next step."
      : "No pressure at all. I can help whenever timing is right.";

  const toneCta = intent === "hot"
    ? "Would you like me to lock in the next step now?"
    : "Would you like me to help with the next step when you're ready?";

  const stageTemplates = {
    consultation: {
      subject: `Consultation follow-up, ${first}`,
      body: [
        `Hi ${first},`,
        "",
        "I wanted to follow up on your homebuying goals and timeline.",
        "I can set up a quick consultation to clarify budget, neighborhoods, and next steps.",
        "",
        toneCta,
        urgencyLine
      ]
    },
    exclusive_buyer_agreement: {
      subject: `Next step after our consultation, ${first}`,
      body: [
        `Hi ${first},`,
        "",
        "You are in a good spot to move into the next step.",
        "Once we have your buyer agreement in place, I can represent you fully and move faster on homes you like.",
        "",
        toneCta,
        urgencyLine
      ]
    },
    preapproval: {
      subject: `Preapproval step so we can move fast, ${first}`,
      body: [
        `Hi ${first},`,
        "",
        "The most important next step is getting preapproved so we know your exact buying range and can act quickly when the right home appears.",
        "If you want, I can send a lender intro or help you compare a few options.",
        "",
        toneCta,
        urgencyLine
      ]
    },
    home_search: {
      subject: `Updated home search options, ${first}`,
      body: [
        `Hi ${first},`,
        "",
        "I can tighten your home search based on your current priorities and send a stronger shortlist.",
        "Reply with your top must-haves and any neighborhoods you want to focus on this week.",
        "",
        toneCta,
        urgencyLine
      ]
    },
    schedule_visits: {
      subject: `Tour scheduling for your top homes, ${first}`,
      body: [
        `Hi ${first},`,
        "",
        "I have a few homes that fit what you are looking for and we can schedule visits around your availability.",
        "Send me your best times and I will coordinate the tour schedule.",
        "",
        toneCta,
        urgencyLine
      ]
    },
    home_inspection: {
      subject: `Home inspection next steps, ${first}`,
      body: [
        `Hi ${first},`,
        "",
        "I wanted to check in on inspection scheduling and make sure you know what to expect next.",
        "I can help coordinate timing and review any inspection items with you.",
        "",
        toneCta,
        urgencyLine
      ]
    },
    appraisal: {
      subject: `Appraisal status check-in, ${first}`,
      body: [
        `Hi ${first},`,
        "",
        "Just checking in on the appraisal step and lender timeline.",
        "If anything is pending, I can help keep communication moving so we stay on track.",
        "",
        toneCta,
        urgencyLine
      ]
    },
    sign_documents: {
      subject: `Closing documents prep, ${first}`,
      body: [
        `Hi ${first},`,
        "",
        "You are getting close. I wanted to make sure you feel ready for document signing and final closing steps.",
        "If you want, I can review the timeline and what to expect before signing.",
        "",
        toneCta,
        urgencyLine
      ]
    },
    closing: {
      subject: `Final closing steps, ${first}`,
      body: [
        `Hi ${first},`,
        "",
        "We are almost at the finish line.",
        "I wanted to confirm everything is on track for closing and help with any final questions.",
        "",
        toneCta,
        urgencyLine
      ]
    },
    closed: {
      subject: `Checking in after your closing, ${first}`,
      body: [
        `Hi ${first},`,
        "",
        "Congratulations again on your home purchase.",
        "I wanted to check in and make sure everything is going smoothly as you settle in.",
        "If you need anything or know someone who needs help buying or selling, I am happy to help.",
        "",
        "How is everything going so far?"
      ]
    }
  };

  const selected = stageTemplates[stage] || stageTemplates.consultation;
  return { subject: selected.subject, body: `${selected.body.join("\n")}\n\n${agentSignature(agentName)}` };
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
