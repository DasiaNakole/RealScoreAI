export const apiContracts = {
  lead: {
    id: "string",
    agentId: "string",
    name: "string",
    stage: "new|qualified|touring|nurture|closed",
    score: "0-100 integer",
    bucket: "today_focus|at_risk|low_value",
    whyScore: {
      summary: "string",
      strongest: "component",
      weakest: "component",
      details: "component[]"
    }
  },
  leadEvent: {
    type: "RESPONSE_TIME_RECORDED|MESSAGE_INTENT_UPDATED|FOLLOW_THROUGH_UPDATED|ENGAGEMENT_TOUCH_RECORDED",
    value: "number|string",
    meta: "object?"
  },
  dashboardResponse: {
    todayFocus: "lead[]",
    atRisk: "lead[]",
    lowValue: "lead[]"
  }
};
