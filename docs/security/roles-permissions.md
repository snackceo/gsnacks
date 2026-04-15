# Roles & Permissions

## Roles

- OWNER
- ADMIN
- DRIVER
- CUSTOMER

---

## Enforcement

- All protected routes require authentication middleware.
- OWNER has full access.
- ADMIN has operational access but must not perform owner-only financial controls.
- DRIVER is limited to assigned delivery/order workflows.
- CUSTOMER is limited to self-owned data.

---

## Example

Owner/Admin routes:
- Manage products
- Manage inventory
- Review bottle returns

Driver routes:
- Update assigned order status
- Upload delivery proof

Customer routes:
- View/update own profile
- View own order and return history
