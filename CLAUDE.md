# stadium — Pokémon Stadium as a 3D Game-Engine Kit

## Goal

Use `pokestadium` (the pret disassembly/decompilation of Pokémon Stadium for Nintendo 64) as a set of **building blocks for 3D games in other genres**. The N64 engine underneath is a high-performance 3D battle and colosseum engine: a 3D arena environment system, a low-poly skeletal/joint animation system, a turn-based elemental combat resolver, a dynamic cinematic camera director, an announcer speech & reaction system, and a distinctive late-90s tournament UI. Each subsystem is separable and data-driven.

## Repo Structure

```
stadium/
├── baseroms/us/            # Place baserom.z64 here for ROM disassembly
├── include/                # N64 OS, graphics, and engine C header files
├── src/                    # Decompiled C source code (stage_loader, geo_layout, controller, etc.)
├── yamls/us/               # Splat disassembly configurations and ROM segment mappings
├── tools/                  # Asset unpackers, Yay0 decompressors, F3DEX2 disassemblers
├── CLAUDE.md               # This architecture and developer reference
├── AGENTS.md               # Agent conventions for 3D engine and TD game development
└── web/                    # Modern 3D Web Player & Stadium Engine Kit ("PokéStadium TD")
    ├── index.html          # WebGL canvas container and Stadium UI shell
    ├── package.json        # Vite, Three.js, TypeScript dependencies
    ├── take_screenshot.py  # Headless Chrome visual verification script
    └── src/
        ├── engine/         # Reusable 3D Game Engine (Renderer, Camera, Audio, Input, Particles)
        ├── stadium/        # Decomposed Pokémon Stadium systems (TypeMatrix, Moves, Models, Arena, Announcer)
        └── td/             # Tower Defense implementation (Tower, Creep, Projectiles, Waves, UI)
```

## Engine Subsystems by Genre Reusability

- **`web/src/stadium/StadiumArena.ts`** — *Iconic 3D Colosseum Environment.* Multi-tier stadium stands, floodlight towers with dynamic spotlights, central Poké Ball battle pitch, perimeter safety barriers, and animated jumbotrons. Highly reusable for arena combat, fighting games, or tactical defense.
- **`web/src/stadium/PokemonModels.ts`** — *Low-Poly 3D Character Models & Animations.* Authentic N64-proportioned geometries (Pikachu, Charizard, Blastoise, Venusaur, Gengar, Alakazam, Mewtwo, Snorlax, etc.) with joint hierarchies, idle breathing, attack animations, and hit reactions.
- **`web/src/stadium/TypeMatrix.ts`** — *Elemental Combat Matrix.* Complete 15-type Gen 1 effectiveness table (2x Super Effective, 0.5x Not Very Effective, 0x Immune).
- **`web/src/stadium/MoveDatabase.ts`** — *Data-Driven Move System.* 42 moves covering damage, ranges, cooldowns, status conditions (Burn, Freeze, Paralyze, Stun, Poison), and 3D visual FX bindings. Towers purchase these individually through the move lines defined in `td/Tower.ts`.
- **`web/src/stadium/Announcer.ts`** — *Dynamic Stadium Announcer.* Real-time reactive commentary ("WHAT A HIT!", "IT'S SUPER EFFECTIVE!", "DOWN IT GOES!") with 3D banner overlays and synthesized speech.
- **`web/src/engine/StadiumCamera.ts`** — *Cinematic Multi-Angle Director.* Smooth transitions between Tactical Top-Down, Stadium Isometric, and Dramatic Action Battle Cams.
- **`web/src/td/StadiumUI.ts`** — *90s Stadium Presentation.* Tower move-shop panel (three buyable move lines with tier pips, evolution track, sell footer), metallic tournament headers, 3D floating HP bars, and tower selection decks.

## Web Development Commands

```bash
cd web
npm install        # Install Three.js, Vite, and TypeScript
npm run dev        # Launch local Vite dev server on http://localhost:3004
npm run build      # Typecheck and bundle production distribution
python3 take_screenshot.py  # Capture headless screenshots for visual verification
```
