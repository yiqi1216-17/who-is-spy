# 04.3 · Evaluation and Recovery Design

## Context

See `proposal.md` for motivation. Change 03 establishes versioned data, Agent strategies, beliefs, hooks, transactional commands, and public events. This change measures those variants and wraps their failure surfaces without changing deterministic game rules or Agent information permissions.

## Goals / Non-Goals

**Goals:**

- Reproduce every deterministic result from versioned inputs and explain every metric denominator.
- Prevent benchmark contamination and preserve old champions for rollback.
- Locate model failures by game, phase, Agent, action, and attempt without storing sensitive payloads.
- Demonstrate bounded failure behavior and state preservation through injectable faults.

**Non-Goals:**

- Using fixture latency as real-provider performance, model judges as the only product-quality evidence, or win rate alone as an intelligence score.
- Persisting raw provider requests/responses, private reasoning, complete secrets, or unresolved votes.
- Implementing the portrait UI or highlight presentation; change 05 consumes the redacted public events and replay output.

## Decisions

### 1. Evaluation is paired and version-complete

Every report records scenario manifest, seed, engine, schema, dataset, retrieval, strategy, model/provider, evaluator, threshold, and pricing versions. B0, B1, B2, B3, champions, and challengers run on matched inputs. Fixture outputs are deterministic; live text is sampled evidence, not promised reproducibility.

### 2. Frozen and rolling suites have different jobs

Frozen-core cases are immutable and inaccessible to retrieval, fitting, prompt selection, and threshold tuning. Rolling challenges accept de-identified, rights-approved failures only through a quarantine and review step. Manifest hashes make silent mutation visible.

### 3. Metrics are layered rather than collapsed into one score

Hard gates cover contract, privacy, leakage, legality, completion, and artifact integrity. Behavioral metrics cover differentiation, repetition, novelty, belief calibration, and evidence quality. Operational metrics cover retry, latency, usage, and cost. Blinded humans cover naturalness, fun, replay intent, and share intent. No weighted aggregate may override a failed hard gate.

### 4. Promotion is a reversible policy decision

A challenger becomes champion only after hard gates pass, declared target metrics improve with reported uncertainty, frozen regressions remain within budget, and latency/cost limits hold. The manifest retains the previous champion and rollback configuration.

### 5. Traces contain allowlisted metadata and public evidence

Trace schemas contain correlation identifiers, version IDs, attempt, error class, latency, usage, policy code, hash/length metadata, and commit state. Accepted public actions may retain public text; rejected candidates retain only safe, non-reversible metadata. Diagnostic raw payloads are one-shot local displays and never persistence defaults.

### 6. One error taxonomy owns retry semantics

Transport errors, rate limits, provider failures, malformed/schema-invalid outputs, illegal targets, policy rejections, configuration/authentication errors, and unknowns map to stable codes. Transport retry and decision correction are distinct but share a coherent attempt lineage. Retry count, backoff, jitter, and `Retry-After` behavior are bounded and testable.

### 7. Fault injection uses the same model boundary

A development/test adapter targets Agent, action, and attempt with timeout, 429, upstream error, malformed JSON, invalid target, unsafe text, or review failure. Production configuration rejects fault controls. Each injection asserts trace classification plus before/after authoritative-state equality where failure is terminal.

### 8. Replay is event-based, redacted, and honest

Replay validates schema versions and reconstructs accepted public decisions, ballots, eliminations, finale, and highlight anchors from ordered events. It does not rerun a model or claim rejected private candidates can be reconstructed. Monotonic IDs and checksums detect duplication, gaps, and tampering.

## Risks / Trade-offs

- **[Fixtures reward their own generator]** → keep invariant gates deterministic but require paired live samples and blinded humans for behavior claims.
- **[Small samples create noisy superiority claims]** → publish counts, confidence intervals, ties, and inconclusive outcomes.
- **[Threshold tuning leaks frozen cases]** → route every data access through split eligibility and record contamination attempts.
- **[Trace redaction destroys diagnostic value]** → retain stable metadata, public evidence, hashes, lengths, and error taxonomy instead of raw secrets.
- **[Nested retries inflate cost and confuse attempts]** → centralize ownership and expose one lineage.
- **[Replay events drift from public DTOs]** → share schemas and add producer/consumer compatibility fixtures.

## Migration Plan

1. Consume the versioned B0–B3 interfaces and manifests produced by change 03.
2. Add deterministic fixture reports and non-zero gate tests before real-model evaluation.
3. Add redacted trace events and privacy sentinels around existing hooks.
4. Replace nested retry behavior with the classified attempt coordinator.
5. Add fault injection and prove atomic failure at every decision boundary.
6. Add replay validation, suite manifests, human preference sampling, and promotion/rollback policy.
7. Enable CI gates only after thresholds are recorded with baseline evidence; keep live runs manual and budgeted.

Rollback disables new trace/evaluation adapters and selects the retained previous champion; it never requires changing the game contract.

## Open Questions

- What real-model sample budget and provider price snapshot will be approved for the first comparison?
- What minimum human preference sample makes a result actionable rather than illustrative?
- Which reports are safe to commit publicly versus retain as local evidence?
