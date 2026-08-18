# 07 · Project Agent Contract

## Authority

Read `CANDIDATE_TASK.md` and `contract/CONTRACT.md` before changing behavior. Treat the selected numbered OpenSpec change under `openspec/changes/` as the source of truth for new work. The numbered documents under `docs/planning-history/` are rationale, not executable requirements.

## Required workflow

1. For ambiguous product or architecture work, use OpenSpec explore and Superpowers brainstorming before creating artifacts.
2. Create or update an OpenSpec proposal, capability specs, design, and tasks before implementation.
3. Do not write implementation code until the relevant OpenSpec tasks are ready and the user has authorized implementation.
4. Respect the delivery dependency order: `03-human-data-and-agent-orchestration` → `04-evaluation-and-recovery` → `05-portrait-product-experience`.
5. During implementation, select one change explicitly and use the project skill `ship-who-is-spy-changes`.
6. When the Superpowers plugin is available, invoke its skills as applicable: brainstorming, writing-plans, test-driven-development, systematic-debugging, verification-before-completion, requesting-code-review, and finishing-a-development-branch.
7. If Superpowers is unavailable, report that runtime dependency before implementation; do not claim its workflow was executed.
8. Update `DECISIONS.md` during work with actual Agent contributions, human review, rejected suggestions, and verification evidence.

## Engineering boundaries

- Implement the selected backend only in `packages/server-node`; leave `packages/server-go` unchanged.
- Preserve existing public HTTP behavior and run `npm run contract:node` after relevant changes.
- Deterministic code owns phases, legal targets, ballots, eliminations, winners, and revelation.
- Build AgentContext and hook payloads through allowlists. Never pass a complete GameState to a model or general hook.
- Never persist API keys, complete secret words, private prompts, free-text chain-of-thought, other-agent beliefs, or unresolved votes.
- Keep direct human, licensed transfer, mixed, and synthetic data explicitly separated.
- Do not use unknown-license media or transcripts in training, fixtures, or committed data.

## Verification

Start behavior changes with a failing characterization or acceptance test. Diagnose failures systematically rather than patching symptoms. Before completion, run the scoped tests plus build, Node domain tests, Node contract, evaluation gate, privacy sentinels, and any required portrait visual verification. Do not claim completion from code inspection alone.

## Markdown numbering

Keep user-authored planning/reference Markdown numbered. Change directories carry the top-level sequence (`03`, `04`, `05`). Framework-mandated filenames such as `proposal.md`, `design.md`, `tasks.md`, `spec.md`, `SKILL.md`, and `AGENTS.md` retain their standard names; place their scoped sequence in the document title.
