#!/usr/bin/env python3
"""Extract Gym Leader Castle geometry into a compact local runtime cache.

The parser follows StadiumBattleFX's MIT-licensed native arena converter. It
retains N64 vertices, UVs, per-group tint, texture format, and layer metadata;
the browser decodes the texture bytes without any third-party dependency.
"""
import math
import struct

from rom import decompress

STADIUM_MODELS = 0x56FF10
VENUE_MEMBERS = {
    'brock': 7, 'misty': 8, 'surge': 9, 'erika': 10, 'koga': 11,
    'sabrina': 12, 'blaine': 13, 'giovanni': 14,
    'elite4': 15, 'champion': 16,
}
BASE = 0x8FF00000
GEO_SIZE = {
    0: 8, 1: 4, 2: 8, 3: 8, 4: 4, 5: 4, 6: 4, 7: 8, 8: 12,
    9: 4, 10: 8, 11: 24, 12: 4, 13: 4, 14: 4, 15: 4, 16: 4,
    17: 4, 18: 4, 19: 8, 20: 12, 21: 12, 22: 4, 23: 20, 24: 8,
    25: 8, 26: 4, 27: 16, 28: 16, 29: 28, 30: 8, 31: 24,
    32: 20, 33: 16, 34: 8, 35: 16, 36: 4, 37: 4, 38: 20,
}


def u8(data, offset):
    return data[offset]


def u16(data, offset):
    return struct.unpack_from('>H', data, offset)[0]


def s16(data, offset):
    return struct.unpack_from('>h', data, offset)[0]


def u32(data, offset):
    return struct.unpack_from('>I', data, offset)[0]


def fragment_offset(address, limit):
    if BASE <= address < 0x90000000:
        offset = address - BASE
        if offset < limit:
            return offset
    return None


def root_layouts(fragment, reloc):
    roots, texture_table = [], None
    for offset in range(0x20, reloc - 19, 4):
        if u8(fragment, offset) != 0x17:
            continue
        table = fragment_offset(u32(fragment, offset + 8), reloc)
        vertices = fragment_offset(u32(fragment, offset + 16), reloc)
        if table is None or vertices is None:
            continue
        texture_table = table if texture_table is None else texture_table
        cursor = offset
        while cursor < min(reloc, offset + 64):
            command = u8(fragment, cursor)
            size = GEO_SIZE.get(command)
            if size is None:
                break
            if command == 3:
                target = fragment_offset(u32(fragment, cursor + 4), reloc)
                if target is not None:
                    roots.append(target)
                break
            cursor += size
    if texture_table is None or not roots:
        raise ValueError('native Stadium stage has no convertible scene roots')
    return roots, texture_table


def geometry_groups(fragment, reloc, roots):
    groups, used, walking = [], set(), set()
    active = {'texture': -1, 'rgba': b'\xff\xff\xff\xff'}

    def walk(cursor, layer):
        if cursor in walking:
            return
        walking.add(cursor)
        for _ in range(2048):
            if not 0 <= cursor < reloc:
                raise ValueError('native geo layout escaped fragment')
            command = u8(fragment, cursor)
            size = GEO_SIZE.get(command)
            if size is None:
                raise ValueError(f'unsupported native geo command {command}')
            if command == 35:
                active['texture'] = s16(fragment, cursor + 8)
                active['rgba'] = fragment[cursor + 12:cursor + 16]
            elif command == 34:
                address = u32(fragment, cursor + 4)
                gfx = fragment_offset(address, reloc)
                if address and gfx is None:
                    raise ValueError('native display list escaped fragment')
                if gfx is not None and gfx not in used:
                    used.add(gfx)
                    groups.append(dict(texture=active['texture'], rgba=active['rgba'],
                                       gfx=gfx, layer=layer))
            elif command in (0, 3):
                target = fragment_offset(u32(fragment, cursor + 4), reloc)
                if target is not None:
                    walk(target, layer)
            elif command == 2:
                target = fragment_offset(u32(fragment, cursor + 4), reloc)
                if target is not None:
                    walk(target, layer)
                break
            cursor += size
            if command in (1, 4):
                break

    for layer, root in enumerate(roots, 1):
        walk(root, layer)
    if not 8 <= len(groups) <= 128:
        raise ValueError(f'implausible native material group count {len(groups)}')
    return groups


def convert_gfx(fragment, reloc, gfx):
    slots, vertices, vertex_map, indices = {}, [], {}, []

    def vertex(source):
        if source in vertex_map:
            return vertex_map[source]
        if source < 0 or source + 16 > reloc:
            raise ValueError('native vertex escaped fragment')
        index = len(vertices) + 1
        vertices.append(fragment[source:source + 16])
        vertex_map[source] = index
        return index

    cursor = gfx
    for _ in range(8192):
        if cursor + 8 > reloc:
            raise ValueError('native display list escaped fragment')
        word0, word1 = struct.unpack_from('>II', fragment, cursor)
        opcode = word0 >> 24
        cursor += 8
        if opcode == 0x01:
            count = (word0 >> 12) & 0xff
            first = ((word0 >> 1) & 0x7f) - count
            source = fragment_offset(word1, reloc)
            if source is None or not 1 <= count <= 32 or first < 0:
                raise ValueError('invalid native vertex load')
            for index in range(count):
                slots[first + index] = source + index * 16
        elif opcode in (0x05, 0x06):
            encoded = [(word0 >> 16) & 0xff, (word0 >> 8) & 0xff, word0 & 0xff]
            if opcode == 0x06:
                encoded += [(word1 >> 16) & 0xff, (word1 >> 8) & 0xff, word1 & 0xff]
            for item in encoded:
                source = slots.get(item // 2)
                if source is None:
                    raise ValueError('native triangle references an unloaded vertex')
                indices.append(vertex(source))
        elif opcode == 0xDF:
            break
        elif opcode not in (0xD9, 0xFB, 0xFC):
            raise ValueError(f'unsupported native display-list opcode {opcode:02X}')
    if len(indices) < 3 or len(indices) % 3:
        raise ValueError('native geometry has no triangles')
    return vertices, indices


def texture_for(fragment, reloc, table, material):
    if material < 0:
        return 0, 2, 1, 1, b''
    descriptor = table + material * 12
    if descriptor + 12 > reloc:
        raise ValueError('native texture descriptor escaped fragment')
    fmt, size = u8(fragment, descriptor), u8(fragment, descriptor + 1)
    width, height = s16(fragment, descriptor + 2), s16(fragment, descriptor + 4)
    source = fragment_offset(u32(fragment, descriptor + 8), reloc)
    if fmt > 4 or size > 3 or not (1 <= width <= 512 and 1 <= height <= 512) or source is None:
        raise ValueError('invalid native texture descriptor')
    byte_count = math.ceil(width * height * (4 * (2 ** size)) / 8)
    if source + byte_count > reloc:
        raise ValueError('native texture escaped fragment')
    return fmt, size, width, height, fragment[source:source + byte_count]


def convert_member(rom, member):
    blobs = rom.archive(STADIUM_MODELS)
    if member < 0 or member >= len(blobs):
        raise ValueError(f'stadium_models member {member} is missing')
    fragment = decompress(blobs[member])
    if fragment[8:16] != b'FRAGMENT':
        raise ValueError('invalid native Stadium fragment')
    reloc = u32(fragment, 0x14)
    if reloc < 0x40 or reloc > len(fragment):
        raise ValueError('invalid native relocation boundary')
    roots, texture_table = root_layouts(fragment, reloc)
    groups = geometry_groups(fragment, reloc, roots)
    output = [b'SNA2', struct.pack('>H', len(groups))]
    for group in groups:
        vertices, indices = convert_gfx(fragment, reloc, group['gfx'])
        fmt, size, width, height, texture = texture_for(
            fragment, reloc, texture_table, group['texture'])
        output.append(struct.pack('>hBBHHIII', group['texture'], fmt, size, width,
                                  height, len(texture), len(vertices), len(indices)))
        output.append(group['rgba'] + bytes((group['layer'], 0, 0, 0)))
        output.append(texture)
        output.extend(vertices)
        output.append(struct.pack(f'>{len(indices)}H', *indices))
    return b''.join(output), len(groups), len(fragment)
