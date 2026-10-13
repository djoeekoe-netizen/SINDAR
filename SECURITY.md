# Security Policy

SINDAR runs on your own device and can execute commands on your behalf. Treat it accordingly.

## Reporting a vulnerability

Please open a **private security advisory** on GitHub (Security → Advisories → Report a vulnerability)
rather than a public issue. We aim to acknowledge reports within 72 hours.

## Design principles (see PLAN.md §15)

- Trusted gateway / untrusted execution: inbound channel messages are untrusted input.
- Approval policy (`ask` by default) with hard floors for destructive commands even in `yolo` mode.
- Secrets live only in `~/.sindar/.env` (mode 600), are never injected into prompts, and are redacted from logs.
- The gateway binds to `127.0.0.1` by default; exposing it requires a token.
- Database and config files are created owner-only (`0600`).
