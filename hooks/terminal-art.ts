// Terminal drawings: the desktop draws its crabs and its bar as SVG, a terminal
// draws cells. Everything here is pure, so register.tsx stays the only file
// that talks to the engine.

export type Fill = (x: number, y: number, w: number, h: number, color: string, group?: string) => void
export type DrawCostume = (fill: Fill) => void

type Rgba = readonly [r: number, g: number, b: number, a: number]
type Move = { dx: number; dy: number; a: number }

const GW = 30
const GH = 28
export const SPRITE_COLS = 11
export const SPRITE_ROWS = 5
// A cell is about this much taller than it is wide.
const CELL_ASPECT = 2.2
// Eyes outweigh the body, or they vanish when the crab is scaled down.
const INK = 0x1f1e1d
const INK_WEIGHT = 3
// What a half-transparent pixel (the astronaut's dome) blends with.
const BACKDROP = [35, 36, 49]

const EMPTY = -1
const DEFAULT_COLOR = 0x01000000
const SPACE = 0x20
// Quarter blocks in the order of their mask: top left 1, top right 2,
// bottom left 4, bottom right 8.
const QUADRANT = [
  SPACE, 0x2598, 0x259d, 0x2580, 0x2596, 0x258c, 0x259e, 0x259b,
  0x2597, 0x259a, 0x2590, 0x259c, 0x2584, 0x2599, 0x259f, 0x2588,
]
// A cell filled 0 to 7 eighths from its left edge.
const EIGHTHS = ' ▏▎▍▌▋▊▉'

const parseColor = (c: string): Rgba => {
  if (c.startsWith('#')) {
    const hex = c.length === 4 ? [...c.slice(1)].map(x => x + x).join('') : c.slice(1)
    const n = parseInt(hex, 16)
    return [n >> 16, (n >> 8) & 255, n & 255, 1]
  }
  const m = (c.match(/[\d.]+/g) ?? []).map(Number)
  return [m[0] ?? 0, m[1] ?? 0, m[2] ?? 0, m[3] ?? 1]
}

// Where each group of pixels sits this frame. The desktop rotates its props;
// cells do not turn, so here a prop moves by one pixel instead.
const motion = (costume: string, t: number, isWalking: boolean): ((group: string) => Move) => {
  const still: Move = { dx: 0, dy: 0, a: 1 }
  if (!isWalking) return () => still
  const phase = (period: number, advance = 0): number => ((t + advance) % period) / period
  const isLate = (period: number, advance = 0): boolean => phase(period, advance) >= 0.5
  if (costume === 'fable') {
    const dy = -Math.round(2 * (0.5 - 0.5 * Math.cos(2 * Math.PI * phase(1))))
    return group => ({
      dx: 0,
      dy,
      a: group === 'ant' ? (isLate(1) ? 0.15 : 1) : group === 'star' ? (isLate(0.5, 0.25) ? 0.15 : 1) : 1,
    })
  }
  const legPeriod = costume === 'light' ? 0.25 : 0.5
  const la = isLate(legPeriod) ? -1 : 0
  const lb = isLate(legPeriod, legPeriod / 2) ? -1 : 0
  const bob = isLate(0.5, 0.125) ? 1 : 0
  const p1 = phase(1)
  const p2 = phase(0.5)
  return group => {
    if (group === 'la') return { dx: 0, dy: la, a: 1 }
    if (group === 'lb') return { dx: 0, dy: lb, a: 1 }
    const key = `${costume}:${group}`
    if (key === 'heavy:it') {
      const sweep = [[0, 0], [-1, 1], [-2, 2], [-1, 1]][Math.floor(p1 * 4)] ?? [0, 0]
      return { dx: sweep[0] ?? 0, dy: bob + (sweep[1] ?? 0), a: 1 }
    }
    if (key === 'heavy:gl') return { dx: 0, dy: bob, a: isLate(1, 0.5) ? 0.15 : 1 }
    if (key === 'careful:it') return { dx: 0, dy: bob - (p2 >= 0.25 && p2 < 0.75 ? 1 : 0), a: 1 }
    if (key === 'medium:pan') return { dx: 0, dy: bob - (p1 >= 0.2 && p1 < 0.4 ? 1 : 0), a: 1 }
    if (key === 'medium:egg') {
      const lift = p1 < 0.1 ? 0 : p1 < 0.2 ? -2 : p1 < 0.4 ? -5 : p1 < 0.5 ? -3 : p1 < 0.6 ? -1 : 0
      return { dx: 0, dy: bob + lift, a: 1 }
    }
    if (key === 'light:flag') return { dx: 0, dy: bob + (isLate(0.25) ? 1 : 0), a: 1 }
    if (key === 'explore:it') return { dx: p2 >= 0.25 && p2 < 0.75 ? 1 : 0, dy: bob, a: 1 }
    return { dx: 0, dy: bob, a: 1 }
  }
}

// The crab as GW x GH pixels: red, green, blue and opacity.
const sprite = (costume: string, draw: DrawCostume, t: number, isWalking: boolean): Float32Array => {
  const move = motion(costume, t, isWalking)
  const grid = new Float32Array(GW * GH * 4)
  draw((x, y, w, h, color, group = 'bd') => {
    const [r, g, b, alpha] = parseColor(color)
    const m = move(group)
    const a = alpha * m.a
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const X = x + xx + m.dx
        const Y = y + yy + m.dy
        if (X < 0 || Y < 0 || X >= GW || Y >= GH) continue
        const i = (Y * GW + X) * 4
        const under = (grid[i + 3] ?? 0) * (1 - a)
        const out = a + under
        if (out <= 0) continue
        grid[i] = (r * a + (grid[i] ?? 0) * under) / out
        grid[i + 1] = (g * a + (grid[i + 1] ?? 0) * under) / out
        grid[i + 2] = (b * a + (grid[i + 2] ?? 0) * under) / out
        grid[i + 3] = out
      }
    }
  })
  return grid
}

const pixelAt = (grid: Float32Array, X: number, Y: number): number => {
  if (X < 0 || Y < 0 || X >= GW || Y >= GH) return EMPTY
  const i = (Y * GW + X) * 4
  const a = grid[i + 3] ?? 0
  if (a < 0.25) return EMPTY
  const mix = (k: number): number => Math.round((BACKDROP[k] ?? 0) + ((grid[i + k] ?? 0) - (BACKDROP[k] ?? 0)) * a)
  return (mix(0) << 16) | (mix(1) << 8) | mix(2)
}

const distance = (a: number, b: number): number => {
  const part = (c: number, k: number): number => (c === EMPTY ? (BACKDROP[k] ?? 0) : (c >> (16 - 8 * k)) & 255)
  return [0, 1, 2].reduce((sum, k) => sum + (part(a, k) - part(b, k)) ** 2, 0)
}

// The color that dominates one quarter of a cell.
const quadColor = (grid: Float32Array, left: number, top: number, scale: number, ox: number, oy: number): number => {
  const tally = new Map<number, number>()
  let empty = 0
  for (let sy = 0; sy < 4; sy++) {
    for (let sx = 0; sx < 4; sx++) {
      const px = left + (sx + 0.5) / 8
      const py = top + ((sy + 0.5) / 8) * CELL_ASPECT
      const color = pixelAt(grid, Math.floor((px - ox) / scale), Math.floor((py - oy) / scale))
      if (color === EMPTY) empty++
      else tally.set(color, (tally.get(color) ?? 0) + (color === INK ? INK_WEIGHT : 1))
    }
  }
  const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]
  return empty >= 10 || !best ? EMPTY : best[0]
}

// A cell shows two colors, foreground and background: the two that count most
// stay, the others become the nearer of those.
const twoColors = (quads: number[]): number[] => {
  const kinds = [...new Set(quads)]
  if (kinds.length <= 2) return quads
  const weight = (k: number): number => quads.filter(q => q === k).length + (k === INK ? 0.5 : 0)
  const keep = [...kinds].sort((a, b) => weight(b) - weight(a)).slice(0, 2)
  const nearest = (k: number): number => keep.reduce((best, c) => (distance(c, k) < distance(best, k) ? c : best))
  return quads.map(q => (keep.includes(q) ? q : nearest(q)))
}

// Four quarters of one cell to its glyph, foreground and background.
const cellWord = (quads: number[]): number[] => {
  const front = quads.find(q => q !== EMPTY) ?? EMPTY
  const back = quads.find(q => q !== front) ?? EMPTY
  const mask = quads.reduce((bits, q, i) => (front !== EMPTY && q === front ? bits | (1 << i) : bits), 0)
  return [QUADRANT[mask] ?? SPACE, front === EMPTY ? DEFAULT_COLOR : front, back === EMPTY ? DEFAULT_COLOR : back]
}

// Every motion repeats within a second and changes on eighths of it.
const FRAMES = 8
const cache = new Map<string, string>()

/**
 * A crab as the `cells` of a Raster of SPRITE_COLS x SPRITE_ROWS.
 *
 * A costume's frames are kept: the same name is taken to draw the same pixels.
 *
 * @param costume names the motion (each costume moves its own prop) and the cache
 * @param draw paints the costume's pixels, as the desktop's SVG builder does
 * @param t seconds, any origin; the frame follows from it alone
 * @param isWalking false draws the crab standing still
 */
export const spriteCells = (costume: string, draw: DrawCostume, t: number, isWalking: boolean): string => {
  const frame = isWalking ? Math.floor((((t % 1) + 1) % 1) * FRAMES) : -1
  const key = `${costume}|${frame}`
  const cached = cache.get(key)
  if (cached !== undefined) return cached
  const cells = drawCells(costume, draw, (frame + 0.5) / FRAMES, isWalking)
  cache.set(key, cells)
  return cells
}

const drawCells = (costume: string, draw: DrawCostume, t: number, isWalking: boolean): string => {
  const grid = sprite(costume, draw, t, isWalking)
  const scale = Math.min(SPRITE_COLS / GW, (SPRITE_ROWS * CELL_ASPECT) / GH)
  const ox = (SPRITE_COLS - GW * scale) / 2
  const oy = (SPRITE_ROWS * CELL_ASPECT - GH * scale) / 2
  const words = new Uint32Array(SPRITE_COLS * SPRITE_ROWS * 3)
  for (let cy = 0; cy < SPRITE_ROWS; cy++) {
    for (let cx = 0; cx < SPRITE_COLS; cx++) {
      const quads = twoColors(
        [0, 1, 2, 3].map(i => quadColor(grid, cx + (i % 2) / 2, (cy + Math.floor(i / 2) / 2) * CELL_ASPECT, scale, ox, oy)),
      )
      words.set(cellWord(quads), (cy * SPRITE_COLS + cx) * 3)
    }
  }
  return new Uint8Array(words.buffer).toBase64()
}

// A bar's text over exactly `cols` columns: a space before it, an ellipsis
// where it runs past the end.
const fit = (text: string, cols: number): string => {
  const padded = ` ${text}`
  return padded.length > cols ? `${padded.slice(0, Math.max(0, cols - 1))}…` : padded.padEnd(cols)
}

export type BarParts = { filled: string; head: string; rest: string }

/**
 * The bar with its text inside, cut where the fill ends: `filled` is drawn on
 * the fill's color, `rest` on the track, and `head` is the one cell between,
 * a part block when the fill ends on a space and empty when it ends on text.
 */
export const barParts = (text: string, ratio: number, cols: number): BarParts => {
  const inside = fit(text, cols)
  const eighths = Math.round(Math.max(0, Math.min(1, ratio)) * cols * 8)
  const whole = Math.floor(eighths / 8)
  const head = inside[whole] === ' ' ? (EIGHTHS[eighths % 8] ?? ' ') : ''
  return { filled: inside.slice(0, whole), head, rest: inside.slice(whole + head.length) }
}

export type Shown = { ratio: number; at: number }

/**
 * Moves the drawn ratio toward `target` at `perSecond`, so a bar fed whole
 * steps slides instead of jumping. Going back (a new flow) is immediate.
 */
export const glide = (prev: Shown, target: number, at: number, perSecond: number): Shown => {
  if (target <= prev.ratio) return { ratio: target, at }
  if (at <= prev.at) return prev
  return { ratio: Math.min(target, prev.ratio + ((at - prev.at) / 1000) * perSecond), at }
}

// --- the bar while nothing says how far the work is: a block that slides.

export type SlideParts = { before: string; block: string; after: string }

const SLIDE_COLS = 8
const SLIDE_COLS_PER_SECOND = 4

// The bar's text cut around a block that crosses the bar and back with the
// clock; the three parts together are always `cols` wide.
export const slideParts = (text: string, at: number, cols: number): SlideParts => {
  const inside = fit(text, cols)
  const width = Math.min(SLIDE_COLS, cols)
  const span = cols - width
  const walked = span ? Math.floor((Math.max(0, at) / 1000) * SLIDE_COLS_PER_SECOND) % (2 * span) : 0
  const start = walked <= span ? walked : 2 * span - walked
  return { before: inside.slice(0, start), block: inside.slice(start, start + width), after: inside.slice(start + width) }
}

// --- the costume of a worker whose type none was drawn for.

export type Worn = { type: string; costume?: string }

// The costume its type already wears in this session, else the first one no
// other worker wears, so different types look different while costumes last.
// Limit: past the pool's size two types share a costume; draw more to fix.
export const pickCostume = (type: string, worn: readonly Worn[], pool: readonly string[]): string => {
  const own = worn.find(w => w.type === type && w.costume)?.costume
  if (own) return own
  const taken = new Set(worn.map(w => w.costume))
  const types = new Set(worn.map(w => w.type))
  return pool.find(c => !taken.has(c)) ?? pool[types.size % pool.length] ?? 'other'
}
