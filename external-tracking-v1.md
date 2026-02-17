# External Tracking V1 (Beta-safe)

## Goal

Capture meaningful lead activity outside RealScoreAI without turning into a full CRM.

## Scope (only 3 integrations)

1. Link redirect tracking for listing URLs sent from RealScoreAI.
2. Email/calendar event ingestion from connected tools (reply, meeting booked).
3. Website pixel events on your own IDX/property pages.

## Architecture

- Generate tracked links from RealScoreAI:
  - `/r/:trackingId` -> logs click event -> redirects to listing URL.
- Receive external events:
  - `POST /api/webhooks/lead-activity` with `x-webhook-key`.
- Normalize to lead events:
  - `listing_clicked`
  - `reply_received`
  - `tour_booked`
  - `meeting_scheduled`
  - `offer_signal`

## Data model additions

- Add `lead_link_click` events into `events.metadata`.
- Optional table:
  - `tracking_links(id, user_id, lead_id, destination_url, created_at, click_count)`

## Rollout plan

1. Week 1: tracked links only.
2. Week 2: calendar booking webhook (tour booked).
3. Week 3: email reply webhook mapping.
4. Week 4: tune scoring weights with observed conversion outcomes.

## Privacy and compliance

- Add consent language in terms/privacy.
- Track only business-related interactions.
- Allow user opt-out of external tracking features.
