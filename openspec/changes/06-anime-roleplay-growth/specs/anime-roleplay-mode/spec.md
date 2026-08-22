# 06.2.1 · Anime Roleplay Mode Specification

## Purpose

Define a public-facing game variant in which a player chooses an anime IP, is randomly cast as one character of that cast, and plays the authoritative social-deduction game in character — while preserving every pre-terminal information-isolation invariant and adding no omniscient view. Casting, persona, and art are presentation and prompt concerns layered over the unchanged authoritative engine.

## ADDED Requirements

### Requirement: Anime mode is a new entry point that does not alter existing modes
The product SHALL offer an anime-roleplay entry point on the home screen alongside the existing first-person stage and god mode, and selecting it MUST NOT change, disable, or regress either existing mode or any frozen contract endpoint.

#### Scenario: Player opens the home screen
- **WHEN** the home screen renders
- **THEN** the existing first-person and god entries remain present and functional, and a distinct anime-roleplay entry is additionally available

#### Scenario: Player leaves anime mode
- **WHEN** the player exits an anime game back to home
- **THEN** the existing modes start normally with unchanged behavior

### Requirement: The player chooses an IP and is randomly cast as one character
Anime mode SHALL let the player select exactly one anime IP before play, SHALL randomly assign the player one character from that IP's cast, and SHALL cast the remaining seats as other distinct characters of the same IP.

#### Scenario: Player selects an IP and starts
- **WHEN** the player picks an IP and begins a game
- **THEN** the player is assigned exactly one character of that IP and every other seat is a distinct character of the same IP

#### Scenario: Casting is not fixed to one seat
- **WHEN** many anime games are started with the same IP
- **THEN** the player's assigned character and secret role vary across games rather than always being the same character or always civilian

### Requirement: Role assignment stays authoritative and independent from character casting
Character casting SHALL be cosmetic: the hidden role (civilian or undercover) and secret word SHALL be assigned by the same authoritative engine as the base game, and the assigned anime character MUST NOT determine, reveal, or correlate with a seat's hidden role.

#### Scenario: Character does not leak role
- **WHEN** a seat is cast as a specific anime character
- **THEN** that character label is visible to all, while the seat's role and word remain hidden under the same rules as the base game

### Requirement: Every seat speaks and votes in character
AI seats SHALL generate descriptions and votes in the voice of their assigned character (name, tone, verbal tics) layered on top of their strategy persona and secret word, and this roleplay layer MUST NOT relax the quality gate or the secret-word constraints.

#### Scenario: In-character description still passes the quality gate
- **WHEN** an AI seat produces an in-character description
- **THEN** the description carries new information about its own word, does not contain the secret word, and is accepted or repaired by the same quality gate as the base game

#### Scenario: Roleplay does not expose hidden information
- **WHEN** any seat speaks or votes in character
- **THEN** the utterance exposes no other seat's role, word, private prompt, structured belief, or unpublished vote

### Requirement: Anime mode is first-person only with no omniscient view
Anime mode SHALL provide only the human first-person projection (the human's own character, role, and word plus public information) and MUST NOT offer an omniscient/god projection of other seats' roles, words, beliefs, or inner monologue at any time, including after the terminal phase.

#### Scenario: No god projection is reachable in anime mode
- **WHEN** the player is in an anime game in any phase
- **THEN** no control or endpoint in this mode returns other seats' hidden roles, words, beliefs, or inner monologue

#### Scenario: Terminal reveal stays within base-game rules
- **WHEN** an anime game reaches its terminal phase
- **THEN** it reveals only what the base first-person terminal reveal already permits, and adds no omniscient layer

### Requirement: Character art is rights-safe and swappable
When character art is shown, the mode SHALL display a persistent, always-visible non-commercial fan-work disclaimer and a working takedown path, and the art source SHALL be behind a swappable abstraction so original or generated art can replace official art without changing gameplay.

#### Scenario: Official art is displayed
- **WHEN** the mode renders official IP character art
- **THEN** a clearly visible non-commercial / fan-work notice and a takedown/contact path are present in the same view

#### Scenario: Art source is swapped
- **WHEN** the art source is switched from official to original assets
- **THEN** casting, roles, transcript, and analytics behavior are unchanged

### Requirement: Roleplay prompts and IP terms never persist to sensitive artifacts
Roleplay persona prompts, official art, and full IP secret terms MUST NOT appear in traces, logs, datasets, or Git; only stable de-identified IP and character identifiers may be recorded.

#### Scenario: Trace after an anime round
- **WHEN** observability captures an anime round
- **THEN** the redacted artifacts contain no secret word, no roleplay prompt text, and no official art payload, and the secret-sentinel scan returns empty
