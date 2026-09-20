#!/usr/bin/env python3
"""
End-to-end Rev 2 export: verified ROM -> glb / textures / manifests.

    web/tools/stadium_pipeline/build.py [--rom PATH] [--out DIR] [options]

Stdlib only. Nothing here needs `make init`, splat or crunch64 -- the ROM is
read, decompressed and parsed directly.

Options:
    --no-js        skip the viewer payloads and viewer.html
    --no-glb       skip the glTF binaries and PNG dumps
    --no-effects   skip the generated fire/gas stand-ins
    --only N[,N]   restrict to these model file numbers (for quick iteration)
"""
import base64
import collections
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
WEB_ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
REPO = os.path.abspath(os.path.join(WEB_ROOT, '..'))

import battle
import effects as fx_gen
import fragment
import glb as glb_mod
import rom as rom_mod

N_POKEMON = 151
EXTRA_NAMES = {
    151: 'Substitute Doll',
    152: 'Surfing Pikachu',
    154: 'Kakuna (minigame)',
    155: 'Boulder',
    157: 'Metapod (minigame)',
    158: 'Ekans (minigame)',
    159: 'Lickitung (minigame)',
    160: 'Sandshrew (minigame)',
    162: 'Diglett Hole',
    163: 'Diglett (minigame)',
    164: 'Lidded Cup Trophy',
    165: 'Cup Trophy',
    166: 'Poké Ball Display A',
    167: 'Poké Ball Display B',
    168: 'Poké Ball Display C',
    169: 'Master Ball Display',
    171: 'Boulder (minigame)',
    172: 'Magikarp (minigame)',
    # Identified by byte-for-byte matching texture 00 (the body material) against
    # 019_rattata's own: both average to RGB (156, 106, 197), and the teeth strip
    # (a distinctive 3-tooth cutout) is pixel-identical too. This is the separate,
    # simplified 34-bone rig (the battle model has 43) driving "Run! Rattata, Run!",
    # fragment8's minigame -- that code is still mostly un-decompiled, so this ID
    # rests on the texture match plus anim 1's motion (see EXTRA_ANIM_NAMES below).
    174: 'Rattata (Run! Rattata, Run! minigame)',
    176: 'Clefairy Student',
    177: 'Clefairy Teacher',
    178: 'Clefairy Says Classroom',
    194: 'Fishing Line',
    195: 'Drowzee (minigame)',
    196: 'Pikachu (minigame)',
    197: 'Voltorb (minigame)',
    213: 'Mewtwo (cinematic)',
}
# Per-extra-model animation names, keyed by the model's own local anim index.
# Only clip 1 here is confidently identified: it is the sole anim with the 0x8
# flag bit (unique among this model's 6 clips), it wraps (loops) over a tight 15
# frames, and its leg-chain bones (indices 2-10 and their mirrors 29-33) swing
# through a full sinusoidal cycle in bounding-gait phase (left/right pairs near
# in-phase, front/back pairs offset) -- a running gait, not the idle's single
# slow settle. The rest are left as anim0/anim2../anim5 pending further work.
EXTRA_ANIM_NAMES = {174: {1: 'run'}}

# The explicit default is intentionally the verified Rev 2 filename. A caller
# may supply a different path, but Rom still requires the exact supported MD5.
BASEROMS = os.path.join(os.path.dirname(HERE), 'baseroms')
ROM_CANDIDATES = [os.path.join(
    REPO, 'baseroms', 'us', 'Pokemon Stadium (USA) (Rev 2).z64')]


def find_rom():
    for p in ROM_CANDIDATES:
        if os.path.exists(p):
            return p
    if os.path.isdir(BASEROMS):                 # any ROM dropped in the folder
        for f in sorted(os.listdir(BASEROMS)):
            if f.lower().endswith(('.z64', '.n64', '.v64')):
                return os.path.join(BASEROMS, f)
    return None


# --------------------------------------------------------------- bind extent

def pose_matrices(data, pose=None):
    """Per-bone skinning matrices in model space. `pose(i, bone)` returns the
    (t, r, s) to use for bone i; the bind values are used when it is omitted."""
    def trs(t, r, s):
        S = lambda v: math.sin(v / 32768 * math.pi)
        C = lambda v: math.cos(v / 32768 * math.pi)
        sx, cx = S(r[0]), C(r[0]); sy, cy = S(r[1]), C(r[1]); sz, cz = S(r[2]), C(r[2])
        return [cy*cz*s[0], cy*sz*s[0], -sy*s[0], 0,
                (sx*sy*cz-cx*sz)*s[1], (sx*sy*sz+cx*cz)*s[1], sx*cy*s[1], 0,
                (cx*sy*cz+sx*sz)*s[2], (cx*sy*sz-sx*cz)*s[2], cx*cy*s[2], 0,
                t[0], t[1], t[2], 1]

    def mul(a, b):
        r = [0]*16
        for c in range(4):
            for i in range(4):
                r[c*4+i] = a[i]*b[c*4] + a[4+i]*b[c*4+1] + a[8+i]*b[c*4+2] + a[12+i]*b[c*4+3]
        return r

    root = trs([0, 0, 0], [0, 0, 0], data['rootScale'])
    acc, uns, mats = [], [], []
    for i, b in enumerate(data['bones']):
        t, r, s = pose(i, b) if pose else (b['t'], b['r'], b['s'])
        pa = acc[b['parent']] if b['parent'] >= 0 else [1.0, 1.0, 1.0]
        pu = uns[b['parent']] if b['parent'] >= 0 else root
        u = mul(pu, trs([t[k]*pa[k] for k in range(3)], r, [1, 1, 1]))
        a = [pa[k]*s[k] for k in range(3)]
        m = list(u)
        for k in range(4):
            m[k] *= a[0]; m[4+k] *= a[1]; m[8+k] *= a[2]
        acc.append(a); uns.append(u); mats.append(m)
    return mats


def posed_vertices(data, mats):
    """Model-space positions of every extracted (non-generated) vertex."""
    for p in data['prims']:
        if p.get('generated'):
            continue
        for i, bi in enumerate(p['skin']):
            m = mats[bi]
            x, y, z = p['pos'][i*3:i*3+3]
            yield (m[0]*x+m[4]*y+m[8]*z+m[12], m[1]*x+m[5]*y+m[9]*z+m[13],
                   m[2]*x+m[6]*y+m[10]*z+m[14])


def bind_extent(data):
    """World-space bounding box of the bind pose, used to size the effects."""
    mats = pose_matrices(data)
    lo = [1e9]*3; hi = [-1e9]*3
    for w in posed_vertices(data, mats):
        for k in range(3):
            lo[k] = min(lo[k], w[k]); hi[k] = max(hi[k], w[k])
    # height, not the largest dimension: sizing off the max would scale Moltres'
    # flames to its wingspan
    extent = (hi[1] - lo[1]) if lo[0] <= hi[0] else 1.0
    # how much each bone scales its own local space, so effects can compensate
    scales = [math.sqrt(m[0]*m[0] + m[1]*m[1] + m[2]*m[2]) for m in mats]
    return extent, scales


def idle_size(data, idle_index):
    """How much room the model needs while it stands around: the vertical span
    and the ground footprint (twice the farthest horizontal reach from the model
    origin) over the bind pose and every frame of its idle loop. The game places
    models by their origin and turns them about Y, so reach from the origin, not
    box width, is what has to clear a lane edge. Generated effects are excluded."""
    poses = [None]
    if 0 <= idle_index < len(data['anims']):
        anim = data['anims'][idle_index]
        pick = lambda c, fr: c if isinstance(c, (int, float)) else c[min(fr, len(c) - 1)]

        def at(fr):
            def pose(i, b):
                tr = anim['tracks'][i]
                if not tr:
                    return b['t'], b['r'], b['s']
                return ([pick(c, fr) for c in tr['t']], [pick(c, fr) for c in tr['r']],
                        [pick(c, fr) for c in tr['s']])
            return pose
        poses += [at(fr) for fr in range(anim['frames'])]

    reach, lo, hi = 0.0, 1e9, -1e9
    for pose in poses:
        for x, y, z in posed_vertices(data, pose_matrices(data, pose)):
            reach = max(reach, x*x + z*z)
            lo = min(lo, y); hi = max(hi, y)
    if lo > hi:
        return dict(footprint=1.0, height=1.0)
    return dict(footprint=round(2 * math.sqrt(reach), 2), height=round(hi - lo, 2))


# ------------------------------------------------------------ animation names

# Which context name wins when several claim the same animation. The battle
# table points many slots at one clip, and these are the ones worth naming.
NAME_PREF = ['idle', 'attack_default', 'faint', 'entrance', 'struggle', 'flinch']


def label_animations(data, rows, moves):
    """Name each animation after what the battle table uses it for, and pair it
    with the texture animation that table most often sets alongside it.

    Mutates `data['anims']`, giving each a `name` and an `aux`, and hands back
    the per-animation context and move lists the manifest reports. Factored out
    of main() because the mod's packer (tools/stadium_pack.py) has to label them
    exactly the same way for its output to be comparable with the Lua extractor
    that reads the same ROM at runtime.
    """
    entries = [r[0] for r in rows]
    aux = [r[1] for r in rows]
    uses = [[] for _ in data['anims']]
    move_uses = [[] for _ in data['anims']]
    for e, ai in enumerate(entries):
        if ai >= len(uses):
            continue
        if e < battle.N_MOVES:
            move_uses[ai].append(moves[e + 1])
        elif e in battle.CONTEXT_SLOTS:
            uses[ai].append(battle.CONTEXT_SLOTS[e][0])
    pairs = [collections.Counter() for _ in data['anims']]
    for e, ai in enumerate(entries):
        if ai < len(pairs) and 0 <= aux[e] < len(data['auxAnims']):
            pairs[ai][aux[e]] += 1
    for i, a in enumerate(data['anims']):
        ctx = sorted(set(uses[i]))
        named = [n for n in NAME_PREF if n in ctx]
        a['name'] = (named[0] if named else 'attack' if move_uses[i]
                     else ctx[0] if ctx else f'anim{i}')
        a['aux'] = pairs[i].most_common(1)[0][0] if pairs[i] else -1
    seen = {}
    for a in data['anims']:
        n = seen.get(a['name'], 0)
        seen[a['name']] = n + 1
        if n:
            a['name'] = f'{a["name"]}_{n + 1}'
    return uses, move_uses


def attach_effects(data, species, raw=False):
    """Append generated fire/gas prims + their flipbook textures.

    `raw` matches fragment.extract's: the flipbook frames are already RGBA8, so
    they are stored as-is rather than encoded, for the packer that wants pixels.
    """
    if not data.get('fx'):
        return 0
    extent, bone_scale = bind_extent(data)
    made = fx_gen.build_for(species, data['fx'], extent, bone_scale)
    for e in made:
        first = len(data['textures'])
        for i, frame in enumerate(e['frames']):
            rec = dict(index=-1, w=e['w'], h=e['h'], generated=True)
            if raw:
                rec['rgba'] = frame
            else:
                rec['png'] = ('data:image/png;base64,' + base64.b64encode(
                    fragment.png(e['w'], e['h'], frame)).decode())
            data['textures'].append(rec)
        g = e['geo']
        data['prims'].append(dict(
            tex=first, cull=0, texAnim=-1, texMap={},
            generated=True, effect=e['kind'],
            blend='add' if e['kind'] == 'fire' else 'alpha',
            fxFrames=list(range(first, first + len(e['frames']))),
            pos=g['pos'], uv=g['uv'], nrm=g['nrm'], skin=g['skin'], idx=g['idx']))
    return len(made)


# --------------------------------------------------------------------- main

def main(argv):
    args = {a.split('=')[0]: (a.split('=', 1)[1] if '=' in a else True) for a in argv}
    rom_path = args.get('--rom') or find_rom()
    outdir = args.get('--out') or os.path.join(WEB_ROOT, 'public', 'generated', 'stadium')
    want_js = '--no-js' not in args
    want_glb = '--no-glb' not in args
    want_fx = '--no-effects' not in args
    pokemon_only = '--pokemon-only' in args
    only = {int(x) for x in args['--only'].split(',')} if '--only' in args else None
    # Additive to --pokemon-only: specific non-species file numbers to keep
    # alongside the 151 species (e.g. a minigame model), without opening up
    # --only's exclusive filter to every other caller of --pokemon-only.
    also = {int(x) for x in args['--also'].split(',')} if '--also' in args else set()

    if not rom_path or not os.path.exists(rom_path):
        sys.exit('Pokemon Stadium (USA) Rev 2 ROM not found. Pass --rom=PATH. Searched:\n  '
                 + '\n  '.join(ROM_CANDIDATES))

    print(f'reading {rom_path}')
    rom = rom_mod.Rom(rom_path)
    print(f'  verified Rev 2 md5 {rom.md5}')

    blobs = rom_mod.pokemon_models(rom)
    print(f'  {len(blobs)} model fragments')
    tables = battle.BattleTables(rom)
    moves = battle.load_move_names(REPO)

    for sub in ('glb', 'textures', 'js'):
        os.makedirs(os.path.join(outdir, sub), exist_ok=True)

    manifest = dict(
        source='Pokemon Stadium (USA) Rev 2', romMd5=rom.md5,
        generator='web/tools/stadium_pipeline/build.py',
        coordinateSystem='Y up, +Z front, units are game units (models authored 10x, '
                         'baked into the model_root node scale)',
        frameRate=30,
        generatedEffects='Prims and textures tagged generated:true are NOT extracted '
                         'game data -- see pipeline/effects.py.',
        animationSlots={str(k): dict(name=v[0], evidence=v[1], description=v[2])
                        for k, v in battle.CONTEXT_SLOTS.items()},
        pokemon=[], extra=[])
    move_rows, anim_names, index, fx_count = {}, {}, [], 0

    for fileno, blob in enumerate(blobs):
        if pokemon_only and fileno >= N_POKEMON and fileno not in also:
            continue
        if only is not None and fileno not in only:
            continue
        try:
            data = fragment.extract(blob, f'{fileno}.bin')
        except Exception as exc:
            print(f'  skip {fileno}: {exc}')
            continue
        species = data['species']
        pokemon = fileno < N_POKEMON

        if pokemon:
            rows = tables.rows(species)
            uses, move_uses = label_animations(data, rows, moves)
            slug = f'{species:03d}_{battle.SPECIES.get(species, str(species)).lower()}'
            data['name'] = battle.SPECIES.get(species, f'#{species}')
            move_rows[species] = [[rows[e][0], rows[e][1]]
                                  for e in range(battle.N_MOVES)]
            anim_names[species] = [a['name'] for a in data['anims']]
            # same pick as the web loader: first clip the battle table uses for idle
            idle = next((i for i, u in enumerate(uses) if 'idle' in u), 0)
            size = idle_size(data, idle)
        else:
            slug = f'x{fileno:03d}_model'
            data['name'] = EXTRA_NAMES.get(fileno, f'Model {fileno}')
            overrides = EXTRA_ANIM_NAMES.get(fileno, {})
            for i, a in enumerate(data['anims']):
                a['name'] = overrides.get(i, f'anim{i}')
                a['aux'] = 0 if data['auxAnims'] else -1

        nfx = attach_effects(data, species) if want_fx else 0
        fx_count += nfx

        pngs = [base64.b64decode(t['png'].split(',', 1)[1]) for t in data['textures']]
        if want_glb:
            with open(os.path.join(outdir, 'glb', slug + '.glb'), 'wb') as fp:
                fp.write(glb_mod.build_glb(data, pngs))
            texdir = os.path.join(outdir, 'textures', slug)
            os.makedirs(texdir, exist_ok=True)
            for i, (t, p) in enumerate(zip(data['textures'], pngs)):
                tag = '_fx' if t.get('generated') else ''
                with open(os.path.join(texdir, f'{i:02d}_{t["w"]}x{t["h"]}{tag}.png'), 'wb') as fp:
                    fp.write(p)
        if want_js:
            with open(os.path.join(outdir, 'js', slug + '.js'), 'w') as fp:
                fp.write('PKMN_LOAD(' + json.dumps(data, separators=(',', ':')) + ');\n')

        entry = dict(
            species=species, name=data['name'], slug=slug,
            group='pokemon' if pokemon else 'extra',
            sourceFile=f'{fileno}.bin', glb=f'glb/{slug}.glb',
            textureDir=f'textures/{slug}',
            triangles=sum(len(p['idx']) // 3 for p in data['prims']),
            vertices=sum(len(p['pos']) // 3 for p in data['prims']),
            bones=len(data['bones']), textures=len(data['textures']),
            generatedEffects=nfx,
            **(dict(size=size) if pokemon else {}),
            animations=[dict(
                index=i, name=a['name'], frames=a['frames'],
                seconds=round(a['frames'] / 30.0, 3),
                endBehavior='clamp' if (a['flags'] & 2) else 'wrap',
                loopStartFrame=a['loopStart'],
                **(dict(contexts=sorted(set(uses[i])),
                        moves=sorted(set(move_uses[i])),
                        moveCount=len(set(move_uses[i]))) if pokemon else {}))
                for i, a in enumerate(data['anims'])])
        (manifest['pokemon'] if pokemon else manifest['extra']).append(entry)
        index.append(dict(species=species, name=data['name'], slug=slug,
                          group=entry['group'], triangles=entry['triangles'],
                          bones=entry['bones'], animations=len(data['anims'])))
        print(f'  {slug:<22} {len(data["anims"]):2d} anims  {entry["triangles"]:5d} tris'
              + (f'  +{nfx} effect' if nfx else ''))

    # ---- move index ------------------------------------------------------
    moves_out = []
    if move_rows:
        default_anim = {p['species']: next(
            (a['index'] for a in p['animations'] if 'attack_default' in a.get('contexts', [])), -1)
            for p in manifest['pokemon']}
        for mid in range(1, battle.N_MOVES + 1):
            users, tally, ndiff = [], collections.Counter(), 0
            for sp in sorted(move_rows):
                ai, ax = move_rows[sp][mid - 1]
                name = anim_names[sp][ai] if ai < len(anim_names[sp]) else f'anim{ai}'
                diff = ai != default_anim.get(sp, -1)
                ndiff += diff
                tally[name] += 1
                users.append(dict(species=sp, animation=ai, animationName=name,
                                  aux=ax, differsFromDefault=diff))
            moves_out.append(dict(
                id=mid, name=moves[mid], speciesWithOwnAnimation=ndiff,
                animationNames=[dict(name=n, species=c) for n, c in tally.most_common()],
                users=users))
        with open(os.path.join(outdir, 'moves.json'), 'w') as fp:
            json.dump(dict(source=manifest['source'], note=(
                'Entry n of the per-species battle table (0-indexed) selects the '
                'animation played when that Pokemon uses move n+1. The table is dense '
                '- every species has a row for every move, including moves it can '
                'never learn - and those unreachable rows overwhelmingly point at the '
                'species\' generic reaction animation. Use differsFromDefault.'),
                moves=moves_out), fp, indent=1)

    with open(os.path.join(outdir, 'manifest.json'), 'w') as fp:
        json.dump(manifest, fp, indent=2)

    if want_js:
        with open(os.path.join(outdir, 'js', 'index.js'), 'w') as fp:
            fp.write('window.PKMN_INDEX = ' + json.dumps(index, separators=(',', ':')) + ';\n')
        if moves_out:
            with open(os.path.join(outdir, 'js', 'moves.js'), 'w') as fp:
                fp.write('window.PKMN_MOVES = ' + json.dumps(
                    [dict(id=m['id'], name=m['name'],
                          bySpecies={str(u['species']): [u['animation'], u['aux']]
                                     for u in m['users']}) for m in moves_out],
                    separators=(',', ':')) + ';\n')
        viewer_src = os.path.join(REPO, 'tools/model_viewer/viewer.html')
        if os.path.exists(viewer_src):
            with open(viewer_src) as s, open(os.path.join(outdir, 'viewer.html'), 'w') as d:
                d.write(s.read())

    print(f'\n{len(manifest["pokemon"])} Pokemon + {len(manifest["extra"])} other models'
          f', {fx_count} generated effects')


if __name__ == '__main__':
    main(sys.argv[1:])
