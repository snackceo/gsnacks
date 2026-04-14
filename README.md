# GSnacks Documentation Hub

> **Canonical Source (README):** This file is for navigation and operational quickstart only. Do not define domain terms or non-negotiable behavioral contracts here.

## Doc Ownership

- **[GLOSSARY.md](GLOSSARY.md)** — Canonical definitions and terminology only.
- **[GEMINI.md](GEMINI.md)** — Canonical non-negotiable behavior, invariants, and contracts.
- **[README.md](README.md)** — Navigation, contributor workflow, and operational quickstart.
- **[MAINTENANCE.md](MAINTENANCE.md)** — Operational maintenance and remediation runbooks.

## Quickstart

### 1) Development startup

```bash
# install dependencies (root)
npm install

# start frontend/backend as configured by repo scripts
npm run dev
```

### 2) Common operations

```bash
# run tests
npm test

# lint (if configured)
npm run lint
```

### 3) Where to find policy/rules

- API/cookie invariant, scanner contracts, SKU/UPC rules, and receipt workflow:
  - See **GEMINI contracts** in [GEMINI.md](GEMINI.md).
- Domain definitions (tiers, fees, statuses, scanner modes, model names):
  - See **Glossary terms** in [GLOSSARY.md](GLOSSARY.md).

## Contributor doc workflow

When making changes:

1. **New/changed term?** Update [GLOSSARY.md](GLOSSARY.md) first.
2. **New/changed invariant or contract?** Update [GEMINI.md](GEMINI.md) first.
3. Keep README changes limited to quickstart/navigation and links.

## Change control recommendation

To prevent duplication drift:

- Prefer linking to canonical sections instead of repeating policy prose.
- During review, reject README changes that introduce contract-level language or full term definitions.


## Operations & maintenance

For maintenance scripts and runbooks, see **[MAINTENANCE.md](MAINTENANCE.md)**.
