GREEN (UserTier): Active eco-friendly/subscription tier. Green tier rules: flat $1 Route Fee and no Distance Fee; credits can apply to Route Fee since distance fee is always $0. This tier is available now and can be enabled via settings.
membershipTier (string field): The user’s current membership tier (COMMON, BRONZE, SILVER, GOLD, PLATINUM, GREEN). Tiers gate certain benefits (credits usage, cash-out eligibility, discounts). Platinum is a hidden tier (invite-only), and Green is active. Tier advancement is primarily based on completed orders. Minimum lifetime product spend thresholds exist to ensure fair use and system sustainability. Advancement requirements:
Feature Toggles: The presence of scanningModesEnabled and flags for Platinum/Green tiers indicate configurable features. Mode D (driver order fulfillment scanning) is active in DriverView via DRIVER_FULFILL_ORDER, alongside returns verification scanning. The Green tier is defined and active; operators can enable it in settings. Legacy references like deliveryFee (older nomenclature) are deprecated by unified terms (Route Fee) and kept for backward compatibility.
...verification status using maybeAutoPromote. For example, once a user completes 50 orders and has phone verified, they become Silver. When they hit 100 and have ID verified, they become Gold. Platinum is invite-only (not auto-promoted) – an owner would manually set membershipTier to PLATINUM (which might require allowPlatinumTier flag on). The tiers grant benefits (as described in Payments domain: credits usage and cash-out eligibility, plus route fee discounts for Bronze 10%, Silver 20%, Gold 30%). Green tier is active and can be assigned per operator policy. Documenting these ensures any code branch or query that deals with user tier uses correct values and knows the implications.
## Invariant Rule: Frontend API Calls

All frontend API calls MUST follow these rules:


1. Use `${BACKEND_URL}/api/...` for all API endpoints.
2. Always include `credentials: 'include'` in fetch options. The frontend does not read cookies directly; the browser attaches them automatically to API requests when `credentials: 'include'` is set. Removing this option will break authentication.
3. Never use relative paths (e.g., `/server`, `/users`, etc.) for API calls.
4. Never redefine `BACKEND_URL` locally in any file—import it from the shared constant.
5. **Recommended:** All API requests should go through a shared `apiFetch()` wrapper that always sets `credentials: 'include'`.

**This rule alone prevents 80% of common integration issues.**

See `src/constants.tsx` for the canonical `BACKEND_URL` export and usage examples.
# Feature Toggles & Experimental Features

**maintenanceMode**: If true, disables all customer-facing endpoints except health.

**requirePhotoForRefunds**: If true, customers must upload a photo for refund requests.

**allowGuestCheckout**: If true, allows orders without user registration.

**showAdvancedInventoryInsights**: Enables advanced inventory analytics in admin UI.

**allowPlatinumTier**: Enables Platinum loyalty tier (future/experimental).

**platinumFreeDelivery**: If true, Platinum tier users get free delivery (future/experimental).
LifetimeProductSpend (numeric, derived): The cumulative dollar amount a user has spent on products only, across all completed orders, excluding Route Fee, Distance Fee, Taxes, Tips, Refunds, and chargebacks. LifetimeProductSpend is used as a primary eligibility metric for tier advancement and retention. It represents a customer’s net economic value, not activity volume. Calculated from completed (PAID / DELIVERED) orders, reduced by refunded product amounts, and does not include credits used, only the underlying product value. Authoritative source is the backend; frontend may display an approximation.

TierDemotion (policy / system behavior): The process by which a user’s membership tier is reduced due to inactivity, spend regression, trust loss, or risk. Demotion occurs one tier at a time and is automatic when policy thresholds are met. The owner may manually demote or freeze a tier at any time. Common demotion triggers include: prolonged inactivity, LifetimeProductSpend falling below a tier’s retention threshold, loss of required verification (phone or photo ID), abuse, fraud, or excessive refunds. Tiers are not permanent entitlements and reflect ongoing trust and economic viability.

CreditOrigin (enum / concept): Indicates how a credit balance was created, used to enforce payout and usage rules. Defined origins: RETURN — Credits generated from verified bottle/container returns; POINTS — Credits converted from loyalty points; MANUAL — Credits granted by owner adjustment or approval. Only credits with origin RETURN are eligible for cash payout. Credits from POINTS or MANUAL origin are non-withdrawable. All credits, regardless of origin, may be used for purchases according to tier rules. The system must track credit origin to prevent cash-out abuse and ensure regulatory compliance.

GreenProgram (support program, not a tier): A manual support program intended for low-income or unhoused individuals who primarily perform local bottle returns. Assigned manually by the owner, not earned through orders or spend, and does not represent loyalty, trust level, or profitability. Typically limited to short distances within the operator’s local area. Route Fee and Distance Fee may be waived within defined caps. Users in GreenProgram do not earn loyalty points and do not auto-advance to other tiers. GreenProgram status may be revoked or adjusted manually at any time. GreenProgram exists to support accessibility and sustainability goals without compromising the tier system or business margins.

// ...existing code...
loyaltyPoints (number field): Points accrued by the user for loyalty rewards. In User model and responses. Points are earned per order (the backend calculates based on spend and tier: higher tiers earn more points). 1 point per $1 spent; 100 points = $1 credit. Points are earned only on product spend. Points can be converted to credits, but credits derived from loyalty points are non-withdrawable and exist solely for in-app use (cannot be redeemed for cash payout). See GEMINI.md section 12 for full rules.
creditBalance (number field): The user’s current wallet credits (in dollars). Used for purchases per tier rules. Only credits from bottle returns are eligible for cash payout; credits from loyalty points or manual adjustments are non-withdrawable. The system must track credit origin (RETURN vs POINTS vs MANUAL) to enforce payout eligibility. See GEMINI.md section 12 for details.
GSnacks Code Glossary

Last updated by: [your name/initials] on 2026-01-16

---

---

## How to Update Terms

All new roles, permissions, scanner modes, feature flags, or special phrases must be defined in this file before being used in code or documentation. If you need a new term, update this glossary first. Do not redefine terms elsewhere.

---


## Changelog / Revision History

- 2026-01-16 (YH): Linked glossary to all major docs; established as single source of truth. (why: prevent drift)
- 2026-02-01 (AI): Added receipt approval draft terms (FinalStoreMode, ReceiptApprovalAction, ReceiptApprovalDraft). (why: align receipt review payloads)
- 2025-02-14 (AI): Added receipt capture audit/source fields for queue attribution. (why: track capture origin and actor)
- [Add future changes here.]

_Changelog format: YYYY-MM-DD (initials): What changed. (why/context)_

---

## FAQ / Common Pitfalls

**Q: What’s the difference between SKU and Product ID?**
A: SKU is the only business identifier for products (format: NP-000001). Product ID (Mongo _id) is for persistence only and never shown to operators.

**Q: Where do I define a new role, permission, or scanner mode?**
A: Always in this file, before using it in code or other docs.

**Q: Can I use synonyms for terms like Route Fee or Cash Handling Fee?**
A: No. Use only the exact terms defined here to prevent confusion and drift.

**Q: What if I find a term in code that isn’t in this glossary?**
A: Add it here first, then update code and docs to reference the glossary.

---
A-Z Glossary

activeModule (string state): UI section identifier in ManagementView (e.g., "analytics", "orders", "inventory", "pricing-intelligence", etc.). Determines which management module is active.

address (string state): Delivery address input by the user, stored in App state and passed to components like CartDrawer. Used when creating orders (sent to backend on checkout).

adjustCredits (function): Admin action to modify a user’s credit balance. Provided by useNinpoCore and passed into ManagementView for owners to perform credit adjustments.

AI analysis (label scan flow): Manual label photo capture used to auto-fill Create Product fields. Operators capture a product label image (via ScannerModal) and submit it for AI labeling; the response can populate name/category/size defaults for the Create Product form and show confidence/notes for review.

aiCondition (object state): In DriverView, holds AI analysis result for container return condition (fields: valid, material, message). Reflects if returned bottles pass automated checks (e.g., not contaminated) and status message.

aiConditionStatus (string state): Status of AI condition check in DriverView ("idle", "loading", "error"). Indicates progress of analyzing return bottle images.

apiCreateProduct (function): Backend API call to create a new product (used in product creation flow). Called from ManagementView when adding a product for an unmapped UPC.

apiLinkUpc (function): Backend API call to attach a UPC to a product record. Invoked after creating or selecting a product for an unmapped UPC.

AppSettings (data model/schema): System-wide configuration object stored in DB. Contains various settings such as fees, feature toggles, and flags (routeFee, distanceBand rates, maintenanceMode, etc.). Only one row (key: 'default') is used to store these settings.

Attach to Existing (receipt action): Per-item action in receipt review used to link a scanned UPC to an existing product in the UPC Registry and mark the receipt item as matched. Uses the UPC link endpoint to map UPC → SKU.

auditLogs (data model & state): Records of system events for auditing (e.g., order updates, settings changes). In code, core.auditLogs holds the list of audit log entries for display in admin UI. Each log entry includes an id, type (like "ORDER_CREATED", "SETTINGS_UPDATED"), details, actor, and timestamp.

LedgerEntry (data model): A record of a credit or debit transaction affecting a user's account balance. Each entry includes an id, userId, delta (amount changed), reason (description of the transaction), and timestamp. Used to track all adjustments to user credits, including returns, purchases, and manual admin actions.

auditModel (string state): Selected AI/ML model for inventory audit predictions. Shown in the Analytics dashboard for inventory insights, with a dropdown of available auditModels. Chosen model is used when running an inventory audit (runAudit).

auditModels (array state): List of available audit models (identifiers) for inventory insights. Populated from backend (or empty if none) and shown in the Analytics UI.

auditModelsError (string state): Error message if loading audit models fails.

authRequired (middleware/guard): Backend middleware that requires a valid login session (checks for JWT cookie). Returns 401 if not logged in.

authorizedAmount (number field): In Order, dollar amount authorized on payment (Stripe). This is the portion of the order cost that was authorized (e.g. via card hold) but not yet captured.

authorizedCreditBalance (number field): In User model, tracks credits that have been authorized for use but not yet deducted from creditBalance. Ensures that when credits are used for a pending order, they aren’t double-spent until order completion.

BackendStatusBanner (component): UI banner indicating if the backend API is online. Accepts isOnline (boolean) and an onReconnect handler to attempt reconnection (calls core.syncWithBackend).

Band Application Rule (policy): Distance Fee bands are applied based on absolute trip distance after excluding included miles. This is the authoritative rule described in README and used for calculating banded mileage charges.

beepEnabled (boolean flag): If true, the scanner emits a beep sound on each successful scan. Configurable in settings (defaults to true). Passed into ScannerModal and can be toggled via settings.beepEnabled. (Note: Not stored in AppSettings by default – may be a front-end only toggle.)

Bottle Return Service (domain/system): The end-to-end Michigan 10¢ deposit return offering, covering return intake, eligibility checks, verification, and settlement. This is the canonical name for returns operations.

CartDrawer (component): Slide-out cart panel for reviewing order items. Props include isOpen, cart (array of items), products, address, acceptedPolicies, isProcessing (loading indicator for checkout), currentUserId, membershipTier, and various handlers. Allows users to edit cart, enter address, accept policies, and choose payment (via onPayCredits or onPayExternal).

cashHandlingFee (fee concept): A $0.02 per-container fee applied only for Cash Settlement of bottle returns. Not charged for credit settlements. This fee is added on cash-out to cover handling costs.

CashPayout (data model): Database model tracking cash-out payments (likely for bottle return cash settlements). Includes details of cash payouts (e.g., which user/order, amount). Mentioned in backend imports. Enables operators to process and record when customers cash out credits.

clearCart (function): Empties the shopping cart. Exposed by useNinpoCore as core.clearCart. Used after successful payment (<PaymentSuccess clearCart={core.clearCart} />) to reset cart.

closed (OrderStatus): Final status for an order indicating it’s fully completed/archived. "CLOSED" appears as one of the OrderStatus enum values.

conditionFlags (array state): In DriverView, an array of flags (strings) describing any issues detected with returned containers’ condition (e.g., contamination or other anomalies). Populated by AI analysis or manual input before submission.

contaminationConfirmed (boolean state): In DriverView, indicates the driver manually confirmed a contamination scenario for returns. Likely toggled when AI flags an issue and the driver verifies it.

core (object from useNinpoCore): Central hook providing app state and actions. Contains current data (e.g., currentUser, cart, products, orders, users, settings, etc.) and methods (logout, restoreSession, fetchOrders, updateOrder, etc.) to manipulate state. The core is passed to views and components as needed.

CREDITS (PaymentMethod string): Indicates payment using in-app wallet credits. Defined as one of the payment method options. If chosen, the order will deduct from the user’s creditBalance.

creditAuthorizedCents (number field): In Order, the amount of credits (in cents) that were authorized to apply to the order. This is set when a user opts to use credits for payment, upon order authorization.

creditAppliedCents (number field): In Order, the amount of credits (in cents) actually applied to the final order payment. After capture, this reflects how many cents of credit were used.

creditBalance (number field): In User, the wallet credit balance (in dollars) available to the customer. Earned via bottle returns (credit settlement) and used to offset future orders. Updated after returns or adjustments (e.g., adjustCredits admin action).

createdByRole (ReceiptCapture field): Role of the staff member who created a receipt capture. Allowed values: DRIVER, MANAGER, OWNER. Used for auditability and routing.

createdByUserId (ReceiptCapture field): User ID (Mongo _id) of the staff member who created a receipt capture. Used for audit and queue attribution.

Credit Settlement (returns mode): Settlement of bottle returns as store credit (default behavior). In this mode, the total deposit value is added to the user’s creditBalance (no fees deducted) and can offset future purchases.

Credit Ledger System (domain/system): The credit balance and ledger domain that tracks creditBalance and LedgerEntry records for customer credits and adjustments.

CREDIT_ADJUSTMENT (ApprovalType): Type of admin approval request representing a manual credit balance change for a user. For example, giving a goodwill credit or correcting a balance requires owner approval.

receiptCaptureSource (enum / ReceiptCapture field): Origin of a receipt capture. Allowed values: driver_camera (driver device capture), management_upload (management UI upload), email_import (ingested from email). Used to segment queue inputs.

CUSTOMER (UserRole): Regular end-user role with no special privileges. Customers can browse products, place orders, and initiate returns, but cannot access management or driver views.

CustomerView (component/view): Front-end view for customers (the main shop interface). Displays products and the user’s own orders. Props include products, orders, currentUser, and handlers like openLogin (to prompt login), addToCart, onRedeemPoints etc..

User & Role System (domain/system): The domain governing user identities, roles (CUSTOMER/DRIVER/OWNER), and view access (CustomerView, DriverView, ManagementView).

data (prefix): In context of code, often refers to variables holding fetched data (e.g., data from res.json()). In this glossary, Data Models refer to structured objects like User, Order, Product, etc., as defined in code.

DEFAULT_DISTANCE_FEES (constants object): Backend constants defining default distance fee configuration (included miles and tiered rates). Used if no AppSettings override is set.

deliveryFee (deprecated term): Older synonym for routeFee. Appears in legacy code paths (e.g., mapping settings uses doc?.deliveryFee as fallback). Deprecated in favor of Route Fee – UI and receipts should not use “delivery fee”.

detected (ScanEventStatus): Status indicating a UPC was detected by the scanner. Used in DriverView’s scan event log to mark raw detections before validation.

Distance Bands (policy): The tiered mileage ranges used to calculate the Distance Fee (e.g., included miles, band 1, band 2, band 3). Bands apply to absolute trip distance.

distanceBand1MaxMiles (number setting): Maximum miles for distance fee band 1 (after included miles). Default 10.0 miles. Trips up to this distance (beyond included 3.0) incur the band1 rate per mile.

distanceBand1Rate (number setting): Fee per mile for band 1 distances. Default $0.50/mile. Applied for distance > included miles up to band1 max.

distanceBand2MaxMiles (number setting): Maximum miles for distance fee band 2. Default 20.0 miles. Defines the second tier of mileage charges.

distanceBand2Rate (number setting): Fee per mile for band 2 distances. Default $0.75/mile.

distanceBand3Rate (number setting): Fee per mile for distance beyond band2. Default $1.00/mile. Band3 covers any distance above band2 max.

distanceFee (charge concept & field): A mileage-based fee for deliveries/pickups beyond the included threshold. Computed per order based on total distance traveled. Stored in Order (distanceMiles and distanceFee). The first 3.0 miles are free; beyond that, tiered rates apply.

distanceIncludedMiles (number setting): The distance threshold (in miles) included at no extra charge. Default 3.0 miles. Beyond this distance, the Distance Fee kicks in.

DriverView (component/view): Interface for drivers (and owners acting as drivers) to manage order fulfillment and returns pickup. Displays assigned orders, allows scanning of returns (verification) and marking orders as delivered. Props include currentUser, orders, and updateOrder.

driverMode (string state): DriverView mode selector for driver workflows. Values: RETURNS_INTAKE (returns intake/verification) and PICK_PACK (pick/pack orders).

DRIVER (UserRole): Role for delivery drivers. Drivers have access to the DriverView for verifying returns and completing deliveries. (Currently, the app limits DriverView to users with role DRIVER or OWNER).

MANAGER (UserRole): Role for management staff who can access management tooling similar to Owners, but without owner-only privileges. Manager role is accepted by managerOrOwnerRequired guards and related admin workflows.

DRIVER_VERIFY_CONTAINERS (ScannerMode enum): Scanner mode for verifying returned containers (Driver Mode C). Triggers scanning UPCs from returned bottles to count and validate eligibility. In DriverView, when scannerMode is set to this, the ScannerModal titles reflect “Verify Returns”.

DRIVER_FULFILL_ORDER (ScannerMode enum): Scanner mode for driver fulfillment scanning (Driver Mode D). Drivers scan products to confirm the packed order matches the expected items. The scan logic validates UPCs against the order’s item list, routes scans to remaining quantities, and tracks confirmation counts as they are scanned. DriverView keeps this mode in sync with the Pick/Pack toggle so the scan panel switches between return verification and fulfillment scanning.

duplicatesCount (number state): In DriverView, tracks how many duplicate UPC scans occurred during a return verification session. Duplicates require special handling (the UI prompts to confirm adding duplicates).

duplicate_prompt (ScanEventStatus): Status indicating a scanned UPC was a duplicate and the system prompted the driver to confirm adding it. Ensures drivers acknowledge counting an item twice.

Doc Map (documentation section): README section that maps key internal documents (README, GLOSSARY, GEMINI docs) to their purposes. Used for onboarding and navigation.

Tech Stack (documentation section): README section listing core infrastructure and services (database, payments, media, etc.).

eligible (ScanEventStatus): Status in scan log meaning a scanned UPC was recognized as an eligible container (valid MI 10¢ deposit) and presumably added to the count.

estimatedReturnCredit (number field): In Order, the system’s estimate of the return credit (in dollars) the customer will receive for bottle returns on that order. Calculated when order is placed, based on returned UPCs * $0.10 (minus fees if cash-out). It’s an estimate shown to user; actual credit may differ if counts change.

estimatedReturnCreditGross (number field): In Order, the gross value of returns before any cash fees, if applicable. Represents total deposit value (0.10 × count of containers) without deductions. If the user chooses credit settlement, gross equals net; if cash, net (estimatedReturnCredit) would be gross minus fees.

flashlight (UI control): The scanner UI includes a torch toggle. toggleTorch function flips torchOn state to turn on/off camera flash for scanning. The ScannerModal shows a Flashlight or FlashlightOff icon accordingly.

flags (in context of returns AI): In ReturnAiAnalysis, flags is an array of strings indicating issues detected (e.g., “damaged container”, “non-eligible brand”). Populated by AI and stored with a return verification.

fetchApprovals (function): Fetches pending approval requests (refunds, credit adjustments, etc.) for admin review. Exposed by core and used in ManagementView to load the “Auth Hub” module data.

fetchAuditLogs (function): Retrieves the audit log entries from backend. Used in ManagementView to display recent system actions to the owner.

fetchOrders (function): Refreshes the list of orders. Provided by core; used after certain actions like login or payment to update the UI with latest order info.

fetchReturnVerifications (function): Fetches submitted return verification records pending settlement. Used by owners to review driver-submitted return scans (likely accessible in a management module).

fetchUserStats (function): Loads aggregated user statistics (order count, total spend, etc. per user) for the admin dashboard. Data corresponds to what /users/stats API returns.

fetchUsers (function): Retrieves the list of all users (for admin view). Populates the “Users” module in ManagementView with user profiles. Restricted to owners (requires owner role to call).

GLASS_HANDLING_SURCHARGE (fee concept): A $0.02 per-container surcharge applied for glass containers in Cash Settlement. Stacks with the base cash handling fee, meaning each glass bottle costs $0.04 extra in total when cashed out (2¢ general + 2¢ glass) as allowed by law.

GOOGLE_PAY (PaymentMethod string): Payment via Google Pay. One of the accepted gateway types for external checkout. If selected, the backend creates a payment session for Google Pay (similar to Stripe).

GREEN (UserTier): Special future tier denoting an eco-friendly or subscription tier. Currently not active (marked as “future”). Green tier rules: flat $1 Route Fee and no Distance Fee; credits can apply to Route Fee since distance fee is always $0. Note: This tier is in code for calculations but not yet accessible (allowPlatinumTier/Green might gate it).

handleCreditsPayment (function): Front-end handler for processing payment via credits. In App, it sends a request to /api/payments/credits and applies the response (updates credit balance, clears cart on success). Passed as onPayCredits prop to CartDrawer.

handleExternalPayment (function): Front-end handler for initiating an external payment (Stripe or GPay). It calls the backend /api/payments/create-session to get a sessionUrl then redirects the browser. Passed as onPayExternal to CartDrawer. Prevents double submission by checking isProcessingOrder and will prompt login if user is not logged in and guests are not allowed.

handleLogisticsUpdate (function): In ManagementView, updates an order’s status and metadata (like assigning a driver). For example, handleLogisticsUpdate(o.id, OrderStatus.ASSIGNED, {driverId: …}) when “Assign to Me” is clicked. Allows owners to progress orders through statuses (picked up, delivered, etc.).

handlePhotoCaptured (function): Callback executed when ScannerModal captures a photo (only in certain modes). In ManagementView, if scannerMode === INVENTORY_CREATE, the scanner will take a product photo for AI analysis and invoke this handler. It likely sets isLabelScanning and sends the image for label analysis (via runLabelScan).

handleScannerScan (function): Callback in ManagementView/DriverView invoked on each scanner UPC scan event. It receives the scanned UPC and implements mode-specific logic (e.g., adding product to inventory count or adding a return UPC to list). For example, in DriverView, handleScannerScan may add the UPC to the verification list and update counts.

hideCustomerUi (boolean computed): In App, hideCustomerUi is true when the current route is an admin/driver page (management or driver views), and false on customer-facing pages. It controls whether to show certain UI elements like the floating Cart button (hidden in admin/driver mode).

HUB_LAT, HUB_LNG (env vars): Environment variables specifying the hub (origin) latitude and longitude. Used if not configured in AppSettings. The hub coordinates are required for distance fee calculations; if missing, distance calculation fails with a HUB_NOT_CONFIGURED error.

id (as in various interfaces): Generally a unique identifier string. For example, User.id (user’s unique ID), Order.id, Product.id, etc. Users and Orders use MongoDB ObjectIDs (converted to string in responses). These IDs link relationships (e.g., Order.customerId = User.id).

Heavy Item Handling (fee concept): Per-unit surcharge applied when an order includes items that are unusually heavy, bulky, or awkward to handle and transport.

- Customer-facing name: Heavy Item Handling
- Tooltip (customer UI): Applied per heavy unit when items are unusually heavy or require special handling.
- Purpose: Pays for added time, equipment, and safety required to move and deliver heavy/awkward items; offsets route and labor impact.
- Monetized factors: Two-person lifts, staging time, protective packaging, equipment usage (dollies/straps), and route/time disruption.
- Trigger model (internal): Applies per unit flagged as heavy (operational flag on SKU). Internally, “heavy” typically means ≥ 8–10 lb each or awkward to carry (cases, gallons, bulk liquids). Examples: 40-pack bottled water, 1‑gallon milk, soda cases.
- Pricing model: $1.00–$2.00 per heavy item; recommended starting point $1.50 per unit.
- Examples: 10 cases of water → 10 × $1.50 = $15.00; 40 gallons of milk → 40 × $1.50 = $60.00.
- Rules: Charged only for qualifying items, per unit; never a flat order fee. Precisely scales with heavy count; discourages abusive orders without penalizing normal ones.

ineligible (ScanEventStatus): Indicates a scanned UPC was recognized but is not eligible for Michigan deposit (e.g., out-of-state container). Logged in scan events so the driver knows it won’t count for credit.

inventory create scan (workflow): Inventory Mode A scanner flow for unmapped UPCs. The scanner captures a UPC, optionally captures a label photo for AI analysis, and then closes after the scan/photo to return the operator to the Create Product form.

isAuditing (boolean state): Indicates an inventory audit is currently running (to disable repeated clicks and show a loader). Set true when runAudit is in progress.

isAuditModelsLoading (boolean state): True while audit model list is being fetched from backend. Disables the model dropdown until loaded.

isBackendOnline (boolean state): Tracks if the backend server is reachable. Exposed by core and passed to <BackendStatusBanner isOnline={core.isBackendOnline}> to inform the user of offline mode.

isBootstrapping (boolean state): Indicates if the app is still initializing data on startup (loading essential data like products, user session). In App, if core.isBootstrapping is true, it shows a fullscreen loading state (“Loading storefront” spinner). Prevents rendering the main app until initial data is ready.

isCartOpen (boolean state): Controls the visibility of the CartDrawer component. Managed in App state with setIsCartOpen. When true, the Cart drawer is displayed; false closes it.

isCreating (boolean state): Indicates a new product creation is in progress. In ManagementView, used to disable the “Create” button and show a spinner while calling apiCreateProduct.

isLabelScanning (boolean state): Indicates if an AI label analysis (for an unmapped UPC product image) is running. Passed as isAnalyzing prop to UnmappedUpcModal. True when a product photo has been taken and the system is identifying the product.

isLoginViewOpen (boolean state): Tracks if the login modal is open. Managed in App state. When an action requires login (e.g., user tries checkout without being logged in and guests not allowed), this is set true to show the <LoginView> modal. It’s set false on successful login or cancel.

isNavigating (boolean state): In DriverView, indicates navigation to the customer address is in progress (perhaps opening maps). Might be toggled when driver clicks a “Navigate” button to go to the address.

isOpen (boolean prop): Common prop name for modals/drawers. For example, CartDrawer.isOpen, ScannerModal.isOpen. True means the UI component is visible/active.

isOpsSummaryLoading (boolean state): Indicates the “Ops Summary” (operational summary) report is loading. Used to disable the corresponding button in Analytics if an operation summary generation is in progress.

isProcessingOrder (boolean state): Indicates an order payment is being processed. Used globally to prevent duplicate submissions. In App, when true, checkout buttons are disabled and a loading state shown. It’s set true when initiating payment and set false when finished. Passed into CartDrawer as isProcessing to gray out actions during payment.

isReturnOnly (boolean computed): True if the active order is a pickup-only (returns without product delivery). In DriverView, this triggers different instructions (e.g., show “Return-only pickup” guidance). Likely determined by orderType === 'RETURNS_PICKUP' or no products in order.

isScanning (boolean state): In ScannerModal, indicates if the camera scanner is currently running. True once video capture and barcode detection have started. Toggling scanning state helps control UI (e.g., disabling scan button while scanning).

isVerifying (boolean state): In DriverView, indicates a verification process is underway (e.g., finalizing return verification or capturing payment). Used to show a loading spinner on the “Complete Delivery” button. When true, the button is disabled and shows a spinner instead of text.

lastDetectedUpc (string state): Stores the last UPC code detected by the scanner (to display or for debugging). Updated on each successful scan (handleScan).

lastAcceptTimeRef (ref number): A timestamp of the last accepted scan in ScannerModal. Used to enforce the cooldown between scans – new scans within cooldownMs are ignored.

ledger (data model): Transaction log of credit changes per user. Each LedgerEntry has id, userId, delta (amount change, positive or negative), reason, timestamp. Owners can view a user’s ledger via /users/:id/ledger. Ledger tracks how credits were earned or spent (e.g., returns, manual adjustments).

LEGACY_SESSION_COOKIE_NAME (constant "auth_token"): The old cookie name for sessions, cleared out on logout for compatibility. The new standard is session.

loyaltyPoints (number field): Points accrued by the user for loyalty rewards. In User model and responses. Points are earned per order (the backend calculates based on spend and tier: higher tiers earn more points). These could be redeemed for rewards (the front-end has onRedeemPoints callback, though actual redemption flow is minimal in code).

Large Order Handling (fee concept): Per-item surcharge applied when an order’s item count exceeds a normal threshold.

- Customer-facing name: Large Order Handling
- Tooltip (customer UI): Charged per item above the normal threshold.
- Purpose: Pays for time and packing complexity — not weight. Offsets extra picking/packing, staging, and route planning beyond standard-size purchases.
- Calculation model: First 10 items included; every additional item is charged $0.25–$0.40. Recommended starting point: $0.30 per extra item.
- Examples: 10 items → $0.00; 20 items → (20 − 10) × $0.30 = $3.00; 40 items → (40 − 10) × $0.30 = $9.00.
- Why customers accept this: “More items = more work.” It scales naturally, feels logical, and discourages abuse without punishing normal orders.
- Rules: Applies only to the count above threshold; linear per extra item; never charged when total items ≤ threshold.

LoginView (component): Modal content for user login. In App, rendered when isLoginViewOpen is true. Takes onSuccess (called after successful login, e.g., to restore session and fetch orders) and onCancel handlers.

Logout (action): Logging out clears the session cookie. core.logout is provided by useNinpoCore and called via the Header’s onLogout prop. It will also clear local user state. On backend, auth/logout route clears cookies via clearAuthCookie.

manualUpc (string state): The UPC value entered manually by a user/driver. Both ScannerModal and DriverView maintain a manualUpc input for cases where scanning fails or to add by typing. E.g., drivers can type a UPC and click “Add” to include it in returns if scanning is problematic.

mapOrderForFrontend (function): Backend helper that transforms Order DB data into the format used by the front-end. Likely merges related info (like embedding product names or calculating totals). Imported in payments route.

mapUser (function): Backend helper to shape a User document into JSON for frontend. Sets id, normalizes missing fields, ensures types (e.g., numbers, booleans). Used when returning user(s) data from APIs.

membershipTier (string field): The user’s current membership tier (COMMON, BRONZE, SILVER, GOLD, PLATINUM, GREEN). Tiers gate certain benefits (credits usage, cash-out eligibility, discounts). Platinum is a hidden tier (invite-only) and Green is future. Tier advancement is primarily based on completed orders. Minimum lifetime product spend thresholds exist to ensure fair use and system sustainability. Advancement requirements:

- Bronze: ≥ 25 completed orders, ≥ $250 lifetime product spend, email + address verified
- Silver: ≥ 50 completed orders, ≥ $600 lifetime product spend, phone verified, all Bronze requirements
- Gold: ≥ 100 completed orders, ≥ $1,500 lifetime product spend, photo ID verified, full legal name provided, all Silver requirements

Platinum: Owner-assigned only, all Gold requirements, verified loyalty/trust/in-person relationship
Green: See GreenProgram entry

Tier Demotion & Review: Users may be automatically demoted one tier for inactivity (no completed orders in 180 days), spend decay (lifetime spend falls below 75% of tier minimum), trust regression (loss of phone/ID verification), or abuse/risk flags (excessive refunds, return fraud, chargebacks, owner-flagged risk). The owner may freeze, demote, or revoke tier status at any time for risk management. See GEMINI.md section 11 for full rules.

Secret Platinum (term): Documentation-facing name for the hidden PLATINUM tier. Used in docs to limit awareness; internal tier identifier remains PLATINUM.

metadata (general): Throughout the code, “metadata” refers to supplemental info often stored as object fields. E.g., updateOrder(id, status, metadata?) where metadata can include assignments (driverId etc.). Also, some backend APIs return data in { ok, ... } wrappers and might include metadata about errors or operations.

MI-Eligible Container (concept): A container that qualifies for Michigan’s $0.10 deposit refund. Only these generate return credits. The system filters scanned UPCs by an internal list of eligible items (isEligible flag on UPC records).

modalOpen (suffix for state): Convention for tracking modals, e.g., scannerModalOpen, unmappedUpcModalOpen in ManagementView state. True when the corresponding modal is visible.

modules (management): The admin UI is divided into modules: Dashboard (analytics), Orders, Inventory, Pricing Intelligence (receipts, approvals/review queue, price updates, alias bindings/UPC Registry, audit history), Users, Settings. Each module corresponds to a section of ManagementView controlled by activeModule.

normalizeCart (function): Backend helper that de-duplicates and cleans an incoming cart items array. Sums quantities per product and filters out invalid entries. Ensures the cart stored on the order has consolidated lines.

normalizeReturnPayoutMethod (function): Backend helper that validates a return payout method string. Returns 'CREDIT' or 'CASH', defaulting to CREDIT if an invalid value is given. Ensures only allowed values are used in orders.

normalizeTier (function): Utility to standardize tier strings. Uppercases the tier and defaults unknown/empty values to 'COMMON'. Back-end uses this to handle user tier inputs and comparisons.

onAddressChange (prop): Handler to update the delivery address. Passed to CartDrawer to bind the address input field to App state (setAddress).

onAnalyze (prop): Function prop for UnmappedUpcModal to trigger an AI label analysis. When user clicks “Analyze Label” on an unmapped UPC, this is called (bound to runLabelScan in ManagementView).

onAttachToExisting (prop): Callback in UnmappedUpcModal for attaching the scanned UPC to an existing product. Calls apiLinkUpc(upc, productId) then closes the modal. Allows operators to map a new UPC to a product already in the catalog.

onClose (prop): Generic close handler for modals. E.g., passed to ScannerModal (onClose={() => setScannerModalOpen(false)}), UnmappedUpcModal (onClose={() => setUnmappedUpcModalOpen(false)}), and CartDrawer (onClose={() => setIsCartOpen(false)}). Closes the respective UI element.

onCreateProduct (prop): Callback in UnmappedUpcModal to create a new product for an unmapped UPC. Bound to a function that uses apiCreateProduct and apiLinkUpc behind the scenes. Allows adding a new catalog item when a scanned UPC is unknown.

onPayCredits (prop): Function prop on CartDrawer triggered when user chooses to pay with credits. Bound to handleCreditsPayment in App. Executes the credits checkout flow.

onPayExternal (prop): Function prop on CartDrawer for paying via external gateway (Stripe/GPay). Bound to handleExternalPayment.

onRedeemPoints (prop): Handler to redeem loyalty points. Passed into CustomerView (bound to core.redeemPoints). Not fully implemented in code (could open a modal or apply points to order in future).

onRemoveItem (prop): Handler to remove an item from the cart by product ID. Passed to CartDrawer as id => core.setCart(prev => prev.filter(i => i.productId !== id)), directly modifying the cart state.

onRequestRefund (prop): Placeholder prop in CustomerView intended to initiate a refund request for an order. Currently passed an empty function (() => {}) in App, indicating the feature exists conceptually but is not yet implemented (likely for customers to request order refunds).

one unified vocabulary (documentation rule): Requirement that code, UI, and docs use the exact glossary terms with no synonyms to prevent drift.

onScan (prop): Core callback in ScannerModal triggered when a barcode is scanned and passes all cooldown/validation checks. Provided by parent component (e.g., handleScannerScan in ManagementView or DriverView) to handle the scanned UPC.

Open Food Facts (OFF): External product data source used to look up product metadata by barcode. The system calls OFF through a backend proxy endpoint for barcode lookups.

OFF lookup (workflow): Management-side product lookup flow that calls the OFF API via /api/upc/off/:code, maps the response, and pre-fills Create Product fields. Results are advisory and must remain editable before saving.

onSuccess (prop): Handler called upon successful login in LoginView. In App, this is defined to restore the session (call core.restoreSession() to load user data) and fetch orders, then close the login modal.

onPhotoCaptured (prop): Callback provided to ScannerModal to handle an image capture from the camera. Only used in modes where a photo is needed (e.g., INVENTORY_CREATE mode for AI image analysis). When set, the scanner’s “capture photo” button becomes active and invokes this with a JPEG data URL and MIME type.

onPolicyChange (prop): Handler to toggle the “I accept policies” checkbox. Passed to CartDrawer to bind the acceptedPolicies boolean to state.

onLogin (prop): Handler to open the login view. Passed to Header component to trigger the login modal (setIsLoginViewOpen(true)).

onLogout (prop): Handler to log out. Passed to Header; calls core.logout() when user clicks logout.

Order (data model/interface): Represents a customer order. Key fields include id, customerId, optional driverId, list of items (productId & quantity), total (order total cost), orderType ("DELIVERY_PURCHASE" or "RETURNS_PICKUP"), various fee fields (routeFee, distanceFee), credit usage (creditAuthorizedCents, creditAppliedCents), return-related fields (estimatedReturnCredit, returnUpcs array, returnUpcCounts with quantities, and their verified counterparts), paymentMethod, address, status (OrderStatus), timestamps (createdAt, paidAt, etc.). In backend, orders have a Mongoose schema and are manipulated via routes like /orders.

OrderStatus (enum): Possible states of an order’s lifecycle. Values: PENDING (awaiting authorization), AUTHORIZED (payment authorized, not captured), PAID (payment captured, ready for processing), ASSIGNED (driver assigned), PICKED_UP (items picked up by driver), ARRIVING (driver en route to customer), DELIVERED (completed delivery/return), REFUND_REQUESTED (customer requested a refund), REFUNDED (order refunded), CLOSED (order closed/finalized). The app transitions orders through these statuses accordingly.

Order & Logistics Fee System (domain/system): The domain covering Order status, Route Fee, Distance Fee, pickup-only multiplier, and related logistics calculations.

OWNER (UserRole): Role for the business owner or operator. Has full admin privileges. Only Owners can access the ManagementView (admin dashboard) and perform actions like adjusting settings, viewing all users, etc. The backend restricts many routes to owner only (via ownerRequired middleware).

managerOrOwnerRequired (middleware/guard): Backend check that allows access only if the logged-in user has role MANAGER or OWNER. Used for management routes where managers can act but owner-only actions are still restricted.

ownerRequired (middleware/guard): Backend check that allows access only if the logged-in user’s username is in the configured owner list. It effectively restricts certain API routes to Owner role. The list of owner usernames is set via env (OWNER_USERNAMES or OWNER_USERNAME). If a user has role OWNER but isn’t on the list, this guard denies access (ensures only specific accounts can act as owner in production).

PackageCheck (icon/label): UI icon representing order pickup action. In ManagementView, used on a button “Mark Picked Up” for orders in ASSIGNED status.

PaymentCancel (component): A simple view shown when a payment is canceled (route /cancel). Likely displays a cancellation message; does not need dynamic props (none passed in App route).

PaymentSuccess (component): View shown when payment succeeds (route /success). Receives clearCart prop to empty the cart after successful checkout. Likely thanks the user and possibly triggers any follow-up actions (like maybe showing receipt info).

PaymentMethod (type/enum): Accepted payment methods for orders. Defined as union of 'STRIPE_CARD', 'GOOGLE_PAY', 'CREDITS'. Indicates how the order was or will be paid. This is stored on Order (paymentMethod field).

Payments (Stripe) System (domain/system): The payment domain covering Stripe Checkout/authorization/capture, external payment sessions, and payment method handling.

Payment Rail (concept): The mechanism used to collect payment for any remaining balance (e.g., Stripe for card payments). Distinct from settlement mode.

Settlement Mode (concept): How bottle deposit value is settled (Credit Settlement or Cash Settlement). Distinct from payment rail.

pending (status): See PENDING (OrderStatus): initial status for new orders awaiting authorization. Also PENDING is used for ApprovalRequests that haven’t been processed.

phoneVerified (boolean field): In User, indicates if the user’s phone number has been verified. This is a trust factor for tier promotion (Silver tier requires phone verified). The system might set this true after an OTP verification step (not shown in code snippet, but field exists for future use).

photoIdVerified (boolean field): In User, indicates if the user’s government photo ID has been verified. Required for Gold tier (users must upload ID). Also used to auto-promote tier: if ordersCompleted >= 15 and photoIdVerified, user qualifies for Gold.

pickupOnlyMultiplier (number setting): Discount multiplier applied to route-level fees for pickup-only orders (returns without delivery). Default 0.5 (i.e., 50% discount). If an order’s type is RETURNS_PICKUP, routeFee and distanceFee are multiplied by this factor to reduce charges.

Pickup-Only Discount (policy): Route-level discount applied via pickupOnlyMultiplier when an order is pickup-only (returns-only). Applies to Route Fee and Distance Fee.

primarySupplier (boolean field): Store flag indicating the primary supplier location for pricing context and receipt capture. Only one store should be marked primary at a time; setting a new primary clears the previous one.

PLUS (icon): UI icon for adding items. E.g., used on “Add” buttons or the “Create” button (shows a plus sign when not loading).

Point Eligible Tiers: Tiers that earn loyalty points on purchases. Defined by POINT_ELIGIBLE_TIERS = {COMMON, BRONZE, SILVER, GOLD} – notably Platinum is excluded (likely because Platinum might get other perks instead of points). Purchases by eligible tier users convert spending into points at a rate defined in POINT_EARNING_RATES.

Point Earning Rates: Multipliers for loyalty points per tier. In code: COMMON/BRONZE = 1.0×, SILVER = 1.2×, GOLD = 1.5×. E.g., a Gold member earns 1.5 points per $1 of product spend. These rates are used in backend when awarding loyaltyPoints on order completion.

Loyalty Points System (domain/system): The loyalty points domain that governs loyaltyPoints accumulation, point-earning tiers, and redemption hooks.

Product (data model/interface): Represents an item in the inventory. Fields: id, sku (human-friendly ID), upc (barcode, possibly multiple per product via mapping), name, price, deposit (the container deposit value, typically 0.10 if eligible), stock (quantity in stock), sizeOz, sizeUnit (unit label such as oz, g, ml), category, image (URL), optional brand, productType, nutritionNote (customer-facing nutrition info), storageZone, storageBin, isGlass (boolean if container is glass), and isTaxable (boolean sales tax flag). Products are managed in the Inventory module; sku is shown as the primary identifier in admin UI.

products (core state): Array of all products available. core.products is loaded from backend and passed to views like CustomerView and ManagementView. Used for listing items, finding product details (e.g., to get stock in addToCart logic).

isTaxable (boolean field): Indicates whether a product should be treated as taxable in pricing/checkout calculations. Defaults to true when unspecified.

readOnly (context): In some UI contexts, certain fields might be read-only depending on user role. E.g., a driver might see info but not edit settings. (Not a specific code identifier, but a concept to mark fields that should not be editable by certain roles).

referralBonus (number setting): The referral reward amount (in dollars) for referring a new customer. Default $5.00. Possibly adds to creditBalance when referral conditions are met (not detailed in the snippet, but configured in AppSettings).

REFUND (ApprovalType): Type of approval request for refunding an order or item. When a customer requests a refund (OrderStatus REFUND_REQUESTED), an ApprovalRequest of type REFUND could be generated for the owner to approve or reject.

refundRequestedAt (datetime field): In Order, timestamp when the customer requested a refund. Set when an order issue triggers a refund request (e.g., via support or automated if items were missing). While refund is pending, OrderStatus may be REFUND_REQUESTED.

RefundRequested/Refunded (statuses): See OrderStatus – REFUND_REQUESTED means the user or system has flagged the order for a refund (requires attention). REFUNDED indicates the order has been refunded (money returned or credits given) and is closed out.

Re-run AI Analysis (button/action): In the Create Product flow, re-analyzes the most recently captured label image and refreshes the AI-suggested fields in the form. Used when the initial AI analysis was incorrect or incomplete.

ReceiptItemClassification (enum): Buckets used for receipt parsing/classification in the pricing workflow. Values: A (auto-update OK), B (needs review), C (no match), D (noise/non-product lines such as coupons, taxes, or subtotals). Bucket D is excluded from inventory updates and is meant to quarantine non-product lines for manual review.

ReceiptNoiseRule (data model): Persistent per-store rule that marks a normalized receipt line as noise so it is always classified into bucket D and excluded from product matching. Created via the “never match again” action in receipt review workflows.

requiresUpc (boolean flag): Receipt parse item flag indicating that a line item still needs a UPC to be linked or captured before it can be matched or approved. Used in ReceiptParseJob proposals to highlight items that need barcode follow-up.

Commit All Safe (action): Receipt review action that commits only bucket A items (auto-update OK) that already have a suggested product match. Used to batch-apply the safest price updates without manually selecting each line.

Commit & Lock Prices (action): Receipt review option that commits receipt price updates while also applying a temporary price lock so automated updates are blocked until the lock expires. The lock duration is set by AppSettings.priceLockDays (default 7).

FinalStoreMode (enum): Receipt approval state indicating how the final store was chosen. Values: MATCHED (auto-matched to the store candidate), EXISTING (operator selected an existing store), CREATE_DRAFT (operator approved creating a draft store; maps to confirmStoreCreate in the approval payload).

ReceiptApprovalAction (enum): Per-item receipt approval decision aligned to ReceiptParseJob.actionSuggestion values. Allowed values: LINK_UPC_TO_PRODUCT, CREATE_UPC, CREATE_PRODUCT, IGNORE. Used to translate review choices into boundUpc/boundProductId or new product creation during approval.

ReceiptApprovalDraft (payload): Frontend receipt review draft that captures store selection and line-level decisions before approval. Fields include jobId, captureId, finalStoreMode, finalStoreId, storeCandidate, confirmStoreCreate, and items with lineIndex, action, optional UPC, and create-product payload. Aligns with receipt approval endpoints that expect finalStoreId/storeCandidate/confirmStoreCreate and per-item bindings.

priceLockUntil (datetime field): StoreInventory field indicating when a temporary receipt price freeze expires. If set in the future, receipt-based price updates should skip this item until the timestamp passes.

priceLockDays (number setting): AppSettings field controlling the default number of days to freeze receipt-based price updates when using Commit & Lock Prices. Defaults to 7.


result panel (UI): The Create Product form shown after an inventory create scan or AI label analysis. This panel displays the scanned UPC and the AI-suggested fields, and it’s where operators finalize and save the new product.

ReturnAiAnalysis (interface): Structure holding AI results for a returns verification photo. Fields: confidence (e.g., how sure the AI is), flags (list of issues detected), summary (text summary of AI’s findings), assessedAt (timestamp). Attached to Order as returnAiAnalysis after processing a return verification image. Helps the admin decide on approving the returns count.

ReturnUpcCount (interface): Object with upc and quantity fields. Used to list how many of each UPC were returned. Appears in Order as returnUpcCounts (customer-declared counts) and verifiedReturnUpcCounts (driver-verified counts).

returnUpcs (array field): In Order, list of UPC codes (strings) that the customer claims to return (e.g., scanned via customer returns flow or manually input in app). verifiedReturnUpcs is the list actually verified by driver or admin.

returns (domain): The functionality around bottle returns. Includes scanning UPCs, calculating credits, applying fees for cash-out, and approving the returns. This domain involves ReturnUpcCount, ReturnAiAnalysis, returnPayoutMethod, etc., and touches both driver (verification) and owner (settlement approval) roles.

returnPayoutMethod (string field): How the customer chooses to receive their container refund value – 'CREDIT' (store credit) or 'CASH'. Stored in Order and sent to payment endpoints. If CASH is chosen, the system will apply cash fees and likely create a CashPayout record. The backend will enforce that only Gold+ tiers can choose cash (others default to CREDIT).

returns pickup (order type): See RETURNS_PICKUP – an OrderType for orders that consist solely of bottle return service (no product delivery). Such orders still incur a Route Fee (with pickupOnlyMultiplier) and optionally a Distance Fee.

RETURNS_PICKUP (OrderType string): Indicates an order is a bottle returns-only pickup (no products delivered). The system can treat these differently (apply pickupOnlyMultiplier, allow scheduling just for returns, etc.). Paired with DELIVERY_PURCHASE which is the normal order type (could include a returns component).

Run Audit (action/button): In ManagementView’s Analytics, an action to run an inventory audit (likely AI-driven insights into inventory levels or shrinkage). When clicked, calls runAudit – which might use an AI model (selected by auditModel) to analyze inventory data.

runAudit (function): Initiates the inventory audit process. Dispatched when “Run Audit” is clicked. It likely calls an AI service (Gemini) to analyze inventory and produce a report (the specifics are not fully visible, but error and loading state around it indicate an async operation).

runLabelScan (function): Initiates an AI analysis of a manually captured product label image for an unmapped UPC. Triggered from the Create Product flow (UnmappedUpcModal onAnalyze) after the operator captures a label photo; the response auto-fills suggested fields (name/category/size) in the Create Product form while still requiring operator review.

runOpsSummary (function): Likely triggers an operations summary generation (perhaps a PDF or data export for operations). Bound to “Ops Summary” button in Analytics. Not much detail, but it’s disabled when orders list is empty or already loading.

ScannerModal (component): Reusable camera barcode scanner modal. Accepts props: mode (ScannerMode), onScan callback, onClose, title, subtitle, optional beepEnabled, cooldownMs, isOpen, and onPhotoCaptured for modes requiring image. Uses device camera to detect barcodes (EAN-13/8, UPC-A/E) and returns sanitized UPC codes. Implements a scan cooldown (default ~1200ms) to prevent duplicate rapid scans.

Scanner UX System (domain/system): The shared scanning experience across Management, Driver, and Customer flows, including ScannerModal behavior, cooldown rules, scan normalization, and OFF lookup integration.

ScannerMode (enum/type): Defines the context for scanning. Modes include INVENTORY_CREATE (Mode A – add new product via scan), UPC_LOOKUP (scan to populate UPC field in registry), DRIVER_VERIFY_CONTAINERS (Mode C – returns verification scan), DRIVER_FULFILL_ORDER (Mode D – fulfillment scan to confirm packed items), and CUSTOMER_RETURN_SCAN (customer return scan list). These modes determine the ScannerModal behavior (e.g., whether it can capture photos, what text it shows, and what the onScan does).

scanningModesEnabled (settings object): Feature toggles for enabling/disabling certain scanning modes in the UI. Properties include inventoryCreate, upcLookup, driverVerifyContainers, and customerReturnScan. If a mode is disabled (false), the corresponding function might be hidden or inactive. Note: Not currently saved via settings endpoints (no backend handling in settings.js), so this may be a placeholder for future use.

setIsCartOpen, setIsLoginViewOpen, setScannerModalOpen etc. (functions): State setters for toggling UI. Examples: setIsCartOpen(true) opens the cart; setIsLoginViewOpen(false) closes the login modal after login; setScannerModalOpen(true) opens the scanner modal. These correspond to boolean state vars in App or ManagementView.

setScannerMode (function): State updater to change the current scannerMode. Used when a user chooses an action that requires scanning. E.g., in Inventory module: setScannerMode(ScannerMode.INVENTORY_CREATE) before opening scanner for adding a new product; or in Driver returns: setScannerMode(ScannerMode.DRIVER_VERIFY_CONTAINERS) when starting a verification scan.

setSettings (function): Provided by core to update AppSettings. Passed into ManagementView to allow the owner to save changes in the Settings module. Likely calls backend /settings update and then updates core.settings.

settleReturnVerification (function): Marks a return verification as settled/processed. Passed to ManagementView. When a driver submits a return verification, an owner uses this to approve or reject and finalize credit to the user. It may update orders (e.g., apply verifiedReturnCredit and adjust user credits) and remove the pending verification from the queue.

showAdvancedInventoryInsights (boolean setting): Feature flag to show advanced analytics or AI insights in the admin UI. Default false. If true, extra inventory analysis or predictive features (like the audit model selection and Ops Summary) may be visible. This corresponds to enabling the “Inventory AI” capabilities.

sku (Product field): Stock Keeping Unit – human-readable product ID (format like NP-000001 as hinted in docs). Used as the primary identifier in operator UI instead of the internal id. SKU is optional in data (some products may not have one, fallback to id in UI). Operators should use SKU for reference and labels.

shelfGroupingEnabled (boolean setting): Flag whether to group inventory display by storage shelf/zone. Default false. If true, the UI may organize products by storageZone and storageBin sections. This helps warehouse management by grouping items by location.

status (field): Represents status in various contexts. Order.status uses OrderStatus values. ApprovalRequest.status can be 'PENDING', 'APPROVED', 'REJECTED'. AuditLog.type is called “type” but analogous to a status of an event. Always refer to context (order status vs approval status, etc.).

storageBin, storageZone (Product fields): Inventory location indicators for a product (e.g., aisle or section). Used to organize stock. The scanner result panel shows these for found products. If shelf grouping is enabled, products can be sorted by zone/bin.

STRIPE_CARD (PaymentMethod string): Payment via Stripe (credit/debit card). Represents standard card payments. The system integrates with Stripe for checkout sessions (calls create-session on backend which returns a Stripe sessionUrl for payment).

Stripe (external service): The payment processor for card transactions. In code, external payments are handled by redirecting to a Stripe Checkout session (created via backend). Stripe charges correspond to authorized/captured amounts on orders.

sumReturnCredits (function): Calculates total return credit (in dollars) for a set of UPC counts. Sums up eligible containers * $0.10. Non-eligible UPCs are ignored. Returns the total credit value; used to compute how much credit a return yields.

syncWithBackend (function): Likely a core method to re-synchronize local state with backend data (e.g., re-fetch all latest data). Hooked to BackendStatusBanner’s “Reconnect” button. When backend comes online after being offline, this pulls fresh data.

toasts (state/list): Notifications to show to the user. core.toasts is an array of messages with types (success, warning, etc.). core.addToast(msg, type) is used throughout (e.g., adding “ADDED TO CARGO” on cart add, error messages on payment failure). ToastStack component renders these notifications.

total (number field): In Order, the total dollar amount of the order (including products, route fee, distance fee, minus any credits applied). Calculated on backend when order is finalized. This should match what is charged on Stripe for transparency.

UNCREDITED (not an explicit term): (Note: conceptually, if an order is authorized but not paid, credits may remain “authorized” but not deducted – that’s covered by authorizedCreditBalance. No specific “uncredited” term appears, so skip.)

UnmappedUpcData (interface): Holds info for a scanned UPC that isn’t recognized. Fields: upc and optional name, price, deposit, size, category. This is used when a UPC is scanned that doesn’t exist in the system – the UnmappedUpcModal allows the operator to create a new product or link the UPC to an existing one using this data.

UnmappedUpcModal (component): Modal dialog for handling an unmapped UPC scan. Appears with options to create a new product or attach to existing product. Props include the UPC payload (data), list of products, a flag isAnalyzing (if AI analysis is running), and handlers onClose, onAnalyze, onCreateProduct, onAttachToExisting.

upc (barcode): A universal product code string. The system uses UPCs to identify container types for returns and to map products. In code, many operations revolve around UPCs: scanning returns, maintaining an internal UPC registry (whitelist), etc. Each UpcItem in the database represents a UPC and its associated metadata (name, containerType, etc.).

UpcContainerType (type/enum): Type of material for a container, relevant to recycling: 'aluminum' | 'glass' | 'plastic'. Each UPC in the registry is tagged with one of these. Glass is notable because of the extra surcharge on cash payouts.

UpcItem (data model): Database model for known UPC codes. Fields: upc (code), name (if known product name), depositValue (should be 0.10 if eligible), price (if linked to product price), containerType (aluminum/glass/plastic), sizeOz, sizeUnit (unit label such as oz, g, ml), isEligible (boolean if this UPC qualifies for deposit return). Populated via the UPC Registry module; used when scanning to determine eligibility and for creating product entries.

UpcLookupCache (data model): Cache for Open Food Facts lookups keyed by barcode. Stores the normalized OFF payload with a fetchedAt timestamp to reduce external requests.

UPC Lookup (scanner mode): The use of scanner to populate UPC field in the UPC Registry (Management Mode for whitelist). In code, ScannerMode.UPC_LOOKUP triggers a simple scan that just fills an input, without modifying stock. Title shown as “Scan UPC” in ScannerModal.

users (core state): List of all user accounts (only populated for owners). core.users is fetched via fetchUsers and passed to ManagementView (Users module). Contains user profiles with id, username, role, tier, etc.

UserRole (enum): Defines user roles in the system. Values: CUSTOMER, OWNER, DRIVER. Determines access level: Owner can do everything, Driver has delivery/returns capabilities, Customer is standard. Frontend uses it for routing (who can access /management or /driver views).

UserStatsSummary (interface): Summary stats per user – fields: userId, orderCount, totalSpend, lastOrderAt. Generated by backend aggregation and fetched via /users/stats. Displayed in admin dashboard (possibly part of “analytics” module or users module to show top customers).

vault (in UI text): The app uses the phrase “REDIRECTING TO SECURE VAULT” when redirecting to Stripe. This is a user-facing toast message indicating handoff to payment processor. (“Vault” presumably means the secure payment form).

verifiedReturnCredit (number field): In Order, the final verified return credit (dollars) after driver validation. This is the amount actually credited to the user’s wallet for returns, potentially after excluding ineligible items.

verifiedReturnCreditGross (number field): In Order, the gross value of returned containers as verified (before any cash fees). If payout was cash, the net credited (if any) would be less after fees, but this gross helps track total containers collected.

verifiedReturnUpcCounts (array field): List of ReturnUpcCount objects for each UPC type the driver verified in the return. Represents the official count of returned containers by UPC after the verification step.

verifiedReturnUpcs (array field): Simplified list of UPC codes that were verified as returned (could be redundant with counts). Each UPC may appear multiple times if quantity > 1. Used for quick reference or logging.

workflowMode (string state): In DriverView, indicates the current workflow context, e.g., 'verification' vs 'delivery'. When paired with scannerMode, it helps guide drivers between returns verification and fulfillment scanning flows.

ZONE (concept): Storage zones defined in AppSettings (storageZones array). These are custom labels for areas in the storage (e.g., “Fridge”, “Shelf A”). Similarly, productTypes can categorize items (e.g., “Drink”, “Snack”). These lists inform dropdowns for product attributes.

(Above, deprecated terms like “deliveryFee” are marked as such.)

By Category
Roles & Permissions

UserRole – CUSTOMER/OWNER/DRIVER: Enum of user roles defining permissions. CUSTOMER is default for shoppers, OWNER for admin operators, DRIVER for delivery personnel. The UI and backend restrict access based on role (e.g., only Owner can load management data, only Owner/Driver can access DriverView).
In backend, additional guards like ownerRequired enforce that the user’s username is in an allowed list for Owner actions. Roles also dictate UI elements (e.g., Header shows admin links only for Owner).

Permissions Logic: There is no fine-grained ACL table; instead, checks are hard-coded. For example, canManageUser(req, userId) allows a user to fetch or edit a profile if they are that user or an Owner. Owner role is effectively an admin with all privileges. Drivers currently have no separate backend-only routes, but front-end gates driver functions to role DRIVER or OWNER.

Environment-based Access: The list of owners is set via env OWNER_USERNAMES, and similarly DRIVER_USERNAMES env can auto-assign the Driver role on account creation or login. This means being flagged as an Owner in env is required in production to actually be treated as owner (role alone may not suffice).

Approval Workflow: Owners must approve certain actions via the Auth Hub. For instance, refund requests or manual credit adjustments generate ApprovalRequests (status PENDING) that only an Owner can APPROVE/REJECT. This ensures that sensitive actions need an Owner’s permission.

Scanner Modes & Settings Flags

Scanner Surfaces & Modes: The app has three scanner surfaces, each using specific ScannerMode values.
- Management scanner: INVENTORY_CREATE (Mode A) for intake/audit, UPC_LOOKUP for registry maintenance, and RECEIPT_PARSE_LIVE for receipt capture/parsing.
- Driver scanner: DRIVER_VERIFY_CONTAINERS (Mode C) for return verification and DRIVER_FULFILL_ORDER (Mode D) for fulfillment validation.
- Customer scanner: CUSTOMER_RETURN_SCAN for building return lists with eligibility feedback.
These modes are enabled/disabled via scanningModesEnabled flags in settings (inventoryCreate, upcLookup, driverVerifyContainers, customerReturnScan). The unified ScannerModal component adapts its UI and callbacks based on the mode.

AppSettings Flags: Several Boolean toggles control features:
– maintenanceMode: if true, presumably puts the system in maintenance (e.g., prevent new orders). Could trigger a banner or block ordering (not explicitly shown in UI code but stored in settings).
– allowGuestCheckout: if true, allows checkout without login. The app checks this: if a user isn’t logged in and this is false, clicking checkout will open login instead. When true, guests can place orders (likely creating an account behind scenes or tagging orders as guest).
– requirePhotoForRefunds: if true, enforces that a photo proof must be uploaded for refund requests. This flag might be used to decide if photoProof is required in ApprovalRequests of type REFUND. In practice, a refund request may include photoProof URL, and if this flag is on, the system could block refunds without a photo.
– showAdvancedInventoryInsights: enables advanced analytics UI like AI audit models and operational summaries. When false (default), the “Audit Model” selector or similar features might be hidden. When true, management sees extra options (like choosing auditModel, running AI-driven audits, etc., as shown in the Analytics section).
– allowPlatinumTier: if true, unlocks the Platinum tier features in the system. By default false (Platinum is invite-only and hidden). Turning it on might allow admin to promote users to Platinum or apply Platinum perks globally. For example, backend might check this before applying Platinum benefits (like route fee waiver). If off, the system might treat Platinum like Gold for calculations or not allow setting Platinum at all.
– platinumFreeDelivery: if true, waives Route Fee for Platinum tier users. The calculation for routeFee explicitly makes it $0 when user tier is Platinum and this flag is true. This provides a perk to Platinum members (free delivery). This flag has effect only if Platinum tier is allowed/enabled.
– requireSkuForScanning: if true, likely requires that products have a SKU assigned to be scanned/added. This could mean the scanner will refuse to auto-add items without a SKU, forcing proper cataloging. Not explicitly shown in code logic, but exists as a configuration in AppSettings. It aligns with the business rule that every product should have a SKU identifier.
– shelfGroupingEnabled: if true, the frontend groups inventory display by storage shelves/bins. The Inventory UI would then list products under their storageZone sections, giving operators a structured view of stock locations. Default false means a flat product list.
– defaultIncrement: the default quantity increment for stock changes via scanning (likely Mode A). Defined in settings (probably 1 by default). If, for example, defaultIncrement = 1, each scan in Mode A adds 1 unit; if set to 2, each scan might add two units. This could be used in contexts where scanning a case of items should count as multiple units.
– cooldownMs: the scanner cooldown interval in milliseconds. Default ~1000 or 1200 ms. This prevents duplicate reads of the same barcode in quick succession. Both front-end (ScannerModal uses it) and settings store it to allow tuning if needed.
– beepEnabled: whether the device makes a beep sound on scan. The scanner defaults this true. Could be exposed in settings for preference, though not in the persisted defaultSettings snippet. If a user finds beeps disruptive, this could be turned off.
These flags help tailor the app’s behavior without code changes – an Owner can toggle them in the Settings UI, and the system (both frontend and backend) adjusts accordingly.

Feature Toggles (Deprecated/Unused): The presence of scanningModesEnabled and flags for Platinum/Green tiers indicate planned or configurable features. The Green tier is defined in logic but no UI path to achieve it (marked future). The code also had legacy references like deliveryFee (older nomenclature) which is deprecated by unified terms (Route Fee). These terms exist for backward compatibility or future expansion and are clearly marked or default-disabled in the config.

Component & View States

App Level State: The main App component holds critical UI state:
– address (string): delivery address currently entered. Shared between CustomerView input and CartDrawer.
– acceptedPolicies (bool): whether user agreed to terms/policies for checkout. Tied to a checkbox in CartDrawer before enabling payment.
– isLoginViewOpen (bool): controls showing the login modal. True opens LoginView as an overlay.
– isCartOpen (bool): controls the Cart drawer visibility. True means the cart sidebar is shown.
– isProcessingOrder (bool): indicates a checkout is in progress. While true, checkout buttons are disabled and spinner may show.
– cartCount (computed): not stored as state but derived (core.cart.reduce(...)) to display the number of items in cart (on the floating cart button).
– hideCustomerUi (computed): true when admin/driver pages are active (hides the cart button).

ManagementView State: The admin dashboard (ManagementView) manages many UI states:
– activeModule (string): which section is active (analytics, orders, inventory, pricing-intelligence, etc.). Controls conditional rendering of each module’s JSX.
– Inventory A states: e.g., newProduct (object for the form when creating a product for unmapped UPC), upcDraft (draft info for a new UPC entry), isCreating (loading state for creating a product). These manage the form in “Product Creation” panel.
– scannerModalOpen (bool): controls the ScannerModal in management. True when scanning for inventory creation or UPC lookup. Paired with scannerMode to specify context (INVENTORY_CREATE, UPC_LOOKUP).
– scannerMode (ScannerMode or string): as above, holds which scanning mode is active.
– selectedApproval (object | null): when an approval request (refund/adjustment) is selected in Auth Hub, this holds its details (to show in a panel with info like photoProof if any).
– previewPhoto (string | null): used when an approval’s photoProof is clicked to enlarge/preview the image. Likely triggers a lightbox or new window. (We see setPreviewPhoto(selectedApproval.photoProof!) which implies a state to hold a photo for preview).
– auditModel / auditModels / auditModelsError: states for the Analytics module’s AI model selection.
– isAuditing, isAuditModelsLoading, isOpsSummaryLoading: booleans to show loading spinners or disable buttons for Analytics actions.
– Possibly states for orders module (e.g., filter or pagination) – not explicitly shown, but the orders list could have a filter (not in snippet, but plausible).
– newOrder (maybe if creating orders manually, not in current scope).
– settingsDraft (likely an object for editing AppSettings values before saving – implied by a “Save Settings” button, though state not shown, setSettings directly updates core.settings on save).

DriverView State: The driver interface has a distinct set:
– activeOrder (Order | null): the currently selected order the driver is working on. The UI might allow driver to pick from orders and set one as active (to verify returns for that specific order).
– workflowMode (string): 'verification' or 'fulfillment' as discussed, to toggle between returns verification workflow and order fulfillment workflow. Possibly set based on whether the order contains returns (isReturnOnly or has return items) vs product items.
– verifiedReturnUpcs (ReturnUpcCount[]): running list of return UPCs that have been confirmed by scanning. Driver adds to this via scanner or manual input.
– scanEvents (array of ScanEventLogEntry): not explicitly state in snippet, but scanEvents is referenced when sending scan session metadata. Likely logs every scan attempt (with status like detected, added, etc.). Possibly stored in a ref or state.
– quantityEvents (array of QuantityChangeLogEntry): tracks each change in quantity (scan confirmations or manual increments). Also sent in scan session metadata.
– scanSessionIdRef, scanSessionStartedAtRef (refs): likely to identify a scanning session (maybe using a UUID and start time) for linking pre-capture and post-capture events when driver finalizes the verification.
– scannerOpen (bool): controls showing the ScannerModal in driver UI. True when driver is actively scanning (either returns or products).
– scannerMode (ScannerMode): in driver, can be DRIVER_VERIFY_CONTAINERS or a fulfillment mode. This state is set when clicking “Scan” or “Start Verification Scan”. Used for ScannerModal mode prop.
– scannerError (string | null): if an error occurs during scanning (e.g., camera not accessible or BarcodeDetector unsupported, or a special message like “Unrecognized container”), this holds the message to display to driver. It’s used to show a small alert in the UI during scanning.
– manualUpc (string): as with others, for driver’s manual UPC entry field.
– recognizedCount, unrecognizedCount, duplicatesCount (numbers): running tallies of scan results categorized by outcome. These update live: recognized = eligible containers count, unrecognized = scans that aren’t in our UPC database, duplicates = scans ignored due to being the same as last scan until confirmed. These are shown in the UI summary panel while verifying.
– isVerifying (bool): used to indicate when the driver is in the final step of verification or completing delivery. e.g., after clicking “Complete Delivery”, isVerifying may turn true while the app calls backend to finalize, and then false when done. Controls the button state (spinner vs “Complete Delivery”).
– isCapturing (bool): indicates the capture of payment (for any remaining balance) is in progress. When a return pickup order has a remaining Stripe payment to capture (because initial charge was authorized only), clicking “Capture Payment” sets this true until done.
– captureError (string|null): stores any error message from attempting to capture payment. If non-null, likely displayed to driver to inform them the capture failed.
– issueExplanation & issueStatus: related to the “Explain Issue” (Gemini AI) for payment failures. The code calls explainDriverIssue in geminiService, and manages issueStatus (idle/loading) and issueExplanation (text) as state for when a payment fails due to a complex reason. If Stripe declines a charge, the driver can click an “Explain” to get an AI-generated explanation for the failure, which would set these states.
– driverNotice (object|null): A message to display to the driver about the current step. Contains a tone (“success”, “error”, “info”) and a message. Used to inform things like “Verification submitted for review” on success or errors on failure. Dismissed by driver via a button (setDriverNotice(null)).
– isCompletionBlocked (bool computed): true if the driver should not complete the order yet (maybe because payment not captured or returns not verified). For instance, if !paymentCaptured && !isReturnOnly, a note says to capture payment before completing, implying completion button might be disabled (this could be isCompletionBlocked).
– completionTitle (string computed): tooltip or text for the Complete Delivery button explaining why it might be disabled. Possibly set to “Complete delivery” normally, or some note if blocked. In code, we see title={completionTitle} on the button. This gives context if the button is disabled (like “Please capture payment first”).
– payoutChoiceModal (JSX or state): In DriverView, if an order is eligible for both credit and cash payout, the driver might choose on behalf of the customer. A modal to select payout method could be shown (not fully shown in snippet, but payoutChoiceModal is included in JSX conditionally). This likely is controlled by a state like showPayoutChoice and yields a component for user selection (with onSelectCash vs onSelectCredit updating order’s returnPayoutMethod accordingly).

State in Other Components: Smaller components may have local state too (not covered exhaustively):
– Header: might store mobile menu open state or nothing if it’s mostly props-driven.
– CartDrawer: could have internal state for form validation (but it relies on props/state lifted to App for address and policy acceptance). Possibly manages focus or error state for address input.
– LoginView: likely has email, password state and maybe isSubmitting. Not in provided code, but typical.
– UnmappedUpcModal: might have state for the selected existing product (if attaching) or fields for creating new product (though those are lifted to management state newProduct). It likely uses the handlers passed in and core product list to allow search/selection.
– ToastStack: likely stateless (just displays core.toasts).
– BackendStatusBanner: might have no state; it just shows online/offline based on prop and triggers reconnect on click.

The above states ensure that each view (customer, management, driver) is interactive and reflects the current workflow. By structuring state at appropriate levels (App for global modals and cart; ManagementView for admin-specific UI; DriverView for delivery tasks), the app maintains clarity and separation of concerns.

System/Feature Flags (Env Vars & Toggles)

Environment Variables:
– VITE_BACKEND_URL: Front-end env for API server URL. Used to construct fetch calls in the client (e.g., payment endpoints). Defaults to localhost:5000 if not set.
– JWT_SECRET: Backend secret for signing/verifying JWT tokens (session cookie). Set in env; used by jwt.verify in authRequired. Must be consistent between login and subsequent auth checks.
– OWNER_USERNAMES / OWNER_USERNAME: Comma-separated list or single username that should be treated as owners. Backend isOwnerUsername checks if req.user.username is in this list to grant Owner rights. This is a deployment-time control to ensure only specific accounts can be owners (even if someone managed to flip their role, they wouldn’t pass this check unless their username is allowed).
– DRIVER_USERNAMES: Similar list for driver accounts. Possibly used at user creation or login to auto-assign Driver role or to restrict some features to known drivers. In current code, isDriverUsername is defined but not widely used except maybe in certain conditions (it could allow non-owner drivers to use some endpoints like returns submission, but the code mainly uses role checks for that).
– HUB_LAT / HUB_LNG: Coordinates of the operation hub if not stored in DB. The system uses these env values as fallback for distance calculations. Typically configured in production to the warehouse’s location. If missing and not set in AppSettings, distance calculations cannot proceed.
– STRIPE_API_KEY / STRIPE_WEBHOOK_SECRET (implied): The integration with Stripe likely requires API keys, though they weren’t explicitly shown in code. Typically, these would be env vars read by the backend’s payments route to initialize Stripe client. We can infer they exist because payment flows are implemented, but since the code likely keeps keys out of repo, they aren’t visible.
– CLOUDINARY_URL / Cloud Storage keys (possible): The product images and user-uploaded photos might use Cloudinary or another storage (the presence of image URLs and photoProof suggests an image hosting solution). If Cloudinary is used, a VITE_CLOUDINARY_CLOUD or similar keys might exist to allow direct uploads. This is speculative; no direct reference in snippet except that photoProof URLs are likely pointing to some CDN.
– GOOGLE_API_KEY (possible): If Google Pay is integrated, an API key or merchant ID might be needed. Again, not explicit in code provided, but could be in env.
– DEBUG / LOG_LEVEL etc.: Possibly toggles for logging verbosity on backend, not evident in code.

The front-end uses the import.meta.env to access variables with prefix VITE_ (e.g., VITE_BACKEND_URL). The backend uses process.env. These env vars are typically configured per deployment (development vs production).

Config Toggles in DB: The AppSettings record (which can be edited in the admin Settings page) contains feature toggles that overlap with env in function, but are runtime editable:
– Logistics fees config: routeFee, distanceIncludedMiles, band rates, etc., which allow dynamic adjustment of pricing without redeploying.
– Referral and loyalty config: referralBonus can be changed to alter referral program reward.
– Operational toggles: maintenanceMode (e.g., turn on to halt orders during maintenance window), allowGuestCheckout, requirePhotoForRefunds, showAdvancedInventoryInsights, allowPlatinumTier, platinumFreeDelivery. These can be flipped by the Owner on the fly in the Settings UI. When saved, the backend updates the AppSettings document and returns the updated settings, which the front-end core.settings will pick up (we see ManagementView has setSettings prop to update core.settings state after saving).
– Lists: storageZones and productTypes arrays in AppSettings (not shown in settings.js default, but present in types). These might be editable via the UI (to add new storage zones or product categories). If so, they act as configurable lists that propagate to forms (e.g., a dropdown for storage zone when editing a product).
– Scanning config: cooldownMs, defaultIncrement, requireSkuForScanning, shelfGroupingEnabled, possibly beepEnabled (if it were added to settings). These allow fine-tuning scanning behavior (cooldown length, group scanning results by shelf, etc.).

In summary, System flags come from both environment and dynamic settings. Env vars cover secrets and bootstrap config (like who is an owner, service URLs/keys), whereas AppSettings flags cover feature availability and business rule toggles that owners can control during operation. Keeping these documented ensures developers and operators know how to enable/disable features and the intended use of each flag.

Actions & Handlers

User Actions (Front-end): The UI provides various interactive handlers, often passed as props:
– Login/Logout: onLogin (Header) opens login modal; onLogout triggers core.logout() to end session. After login success, onSuccess runs (restore session, fetchOrders).
– Cart & Checkout: Buttons to open cart (onClick={() => setIsCartOpen(true)} on cart button). In CartDrawer: onRemoveItem to remove product, onAddressChange and onPolicyChange tied to form inputs. Checkout triggers: onPayCredits calls credits payment handler, onPayExternal calls external payment handler. These handlers (bound to handleCreditsPayment and handleExternalPayment) orchestrate the checkout process: sending fetch to backend and handling the response (redirect or error toast).
– Product Browsing: In CustomerView, addToCart(productId) adds item to cart with validation (stock check). It uses core.products to find stock and core.cart to check current quantity, then calls core.setCart to update state. A toast “ADDED TO CARGO” confirms addition.
– Order Management: In ManagementView’s Orders module, actions like “Assign to Me” use handleLogisticsUpdate to set an order’s status to ASSIGNED and assign driver. “Mark Picked Up” sets status to PICKED_UP, “Mark Delivered” sets DELIVERED (not fully shown, but likely analogous). These call core.updateOrder(orderId, newStatus, metadata) which hits the /orders PATCH route and then updates state.
– Approvals (Auth Hub): Owner can approve/reject credit/refund requests. Not explicitly in snippet, but likely clicking an approval calls something like core.processApproval(id, decision) or similar. We do see fetchApprovals to load them and approvals list in state. Approving might generate audit logs and adjust accounts (for REFUND, possibly triggers refund via Stripe or credit; for CREDIT_ADJUSTMENT, modifies creditBalance).
– User Management: Possibly editing user profiles (not detailed, but updateUserProfile is passed in props). This likely allows an owner to change user info or tier. E.g., promoting a user’s tier manually might be done via core.updateUserProfile(userId, { membershipTier: … }). Also adjustCredits is provided to change credit balance with reason (this likely creates a LedgerEntry and an ApprovalRequest of type CREDIT_ADJUSTMENT to be approved).
– Inventory Actions: In Inventory module: “Scan Product UPC” opens scanner in create mode. On scanning, handleScannerScan will receive the UPC. If mode is INVENTORY_CREATE, ManagementView likely sets up unmappedUpcPayload and opens UnmappedUpcModal if the UPC isn’t found; if found and auto-stock increment is desired, it might call an API to increment stock. In audit mode, handleScannerScan could simply log counts.
Also, manual inputs: e.g., in UPC Registry, one might enter a UPC and description, then save to create an UpcItem (the code shows form elements for upcDraft like isEligible checkbox). Saving that likely calls an API like POST /upc to add to registry.
– Returns Verification (Driver): Driver can add a UPC via scan or manual input (addUpc(manualUpc, 'manual') which likely calls a similar function to handleScannerScan but marking source). Once scanning is done, driver clicks “Submit for review” or “Complete Delivery” which triggers two main actions:

Capture Payment if needed: calls capturePayment which hits /payments/capture to finalize Stripe payment for any outstanding balance. It sends verifiedReturnUpcCounts so backend can reduce charge by the deposit credit if applicable and capture the rest.

Send Scan Session Metadata: The app calls sendScanSessionMetadata('pre_capture') before capture, and 'post_capture' after capture. This logs the scan session (counts, events) to backend (/api/scan-sessions). Purpose: to keep a record for later audit or machine learning. This is asynchronous and best-effort (error is caught and ignored).

Submit Verification: If returns are to be reviewed by an Owner, the driver likely hits an endpoint (maybe /api/verify-returns) to submit the results. We see in code a call possibly inside a try: const response = await fetch(.../api/verify-returns, { body: { orderId, driverId, customerId, scans, counts...} }). On success, driverNotice is set to success (“Verification submitted for review”) and local state is reset (clearing scans and counts). This triggers an ApprovalRequest of type REFUND or some record that the Owner will see in “Auth Hub” to approve the credit payout.
After submission, the driver can then capture payment (if any remaining) and complete the order.
– Point Redemption: The onRedeemPoints prop suggests an action for customers to redeem loyalty points (perhaps to discount an order). The core method redeemPoints might call backend to convert points to credit or apply to current cart. The UI for this is not detailed (likely a button in CustomerView to redeem points, but currently bound to core.redeemPoints directly with no wrapper logic in App). If unimplemented, it might do nothing or be a stub for future.

Internal Handlers (Backend):
– User creation & login: auth/register route (not shown) likely assigns role=CUSTOMER by default, and upgrades to OWNER/DRIVER if username matches env lists (possibly using isOwnerUsername/isDriverUsername at registration to set role accordingly). The script create-owner.js might bootstrap an initial Owner account if none exists.
– Order processing: Backend POST /orders will create a PENDING order, possibly call Stripe to create a PaymentIntent if card payment. If credits are used, it might immediately deduct authorized credits and respond with an order in AUTHORIZED state. The payments/create-session endpoint (used by handleExternalPayment) creates a Stripe Checkout session (with line items for order total minus any credits) and returns URL.
– Stripe webhooks: Likely backend has webhook handler to mark payment PAID once Stripe confirms. Not shown, but necessary to flip an order from AUTHORIZED to PAID if using Checkout sessions.
– Credit checkout: payments/credits endpoint (called in handleCreditsPayment) will attempt to complete the order using credits. It likely checks the user’s balance and the order total: if sufficient, deduct and mark order as PAID; if partial, maybe create a Stripe session for remainder, or if some edge case occurs, provide a sessionUrl (as code suggests it could still redirect to Stripe if data.sessionUrl exists). On success, it returns updated creditBalance which the frontend uses to update the user.
– Approvals processing: approvals.js route presumably allows Owner to GET pending approvals and POST decisions. Approving a REFUND could trigger either a Stripe refund (if already captured) or issuing store credit. Approving a CREDIT_ADJUSTMENT adds to user’s credit (via LedgerEntry and updating creditBalance), and approving a MEMBERSHIP_UPGRADE might set a user’s tier to a higher level (like granting Platinum if allowPlatinumTier enabled).
– Settings save: Hitting save in Settings module calls either a PATCH/PUT to /settings with updated fields. The backend handleFullSettingsUpdate takes the input, validates numeric/boolean fields, updates the DB, and logs an audit entry of what changed. This audit log (type SETTINGS_UPDATED with details) is visible in Audit Logs module.
– Audit logs generation: Various actions create audit logs: logging in/out, order events (created, status changes, cancellations), product changes, credit adjustments, approval decisions, and settings changes. The function recordAuditLog is called in such places (e.g., after settings update as above, or after an approval decision). These logs are then fetched by fetchAuditLogs for display.

Overall, these actions and handlers ensure that the system is interactive and consistent: front-end calls appropriate backend endpoints through these handlers, and backend not only performs the task but also updates relevant records and logs. The glossary of these actions helps maintain clarity on what each function is intended to do and how components communicate with the backend and core state.

Data Models (Interfaces & Schemas)

User: Represents a customer or staff account. Key fields: id (string), username (unique handle), password (hashed in DB), role ("CUSTOMER" default), creditBalance (wallet credits, default 0), authorizedCreditBalance (credits on hold for pending orders), loyaltyPoints (default 0), membershipTier ("COMMON" default), ordersCompleted (number of finished orders), phoneVerified, photoIdVerified (KYC flags), plus createdAt/updatedAt. The front-end uses a simplified User object via mapUser for currentUser context (not exposing password, etc.).
Dependencies: Users are linked to Orders (Order.customerId, possibly Order.driverId for driver assignment). Tier and verification fields determine what actions user can do (cash returns eligibility, etc.). The model is stored in Mongo (via Mongoose schema).

Product: Inventory item definition. Fields: id, optional sku and upc (some products might have one primary UPC stored here), name, price (retail price in dollars), deposit (usually 0.10 if container has deposit), stock (on-hand quantity), sizeOz (volume/size of item), sizeUnit (unit label such as oz, g, ml), category (e.g., "Soda", "Chips"), image (URL to product image), optional brand, productType (could overlap with category or denote if it's beverage/food), nutritionNote (customer-facing nutrition info), storageZone & storageBin (location codes), isGlass (if container is glass for deposit processing), and isTaxable (if the product is subject to sales tax). This model is central for the storefront and inventory management.
Products are created/updated by owners (via API calls possibly handled in products.js). They are read-only for customers except as part of order listings. The presence of UpcItem separate from Product implies one product can have multiple UPCs (e.g., a product might have a 12-pack and a single can with different barcodes linking to same SKU). Currently, Product has one upc field, but UnmappedUpc flows suggest a more normalized approach (UPC registry).

Order: Detailed above in A-Z, this model ties together products, user, and financial info. In the database, it likely includes fields not all exposed to frontend (like Stripe charge ID, etc.). It interacts with nearly every domain: created by customers, processed by backend (fees and tier discounts computed), updated by drivers (status progression), and overseen by owners (via management UI for assignment, refunds). It references other models by ID (customerId, driverId). Importantly, it contains substructures: items array (productId & quantity), returnUpcCounts, etc., which make it denormalized for easier use (so you don’t have to fetch returns separately).
Calculated fields like authorizedAmount and capturedAmount are set by backend to mirror Stripe transactions in dollars. This ensures front-end can display what was paid. Order’s status flows from PENDING to DELIVERED or REFUNDED as things happen.

LedgerEntry: A record of a change in user’s credit balance. Fields: id, userId, delta (positive for credit added, negative for spent/removed), reason (text describing why, e.g., "Bottle Return" or "Manual Adjustment"), timestamp. This provides an audit trail for credits outside of orders. When orders complete with credit earned or used, or an admin manually adjusts credits, a ledger entry is created to log it. Owners can view a user’s ledger to see their credit history (via /users/:id/ledger).

UpcItem: The UPC registry entry. Each holds info about a barcode: upc, name (if known), depositValue (should be 0.10 for deposit containers, 0 for non-deposit or maybe other values if law changes), price (if mapped directly, though usually price comes from Product), containerType (material), sizeOz, sizeUnit (unit label such as oz, g, ml), isEligible (eligible for deposit credit?). It may also have timestamps. This model is used when scanning returns: if a UPC is not in this collection or isEligible is false, the system will treat it as ineligible (no credit).

nutritionNote (string field): Short customer-facing nutrition info stored on Product; shown to customers via an info icon in the storefront.

sizeUnit (field): Unit label for sizeOz (e.g., oz, fl oz, g, kg, ml, l) stored on Product and UpcItem to distinguish volume/mass units.

SizeUnit (type): Allowed values for sizeUnit (oz, fl oz, g, kg, ml, l).
The “UPC Whitelist” or registry maintenance happens in the management UPC module – adding new UpcItems or editing them (e.g., marking something eligible/ineligible). The design doc notes an operator can attach a UPC to an existing product or create a new one, which corresponds to adding a Product and linking the UPC via UpcItem.

Return Verification: There isn’t a single explicit model named in code for return verification, but effectively the data is captured across Order and ApprovalRequest:
– The driver’s submitted verification likely creates an ApprovalRequest of type REFUND with details of the return (or populates Order.returnAiAnalysis and flags order for review). Possibly a separate model or reuse of an existing: since each order’s returns might need approval, it could either set Order.status to REFUND_REQUESTED and rely on ApprovalRequest for actual credit payout.
– ApprovalRequest: Contains id, type ('REFUND' etc.), userId (the customer to credit), amount (for REFUND or credit adjustments), orderId (optional link), reason (maybe a note), photoProof (for refund if requirePhotoForRefunds is true, or driver’s return photo if any), status (PENDING/APPROVED/REJECTED), timestamps. For returns, the driver’s submission might automatically APPROVE credits (if trusting driver) or create a PENDING REFUND for the owner to approve the credit issuance. This isn’t fully clear, but the structures are in place.

ApprovalRequest: As above, covers not just returns refund but also manual credit adjustments and membership upgrades that need oversight. The management “Auth Hub” shows these requests. When processed, an audit log is recorded (APPROVAL_APPROVED/REJECTED). The actual effect of approving an ApprovalRequest is context-dependent: REFUND might trigger adding delta to credit or a Stripe refund; CREDIT_ADJUSTMENT directly adjusts credit (plus ledger); MEMBERSHIP_UPGRADE changes the user’s tier (likely sets tier to the requested one, e.g., Platinum, if an owner approved an upgrade request).

CashPayout: This model likely logs when a cash payout is made for returns. The code references it in payments route, probably with fields like userId, orderId, amount, method (like "Venmo", "Cash" etc.), and status (if processed). It could integrate with an external cash payment process or simply record that the operator paid out $X to the customer outside the app (since Stripe doesn’t handle cash, an admin might mark it done manually).

AuditLog: Each audit log entry has an id, type (enum of events), actorId (who performed it, could be username or userId), details (text description), and timestamp. Stored in an AuditLogs collection. These are read-only records shown in the admin UI’s audit logs module. Types cover login, logout, order events, product CRUD, credit adjustments, approvals, settings changes, etc., as enumerated. This helps with traceability and debugging issues in the system by showing a timeline of key actions.

Misc: There are likely additional minor schemas: e.g., ResetToken for password reset (the User model has resetTokenHash and expiry, which suggests a token is stored on user when a reset is requested); no separate model needed, it’s in User. Also, an Audit Model concept (for AI audits) might not be a stored schema, but the list of auditModels likely comes from an external service or config (maybe a static list of ML models available via the Gemini service). The ScanSession data posted via /api/scan-sessions might be saved in a separate collection to analyze scanner usage and errors. If implemented, each scan session doc would include orderId, driverId, timestamps, summary of events (similar to what is sent in sendScanSessionMetadata). This would be used for refining the scanning UX (hence why it’s okay to ignore if endpoint unavailable, it’s not critical to operations).

In essence, the data models form the backbone connecting all features: User ties to Orders (customer, possibly driver field); Orders tie to Products (via items), and incorporate Return info which overlaps with UpcItem (eligibility); ApprovalRequests/LedgerEntries/AuditLogs provide oversight and historical record. Keeping these models well-documented avoids confusion when extending functionality – for example, knowing that Order.orderType exists to distinguish returns-only orders helps to not re-invent a flag elsewhere, or understanding that User.membershipTier drives many conditional rules ensures new code respects those tier differences.

By Domain
Inventory Domain (Products & Stock Management)

This domain covers everything about products, stock levels, and scanning for inventory purposes. Key terms and their intent:

Product Catalog: Managed by owners through the Inventory module. Each Product has attributes like name, price, stock, etc.. Operators can create new products (via UnmappedUpcModal when a new UPC is scanned), edit details (not explicitly shown but presumably via a form), and delete products (AuditLogType PRODUCT_DELETED exists). Products have SKU codes which should be used consistently as external references.

Stock Management: Mode A scanning automates stock updates. Scanning a known UPC in Inventory Mode A could instantly increment the stock of that product (the design suggests /api/upc/scan is called to update stock). The code enforces not exceeding available stock when adding to cart on the customer side – this means stock is tracked in real time. Inventory audit reports (Run Audit) are analytics-driven and do not rely on a dedicated scan mode.

UPC Registry (Whitelist): The system has a master list of UPCs (UpcItem) indicating if a barcode is known and eligible. Inventory domain includes maintaining this list: adding new UPC entries, marking eligibility. For example, when the operator buys a new product not in system, they would scan it in UPC Lookup mode, then either attach to an existing product or create a new one. The UnmappedUpcModal is central to this flow – it ensures no UPC goes unaccounted.
Having a separate UPC registry decouples product from barcode, allowing multiple barcodes per product or barcodes that aren’t yet linked to a product (like a bottle that is eligible for return but the product isn’t sold by the store).

Storage and Organization: Products have storageZone/bin fields for where they are kept (useful for finding items during picking or audit). The UI can group by these if shelfGroupingEnabled. Also, productTypes and categories let the owner categorize inventory (like "Beverages", "Snacks"). The design doc mentions not having an “endless page” in mobile – likely splitting inventory by functional modules (receiving vs UPC registry vs maybe category tabs).

Inventory Insights: Under “Analytics”, inventory-related insights might be provided. The presence of auditModel suggests an AI could analyze stock data or sales to predict optimal inventory. The Audit Model dropdown and Run Audit would feed data (like product stock, maybe sales history) to an algorithm (Gemini service) to highlight anomalies or recommendations. AdvancedInventoryInsights must be enabled to use this, which ties inventory domain with AI domain.

Data Model relations: Product data is used in orders (line items reference productId). When stock is changed (via scanning or manual edit), the updated product is sent to clients via core.setProducts (the code passes setProducts={core.setProducts} to ManagementView, meaning after an inventory change, the UI will refresh the product list). The audit logs for inventory actions (create/update/delete product) exist to track changes.

Deprecated/Legacy: The term “inventory receiving” might have been used (i.e., scanning incoming stock shipments) – Mode A essentially covers that. In code, they consistently call it Inventory Management Mode A. There's mention of avoiding it feeling like an “endless page” on mobile – implying the UI is segmented for usability.

In summary, Inventory domain terms ensure clear communication around products and stock. For example, understanding Mode A scanning prevents confusion when training staff or debugging scanning issues. Also, the concept of a UPC registry (whitelist) is crucial for the bottle return system to know what is eligible; by documenting isEligible, developers avoid misusing it (it specifically means Michigan-deposit-eligible container, not just any product eligibility).

Orders Domain (Order Processing & Fulfillment)

The Orders domain encompasses order lifecycle from creation to completion:

Order Creation: When a customer places an order (delivery or returns pickup), an Order record is created with status PENDING. If paying by card, the backend likely creates a Stripe PaymentIntent but doesn’t capture it yet (thus order stays PENDING until authorization). If paying by credits, the backend immediately authorizes the credits and might mark the order as PAID or AUTHORIZED. The OrderType field distinguishes normal product deliveries (DELIVERY_PURCHASE) from returns-only orders (RETURNS_PICKUP), which is important for applying the pickupOnlyMultiplier discount.

Payment Authorization/Capture: On checkout, external payment is done via Stripe. When the user completes Stripe Checkout, Stripe sends a webhook to mark payment successful – at that point, the order moves to PAID (meaning the funds are secured). If a card is only authorized (maybe using manual capture), the order status might be AUTHORIZED first. The system supports capturing later – indeed the driver app has a Capture Payment step for returns orders where initial charge was just an authorization. During capture, the system recalculates final charges (deducting verified returns deposit) and then charges the card accordingly.

Order Assignment & Fulfillment: For delivery, an order needs to be assigned to a driver. In the admin UI, an Owner can click “Assign to Me” or possibly assign to a specific driver. The code “Assign to Me” sets driverId to the Owner (treating owner as acting driver) or to the actual driver’s username/id. After assignment, status becomes ASSIGNED. Drivers then pick up items – when driver leaves the hub, they mark PICKED_UP (there’s a button for that in UI). When en route, status might auto-change to ARRIVING (or driver marks en route; not shown explicitly, but maybe automatically toggled by time or by an action). Finally, upon handing items to customer (and collecting returns if any), the driver marks DELIVERED or completes the delivery via the app (Complete Delivery button triggers final steps like capturing payment and marking delivered).

Order Completion & Closure: After delivery, if everything is done, the order is effectively finished. They might move it to CLOSED status for archival after some time or immediately after delivered. CLOSED might indicate no further actions or edits can occur. The admin interface might filter out closed orders from active views.

Returns in Orders: Some orders include bottle returns. If an order is a mix (delivery + returns), presumably OrderType = DELIVERY_PURCHASE but return fields (returnUpcCounts) are populated. If returns only, OrderType = RETURNS_PICKUP. The Order holds estimatedReturnCredit at creation, giving the user an estimate if they provided a count of containers or scanned them in advance (in a future feature, customers might scan their own returns with phone to get an estimate). The driver upon verification populates verifiedReturnUpcCounts and the system computes verifiedReturnCredit. If payout was credit, that credit is added to user’s wallet (likely when the Owner approves or immediately if auto-approved).
If payout was cash, the CashPayout record must be handled by the owner outside Stripe. The order might then have a flag or note that cash was given (or it could remain REFUND_REQUESTED until owner confirms cash handed over, then mark REFUNDED).

Refunds and Cancellations: If a customer cancels or an issue happens, an order can be moved to REFUND_REQUESTED/REFUNDED statuses. For instance, if an item was out of stock after payment, the owner could cancel the order: this might trigger a Stripe refund and mark order REFUNDED. If a customer complains and requests refund after delivery, owner would create a REFUND ApprovalRequest and if approved, order gets REFUNDED status. CANCELLED isn’t explicitly listed as a status, so presumably a cancellation is treated as REFUNDED (money back) or just removed if before payment.

Dependencies: Orders rely on Products (for item details, though stored by id and quantity, they join or lookup product info as needed). They are linked to Users (customerId, driverId). They generate AuditLogs on creation and updates (e.g., ORDER_CREATED, ORDER_UPDATED, ORDER_CANCELED). They also interplay with the Payments domain: Stripe charge IDs, payment status need consistency. The front-end route /success and /cancel are part of Stripe’s flow, ensuring user is redirected appropriately.

Ensuring Consistency: The spec emphasizes that backend is source of truth for totals. This means any calculation (route fee, distance fee, discounts, credit usage) is redone on server to avoid trusting client’s numbers. For example, distance is computed on backend by resolveDistanceMiles (likely using Google API or haversine) and then applying bands and tier discounts. Tier-based route fee discounts are applied on backend as well. The client’s estimatedReturnCredit is just advisory; the verified count on backend is what determines actual credit. By documenting fields like routeFee, distanceFee, and tier rules, developers will avoid mistakes like double-discounting or forgetting the pickup multiplier.

Order Data for UI: The ManagementView receives all orders via core.orders. It likely filters or segments them (active vs past, etc.). DriverView gets only orders relevant to the driver (in App, core.orders is passed but driver could filter those assigned to them). The customer UI passes core.orders.filter(o => o.customerId === core.currentUser?.id) to CustomerView so customers see only their own orders. This partitioning ensures each user type sees the right subset of orders.

Aging and History: Completed/Closed orders might be removed from active lists after some time. The UI likely shows recent orders. There may be a “history” view for owners to search past orders, not explicitly shown but possible through filters.

By consolidating order-related identifiers (statuses, fields like routeFee/distanceFee, etc.), the development team can align on terminology. For instance, calling it “Route Fee” everywhere (and never “delivery fee” per spec) avoids confusion in receipts and code. Similarly understanding that ASSIGNED status implies a driver (which might be an Owner acting as driver) allows correct handling in code (e.g., don’t show “Assign” if already assigned). Clarifying these terms prevents logic duplication – e.g., if someone didn’t know about orderType, they might create a separate flag for pickup-only; the glossary steers them to use the existing field.

Payments Domain (Checkout & Wallet)

This domain handles how payments are made, whether via external processors or internal credits:

Stripe Payments: The app uses Stripe for card transactions. Terminology: Payment Rail refers to payment method type (Stripe or Google Pay). The code uses gateway field (e.g., 'STRIPE' or 'GPAY') when creating a session. Through Stripe, two main flows exist: Checkout Session (redirects user to a hosted payment page) vs direct PaymentIntents. The implementation chooses Checkout redirect (sessionUrl) for simplicity. After payment, Stripe redirects back to /success or /cancel.
On success, the backend marks order as PAID and the front-end clears the cart. If canceled, no state change occurs (cart remains, user can retry).

Google Pay: Treated similarly to Stripe but possibly through Stripe’s integration (Stripe can handle Google Pay via Payment Request API). The system just distinguishes the gateway string but likely creates a Stripe session regardless (maybe with Google Pay enabled). For the front-end, GOOGLE_PAY is just another PaymentMethod, not a separate service integration beyond what Stripe provides.

Wallet Credits: The internal currency earned from returns. Terms: Credit Balance (user’s stored credits in dollars), Credits Payment (using those credits to pay). The app encourages using credits to reduce card fees. Key logic: which parts of an order credits can apply to depends on tier. Common/Bronze can use credits on products only (not route or distance fees); Silver/Gold/Platinum can cover route and distance too. The backend enforces this with sets like CREDIT_DELIVERY_ELIGIBLE_TIERS – e.g., if a Bronze user has $5 credits and $5 route fee, the system will NOT apply credits to route fee, leaving it for card. Glossary users should know the tier rules for credits so they apply logic consistently on front-end (perhaps disabling credit toggle for certain charges).
Credits usage in code: when paying by credits (/payments/credits), the backend will calculate how much of the total can be covered by credits given the user’s tier and balance. If credits >= allowed portion of total, it will deduct accordingly and either mark order fully paid (if no remainder) or perhaps still create a Stripe session for remainder (though current code doesn’t explicitly show partial credit + card scenario, it's possible design). After processing, it returns updated creditBalance.

Cash Settlements: If user is eligible (Gold/Platinum/Green tiers), they may choose Cash Payout for returns. That means instead of crediting wallet, they get physical cash or external payment (like Venmo). The system charges legal fees for this: Cash Handling Fee and Glass Surcharge (2¢ each per container). So if a user returns 10 bottles (including 2 glass), and chooses cash, their total 10×$0.10 = $1.00 gets fees: $0.02×10 = $0.20, plus $0.02×2 = $0.04, total fees $0.24. They’d receive $0.76 in cash. The backend likely computes this in the calculateReturnFeeSummary or similar function (we see constants and likely a function to sum them). The normalizePayoutMethodForTier function ensures if a Bronze or Silver somehow requested cash, it flips to credit. This guarantees only allowed tiers get cash.
Operationally, a CashPayout entry is created for tracking. The owner would then pay the user offline and mark it done. Until then, perhaps the Order remains REFUND_REQUESTED or some flag to indicate pending payout.

Loyalty Points: Although not a payment method, loyalty points tie into payment domain because they are earned when paying (to incentivize spending). Points are stored in loyaltyPoints. The rate is tier-dependent (Gold gets 1.5x points). For example, if a Gold customer spends $10 on products, calculatePointUnits gives 150 points (assuming 1 point per $1, times 1.5). These points accumulate; presumably, they could be redeemed for discounts or freebies (though the current system doesn’t elaborate on usage, they included onRedeemPoints hook for future use).

Refunds (Stripe): If an order is canceled or partially refunded, Stripe API would be invoked to refund the charge. The system would then update OrderStatus to REFUNDED and possibly create an ApprovalRequest or record for it. Since the spec forbids calling it “processing fee” or such, any Stripe fee lost due to refund is eaten by business (not passed to user). This domain ensures that if a refund happens, the user sees the appropriate credit either back to card or to wallet.

Backend Payment Calculations: At time of order finalization, backend uses functions to compute:
– Route Fee (with pickup multiplier and tier discount) and potential Platinum override.
– Distance Fee (with tier waive for Green).
– Sum of product prices, minus any promotions (none mentioned explicitly aside from tier route discounts).
– If credits are used, subtract those (subject to tier allowance) to determine card charge amount.
The final numbers are stored in Order (total, and breakdown fields). They ensure the sum matches what they charge via Stripe so that reconciliation is possible.

Post-Completion: Once an order is paid and delivered, if it included a returns credit (credit settlement), that credit is already in the user’s wallet (applied either at capture if automatically or after owner approval if required). The user can use it on future orders (the creditBalance persists). If cash settlement, the user got money and nothing is added to wallet. Either way, the order’s financial aspects are done.
The loyalty points for that order are computed and added to user’s loyaltyPoints (maybe when order is marked delivered or at capture time). We saw calculatePointUnits which likely is called when capturing payment. If points were awarded, the user’s loyaltyPoints in DB increases, and maybe a LedgerEntry or separate PointsLedger entry could be recorded (though not present in code, but ledger is specifically for credits, not points).

Admin Controls: The Owner can manually adjust balances: adjustCredits for creditBalance (maybe if a customer complains, give some courtesy credits – this goes through an Approval workflow). Also possibly adjust loyaltyPoints (no explicit function, but they could via user profile edit if needed).

PCI & Security: The system never stores card details – all handled by Stripe. JWT and secure cookies are used for session, which is standard. The “Secure Vault” wording in UI emphasizes that the payment is happening in a secure external page, reassuring users.

Documenting payment domain elements helps ensure that features like partial payments, tier restrictions, and fees are properly implemented. For instance, a developer working on the mobile app or a future feature can refer to this glossary and see “CASH_PAYOUT_ELIGIBLE_TIERS includes GOLD+” – meaning if they show a cash-out option, only show it for Gold and above. Or if they see platinumFreeDelivery, they know enabling it gives free route fee for platinum and should double-check that in UI calculations. The unified vocabulary (Route Fee, Distance Fee, etc.) also prevents confusion – e.g., always use “Route Fee” in user-facing text as per spec.

Users & Auth Domain (Accounts & Identity)

This domain concerns user accounts, authentication, and user-specific features:

Account Creation & Verification: New users sign up (likely providing username, password, and maybe email). By default, they become Common tier (membershipTier COMMON) and Customer role. There may be email verification (though not explicitly shown, possibly out-of-scope). Phone and ID verification fields exist to be updated when the user provides those (e.g., verifying phone via OTP toggles phoneVerified true; verifying ID via manual review toggles photoIdVerified true). These verifications are tied to tier progression rules.

Login/Logout: Authentication uses JWT cookies. When user logs in, backend generates a token (probably containing userId, role, etc.), sets it as session cookie. The front-end then calls core.restoreSession() to fetch current user info from /api/auth/me and populate core.currentUser. The cookie has httpOnly, etc., so JS doesn’t directly handle it beyond triggering network requests with credentials. Logging out clears these cookies and front-end resets state (core.currentUser to null, etc.). The system likely supports persistent login (cookie lasting 7 days as set in setAuthCookie).

Roles & Privileges: As discussed, a user’s role (CUSTOMER/DRIVER/OWNER) determines UI routes and backend access. The application ensures only Owner sees management sections, etc. Implementation detail: after login, if an Owner logs in, they are redirected to management perhaps; if Customer, to homepage. The code uses Routes with protection by checking role and redirecting if not allowed.

Membership Tiers: Each user has a membershipTier which can change over time. The system automatically promotes tier based on completed orders and verification status using maybeAutoPromote. For example, once a user completes 50 orders and has phone verified, they become Silver. When they hit 100 and have ID verified, they become Gold. Platinum is invite-only (not auto-promoted) – an owner would manually set membershipTier to PLATINUM (which might require allowPlatinumTier flag on). The tiers grant benefits (as described in Payments domain: credits usage and cash-out eligibility, plus route fee discounts for Bronze 10%, Silver 20%, Gold 30%). Green tier is future, presumably to be assigned manually or via separate logic. Documenting these ensures any code branch or query that deals with user tier uses correct values and knows the implications.

User Profile Data: Aside from authentication fields, profile might include name, email, address, etc. The User interface shows name? and possibly username is used as login (which might double as email or a handle). The spec’s tier requirements mention “email, address, username required for Common” – implying the system expects those fields filled even for base tier. It’s possible username is a unique handle and they also have an email field (maybe not shown in types.ts but likely present in a real system). The code doesn’t show email, but given a reset password feature is implied by resetToken, an email must exist. Perhaps username in this system is actually the email (commonly done) – or they just omitted email from the interface snippet. The glossary can note that if needed.
For now, we treat username as the login identifier (which could be an email in practice).

Reset Password: The presence of ResetPasswordView and the User.resetToken fields suggests a flow: user requests reset (maybe via /auth/reset which sets resetTokenHash and expiry on their record), they get a link (not covered in client code, likely via email). They then come to /reset-password route in app, which corresponds to ResetPasswordView component. That view likely allows entering a new password, and it calls backend to verify the token and update password. After which, they can log in with new password. For security, resetTokenHash is stored (not plain token) and compared by backend when validating reset link, and then cleared on success. This process isn’t fully shown, but the components and fields confirm it exists.

Audit & Monitoring: The system logs LOGIN and LOGOUT events in AuditLog. Also, maybe any failed login attempts might not be logged (no mention, but possible future addition). Owners can see who logged in when, via Audit Logs.

User Stats: The admin can view usage statistics per user (order count, total spend, last order) via the UserStatsSummary and related endpoints. This helps identify top customers or usage patterns. It’s part of the Users or Analytics domain but fundamentally tied to user accounts.

Dependency on External Auth: If the system later integrates social logins (Google/Facebook), those would add fields or alternate flows. Currently, only internal auth with JWT is described.

PII and Data Protection: Since it’s an internal tool, but still deals with personal info (address, phone for deliveries), ensuring fields like phoneVerified and photoIdVerified are handled carefully is key (photo IDs are sensitive). The photoProof in ApprovalRequests for refunds might be a picture of a broken item or similar – should be protected.

For devs, having Users & Auth glossary prevents duplication like separate “admin” flags (since role=OWNER suffices), or confusion between username and name. Also, it clarifies the tier vs role difference: roles are about system access; tiers are about customer level and benefits. A new developer might ask “is an Owner also in a tier?” – yes, Owner can also have a tier field, but it’s irrelevant for benefits (they probably don’t shop with their account). Similarly, a Driver has tier (maybe default COMMON) but that’s irrelevant for returns, as drivers likely won’t place orders. Clarifying these can avoid misusing fields (e.g., one should not assume tier indicates staff or customer – role covers that separately).

Returns Domain (Bottle Returns & Recycling)

This domain focuses on the handling of returnable containers and refunding deposits:

Michigan 10¢ Deposit: All eligible containers are worth $0.10 on return by law. The system treats this as fixed depositValue in UpcItem (0.10 if isEligible=true). The business model is that NinpoSnacks collects containers and redeems them in bulk. Customers get their deposit back as either credit or cash (less fees). No other values (no 5¢ containers, as Michigan only has 10¢, and no dynamic pricing) – the spec explicitly says no multipliers on container value.

Return Scanning (Driver): When picking up returns, driver uses the app to scan each container’s barcode. The app does normalization (strip non-digits, ensure length is 8,12,13 which cover UPC-E, UPC-A, EAN-13). It filters out invalid or duplicate scans (the logic with lastCodeRef and repeatCount ensures the same code must appear twice in a row to be accepted, reducing false reads). Each valid new UPC triggers handleScan which logs the event and updates counts. Driver must confirm duplicates (the UI shows “Same UPC — tap to add again” as per contract).
The outcome of scanning is a tally of each UPC returned (verifiedReturnUpcCounts).

Return Value Calculation: The app (driver side) shows recognized vs unrecognized count. Recognized means UPC found in the registry and eligible; unrecognized could mean not in registry or explicitly marked ineligible. The driver might still collect unrecognized ones but the system will probably not credit for them (they could be non-deposit items or foreign containers).
The total eligible count * $0.10 = gross deposit value. If payout is credit, the customer should get that full amount (gross = net). If payout is cash, apply fees: effectively the customer gets $0.08 per container if both fees apply for glass, $0.10 for aluminum/plastic if no fees (but in practice always 2¢ handling, plus 2¢ for glass). The Return Fee Summary likely breaks this down (the code hint calculateReturnFeeSummary suggests computing how many containers, how many glass, and the total fees).

Submitting Returns: After scanning, driver submits for review. If requirePhotoForRefunds is true, perhaps the driver must also take a photo of the bags of returns as proof (the scanner has onPhotoCaptured support in returns mode as well – though in DriverView code, they did not use onPhotoCaptured for Mode C; they did use camera for capturing delivery proof separately with takeDeliveryPhoto). It’s possible that if any discrepancy or if the owner wants, they could request a photo via the app or the driver might proactively take one (not clearly enforced except maybe by company policy).
Once submitted, if auto-approval is configured, the system could immediately credit the user’s account (e.g., some implementations might auto-credit if driver is trusted). However, given they built an Admin “Auth Hub”, likely returns credit goes into an approval queue (type REFUND). That means human verification: the owner will check the submission (they see counts, maybe the AI analysis result from ReturnAiAnalysis), then approve or adjust. This mitigates fraud (e.g., driver colluding with someone to scan fake barcodes).

AI in Returns: They integrated an AI analysis for returns (Gemini “BrainCircuit” icon seen in code likely for some AI task). The ReturnAiAnalysis might be filled by sending the driver’s collected containers data or a photo to an AI. Possibly, if the driver takes a photo of the returned containers, an AI could try to count or verify material (that might be what analyzeBottleScan does in DriverView import). If so, it could flag contamination or non-eligible items automatically (setting flags like "non-eligible brand detected" or valid=false if things look off). The driver can see an AI message (aiCondition) about the return (maybe “Mixed trash detected, please confirm no garbage included”). The driver can then confirm contamination if true (toggle contaminationConfirmed) or proceed if all good. These AI outputs also go to the owner for final decision (the summary or flags in ReturnAiAnalysis).

Return Credit Application: After approval, if credit settlement, creditBalance is increased by the verified amount. If the return was part of a product delivery order, the credit might have been immediately applied to that order (the app allowed “Apply credit to current cart” in spec). It’s unclear if that’s implemented: possibly if a user schedules a delivery with returns, at checkout they have an option to apply the estimated return credit to the purchase (reducing the card charge). If they choose to apply immediately, the order total on Stripe is lowered by estimatedReturnCredit (for credit settlement only). The code and spec hint at this: “Customer chooses: Apply credit to current cart or store in wallet”. If they applied to cart, then the creditAuthorizedCents would represent that portion. At driver verification, if they returned fewer bottles than estimated, presumably the difference has to be charged (capture more from card) or if more, perhaps give additional credit. This is complex but the design likely is: always estimate conservatively (maybe limit to what they scanned themselves if any; otherwise maybe they don’t actually support apply-to-cart yet).
In absence of explicit code, likely current flows always store in wallet rather than apply to current order (because that requires pre-verification).

User Experience: For returns, if the user selects credit, they get a nice “X credits applied” message and their wallet updated (the app shows toast “CREDITS APPLIED” on success of credit payment which is analogous outcome). If cash, the driver would tell them the cash amount (the app can compute it). Possibly the app could display a breakdown: “You returned 10 containers = $1.00, Cash handling fee $0.20, Glass fee $0.04, you receive $0.76 cash.” Such detail likely goes in a receipt or the driver’s app to inform them. The spec indicates only route-level fees and such appear on receipts, but maybe for returns they also show cash fees if applicable.

Key Identifiers: ReturnUpcCount and arrays in Order link directly to returns domain, as do returnPayoutMethod, ReturnAiAnalysis, and statuses like REFUND_REQUESTED. The glossary ensures understanding that these are not separate from orders but part of them. E.g., a developer adding a new return-related feature should use the existing returnUpcCounts field rather than create a new property.

Environmental Impact: The use of terms like Green Tier implies a future focus on encouraging returns (Green gives free route and no distance fee to heavy re-users). And naming like “Bottle Return Service” as core concept shows returns are not a side gig but a central offering. So, the domain is first-class in design: they built scanning, AI, separate order type, and approval flows around it.

By grouping these return-specific terms and rules, the developers can keep the logic consistent. For example, if building a reporting feature for total returns, they know to sum verifiedReturnUpcCounts across orders. Or if adjusting fees, they know to look at CASH_HANDLING_FEE_PER_CONTAINER and GLASS_HANDLING_SURCHARGE_PER_CONTAINER constants. It also helps ensure the UI messaging remains correct (never call the deposit refund a “bottle fee” – the spec forbids that term; always use “Cash Handling Fee” etc., which the glossary reinforces).



## [AUTO-GENERATED: Review and Complete]

App (component): Main React entry point for the frontend application. Handles global state, routing, and passes core props to views and components.
constants.tsx (utility): Central file for frontend constants (e.g., enums, config values) used throughout the app.
main.tsx (entry): Frontend entry file that bootstraps the React app and renders App to the DOM.
types.ts (types): TypeScript type and enum definitions for roles, order statuses, scanner modes, user tiers, and shared interfaces. Authoritative for frontend types.
GEMINI.md (doc): Frontend contract/spec for scanner, SKU, and UX. Documents UI/UX rules and links to GLOSSARY.md for term definitions.

BackendStatusBanner (component): UI banner showing backend API status. Indicates online/offline and provides reconnect action.
CartDrawer (component): Slide-out cart panel for reviewing/editing order items, address, policies, and payment. Central to customer checkout flow.
Header (component): Top navigation bar with login/logout, branding, and links. Appears on all main views.
LegalFooter (component): Footer with legal notices, copyright, and links. Shown on all pages.
Navbar (component): Main navigation bar for switching between app sections (e.g., shop, management, driver).
ScannerModal (component): Shared camera barcode scanner modal. Handles scanning, cooldown, and scan events for all scanner modes.
Example usage:
	<ScannerModal
		mode={ScannerMode.INVENTORY_CREATE}
		onScan={handleScannerScan}
		onClose={() => setScannerModalOpen(false)}
		title="Scan Product UPC"
		subtitle="Scan to add product or audit inventory"
		beepEnabled={settings.beepEnabled}
		cooldownMs={settings.cooldownMs}
		isOpen={scannerModalOpen}
	/>
Cross-file relationships: Imported by ManagementView, DriverView, CustomerView. Depends on types.ts for ScannerMode enum.
Business rationale: Centralizes all scanning logic to enforce consistent UX and business rules for inventory, returns, and audits.

geminiService.ts (service): Frontend service for interacting with Gemini AI APIs (e.g., label analysis, issue explanation).
Example usage:
	const result = await analyzeBottleScan(photoDataUrl);
Cross-file relationships: Used by ManagementView for AI label analysis and issue explanation. Calls backend endpoints for AI tasks.
Business rationale: Abstracts AI logic and backend communication, enabling advanced inventory and returns analysis without exposing keys.

ManagementView (view): Admin dashboard for owners. Manages modules (orders, inventory, users, settings, audit logs, approvals).
Example usage:
	<ManagementView
		user={currentUser}
		products={products}
		setProducts={setProducts}
		orders={orders}
		...
	/>
Cross-file relationships: Imports ScannerModal, UnmappedUpcModal, geminiService, types.ts. Central hub for all admin actions and state.
Business rationale: Provides a unified interface for business operations, enforcing workflow, audit, and approval rules.

DEPRECATED: deliveryFee (term): Deprecated in favor of routeFee. Appears in legacy code paths and should be cleaned up in future refactors.
ToastStack (component): Renders notification toasts (success, error, info) for user feedback. Consumes core.toasts state.
UnmappedUpcModal (component): Modal for handling unmapped UPC scans. Allows creating new products or linking UPCs to existing products.

CustomerView (view): Main shop interface for customers. Displays products, orders, and handles cart actions and point redemption.
DriverVerificationDelivery (view): Driver workflow for verifying bottle returns and delivery. Handles scan events, verification, and payout selection.
DriverView (view): Driver interface for managing assigned orders, scanning returns, and completing deliveries.
LoginView (view): Modal for user login. Handles authentication, session restore, and error states.
ManagementView (view): Admin dashboard for owners. Manages modules (orders, inventory, users, settings, audit logs, approvals).
PaymentCancel (view): Displays payment cancellation message after failed/aborted checkout.
PaymentSuccess (view): Displays payment success message and triggers cart clearing after checkout.
ResetPasswordView (view): Modal for password reset flow. Handles token verification and password update.

geminiService.ts (service): Frontend service for interacting with Gemini AI APIs (e.g., label analysis, issue explanation).
useNinpoCore.ts (hook): Custom React hook providing core app state and actions (products, orders, users, settings, etc.).
audioUtils.ts (utility): Utility functions for audio playback and feedback (e.g., scanner beep).

index.js (server): Main backend entry point. Sets up Express server, routes, and middleware.
GEMINI.md (server doc): Backend contract/spec for SKU, UPC, inventory, and API rules. Authoritative for backend logic.

ApprovalRequest.js (model): Mongoose model for approval requests (refunds, credit adjustments, membership upgrades).
AppSettings.js (model): Mongoose model for system-wide configuration and feature flags.
AuditLog.js (model): Mongoose model for audit log entries (login, logout, order, product, settings changes).
CashPayout.js (model): Mongoose model for cash payout records for bottle returns.
Counter.js (model): Mongoose model for tracking counters (e.g., order numbers, scan sessions).
InventoryAudit.js (model): Mongoose model for inventory audit records and AI analysis results.
LedgerEntry.js (model): Mongoose model for credit balance changes per user.
Order.js (model): Mongoose model for customer orders (products, returns, payments, statuses).
Product.js (model): Mongoose model for inventory products (sku, upc, name, price, deposit, stock).
ReturnSettlement.js (model): Mongoose model for settled bottle return payouts.
ReturnVerification.js (model): Mongoose model for driver-submitted return verifications.
ScanSession.js (model): Mongoose model for scan session metadata (events, counts, timestamps).
UpcItem.js (model): Mongoose model for UPC registry entries (barcode, eligibility, product mapping).
User.js (model): Mongoose model for user accounts (role, tier, credits, verification).

ai.js (route): Express route for AI-related endpoints (label analysis, issue explanation).
approvals.js (route): Express route for approval request management (refunds, credit adjustments).
audit-logs.js (route): Express route for audit log retrieval and creation.
auth.js (route): Express route for authentication (login, logout, session).
distance.js (route): Express route for distance calculation and fee logic.
health.js (route): Express route for health checks and status.
inventory-audit.js (route): Express route for inventory audit actions and AI analysis.
orders.js (route): Express route for order management (create, update, assign, deliver).
payments.js (route): Express route for payment processing (Stripe, credits, Google Pay).
products.js (route): Express route for product management (create, update, list).
returns.js (route): Express route for bottle returns (scan, verify, settle).
scan-sessions.js (route): Express route for scan session metadata logging.
settings.js (route): Express route for system settings management.
stripe.js (route): Express route for Stripe payment integration.
upc.js (route): Express route for UPC registry management.
uploads.js (route): Express route for file uploads (images, documents).
users.js (route): Express route for user management (profile, stats, tier).

connect.js (db): MongoDB connection utility for backend database.

audit.js (utility): Backend utility for audit log creation and management.
distance.js (utility): Backend utility for distance calculations (miles, bands, fees).
helpers.js (utility): Backend utility functions for common tasks.
sku.js (utility): Backend utility for SKU generation and validation.
helpers.test.js (test): Backend test file for helpers.js functions.

ReceiptParseJob (data model/process):
Represents a single backend attempt to parse a captured receipt image. Created automatically when a new ReceiptCapture is ingested (via camera, upload, or email). Tracks parse status (QUEUED, PARSING, PARSED, NEEDS_REVIEW, APPROVED, REJECTED, FAILED), attempt count, error details, and timestamps. Enforces strict state transitions: every ReceiptCapture must have an active or scheduled ReceiptParseJob. The backend retries parsing up to 5 times on transient errors, with exponential backoff. After max attempts, status is set to FAILED and parseError is persisted. See GEMINI.md and RECEIPT_REVIEW_ARCHITECTURE.md for full workflow and anti-stuck policy.

ReceiptStoreDraft (data model/process):
Temporary, uncommitted representation of parsed receipt line items and store metadata. Created after successful or partial parse of a ReceiptCapture. Used to stage edits, corrections, and product mappings before final approval. Operators review and adjust ReceiptStoreDrafts in the management UI. Only after explicit approval/commit does the draft become a permanent catalog update. Drafts are always linked to their originating ReceiptCapture and ReceiptParseJob. See GEMINI.md and RECEIPT_REVIEW_ARCHITECTURE.md for review/commit semantics.

cleanupAbandonedOrders.js (script): Backend script to clean up abandoned orders.
create-owner.js (script): Backend script to bootstrap an initial owner account.
findAbandonedAuthorizations.js (script): Backend script to find abandoned payment authorizations.

helpers.test.js (test): Backend test file for helpers.js functions.
