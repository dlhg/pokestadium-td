# AGENTS.md — PokéStadium Developer & Agent Conventions

This is the single source of truth for architecture, conventions, and workflow in this repo. Keep it in sync with the codebase as it changes — do not let this drift the way it previously did.

This repository contains two primary components:
1. **`pokestadium` C/MIPS Disassembly Base**: The reverse-engineering project of Pokémon Stadium (US 1.0) for the Nintendo 64, based on [pret/pokestadium](https://github.com/pret/pokestadium). Lives in `baseroms/`, `include/`, `src/`, `yamls/`, `tools/`.
2. **`web/` (`PokéStadium TD`)**: A modern 3D TypeScript + Three.js game engine kit and Tower Defense game.

## 🎯 Goal

Use `pokestadium` as a set of **building blocks for 3D games in other genres**. The N64 engine underneath is a high-performance 3D battle and colosseum engine: a 3D arena environment system, a low-poly skeletal/joint animation system, a turn-based elemental combat resolver, a dynamic cinematic camera director, an announcer speech & reaction system, and a distinctive late-90s tournament UI. Each subsystem is separable and data-driven. `web/` is where that reimplementation happens — it does not reuse any original ROM assets or code (see "Copyrighted assets" below).

---

## 🏗️ `web/` Project Architecture

```
web/
├── index.html               # Stadium canvas viewport & retro CRT/scanline overlay
├── vite.config.ts           # Vite bundler config (port 3004)
├── package.json             # Three.js + TypeScript setup
├── take_screenshot.py       # Visual self-critique & screenshot capture script
├── docs/                    # Design-rationale docs, updated alongside the features they cover
│   ├── tower-roles.md       # Tower path/signature design and rationale
│   ├── trainer-progression.md
│   └── cup-rules.md         # Cup level brackets, entry rules and rentals (phases 1–3 in)
├── ROM_ASSETS.md            # Optional, gitignored ROM-extraction workflow
└── src/
    ├── engine/               # Reusable 3D engine (renderer, camera, audio, input, particles, FX)
    ├── stadium/               # Decomposed Pokémon Stadium systems (arena, models, types, moves, announcer)
    ├── td/                    # Tower Defense implementation (towers, creeps, waves, maps, UI)
    │   └── progression/       # Trainer progression (roster, XP, species/stats, save, dev panel)
    └── main.ts                # Entry point connecting engine and game loop
```

The full, current file list always wins over any summary here — see the source directories directly. The subsystem breakdown below documents the *why* behind the key files, not an exhaustive index.

### Engine Subsystems by Genre Reusability

- **`stadium/StadiumArena.ts`** — *Iconic 3D Colosseum Environment.* Multi-tier stadium stands, central Poké Ball battle pitch, perimeter safety barriers, and animated jumbotrons. Highly reusable for arena combat, fighting games, or tactical defense.
- **`stadium/PokemonModels.ts`** — *Low-Poly 3D Character Models & Animations.* Authentic N64-proportioned geometries with joint hierarchies, idle breathing, attack animations, and hit reactions.
- **`stadium/TypeMatrix.ts`** — *Elemental Combat Matrix.* Complete 15-type Gen 1 effectiveness table (2x Super Effective, 0.5x Not Very Effective, 0x Immune).
- **`stadium/MoveDatabase.ts`** — *Data-Driven Move System.* Moves with damage, rate, range, hit shape (projectile, piercing beam, cone, tower-centred field, aura), Heavy and ground-only flags, status conditions, and 3D FX bindings.
- **`td/TowerAttack.ts`, `Signatures.ts`, `Hazard.ts`** — *Tower Roles.* Each tower fires one basic attack that the paths it buys reshape through tier effects (swaps, chains, crits, rage, auras, lane hazards, knockback, multishot, spin-up...). Paths cap at 3-2-0; tier 3 unlocks a PP-limited signature move called from the signature bar (1–9). Creeps carry Airborne / Phantom / Armored traits from their types. Design and rationale: `docs/tower-roles.md`.
- **`stadium/Announcer.ts`** — *Dynamic Stadium Announcer.* Real-time reactive commentary with 3D banner overlays and synthesized speech.
- **`engine/StadiumCamera.ts`** — *Cinematic Multi-Angle Director.* Smooth transitions between Tactical Top-Down, Stadium Isometric, and Dramatic Action Battle Cams.
- **`td/StadiumUI.ts`** — *90s Stadium Presentation.* Catch tags over weakened creeps with a ball picker, tower path shop, signature bar, metallic tournament headers, 3D floating HP bars, and the team roster deck.
- **`td/progression/`** — *Trainer Progression.* Persistent collection and team of six (`TrainerStore`, localStorage), species data, roles, paths and evolution lines (`Species`), Gen 1-style stats and XP curve (`Stats`), per-match XP splitting (`MatchProgress`), starter/team/summary/report screens (`TrainerScreens`), and a dev panel toggled with the backquote key (`DevPanel`, dev builds or `?dev`). Design and rationale: `docs/trainer-progression.md`.

### Copyrighted assets

Nintendo's original models, audio, and other ROM-derived assets are never bundled or committed. `web/public/music/*.mp3` and `public/generated/stadium/` are gitignored; the game runs fine without them and falls back to procedural audio/models. `npm run dev`/`build` auto-extract them once when a valid Rev 2 ROM is present and they're missing (`tools/check_stadium_assets.py`, which also prints why it fell back otherwise); `npm run extract:stadium` regenerates them manually — see `ROM_ASSETS.md`.

---

## 🎨 3D Visual & Styling Conventions

1. **N64 Aesthetic**:
   - Models must retain authentic low-poly character styling (faceted Gouraud shading, vertex coloring, and low-res retro textures).
   - A single animated jumbotron anchors the central battle pitch's lighting and atmosphere (floodlight towers were removed in favor of this — don't reintroduce them).
   - Smooth bone/joint animations for idle breathing, attack lunges, and flinching.

2. **Stadium UI Conventions**:
   - Always style menus with authentic Pokémon Stadium aesthetics:
     - **Metallic Plate Headers**: High-contrast blue/gold brushed tournament banners.
     - **Announcer Banners**: Big bold yellow/red angled text popups accompanied by synthesized voice callouts.
     - **Floating Health Bars**: 3D billboards floating directly above creeps with color-coded HP percentages (Green > 50%, Yellow 20-50%, Red < 20%).

3. **Multi-Camera Direction**:
   - **Tactical View (`Key 1`)**: Elevated top-down view ideal for tower placement and lane visibility.
   - **Isometric View (`Key 2`)**: Panoramic colosseum overview.
   - **Action Cam (`Key 3`)**: Dynamic close-up camera focusing on critical hits and intense tower attacks.

---

## 📸 Visual Self-Critique & Headless Verification

Every change to 3D models, arena geometries, or UI elements should be verified using:
```bash
python3 take_screenshot.py
```
And visually inspected using `view_file` to evaluate:
- 3D model alignment on pedestals.
- Colosseum lighting and contrast.
- UI overlay legibility and command wheel positioning.

### Browser tool selection (agents)

`take_screenshot.py` and `npm run test:gameplay`/`test:maps` are headless and cost zero
LLM tokens — they are the default for any verification that doesn't require reacting to
unpredictable UI state. Reach for the `claude-in-chrome` MCP (interactive browser control)
only when the task genuinely requires seeing and reacting to live UI — e.g. exploratory
debugging of a flow whose next state you can't predict up front.

When you do use `claude-in-chrome`: each `computer` screenshot costs ~1,300-1,600 tokens
(full-viewport capture) and, unlike a one-off tool call, stays in context and gets resent
on every subsequent turn for the rest of the session — a session with ~60 screenshots can
cumulatively cost millions of tokens by the end. So minimize screenshot count: prefer
`read_page`/`get_page_text` (structural/text inspection) over `computer` when you don't
need pixels, batch what you're checking for before opening the browser, and close out the
browser task once answered rather than leaving it open for iterative back-and-forth.

If a UI flow needs *repeatable* multi-step regression coverage (not one-off debugging),
that's a signal to add a proper scripted test rather than re-driving it interactively each
time — ask before introducing new test infra (e.g. Playwright) for this, since it's a new
dependency this repo doesn't currently have.

---

## 🛠️ Web Development Commands

```bash
cd web
npm install        # Install Three.js, Vite, and TypeScript
npm run dev        # Launch local Vite dev server on http://localhost:3004
npm run build      # Typecheck and bundle production distribution
npm run test:gameplay   # Headless gameplay regression tests (node)
npm run test:maps       # Headless map-layout tests (node)
python3 take_screenshot.py  # Capture headless screenshots for visual verification
```
