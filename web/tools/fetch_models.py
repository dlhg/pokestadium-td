#!/usr/bin/env python3
"""
fetch_models.py — Authentic 3D Pokémon Model Downloader

Downloads optimized .glb 3D character models and skeletal animation rigs
directly into web/public/models/ for use in PokéStadium TD.
"""

import os
import sys
import urllib.request

MODELS = {
    # Towers & Evolutions
    'pikachu': 25,
    'raichu': 26,
    'charmander': 4,
    'charmeleon': 5,
    'charizard': 6,
    'squirtle': 7,
    'wartortle': 8,
    'blastoise': 9,
    'bulbasaur': 1,
    'ivysaur': 2,
    'venusaur': 3,
    'gastly': 92,
    'haunter': 93,
    'gengar': 94,
    'abra': 63,
    'kadabra': 64,
    'alakazam': 65,

    # Creeps & Bosses
    'rattata': 19,
    'zubat': 41,
    'geodude': 74,
    'onix': 95,
    'gyarados': 130,
    'dragonair': 148,
    'dragonite': 149,
    'mewtwo': 150,
}

BASE_URL = "https://raw.githubusercontent.com/Pokemon-3D-api/assets/main/models/opt/regular/{dex}.glb"

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    web_dir = os.path.dirname(script_dir)
    out_dir = os.path.join(web_dir, "public", "models")
    os.makedirs(out_dir, exist_ok=True)

    print(f"📦 Downloading authentic 3D models into: {out_dir}")
    print("=" * 60)

    success_count = 0
    for name, dex in MODELS.items():
        dest = os.path.join(out_dir, f"{name}.glb")
        if os.path.exists(dest):
            print(f"  ✓ {name} (#{dex}) already exists ({os.path.getsize(dest):,} bytes)")
            success_count += 1
            continue

        url = BASE_URL.format(dex=dex)
        try:
            print(f"  ⬇ Downloading {name} (#{dex})...")
            urllib.request.urlretrieve(url, dest)
            size = os.path.getsize(dest)
            print(f"  ✓ Saved {name}.glb ({size:,} bytes)")
            success_count += 1
        except Exception as e:
            print(f"  ✗ Failed {name}: {e}")

    print("=" * 60)
    print(f"✨ Successfully synchronized {success_count}/{len(MODELS)} models!")

if __name__ == "__main__":
    main()
