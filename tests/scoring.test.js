import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateLeadScore,
  responseTimeScore,
  messageIntentScore
} from '../src/scoring/engine.js';
import { classifyIntentFromMessage, calculateConfidenceScore } from '../src/ai/intelligence.js';

test('response time score gives high values for fast response', () => {
  assert.equal(responseTimeScore(4), 100);
  assert.equal(responseTimeScore(90), 60);
});

test('message intent score maps hot vs cold', () => {
  assert.equal(messageIntentScore('hot'), 100);
  assert.equal(messageIntentScore('cold'), 20);
});

test('calculateLeadScore uses low-value threshold below 50', () => {
  const result = calculateLeadScore({
    responseTimeMinutes: 300,
    messageIntent: 'neutral',
    followThroughRate: 0.4,
    weeklyEngagementTouches: 1
  });

  assert.ok(result.score < 50);
  assert.equal(result.bucket, 'low_value');
});

test('ai-assisted classifier detects strong positive intent', () => {
  const result = classifyIntentFromMessage('We are pre-approved and ready to buy. Can we tour this week?', 'neutral');
  assert.equal(result.intent, 'hot');
  assert.ok(result.confidence > 0.8);
});

test('confidence score returns bounded percentage', () => {
  const confidence = calculateConfidenceScore({
    signals: {
      responseTimeMinutes: 10,
      messageIntent: 'warm',
      followThroughRate: 0.7,
      weeklyEngagementTouches: 4
    },
    aiIntentClassification: { confidence: 0.72 },
    events: [{ type: 'MESSAGE_RECEIVED' }, { type: 'ENGAGEMENT_TOUCH_RECORDED' }]
  });

  assert.ok(confidence >= 0 && confidence <= 100);
});
