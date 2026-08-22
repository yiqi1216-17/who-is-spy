# 06.2.2 · Chat Transcript Experience Specification

## Purpose

Define a chat-application presentation for anime mode in which every utterance becomes a persisted history message that appends to a scrolling transcript and moves upward, so a whole round reads back like a group chat — while the transcript remains a projection of authoritative public events and transient previews, never a second source of truth.

## ADDED Requirements

### Requirement: The anime surface is a scrolling chat transcript
Anime mode SHALL present play as a vertically scrolling chat transcript where each seat's utterance is a distinct message bubble attributed to its character, and new messages SHALL append at the bottom and push earlier messages upward.

#### Scenario: A round of descriptions plays out
- **WHEN** seats describe in turn
- **THEN** each description appears as its own attributed message appended below the previous one, and the earlier messages scroll upward and remain readable by scrolling back

#### Scenario: Votes render as messages too
- **WHEN** seats cast votes
- **THEN** each vote appears as an attributed message in the same transcript, distinguishable from a description

### Requirement: Every utterance is persisted to the transcript history
The transcript SHALL retain all prior messages of the current game so the player can scroll back through the full history of the round and game, and messages MUST NOT silently disappear once shown as authoritative.

#### Scenario: Player scrolls back mid-game
- **WHEN** the player scrolls up during a later round
- **THEN** earlier rounds' descriptions, votes, and outcomes are still present in order

### Requirement: The transcript is derived from authoritative state, not a separate truth
Transcript messages SHALL be a projection of the authoritative public event log (descriptions, vote results, eliminations, system notices) plus transient live previews; the transcript MUST NOT originate any game fact and SHALL reconcile against authoritative `GET` state.

#### Scenario: Authoritative state and transcript agree
- **WHEN** the transcript has finished rendering a committed round
- **THEN** its persisted messages correspond one-to-one with the authoritative public events for that round

#### Scenario: A command fails and rolls back
- **WHEN** a command fails after live previews were shown
- **THEN** any preview-only messages that never became authoritative events are reconciled out on refresh, and the transcript reflects only authoritative state

### Requirement: Live utterances stream into the transcript with async feel
While a command is in flight, each in-character utterance that has passed the quality gate SHALL stream into the transcript as a transient "typing/just-sent" message via the existing preview channel, and SHALL be replaced by, or promoted to, the authoritative message when the command commits.

#### Scenario: AI seats speak one by one during generation
- **WHEN** the server emits per-utterance previews during generation
- **THEN** the transcript shows each character's message appearing in turn rather than all at once after a long wait

#### Scenario: Preview promotes to authoritative without duplication
- **WHEN** a previewed utterance later lands as an authoritative event
- **THEN** the transcript shows a single message for it, not a duplicate

### Requirement: The transcript preserves pre-terminal secrecy
Transcript messages SHALL contain only public information; they MUST NOT display any seat's role, secret word, structured belief, private prompt, or unpublished vote before the terminal phase.

#### Scenario: Inspecting any pre-terminal message
- **WHEN** the player reads or scrolls the transcript before the terminal phase
- **THEN** no message exposes another seat's hidden role, word, belief, private prompt, or unpublished vote

### Requirement: The human acts from within the chat surface
The player SHALL enter their own description and cast their vote from controls integrated into the chat surface, and their own submitted utterance SHALL appear as their character's message in the same transcript.

#### Scenario: Human sends a description
- **WHEN** the player submits an in-character description
- **THEN** it appears as the human character's message in the transcript under the same secret-word and length rules as the base game

### Requirement: The transcript is accessible and reconnect-safe
The transcript SHALL honor reduced-motion preferences for message-entry animation, expose accessible attribution and roles for messages, and after a reconnect SHALL restore the ordered history by reconciling against authoritative state.

#### Scenario: Reconnect during a game
- **WHEN** the stream drops and reconnects
- **THEN** the transcript restores the correct ordered messages without duplicating or dropping authoritative utterances
