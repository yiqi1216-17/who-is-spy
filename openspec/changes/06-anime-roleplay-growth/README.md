# 06.0 · Anime Roleplay Growth Mode

## Outcome

Add a second, public-facing entry point that turns the verified social-deduction engine into a shareable, high-comedy anime roleplay experience: the player picks an anime IP, is randomly cast as one character of that cast, and plays "Who Is the Spy" in a chat-stream interface where every line is persisted to a scrolling transcript. The goal is traffic — comedy, immersion, and replayability that people want to share — measured by a privacy-safe player-count analytics module surfaced in the existing data/ops console.

## Non-destructive

This change **adds** a new mode and entry point. It does **not** remove or rewrite the existing portrait first-person stage (change 05), the god mode, or any frozen HTTP contract. The anime mode reuses the authoritative engine, information-isolation invariants, quality gate, SSE preview channel, and public rate guard already shipped.

## Scope at a glance

1. **Anime roleplay mode** — a new game variant: choose an IP → random character casting → every seat (human + AI) speaks and votes *in character*. No omniscient/god view in this mode.
2. **Chat-transcript experience** — a chat-app layout where each utterance lands as a persisted history message that scrolls upward, replacing the single-spotlight stage for this mode.
3. **Growth analytics** — a production-safe, de-identified play-count/funnel module added to the existing data & error console (the ops surface).
4. **Themed word banks** — `words.ts` gains IP-scoped special word pairs (热血少年漫 / 人气游戏 / 国创·武侠仙侠 / 日常治愈·搞笑番) that create in-universe comedy collisions.

## Dependencies

- Change 03 supplies authoritative rules, public events, information projections, and the quality gate.
- Change 04 supplies redacted observability and the ops console surface that the analytics module extends.
- Change 05 supplies the SSE public-event stream, the transient preview channel (async-speech), the presentation state machine, and the public rate guard.
- This change cannot make casting, transcript rendering, or client analytics authoritative, and cannot weaken any pre-terminal information-isolation invariant.

## Rights posture

Character art may use official anime art **only** behind a prominent, always-visible non-commercial / fan-work (纯二创·非商业·个人用途) disclaimer and a working takedown path; the art source is behind a swappable abstraction so original/AI-generated art can replace it without touching gameplay. No official art or full IP secret terms are persisted in traces, logs, datasets, or Git; only stable de-identified IP/character identifiers are recorded.

## Artifacts

- `proposal.md` defines the growth opportunity, scope, and non-goals.
- `specs/` defines observable behavior for the anime mode, the chat-transcript surface, and growth analytics.
- `design.md` records casting, roleplay-prompt, transcript-persistence, analytics, and rights decisions with alternatives.
- `tasks.md` is the delivery checklist; each task pairs behavior with a test, privacy proof, or visual artifact.

## Completion gate

Ready to archive only after: the anime entry point coexists with the existing stage without regressing it; casting is random and in-character without leaking other seats' roles/words pre-terminal; the chat transcript persists and reconciles every utterance against authoritative state; the analytics module reports de-identified aggregates in production without exposing the dev-only trace/fault surface; themed word banks pass the same audit and redaction-collision checks as the base bank; and all existing gates (server, web, contract:node) stay green.
