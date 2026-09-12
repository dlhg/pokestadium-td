#!/usr/bin/env python3
"""Build the local Pokémon Stadium announcer pack from the player's Rev 2 ROM.

No game data is downloaded or committed.  The MORT decoder source is fetched
once from a pinned MIT-licensed revision, compiled locally, and cached outside
the generated asset directory.  Missing prerequisites are non-fatal so Vite
can continue with browser-speech fallback.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'web/tools/stadium_pipeline'))
from rom import Rom  # noqa: E402

ROM_PATH = ROOT / 'baseroms/us/Pokemon Stadium (USA) (Rev 2).z64'
OUTPUT = ROOT / 'web/public/generated/stadium/audio/announcer'
CACHE = ROOT / 'web/.cache/stadium-audio'
DECODER = CACHE / 'mort_decoder'
REFERENCE_URL = 'https://github.com/anxiousintrovert/StadiumBattleFX.git'
REFERENCE_REVISION = '0c6e004b3d49339e3027eb4ad2ea8ec5b4a0b765'
SPEECH_ARCHIVE = 0x19711E0
CLIP_COUNT = 823


def u32(data: bytes, offset: int) -> int:
    return int.from_bytes(data[offset:offset + 4], 'big')


def collect_mort(data: bytes) -> list[tuple[int, int]]:
    clips: list[tuple[int, int]] = []

    def visit(offset: int, length: int | None) -> None:
        magic = data[offset:offset + 4]
        if magic[:2] == b'S1':
            count = int.from_bytes(magic[2:4], 'big')
            table_size = 4 + count * 8
            if not 0 < count < 2048 or (length is not None and table_size > length):
                raise ValueError(f'invalid S1 archive at {offset:#x}')
            for index in range(count):
                entry = offset + 4 + index * 8
                relative, child_length = u32(data, entry), u32(data, entry + 4)
                if relative < table_size or (length is not None and relative + child_length > length):
                    raise ValueError(f'S1 child {index} is outside its parent')
                visit(offset + relative, child_length)
            return
        if length is None or magic != b'MORT' or u32(data, offset + 8) * 4 != length:
            raise ValueError(f'expected MORT stream at {offset:#x}')
        if int.from_bytes(data[offset + 6:offset + 8], 'big') != 16000:
            raise ValueError(f'unexpected MORT sample rate at {offset:#x}')
        clips.append((offset, length))

    visit(SPEECH_ARCHIVE, None)
    if len(clips) != CLIP_COUNT:
        raise ValueError(f'expected {CLIP_COUNT} announcer clips, found {len(clips)}')
    return clips


def run(command: list[str], cwd: Path | None = None) -> None:
    subprocess.run(command, cwd=cwd, check=True, stdout=subprocess.DEVNULL)


def ensure_decoder() -> Path:
    if DECODER.is_file():
        return DECODER
    if not shutil.which('git') or not shutil.which('g++'):
        raise RuntimeError('git and g++ are required for the one-time local MORT decoder build')
    CACHE.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='stadium-mort-source-') as temporary:
        checkout = Path(temporary) / 'reference'
        run(['git', 'clone', '--quiet', REFERENCE_URL, str(checkout)])
        run(['git', 'checkout', '--quiet', '--detach', REFERENCE_REVISION], checkout)
        actual = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=checkout, text=True).strip()
        if actual != REFERENCE_REVISION:
            raise RuntimeError(f'unexpected MORT decoder revision {actual}')
        source = checkout / 'tools/mort_decoder'
        run(['g++', '-std=c++17', '-O2', '-o', str(DECODER), str(source / 'main.cpp'), str(source / 'MORTDecoder.cpp')])
    return DECODER


def extract() -> None:
    rom = Rom(ROM_PATH)
    clips = collect_mort(rom.data)
    decoder = ensure_decoder()
    with tempfile.TemporaryDirectory(prefix='stadium-mort-clips-') as temporary:
        mort_dir = Path(temporary) / 'mort'
        wav_dir = Path(temporary) / 'wav'
        mort_dir.mkdir()
        wav_dir.mkdir()
        for index, (offset, length) in enumerate(clips):
            (mort_dir / f'stadium_mort_{index:03d}.mort').write_bytes(rom.data[offset:offset + length])
        run([str(decoder), '--batch', str(mort_dir), str(wav_dir)])
        staging = OUTPUT.with_name(f'{OUTPUT.name}.staging')
        shutil.rmtree(staging, ignore_errors=True)
        shutil.copytree(wav_dir, staging)
        (staging / 'manifest.json').write_text(json.dumps({
            'version': 1, 'romMd5': rom.md5, 'archiveOffset': hex(SPEECH_ARCHIVE),
            'clipCount': CLIP_COUNT, 'sampleRate': 16000,
        }, indent=2) + '\n')
        shutil.rmtree(OUTPUT, ignore_errors=True)
        staging.replace(OUTPUT)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--if-missing', action='store_true')
    args = parser.parse_args()
    if (OUTPUT / 'manifest.json').is_file() and args.if_missing:
        return 0
    if not ROM_PATH.is_file():
        print('Stadium announcer: local ROM not found; using browser-speech fallback.')
        return 0
    try:
        extract()
        print(f'Stadium announcer: extracted {CLIP_COUNT} original clips locally.')
    except (OSError, RuntimeError, ValueError, subprocess.CalledProcessError) as error:
        print(f'Stadium announcer: {error}; using browser-speech fallback.', file=sys.stderr)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
