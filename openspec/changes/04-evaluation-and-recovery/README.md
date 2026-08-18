# 04.0 · Evaluation and Recovery

## Outcome

Make every improvement and failure claim reproducible: paired B0/challenger benchmarks, frozen and rolling suites, human preference evidence, champion promotion, redacted traces, classified retries, development fault injection, atomic recovery, and public-decision replay.

## Dependency

This change consumes the schemas, Agent version identifiers, data splits, transactional actions, and event boundaries from `03-human-data-and-agent-orchestration`. It must not redefine Agent decision behavior or weaken change 03’s privacy contracts.

## Artifacts

- `proposal.md` defines the evidence and reliability problem.
- `specs/` defines observable evaluation, promotion, trace, retry, fault, and replay behavior.
- `design.md` records benchmark and observability architecture.
- `tasks.md` is the verification-first delivery checklist.

## Completion gate

The change is ready to archive only after deterministic gates fail correctly, B0/challenger reports are reproducible, privacy sentinels survive success and failure paths, fault scenarios preserve authoritative state, and a budget-capped real-model run produces redacted evidence.
