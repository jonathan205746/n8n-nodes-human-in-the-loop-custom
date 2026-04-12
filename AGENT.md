# AGENT

This repository contains the implementation for `n8n-nodes-human-in-the-loop-custom`.

## Architecture

- Node 1: `Create HITL Link`
  - Generates signed callback links
  - Computes SLA metadata
  - Resolves recipient groups
- Node 2: `Wait For HITL Response`
  - Waits for webhook callback or timeout
  - Validates signatures
  - Returns normalized HITL result to workflow

## Release target

Public npm package: `n8n-nodes-human-in-the-loop-custom`

## Required runtime assumptions

- n8n v2.x
- Public HTTPS reachable webhook URLs
- Shared signing secret configured in credentials
