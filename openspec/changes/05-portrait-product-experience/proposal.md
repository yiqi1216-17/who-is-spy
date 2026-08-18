# 05.1 · Portrait Product Experience Proposal

## Why

A technically correct Multi-Agent game will not stand out if it still feels like a debug form. The social value comes from suspense, character, language collisions, reversals, and the ability to replay or share what happened without compromising hidden information.

## What Changes

- Rebuild the primary experience as a responsive 9:16 five-seat social-deduction stage that remains usable on desktop.
- Give each AI a stable visual, motion, speech, suspicion, elimination, and finale identity derived from its measured strategy rather than a catchphrase-only persona.
- Drive role reveal, sequential speech, human actions, ballot reveal, ties, elimination, finale, highlights, and replay through an explicit presentation state machine.
- Consume authoritative versioned public events and keep networking/reconnect independent from cinematic animation completion.
- Add event-driven, non-graphic elimination effects plus keyboard, focus, text, color, and reduced-motion accessibility.
- Provide a development-only command-line scene driver using the same production event schemas.
- Make human first-person play the default, add live public-information-only AI theater, and unlock omniscient roles and structured beliefs only after terminal reveal.
- Detect reversals, self-saves, blended undercover turns, lone correct reads, decisive votes, callbacks, and novel safe metaphors from recorded evidence.
- Produce bounded, spoiler-aware highlight cards and collect consented product feedback for replay and share value.

## Capabilities

### New Capabilities

- `portrait-game-experience`: Responsive portrait layout, complete gameplay flow, character staging, typed presentation states, authoritative events, CLI scenes, elimination effects, reconnect, and accessibility.
- `highlights-view-modes`: First-person, AI-theater, and post-game omniscient permissions plus evidence-grounded, spoiler-aware highlights and product feedback.

### Modified Capabilities

None. This change consumes but does not modify the Agent, evaluation, and replay capabilities proposed by changes 03 and 04.

## Impact

- **Web:** portrait design tokens, five-seat stage, presentation state machine, animation queue, view projections, highlights, replay, accessibility, and responsive E2E coverage.
- **Server integration:** read-only versioned SSE stream and existing HTTP state refresh/commands; no transfer of rule authority to the client.
- **Tooling:** development-only CLI scene commands and deterministic visual fixtures disabled in production.
- **Assets:** original or clearly licensed character and motion assets; no copied third-party game art.
- **Privacy:** live views remain spoiler-safe; complete roles, words, and belief summaries unlock only after authoritative terminal reveal.
- **Evidence:** screenshots/video, target-viewport checks, first-person playtest, AI-theater secrecy tests, and highlight faithfulness tests.
