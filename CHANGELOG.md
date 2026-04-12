# Changelog

## 0.1.2

- Added configurable branding for HITL response pages:
  - page heading
  - stylebar text and color
  - custom button labels
  - custom CSS
- Passed branding values from `Create HITL Link` to `Wait For HITL Response` rendering
- Improved response/confirmation page theming consistency

## 0.1.1

- Added SVG icons for both nodes and credentials for n8n review compatibility
- Copied icon assets into `dist` during build so published package contains them
- Improved response form to display the original question from link query
- Added runtime usage hints to clarify active waiting execution requirement
- Aligned waiting webhook path with `$execution.resumeUrl` default behavior

## 0.1.0

- Initial public release
- Added `Create HITL Link` node
- Added `Wait For HITL Response` node
- Added HMAC signed link generation and validation
- Added timeout, reminder, escalation SLA metadata
- Added weekend timeout extension support
- Added replay guard (first responder wins)
- Added Vitest unit tests for signatures, timeout planning, replay guard
- Added GitHub Actions CI and npm publish workflow
