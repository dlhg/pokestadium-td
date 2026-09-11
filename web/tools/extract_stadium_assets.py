#!/usr/bin/env python3
"""Build private web assets from a verified Pokemon Stadium USA Rev 2 ROM.

The default is the vertical slice: Pikachu plus Brock's Gym Leader Castle room.
Pass --all-pokemon after that slice is working. Generated files are written
under web/public/generated/stadium/, which is intentionally gitignored.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

PIPELINE = Path(__file__).resolve().parent / 'stadium_pipeline'
sys.path.insert(0, str(PIPELINE))

import arena  # noqa: E402
import battle  # noqa: E402
import build  # noqa: E402
import fragment  # noqa: E402
import rom  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_ROM = ROOT / 'baseroms/us/Pokemon Stadium (USA) (Rev 2).z64'
DEFAULT_OUTPUT = ROOT / 'web/public/generated/stadium'
ARCHIVES = {
    'battle_portraits': (0x535260, 54),
    'stadium_models': (0x56FF10, 18),
    'pokemon_models': (0x919000, 215),
}


def validate(source: rom.Rom) -> dict:
    report = {'romMd5': source.md5, 'archives': {}}
    archives = {}
    for name, (offset, expected_count) in ARCHIVES.items():
        members = source.archive(offset)
        if len(members) != expected_count:
            raise ValueError(f'{name}: expected {expected_count} members, found {len(members)}')
        wrappers = sum(blob[:8] == b'PERS-SZP' for blob in members)
        direct_fragments = sum(blob[8:16] == b'FRAGMENT' for blob in members)
        if wrappers + direct_fragments != len(members):
            raise ValueError(f'{name}: member has neither PERS-SZP nor FRAGMENT structure')
        archives[name] = members
        report['archives'][name] = {
            'offset': f'0x{offset:X}', 'members': len(members),
            'size': source.u32(offset + 8), 'persSzpMembers': wrappers,
            'directFragmentMembers': direct_fragments,
        }

    portrait = rom.decompress(archives['battle_portraits'][0])
    if len(portrait) != 64 * 64 * 2:
        raise ValueError('representative battle portrait is not a 64x64 RGBA5551 image')

    stage = rom.decompress(archives['stadium_models'][arena.VENUE_MEMBERS['brock']])
    if stage[8:16] != b'FRAGMENT':
        raise ValueError("Brock's mapped stadium member is not a FRAGMENT")

    pikachu = rom.decompress(archives['pokemon_models'][24])
    extracted = fragment.extract(pikachu, 'pokemon_models/24.bin')
    if extracted['species'] != 25:
        raise ValueError(f'pokemon_models member 24 is species {extracted["species"]}, not Pikachu')
    tables = battle.BattleTables(source)
    pointer_values = [
        source.u32(tables.ptr_table + index * 4) & 0xFFFFFF
        for index in range(151)
    ]
    expected_pointers = [index * battle.STRIDE for index in range(151)]
    if pointer_values != expected_pointers:
        raise ValueError('Rev 2 per-species battle pointer table failed its fixed-stride check')
    all_rows = [tables.rows(species) for species in range(1, 152)]
    if any(rows[165][0] != 0 for rows in all_rows):
        raise ValueError('Rev 2 idle animation slot does not resolve to animation 0')
    if sum(rows[166][0] == 2 for rows in all_rows) != 149:
        raise ValueError('Rev 2 default-attack slot does not match the known 149/151 signature')
    rows = all_rows[24]
    max_animation = len(extracted['anims']) - 1
    if any(animation > max_animation for animation, _ in rows):
        raise ValueError("Pikachu's battle table references a missing animation")
    report['representatives'] = {
        'portrait0': {'bytes': len(portrait), 'format': '64x64 RGBA5551'},
        'stadiumMember7': {'venue': 'brock', 'bytes': len(stage), 'magic': 'FRAGMENT'},
        'pokemonMember24': {
            'species': 25, 'name': 'Pikachu', 'bytes': len(pikachu),
            'bones': len(extracted['bones']), 'animations': len(extracted['anims']),
        },
    }
    report['battleTables'] = {
        'dataOffset': f'0x{rom.BATTLE_DATA:X}',
        'pointerTableRomOffset': f'0x{tables.ptr_table:X}',
        'species': 151,
        'stride': battle.STRIDE,
        'idleSlotZeroCount': 151,
        'defaultAttackSlotTwoCount': 149,
    }
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rom', type=Path, default=DEFAULT_ROM)
    parser.add_argument('--out', type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument('--venue', choices=sorted(arena.VENUE_MEMBERS), default='brock')
    parser.add_argument('--all-pokemon', action='store_true')
    parser.add_argument('--validate-only', action='store_true')
    args = parser.parse_args()

    source = rom.Rom(args.rom)
    report = validate(source)
    print(json.dumps(report, indent=2))
    if args.validate_only:
        return 0

    model_args = [f'--rom={args.rom}', f'--out={args.out}', '--no-js', '--no-effects']
    if not args.all_pokemon:
        model_args.append('--only=24')
    build.main(model_args)

    args.out.mkdir(parents=True, exist_ok=True)
    member = arena.VENUE_MEMBERS[args.venue]
    payload, groups, fragment_bytes = arena.convert_member(source, member)
    arena_name = f'member_{member:02d}_{args.venue}.sna'
    (args.out / arena_name).write_bytes(payload)

    manifest_path = args.out / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    manifest['validation'] = report
    manifest['arenas'] = [{
        'id': args.venue,
        'name': f'{args.venue.title()} Gym Leader Castle room',
        'member': member,
        'format': 'SNA2',
        'url': arena_name,
        'groups': groups,
        'sourceFragmentBytes': fragment_bytes,
        'nativeScale': 0.1,
        'coordinateTransform': '[x,y,z] -> [z,y,-x]',
    }]
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'wrote {manifest_path}')
    print(f'wrote {args.out / arena_name} ({groups} material groups)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
