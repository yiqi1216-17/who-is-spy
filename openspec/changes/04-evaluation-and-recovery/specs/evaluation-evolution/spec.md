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
