# 05.2.1 · Portrait Game Experience Specification

## Purpose

Define a complete portrait-first social-deduction experience in which role secrecy, sequential speech, voting tension, elimination, finale, accessibility, and developer scene control all consume authoritative typed game events.

## ADDED Requirements

### Requirement: The primary experience is portrait-first and responsive
The game SHALL present a coherent 9:16 layout at common mobile widths and SHALL remain usable on desktop through a centered portrait stage without horizontal scrolling.

#### Scenario: User plays at 390 by 844 pixels
- **WHEN** the game renders on the target portrait viewport
- **THEN** round status, active character, public testimony, and the current action remain visible and operable

### Requirement: First-person play preserves secrecy through the whole flow
The product SHALL support home, role reveal, round introduction, sequential descriptions, human input, voting, ballot reveal, elimination, finale, highlights, and replay while exposing only information allowed in the current phase.

#### Scenario: Human reveals their word
- **WHEN** the player intentionally holds the private reveal control
- **THEN** only that player's role and word appear and the view hides them again when the reveal interaction ends

### Requirement: Characters are visually and behaviorally distinguishable
Each AI player SHALL have a stable identity across portrait, color, motion, speaking, suspicion, elimination, and finale states, and the presentation SHALL reflect its measured strategy without relying on repeated catchphrases.

#### Scenario: Two agents speak in sequence
- **WHEN** the active speaker changes
- **THEN** the stage, motion, testimony card, and accessible label identify the correct character without exposing hidden strategy state

### Requirement: Elimination is event-driven and spoiler-safe
Elimination effects SHALL be triggered by authoritative elimination events, SHALL leave the eliminated seat visibly inactive, and MUST NOT reveal the eliminated role or word before the terminal phase.

#### Scenario: Civilian is incorrectly eliminated
- **WHEN** the server emits a non-terminal elimination event
- **THEN** the portrait stage performs the configured non-graphic exit effect and continues without revealing that player's role

### Requirement: Presentation is controlled by an explicit state machine
The client SHALL accept only valid presentation transitions and SHALL treat networking state independently from cinematic animation completion.

#### Scenario: Duplicate elimination event arrives
- **WHEN** the client has already completed the elimination transition for the same event identifier
- **THEN** it does not replay the effect or advance the game twice

### Requirement: Development CLI reuses production event schemas
A development-only CLI SHALL drive role reveal, speech, vote reveal, elimination, finale, and fixture-game scenes using the same event envelope consumed by the real client.

#### Scenario: Developer previews an elimination
- **WHEN** the elimination scene command supplies a valid fixture event in development
- **THEN** the client renders the scene without changing a production game or introducing a second animation protocol

### Requirement: Motion and essential information are accessible
The interface SHALL honor reduced-motion preferences, expose meaningful labels and focus states, and communicate game outcomes through text in addition to color or animation.

#### Scenario: Reduced motion is enabled
- **WHEN** the operating system requests reduced motion
- **THEN** elimination and vote transitions use shortened non-flashing alternatives while preserving the same information
