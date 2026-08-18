# 03.0 · Human Data and Agent Orchestration

## Outcome

Turn the runnable Node baseline into a data-grounded Multi-Agent core: real-human-game records with explicit rights, versioned schemas, human-derived strategy prototypes, independent private beliefs, typed hooks, sequential public-context decisions, quality gates, and atomic authoritative commits.

## Boundaries

- This is the first implementation change and has no dependency on changes 04 or 05.
- `packages/server-node` is selected; `packages/server-go` remains unchanged.
- Existing HTTP behavior and server-authoritative rules remain the compatibility floor.
- Planning history lives in `docs/planning-history/` and is not an executable requirement source.

## Artifacts

- `proposal.md` explains why and what changes.
- `specs/` defines observable data and Agent behavior.
- `design.md` records implementation decisions and trade-offs.
- `tasks.md` is the test-first delivery checklist.

## Completion gate

The change is ready to archive only after its tasks are complete, strict OpenSpec validation passes, Node tests and `contract:node` remain green, privacy/non-interference tests pass, and the B0–B3 ablation evidence is available to change 04.
