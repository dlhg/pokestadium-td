# PokéStadium — Pokémon Stadium as a 3D Game-Engine Kit

This repository is based on [pret/pokestadium](https://github.com/pret/pokestadium), the open-source disassembly/decompilation of Pokémon Stadium (N64). All credit for the original decomp effort goes to the pret community and its contributors — the `src/`, `include/`, `yamls/`, and `tools/` directories here are that project's reverse-engineered game code.

What this repository adds is a `web/` directory that takes the systems the decomp reveals — a 3D arena renderer, skeletal animation, an elemental combat resolver, a cinematic camera director, a reactive announcer, and a late-90s tournament UI — and reimplements them as reusable, data-driven building blocks in TypeScript/Three.js, decoupled from the original battle-simulator genre. The proof-of-concept built on top of those blocks is **PokéStadium TD**, a tower defense game staged in the Stadium colosseum.

## Running the web game

1. `cd web && npm install`
2. `npm run dev` — starts the dev server at http://localhost:3004 (`npm run build` for a typechecked production bundle instead)

That's it — no ROM is required. Models, sounds, and gameplay are original/procedural by default.

### Optional: real models and announcer audio

If you own a legitimate copy of the game, drop a **Pokémon Stadium (USA) Revision 2** ROM dump anywhere under `baseroms/` — any filename works, only the file's contents are checked. The next `npm run dev` or `npm run build` finds it, verifies it, and extracts the models and announcer clips automatically (one time, about a minute; needs Python 3, plus `git` and `g++` the first time for the announcer decoder). To trigger it manually: `npm run extract:stadium` from `web/`.

Note this is **Revision 2**, not the Revision 0 ROM the decomp section below uses — they're different dumps for two unrelated things in this repo (see below). If extraction doesn't kick in, the `[stadium assets]` line printed at startup says why (no ROM found, wrong revision, or failed extraction) — the browser console logs the same reason. Full details, hashes, and validation behavior: `web/ROM_ASSETS.md`. Extracted/copyrighted assets are gitignored and never bundled or distributed with this repo.

See `CLAUDE.md` in this repo's root for a full breakdown of the engine subsystems and how they map from the original decomp to the web reimplementation.

## The decomp (`src/`, `include/`, `yamls/`, `tools/`)

Unrelated to running the web game above — skip this unless you want to rebuild the original N64 ROM from source.

The rest of this repository is the underlying pret decomp: a WIP disassembly/decompilation of Pokémon Stadium (US) that reconstructs the original N64 source from the ROM. It builds `pokestadium.z64` (`md5: ed1378bc12115f71209a77844965ba50`), and needs its own ROM dump to do it — a different one from the web game's, see above.

### Prerequisites

Python 3.7+, plus `make`, `git`, a C build toolchain, and `binutils-mips-linux-gnu`. Example install on Debian/Ubuntu:

```bash
sudo apt update
sudo apt install make git build-essential binutils-mips-linux-gnu python3 python3-pip python3-venv
```

Then install the required Python packages:

```bash
python3 -m pip install -r requirements.txt
```

### To use
1. Place a US Pokémon Stadium **Revision 0** ROM into `baseroms/us/` as `baserom.z64`.
2. Set up tools and extract the rom: `make init`
3. Re-assemble the rom: `make`

For contacts and other pret projects, see [pret.github.io](https://pret.github.io/).
