# AGENTS.md — PokéStadium Developer & Agent Conventions

This repository contains two primary components:
1. **`pokestadium` C/MIPS Disassembly Base**: The reverse-engineering project of Pokémon Stadium (US 1.0) for the Nintendo 64.
2. **`web/` (`PokéStadium TD`)**: A modern 3D TypeScript + Three.js game engine kit and Tower Defense game, taking authentic Pokémon Stadium assets, environments, models, audio concepts, and UI styling.

---

## 🏗️ `web/` Project Architecture

```
stadium/
└── web/
    ├── index.html               # Stadium canvas viewport & retro CRT/scanline overlay
    ├── vite.config.ts           # Vite bundler config (port 3004)
    ├── package.json             # Three.js + TypeScript setup
    ├── take_screenshot.py       # Visual self-critique & screenshot capture script
    └── src/
        ├── engine/
        │   ├── StadiumRenderer.ts # WebGL / Three.js renderer with N64 vertex lighting & fog
        │   ├── StadiumCamera.ts   # Multi-mode camera (Tactical, Isometric, Dynamic Battle Cam)
        │   ├── StadiumAudio.ts    # Web Audio synthesizer for battle music, SFX & Announcer
        │   ├── Input.ts           # 3D raycasting, mouse pointer, keyboard shortcuts
        │   └── ParticleSystem.ts  # 3D elemental move particles
        ├── stadium/
        │   ├── TypeMatrix.ts      # 15 Gen 1 elemental types & effectiveness multipliers
        │   ├── MoveDatabase.ts    # Moves, damages, ranges, and visual effect associations
        │   ├── Announcer.ts       # Stadium Announcer callouts & trigger system
        │   ├── PokemonModels.ts   # 3D low-poly N64 Pokémon mesh generators & animation rigs
        │   └── StadiumArena.ts    # 3D Colosseum arena with Poké Ball pitch, floodlights & crowd
        ├── td/
        │   ├── Tower.ts           # 3D Pokémon defense towers, targeting, leveling, evolutions
        │   ├── Creep.ts           # 3D invading Pokémon, path traversal, status ailments
        │   ├── Projectile.ts      # 3D animated elemental projectiles
        │   ├── WaveManager.ts     # Tournament cup waves & boss encounters
        │   ├── StadiumUI.ts       # Authentic Stadium HUD: radial command wheel, banners, HP bars
        │   └── StadiumTDGame.ts   # Master game loop & tournament economy
        └── main.ts              # Entry point connecting engine and game loop
```

---

## 🎨 3D Visual & Styling Conventions

1. **N64 Aesthetic**:
   - Models must retain authentic low-poly character styling (faceted Gouraud shading, vertex coloring, and low-res retro textures).
   - Colosseum floodlights cast vibrant atmospheric beams (White, Cyan, Gold, Violet) onto the central battle pitch.
   - Smooth bone/joint animations for idle breathing, attack lunges, and flinching.

2. **Stadium UI Conventions**:
   - Always style menus with authentic Pokémon Stadium aesthetics:
     - **Metallic Plate Headers**: High-contrast blue/gold brushed tournament banners.
     - **Radial Command Wheel**: Circular action wheel around selected towers.
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
