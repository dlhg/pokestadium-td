# PokéStadium — Pokémon Stadium as a 3D Game-Engine Kit

This repository is based on [pret/pokestadium](https://github.com/pret/pokestadium), the open-source disassembly/decompilation of Pokémon Stadium (N64). All credit for the original decomp effort goes to the pret community and its contributors — the `src/`, `include/`, `yamls/`, and `tools/` directories here are that project's reverse-engineered game code.

What this repository adds is a `web/` directory that takes the systems the decomp reveals — a 3D arena renderer, skeletal animation, an elemental combat resolver, a cinematic camera director, a reactive announcer, and a late-90s tournament UI — and reimplements them as reusable, data-driven building blocks in TypeScript/Three.js, decoupled from the original battle-simulator genre. The proof-of-concept built on top of those blocks is **PokéStadium TD**, a tower defense game staged in the Stadium colosseum.

## PokéStadium TD (the web player)

```bash
cd web
npm install
npm run dev     # http://localhost:3004
npm run build   # typecheck + production bundle
```

No ROM is required to run the web player — models, sounds, and gameplay are original/procedural. If you own a legitimate copy of the game, `npm run extract:stadium` can optionally pull in real announcer audio and other ROM-derived assets for local use (see `web/ROM_ASSETS.md` if present); these extracted/copyrighted assets are gitignored and never bundled or distributed with this repo.

See `CLAUDE.md` in this repo's root for a full breakdown of the engine subsystems and how they map from the original decomp to the web reimplementation.

## The decomp (`src/`, `include/`, `yamls/`, `tools/`)

The rest of this repository is the underlying pret decomp: a WIP disassembly/decompilation of Pokémon Stadium (US) that reconstructs the original N64 source from the ROM.

It builds the following ROMs:

* pokestadium.z64: `md5: ed1378bc12115f71209a77844965ba50`

Note: To use this part of the repository, you must already have a rom for the game.

### Prerequisites

Under Debian / Ubuntu (which we recommend using), you can install them with the following commands:

```bash
sudo apt update
sudo apt install make git build-essential binutils-mips-linux-gnu python3 python3-pip python3-venv
```

**Please also ensure that the Python version installed is >3.7.**

The build process has a few python packages required that are located in `requirements.txt`.

To install them simply run in a terminal:

```bash
python3 -m pip install -r requirements.txt
```

### To use
1. Place the US Pokemon Stadium 1.0 rom into the repository's "/baseroms/us/" folder as "baserom.z64".
2. Set up tools and extract the rom: `make init`
3. Re-assemble the rom: `make`

For contacts and other pret projects, see [pret.github.io](https://pret.github.io/).
