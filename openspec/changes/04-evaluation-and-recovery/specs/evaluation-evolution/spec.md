# 04.2.1 · Evaluation and Evolution Specification

## Purpose

Define reproducible evidence that compares agent versions against human-grounded baselines, protects frozen tests from contamination, and promotes only challengers that improve quality without regressing safety, cost, or reliability.

## ADDED Requirements

### Requirement: The benchmark preserves explicit baselines
The evaluation system SHALL preserve runnable baseline identifiers beginning with the original B0 behavior and SHALL compare challengers on matched seeds, word pairs, roles, seats, public histories, and human inputs.

#### Scenario: Challenger is evaluated against B0
- **WHEN** a paired benchmark run is requested
- **THEN** the report includes per-scenario B0 and challenger results plus their deltas

### Requirement: Benchmark suites have contamination boundaries
The system SHALL maintain distinct contract, frozen-core, transfer, adversarial, unseen-word, rolling-challenge, human-preference, and product-playtest suites with versioned manifests.

#### Scenario: Frozen case is requested for training
- **WHEN** retrieval, fitting, prompt selection, or threshold tuning requests a frozen case
- **THEN** access is denied and the attempted contamination is reported

### Requirement: Reports cover safety, behavior, human alignment, product value, and engineering cost
Every candidate report MUST include secret leakage, description homogeneity, vote validity, completion, belief calibration, strategy distinguishability, latency, tokens, estimated cost, retry/failure, and data-source counts; human preference and product metrics SHALL be included when those studies are run.

#### Scenario: Provider omits price data
- **WHEN** token usage is available but a trustworthy price is not configured
- **THEN** the report presents token counts and marks monetary cost unavailable rather than reporting zero

### Requirement: Deterministic gates fail the process
The fixture-based evaluation command SHALL exit non-zero when a hard contract, privacy, validity, completion, or configured quality threshold is violated.

#### Scenario: Accepted secret leak occurs
- **WHEN** any accepted fixture description triggers the secret-leak evaluator
- **THEN** the quality-gate command fails with the scenario and metric identifier

### Requirement: Champion promotion is evidence-based
A challenger SHALL become champion only after all hard gates pass, frozen-core regressions remain within budget, at least one declared target metric improves, and latency/cost budgets are respected.

#### Scenario: Challenger improves novelty but leaks information
- **WHEN** a challenger improves a behavior metric while failing a privacy or contract gate
- **THEN** promotion is rejected regardless of aggregate score

### Requirement: New failures enter a controlled evolution loop
New production, playtest, or adversarial failures SHALL enter a quarantined, de-identified queue before annotation and possible inclusion in a future rolling challenge version.

#### Scenario: Interesting failure is discovered during playtest
- **WHEN** the failure is confirmed and its data rights permit retention
- **THEN** it receives lineage, labels, and a challenge-set disposition without modifying the current frozen core

### Requirement: Human preference evidence is blinded
Human comparative evaluations SHALL randomize candidate labels and presentation order and SHALL report sample count, ties, and uncertainty alongside preference rate.

#### Scenario: Evaluator compares two agent versions
- **WHEN** a participant judges which output is more natural or entertaining
- **THEN** the participant cannot see model, strategy, or version identifiers before submitting the choice

### Requirement: Faction win-rate responds to strategy skill

The evaluation system SHALL provide a per-faction win-rate comparison in which successive strategy iterations, run on identical seeds, random streams, and scripted human co-players, change civilian and undercover win-rates as a measurable function of strategy skill alone. Each step SHALL report the civilian and undercover win-rate deltas and whether the observed swing matches the declared intent, and the command SHALL exit non-zero if any step's swing contradicts its intent or any iteration fails to complete. Vote and description decisions in this mode MUST derive only from public descriptions and the agent's own identity, never from another player's hidden role or word. The system SHALL also be able to emit a complete per-game, per-round trace (descriptions with divergence, votes, eliminations, and the terminal winner) so the aggregate win-rate is auditable rather than opaque; that trace MUST NOT contain any secret word — each word appears only as a stable per-word pseudonym — and MUST reveal roles only after the game reaches a terminal state.

#### Scenario: Civilian iteration raises the civilian win-rate
- **WHEN** an iteration improves civilian identification skill while the undercover configuration is held fixed, on the same seed as the prior iteration
- **THEN** the reported civilian win-rate increases relative to the prior iteration and the step is marked as swinging toward civilians

#### Scenario: Undercover counter-iteration raises the undercover win-rate
- **WHEN** a later iteration improves undercover blending and misdirection against the same civilian skill
- **THEN** the reported undercover win-rate increases relative to the prior iteration and the step is marked as swinging toward the undercover

#### Scenario: Win-rate swings are deterministic and complete
- **WHEN** the same iteration ladder is run twice on one seed
- **THEN** the per-iteration win-rates are byte-identical and every iteration reaches a terminal winner rather than aborting

#### Scenario: Skill mode reads only public information
- **WHEN** an agent decides its vote in win-rate mode
- **THEN** the decision is computed solely from published descriptions and the agent's own role and word, and no accepted vote targets a hidden field or an out-of-bounds player

#### Scenario: Per-game trace is auditable yet leaks no secret
- **WHEN** a win-rate iteration is exported as a per-game, per-round trace
- **THEN** each round shows every player's description with its divergence, the ballots cast, the elimination order, and the terminal winner, so a reader can see how the win-rate was played out
- **AND** no secret word appears in the trace — each word is shown only as a stable pseudonym so factions remain distinguishable without disclosure — and roles are attached only after the game is terminal, leaving the secret-scan output empty
