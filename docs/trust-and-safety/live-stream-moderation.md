# Live stream moderation

**Status: draft; verify all technical actions in production-like testing.**

```mermaid
flowchart TD
  A[Report received] --> B[Restricted incident record]
  B --> C{Urgent danger or exploitation?}
  C -->|Yes| D[End stream / suspend hosting as warranted]
  C -->|No| E[Moderator triage]
  D --> F[Preserve available relevant records]
  E --> F
  F --> G{Potential reportable child exploitation?}
  G -->|Yes| H[Child-safety and CyberTipline process]
  G -->|No| I[Community enforcement decision]
  H --> J[Restricted case follow-up]
  I --> J
```

Safety intervention, evidence preservation and required reporting can occur **in parallel**; reporting must not wait for a final internal investigation.

## Where records live
- **Go live admin (/admin/live, backed by the access-controlled D1 database):** reports, holds with their session snapshots, the action log, blocks, approved hosts and access requests. These are created by the software and are the system of record for routine moderation.
- **Restricted incident system (to be designated):** anything that must not sit in the application database or in GitHub: case notes on child-safety incidents, CyberTipline report identifiers and acknowledgments, communications with counsel or law enforcement.
- **Never:** GitHub issues, pull requests, commits, chat tools or Nostr DMs for case details. The admin DM alert carries only the reason, the stream title and links.

## Enforcement is human
No stream is ended and no account is blocked automatically. Reports open a hold and alert a moderator; a person decides every enforcement action, and that action is recorded in the action log with its time and actor.

## Intake
Use a secure system to capture case ID; received-at time; stream ID and/or public announcement event ID; alleged conduct and approximate time; available host public key; relevant reporter-submitted description; current stream status; reviewer; actions and time of actions. Minimize personal data.

## Intervention
- Route urgent alerts to an actively monitored channel with backup escalation.
- On credible imminent safety risks, promptly terminate the stream (**End**) and restrict hosting where warranted (**Block**, which also ends any open session).
- Confirm playback is actually disabled and stream discovery cleared. Public Nostr content may persist on independent relays.
- Preserve available relevant metadata before ordinary deletion, even when video itself was never recorded.
- Separately track stream termination, temporary suspension and permanent hosting restriction; provide a channel for reconsideration of lasting actions.

## Operational verification
Test anonymous stream reporting, moderator authorization, rapid termination, denial of restart, alert escalation during off-hours, legal hold, audit logging, and recovery from reporting-system failure. Do not describe an alert as 'real-time human review' unless coverage is demonstrated.

Hosts should take reasonable action against prohibited comments **they become aware of**; avoid claiming they can continuously monitor every message.
