# 05.2.2 · Highlights and View Modes Specification

## Purpose

Define first-person, public AI-theater, and post-game omniscient permissions together with evidence-grounded highlights that turn public language and belief shifts into replayable, spoiler-aware product moments.

## ADDED Requirements

### Requirement: View modes enforce distinct information permissions
The product SHALL provide human first-person play, public AI-theater spectating, and post-game omniscient replay, with each mode receiving only its allowed projection of game state.

#### Scenario: Spectator watches a live AI game
- **WHEN** the AI-theater game is not finished
- **THEN** the spectator sees public speech, players, events, and ballot results but no roles, words, beliefs, private prompts, or unpublished votes

#### Scenario: Finished game enters omniscient replay
- **WHEN** the terminal reveal is complete
- **THEN** the replay may show final roles, final words, per-agent belief summaries, and evidence links without exposing free-text chain-of-thought or API credentials

### Requirement: Highlight candidates are grounded in recorded evidence
Every highlight SHALL reference the public event identifiers and measured changes that justify it, and a summarization model MUST NOT create actions, quotes, or outcomes absent from the record.

#### Scenario: Consensus flips after a description
- **WHEN** measured public or redacted post-game belief data crosses the configured consensus-flip threshold
- **THEN** the detector creates a candidate linked to the triggering description and before/after values

### Requirement: Each completed game can produce a concise moment reel
The system SHALL rank eligible candidates and produce a bounded set of replay anchors covering meaningful reversals, self-saves, correct minority reads, decisive votes, callbacks, or unusually novel safe language.

#### Scenario: Game contains fewer valid moments than the display limit
- **WHEN** only two candidates meet evidence and quality thresholds
- **THEN** the finale displays those two rather than fabricating additional moments

### Requirement: Shared moments are spoiler-aware and privacy-safe
Shareable highlight cards SHALL default to hiding complete secret words and terminal identity spoilers and SHALL never include private prompts, unrestricted belief state, or trace internals.

#### Scenario: User shares before enabling spoilers
- **WHEN** the user exports a default highlight card
- **THEN** the card contains public quotes and character art but redacts the solution and hidden role

### Requirement: Product feedback measures replay value
With appropriate consent, the product SHALL record de-identified signals for game completion, rematch, remembered/favored agent, moment sharing, and explicit playtest preference without treating them as hidden gameplay inputs.

#### Scenario: User opts out of analytics
- **WHEN** a user declines optional product telemetry
- **THEN** gameplay remains fully available and no optional retention or preference event is recorded
