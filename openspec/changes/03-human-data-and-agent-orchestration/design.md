# 03.3 · Human Data and Agent Orchestration Design

## Context

See `proposal.md` for motivation and `docs/planning-history/01_IMPLEMENTATION_PLAN.md` plus `docs/planning-history/02_DATA_DRIVEN_PRODUCT_EVOLUTION_PLAN.md` for exploratory history. The brownfield project already has React, equivalent Node and Go servers, a frozen cross-language HTTP contract, server-authoritative rules, allowlisted Agent contexts, and replaceable real/fake model interfaces. This change selects the Node path and preserves the Go baseline.

## Goals / Non-Goals

**Goals:**

- Make every strategy claim traceable to eligible human evidence.
- Make data, Agent state, hooks, model outputs, state transitions, and commits runtime-validatable.
- Prove role/word, belief, context, and unresolved-vote isolation through paired non-interference tests.
- Leave stable interfaces for evaluation, traces, replay, and presentation changes.

**Non-Goals:**

- Foundation-model fine-tuning, production databases, payment, public multiplayer, voice chat, or Go feature parity.
- Persisting hidden free-text reasoning or representing synthetic output as human evidence.
- Implementing benchmark promotion, production observability, portrait UI, or highlight presentation; those belong to changes 04 and 05.

## Decisions

### 1. Node and TypeScript are the selected delivery path

Only `packages/server-node` receives behavior changes. React, dataset utilities, evaluation adapters, CLIs, and runtime schemas remain in one typed ecosystem. The Go implementation stays unchanged as an external contract comparison.

### 2. Shared schemas define every trust boundary

A lightweight shared package or equivalent single source owns versioned schemas for public game state, events, Agent context, beliefs, strategies, model outputs, dataset records, hooks, traces, fixtures, and reports. Producers validate before emission and consumers validate before use. Persisted artifacts carry `schemaVersion` and explicit incompatibility errors.

Alternative: duplicated TypeScript interfaces. Rejected because compile-time similarity cannot validate datasets, provider output, replay files, or CLI fixtures.

### 3. Human evidence is split by provenance and rights

First-party “Who Is the Spy” games are direct evidence. Explicitly licensed Werewolf/Mafia records may inform transferable behavior taxonomies but never masquerade as direct game evidence. Unknown-rights inputs stay quarantined. Consent scope and withdrawal identifiers are machine-readable.

### 4. Learning begins with retrieval and calibrated ranking

Offline preparation derives versioned, interpretable strategy prototypes and distributions. At a decision, split-eligible masked examples are retrieved by role, phase, public situation, and strategy; the model generates a small candidate set; a human-calibrated scorer ranks safe candidates. Prompt wording remains an interface, not the source of the strategy claim.

Alternative: four hand-written personas. Rejected as the primary method because it has no causal evidence or reproducible provenance.

### 5. Beliefs are structured private state

Each Agent owns suspect probabilities, public evidence IDs, belief deltas, used tactics, and risk budget. Updates use only its allowlisted context. Free-text chain-of-thought is neither requested nor persisted. Calibration and paired non-interference become measurable.

### 6. The orchestrator is sequential and transactional

Each command acquires a per-game action guard and works on a clone. Descriptions run in deterministic seat order against a temporary public timeline. Votes may run sequentially or concurrently, but unresolved votes never enter another voter’s context. Schema, policy, and deterministic rules must all pass before the clone atomically replaces authoritative state.

Alternative: append each successful Agent output immediately. Rejected because a later failure would expose a partial round and make retries ambiguous.

### 7. Hooks are typed, projected, bounded, and read-only by default

Hook points surround context construction, retrieval, model calls, schema checks, policy, beliefs, commit, event publication, highlight candidates, and failure. Each hook declares its input projection, mutation authority, timeout, and failure policy. Only explicit ranker/policy hooks may transform a candidate.

### 8. Quality policy is deterministic and shared

A pure policy detects exact and obvious obfuscated secrets, exact/near duplicates, same-round homogeneity, and self-repetition. It returns stable violation codes shared by retry, trace, and evaluation. Rejected text is not persisted; accepted public descriptions become replayable evidence.

## Risks / Trade-offs

- **[Initial direct-human corpus is small]** → publish honest sample counts and use retrieval/ranking before high-capacity training.
- **[Transfer corpora distort the target game]** → label transfer evidence separately and prove direct-data contribution through ablations.
- **[Retrieval contaminates frozen tests]** → enforce split-aware access and add denial tests using frozen record sentinels.
- **[Strategy clusters become stereotypes]** → model distributions rather than fixed catchphrases and monitor template rates.
- **[Sequential calls increase latency]** → measure full-round p95 in change 04; never trade isolation for fake concurrency.
- **[Hooks leak secrets or mutate state]** → allowlisted projections, mutation denial, schema checks, timeouts, and secret sentinels.

## Migration Plan

1. Freeze B0 and keep existing Node and contract tests green.
2. Introduce shared schemas and adapters without changing HTTP behavior.
3. Add data manifests, consent/rights validation, quarantine, splits, and a small approved corpus.
4. Derive strategy prototypes and add split-aware retrieval behind configuration.
5. Add private beliefs, candidates, ranking, typed hooks, and quality policy behind configuration.
6. Replace parallel description generation with the transactional orchestrator.
7. Make the new path default only after non-interference, atomicity, B0–B3, and contract gates pass.

Rollback retains B0 and the original HTTP-driven path until the new path is promoted. Dataset formats are append-only and versioned.

## Open Questions

- How many consented first-party games and independent annotators can be organized for the first evidence release?
- Which explicitly licensed transfer dataset versions are commercially compatible with the intended demo?
- What minimum direct-human sample count is required before marketing copy may say “learned from human play”?
