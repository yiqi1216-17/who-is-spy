# 05.3 · Portrait Product Experience Design

## Context

See `proposal.md` for motivation. Change 03 provides authoritative state, public events, Agent identities, and privacy projections. Change 04 provides redacted replay, failure states, and evidence reports. The existing React client remains the delivery surface, and the existing HTTP commands remain authoritative for user actions.

## Goals / Non-Goals

**Goals:**

- Complete one polished first-person path rather than a collection of disconnected mockups.
- Make four Agents immediately distinguishable without revealing private strategies or relying on repetitive text.
- Make every animation and highlight traceable to an authoritative event.
- Support live public AI theater and terminal omniscient replay with explicit permissions.

**Non-Goals:**

- Voice chat, payments, public multiplayer infrastructure, an asset marketplace, or a season/live-ops system.
- Client-side game rules, animation-driven domain transitions, or hidden-information streaming for convenience.
- Generating highlight quotes or outcomes absent from recorded evidence.

## Decisions

### 1. The product leads with first-person portrait play

The default is one human with four AI Agents on a 9:16 stage. Desktop centers the same stage instead of creating a second interaction model. Core status, active speaker, testimony, and current action remain reachable at common mobile widths and safe areas.

Alternative: lead with an omniscient dashboard. Rejected because it removes the uncertainty and agency that make the game worth playing.

### 2. Domain and presentation state are separate

The client presentation machine owns role-reveal concealment, speaker focus, input, ballot theater, elimination, finale, highlights, and replay transitions. Network state runs in parallel. Animation completion may advance presentation only; it cannot cause a vote, elimination, phase transition, or winner decision.

### 3. SSE carries ordered public presentation events

Existing HTTP endpoints remain commands and recovery state reads. A read-only SSE stream publishes versioned public envelopes with monotonic IDs. Reconnect resumes when possible and always reconciles against authoritative `GET` state. Idempotency prevents duplicate animation.

Alternative: WebSockets. Rejected for the first delivery because server-to-client ordered events are sufficient and bidirectional commands already use HTTP.

### 4. Agent identity combines original art and measured behavior

Each Agent has stable portrait, palette, silhouette, motion rhythm, accessible name, speaking state, suspicion state, elimination treatment, and finale reaction. Copy describes measured tendencies cautiously; it does not expose private belief or pretend stereotypes are facts. Assets are generated/original or have documented compatible rights.

### 5. Elimination effects are non-graphic event consumers

Authoritative elimination events enqueue a brief character-specific exit, mark the seat inactive, and preserve role secrecy unless the terminal reveal allows it. Reduced motion uses a shortened opacity/position alternative with equivalent text.

### 6. The CLI reuses production schemas

A development-only scene driver emits the same validated envelopes for role reveal, speech, voting, tie, elimination, reconnect, provider failure, finale, and replay. Build/runtime guards reject commands in production. It is a deterministic demonstration and visual-regression tool, never a second game protocol.

### 7. View modes use server-provided projections

Human first-person receives the human’s own secret plus public information. Live AI theater receives public information only. Omniscient replay receives terminal roles, words, structured belief summaries, and evidence links only after terminal revelation. Free-text chain-of-thought remains unavailable in every mode.

### 8. Highlights are detected before they are narrated

Deterministic detectors propose candidates from event spans and measured changes. Ranking selects a small diverse reel. A terminal model may title or summarize only while citing source event IDs; faithfulness checks block invented quotes/actions. Shared cards default to hiding solution and role spoilers.

### 9. Accessibility is part of scene acceptance

Every critical state has text, meaningful labels, visible focus, keyboard operation, non-color cues, safe contrast, and a reduced-motion path. Visual evidence includes 390×844 plus narrower and desktop-centered checks.

## Risks / Trade-offs

- **[Visual scope crowds out behavioral evidence]** → complete the first-person critical path and CLI scene matrix before optional polish.
- **[SSE reconnect duplicates theater]** → monotonic IDs, deduplication, state reconciliation, and transition idempotency.
- **[Character identity becomes stereotype]** → ground copy in measured distributions and avoid deterministic catchphrases.
- **[Animation leaks role or advances rules]** → public event projections and strict separation between presentation completion and domain commands.
- **[Generated assets have inconsistent identity]** → approve a character bible and rights manifest before producing final variants.
- **[Highlights overstate what happened]** → evidence IDs, deterministic candidate detection, and quote/outcome faithfulness tests.

## Migration Plan

1. Define portrait tokens, event schemas, projection permissions, and presentation transition fixtures.
2. Build the static five-seat shell and complete state-by-state fixtures before live integration.
3. Add SSE consumption, reconnect reconciliation, idempotency, and existing HTTP command wiring.
4. Complete role reveal through rematch with accessible motion and error states.
5. Add development CLI scenes, visual regression evidence, and production-disable tests.
6. Add AI theater, terminal omniscient replay, highlight detection/cards, and consented product feedback.
7. Make the portrait path default only after mobile E2E, privacy, reconnect, first-person playtest, and real-event smoke checks pass.

Rollback retains the existing HTTP-driven client route until the portrait path passes the complete gate.

## Open Questions

- Which final illustration direction best differentiates the four Agents while staying feasible and rights-safe?
- Which optional sound cues add tension without blocking the no-audio and reduced-motion paths?
- What share-card export format is worth implementing after the in-product reel is validated?
