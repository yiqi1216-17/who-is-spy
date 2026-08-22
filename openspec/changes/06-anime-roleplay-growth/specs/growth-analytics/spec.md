# 06.2.3 · Growth Analytics Specification

## Purpose

Define a production-safe, de-identified play-count and funnel module surfaced in the existing data & error console, so the growth goal (how many people played, where they drop off, what they share) is measurable — without exposing the dev-only trace or fault-injection surface in production and without recording any personal or hidden-game data.

## ADDED Requirements

### Requirement: Analytics records only de-identified aggregate events
The system SHALL record growth events as de-identified counters (for example: session started, mode chosen, IP chosen, round reached, game completed, share intent) and MUST NOT persist personal identifiers, IP addresses, raw user text, secret words, roles, or any per-user profile.

#### Scenario: A player completes a game
- **WHEN** growth events are recorded across a session
- **THEN** the stored data contains only counts bucketed by coarse dimensions (day, mode, IP, round reached) with no field that identifies a person or reveals hidden-game state

#### Scenario: Secret-sentinel scan of the analytics store
- **WHEN** the analytics store is serialized
- **THEN** the secret-sentinel scan returns empty (no secret words or credentials)

### Requirement: The analytics summary is production-safe
The analytics summary endpoint SHALL be available in production (unlike the dev-only trace and fault-injection routes), SHALL return only aggregate counts, and MUST NOT return individual records.

#### Scenario: Requesting the summary in production
- **WHEN** the production server receives a request for the analytics summary
- **THEN** it responds with aggregate counts only, while the dev-only trace and fault routes remain absent (404) in production

### Requirement: The console shows a player-count panel beside the existing data/error views
The existing data & error console SHALL gain a growth panel that displays player-count and funnel aggregates, added alongside the current trace/eval/fault views without changing their existing behavior.

#### Scenario: Operator opens the console
- **WHEN** the console loads the growth panel
- **THEN** it shows player-count and funnel aggregates (for example sessions, completions, IP distribution) sourced from the production-safe summary

### Requirement: Analytics ingestion is guarded and bounded
Growth-event ingestion SHALL be subject to the existing public rate/abuse guards when public mode is enabled, and the store SHALL be bounded so long-running or hostile traffic cannot grow it without limit.

#### Scenario: Burst of ingestion attempts under public mode
- **WHEN** public mode is enabled and ingestion requests exceed the configured limits
- **THEN** excess requests are rejected by the existing guard and the analytics store stays bounded

### Requirement: Analytics never blocks or alters gameplay
Growth-event recording SHALL be best-effort and side-effect-only: a failure to record an analytics event MUST NOT change, delay past acceptable limits, or fail any game command or its authoritative result.

#### Scenario: Analytics recording fails
- **WHEN** an analytics write fails or is unavailable
- **THEN** the game command still succeeds and returns its authoritative result unchanged
