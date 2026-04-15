# Secrets Management

This document describes how secrets are managed in the Ninpo Snacks application.

## Storage

Secrets are stored in environment variables and are not checked into version control.

## Production

In production, secrets are managed through the hosting provider's secret management service.

## Local Development

For local development, secrets are stored in a `.env` file in the `server` directory. This file is not committed to git. An example file `.env.example` is provided in the `server` directory.
