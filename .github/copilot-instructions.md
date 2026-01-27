# NinpoSnacks – AI / Copilot Instructions (STRICT, HARDENED)

> **Audience:** AI coding agents (Copilot, ChatGPT, codegen tools)  
> **Purpose:** Prevent silent failure, invented state, and UX regressions  
> **Source of Truth (in order):**
> 1. GEMINI.md  
> 2. server/GEMINI.md  
> 3. GLOSSARY.md  
> 4. README.md  
>
> If generated code conflicts with docs, **the code is wrong**.

---

## 0) PRIME DIRECTIVE (NON-NEGOTIABLE)

**NinpoSnacks is a receipt-driven, seeding-first system.**

AI tools must optimize for:
- determinism
- observability
- safety
- explicit state transitions

NOT for:
- convenience
- “best guesses”
- silent fallbacks
- magical UX

### Absolute prohibitions
- ❌ Do NOT invent frontend state
- ❌ Do NOT hide errors or swallow failures
- ❌ Do NOT assume async data exists
- ❌ Do NOT reuse scanners across incompatible workflows
- ❌ Do NOT add client-side retry loops unless explicitly instructed
- ❌ Do NOT create or mutate catalog data silently

### Required behavior
- ✅ Every user action must produce a visible result
- ✅ Fail loudly instead of failing silently
- ✅ Prefer explicit empty states over optimistic rendering

> If a user acts and “nothing happens”, the system is broken.

---

## 1) SYSTEM PHILOSOPHY

### Backend is the source of truth
- Frontend **requests, displays, submits**
- Backend **validates, decides, mutates**
- Frontend never “fixes” backend ambiguity

### Seeding > polish
- Receipt ingestion must be reliable before elegant
- Review visibility beats automation
- Deterministic pipelines beat “AI magic”

---

## 2) IDENTITY RULES (HARD)

- **SKU (NP-000001) is the only business identifier shown to humans**
- Never display raw database IDs
- Replace any “Product ID” label with **“SKU”**
- Internal `id` may exist ONLY for:
  - React list keys
  - API references

If an operator cannot answer **“what SKU is this?”**, the UI is invalid.

---

## 3) RECEIPT SCANNING (CRITICAL SYSTEM)

### Receipt scanning is a DEDICATED workflow
- ❌ Do NOT use `ScannerModal`
- ❌ Do NOT reuse UPC / barcode scanning logic
- ❌ Do NOT require store selection inside the scanner
- ❌ Do NOT gate parsing behind confirmation clicks
- ✅ Use a **full-screen receipt camera UI**

### Mandatory capture → parse flow
1. Capture or upload image
2. Backend creates `ReceiptCapture`
3. **Frontend MUST immediately call**  
   `POST /api/driver/receipt-parse`
4. Backend attempts parse
5. Receipt transitions to one of:
   - `PARSED`
   - `NEEDS_REVIEW`
   - `FAILED`

> A receipt that exists without an active or scheduled parse attempt is INVALID.

---

## 4) AUTO-PARSE IS NOT OPTIONAL

- There is NO manual “Parse” button
- There is NO “parse later” state
- Capture **always implies parse**
- If parsing fails:
  - the user must be told
  - the system must retry (server-side)

Silent failure is forbidden.

---

## 5) RECEIPT STATUS SEMANTICS (STRICT)

| Status | Meaning | UI Expectation |
|------|--------|----------------|
| pending_parse | Capture exists, parse not finished | Temporary only |
| parsing | Parse attempt in progress | Show progress |
| parsed | Parsed cleanly | Show result |
| needs_review | Parsed with ambiguity | Show review UI |
| failed | Parse exhausted retries | Show error + retry |
| committed | Applied to catalog | Read-only |

### Forbidden state
- `pending_parse` persisting indefinitely  
  → must transition to `failed`

---

## 6) RETRY & ANTI-STUCK POLICY (SERVER-SIDE)

### Retry rules
- Retry parse on:
  - network errors
  - timeouts
  - 429 / transient AI errors
- Max attempts: **5**
- Backoff example:
  - 30s → 2m → 10m → 30m → 2h
- After max attempts:
  - mark `FAILED`
  - persist `parseError`

### Frontend requirements
- Show retry state visibly
- Show attempt count
- Never pretend work is happening when it isn’t

---

## 7) REVIEW UX (NO HIDDEN WORK)

- “Pending Review” must include:
  - `NEEDS_REVIEW`
  - optionally `PARSED` (if operator validation is desired)
- UI must NOT hide successfully parsed receipts
- Empty states must explain WHY they are empty

If review queues appear empty while work exists, the UI is broken.

---

## 8) BARCODE / UPC SCANNERS (SHARED MECHANICS ONLY)

### Allowed uses of `ScannerModal`
- Inventory receiving (`INVENTORY_CREATE`)
- UPC registry (`UPC_LOOKUP`)
- Driver return verification
- Driver fulfillment
- Customer return list building

### Explicitly forbidden
- Using shared scanner logic for receipt parsing

Receipt scanning ≠ barcode scanning.

---

## 9) UPC SCAN UX RULES (HARDENED)

### Cooldown behavior
- Cooldown blocks MUST still notify the user
- Required toast:
  > “Same UPC — tap to add again”
- A blocked scan still counts as feedback

### Result panel rules
- Bottom sheet stays open
- Camera stays active
- No duplicate preview cards
- Always display:
  - UPC
  - Product name
  - SKU
  - storageZone / storageBin
  - mapping status

---

## 10) UNMAPPED UPC HANDLING (NO DEAD ENDS)

When UPC is unmapped:
- Open `UnmappedUpcModal`
- Always present both options:
  1. Create product + link UPC
  2. Attach UPC to existing SKU

Silent failure or dismissal is forbidden.

---

## 11) ROLE ENFORCEMENT (NEVER TRUST UI)

- UI role is advisory only
- Backend always enforces permissions
- AI tools must never bypass:
  - `authRequired`
  - `ownerRequired`
  - `managerOrOwnerRequired`

---

## 12) TYPE & ENUM SAFETY

- Always use enums from `src/types.ts`
- ❌ No string literals for:
  - roles
  - scanner modes
  - order statuses
- ❌ No `as any` to bypass type checks

---

## 13) ERROR HANDLING RULE

- Rendering code must assume:
  - async data can be `undefined`
  - arrays may be empty
- All `.map()` calls must be guarded
- Crashing on missing data is a bug

---

## 14) FINAL INVARIANT

> **Every scan produces an observable outcome.**  
> If the user acts and the system is silent, the implementation is invalid.

---

**Last Updated:** January 2026  
**Maintainer:** GEMINI.md
