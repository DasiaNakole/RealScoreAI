import Stripe from "stripe";
import { plans } from "./plans.js";
const isProduction = process.env.NODE_ENV === "production";
const APP_URL = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

function getStripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

export async function createCheckoutSession({ planId, customerEmail }) {
  const selected = plans[planId];
  if (!selected) {
    throw new Error("Invalid planId. Use core or pro.");
  }

  const stripe = getStripeClient();
  if (!stripe) {
    if (isProduction) {
      throw new Error("STRIPE_SECRET_KEY is required in production.");
    }
    return {
      mode: "mock",
      message: "Set STRIPE_SECRET_KEY to create a real Stripe checkout session.",
      plan: selected
    };
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer_email: customerEmail,
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: `${selected.name} Plan`
          },
          unit_amount: selected.priceMonthlyUsd * 100,
          recurring: {
            interval: "month",
            trial_period_days: selected.trialDays
          }
        },
        quantity: 1
      }
    ],
    success_url: `${APP_URL}/app.html?billing=success`,
    cancel_url: `${APP_URL}/?billing=cancelled`
  });

  return {
    mode: "stripe",
    checkoutUrl: session.url,
    sessionId: session.id
  };
}
