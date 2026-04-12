# n8n-nodes-human-in-the-loop-custom

Public n8n Community Node package for channel-agnostic Human-in-the-Loop (HITL) workflows.

## What this package solves

This package enables a real pause/resume HITL pattern for AI agents:

1. Generate signed response links (`approve`, `reject`, `respond`)
2. Send those links over any channel (email, Telegram, Mattermost, WhatsApp, etc.)
3. Wait for human input with timeout fallback
4. Return structured result back to the AI workflow/tool call

No external mobile app or paid HITL platform is required.

## Included nodes

- **Create HITL Link**
  - Creates signed action links
  - Resolves group routing from JSON mapping
  - Computes SLA timestamps (`waitUntil`, `reminderAt`, `escalationAt`)
  - Supports chat/standard/custom timeout modes with weekend extension

- **Wait For HITL Response**
  - Puts execution in wait state until callback or timeout
  - Validates signed callback payloads
  - Supports GET/POST callbacks and optional response form
  - Returns status: `answered`, `rejected`, `timeout`

## Installation (n8n Community Nodes)

1. In n8n, open `Settings -> Community Nodes`
2. Select `Install`
3. Enter package name:
   - `n8n-nodes-human-in-the-loop-custom`
4. Restart n8n

## Credential setup

Create credential **HITL Signing Secret**:

- `Signing Secret`: shared HMAC secret used by both nodes

Use a long random secret (for example generated via password manager).

## Recommended workflow pattern

1. **AI Agent** (with `Call n8n Workflow Tool`)
2. **Subworkflow**:
   - `Create HITL Link`
   - Channel send node (Email/Telegram/Mattermost/...)
   - `Wait For HITL Response`
3. Return node output to the AI agent tool call

This ensures human responses are processed by the AI runtime, not pasted directly into an end-user chat response.

## Timeout behavior

- `chat` mode default: 1 hour
- `standard` mode default: 24 hours
- `custom` mode: configurable
- Optional weekend extension to at least 72 hours (Fri/Sat/Sun)

If no human response arrives before deadline, `Wait For HITL Response` returns a structured timeout payload with fallback text.

## Public npm release

- Versioning: `0.1.x`
- Tag releases with `v*` (for example `v0.1.0`)
- GitHub Actions pipeline publishes to npm using `NPM_TOKEN`

## Security notes

- Links are HMAC signed (`sha256`) and include expiry (`exp`) and nonce
- Expired or invalid links are rejected
- First valid responder wins (subsequent responses are rejected)

## Local development

```bash
npm install --omit=peer
npm run lint
npm run test
npm run build
```

## License

MIT
