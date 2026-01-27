# Completed: GEMINI.md Architecture Clarification

## Overview

Successfully removed all confusing "Mode A/B/C/D" references from GEMINI.md and established a **clear, dual-scanner architecture** that aligns with actual implementation in the codebase.

## Problem Statement

GEMINI.md contained references to abstract "Scanner Mode A," "Mode C," etc., which:
1. Did not match actual code (ScannerMode enum uses `INVENTORY_CREATE`, `DRIVER_VERIFY_CONTAINERS`, etc.)
2. Mixed Receipt Scanner (dedicated, AI-powered) with Shared UPC Scanners in confusing ways
3. Made it hard to understand which scanner tool to use for which workflow
4. Made terminology lock and drift prevention vague and ineffective

## Solution Implemented

### 1. **Clear Architecture Definition (Section 3.1)**

Established two distinct, non-overlapping systems:

#### Receipt Scanner (Dedicated, Full-Screen, AI-Powered)
- Purpose: Capture receipt images with automatic store/product detection via Gemini Vision
- Workflow: Capture → Auto-parse → Review → Commit
- No store selection required (auto-detected)
- Separate from all other scanning

#### Shared UPC Scanners (ScannerModal)
- Purpose: Generic barcode/UPC capture for context-specific workflows
- 5 explicit modes with documented use cases
- Handler decides business logic (not the scanner)
- Stays open for continuous scanning until explicitly dismissed

### 2. **Expanded Receipt Workflow (Section 3.2)**

Six explicit steps with technical details:
1. **Open Receipt Scanner** — UI elements, no store selection
2. **Capture/Upload → Create ReceiptCapture** — API endpoint, response structure
3. **Immediately Trigger Parsing** — Critical invariant, prevents "stuck" captures
4. **Backend Parse** — Three concurrent operations (A, B, C)
5. **Review Screen** — Optional safety step with two approval paths
6. **Commit Updates** — Final state transitions, audit logging

### 3. **Shared Scanner Responsibilities (Section 3.3)**

Clear guardrails:
- ✅ **Responsibilities:** Camera management, cooldown logic, `onScan` callback
- ❌ **Must NOT:** Mutate inventory, auto-create products, decide business logic
- ✅ **Result Panel:** Create Product form (not preview cards)
- ✅ **Behavior:** Stay open for continuous scanning

### 4. **Separated Invariants (Section 4)**

Two distinct invariant sets:
- **Receipt Scanner (4 invariants):** Full-screen, no dialog, flash toggle, auto-parse critical
- **Shared UPC Scanner (3 invariants):** One scan = one action, cooldown handling, always show result

No confusion about which rules apply where.

### 5. **Updated Settings (Section 7.1)**

Before:
```
scanningModesEnabled.{A|B|C|D}
```

After:
```
scanningModesEnabled:
  - inventoryCreate
  - upcLookup
  - driverVerifyContainers
  - customerReturnScan
```

Settings now self-document and match code enums exactly.

### 6. **Role-Specific Workflows (Section 8)**

Clear mapping of tools to roles:

| Role | Tools | Purpose |
|------|-------|---------|
| **Management** | Receipt Scanner, INVENTORY_CREATE, UPC_LOOKUP | Price detection, stock intake, UPC mapping |
| **Driver** | DRIVER_VERIFY_CONTAINERS, DRIVER_FULFILL_ORDER | Returns verification, pack validation |
| **Customer** | CUSTOMER_RETURN_SCAN | Build return lists |

### 7. **Terminology Lock (Section 9)**

Explicit forbidden terms:
- ❌ "Mode A/B/C/D" (use explicit mode names)
- ❌ "duplicate scanners" (only one Receipt Scanner, one ScannerModal)
- ❌ "product-id" (use "SKU" for business identity)
- ❌ "silent scan ignore"

### 8. **Enforcement Principle (Section 10)**

Makes clear that introducing:
- A second scanner ❌
- A second UPC table ❌
- Client-generated SKUs ❌
- Silent scan failures ❌

...is **invalid** and must be rejected.

## Alignment with Codebase

All documentation now aligns with:
- **[src/types.ts](../src/types.ts)** → ScannerMode enum with 5 explicit modes
- **[src/components/ScannerModal.tsx](../src/components/ScannerModal.tsx)** → Shared UPC scanner implementation
- **[src/components/ReceiptCaptureFlow.tsx](../src/components/ReceiptCaptureFlow.tsx)** → Dedicated receipt scanner
- **[server/routes/receipt-prices.js](../server/routes/receipt-prices.js)** → Backend parse workflow
- **Copilot instructions** → GEMINI.md as source of truth for architecture

## Key Improvements

| Aspect | Before | After |
|--------|--------|-------|
| **Clarity** | Abstract modes (A/C/D) | Explicit names (INVENTORY_CREATE, DRIVER_VERIFY_CONTAINERS, etc.) |
| **Searchability** | Hard to grep for modes | Can search code for exact mode names |
| **Architecture** | Merged, confusing | Clear separation (Receipt Scanner vs. ScannerModal) |
| **Settings** | Mysterious `{A\|B\|C\|D}` | Self-documenting field names |
| **Role Mapping** | "Uses Mode C" | "Uses DRIVER_VERIFY_CONTAINERS for returns verification" |
| **Drift Prevention** | Vague | Explicit with forbidden terms + enforcement principle |

## Validation Checklist

- ✅ All "Mode A/B/C/D" references removed from GEMINI.md
- ✅ Receipt Scanner architecture clearly documented (Section 3)
- ✅ Shared UPC Scanners clearly documented (Section 3.3)
- ✅ All 5 scanner modes explicitly listed with use cases
- ✅ AppSettings scanner configuration updated (Section 7.1)
- ✅ Role-specific workflows clarified (Section 8)
- ✅ Terminology lock strengthened (Section 9)
- ✅ Enforcement principle established (Section 10)
- ✅ All references validated against codebase
- ✅ No orphaned sections or incomplete steps

## Files Modified

1. **c:\Users\yohra\Gsnacks\gsnacks\GEMINI.md** — Sections 3, 4, 7, 8, 9 updated
2. **c:\Users\yohra\Gsnacks\gsnacks\GEMINI_CLEANUP_SUMMARY.md** — Created (detailed change log)

## Next Actions (If Needed)

Optional cleanup:
- [ ] Update copilot-instructions.md if it contains Mode A/B/C/D references
- [ ] Verify no other documentation files contain "Mode A/B/C/D" (via grep)
- [ ] Add this architecture to any onboarding/training materials

## Conclusion

**GEMINI.md is now the authoritative, non-ambiguous source for scanner architecture.** 

The dual-scanner design (Receipt Scanner + Shared UPC Scanners) is:
- ✅ Clearly defined
- ✅ Well-documented with technical details
- ✅ Aligned with actual code
- ✅ Locked against drift via terminology restrictions
- ✅ Enforced via principles in Section 10

---

**Status:** ✅ COMPLETE  
**Date Completed:** January 27, 2026  
**Quality:** Production-ready documentation
