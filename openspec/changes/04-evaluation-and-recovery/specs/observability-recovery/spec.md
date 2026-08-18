# 04.2.2 · Observability and Recovery Specification

## Purpose

Define privacy-safe traces, fault injection, retries, concurrency control, atomic recovery, and replay so every model failure can be located and reproduced without persisting API keys, complete secrets, or private prompts.

## ADDED Requirements

### Requirement: Decision traces identify the failing operation
Every model decision SHALL emit structured lifecycle metadata including trace, request, game, round, ballot, phase, action, agent, strategy, decision, attempt, outcome, latency, usage, and error classification when available.

#### Scenario: Agent times out on a retry
- **WHEN** a specific agent's second description attempt times out
- **THEN** the trace identifies that game, round, phase, agent, attempt, timeout class, latency, retryability, and commit status

### Requirement: Persistent observability artifacts are secret-safe
Persistent logs, traces, reports, and replay files MUST NOT contain API keys, authorization headers, complete secret words, complete private prompts, free-text private reasoning, or unpublished votes.

#### Scenario: Sentinel secrets are exercised through success and failure paths
- **WHEN** test-only unique key and word sentinels pass through model, policy, retry, and replay paths
- **THEN** a repository-wide artifact scan finds none of the sentinel values

### Requirement: Retry policy is bounded and classified
The system SHALL distinguish retryable transport failures from non-retryable configuration/auth failures and decision-policy corrections, and SHALL expose a single coherent attempt sequence.

#### Scenario: Provider returns a rate limit
- **WHEN** the upstream returns 429 with retry guidance
- **THEN** the system applies the bounded retry policy, records the classified attempt, and stops after the configured budget

### Requirement: Recovery preserves serialized atomic actions
Recovery, retry, replay, and diagnostic operations SHALL preserve the serialized atomic-action contract established by Agent orchestration and MUST NOT publish or reconstruct a failed staged action as authoritative.

#### Scenario: One AI fails after earlier staged descriptions
- **WHEN** an agent exhausts retries after earlier agents produced valid temporary descriptions
- **THEN** none of the human or AI descriptions from that command are committed to the authoritative game

### Requirement: Faults are reproducibly injectable outside production
Test and development modes SHALL support targeted timeout, malformed JSON, rate-limit, upstream failure, illegal vote, unsafe description, and review-failure scenarios, while production SHALL reject fault controls.

#### Scenario: Production request tries to enable a fault
- **WHEN** a production process receives a fault-injection flag or demo command
- **THEN** the control is ignored or rejected and no authoritative state is altered

### Requirement: Replay reconstructs public decisions without private payloads
The replay tool SHALL reconstruct the ordered public game timeline, accepted decisions, policy outcomes, ballot results, eliminations, terminal reveal status, and highlight anchors from redacted events.

#### Scenario: Real-model game is replayed
- **WHEN** an operator opens a completed real-model replay
- **THEN** the tool reproduces what publicly happened without claiming that a new model call would generate identical text
