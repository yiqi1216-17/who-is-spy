---
name: ship-who-is-spy-changes
description: Deliver approved who-is-spy OpenSpec changes with Superpowers methodology. Use for any implementation, bug fix, refactor, dataset pipeline, benchmark, observability, Node server, React portrait UI, demo CLI, or verification task in this repository after planning artifacts exist.
---

# 06 · Ship Who Is Spy Changes

## Establish authority

1. Read the root `AGENTS.md`.
2. Read `CANDIDATE_TASK.md` and `contract/CONTRACT.md` for hard boundaries.
3. Select exactly one numbered change and run `openspec status --change <name> --json`.
4. Read that change's proposal, affected capability specs, design, tasks, and declared predecessors.
5. Treat `docs/planning-history/01_IMPLEMENTATION_PLAN.md` and `docs/planning-history/02_DATA_DRIVEN_PRODUCT_EVOLUTION_PLAN.md` as background only.
6. For change 04 or 05, verify the predecessor interfaces named in its README/design exist or explicitly report the unmet dependency.

Stop before implementation if tasks are not ready, the requested behavior conflicts with a spec, or implementation has not been authorized.

## Apply the combined lifecycle

Use installed Superpowers skills when available:

1. Use brainstorming for unresolved product or architecture choices.
2. Use writing-plans only to refine the OpenSpec task breakdown; do not create a competing plan elsewhere.
3. Use test-driven-development for every behavior change. Capture the failing test or baseline before implementation.
4. Use systematic-debugging for unexpected failures. Identify the cause before editing.
5. Use requesting-code-review after a coherent task group.
6. Use verification-before-completion before checking an OpenSpec task.
7. Use finishing-a-development-branch only after the entire approved change is complete.

If Superpowers is missing, tell the user before implementation and follow the same lifecycle explicitly without claiming that plugin skills ran.

## Deliver one task slice

For each unchecked task:

1. Restate the capability requirement and scenario it satisfies.
2. Inspect current behavior and record a failing test, benchmark delta, or visual baseline.
3. Implement the smallest change that satisfies the scenario.
4. Run focused verification, then the required broader gate.
5. Inspect privacy projections and authoritative-state mutations.
6. Update `DECISIONS.md` with meaningful Agent assistance and human corrections.
7. Mark the task complete only when evidence exists.

Never modify the Go backend, weaken the frozen contract, relabel synthetic data as human, expose private state, or make UI animation authoritative.

## Verification matrix

- Server/domain: focused Vitest, `npm run test:node`, `npm run contract:node`.
- Shared schema/data: schema fixtures, lineage/license cases, split-contamination tests.
- Agent behavior: sequential-context capture, non-interference pairs, quality-policy retry, atomic failure.
- Evaluation: deterministic paired baseline, non-zero gate failure test, champion/promotion rules.
- Recovery: targeted fault injection, trace identifiers, privacy sentinel scan, state-before/state-after comparison.
- Web: build, portrait viewport checks, presentation-machine transitions, reduced-motion, CLI scene fixtures.
- Completion: `openspec validate <change> --strict`, clean-clone instructions, real-model smoke evidence when required.

Do not claim completion when a required command was skipped. State whether a failure is code, environment, data access, network, or missing runtime tooling.
