# 04.4 · Evaluation and Recovery Tasks

> This change depends on the versioned schemas and transactional Agent boundary from change 03. Every task begins with a failing gate, replay fixture, privacy sentinel, or recorded baseline.

## 1. Establish reproducible evaluation inputs

- [ ] 1.1 Consume change 03’s B0–B3 manifests and add a compatibility test that rejects missing or incompatible engine, data, strategy, schema, evaluator, provider, and pricing versions.
- [ ] 1.2 Implement seeded fixture, fault, and real evaluation modes and prove identical fixture inputs produce byte-stable reports.
- [ ] 1.3 Add matched scenario matrices for roles, seats, word pairs, public histories, human inputs, ties, failures, and terminal outcomes.

## 2. Protect benchmark suites and metrics

- [ ] 2.1 Add frozen-core access-denial and manifest-hash tests across retrieval, fitting, prompt selection, threshold tuning, and rolling failure intake.
- [ ] 2.2 Report completion, validity, leakage, repetition, diversity, strategy distinguishability, belief calibration, latency, usage, cost, retries, and role outcomes with denominators and uncertainty.
- [ ] 2.3 Implement deterministic non-zero gates and tests proving a secret leak, illegal action, incomplete game, privacy sentinel, or threshold breach fails the process.
- [ ] 2.4 Add blinded human preference sampling for naturalness, fun, differentiation, replay intent, and share intent, preserving counts, ties, and randomized presentation order.

## 3. Add redacted decision observability

- [ ] 3.1 Write success/failure artifact scans with unique key, word, prompt, belief, and hidden-vote sentinels, then emit allowlisted trace events.
- [ ] 3.2 Add correlation, attempt, error, latency, usage, policy, version, and commit-state assertions for every model and hook boundary.
- [ ] 3.3 Prove accepted public actions are replayable while rejected private candidates retain only safe hash, length, code, and timing metadata.

## 4. Classify and recover failures

- [ ] 4.1 Replace nested retries with one tested taxonomy and attempt lineage covering timeout, rate limit, upstream, malformed JSON, schema, illegal target, policy, auth/configuration, and unknown failures.
- [ ] 4.2 Test bounded backoff, jitter, `Retry-After`, decision correction, and non-retryable authentication/configuration behavior without real waiting.
- [ ] 4.3 Add development-only targeted fault injection and prove production rejects fault flags and demo controls.
- [ ] 4.4 Inject every failure class at each relevant boundary and assert trace classification plus authoritative state before/after equality on terminal failure.

## 5. Replay and evolve safely

- [ ] 5.1 Add schema/version, monotonic-ID, gap, duplication, and tamper tests, then reconstruct the public decision timeline without rerunning models.
- [ ] 5.2 Add quarantined, de-identified, rights-checked failure intake and prove it can update only a future rolling challenge manifest, never frozen core.
- [ ] 5.3 Implement champion/challenger promotion and rollback manifests with hard gates, declared target gain, regression budgets, uncertainty, cost/latency limits, and retained previous champion.

## 6. Verify the evidence system

- [ ] 6.1 Run the full deterministic suite twice and prove stable reports, intended non-zero failures, privacy cleanliness, and replay integrity.
- [ ] 6.2 Run a budget-capped DeepSeek comparison, label live latency/cost separately from fixtures, and preserve only redacted reports.
- [ ] 6.3 Produce a concise B0–B3/champion scorecard with ablations, sample limitations, failures, recovery evidence, and no unsupported superiority claim.
- [ ] 6.4 Run Node tests, build, `contract:node`, strict OpenSpec validation, and independent evaluation/privacy review; record residual risks before archive.
