# Environment Variables

## Required (core backend)

MONGO_URI=
JWT_SECRET=

## Stripe variables

### Required for standard Stripe payments (checkout/session creation)

STRIPE_SECRET_KEY=

### Required for Stripe webhook signature verification

STRIPE_WEBHOOK_SECRET=

> `STRIPE_WEBHOOK_SECRET` must be the signing secret for `/api/stripe/webhook` (starts with `whsec_...`).
>
> - Production: copy it from the Stripe Dashboard webhook endpoint config.
> - Local dev: run `stripe listen --forward-to localhost:5000/api/stripe/webhook` and use the `whsec_...` value printed by Stripe CLI.
> - If this value is missing, webhook verification is disabled and `/api/stripe/webhook` returns `Webhook not configured`.

---

## Optional

CLOUDINARY_KEY=
TWILIO_KEY=

---

## Rules

- Never commit .env
- Use strong secrets in production
