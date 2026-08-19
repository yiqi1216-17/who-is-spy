# 05.4 · Portrait Product Experience Tasks

> This change consumes changes 03 and 04. Every task ends with a deterministic scene fixture, interaction/E2E assertion, accessibility check, privacy proof, or approved visual artifact.

## 1. Define the presentation contract

- [ ] 1.1 Write projection tests for first-person, live AI theater, and terminal omniscient replay before adding any new client payload.
- [ ] 1.2 Write presentation transition and idempotency fixtures for home, role reveal, round intro, speaking, human action, voting, tie, elimination, finale, highlights, replay, failure, and reconnect.
- [ ] 1.3 Define 9:16 tokens, safe areas, typography, contrast, focus, motion, reduced-motion, and responsive acceptance targets.

## 2. Build the portrait stage and characters

- [ ] 2.1 Build the centered responsive five-seat stage and prove 390×844, narrow mobile, and desktop layouts have no horizontal overflow or unreachable action.
- [ ] 2.2 Create a rights-documented character bible mapping each evidence-derived Agent to stable portrait, palette, silhouette, motion rhythm, accessible name, and state variants.
- [ ] 2.3 Implement active, speaking, suspicious, waiting, eliminated, and finale character states without exposing hidden strategy or role information.

## 3. Complete first-person gameplay

- [ ] 3.1 Implement intentional private role/word reveal and concealment with focus, keyboard, screen-reader, and accidental-exposure tests.
- [ ] 3.2 Complete round intro, sequential testimony, human description, vote selection, ballot reveal, tie/revote, elimination, finale, and rematch against fixture events.
- [ ] 3.3 Add non-graphic Agent-specific elimination effects driven only by authoritative event IDs; prove duplicate events and animation completion cannot advance domain state.
- [ ] 3.4 Add loading, retry, provider failure, reconnect, stale-event, and state-reconciliation experiences without displaying private trace payloads.

## 4. Connect authoritative events and CLI scenes

- [x] 4.1 Add versioned SSE consumption with monotonic IDs, deduplication, resume, and authoritative state-refresh fallback while retaining existing HTTP commands.
- [ ] 4.2 Build the development CLI scene driver for role reveal, speech, vote, tie, elimination, failure, reconnect, finale, highlight, and replay using production schemas.
- [ ] 4.3 Prove production builds reject or omit CLI/fault controls and that fixture scenes cannot mutate a production game.
- [ ] 4.4 Capture the critical portrait scene matrix as screenshots or video and run mobile viewport E2E checks for safe areas, input reachability, motion, and reconnect continuity.

## 5. Add view modes and replay value

- [x] 5.1 Implement live AI theater with public events only and paired tests proving roles, words, beliefs, private prompts, and unpublished votes cannot affect its pre-finale projection.
- [x] 5.2 Unlock terminal roles, words, structured belief evolution, and evidence links only after authoritative terminal reveal; never expose free-text chain-of-thought.
- [x] 5.3 Add fixture-backed detectors for consensus flips, self-saves, undercover blending, lone correct reads, decisive votes, callbacks, and novel safe metaphors.
- [x] 5.4 Rank a bounded diverse moment reel and add spoiler-safe cards; generated titles must cite event IDs and pass quote/action/outcome faithfulness checks.
- [ ] 5.5 Add consented, de-identified completion, rematch, favorite Agent, favorite moment, share, replay-intent, and playtest-preference feedback with a complete opt-out path.

## 6. Verify product completeness

- [ ] 6.1 Run the entire first-person critical path, a live AI-theater game, and terminal omniscient replay at target portrait viewports with reduced-motion and keyboard variants.
- [ ] 6.2 Run build, web tests, E2E, Node contract, privacy projections, strict OpenSpec validation, and a real-event smoke game; preserve redacted visual evidence.
- [ ] 6.3 Conduct a short blinded product playtest comparing B0 UI and the portrait path for clarity, fun, replay intent, and share intent; report sample limits honestly.
- [ ] 6.4 Request independent product, accessibility, and privacy review; address findings with fixtures and record residual risks before archive.
