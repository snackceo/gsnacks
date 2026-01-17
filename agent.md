# AI Agent Contract (agent.md)

## Purpose

This document defines **how AI assistants are allowed to operate inside this codebase**.
It exists to prevent drift, hallucinated behavior, partial edits, and logic contradictions.

If there is any conflict between:

* agent.md
* GEMINI.md
* server/GEMINI.md
* src/GEMINI.md
* GLOSSARY.md

…the **more specific document wins**, and **code is wrong**, not the document.

---

## 1. When an AI Agent May Act

An AI agent may:

* Explain existing behavior
* Propose changes **without implementing them**
* Implement changes **only when explicitly requested**
* Edit files **only with full-file replacements** unless told otherwise

An AI agent must **not**:

* Assume intent
* Create new flows without confirmation
* Modify business rules implicitly
* Invent missing files, APIs, or schemas

---

## 2. Edit Rules (Hard Constraints)

### 2.1 File Editing

* **Full file replacements only**
* Never send snippets unless explicitly requested
* Never shrink files for convenience
* Never remove logic unless instructed

If context is missing, the agent must stop and ask for the relevant file.

### 2.2 Assumptions

* No assumptions about:

  * product lifecycle
  * payment logic
  * inventory rules
  * scan behavior
  * user roles

If a rule is not documented, the agent must ask.

---

## 3. Domain Authority

The agent must respect domain ownership:

* **Money, credits, fees** → backend authoritative
* **Inventory mutations** → backend authoritative
* **SKU generation** → backend only
* **UPC resolution** → UPC Registry only

UI may preview, but must never finalize state.

---

## 4. Scanner-Specific Rules

* There is exactly **one scanner system**
* Scanner behavior is defined by **mode**, not by component duplication
* One scan always results in one visible outcome
* Silent failures are forbidden

The agent must not:

* Introduce a second scanner
* Bypass cooldown logic
* Auto-create products without operator intent

---

## 5. External Data Sources (e.g. Open Food Facts)

* External APIs are **advisory only**
* All autofilled data must remain editable
* External data must never overwrite operator-confirmed values

Caching, rate-limiting, and normalization must be server-side.

---

## 6. Change Proposal Protocol

For non-trivial changes, the agent should respond in this order:

1. **Restate the current behavior** (as implemented)
2. **Identify the exact problem**
3. **Propose one or more options**
4. **Explain trade-offs**
5. **Wait for confirmation before coding**

Skipping directly to code is a violation unless explicitly requested.

---

## 7. Language & Terminology

* All terms must match GLOSSARY.md exactly
* No synonyms for business concepts
* If a term is missing, it must be added to the glossary first

---

## 8. Enforcement

If an AI response:

* contradicts documented rules
* introduces silent behavior
* removes safeguards
* invents logic

…it must be rejected.

This file exists to make AI a **tool**, not a decision-maker.
