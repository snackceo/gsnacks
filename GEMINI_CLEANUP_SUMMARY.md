# GEMINI.md Cleanup & Architecture Clarification

**Date:** January 27, 2026  
**Purpose:** Remove confusing "Mode A/B/C/D" references and clarify the dual-scanner architecture

## Changes Made

### 1. **Section 3.1 - Receipt Scanner Architecture (Updated)**

**Before:**
- Mentioned "Supported modes: CUSTOMER_RETURN_SCAN" (incomplete and confusing)
- Mixed Receipt Scanner with Shared Scanner in the same section
- Unclear distinction between the two approaches

**After:**
- Clear separation of **Receipt Scanner (Dedicated, Full-Screen, AI-Powered)** with dedicated purpose
- Explicit list of **Shared UPC Scanners (ScannerModal)** with all 5 modes:
  - `INVENTORY_CREATE` — Admin stock intake
  - `UPC_LOOKUP` — UPC registry maintenance
  - `DRIVER_VERIFY_CONTAINERS` — Returns verification
  - `DRIVER_FULFILL_ORDER` — Pack validation
  - `CUSTOMER_RETURN_SCAN` — Customer returns

### 2. **Section 3.2 - Complete Receipt Capture Workflow (Expanded)**

**New Content Added:**
- **Step 1:** Open Receipt Scanner (Full-Screen) — with all UI elements
- **Step 2:** Capture/Upload → Create ReceiptCapture — technical flow
- **Step 3:** Immediately Trigger Parsing (Automatic & Critical) — idempotency and critical invariant
- **Step 4:** Backend Parse (Three Concurrent Operations) — A, B, C operations detailed
- **Step 5:** Review Screen (Optional but Recommended Safety Step) — review workflow
- **Step 6:** Commit Updates (Backend) — final approval and state transition

Each step is now explicit with technical details (endpoint names, status transitions, data structures).

### 3. **Section 3.3 - Shared Scanners (Separated)**

**New Section Created:**
- Extracted from confusing merged state
- Clear "When NOT using Receipt Scanner" context
- Explicit list of shared scanner responsibilities
- "Must NOT" guardrails (no silent mutations, no auto-creation)
- Result panel requirement (forms, not preview cards)

### 4. **Section 4 - Scanner Invariants (Reorganized)**

**Before:**
- Mixed receipt and shared scanner invariants

**After:**
- **Section 4.1:** Receipt Scanner Invariants (4 items)
- **Section 4.2:** Shared UPC Scanner Invariants (3 items)

Clear separation ensures no confusion about which invariants apply to which scanner type.

### 5. **Section 7.1 - AppSettings Scanner Configuration (Updated)**

**Before:**
```
* `scanningModesEnabled.{A|B|C|D}`
```

**After:**
```
* `scanningModesEnabled` — Feature toggles for scanner modes:
  - `inventoryCreate` — Admin stock intake
  - `upcLookup` — UPC registry maintenance
  - `driverVerifyContainers` — Returns verification
  - `customerReturnScan` — Customer returns
```

No more mysterious Mode A/B/C/D references. Explicit, self-documenting field names.

### 6. **Section 8 - Role‑Specific Workflows (Renamed & Updated)**

**Before:**
- Section 8 titled "Role‑Specific Scan Flows"
- References to "Uses Mode A," "Uses Mode C" (confusing)
- Incomplete descriptions

**After:**
- Section 8 titled "Role‑Specific Workflows" (clearer intent)
- **8.1 Management:** Explicitly states "Receipt Scanner" + INVENTORY_CREATE + UPC_LOOKUP
- **8.2 Driver:** Explicitly states DRIVER_VERIFY_CONTAINERS + DRIVER_FULFILL_ORDER
- **8.3 Customer:** Explicitly states CUSTOMER_RETURN_SCAN

Each section now names the concrete tools/modes, not abstract modes.

### 7. **Section 9 - Terminology Lock (Updated)**

**Before:**
```
* Scanner Mode A/C/D
```

**After:**
```
* Scanner modes: `INVENTORY_CREATE`, `UPC_LOOKUP`, `DRIVER_VERIFY_CONTAINERS`, `DRIVER_FULFILL_ORDER`, `CUSTOMER_RETURN_SCAN`
* Receipt Scanner (dedicated, full-screen)
* ScannerModal (shared, for barcode capture)
```

**Forbidden Drift Terms Added:**
```
* Mode A/B/C/D (use explicit mode names instead)
```

## Impact

### For Developers

1. **Clarity:** No more guessing what "Mode A" or "Mode C" means
2. **Searchability:** Explicit `INVENTORY_CREATE`, `DRIVER_VERIFY_CONTAINERS` etc. are in code
3. **Architecture:** Clear mental model: Receipt Scanner (dedicated) vs. ScannerModal (shared UPC capture)
4. **Consistency:** Settings field names match code enums and documentation

### For Code Review

1. **Drift Prevention:** Section 9 Terminology Lock explicitly forbids reintroduction of Mode A/B/C/D
2. **Enforcement:** Section 10 explicitly states that introducing multiple scanners or modes is invalid
3. **Reference:** Documentation now aligns with actual code (ScannerMode enum in types.ts)

### For Maintainers

- Receipt Scanner architecture is now unambiguously documented
- All 5 shared scanner modes are explicitly listed with use cases
- No more "mysterious modes" that need to be reverse-engineered from code

## Files Modified

- **c:\Users\yohra\Gsnacks\gsnacks\GEMINI.md** — Updated sections 3, 4, 7, 8, 9

## Validation

All changes have been validated against:
- ✅ [src/types.ts](../src/types.ts) — ScannerMode enum matches documentation
- ✅ [server/GEMINI.md](../server/GEMINI.md) — Backend contract references
- ✅ Copilot instructions file — References to modes now consistent

## Next Steps

None required. GEMINI.md is now the **authoritative source** for scanner architecture.

---

**Signed off:** Copilot Agent  
**Verified:** All terminology locked in Section 9
