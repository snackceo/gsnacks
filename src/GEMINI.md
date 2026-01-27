NinpoSnacks Frontend — Scanner + Receipt + SKU UX Contract (Hardened)

This document defines non-negotiable UI/UX and control-flow guarantees for scanners, receipts, and SKU identity.
Any implementation that violates these rules is considered broken, even if it “technically works”.

Related docs:

Domain terms & roles: GLOSSARY.md

System philosophy: GEMINI.md

Backend rules & invariants: server/GEMINI.md

1. Identity & Operator Mental Model (HARD RULE)

SKU (NP-000001) is the primary business identifier everywhere

Never display raw database IDs to operators

Replace all “Product ID” labels with “SKU”

Internal id may exist only for:

React keys

API references

If an operator cannot answer “what SKU is this?” → the UI is wrong

2. Receipt Scanner (Dedicated, Full-Screen, Auto-Parse)
Purpose

Receipt capture exists only to feed pricing intelligence and catalog seeding.
It must never feel optional, fragile, or silent.

When used

Operator scans or uploads a receipt image

No UPC scanning

No modal reuse

No shared ScannerModal

UX requirements (NON-NEGOTIABLE)

Full-screen camera view

Prominent controls:

Capture

Upload

Flash toggle

Cancel

No store selection required in the scanner

No nested modals, no background UI visible

3. Receipt Capture → Parse Contract (CRITICAL)
Required flow (cannot be skipped)

Capture or upload image

Backend creates ReceiptCapture

Frontend MUST immediately call
POST /api/driver/receipt-parse

Backend attempts parse

Result becomes one of:

PARSED

NEEDS_REVIEW

FAILED

UI transitions accordingly

❗ A receipt is considered broken if it exists in pending_parse without an active or scheduled parse attempt.

4. Auto-Parse Is Mandatory (No “Later”)

There is no manual “Parse” button

There is no user confirmation step

Capture always implies parse

If parse fails:

User is told immediately

System retries (see §6)

If the operator points the camera at a receipt and “nothing happens”, this contract is violated.

5. Receipt Status Semantics (HARD DEFINITIONS)
Status	Meaning	UI Behavior
pending_parse	Capture exists but parse not yet completed	Temporary only
parsing	Parse attempt in progress	Show “Parsing…”
parsed	Parsed cleanly, no review needed	Show result immediately
needs_review	Parsed with warnings or ambiguity	Show review screen
failed	Parse exhausted retries	Show error + retry option
committed	Applied to catalog	Read-only
Forbidden state

pending_parse lasting longer than a short retry window
→ must transition to failed

6. Retry & Anti-Stuck Rules (THIS FIXES YOUR SEEDING)
Retry policy (server-side)

Parse retries are automatic

Retry if:

network error

429 / timeout

Gemini transient failure

Max attempts: 5

Backoff (example):

30s → 2m → 10m → 30m → 2h

After max attempts:

mark FAILED

persist parseError

Frontend guarantees

UI must reflect:

“Retrying parse (attempt 2/5)”

or “Parse failed — retry now”

Silent failure is forbidden

The system must never “wait forever and hope”.

7. Review UX (Make It Impossible to Miss Work)

“Pending Review” must include:

NEEDS_REVIEW

optionally PARSED (if operator validation is desired)

UI must not hide successfully parsed receipts

If nothing appears, the UI is wrong — not the user

8. Barcode / UPC Scanners (Shared Mechanics Only)
Shared ScannerModal is allowed ONLY for:

Inventory receiving (INVENTORY_CREATE)

UPC registry (UPC_LOOKUP)

Driver returns verification

Driver fulfillment

Customer return list building

Explicitly forbidden

Using shared ScannerModal for receipt parsing

Receipt scanning is not barcode scanning.

9. UPC Scanner UX Rules (Hardened)
Cooldown behavior

Cooldown blocks must still notify

Toast required:

“Same UPC — tap to add again”

A blocked scan still counts as user feedback

Result panel rules

Bottom sheet stays open

Camera stays active

No duplicate preview cards

Show:

UPC

Product name

SKU

storageZone / storageBin

mapping status

10. Unmapped UPC Handling (No Dead Ends)

When UPC is unmapped:

Open UnmappedUpcModal

Two options, always:

Create product + link UPC

Attach UPC to existing SKU (searchable)

No silent failure. No “nothing happened”.

11. Seeding-First Philosophy (Explicit)

For early seeding:

Prefer review-first over auto-commit

Never mutate catalog without visibility

Receipts are inputs, not truth

Operators must always see what the system believes

If seeding feels unreliable, the contract is being violated.

12. Non-Negotiable UX Principle

Every scan produces an observable outcome.
If the user acts and the system is silent, the system is broken.