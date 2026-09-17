#!/usr/bin/env python3
"""Build private web assets from a verified Pokemon Stadium USA Rev 2 ROM.

The default exports all 151 Pokémon plus Brock's Gym Leader Castle room.
Use --only-pikachu for a quick extraction smoke test. Generated files are
written under web/public/generated/stadium/, which is intentionally gitignored.
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
DEFAULT_OUTPUT = ROOT / 'web/public/generated/stadium'
ARCHIVES = {
    'battle_portraits': (0x535260, 54),
    'stadium_models': (0x56FF10, 18),
    'pokemon_models': (0x919000, 215),
}

# The second compressed bank in common_menu2_ui contains the 20x20 RGBA5551
# type tiles used by Stadium's out-of-battle move previews. The internal type
# table is sparse (and includes the unused Bird type), so keep the explicit
# addresses documented by the original game's UI table rather than relying on
# enum order.
TYPE_BADGE_BANK = 0x4C1298
TYPE_BADGE_OFFSETS = {
    'normal': 0x17740,
    'fire': 0x17A60,
    'water': 0x17D80,
    'ice': 0x180A0,
    'grass': 0x183C0,
    'electric': 0x186E0,
    'rock': 0x18A00,
    'ground': 0x18D20,
    'fighting': 0x19040,
    'bug': 0x19360,
    'poison': 0x19680,
    'flying': 0x199A0,
    'psychic': 0x19CC0,
    'ghost': 0x19FE0,
    'dragon': 0x1A300,
}


def type_badge_bank(source: rom.Rom) -> bytes:
    return rom.yay0_decompress(source.data[TYPE_BADGE_BANK:])


def rgba5551(raw: bytes) -> bytes:
    rgba = bytearray()
    for i in range(0, len(raw), 2):
        value = int.from_bytes(raw[i:i + 2], 'big')
        rgba.extend((
            ((value >> 11) & 0x1F) * 255 // 31,
            ((value >> 6) & 0x1F) * 255 // 31,
            ((value >> 1) & 0x1F) * 255 // 31,
            (value & 1) * 255,
        ))
    return bytes(rgba)


def export_type_badges(source: rom.Rom, output: Path) -> list[str]:
    bank = type_badge_bank(source)
    badge_dir = output / 'ui/type-badges'
    badge_dir.mkdir(parents=True, exist_ok=True)
    urls = []
    for name, offset in TYPE_BADGE_OFFSETS.items():
        raw = bank[offset:offset + 20 * 20 * 2]
        if len(raw) != 20 * 20 * 2:
            raise ValueError(f'{name} type badge exceeds the common menu UI bank')
        path = badge_dir / f'{name}.png'
        path.write_bytes(fragment.png(20, 20, rgba5551(raw)))
        urls.append(f'ui/type-badges/{name}.png')
    return urls


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

    badge_bank = type_badge_bank(source)
    if any(offset + 20 * 20 * 2 > len(badge_bank) for offset in TYPE_BADGE_OFFSETS.values()):
        raise ValueError('type badge table exceeds the common menu UI bank')

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
        'typeBadges': {
            'count': len(TYPE_BADGE_OFFSETS), 'format': '20x20 RGBA5551',
            'bankOffset': f'0x{TYPE_BADGE_BANK:X}',
        },
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
    parser.add_argument('--rom', type=Path, default=None,
                         help='Defaults to whatever validates near baseroms/ -- filename does not matter.')
    parser.add_argument('--out', type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument('--venue', choices=sorted(arena.VENUE_MEMBERS), default='brock')
    parser.add_argument('--all-pokemon', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--only-pikachu', action='store_true')
    parser.add_argument('--validate-only', action='store_true')
    args = parser.parse_args()

    rom_path = args.rom or rom.find_rom()
    if rom_path is None:
        print(
            f'No Pokémon Stadium (USA) Rev 2 ROM found under {ROOT / "baseroms"} '
            f'(size {rom.ROM_SIZE:,} bytes, MD5 {rom.US_REV2_MD5}) -- a '
            f'different revision or region will not work, but any filename does. '
            f'See web/ROM_ASSETS.md.',
            file=sys.stderr,
        )
        return 1

    try:
        source = rom.Rom(rom_path)
    except ValueError as error:
        print(error, file=sys.stderr)
        return 1
    args.rom = rom_path
    report = validate(source)
    print(json.dumps(report, indent=2))
    if args.validate_only:
        return 0

    # A smoke test must not replace the live 151-species manifest with its
    # one-species result. Keep its output in a separate generated subtree.
    output = args.out / 'smoke/pikachu' if args.only_pikachu else args.out
    # 174 is the "Run! Rattata, Run!" minigame's own Rattata rig (see
    # stadium_pipeline/build.py's EXTRA_NAMES) -- the only extra model the web
    # player actually uses, for its run cycle.
    model_args = [f'--rom={args.rom}', f'--out={output}', '--no-js', '--no-effects', '--pokemon-only', '--also=174']
    if args.only_pikachu:
        model_args.append('--only=24')
    build.main(model_args)

    output.mkdir(parents=True, exist_ok=True)
    type_badges = export_type_badges(source, output)
    member = arena.VENUE_MEMBERS[args.venue]
    payload, groups, fragment_bytes = arena.convert_member(source, member)
    arena_name = f'member_{member:02d}_{args.venue}.sna'
    (output / arena_name).write_bytes(payload)

    manifest_path = output / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    manifest['validation'] = report
    manifest['typeBadges'] = type_badges
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
    print(f'wrote {output / arena_name} ({groups} material groups)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
