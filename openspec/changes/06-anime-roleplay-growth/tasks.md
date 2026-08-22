# 06.4 · Anime Roleplay Growth Mode Tasks

> This change consumes changes 03/04/05 and is additive. Every task ends with a deterministic test, a privacy/isolation proof, an audit check, or an approved visual artifact. Existing gates (server, web, contract:node) MUST stay green throughout. Do not modify the Go baseline or any frozen contract endpoint.

## 1. IP catalog and themed word banks

- [ ] 1.1 Define an IP catalog (id, display name, cast of characters with stable ids and de-identified labels) for the four seed directions (热血少年漫 / 人气游戏 / 国创·武侠仙侠 / 日常治愈·搞笑番), behind a data module with a typed shape; add a test that every IP has enough distinct characters to fill a table.
- [ ] 1.2 Append IP-scoped special word pairs to `words.ts` after the existing bank; add a test proving existing indices `[0]`, `[2]`, `[9]` are unchanged and that themed selection draws from the correct IP subset.
- [ ] 1.3 Run the content audit (no sensitive/vulgar/gory terms) and the redaction-collision check (no new pair is a substring that makes `scanSecrets` false-positive over existing artifacts); record the audit result and keep `scanSecrets` empty across the suite.

## 2. Anime create path and in-character agents (server)

- [ ] 2.1 Add an anime create path that reuses `GameEngine` role/word assignment and casts each seat to a distinct character of the chosen IP; add a test proving role/word come from the authoritative path and are uncorrelated with the assigned character.
- [ ] 2.2 Prove casting randomness: over many games with one IP, the player's character and hidden role both vary (not always one character, not always civilian).
- [ ] 2.3 Layer the roleplay persona onto the speaking seat's own `AgentContext` identity only; add a test that the context for a seat contains no other seat's role/word/belief and that the allow-list is unchanged.
- [ ] 2.4 Prove the quality gate is unchanged under in-character output: an in-character description still carries new self-word information, still excludes the secret word, and still repairs/exhausts identically; reuse the gate's existing tests.
- [ ] 2.5 Prove anime mode exposes no omniscient projection in any phase, including terminal; add a test that no anime-mode read returns other seats' roles/words/beliefs/inner monologue.
- [ ] 2.6 Prove observability after an anime round: redacted artifacts contain no secret word, no roleplay prompt text, no official-art payload; secret-sentinel scan empty.

## 3. Chat-transcript experience (web)

- [ ] 3.1 Add the second home entry ("动漫角色扮演") beside the existing first-person and god entries; add a test/visual proving both existing entries remain present and functional.
- [ ] 3.2 Build the IP-picker screen (choose one IP → start) and the random-casting hand-off into a game; visual artifact at target portrait viewport.
- [ ] 3.3 Build the chat-transcript screen: each utterance is an attributed message bubble; new messages append at the bottom and push older ones up; the full game history is scroll-back-able. Fixture-driven render test.
- [ ] 3.4 Project the transcript from authoritative public events + transient previews (reuse the 05 `livePreviews`/`seen` discipline); add a test that committed messages map one-to-one to authoritative events and that a rolled-back preview reconciles out.
- [ ] 3.5 Stream live in-character utterances into the transcript (descriptions and votes) with async feel; prove a previewed utterance promotes to a single authoritative message without duplication.
- [ ] 3.6 Integrate human description input and vote controls into the chat surface; the human's own utterance appears as their character's message under base-game secret-word/length rules.
- [ ] 3.7 Prove pre-terminal secrecy in the transcript: no message exposes any other seat's role/word/belief/private prompt/unpublished vote; add reduced-motion and reconnect-order tests.

## 4. Growth analytics (server + console)

- [ ] 4.1 Add a bounded, in-memory, de-identified growth-event store modeled on the feedback store: coarse counters only (day bucket, mode, IP id, round reached, completion, share intent); add a de-identification test and an empty secret-sentinel scan over the serialized store.
- [ ] 4.2 Add a production-safe ingest path and an aggregate-only summary endpoint (sibling to `/api/feedback`), mounted in production; add a test that the summary returns aggregates in production while `/api/ops/*` trace/fault routes remain 404 in production.
- [ ] 4.3 Make recording best-effort: a failed analytics write never blocks or fails a game command or alters its authoritative result; add a test with a failing/unavailable store.
- [ ] 4.4 Apply the existing public rate/abuse guard to ingestion under public mode and bound the store; add a test that a burst is rejected and the store stays bounded.
- [ ] 4.5 Add a growth panel to the existing data & error console showing player-count and funnel aggregates from the summary, without changing the existing trace/eval/fault views; visual artifact.

## 5. Rights safety and coexistence

- [ ] 5.1 Implement the swappable art-source abstraction (official fan-work source + original/generated source); add a test that swapping the source leaves casting, roles, transcript, and analytics behavior unchanged.
- [ ] 5.2 Show a persistent, always-visible non-commercial fan-work disclaimer and a working takedown/contact path whenever official art is displayed; visual proof in the anime views.
- [ ] 5.3 Prove no official art payload or full IP secret term is persisted to traces/logs/datasets/Git; only de-identified IP/character ids appear.
- [ ] 5.4 Prove coexistence and no regression: existing portrait first-person, god mode, SSE, highlights, and feedback behavior are unchanged; run full server + web + contract:node suites green.

## 6. Verify growth-mode completeness

- [ ] 6.1 End-to-end anime round against fixtures: IP pick → casting → in-character chat round → vote → elimination → terminal, with the transcript persisting and reconciling throughout.
- [ ] 6.2 Capture the anime scene matrix (IP picker, casting, chat round, vote, terminal) as visual artifacts at target portrait viewport; note any renders that require a live browser.
- [ ] 6.3 Update DECISIONS.md with the casting-vs-role isolation decision, the production-safe-analytics-vs-dev-ops decision, and the rights posture; capture meaningful commit boundaries.
