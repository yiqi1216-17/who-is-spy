# 06.1 · Anime Roleplay Growth Mode Proposal

## Why

The verified game is correct and now fast, but correctness does not create traffic. What spreads is *comedy, character, and identification* — the moment an AI "阿"-flavored character earnestly describes the wrong secret word in the voice of a beloved anime hero, and the human wants to screenshot it. The existing portrait stage is a polished single-spotlight cinema; it is excellent for one focused player but it is not the shape people screenshot and forward. A chat-stream, in-character, IP-themed variant turns each round into quotable social content while reusing the exact authoritative engine and privacy guarantees already built and tested.

This change is explicitly growth-first: the terminal metric is *how many people played*, captured by a de-identified analytics module in the existing console. Every product decision below serves shareability without compromising the frozen contract or the pre-terminal information-isolation invariants.

## What Changes

- Add a **second entry point** on the home screen ("动漫角色扮演 · 谁是卧底") alongside the existing first-person stage and god mode; the existing modes are untouched.
- Add an **IP picker → random character casting** flow: the player selects one anime IP, is randomly assigned one character from that cast, and all remaining seats are AI cast as the other characters of the same IP.
- Make every seat **speak and vote in character**: the roleplay persona (name, voice, verbal tics) is layered on top of the existing strategy persona and secret word, without exposing any other seat's role or word before the terminal phase.
- **Remove the omniscient view for this mode**: anime mode is first-person only (human's own word + public information); it never offers the god projection.
- Replace the single-spotlight presentation with a **chat-transcript surface**: each utterance (description and vote) renders as a persisted chat bubble that appends to a scrolling history and moves upward, so the whole round reads back like a group chat.
- Persist the transcript as **derived-from-authoritative history**: the scrollback is a projection of the authoritative public event log plus transient live previews, never a second source of truth; it reconciles against `GET` state.
- Append **IP-themed special word pairs** to `words.ts` under four seed directions (热血少年漫, 人气游戏, 国创·武侠仙侠, 日常治愈·搞笑番), scoped so an anime game draws from its IP's bank for in-universe comedy.
- Add a **production-safe growth-analytics module** (de-identified counts: sessions started, IP chosen, mode, rounds reached, completion, share intent) surfaced as a new panel in the existing data & error console, without exposing the dev-only trace or fault-injection surface in production.
- Add a persistent, always-visible **non-commercial fan-work disclaimer and takedown path** whenever official IP art is shown, behind a swappable art-source abstraction.

## Capabilities

### New Capabilities

- `anime-roleplay-mode`: IP selection, random in-character casting, in-character speech/vote layered over authoritative rules, first-person-only projection, and rights-safe character presentation.
- `chat-transcript-experience`: chat-stream layout, per-utterance persisted history that scrolls upward, live async streaming into the transcript, and authoritative reconciliation.
- `growth-analytics`: de-identified, production-safe play-count and funnel aggregates exposed through the existing console without opening dev-only surfaces.

### Modified Capabilities

None normative. This change **consumes** the change 03/04/05 capabilities (authoritative rules, public events, information projections, SSE preview stream, presentation machine, ops console, public guard) and adds new capabilities beside them. The existing portrait and god experiences remain exactly as specified.

## Impact

- **Web:** new home entry, IP-picker screen, chat-transcript screen and message components, transcript projection from public events + previews, themed casting UI, and a new analytics panel in the ops console.
- **Server integration:** a new create path for anime games (IP + casting) reusing the authoritative engine and quality gate; a new production-safe analytics ingest/summary endpoint sibling to `/api/feedback`; themed word-bank selection. No change to frozen HTTP contract endpoints or the Go baseline.
- **Word bank:** IP-scoped pairs appended after the existing bank; existing indices are preserved (tests pin `[0]`, `[2]`, `[9]`).
- **Privacy:** anime mode keeps every pre-terminal isolation invariant (no other roles/words/beliefs/private prompts/unpublished votes); analytics records only de-identified aggregates; roleplay prompts and IP art never enter traces/logs/datasets.
- **Rights:** official art only under a persistent non-commercial fan-work disclaimer with takedown, behind a swappable source; no third-party art or full IP terms persisted.
- **Evidence:** casting-randomness and in-character isolation tests, transcript-reconciliation and privacy tests, analytics de-identification tests, themed-bank audit/redaction-collision tests, and coexistence proof that the existing modes do not regress.

## Non-Goals

- No omniscient/god view, voice chat, payments, accounts, or public multiplayer infrastructure in this change.
- No client-side game rules; casting, transcript, and analytics remain client presentations over authoritative state.
- No monetization or commercial use of any IP; the mode is a non-commercial fan showcase with a takedown path.
- No representation of anime art or IP secret terms as persisted evidence or training data.
- No weakening of the frozen contract, the deterministic vote/winner resolution, or the pre-terminal information-isolation invariants.
