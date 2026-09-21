/**
 * A stone cast of the Tower Defense wordmark, sitting on top of the real one
 * until the intro's falling Pokemon break it off.
 *
 * The cover is the wordmark's own alpha, so it shares the letters' borders
 * exactly -- a slab in the shape of the words rather than a panel over them.
 * It is cut into shards on the same 288-texel grid the art is baked to, so the
 * broken edges are chunky in the same units as everything else on the screen.
 *
 * Nothing here is scripted against the clip. Shards accumulate damage from
 * impacts and come away once they are past their own strength, which is what
 * produces the crack-then-shatter arc: the early landings cannot push any one
 * shard over on their own, the middle ones take out the letters they land on,
 * and the finale arrives with enough jolt to reach the ends of the word.
 *
 * The stone is generated rather than shipped. Every texture under
 * public/generated/ is ROM-derived and gitignored, and the title has to hold up
 * without one.
 */

/** Matches the --width the wordmark is baked at; see tools/pixelate_ui_art.py. */
export const WORDMARK_TEXEL_COLUMNS = 288;

/** Enough pieces to break up thirteen letters without any one being a whole one. */
const SHARD_COUNT = 52;
/** Grown by a texel so no antialiased rim of the real art shows around the cast. */
const SILHOUETTE_DILATE = 1;

/**
 * Damage a landing deals at its centre, and how far along the word it carries.
 * Both scale with the jolt, which is the point: single landings run 2-16 and
 * chew through the middle letters they hit, while the finale's cluster stacks
 * past 60 and reaches the ends the Pokemon never land on.
 */
const DAMAGE_PER_JOLT = 0.095;
const DAMAGE_REACH_PER_JOLT = 0.0125;
const DAMAGE_REACH_FLOOR = 0.09;
/** Shard strengths spread either side of 1 so the surface fails unevenly. */
const STRENGTH_MIN = 0.72;
const STRENGTH_MAX = 1.5;
/**
 * Jolt at which whatever is still attached lets go at once.
 *
 * The Pokemon only ever land across the middle quarter of the word -- measured,
 * every one of them between 0.38 and 0.63 across -- so damage alone never
 * reaches the T or the last E and they would sit there stranded. Something has
 * to bring the ends down, and the finale's cluster is the blow that does it.
 *
 * Keyed to the jolt rather than to how much has already come away. The fraction
 * lost only tells you what the last blow did, so gating on it landed the
 * collapse a hit or two early in two runs out of five -- the cast dropping
 * while Pokemon were still coming down on it. The jolt climbs through a cluster
 * instead, so this fires on its hardest blow every time: the bouncing landings
 * never carry more than 20 on their own, and the finale's third hit runs 45-55.
 */
const COLLAPSE_JOLT = 42;

/**
 * Room around the slab for debris to tumble through, in texels. The canvas is
 * that much bigger than the art and the slab is drawn inset into it; below is
 * generous enough to carry a chunk past the Start button before it fades.
 */
const DEBRIS_MARGIN_X = 24;
const DEBRIS_MARGIN_BELOW = 160;

/** Debris, in texels per second. */
const DEBRIS_GRAVITY = 900;
const DEBRIS_LIFT = -110;
const DEBRIS_SPREAD = 130;
const DEBRIS_SPIN = 5.5;
const DEBRIS_FADE = 1.35;

const STONE_SEED = 0x5de7;
/** Grey steps in the stone, well under the 5-bit grid's 32. */
const STONE_LEVELS = 6;

/** A shard of the cast, live until its damage passes its strength. */
interface Shard {
  readonly texels: number[];
  readonly edges: number[];
  readonly centre: number;
  readonly strength: number;
  damage: number;
  debris: Debris | null;
}

interface Debris {
  readonly sprite: HTMLCanvasElement;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  spin: number;
  angle: number;
  life: number;
}

/** Deterministic, so a shattered frame is the same one every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class WordmarkCover {
  private readonly context: CanvasRenderingContext2D | null;
  private readonly slab = document.createElement('canvas');
  private readonly slabContext: CanvasRenderingContext2D | null;
  private shards: Shard[] = [];
  private stone: ImageData | null = null;
  private alpha: Uint8Array | null = null;
  private owner: Int16Array | null = null;
  private columns = WORDMARK_TEXEL_COLUMNS;
  private rows = 0;
  /** Transparent margin above the letters as a fraction of the art's height, or -1 unmeasured. */
  private margin = -1;
  private slabDirty = true;
  private settling = false;
  private revealed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly image: HTMLImageElement,
  ) {
    this.context = canvas.getContext('2d');
    this.slabContext = this.slab.getContext('2d', { willReadFrequently: true });
  }

  /**
   * Cut the cast from the wordmark's alpha. Safe to call again on resize: the
   * texel grid is fixed, so only the canvas backing size actually changes.
   */
  build(): boolean {
    if (this.revealed || !this.image.naturalWidth || !this.slabContext) return false;
    if (this.shards.length) {
      this.resize();
      return true;
    }

    this.rows = Math.max(1, Math.round((this.columns * this.image.naturalHeight) / this.image.naturalWidth));
    this.slab.width = this.columns;
    this.slab.height = this.rows;
    this.slabContext.clearRect(0, 0, this.columns, this.rows);
    this.slabContext.imageSmoothingEnabled = false;
    this.slabContext.drawImage(this.image, 0, 0, this.columns, this.rows);

    const drawn = this.slabContext.getImageData(0, 0, this.columns, this.rows).data;
    this.alpha = this.dilate(drawn);
    this.cutShards();
    this.stone = this.quarry();
    this.slabDirty = true;
    this.resize();
    return true;
  }

  /**
   * How far the letters sit below the top of their own box. The art is baked
   * with headroom over them for the Pokemon to land in, so anything stacked on
   * top of the wordmark has to measure to the ink and not to the element.
   * Measured off the art itself, so it holds once the cast is gone; 0 until the
   * image has loaded, which reads as no headroom and corrects on the refit.
   */
  get inkTop(): number {
    if (this.margin < 0) this.margin = this.measureMargin();
    return Math.max(this.margin, 0);
  }

  private measureMargin(): number {
    if (!this.image.naturalWidth) return -1;
    const rows = Math.max(1, Math.round((this.columns * this.image.naturalHeight) / this.image.naturalWidth));
    const slab = document.createElement('canvas');
    slab.width = this.columns;
    slab.height = rows;
    const context = slab.getContext('2d', { willReadFrequently: true });
    if (!context) return -1;
    context.imageSmoothingEnabled = false;
    context.drawImage(this.image, 0, 0, this.columns, rows);
    const drawn = context.getImageData(0, 0, this.columns, rows).data;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < this.columns; x++) {
        if (drawn[(y * this.columns + x) * 4 + 3] > 8) return y / rows;
      }
    }
    return 0;
  }

  /** Grow the silhouette so the art's own soft edge stays hidden underneath. */
  private dilate(drawn: Uint8ClampedArray): Uint8Array {
    const solid = new Uint8Array(this.columns * this.rows);
    for (let i = 0; i < solid.length; i++) solid[i] = drawn[i * 4 + 3] > 8 ? 1 : 0;
    if (SILHOUETTE_DILATE <= 0) return solid;

    const grown = new Uint8Array(solid);
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.columns; x++) {
        if (solid[y * this.columns + x]) continue;
        for (let dy = -SILHOUETTE_DILATE; dy <= SILHOUETTE_DILATE && !grown[y * this.columns + x]; dy++) {
          for (let dx = -SILHOUETTE_DILATE; dx <= SILHOUETTE_DILATE; dx++) {
            const ny = y + dy;
            const nx = x + dx;
            if (ny < 0 || ny >= this.rows || nx < 0 || nx >= this.columns) continue;
            if (solid[ny * this.columns + nx]) {
              grown[y * this.columns + x] = 1;
              break;
            }
          }
        }
      }
    }
    return grown;
  }

  /** Nearest-site partition on the texel grid, so shard edges land on it too. */
  private cutShards(): void {
    if (!this.alpha) return;
    const random = mulberry32(STONE_SEED);
    const covered: number[] = [];
    for (let i = 0; i < this.alpha.length; i++) if (this.alpha[i]) covered.push(i);
    if (!covered.length) return;

    const sites: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < SHARD_COUNT; i++) {
      const at = covered[Math.floor(random() * covered.length)];
      sites.push({ x: at % this.columns, y: Math.floor(at / this.columns) });
    }

    this.owner = new Int16Array(this.alpha.length).fill(-1);
    const texels: number[][] = sites.map(() => []);
    for (const index of covered) {
      const x = index % this.columns;
      const y = Math.floor(index / this.columns);
      let best = 0;
      let bestDistance = Infinity;
      for (let s = 0; s < sites.length; s++) {
        // Squashed vertically: the art is three times wider than it is tall, and
        // round shards would otherwise span its whole height.
        const dx = x - sites[s].x;
        const dy = (y - sites[s].y) * 2.4;
        const distance = dx * dx + dy * dy;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = s;
        }
      }
      this.owner[index] = best;
      texels[best].push(index);
    }

    this.shards = texels
      .map((list, index): Shard | null => {
        if (!list.length) return null;
        const centre = list.reduce((sum, i) => sum + (i % this.columns), 0) / list.length / this.columns;
        return {
          texels: list,
          edges: this.edgesOf(list, index),
          centre,
          strength: STRENGTH_MIN + random() * (STRENGTH_MAX - STRENGTH_MIN),
          damage: 0,
          debris: null,
        };
      })
      .filter((shard): shard is Shard => shard !== null);
  }

  /** Texels of a shard that touch another shard or open air: where cracks show. */
  private edgesOf(list: number[], index: number): number[] {
    if (!this.owner) return [];
    const edges: number[] = [];
    for (const texel of list) {
      const x = texel % this.columns;
      const y = Math.floor(texel / this.columns);
      const neighbours = [
        x > 0 ? texel - 1 : -1,
        x < this.columns - 1 ? texel + 1 : -1,
        y > 0 ? texel - this.columns : -1,
        y < this.rows - 1 ? texel + this.columns : -1,
      ];
      if (neighbours.some((n) => n < 0 || this.owner![n] !== index)) edges.push(texel);
    }
    return edges;
  }

  /**
   * Mottled grey on the ROM's 5-bit channel grid. Each shard gets its own tint
   * and a one-texel bevel, so the cast reads as fitted pieces before anything
   * has broken and the debris has some relief once it is tumbling.
   */
  private quarry(): ImageData {
    const random = mulberry32(STONE_SEED ^ 0x9e37);
    const data = new ImageData(this.columns, this.rows);
    const coarse = this.noise(random, 5);
    const fine = this.noise(random, 2);
    const tint = this.shards.map(() => 0.92 + random() * 0.16);

    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.columns; x++) {
        const index = y * this.columns + x;
        if (!this.alpha?.[index]) continue;
        const shard = this.owner?.[index] ?? -1;
        const lit = 1 - y / this.rows;
        let value = (0.3 + lit * 0.22 + coarse[index] * 0.3 + fine[index] * 0.14) * (tint[shard] ?? 1);

        // Catch the light on each piece's upper edge and lose it on the lower,
        // which is what makes the seams between them visible.
        const above = y > 0 ? this.owner?.[index - this.columns] ?? -1 : -1;
        const below = y < this.rows - 1 ? this.owner?.[index + this.columns] ?? -1 : -1;
        if (above !== shard) value += 0.2;
        else if (below !== shard) value -= 0.16;

        // Few enough levels that the noise bands into facets instead of
        // clouding. Everything else on this screen is hard-edged texels and
        // smooth stone sat oddly among it.
        const level = Math.round(Math.max(0, Math.min(1, value)) * STONE_LEVELS) / STONE_LEVELS;
        data.data[index * 4] = Math.round(level * 214);
        data.data[index * 4 + 1] = Math.round(level * 219);
        data.data[index * 4 + 2] = Math.round(level * 233);
        data.data[index * 4 + 3] = 255;
      }
    }
    return data;
  }

  /** Value noise on a `cell`-texel lattice, smoothed across it. */
  private noise(random: () => number, cell: number): Float32Array {
    const wide = Math.ceil(this.columns / cell) + 2;
    const tall = Math.ceil(this.rows / cell) + 2;
    const lattice = new Float32Array(wide * tall);
    for (let i = 0; i < lattice.length; i++) lattice[i] = random();

    const out = new Float32Array(this.columns * this.rows);
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.columns; x++) {
        const gx = x / cell;
        const gy = y / cell;
        const x0 = Math.floor(gx);
        const y0 = Math.floor(gy);
        const fx = gx - x0;
        const fy = gy - y0;
        const sx = fx * fx * (3 - 2 * fx);
        const sy = fy * fy * (3 - 2 * fy);
        const at = (cx: number, cy: number) => lattice[cy * wide + cx];
        const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
        const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
        out[y * this.columns + x] = top + (bottom - top) * sy;
      }
    }
    return out;
  }

  /** A landing at `where` across the word, carrying `jolt`. */
  strike(where: number, jolt: number): void {
    if (this.revealed || !this.shards.length) return;
    const reach = DAMAGE_REACH_FLOOR + jolt * DAMAGE_REACH_PER_JOLT;
    const dose = jolt * DAMAGE_PER_JOLT;
    for (const shard of this.shards) {
      if (shard.debris || shard.damage >= shard.strength) continue;
      const falloff = Math.max(0, 1 - Math.abs(shard.centre - where) / reach);
      if (!falloff) continue;
      shard.damage += dose * falloff * falloff;
      if (shard.damage >= shard.strength) this.detach(shard, where);
      this.slabDirty = true;
    }

    if (jolt >= COLLAPSE_JOLT) this.collapse(where);
  }

  /** Everything still attached lets go at once. */
  private collapse(where: number): void {
    for (const shard of this.shards) {
      if (shard.debris || shard.damage >= shard.strength) continue;
      shard.damage = shard.strength;
      this.detach(shard, where);
    }
    this.slabDirty = true;
  }

  /** Cut a shard out of the slab and hand it to gravity. */
  private detach(shard: Shard, where: number): void {
    const random = mulberry32(STONE_SEED + shard.texels[0]);
    let minX = this.columns;
    let minY = this.rows;
    let maxX = 0;
    let maxY = 0;
    for (const texel of shard.texels) {
      const x = texel % this.columns;
      const y = Math.floor(texel / this.columns);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    const sprite = document.createElement('canvas');
    sprite.width = width;
    sprite.height = height;
    const context = sprite.getContext('2d');
    if (context && this.stone) {
      const piece = context.createImageData(width, height);
      for (const texel of shard.texels) {
        const x = (texel % this.columns) - minX;
        const y = Math.floor(texel / this.columns) - minY;
        const to = (y * width + x) * 4;
        for (let c = 0; c < 4; c++) piece.data[to + c] = this.stone.data[texel * 4 + c];
      }
      context.putImageData(piece, 0, 0);
    }

    shard.debris = {
      sprite,
      x: minX + width / 2,
      y: minY + height / 2,
      velocityX: (shard.centre - where) * DEBRIS_SPREAD + (random() - 0.5) * 40,
      velocityY: DEBRIS_LIFT * random(),
      spin: (random() - 0.5) * DEBRIS_SPIN,
      angle: 0,
      life: 1,
    };
  }

  update(delta: number): void {
    if (this.revealed) return;
    let moving = false;
    for (const shard of this.shards) {
      const debris = shard.debris;
      if (!debris) continue;
      debris.velocityY += DEBRIS_GRAVITY * delta;
      debris.x += debris.velocityX * delta;
      debris.y += debris.velocityY * delta;
      debris.angle += debris.spin * delta;
      debris.life -= DEBRIS_FADE * delta;
      if (debris.life <= 0) shard.debris = null;
      else moving = true;
    }
    // One more pass after the last chunk goes, or its final frame stays painted
    // on the canvas with nothing left to redraw over it.
    if (moving || this.slabDirty || this.settling) this.draw();
    this.settling = moving;
  }

  /** Take the cast off with no ceremony, for the paths where nothing lands. */
  reveal(): void {
    if (this.revealed) return;
    this.revealed = true;
    this.shards = [];
    this.stone = null;
    this.alpha = null;
    this.owner = null;
    this.context?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Size and place the canvas from the art's box. The element is deliberately
   * bigger than the wordmark so falling debris is not clipped at its edge, and
   * driving that from here keeps the margins from having to be repeated in CSS.
   */
  resize(): void {
    if (this.revealed || !this.rows) return;
    const artWidth = this.image.clientWidth;
    if (artWidth < 1) return;

    const scale = artWidth / this.columns;
    const cssWidth = (this.columns + DEBRIS_MARGIN_X * 2) * scale;
    const cssHeight = (this.rows + DEBRIS_MARGIN_BELOW) * scale;
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.canvas.style.left = `${-DEBRIS_MARGIN_X * scale}px`;

    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(cssWidth * ratio));
    const height = Math.max(1, Math.round(cssHeight * ratio));
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.slabDirty = true;
    this.draw();
  }

  private draw(): void {
    const context = this.context;
    if (!context || !this.stone) return;
    if (this.slabDirty) this.paintSlab();

    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    context.imageSmoothingEnabled = false;
    const scale = this.canvas.width / (this.columns + DEBRIS_MARGIN_X * 2);
    context.save();
    context.scale(scale, scale);
    context.translate(DEBRIS_MARGIN_X, 0);
    context.drawImage(this.slab, 0, 0);

    for (const shard of this.shards) {
      const debris = shard.debris;
      if (!debris) continue;
      context.save();
      context.globalAlpha = Math.max(0, Math.min(1, debris.life));
      context.translate(debris.x, debris.y);
      context.rotate(debris.angle);
      context.drawImage(debris.sprite, -debris.sprite.width / 2, -debris.sprite.height / 2);
      context.restore();
    }
    context.restore();
  }

  /** Redraw the still-attached stone, with cracks along the strained seams. */
  private paintSlab(): void {
    const context = this.slabContext;
    if (!context || !this.stone) return;
    const frame = new ImageData(this.columns, this.rows);
    for (const shard of this.shards) {
      if (shard.debris || shard.damage >= shard.strength) continue;
      for (const texel of shard.texels) {
        for (let c = 0; c < 4; c++) frame.data[texel * 4 + c] = this.stone.data[texel * 4 + c];
      }
      // Seams darken as the shard takes damage, so the surface visibly strains
      // for a landing or two before anything actually comes away.
      const strain = Math.min(1, shard.damage / shard.strength);
      if (strain <= 0.08) continue;
      const shade = 1 - strain * 0.72;
      for (const texel of shard.edges) {
        for (let c = 0; c < 3; c++) frame.data[texel * 4 + c] = Math.round(frame.data[texel * 4 + c] * shade);
      }
    }
    context.putImageData(frame, 0, 0);
    this.slabDirty = false;
  }
}
