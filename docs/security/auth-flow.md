# Authentication Flow

## Login

1. User submits credentials
2. Server validates input
3. JWT issued

---

## Request Flow

1. Client sends JWT in header
2. Middleware verifies token
3. User attached to request

---

## Security Rules

- JWT must be signed with strong secret
- Tokens must expire
- Never store secrets in code