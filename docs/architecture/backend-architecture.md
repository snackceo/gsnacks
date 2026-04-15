# Backend Architecture

## Structure

/server
  /modules
    /auth
    /users
    /orders
  /config
  /middleware

---

## Layers

- Routes → define endpoints
- Controllers → handle request/response
- Services → business logic
- Models → database schemas

---

## Rules

- No business logic in controllers
- No DB access outside services
- All inputs must be validated