export const plans = {
  bronze: {
    id: "bronze",
    name: "Bronze",
    priceMonthlyUsd: 29,
    trialDays: 30,
    features: {
      automation: false,
      teamWorkspace: false
    },
    limits: {
      users: 1,
      leads: 100,
      digestsPerDay: 1
    }
  },
  silver: {
    id: "silver",
    name: "Silver",
    priceMonthlyUsd: 49,
    trialDays: 30,
    features: {
      automation: true,
      teamWorkspace: false
    },
    limits: {
      users: 1,
      leads: 2500,
      digestsPerDay: 3
    }
  },
  gold: {
    id: "gold",
    name: "Gold",
    priceMonthlyUsd: 199,
    trialDays: 30,
    features: {
      automation: true,
      teamWorkspace: true
    },
    limits: {
      users: 10,
      leads: 10000,
      digestsPerDay: 10
    }
  }
};

const PLAN_ALIASES = {
  core: "bronze",
  pro: "silver",
  team: "gold",
  platinum: "gold"
};

export function resolvePlanId(planId) {
  const normalized = String(planId || "").trim().toLowerCase();
  return PLAN_ALIASES[normalized] || normalized;
}

export function getPlan(planId) {
  const resolved = resolvePlanId(planId);
  return plans[resolved] || null;
}

export function listPlans() {
  return Object.values(plans);
}

export function hasAutomationAccess(planId) {
  const plan = getPlan(planId);
  return Boolean(plan?.features?.automation);
}
