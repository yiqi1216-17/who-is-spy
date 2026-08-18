# 03.1 · Human Data and Agent Orchestration Proposal

## Why

The runnable baseline can complete a game, but its four model players are isolated, similarly prompted calls and cannot support a credible claim that they learned differentiated strategies from human play. The project needs a trustworthy human-data foundation and an enforceable decision architecture before evaluation or product polish can be meaningful.

## What Changes

- Add consent- and license-aware records for real human “Who Is the Spy” games, with explicit separation from licensed transfer, mixed, synthetic, and unknown-rights sources.
- Add versioned runtime schemas shared by datasets, Agent contexts, strategies, beliefs, model outputs, hooks, traces, fixtures, and reports.
- Derive interpretable Agent strategy prototypes from eligible human records; retrieve masked training demonstrations and rank multiple candidates against human-derived distributions.
- Maintain independent private structured beliefs without storing free-text chain-of-thought or exposing one Agent’s state to another.
- Generate AI descriptions sequentially so later speakers can observe earlier public same-round descriptions while unresolved votes remain hidden.
- Add typed, privacy-scoped, bounded hooks and explicit domain/action transition tables.
- Reject leaking, obfuscated, repetitive, or homogeneous descriptions before publication and retry with bounded corrective feedback.
- Serialize commands per game and commit completed decision batches atomically so failures cannot leave half a round.

## Capabilities

### New Capabilities

- `human-game-data`: Provenance, rights, consent, anonymization, annotation, lineage, split, retrieval eligibility, and withdrawal behavior for human gameplay data.
- `agent-learning-orchestration`: Human-derived strategy provenance, private beliefs, sequential contexts, hidden votes, typed hooks, schemas, quality control, and atomic decision orchestration.

### Modified Capabilities

None. No accepted OpenSpec capability exists yet; the frozen baseline remains protected by the language-independent contract.

## Impact

- **Server:** `packages/server-node` gains schema, data, strategy, retrieval, belief, hook, policy, and transactional orchestration boundaries.
- **Shared contracts:** a lightweight TypeScript source of truth validates data at every producer/consumer boundary.
- **Data:** manifest-controlled first-party and explicitly licensed sources; restricted records remain outside Git and unauthorized workflows.
- **Compatibility:** existing HTTP DTOs, legal actions, vote resolution, winners, and terminal revelation remain server-owned and compatible.
- **Security:** no pre-finale role/word leakage, complete GameState in model/hook inputs, persisted private prompts, free-text reasoning, or unresolved votes.
- **Downstream:** changes 04 and 05 consume the versioned public events, reports, traces, and Agent behavior established here.
