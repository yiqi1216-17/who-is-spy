# 03.2.2 · Agent Learning and Orchestration Specification

## Purpose

Define agents as independent, human-data-grounded decision-makers with isolated beliefs, sequential access to newly public speech, typed lifecycle hooks, and safe state transitions controlled by deterministic game rules.

## ADDED Requirements

### Requirement: Strategies are traceable to human evidence
Each agent strategy SHALL identify the dataset version, human behavior prototype, representative training sample identifiers, and measured behavior distribution from which it was derived.

#### Scenario: Strategy version is inspected
- **WHEN** an evaluator or developer inspects a configured agent
- **THEN** the system exposes its strategy identifier and provenance metadata without exposing participant identity or restricted sample content

### Requirement: Agents maintain isolated structured beliefs
Each AI player SHALL maintain a private, schema-validated belief state derived only from its own secret and public events, and MUST NOT read another agent's belief state or free-text hidden reasoning.

#### Scenario: Other agents' secrets change
- **WHEN** two otherwise identical games differ only in other players' hidden roles or words
- **THEN** the current agent receives an identical context and identical pre-model decision inputs

#### Scenario: Public DTO is requested before the finale
- **WHEN** a client reads a non-finished game
- **THEN** no agent belief, hidden reasoning, other-player role, or other-player word appears in the response

### Requirement: Same-round descriptions become public sequentially
Alive AI players SHALL describe in a deterministic order, and each later speaker SHALL receive every accepted same-round description produced before its turn.

#### Scenario: Fourth AI prepares a description
- **WHEN** the human and three earlier alive AI players have produced accepted descriptions in the current round
- **THEN** the fourth AI context contains those four public descriptions in speaking order

### Requirement: Votes remain private until ballot resolution
An agent SHALL receive public descriptions and eligible targets but MUST NOT receive another player's vote from the current unresolved ballot.

#### Scenario: Later vote is generated
- **WHEN** one or more votes have already been staged for the unresolved ballot
- **THEN** the next voter context contains none of those staged votes

### Requirement: Model outputs pass schema and quality gates before publication
Every description and vote MUST pass runtime schema validation, rule validation, and applicable description-quality policies before it is committed or emitted as a public event.

#### Scenario: Model emits a leaking or highly repetitive description
- **WHEN** the candidate contains a secret, an obvious obfuscation, or exceeds the configured similarity threshold
- **THEN** the system rejects the candidate, records a redacted violation, and applies the bounded correction policy without publishing it

#### Scenario: Correction attempts are exhausted
- **WHEN** an agent fails all permitted attempts for a turn
- **THEN** the enclosing action fails explicitly and the authoritative game remains identical to its pre-action state

### Requirement: Lifecycle hooks are typed and privacy-scoped
Every agent lifecycle hook SHALL declare its input schema, privacy level, mutation authority, timeout, and failure policy, and MUST NOT bypass deterministic game rules.

#### Scenario: Public-only hook subscribes to a private phase
- **WHEN** a public-only hook is invoked around a context containing current-agent-private fields
- **THEN** the hook receives only its declared public projection

### Requirement: Deterministic code remains authoritative
The model MAY propose descriptions, beliefs, and votes, but deterministic engine code SHALL decide legal targets, ballot outcomes, eliminations, winners, phase transitions, and terminal revelation.

#### Scenario: Model proposes an illegal target
- **WHEN** a vote output references a dead, self, absent, or ineligible player
- **THEN** the engine rejects it and does not alter the ballot or game result
