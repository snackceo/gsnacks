<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1I0e8onKLS1Mjv8Qd3l31GTFKtpI04EBx

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Return-only regression checklist

Use this quick checklist when validating return-only flow changes:

1. Return-only checkout (no cart items, UPCs only) with a count payload.
2. Driver verification + capture using counted UPCs.
3. Confirm credits, verified counts, and UI totals align.
