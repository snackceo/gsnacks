# Environment Variables

## Required (core backend)

MONGO_URI=
JWT_SECRET=

## Stripe variables

### Required for standard Stripe payments (checkout/session creation)

STRIPE_SECRET_KEY=

### Required for Stripe webhook signature verification

STRIPE_WEBHOOK_SECRET=

> If `STRIPE_WEBHOOK_SECRET` is not set, `/api/stripe/webhook` returns `Webhook not configured` and webhook processing is disabled.

---

## Optional

CLOUDINARY_KEY=
TWILIO_KEY=

---

## Rules

- Never commit .env
- Use strong secrets in production
