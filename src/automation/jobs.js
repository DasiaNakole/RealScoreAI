import { buildDailyDigestEmail, buildMonthlyNurtureEmail } from "../email/templates.js";
import { sendEmail } from "../email/service.js";
import { store } from "../data/store.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysSince(dateIso) {
  return (Date.now() - new Date(dateIso).getTime()) / MS_PER_DAY;
}

function shouldSendMonthlyNurture(lastSentAt) {
  if (!lastSentAt) return true;
  return daysSince(lastSentAt) >= 30;
}

export async function autoNurtureLowScoreLeads(agentId) {
  const movedLeadIds = [];
  const emailedLeadIds = [];

  for (const lead of store.byAgent(agentId)) {
    if (lead.score < 50) {
      if (lead.stage !== "nurture") {
        lead.stage = "nurture";
        movedLeadIds.push(lead.id);
        store.incrementUsage(agentId, "autoNurtureMoves");
      }

      if (shouldSendMonthlyNurture(lead.lastNurtureEmailAt)) {
        const email = buildMonthlyNurtureEmail(lead);
        await sendEmail({
          to: lead.email,
          subject: email.subject,
          text: email.text
        });
        lead.lastNurtureEmailAt = new Date().toISOString();
        emailedLeadIds.push(lead.id);
        store.incrementUsage(agentId, "nurtureEmailsSent");
      }
    }
  }

  return {
    job: "auto_nurture_low_score",
    threshold: 50,
    movedLeadIds,
    emailedLeadIds,
    movedCount: movedLeadIds.length,
    emailedCount: emailedLeadIds.length
  };
}

export function weeklyReactivationReminder(agentId) {
  const staleLeads = store
    .byAgent(agentId)
    .filter((lead) => lead.score >= 50 && lead.score < 75 && daysSince(lead.lastActivityAt) >= 5)
    .map((lead) => ({ id: lead.id, name: lead.name, score: lead.score }));

  if (staleLeads.length > 0) {
    store.incrementUsage(agentId, "reactivationsSent", staleLeads.length);
  }

  return {
    job: "weekly_reactivation_reminder",
    reminders: staleLeads,
    count: staleLeads.length
  };
}

export async function dailyFocusDigest(agentId, agentEmail, agentName = "Agent") {
  const top = store
    .byAgent(agentId)
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((lead) => ({
      id: lead.id,
      name: lead.name,
      score: lead.score,
      reason: lead.whyScore.summary
    }));

  let delivery = null;
  if (top.length > 0 && agentEmail) {
    const digest = buildDailyDigestEmail(agentName, top);
    delivery = await sendEmail({
      to: agentEmail,
      subject: digest.subject,
      text: digest.text
    });
    store.incrementUsage(agentId, "digestsSent");
  }

  return {
    job: "daily_focus_digest",
    to: agentEmail,
    leadCount: top.length,
    leads: top,
    delivery
  };
}
