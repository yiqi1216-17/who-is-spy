# 04.1 · Evaluation and Recovery Proposal

## Why

Differentiated Agents are not convincing without paired evidence, and a model-backed game is not production-worthy when failures cannot be located, reproduced, or recovered without leaking secrets. The project needs one evolution loop that compares versions honestly and one operational layer that makes bad paths observable and safe.

## What Changes

- Preserve runnable B0–B3 baselines and compare champion/challenger variants on matched seeds, roles, word pairs, public histories, and human inputs.
- Separate contract, frozen-core, transfer, adversarial, unseen-word, rolling-challenge, human-preference, and product-playtest suites with contamination guards.
- Produce versioned reports for safety, validity, behavior, calibration, latency, tokens, estimated cost, failures, and data-source counts.
- Add deterministic non-zero quality gates, blinded human preference studies, controlled failure ingestion, and champion promotion/rollback manifests.
- Add a per-faction win-rate arms race in which successive skill iterations, on identical seeds, move civilian and undercover win-rates as a function of strategy alone, grounded in win/loss signal mined from the human transfer corpus; include a rebalancing iteration where the undercover adopts a human sophistry tactic (steady-state disguise) to pull a corpus-skewed win-rate back toward parity, showing the arms race can re-level rather than run away.
- Emit allowlisted decision lifecycle traces with stable identifiers, attempts, latency, usage, error classes, policy results, and commit status.
- Consolidate transport, schema, policy, configuration, and unknown failures into a bounded retry taxonomy.
- Add development-only fault injection and public-decision replay while keeping private candidates and secrets out of persistent artifacts.
- Prove retries, diagnostics, and replays preserve the atomic-action contract from change 03.

## Capabilities

### New Capabilities

- `evaluation-evolution`: Reproducible baselines, isolated suites, paired reports, human preference, controlled challenge growth, and champion/challenger promotion.
- `observability-recovery`: Redacted traces, classified bounded retries, reproducible fault injection, atomic recovery, and public-event replay.

### Modified Capabilities

None. This change consumes but does not modify the capabilities proposed by change 03.

## Impact

- **Evaluation tooling:** fixture, fault, and budgeted real-model modes plus versioned JSON and human-readable reports.
- **Server:** trace projections, error taxonomy, retry coordination, fault adapters, and replay/event sinks around existing transactional boundaries.
- **CI:** deterministic contract/privacy/completion/quality gates with explicit non-zero failure behavior.
- **Artifacts:** immutable baseline and champion manifests, quarantined failure intake, and redacted replay evidence.
- **Operations:** real-model work is opt-in, concurrency- and budget-capped, and clearly separated from deterministic CI claims.
- **Privacy:** traces and reports cannot persist keys, complete secret words, private prompts, beliefs, hidden reasoning, or unpublished votes.
