# Rate Limiting

This document describes the rate limiting strategy for the Ninpo Snacks API.

## Strategy

Rate limiting is implemented using the `express-rate-limit` middleware.

## Limits

The API has a global rate limit of 100 requests per minute per IP address.

Specific endpoints may have stricter rate limits. For example, authentication endpoints have a limit of 10 requests per minute.
