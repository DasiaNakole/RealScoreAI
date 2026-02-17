export const plans = {
  core: {
    id: "core",
    name: "Core",
    priceMonthlyUsd: 79,
    trialDays: 30,
    limits: {
      users: 1,
      leads: 500,
      digestsPerDay: 1
    }
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceMonthlyUsd: 129,
    trialDays: 30,
    limits: {
      users: 5,
      leads: 2500,
      digestsPerDay: 3
    }
  }
};

export function listPlans() {
  return Object.values(plans);
}
