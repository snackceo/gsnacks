# Checkout UI & Fees Validation

## Test Scenario 1: Large Order Handling Fee
**Setup:**
- Create/edit a product: e.g., "Widget A" for $5.00
- Ensure default settings: `largeOrderIncludedItems: 10`, `largeOrderPerItemFee: $0.30`

**Test:**
1. Add 12× "Widget A" to cart → 2 extra items over threshold
2. Open CartDrawer
3. Verify in totals:
   - **Items Subtotal:** $60.00
   - **Michigan Bottle Deposit (10¢ each):** should show if items have deposit
   - **Route Fee:** $4.99 (or configured base)
   - **Distance Fee (X.Y mi):** if address entered
   - **Large Order Handling:** $0.60 (2 items × $0.30) ✓
   - **Preview Total After Credit:** includes all above

---

## Test Scenario 2: Heavy Item Handling Fee
**Setup:**
- Create/edit a product: e.g., "Heavy Drink" for $3.00
- **Toggle "Heavy Item" checkbox** → Save
- Ensure default settings: `heavyItemFeePerUnit: $1.50`

**Test:**
1. Add 2× "Heavy Drink" to cart
2. Open CartDrawer
3. Verify in totals:
   - **Items Subtotal:** $6.00
   - **Heavy Item Handling:** $3.00 (2 units × $1.50) ✓
   - **Preview Total After Credit:** includes all fees

---

## Test Scenario 3: Combined Large Order + Heavy Item + Deposit
**Setup:**
- Product 1: "Light Item" $2.00 (no heavy flag, with deposit)
- Product 2: "Heavy Item" $4.00 (heavy flag, with deposit)

**Test:**
1. Add 12× "Light Item" + 3× "Heavy Item" to cart
2. Enter delivery address
3. Verify totals show:
   - **Items Subtotal:** (12 × $2) + (3 × $4) = $36.00
   - **Michigan Bottle Deposit (10¢ each):** (12 + 3) × $0.10 = $1.50
   - **Route Fee:** $4.99
   - **Distance Fee (X.Y mi):** varies by address
   - **Large Order Handling:** (15 - 10) × $0.30 = $1.50 ✓
   - **Heavy Item Handling:** 3 × $1.50 = $4.50 ✓
   - **Preview Total:** correctly sums all fees

---

## Test Scenario 4: Pickup-Only Order (Returns Only)
**Setup:**
- No products in cart
- Scan container UPCs only

**Test:**
1. Scan eligible return UPCs
2. Verify:
   - **Route Fee:** shows as reduced (pickupOnlyMultiplier = 0.5) or adjusted label
   - **Large Order Handling:** should NOT appear (RETURNS_PICKUP order type) ✓
   - **Heavy Item Handling:** should NOT appear (RETURNS_PICKUP order type) ✓
   - **Michigan Bottle Deposit:** not applicable for returns

---

## Test Scenario 5: Label & Wording Verification
**Check these exact strings in CartDrawer totals section:**
- [ ] "Items Subtotal" (not just "Subtotal")
- [ ] "Michigan Bottle Deposit (10¢ each)" (exact legal wording)
- [ ] "Route Fee" (unified, no "— Delivery Order/Pickup-Only Order" suffix in main label)
- [ ] "Distance Fee (X.Y mi)" format
- [ ] "Large Order Handling" (when applicable)
- [ ] "Heavy Item Handling" (when applicable)

---

## Test Scenario 6: Inventory Management – Heavy Item Toggle
**Test:**
1. Go to Management > Inventory
2. Scan UPC to create/edit product
3. Verify **"Heavy Item" checkbox** appears below "Eligible for Michigan Deposit Refund"
4. Toggle it ON, save
5. Quote request should include `heavyItemFee` in response
6. Checkout should display "Heavy Item Handling" fee line

---

## Backend Validation Checklist
- [ ] `Quote` endpoint returns `largeOrderFee` and `heavyItemFee` in JSON
- [ ] `create-session` endpoint includes "Large Order Handling" and "Heavy Item Handling" as Stripe line items
- [ ] `Order` model persists `largeOrderFee` and `heavyItemFee` fields
- [ ] `mapOrderForFrontend` includes new fee fields
- [ ] `PaymentSuccess` displays new fees correctly

---

## Notes
- All fee calculations apply **only to DELIVERY_PURCHASE orders**, not returns-only
- Handling fees are configurable via Management Settings
- Frontend must handle cases where fees are $0.00 (gracefully hide or show as $0.00)
