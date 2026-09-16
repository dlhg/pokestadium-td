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

No ROM is required to run the web player — models, sounds, and gameplay are original/procedural.

If you own a legitimate copy of the game and want real announcer audio and models instead of the procedural fallback, `npm run extract:stadium` (run from `web/`) can pull those in locally. This needs a **specific ROM dump**, placed at an **exact path**:

```
baseroms/us/Pokemon Stadium (USA) (Rev 2).z64
```

This is Pokémon Stadium **(USA) Revision 2** — a different, later cartridge printing than the US Revision 0 ROM the decomp section below uses for `make init`. The two are not interchangeable: dropping the decomp's `baserom.z64` in for this, or any other region/revision, will not work. If the file is missing or doesn't match, the script exits with a clear message rather than doing anything silently; see `web/ROM_ASSETS.md` for the exact size/hash and how validation works. Extracted/copyrighted assets are gitignored and never bundled or distributed with this repo.

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
