# 03.4 · Human Data and Agent Orchestration Tasks

> Each task begins with a failing test or recorded baseline and ends with evidence plus a meaningful commit boundary. Do not claim human learning until approved human records and provenance evidence exist.

## 1. Freeze the brownfield baseline

- [x] 1.1 Run and record Node domain, HTTP, build, and `contract:node` results as B0; preserve one deterministic fixture transcript without changing behavior.
- [x] 1.2 Add numbered `DECISIONS.md` entries and a verification-evidence index for Agent suggestions, human corrections, commands, reports, privacy checks, and known risks.
- [x] 1.3 Capture B0 context shapes, strategy inputs, description ordering, policy behavior, and failure atomicity as characterization tests.

## 2. Establish schemas and domain state boundaries

- [x] 2.1 Write producer/consumer compatibility tests, then add versioned schemas for public state, events, Agent context, beliefs, strategies, model outputs, dataset records, hooks, traces, and reports.
- [x] 2.2 Write legal/illegal transition-table tests, then route Node phases and actions through an explicit domain state machine without changing the public HTTP contract.
- [ ] 2.3 Add migration fixtures proving incompatible persisted datasets, traces, replay envelopes, and reports fail with actionable version errors.

## 3. Build the human-game data foundation

- [ ] 3.1 Write manifest and consent validation tests, then implement source rights, consent scope, anonymized players, action history, annotations, lineage, withdrawal, and export eligibility schemas.
- [ ] 3.2 Add deterministic import and quarantine tests for first-party records plus explicitly licensed transfer corpora; reject unknown-rights, malformed, or mislabeled synthetic records.
- [ ] 3.3 Add split-leakage tests, then produce grouped train, validation, frozen-core, rolling-challenge, and preference-holdout manifests isolated by game, cohort, word pair, and time.
- [ ] 3.4 Publish the collection runbook, consent copy, annotation guide, seed corpus report, data statement, and honest sample-count evidence.

## 4. Derive evidence-backed strategies

- [ ] 4.1 Record B0 behavior distributions, then extract reproducible speech tactics, social acts, specificity, novelty, and outcomes from eligible training records.
- [ ] 4.2 Add strategy-provenance tests, then generate versioned interpretable prototypes with representative sample IDs and measured distributions.
- [ ] 4.3 Add retrieval eligibility and frozen-split denial tests, then retrieve masked demonstrations by role, phase, public situation, and strategy.
- [ ] 4.4 Add calibration and ablation fixtures, then rank schema-valid candidates using weights fitted only on training/validation data.

## 5. Add beliefs, hooks, policy, and orchestration

- [ ] 5.1 Write belief normalization, calibration, evidence-reference, and cross-Agent non-interference tests, then add private structured belief state without free-text chain-of-thought.
- [ ] 5.2 Write hook projection, timeout, authority, failure-policy, and secret-sentinel tests, then add the typed hook registry.
- [x] 5.3 Write sequential-context tests proving every later speaker sees only earlier public same-round descriptions, then replace parallel generation with deterministic seat order.
- [ ] 5.4 Write hidden-vote tests proving later voters cannot observe unresolved votes while deterministic code retains target and ballot authority.
- [ ] 5.5 Write exact leak, obfuscation, similarity, self-repetition, correction, and exhaustion tests, then add the shared description quality policy.
- [ ] 5.6 Write concurrent-command and rollback tests, then add the per-game guard and atomic working-state commit.

## 6. Prove the change and expose downstream contracts

- [ ] 6.1 Run paired B0/B1/B2/B3 fixture ablations for sequential orchestration, human retrieval/prototypes, and beliefs/ranking using the same scenarios and seeds.
- [ ] 6.2 Prove pre-finale role/word, cross-Agent belief, complete-state, private-prompt, and unresolved-vote sentinels never cross model, hook, public DTO, or persisted artifact boundaries.
- [ ] 6.3 Run Node tests, build, `contract:node`, strict OpenSpec validation, and a budget-capped DeepSeek smoke game; preserve redacted evidence and exact versions.
- [ ] 6.4 Document the shared event/report interfaces and residual risks required by changes 04 and 05, then request independent architecture and privacy review.
