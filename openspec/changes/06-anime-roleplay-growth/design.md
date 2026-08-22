# 06.3 · Anime Roleplay Growth Mode Design

## Context

See `proposal.md` for motivation. Changes 03/04/05 provide the authoritative engine (`GameEngine`), the allow-listed `AgentContext` projection (`buildAgentContext`), the quality gate (`gatedDescribe`), the transient preview channel (`GameEventBus.publishPreview`), the presentation state machine, the ops console, and the public rate guard. This change adds a growth-oriented mode beside the existing ones. It changes no frozen contract endpoint and modifies no Go code.

The precedent that governs most decisions here is **god mode**: it already demonstrated how to add a whole new experience (all-AI omniscient game) as a *separate create path + separate DTO* without touching `/api/games` or the isolation invariants. Anime mode follows the same discipline, except it is *more* restricted than the base game (no omniscient view at all), not less.

## Goals / Non-Goals

**Goals:**

- A shareable, in-character, chat-stream variant that reuses the exact authoritative engine and privacy guarantees.
- Comedy and identification as first-class product outcomes, measured by de-identified play-count analytics.
- Additive delivery: the existing portrait and god experiences remain byte-for-byte in behavior.
- Rights safety that lets us launch fast with official art yet swap to original art with no gameplay change.

**Non-Goals:**

- No omniscient/god projection in anime mode; no free-text chain-of-thought anywhere.
- No client-authoritative casting, transcript, or analytics; no second game protocol.
- No accounts, payments, voice, or public multiplayer infra.
- No commercial use of any IP; no persistence of official art or full IP terms.

## Decisions

### 1. Anime mode is a separate create path over the same engine (the god-mode pattern)

Anime games are created through a new create path and served through a first-person projection, exactly as the base game is, reusing `GameEngine`, role/word assignment, the quality gate, `resolveBallot`, and winner resolution. Casting metadata (IP id, per-seat character id) rides *alongside* the authoritative state as cosmetic labels.

Alternative: fork the engine or add a "mode" flag threaded through rule code. Rejected — it risks divergence in the deterministic vote/winner logic that the whole test suite pins. Reusing the engine keeps a single source of rule truth.

### 2. Character casting is cosmetic and orthogonal to hidden role

The hidden role (civilian/undercover) and secret word are assigned by the same authoritative random path as the base game. The anime character is assigned independently and is *public* (everyone sees each seat's character), while role/word stay hidden under the unchanged allow-list. There is deliberately **no correlation** between "which character you are" and "whether you are the undercover," so a viewer cannot deduce role from casting.

Alternative: tie a specific character to the undercover for narrative flavor. Rejected — it leaks hidden role through the public character label, breaking the core invariant and the game.

### 3. Roleplay persona layers onto `AgentContext.identity`, never onto the allow-list of others

The character voice (name, tone, verbal tics) is injected into the *speaking seat's own* `identity`/persona input to `describe`/`vote`. It does not add any field about *other* seats to the context. The quality gate is unchanged: an in-character description must still carry new information about the seat's own word and must still not contain the secret word; failures repair or exhaust exactly as today.

Alternative: post-process plain descriptions into character voice in a second model call. Rejected — extra latency and a second place for the secret word to leak; inlining the persona in the existing single call keeps the one quality-gated boundary.

### 4. Anime mode removes the omniscient view entirely

Unlike the base product (which unlocks terminal omniscient replay) and god mode (which is omniscient by construction), anime mode exposes only the human first-person projection at all times, and its terminal reveal adds nothing beyond what base first-person already permits. This is a *tightening*, so it cannot regress any isolation test; it also keeps the public, shareable surface free of any hidden-state exposure.

Alternative: reuse the base terminal omniscient reveal. Rejected for this mode because the growth surface is public and screenshot-friendly; the smaller the hidden-state surface, the lower the leakage risk under heavy traffic. (The requirement in `anime-roleplay-mode` makes this normative.)

### 5. The chat transcript is a projection, not a source of truth

The transcript is rendered from the authoritative public event log plus transient previews — the same two inputs the current stage already consumes. Committed messages map one-to-one to authoritative events; live previews render as transient "typing/just-sent" bubbles that are promoted to (or reconciled out against) authoritative events on commit, using the existing preview→authoritative dedup discipline (05's `livePreviews` buffer and `seen` keys). Reconnect restores order by reconciling against `GET`.

Alternative: maintain a client-side message store appended on each SSE frame as the truth. Rejected — it would drift from authoritative state on rollback/reconnect and could persist a preview that never committed. Projection keeps the "atomic round commit" guarantee intact.

### 6. Transcript persistence = full scrollback of authoritative history, bounded by game

"落盘成历史消息、不断上移" is satisfied by keeping the whole ordered public history of the current game in the transcript and appending new messages at the bottom (older scroll up). This is per-game, in-memory, and matches the engine's own in-memory game lifetime; it is not a new durable datastore and carries no new privacy surface.

### 7. Growth analytics is a production-safe sibling of feedback, not part of the dev-only ops routes

The existing trace and fault-injection routes are intentionally **dev-only / 404 in production** for safety. Play-count must be visible on the live site, so analytics is modeled on the *already-production-mounted* feedback store: a bounded, in-memory, de-identified aggregate with an ingest path and a summary path, recording only coarse counters (day bucket, mode, IP id, round reached, completion, share intent). The console gains a new panel reading that summary. The dev-only trace/fault surface is **not** opened in production by this change.

Alternative: reuse `/api/ops/*` for the counter. Rejected — that surface is 404 in production by design; putting growth data there would either hide it in prod or force opening the dangerous routes. Feedback's proven prod-safe aggregate shape is the right precedent.

### 8. Analytics is best-effort and de-identified by construction

Recording is side-effect-only and must never block or fail a game command. De-identification follows the feedback store's discipline (no personal identifiers, no raw text, no roles/words; only enumerated dimensions and counts), and the secret-sentinel scan must return empty over the serialized store. Ingestion is bounded and, under public mode, subject to the existing per-IP/global guard so hostile traffic cannot inflate or exhaust it.

### 9. Themed word banks are appended and IP-scoped

IP-themed pairs are appended to `words.ts` after the existing bank so existing indices (`[0]`, `[2]`, `[9]` pinned by tests) are preserved. Each anime game draws its pair from its IP's themed subset for in-universe comedy; the base and hot-word banks are unchanged. Every new pair passes the same two gates as the recent hot-word expansion: content audit (no sensitive/vulgar/gory terms) and redaction-collision check (no pair is a substring that would make `scanSecrets` false-positive over existing artifacts).

### 10. Rights safety via a swappable art source + persistent disclaimer

Character art is fetched through an art-source abstraction with two implementations: official (fan-work) and original/generated. When official art is shown, a persistent non-commercial fan-work disclaimer and a takedown path are always visible. Swapping the source changes no gameplay, transcript, or analytics behavior. No official art or full IP secret term is persisted anywhere.

## Privacy & isolation invariants (unchanged and extended)

- Pre-terminal: no seat's role, word, structured belief, private prompt, or unpublished vote is exposed — in the transcript, in casting labels, or in previews.
- Anime mode adds **no** omniscient path; it is strictly more restrictive than the base game.
- Traces/logs/datasets/Git: no secret words, no roleplay prompts, no official art, no full IP terms; only de-identified IP/character ids and aggregate counters.
- Analytics stores only enumerated dimensions and counts; secret-sentinel scan empty.

## Migration & rollback

- **Additive:** no existing endpoint, screen, or test changes semantics. The new entry, screens, create path, analytics endpoint, and word-bank append are all new surface.
- **Feature-gated:** the anime entry and analytics panel can be disabled by configuration without affecting existing modes.
- **Rollback:** removing the new entry, create path, analytics endpoint/panel, and the appended word-bank block returns the product to its pre-06 behavior; because indices are appended (not reordered), removal does not disturb pinned word-pair tests.

## Risks

- **Rights exposure under traffic:** mitigated by the non-commercial disclaimer, takedown path, swappable source, and no-persistence rule; the original-art source is the safe fallback if a takedown lands.
- **In-character prompts weakening the quality gate:** mitigated by keeping the single quality-gated boundary and reusing its tests; in-character output is still gated for new-info and secret-word constraints.
- **Analytics scope creep into personal data:** mitigated by modeling on the feedback store's de-identification discipline and asserting an empty sentinel scan over the store.
- **Transcript drift from authoritative state:** mitigated by projection-only rendering and `GET`-reconciliation on commit/reconnect.
