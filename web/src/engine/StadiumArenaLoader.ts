import * as THREE from 'three';

const NATIVE_SCALE = 0.1;

class Reader {
  private view: DataView;
  public offset = 0;

  constructor(public bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  u8(): number { return this.view.getUint8(this.offset++); }
  u16(): number { const value = this.view.getUint16(this.offset, false); this.offset += 2; return value; }
  i16(): number { const value = this.view.getInt16(this.offset, false); this.offset += 2; return value; }
  u32(): number { const value = this.view.getUint32(this.offset, false); this.offset += 4; return value; }
  take(size: number): Uint8Array {
    const value = this.bytes.subarray(this.offset, this.offset + size);
    if (value.length !== size) throw new Error('truncated SNA2 arena');
    this.offset += size;
    return value;
  }
}

function decodeTexture(format: number, size: number, width: number, height: number, raw: Uint8Array): Uint8Array<ArrayBuffer> {
  const rgba = new Uint8Array(width * height * 4);
  if (raw.length === 0) {
    rgba.fill(255);
    return rgba;
  }
  const rawView = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const out = pixel * 4;
    if (format === 0 && size === 2) {
      const packed = rawView.getUint16(pixel * 2, false);
      rgba[out] = ((packed >> 11) & 31) * 255 / 31;
      rgba[out + 1] = ((packed >> 6) & 31) * 255 / 31;
      rgba[out + 2] = ((packed >> 1) & 31) * 255 / 31;
      rgba[out + 3] = (packed & 1) ? 255 : 0;
    } else if (format === 0 && size === 3) {
      rgba.set(raw.subarray(pixel * 4, pixel * 4 + 4), out);
    } else if (format === 3 && size === 0) {
      const packed = raw[pixel >> 1];
      const nibble = (pixel & 1) ? packed & 15 : packed >> 4;
      const intensity = (nibble >> 1) * 255 / 7;
      rgba.set([intensity, intensity, intensity, (nibble & 1) ? 255 : 0], out);
    } else if (format === 3 && size === 1) {
      const packed = raw[pixel];
      rgba.set([(packed >> 4) * 17, (packed >> 4) * 17, (packed >> 4) * 17, (packed & 15) * 17], out);
    } else if (format === 3 && size === 2) {
      const intensity = raw[pixel * 2];
      rgba.set([intensity, intensity, intensity, raw[pixel * 2 + 1]], out);
    } else if (format === 4 && size === 0) {
      const packed = raw[pixel >> 1];
      const intensity = ((pixel & 1) ? packed & 15 : packed >> 4) * 17;
      rgba.set([intensity, intensity, intensity, 255], out);
    } else if (format === 4 && size === 1) {
      rgba.set([raw[pixel], raw[pixel], raw[pixel], 255], out);
    } else {
      throw new Error(`unsupported Stadium texture format ${format}/${size}`);
    }
  }
  return rgba;
}

function vertexShade(raw: Uint8Array, offset: number): number {
  const signed = (value: number) => value >= 128 ? value - 256 : value;
  const nx = signed(raw[offset + 12]);
  const ny = signed(raw[offset + 13]);
  const nz = signed(raw[offset + 14]);
  const length = Math.hypot(nx, ny, nz);
  if (length > 32 && length < 190) {
    const dot = (nx * 0.36 + ny * 0.82 + nz * 0.44) / length;
    return Math.max(0.48, Math.min(1, 0.58 + Math.max(0, dot) * 0.42));
  }
  return Math.max(0.48, Math.min(1, (raw[offset + 12] + raw[offset + 13] + raw[offset + 14]) / 765));
}

export class StadiumArenaLoader {
  public static async load(url: string): Promise<THREE.Group> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    const reader = new Reader(new Uint8Array(await response.arrayBuffer()));
    const magic = String.fromCharCode(...reader.take(4));
    if (magic !== 'SNA2') throw new Error(`${url}: unsupported arena cache`);
    const count = reader.u16();
    const result = new THREE.Group();
    result.name = 'Pokemon Stadium - Gym Leader Castle';
    const textures = new Map<number, THREE.DataTexture>();

    for (let groupIndex = 0; groupIndex < count; groupIndex++) {
      const materialId = reader.i16();
      const format = reader.u8();
      const size = reader.u8();
      const width = reader.u16();
      const height = reader.u16();
      const textureBytes = reader.u32();
      const vertexCount = reader.u32();
      const indexCount = reader.u32();
      const tint = reader.take(4);
      const layer = reader.u8();
      reader.take(3);
      const textureRaw = reader.take(textureBytes);
      const vertexRaw = reader.take(vertexCount * 16);
      const indices = new Uint16Array(indexCount);
      for (let index = 0; index < indexCount; index++) indices[index] = reader.u16() - 1;

      let texture = textures.get(materialId);
      if (!texture) {
        texture = new THREE.DataTexture(decodeTexture(format, size, width, height, textureRaw), width, height);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.flipY = false;
        texture.needsUpdate = true;
        textures.set(materialId, texture);
      }

      const positions = new Float32Array(vertexCount * 3);
      const uvs = new Float32Array(vertexCount * 2);
      const colors = new Float32Array(vertexCount * 3);
      const vertexView = new DataView(vertexRaw.buffer, vertexRaw.byteOffset, vertexRaw.byteLength);
      for (let index = 0; index < vertexCount; index++) {
        const at = index * 16;
        const x = vertexView.getInt16(at, false);
        const y = vertexView.getInt16(at + 2, false);
        const z = vertexView.getInt16(at + 4, false);
        positions.set([z * NATIVE_SCALE, y * NATIVE_SCALE, -x * NATIVE_SCALE], index * 3);
        uvs.set([
          vertexView.getInt16(at + 8, false) / (32 * width),
          vertexView.getInt16(at + 10, false) / (32 * height),
        ], index * 2);
        const shade = vertexShade(vertexRaw, at);
        colors.set([shade, shade, shade], index * 3);
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      geometry.computeVertexNormals();
      const material = new THREE.MeshLambertMaterial({
        map: texture,
        color: new THREE.Color(tint[0] / 255, tint[1] / 255, tint[2] / 255),
        opacity: tint[3] / 255,
        transparent: tint[3] < 255,
        alphaTest: 0.05,
        vertexColors: true,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `native_group_${groupIndex}`;
      mesh.userData = { materialId, layer };
      mesh.receiveShadow = true;
      result.add(mesh);
    }
    return result;
  }
}
