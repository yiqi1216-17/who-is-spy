# 03.2.1 · Human Game Data Specification

## Purpose

Define a trustworthy, privacy-aware human gameplay corpus whose provenance, consent, schemas, splits, and retrieval behavior support learning and evaluation without treating synthetic model output as human evidence.

## ADDED Requirements

### Requirement: Every dataset record has verifiable provenance
The system SHALL associate every ingested game with a versioned manifest containing its source, license or consent scope, acquisition method, schema version, and permitted uses.

#### Scenario: Record with approved provenance is ingested
- **WHEN** a first-party game has valid consent or an external dataset has an explicitly approved license
- **THEN** the importer accepts the record and preserves its provenance in the normalized dataset

#### Scenario: Record with unknown rights is rejected
- **WHEN** a source lacks a confirmed license or participant consent compatible with the requested use
- **THEN** the importer rejects it from training and published benchmark outputs with a diagnostic reason

### Requirement: Human and synthetic data remain distinguishable
The system MUST label each record as first-party human, licensed human transfer, mixed human-model, or synthetic, and SHALL NOT report synthetic or mixed records as direct human “Who Is the Spy” evidence.

#### Scenario: Baseline report counts human evidence
- **WHEN** an evaluation report summarizes its data sources
- **THEN** it reports direct human, transfer human, mixed, and synthetic counts separately

### Requirement: Personal data is minimized and removable
The system SHALL anonymize player identifiers, exclude unnecessary personal or device information, honor consent scope, and support deletion of all records linked to a withdrawn consent identifier.

#### Scenario: Participant withdraws consent
- **WHEN** an authorized operator supplies a valid consent identifier for withdrawal
- **THEN** all derived first-party records linked to that identifier are located and excluded from subsequent builds

### Requirement: Dataset records are schema-validated and versioned
The system MUST validate raw, cleaned, annotated, and exported records against explicit schemas and preserve lineage between stages.

#### Scenario: Incompatible record enters the pipeline
- **WHEN** a record is missing a required field or uses an unsupported schema version
- **THEN** ingestion fails before the record reaches retrieval or evaluation

### Requirement: Train and evaluation splits prevent leakage
The system SHALL isolate games, participant groups, word pairs, and later collection periods so that frozen and preference holdouts cannot be retrieved as training examples.

#### Scenario: Retrieval attempts to use a holdout example
- **WHEN** an example belongs to a frozen, rolling-challenge, or human-preference holdout split
- **THEN** the retrieval layer excludes it from all agent demonstrations and strategy fitting

### Requirement: Retrieved demonstrations preserve current-game secrecy
The system MUST provide only allowed public actions and strategy metadata from training examples, and SHALL mask or replace example secrets before including them in an agent decision request.

#### Scenario: Agent retrieves a similar human turn
- **WHEN** a decision retrieves examples matched by role, round, public situation, or strategy
- **THEN** the resulting AgentContext contains no other current-game secret and no raw secret from the retrieved game
