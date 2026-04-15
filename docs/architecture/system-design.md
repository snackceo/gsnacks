# System Design

## Overview

Ninpo Snacks follows a modular full-stack architecture:

- Client (React)
- API Server (Express)
- Database (MongoDB)
- External Services (Stripe, Cloudinary, Twilio)

---

## High-Level Flow

1. Client sends request
2. API validates input
3. Auth middleware verifies JWT
4. Controller → Service → DB
5. Response returned to client

---

## Key Principles

- Separation of concerns
- Stateless API
- Modular feature-based structure
- Secure-by-default design