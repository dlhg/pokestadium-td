#!/usr/bin/env python3
"""Report why the web game will or won't use extracted Pokémon Stadium assets.

Runs before `npm run dev` / `npm run build`. The browser falls back to
procedural models without saying why, so this prints the one thing that is
wrong: no ROM found nearby, a ROM that isn't USA Rev 2, a valid ROM that
hasn't been extracted yet, or generated assets from a different ROM.
With --extract-if-missing, a valid ROM whose models are missing or stale is
extracted on the spot (a one-time ~40 s, stdlib-only run). Never fails the
command it runs in front of.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'web/tools/stadium_pipeline'))
from rom import Rom, find_rom, n64_images  # noqa: E402

MANIFEST = ROOT / 'web/public/generated/stadium/manifest.json'
# pret/pokestadium's build target (baseroms/us/checksum.md5), a common mix-up.
KNOWN_MD5 = {'ed1378bc12115f71209a77844965ba50': 'Pokémon Stadium (USA) Rev 0'}


def say(lines: list[str]) -> None:
    print('\n'.join(['', '[stadium assets] ' + lines[0], *('  ' + line for line in lines[1:]), '']))


def extract(reason: str, rom_path: Path) -> None:
    say([f'{reason} -- extracting models now (one time, about a minute)...'])
    script = ROOT / 'web/tools/extract_stadium_assets.py'
    result = subprocess.run([sys.executable, str(script), f'--rom={rom_path}'], stdout=subprocess.DEVNULL)
    if result.returncode == 0 and MANIFEST.is_file():
        print('[stadium assets] Extraction finished; ROM models will load.')
    else:
        say([f'Extraction failed (exit {result.returncode}) -- using procedural models.',
             'See the error above, or run from web/:  npm run extract:stadium'])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--extract-if-missing', action='store_true')
    args = parser.parse_args()

    images = n64_images()
    if not images:
        say([f'No ROM found -- using procedural models.',
             f'Drop a Pokémon Stadium (USA) Rev 2 dump anywhere under {ROOT / "baseroms"} '
             '(any filename works -- only the contents are checked).'])
        return 0

    rom_path = find_rom()
    if rom_path is None:
        lines = ['No supported ROM found among what\'s here -- using procedural models.']
        for path in images:
            try:
                Rom(path)
            except ValueError as error:
                md5 = hashlib.md5(path.read_bytes()).hexdigest()
                known = KNOWN_MD5.get(md5)
                lines.append(str(error) + (f' ({known})' if known else ''))
        say(lines)
        return 0

    try:
        rom = Rom(rom_path)
    except OSError as error:
        say([f'Could not read {rom_path}: {error}'])
        return 0

    if not MANIFEST.is_file():
        if args.extract_if_missing:
            extract('ROM is valid, but its models have not been extracted', rom_path)
            return 0
        say([
            'ROM is valid, but its models have not been extracted -- using procedural models.',
            'Run this once from web/:  npm run extract:stadium',
        ])
        return 0

    try:
        extracted_md5 = json.loads(MANIFEST.read_text()).get('romMd5')
    except (OSError, ValueError) as error:
        say([f'{MANIFEST} is unreadable ({error}).', 'Re-run from web/:  npm run extract:stadium'])
        return 0
    if extracted_md5 != rom.md5:
        if args.extract_if_missing:
            extract(f'{MANIFEST.name} was generated from a different ROM', rom_path)
            return 0
        say([
            f'{MANIFEST.name} was generated from a different ROM (MD5 {extracted_md5}).',
            'Re-run from web/:  npm run extract:stadium',
        ])
        return 0

    print(f'[stadium assets] ROM verified ({rom_path}) and extracted models found.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
