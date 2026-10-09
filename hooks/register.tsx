import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRun, Flow, Main, Panel, Phase, PlannedTask } from '../types'
import { isPersonsPrompt, toolNote } from './main-session'
import { latestWeather, parseWeather, shownWeather, weatherParts, weatherUrl } from './weather'
import { SPRITE_COLS, SPRITE_ROWS, barParts, glide, pickCostume, slideParts, spriteCells } from './terminal-art'
import type { Shown } from './terminal-art'

const flow = atom({ plugin: 'savvy-progress', key: 'flow' } as const, null)
const agents = atom({ plugin: 'savvy-progress', key: 'agents' } as const, [])
const panel = atom({ plugin: 'savvy-progress', key: 'panel' } as const, {
  isCompact: false,
  isDoneCollapsed: false,
  autoOpenedFor: '',
})
const now = atom({ plugin: 'savvy-progress', key: 'now' } as const, 0)
const main = atom({ plugin: 'savvy-progress', key: 'main' } as const, { isWorking: false, startedAt: 0, activity: '' })
const weather = atom({ plugin: 'savvy-progress', key: 'weather' } as const, null)

const TOOL = 'mcp__savvy-progress__progress'
const STEP_TOOL = 'mcp__savvy-progress__step'
const PANE = 'savvy-agents'
const PHASES: readonly Phase[] = ['plan', 'design', 'delegate', 'review', 'close']
const ACCENT = '#8f8cf4'
const DONE = '#5fbf8f'
// The terminal's bar: blue for the fill unless the `barColor` setting names
// another, and a track a shade above a dark background.
const BLUE = '#0079d2'
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i
const TRACK = '#3b3d50'
// What the turn cost stands out in; the session's total is drawn dim beside it.
const TURN = '#f5c542'
// The columns the terminal's pane asks for; its rows are laid out for them.
const PANE_COLUMNS = 44
// The width of a worker's own step bar in the terminal's pane.
const STEP_WIDTH = 12
// How many running tasks the line under the terminal's bar names.
const NOW_SHOWN = 2
// While something moves the terminal is redrawn this often: its crabs and its
// bar are drawn from the clock.
const FRAME_MS = 250
// The share of its width the bar's fill crosses per second toward a new value.
const GLIDE_PER_SECOND = 0.25
// Below this share done there is no pace to estimate the time left from.
const MIN_RATIO_FOR_ESTIMATE = 0.05
// The bar is never narrower than its longest text, percent and hours left.
const MIN_BAR_WIDTH = 24
// A running worker with no sign of life for this long is called out in the bar.
const STALL_MS = 3 * 60_000
// A bar that started by itself also leaves by itself, this long after its last run.
const AUTO_HIDE_MS = 20_000
// The pane leaves this long after the last worker ends, whoever opened it.
const PANE_HIDE_MS = 5_000
// Below this width the two costs keep their marks and drop their words, or the row would wrap.
const COST_WORDS_MIN_COLUMNS = 60
// Who the first row is about: the main session, as the row beneath it is about the agents.
const MAIN_TITLE = 'Claude'
// The note beside the main session's bar is left out rather than cut shorter than this.
const NOTE_MIN_WIDTH = 8
// What the note is given before the bar grows past its minimum, and before the weather takes its room.
const NOTE_WIDTH = 16
// The weather is asked again this often.
const WEATHER_EVERY_MS = 30 * 60_000
// What the engine calls an agent whose loop is over.
const ENDED: ReadonlySet<string> = new Set(['completed', 'failed', 'killed'])

type ProgressInput = {
  title?: string
  total?: number
  done?: number
  phase?: Phase
  finished?: boolean
  tasks?: { title?: string; tier?: string; after?: number[] }[]
}

// ---------------------------------------------------------------------------
// Language: the `language` option, else Claude Code's `language` setting, else the
// process locale; English when nothing says Russian or Dutch.

type Lang = 'en' | 'ru' | 'nl'

const STRINGS = {
  en: {
    pane: 'Agents',
    cost: 'Cost',
    tokens: 'Tokens',
    time: 'Time',
    collapse: 'Collapse',
    expand: 'Expand',
    running: 'Running',
    finished: 'Finished',
    planned: 'Planned',
    empty: 'No subagents yet.',
    round: 'round',
    failed: 'error',
    after: 'after',
    tokensWord: 'tokens',
    agentsCount: 'agents',
    isRunning: 'running',
    isFinished: 'finished',
    isPlanned: 'planned',
    opened: 'Agents panel opened.',
    closed: 'Agents panel closed.',
    done: 'Done',
    plan: 'Plan',
    design: 'Design',
    tasks: 'Tasks',
    review: 'Review',
    busy: 'running',
    left: 'eta',
    doneIn: 'done in',
    workingOn: 'working on',
    quiet: 'quiet',
    session: 'session',
    turn: 'turn',
    tomorrow: 'tomorrow',
    working: 'Working',
    thinking: 'thinking',
    rest: 'Done, waiting for you',
    waitFor: 'Waiting for',
    noRoom: 'The agents panel does not fit at this width. Type /agents-info to open it.',
  },
  ru: {
    pane: 'Агенты',
    cost: 'Стоимость',
    tokens: 'Токены',
    time: 'Время',
    collapse: 'Свернуть',
    expand: 'Развернуть',
    running: 'Работают',
    finished: 'Завершены',
    planned: 'Запланированы',
    empty: 'Субагентов пока нет.',
    round: 'раунд',
    failed: 'ошибка',
    after: 'после',
    tokensWord: 'токенов',
    agentsCount: 'агентов',
    isRunning: 'работает',
    isFinished: 'завершён',
    isPlanned: 'запланирована',
    opened: 'Панель агентов открыта.',
    closed: 'Панель агентов закрыта.',
    done: 'Готово',
    plan: 'План',
    design: 'Дизайн',
    tasks: 'Задачи',
    review: 'Ревью',
    busy: 'в работе',
    left: 'ещё',
    doneIn: 'готово за',
    workingOn: 'в работе',
    quiet: 'тихо',
    session: 'сессия',
    turn: 'ход',
    tomorrow: 'завтра',
    working: 'Работаю',
    thinking: 'думаю',
    rest: 'Готово, жду вас',
    waitFor: 'Жду',
    noRoom: 'Панель агентов не помещается по ширине. Введите /agents-info, чтобы открыть её.',
  },
  nl: {
    pane: 'Agents',
    cost: 'Kosten',
    tokens: 'Tokens',
    time: 'Tijd',
    collapse: 'Inklappen',
    expand: 'Uitklappen',
    running: 'Bezig',
    finished: 'Klaar',
    planned: 'Gepland',
    empty: 'Nog geen subagents.',
    round: 'ronde',
    failed: 'fout',
    after: 'na',
    tokensWord: 'tokens',
    agentsCount: 'agents',
    isRunning: 'bezig',
    isFinished: 'klaar',
    isPlanned: 'gepland',
    opened: 'Agents paneel geopend.',
    closed: 'Agents paneel gesloten.',
    done: 'Klaar',
    plan: 'Plan',
    design: 'Ontwerp',
    tasks: 'Taken',
    review: 'Nalopen',
    busy: 'bezig',
    left: 'nog',
    doneIn: 'klaar in',
    workingOn: 'bezig',
    quiet: 'stil',
    session: 'sessie',
    turn: 'beurt',
    tomorrow: 'morgen',
    working: 'Bezig',
    thinking: 'denkt na',
    rest: 'Klaar, wacht op jou',
    waitFor: 'Wacht op',
    noRoom: 'Het agents paneel past niet in deze breedte. Typ /agents-info om het te openen.',
  },
} as const

// Module scope is fine here: session.start sets it again on every (re)load.
let lang: Lang = 'en'
const tr = () => STRINGS[lang]

const isRussian = (v: unknown): boolean => typeof v === 'string' && /^(ru|russian|рус)/i.test(v.trim())
const isDutch = (v: unknown): boolean => typeof v === 'string' && /^(nl|dutch|nederlands)/i.test(v.trim())
const langOf = (v: unknown): Lang => (isRussian(v) ? 'ru' : isDutch(v) ? 'nl' : 'en')

async function detectLang($: EngineInterface, option: unknown): Promise<Lang> {
  if (option === 'en' || option === 'ru' || option === 'nl') return option
  try {
    const settings = (await $.settings.read()) as Record<string, unknown>
    if (typeof settings.language === 'string' && settings.language.trim()) return langOf(settings.language)
  } catch {
    // No settings: fall through to the locale.
  }
  const locale = (await $.env.get('LC_ALL')) || (await $.env.get('LC_MESSAGES')) || (await $.env.get('LANG'))
  return langOf(locale)
}

const blank = (): Flow => ({
  title: 'savvy-flow',
  total: 0,
  done: 0,
  running: 0,
  phase: 'plan',
  isFinished: false,
  tasks: [],
})

// The bar no flow reports to: it counts the runs since `at` and ends with the last of them.
const autoFlow = (at: number): Flow => ({ ...blank(), title: tr().pane, phase: 'delegate', isAuto: true, startedAt: at })

const isNewFlow = (prev: Flow | null, input: ProgressInput): boolean =>
  !prev || prev.isFinished || (input.title !== undefined && input.title.trim() !== prev.title)

const cleanTasks = (tasks: ProgressInput['tasks']): PlannedTask[] | undefined =>
  tasks
    ?.filter(t => t.title?.trim())
    .map(t => ({
      title: (t.title ?? '').trim(),
      tier: (t.tier ?? '').replace(/^savvy-/, '').trim().toLowerCase(),
      after: (t.after ?? []).filter(n => Number.isInteger(n) && n > 0),
    }))

const merge = (prev: Flow | null, input: ProgressInput): Flow => {
  // A new title means a new flow: never carry counters over from an earlier one.
  const base = isNewFlow(prev, input) || !prev ? blank() : { ...blank(), ...prev }
  const tasks = cleanTasks(input.tasks) ?? base.tasks
  const total = Math.max(0, Math.round(input.total ?? (input.tasks ? tasks.length : base.total)))
  const done = Math.min(total || Infinity, Math.max(0, Math.round(input.done ?? base.done)))
  const phase = input.phase && PHASES.includes(input.phase) ? input.phase : base.phase
  return {
    ...base,
    title: input.title?.trim() || base.title,
    total,
    done,
    phase: input.finished ? 'close' : phase,
    isFinished: input.finished === true,
    tasks,
  }
}

const label = (f: Flow): string => {
  const s = tr()
  if (f.isFinished) return s.done
  if (f.phase === 'plan') return s.plan
  if (f.phase === 'design') return s.design
  const count = f.total ? `${f.done}/${f.total}` : `${f.running} ${s.busy}`
  return `${f.phase === 'review' ? s.review : s.tasks} ${count}`
}

const ratio = (f: Flow): number => (f.isFinished ? 1 : f.total ? f.done / f.total : 0)

// Deterministic noise so the dither does not shimmer between redraws.
const noise = (x: number, y: number): number => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return s - Math.floor(s)
}

// The whole row is one SVG: the desktop wraps sibling elements onto new lines,
// so title, bar, percent and the crab live in one drawing; only the count and
// the dismiss are Buttons beside it.
const H = 22
const BAR_H = 16
const CRAB_W = 26
const CELL = 3
const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif"

const xml = (s: string): string =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

const clip = (s: string, max: number): string => (s.length > max ? s.slice(0, Math.max(1, max - 1)) + '…' : s)

// Rough advance of system UI text, in em; good enough to size the title's slot.
const charEm = (ch: string): number =>
  /[\s.,:;'|!il1()[\]]/.test(ch) ? 0.3 : /[A-ZА-ЯЁmwшщжюМШЩЖЮ@%]/.test(ch) ? 0.72 : 0.56

const textWidth = (s: string, size: number): number => [...s].reduce((w, ch) => w + charEm(ch) * size, 0)

// Cuts `s` to fit `maxW` pixels, with an ellipsis when it had to cut.
const fitText = (s: string, size: number, maxW: number): string => {
  if (textWidth(s, size) <= maxW) return s
  let out = ''
  for (const ch of s) {
    if (textWidth(out + ch + '…', size) > maxW) break
    out += ch
  }
  return out + '…'
}

const rowSvg = (f: Flow, W: number, isWorking: boolean): string => {
  // The title takes what it needs, up to 40% of the row; the bar takes the rest.
  const title = fitText(f.title, 13, Math.max(60, W * 0.4))
  const BAR_X = Math.round(16 + textWidth(title, 13) + 12)
  const BAR_W = Math.max(60, W - BAR_X - 46 - CRAB_W)
  const color = f.isFinished ? DONE : ACCENT
  const y0 = (H - BAR_H) / 2
  const fillW = Math.round(BAR_W * ratio(f))
  const runW = f.total ? Math.round((BAR_W * Math.min(f.total, f.done + f.running)) / f.total) : 0
  const dots: string[] = []

  // Dithered fill: sparse at the start, dense toward the head.
  const cols = Math.floor(fillW / CELL)
  const rows = Math.floor(BAR_H / CELL)
  for (let c = 0; c < cols; c++) {
    const density = 0.35 + 0.6 * Math.pow(c / Math.max(1, cols), 1.2)
    for (let r = 0; r < rows; r++) {
      if (noise(c, r) < density) dots.push(`<rect class="t${Math.floor(noise(r, c) * 4)}" x="${c * CELL + 1}" y="${r * CELL + 1}" width="2" height="2"/>`)
    }
  }
  // Handed to workers, not yet accepted: a faint second layer.
  const faint: string[] = []
  for (let c = cols; c < Math.floor(runW / CELL); c++) {
    for (let r = 0; r < rows; r++) {
      if (noise(c + 7, r + 3) < 0.2) faint.push(`<rect class="t${Math.floor(noise(r + 5, c) * 4)}" x="${c * CELL + 1}" y="${r * CELL + 1}" width="1.7" height="1.7"/>`)
    }
  }

  const ticks: string[] = []
  for (let i = 1; i < f.total; i++) {
    const x = Math.round((BAR_W * i) / f.total)
    if (x > fillW + 4) ticks.push(`<rect x="${x}" y="${BAR_H / 2 - 4}" width="1.5" height="8" rx="0.75"/>`)
  }

  const text = label(f)
  const pillW = Math.round(18 + text.length * 6.6)
  const pillX = Math.max(0, Math.min(BAR_W - pillW, fillW - pillW))
  const percent = `${Math.round(ratio(f) * 100)}%`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<style>
.t{fill:#1f1f1f}.m{fill:#8a8a8a}.k{fill:#e4e4e2}.tk{fill:#b4b4b0}
@media (prefers-color-scheme: dark){.t{fill:#ececec}.m{fill:#9a9a9a}.k{fill:#2c2c2c}.tk{fill:#5a5a5a}}
/* Pixels twinkle in four out-of-phase groups; a finished bar settles to a slow glow. */
.t0,.t1,.t2,.t3{animation:tw ${f.isFinished ? 3.2 : 2.2}s ease-in-out infinite}
.t1{animation-duration:${f.isFinished ? 3.8 : 2.8}s;animation-delay:-.7s}.t2{animation-duration:${f.isFinished ? 4.4 : 1.9}s;animation-delay:-1.3s}.t3{animation-duration:${f.isFinished ? 3.5 : 3.3}s;animation-delay:-.4s}
@keyframes tw{0%,100%{opacity:1}50%{opacity:${f.isFinished ? 0.8 : 0.3}}}
@media (prefers-reduced-motion: reduce){.t0,.t1,.t2,.t3{animation:none}}
</style>
<defs><clipPath id="c"><rect x="0" y="0" width="${BAR_W}" height="${BAR_H}" rx="${BAR_H / 2}"/></clipPath></defs>
<circle cx="5" cy="${H / 2}" r="4" fill="${color}"/>
<text class="t" x="16" y="${H / 2 + 4.5}" font-family="${FONT}" font-size="13" font-weight="500">${xml(title)}</text>
<g transform="translate(${BAR_X},${y0})">
<rect class="k" width="${BAR_W}" height="${BAR_H}" rx="${BAR_H / 2}"/>
<g clip-path="url(#c)">
<g fill="${color}">${dots.join('')}</g>
<g fill="${color}" opacity="0.45">${faint.join('')}</g>
<g class="tk">${ticks.join('')}</g>
</g>
<rect x="${pillX}" width="${pillW}" height="${BAR_H}" rx="${BAR_H / 2}" fill="${color}"/>
<text x="${pillX + pillW / 2}" y="${BAR_H / 2 + 4}" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="600" fill="#ffffff">${xml(text)}</text>
</g>
<text class="m" x="${W - CRAB_W - 6}" y="${H / 2 + 4.5}" text-anchor="end" font-family="${FONT}" font-size="12.5" font-variant-numeric="tabular-nums">${percent}</text>
${CRAB_CSS}${crab(W - CRAB_W + 1, 0, 'other', false, isWorking, 0.8)}
</svg>`
}

// ---------------------------------------------------------------------------
// Agents panel: every subagent of the session, plus the tasks the flow planned.

const TIER_COLOR: Record<string, string> = {
  fable: '#7F77DD',
  heavy: '#D85A30',
  careful: '#BA7517',
  medium: '#378ADD',
  light: '#1D9E75',
  other: '#888780',
}

// What each savvy tier runs on, for planned tasks that have no run yet.
const colorOf = (tier: string): string => TIER_COLOR[tier] ?? '#888780'

const TIER_MODEL: Record<string, string> = {
  fable: 'Fable · high',
  heavy: 'Opus · xhigh',
  careful: 'Opus · high',
  medium: 'Opus · medium',
  light: 'Opus · low',
}

// USD per million tokens: input, output, cache read, cache write (5-minute TTL).
// The engine reports tokens, not money, so the panel's cost is an estimate.
const PRICES: [RegExp, [number, number, number, number]][] = [
  [/fable|mythos/, [10, 50, 0.25, 12.5]],
  [/opus-5-5/, [4, 20, 0.2, 5]],
  [/opus/, [5, 25, 0.5, 6.25]],
  [/sonnet/, [2, 10, 0.2, 2.5]],
  [/haiku/, [1, 5, 0.1, 1.25]],
]

type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

const priceOf = (model: string): [number, number, number, number] =>
  PRICES.find(([re]) => re.test(model.toLowerCase()))?.[1] ?? [4, 20, 0.2, 5]

const costOf = (model: string, u: Usage): number => {
  const [i, o, r, w] = priceOf(model)
  return (
    ((u.input_tokens || 0) * i +
      (u.output_tokens || 0) * o +
      (u.cache_read_input_tokens || 0) * r +
      (u.cache_creation_input_tokens || 0) * w) /
    1e6
  )
}

const windowOf = (model: string): number => (/haiku/i.test(model) ? 200_000 : 1_000_000)

// `savvy-careful`, or `savvy-flow:savvy-careful` when the agents ship in a plugin.
const tierOf = (type: string): string => {
  const bare = type.replace(/^[^:]*:/, '')
  const t = bare.replace(/^savvy-/, '').toLowerCase()
  return t in TIER_COLOR && bare.startsWith('savvy-') ? t : 'other'
}

const modelName = (id: string): string => {
  const m = /(fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2})(?!\d))?/i.exec(id)
  const [, family = '', major = '', minor] = m ?? []
  if (!family) return id.replace(/^claude-/, '').replace(/\[.*\]$/, '') || '—'
  return `${family.charAt(0).toUpperCase()}${family.slice(1).toLowerCase()} ${major}${minor ? '.' + minor : ''}`
}

const norm = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

const fmtTokens = (n: number): string =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`

const fmtCost = (usd: number): string => `$${usd < 10 ? usd.toFixed(2) : usd.toFixed(1)}`

// The engine's own figures, to the cent as /cost and the status line show them.
const fmtCents = (usd: number): string => `$${usd.toFixed(2)}`

const fmtTime = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

const elapsed = (a: AgentRun, at: number): number => (a.endedAt ?? Math.max(at, a.startedAt)) - a.startedAt

type Planned = PlannedTask & { n: number }

const plannedOf = (f: Flow | null, list: AgentRun[]): Planned[] => {
  if (!f || f.isFinished) return []
  const started = new Set(list.map(a => norm(a.description)))
  return (f.tasks ?? []).map((t, i) => ({ ...t, n: i + 1 })).filter(t => !started.has(norm(t.title)))
}

const totals = (list: AgentRun[], at: number) => {
  const cost = list.reduce((s, a) => s + a.costUsd, 0)
  const tokens = list.reduce((s, a) => s + a.tokens, 0)
  const start = Math.min(...list.map(a => a.startedAt))
  const end = Math.max(...list.map(a => a.endedAt ?? Math.max(at, a.startedAt)))
  return { cost, tokens, time: list.length ? end - start : 0 }
}

// --- desktop drawings: each row is one SVG, as the band above the prompt is.

const PANE_CSS = `<style>
.t{fill:#1f1f1f}.s{fill:#6b6b68}.m{fill:#9a9a96}.k{fill:#ecebe8}.ln{stroke:#e4e4e1}.tile{fill:#f4f3f0}
@media (prefers-color-scheme: dark){.t{fill:#ececec}.s{fill:#a8a8a4}.m{fill:#7d7d79}.k{fill:#2c2c2b}.ln{stroke:#333331}.tile{fill:#262625}}
.live{animation:p 1.6s ease-in-out infinite}@keyframes p{50%{opacity:.3}}
@media (prefers-reduced-motion: reduce){.live{animation:none}}
</style>`

// Pixel Clawd from DockCrab (Clawdy): a 24×18 crab on a 30×28 grid, one costume per tier.
// The body keeps the brand clay; the tier's color lives in the costume's accent.
const CLAY = '#D97757'
const INK = '#1F1E1D'

// `cls` puts a pixel in a named group: `bd` (the default) is the body and its
// costume, `la`/`lb` the leg pairs, anything else a prop with its own motion.
type Fill = (x: number, y: number, w: number, h: number, c: string, cls?: string) => void

const stamp = (f: Fill, x: number, y: number, rows: string[], map: Record<string, string>, cls?: string): void =>
  rows.forEach((row, dy) => [...row].forEach((ch, dx) => map[ch] && f(x + dx, y + dy, 1, 1, map[ch] ?? '', cls)))

// `armCls` lets a raised claw travel with the prop it holds.
const crabBody = (f: Fill, armFront = 0, armCls?: string): void => {
  f(7, 10, 16, 12, CLAY)
  f(3, 14, 4, 4, CLAY)
  f(23, 14 + armFront, 4, 4, CLAY, armCls)
  f(9, 12, 2, 2, INK)
  f(19, 12, 2, 2, INK)
  f(7, 22, 2, 4, CLAY, 'la')
  f(17, 22, 2, 4, CLAY, 'la')
  f(11, 22, 2, 4, CLAY, 'lb')
  f(21, 22, 2, 4, CLAY, 'lb')
}

// Pure CSS, run by the compositor: no redraws. Periods divide one second, so the
// once-a-second redraw of a running row restarts them in phase. Every crab walks;
// each costume adds its prop's own motion on top.
const CRAB_CSS = `<style>
.run .la{animation:st .5s steps(1) infinite}.run .lb{animation:st .5s steps(1) infinite -.25s}
.run .bd{animation:bob .5s steps(1) infinite -.125s}
.run g{transform-box:fill-box}
@keyframes st{50%{transform:translateY(-1px)}}@keyframes bob{50%{transform:translateY(1px)}}
.c-fable.run{animation:float 1s ease-in-out infinite}
.c-fable.run .la,.c-fable.run .lb,.c-fable.run .bd{animation:none}
.c-fable.run .ant{animation:blink 1s steps(1) infinite}
.c-fable.run .star{animation:blink .5s steps(1) infinite -.25s}
@keyframes float{50%{transform:translateY(-2px)}}@keyframes blink{50%{opacity:.15}}
.c-heavy.run .it{animation:scan 1s steps(1) infinite}
.c-heavy.run .gl{animation:blink 1s steps(1) infinite -.5s}
@keyframes scan{25%{transform:translate(-1px,1px)}50%{transform:translate(-2px,2px)}75%{transform:translate(-1px,1px)}}
.c-careful.run .it{transform-origin:100% 100%;animation:twist .5s ease-in-out infinite}
@keyframes twist{50%{transform:rotate(-35deg)}}
.c-medium.run .pan{transform-origin:0 50%;animation:tilt 1s ease-in-out infinite}
.c-medium.run .egg{animation:flip 1s ease-in-out infinite}
@keyframes tilt{20%,40%{transform:rotate(-12deg)}}@keyframes flip{30%{transform:translateY(-5px) scaleY(-1)}60%{transform:translateY(0)}}
.c-light.run .la{animation-duration:.25s}.c-light.run .lb{animation-duration:.25s;animation-delay:-.125s}
.c-light.run .flag{transform-origin:0 50%;animation:wave .25s steps(1) infinite}
@keyframes wave{50%{transform:skewY(-12deg) scaleX(.85)}}
.c-explore.run .it{transform-origin:50% 100%;animation:fence .5s ease-in-out infinite}
@keyframes fence{50%{transform:rotate(25deg)}}
@media (prefers-reduced-motion: reduce){.run,.run g{animation:none!important}}
</style>`

const COSTUMES: Record<string, (f: Fill, t: string) => void> = {
  // Fable: astronaut in a glass dome; floats instead of walking, the antenna and the star blink.
  fable: (f, t) => {
    crabBody(f)
    f(6, 7, 18, 1, '#E6E8EE'); f(5, 8, 1, 14, '#E6E8EE'); f(24, 8, 1, 14, '#E6E8EE'); f(6, 22, 18, 1, '#C9CCD2')
    f(6, 8, 18, 14, 'rgba(169,214,245,.32)'); f(8, 9, 2, 1, '#fff'); f(8, 10, 1, 2, '#fff')
    f(14, 4, 2, 3, '#C9CCD2'); f(14, 2, 2, 2, t, 'ant'); f(13, 18, 4, 2, t)
    f(27, 3, 1, 3, '#F5C542', 'star'); f(26, 4, 3, 1, '#F5C542', 'star')
  },
  // Heavy: detective with a deerstalker; the magnifier sweeps and glints.
  heavy: (f, t) => {
    crabBody(f, -4, 'it')
    stamp(f, 6, 3, ['......bbbbbb......', '....bbcbbcbbbb....', '...bbbbbbbbbbbb...', '..bcbbcbbcbbcbbb..', '.bbbbbbbbbbbbbbbb.', 'dddddddddddddddddd'], { b: '#7A4A26', c: '#A0703F', d: '#5A3519' })
    f(6, 9, 18, 1, t)
    stamp(f, 23, 1, ['.kkk.', 'k...k', 'k...k', 'k...k', '.kkk.'], { k: '#3A3A3C' }, 'it')
    f(24, 2, 3, 3, 'rgba(169,214,245,.7)', 'it'); f(25, 6, 1, 4, '#7A4A26', 'it'); f(24, 2, 1, 1, '#fff', 'gl')
  },
  // Careful: engineer in a hard hat; the wrench turns a bolt.
  careful: (f, t) => {
    crabBody(f)
    stamp(f, 6, 4, ['.....yyyyyyyy.....', '...yyyyyhhyyyyy...', '..yyyyyyhhyyyyyy..', '..yyyyyyhhyyyyyy..', '.yyyyyyyhhyyyyyyy.', 'dddddddddddddddddd'], { y: '#F5C542', h: '#FBE08A', d: '#C99A1E' })
    f(13, 5, 4, 2, t)
    stamp(f, 0, 10, ['.s.s', 'sss.', '.s..', '.s..'], { s: '#8E929A' }, 'it')
  },
  // Medium: chef, the toque traced from DockCrab's Sprites.chefHat; tosses the omelette.
  medium: (f, t) => {
    crabBody(f, -4, 'pan')
    stamp(f, 6, 0, ['........lll.......', '.......lllll......', '.wwwwgwwwwwwgwwwww', 'wwwwwwwwwwwwwwwwww', 'wwwwwwwwwwwwwwwwww', 'wwwwwgwwwwwggwwwww', '.wwwwgwwwwwggwwwww', '.dddbbbbbbbbbbbbb.', '.dddbbbbbbbbbbbbb.', '.dddbbbbbbbbbbbbb.'], { w: '#F4F3EE', l: '#F7F6F2', g: '#D2D1C8', b: t, d: '#B45F43' })
    f(22, 8, 7, 2, '#4A4A48', 'pan'); f(26, 10, 1, 1, '#4A4A48', 'pan'); f(24, 7, 3, 1, '#F5B731', 'egg')
  },
  // Light: racer in a helmet; runs at double pace, the checkered flag flutters.
  light: (f, t) => {
    crabBody(f, -4)
    stamp(f, 6, 5, ['....rrrrrrrrrr....', '..rrrrrrwwrrrrrr..', '.rrrrrrrwwrrrrrrr.', '.rrrrrrrwwrrrrrrr.', '.rrrrrrrwwrrrrrrr.', '.kkkkkkkkkkkkkkkkr'], { r: t, w: '#F8F6F1', k: INK })
    f(25, 1, 1, 9, '#8E929A')
    stamp(f, 26, 1, ['wkwk', 'kwkw', 'wkwk'], { w: '#F8F6F1', k: INK }, 'flag')
  },
  // Explore: pirate scouting the code; the cutlass fences.
  explore: f => {
    crabBody(f)
    stamp(f, 5, 3, ['.kk..............kk.', '.kkk....kkkk....kkk.', '..kkkkkkkwwkkkkkkk..', '..kkkkkkkkkkkkkkkk..', '.gggggggggggggggggg.'], { k: '#55514C', w: '#F8F6F1', g: '#F5C542' })
    f(7, 11, 11, 1, INK); f(18, 11, 4, 3, INK)
    f(27, 6, 1, 9, '#C9CCD2', 'it'); f(26, 15, 3, 1, '#7A4A26', 'it')
  },
  other: f => crabBody(f),
}

const costumeOf = (type: string): string => (type === 'Explore' ? 'explore' : tierOf(type))

// A worker of a type no costume was drawn for borrows one of these as it
// starts, in this order, and keeps it for the run.
const SPARE_COSTUMES = ['medium', 'light', 'careful', 'heavy', 'fable', 'explore'] as const

const dress = (type: string, worn: readonly AgentRun[]): string => {
  const own = costumeOf(type)
  return own !== 'other' || !type ? own : pickCostume(type, worn, SPARE_COSTUMES)
}

const CRAB_SCALE = 1.1

// Body and props nest inside `bd` so a prop rides the bob and adds its own motion;
// legs stay outside it and step on their own.
const crab = (x: number, y: number, costume: string, dim = false, isWalking = false, scale = CRAB_SCALE): string => {
  const groups = new Map<string, string[]>([['bd', []]])
  const f: Fill = (cx, cy, w, h, c, cls = 'bd') => {
    if (!groups.has(cls)) groups.set(cls, [])
    groups.get(cls)?.push(`<rect x="${cx}" y="${cy}" width="${w}" height="${h}" fill="${c}"/>`)
  }
  const draw = COSTUMES[costume] ?? ((g: Fill) => crabBody(g))
  draw(f, colorOf(costume))
  const group = (cls: string) => `<g class="${cls}">${(groups.get(cls) ?? []).join('')}</g>`
  const props = [...groups.keys()].filter(k => k !== 'bd' && k !== 'la' && k !== 'lb')
  const body = `<g class="bd">${(groups.get('bd') ?? []).join('')}${props.map(group).join('')}</g>`
  return `<g transform="translate(${x},${y}) scale(${scale})" opacity="${dim ? 0.45 : 1}" shape-rendering="crispEdges"><g class="c-${costume}${isWalking ? ' run' : ''}">${body}${group('la')}${group('lb')}</g></g>`
}

const statusMark = (x: number, y: number, status: string, color: string): string => {
  if (status === 'running') return `<circle class="live" cx="${x}" cy="${y}" r="3.5" fill="${color}"/>`
  if (status === 'done') return `<path d="M${x - 5} ${y}l3.5 3.5 6.5-7" fill="none" stroke="#3B9C5F" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`
  if (status === 'failed') return `<path d="M${x - 4} ${y - 4}l8 8M${x + 4} ${y - 4}l-8 8" stroke="#D0453F" stroke-width="1.8" stroke-linecap="round"/>`
  return `<circle cx="${x}" cy="${y}" r="5" fill="none" stroke="#9a9a96" stroke-width="1.4"/><path d="M${x} ${y - 2.5}v2.8l1.8 1.2" fill="none" stroke="#9a9a96" stroke-width="1.4" stroke-linecap="round"/>`
}

const svg = (W: number, H: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${PANE_CSS}${CRAB_CSS}${body}</svg>`

// The pane's own title already says "Agents": the header names the flow, if any.
const headerSvg = (W: number, title: string, t: ReturnType<typeof totals>): string => {
  const s = tr()
  const gap = 6
  const tw = (W - gap * 2) / 3
  const top = title ? 28 : 0
  const tile = (i: number, k: string, v: string) =>
    `<rect class="tile" x="${i * (tw + gap)}" y="${top}" width="${tw}" height="40" rx="8"/>
<text class="s" x="${i * (tw + gap) + 9}" y="${top + 16}" font-family="${FONT}" font-size="11">${k}</text>
<text class="t" x="${i * (tw + gap) + 9}" y="${top + 33}" font-family="${FONT}" font-size="15" font-weight="600" font-variant-numeric="tabular-nums">${v}</text>`
  return svg(
    W,
    headerHeight(title),
    `${title ? `<text class="t" x="0" y="15" font-family="${FONT}" font-size="14" font-weight="600">${xml(fitText(title, 14, W))}</text>` : ''}
${tile(0, s.cost, '≈' + fmtCost(t.cost))}${tile(1, s.tokens, fmtTokens(t.tokens))}${tile(2, s.time, fmtTime(t.time))}`,
  )
}

const headerHeight = (title: string): number => (title ? 72 : 44)

// The task's own progress when the worker reports steps; a finished run is full.
const progressOf = (a: AgentRun): number | null => {
  if (a.status === 'done') return 1
  if (a.stepTotal) return Math.min(1, (a.stepDone ?? 0) / a.stepTotal)
  return null
}

const ctxOf = (a: AgentRun): number => (a.contextMax ? Math.min(100, Math.round((a.contextTokens / a.contextMax) * 100)) : 0)

// The runs that are the flow's own work: those its plan names, or with no plan
// listed the savvy workers. Any other subagent of the session is not counted,
// nor is a run still going from an earlier flow. A flow that started by itself
// has no plan: its work is every run since it began.
const flowRuns = (f: Flow, list: AgentRun[]): AgentRun[] => {
  if (f.isAuto) return list.filter(a => a.startedAt >= (f.startedAt ?? 0))
  const planned = new Set((f.tasks ?? []).map(t => norm(t.title)))
  return list.filter(a => (planned.size ? planned.has(norm(a.description)) : tierOf(a.type) !== 'other'))
}

// A flow that started by itself, with its runs counted as its tasks, so the
// bar's text and count read the same way as a planned flow's.
const counted = (f: Flow, runs: AgentRun[]): Flow =>
  f.isAuto ? { ...f, total: runs.length, done: runs.filter(a => a.status === 'done').length } : f

// The share of the flow's work that is done, counting the steps the workers
// report and not only whole tasks, so the terminal's bar moves while they run.
// A review round runs a task again: per task the furthest run counts, once,
// and a failed run not at all. A finished run counts as a whole task before
// the orchestrator accepts it; short of the close the bar stops just under full.
const liveRatio = (f: Flow, runs: AgentRun[]): number => {
  if (f.isFinished) return 1
  const total = f.isAuto ? runs.length : f.total
  if (!total) return 0
  const perTask = new Map<string, number>()
  for (const a of runs) {
    if (a.status === 'failed') continue
    // Unplanned runs are each their own task, whatever they are called.
    const task = f.isAuto ? a.id : norm(a.description) || a.id
    perTask.set(task, Math.max(perTask.get(task) ?? 0, progressOf(a) ?? 0))
  }
  const reported = [...perTask.values()].reduce((sum, x) => sum + x, 0)
  return Math.min(0.99, Math.max(f.isAuto ? 0 : f.done, Math.min(total, reported)) / total)
}

// The longest a running worker of the flow has gone without a sign of life,
// once that is long enough to say: minutes, or 0.
const stalledMinutes = (runs: AgentRun[], at: number): number => {
  const idle = Math.max(0, ...runs.filter(a => a.status === 'running').map(a => at - (a.lastAt ?? a.startedAt)))
  return idle >= STALL_MS ? Math.floor(idle / 60_000) : 0
}

// The text inside the terminal's bar: percent and the time left at the pace so
// far, or the label alone while no plan says how much work there is.
const barLabel = (f: Flow, target: number, shown: number, time: number): string => {
  const s = tr()
  if (f.isFinished) return `100% · ${s.doneIn} ${fmtTime(time)}`
  if (!f.total) return label(f)
  const left = target > MIN_RATIO_FOR_ESTIMATE && time > 0 ? fmtTime((time * (1 - target)) / target) : '…'
  return `${Math.round(shown * 100)}% · ${s.left} ${left}`
}

// What is being worked on right now: the first running tasks with the step
// each reports, the rest counted; with nothing running, where the flow stands.
const nowLine = (f: Flow, list: AgentRun[], count: number, tokens: number): string => {
  const s = tr()
  if (f.isFinished) return `${count} ${s.agentsCount} · ${fmtTokens(tokens)} ${s.tokensWord}`
  const running = list.filter(a => a.status === 'running').reverse()
  if (running.length === 0) return label(f)
  const named = running.slice(0, NOW_SHOWN).map(a => {
    const name = a.description || a.type
    return a.stepNote ? `${name}: ${a.stepNote}` : name
  })
  const rest = running.length - named.length
  return `${s.workingOn}: ${named.join(' · ')}${rest > 0 ? ` · +${rest}` : ''}`
}

const agentSvg = (W: number, a: AgentRun, at: number): string => {
  const s = tr()
  const tier = tierOf(a.type)
  const color = colorOf(tier)
  const ctx = ctxOf(a)
  const textW = W - 42 - 22
  const meta = [a.effort ? `${modelName(a.model)} · ${a.effort}` : modelName(a.model)]
  if (a.round > 1) meta.push(`${s.round} ${a.round}`)
  if (a.status === 'failed') meta.push(s.failed)
  const barW = textW
  const progress = progressOf(a)
  const stats = `ctx ${ctx}% · ${fmtTokens(a.contextTokens)}  ≈${fmtCost(a.costUsd)}  ${fmtTime(elapsed(a, at))}`
  const steps = a.stepTotal ? `${a.stepDone ?? 0}/${a.stepTotal}${a.stepNote ? ' · ' + a.stepNote : ''}` : ''
  const stepsW = Math.max(0, barW - textWidth(stats, 11) - 12)
  // Without reported steps the bar falls back to the context, drawn grey.
  const fillW = Math.round(barW * (progress ?? ctx / 100))
  return svg(
    W,
    66,
    `${crab(0, 14, costumeOf(a.type), false, a.status === 'running')}
<text class="t" x="42" y="18" font-family="${FONT}" font-size="13" font-weight="600">${xml(fitText(a.description || a.type, 13, textW))}</text>
<text x="42" y="34" font-family="${FONT}" font-size="11"><tspan fill="${color}">${xml(tier === 'other' ? a.type : tier)}</tspan><tspan class="s">  ${xml(meta.join('  ·  '))}</tspan></text>
${steps && stepsW > 30 ? `<text class="t" x="42" y="49" font-family="${FONT}" font-size="11" font-variant-numeric="tabular-nums">${xml(fitText(steps, 11, stepsW))}</text>` : ''}
<text class="s" x="${42 + barW}" y="49" text-anchor="end" font-family="${FONT}" font-size="11" font-variant-numeric="tabular-nums">${stats}</text>
<rect class="k" x="42" y="55" width="${barW}" height="4" rx="2"/><rect${progress === null ? ' class="m"' : ''} x="42" y="55" width="${fillW}" height="4" rx="2"${progress === null ? '' : ` fill="${color}"`}/>
${statusMark(W - 8, 16, a.status, color)}
<line class="ln" x1="0" y1="65.5" x2="${W}" y2="65.5"/>`,
  )
}

const plannedSvg = (W: number, p: Planned): string => {
  const tier = p.tier in TIER_COLOR ? p.tier : 'other'
  const color = colorOf(tier)
  const textW = W - 42 - 22
  const meta = [TIER_MODEL[tier] ?? '']
  if (p.after.length) meta.push(`${tr().after} ${p.after.join(', ')}`)
  return svg(
    W,
    46,
    `${crab(0, 6, tier, true)}
<text class="s" x="42" y="18" font-family="${FONT}" font-size="13" font-weight="600">${xml(fitText(`${p.n}. ${p.title}`, 13, textW))}</text>
<text x="42" y="34" font-family="${FONT}" font-size="11"><tspan fill="${color}">${xml(tier)}</tspan><tspan class="m">  ${xml(meta.filter(Boolean).join('  ·  '))}</tspan></text>
${statusMark(W - 8, 16, 'planned', color)}
<line class="ln" x1="0" y1="45.5" x2="${W}" y2="45.5"/>`,
  )
}

const compactSvg = (W: number, list: AgentRun[], planned: Planned[], t: ReturnType<typeof totals>): string => {
  const icons = [
    ...list.filter(a => a.status === 'running').map(a => ({ k: costumeOf(a.type), c: colorOf(tierOf(a.type)), s: 'running', dim: false })),
    ...list.filter(a => a.status !== 'running').map(a => ({ k: costumeOf(a.type), c: colorOf(tierOf(a.type)), s: a.status, dim: false })),
    ...planned.map(p => ({ k: p.tier in TIER_COLOR ? p.tier : 'other', c: colorOf(p.tier), s: 'planned', dim: true })),
  ]
  const fit = Math.max(1, Math.floor((W - 150) / 36))
  const shown = icons.slice(0, fit)
  const more = icons.length - shown.length
  const body = shown
    .map((ic, i) => crab(i * 36, 0, ic.k, ic.dim, ic.s === 'running') + (ic.s === 'running' ? `<circle class="live" cx="${i * 36 + 32}" cy="4" r="3" fill="${ic.c}"/>` : ''))
    .join('')
  const x = shown.length * 36 + (more ? 4 : 0)
  return svg(
    W,
    32,
    `${body}${more ? `<text class="s" x="${x}" y="21" font-family="${FONT}" font-size="12">+${more}</text>` : ''}
<text class="s" x="${W}" y="21" text-anchor="end" font-family="${FONT}" font-size="12" font-variant-numeric="tabular-nums">≈${fmtCost(t.cost)} · ${fmtTokens(t.tokens)} · ${fmtTime(t.time)}</text>`,
  )
}

// --- terminal drawing: the same rows in text.

const STATUS_GLYPH: Record<string, string> = { running: '●', done: '✓', failed: '✗', planned: '◷' }

// Opens the pane. One the mod opens unasked waits undrawn on a narrow
// terminal: the person is told how to seat it, once until it next finds room,
// however many workers asked for it. Module scope is fine for the flag: the
// check and the set are one step, and a reload may say it once more.
let hasToldNoRoom = false
async function openPane($: EngineInterface): Promise<void> {
  const opened = await $.ui.open({ id: PANE, title: tr().pane, columns: PANE_COLUMNS })
  if (!opened.isPlaced && !hasToldNoRoom) $.ui.toast(tr().noRoom)
  hasToldNoRoom = !opened.isPlaced
}

// For an open nobody waits on: a refused one leaves the band to tell the story.
const openPaneUnasked = ($: EngineInterface): void => void openPane($).catch(() => undefined)

// Opens the agents pane, or closes it when it is up; true when it ends up open.
async function togglePane($: EngineInterface): Promise<boolean> {
  const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
  if (isOpen) {
    await $.ui.close({ id: PANE })
    return false
  }
  const at = await $.clock.now()
  await update($, now, () => at)
  await openPane($)
  return true
}

async function isPaneOpen($: EngineInterface): Promise<boolean> {
  try {
    return (await $.ui.panes()).some(p => p.id === PANE)
  } catch {
    // A surface that does not list its panes: open it and let it sort that out.
    return false
  }
}

// Opens the pane for a flow's plan, once per flow: closed by the person, it
// stays closed until a worker starts.
async function autoOpen($: EngineInterface, key: string): Promise<void> {
  const p = await read($, panel)
  if (p.autoOpenedFor === key) return
  const isOpen = await isPaneOpen($)
  await update($, panel, prev => ({ ...prev, autoOpenedFor: key }))
  if (!isOpen) openPaneUnasked($)
}

// A worker starting brings the pane up and its crabs out, whatever the person
// did to it before: closed by hand or collapsed to glyphs, it comes back.
async function showForAgent($: EngineInterface): Promise<void> {
  const isOpen = await isPaneOpen($)
  await update($, panel, prev => ({ ...prev, isCompact: false }))
  if (!isOpen) openPaneUnasked($)
}

// The pane leaves once no worker runs and no flow is under way, whoever opened it.
async function closeIfIdle($: EngineInterface): Promise<void> {
  const f = await read($, flow)
  const isBusy = (f !== null && !f.isFinished) || (await read($, agents)).some(a => a.status === 'running')
  if (isBusy) return
  if (await isPaneOpen($)) await $.ui.close({ id: PANE })
}

// Puts the record straight: a run whose end never arrived (the process
// restarted, an agent was lost) is ended, an agents bar with nothing left
// running is cleared, and the pane goes with them. A pane with nothing to
// tidy under it is the person's own and stays.
async function settle($: EngineInterface): Promise<void> {
  let live: Set<string>
  try {
    live = new Set((await $.agent.list()).filter(a => !ENDED.has(a.status)).map(a => a.id))
  } catch {
    // No list to check the runs against: they stand as they are.
    return
  }
  // A run with no id of its own (a workflow's agent) is in no list: it is left alone.
  const isLost = (a: AgentRun): boolean => a.status === 'running' && a.agentId !== undefined && !live.has(a.agentId)
  const before = await read($, agents)
  const hasLost = before.some(isLost)
  if (hasLost) {
    const at = await $.clock.now()
    await update($, agents, list => list.map(a => (isLost(a) ? { ...a, status: 'failed', endedAt: at } : a)))
  }
  const isIdle = !(await read($, agents)).some(a => a.status === 'running')
  const hasStaleBar = isIdle && (await read($, flow))?.isAuto === true
  if (hasStaleBar) await update($, flow, f => (f?.isAuto ? null : f))
  if (hasLost || hasStaleBar) await closeIfIdle($)
}

// The session's cost as the engine totals it, the figure /cost and the status
// line show; nothing where the host keeps no ledger.
async function spentNow($: EngineInterface): Promise<number | undefined> {
  try {
    return (await $.session.usage()).cost?.usd
  } catch {
    return undefined
  }
}

// Asks the weather for the place set and keeps it for the band; what is kept
// when the fetch fails is `latestWeather`'s to say.
async function refreshWeather($: EngineInterface, place: string): Promise<void> {
  const url = weatherUrl(place)
  if (!url) return
  const at = await $.clock.now()
  const fresh = await $.http
    .fetch(url)
    .then(res => (res.ok ? parseWeather(res.text, at) : null))
    .catch(() => null)
  await update($, weather, prev => latestWeather(prev, fresh, at))
}

// Keeps the session's total the band reads; a figure that did not move redraws nothing.
async function noteSpent($: EngineInterface, usd: number | undefined): Promise<void> {
  if (usd !== undefined) await update($, main, prev => (prev.costNow === usd ? prev : { ...prev, costNow: usd }))
}

// Module scope is fine for these: they cache a drawing, and a reload starts
// them over with the first render. `isTerminal` keeps the frame timer off a
// desktop, whose SVG animates itself and would restart on every redraw.
let isTerminal = false
let isGliding = false
let shown: Shown = { ratio: 0, at: 0 }

export const register: Register = (on, options) => {
  const weatherPlace = typeof options.weatherPlace === 'string' ? options.weatherPlace : ''
  // A setting that is no hex color would make the engine refuse the whole row.
  const setColor = typeof options.barColor === 'string' ? options.barColor.trim() : ''
  const barColor = HEX_COLOR.test(setColor) ? setColor : BLUE

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    lang = await detectLang($, options.language)
    await $.tool.register({
      name: 'progress',
      description:
        'Report /savvy-flow progress to the progress bar above the prompt and the agents panel. ' +
        'Call it after presenting the plan (title, total, tasks, phase "delegate"), each time a task is accepted (done), ' +
        'when switching phase or re-planning (tasks), and once at the end with finished: true. Fields left out keep their previous value.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short name of the overall task, a few words.' },
          total: { type: 'integer', minimum: 0, description: 'Number of planned worker tasks.' },
          done: { type: 'integer', minimum: 0, description: 'Number of tasks accepted after review.' },
          phase: { type: 'string', enum: [...PHASES] },
          finished: { type: 'boolean', description: 'True once the flow is closed.' },
          tasks: {
            type: 'array',
            description:
              'The planned worker tasks in order, numbered from 1. Each title must equal the Agent tool `description` the task will be delegated with, so the panel can match runs to tasks.',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'A few words; reused verbatim as the Agent description.' },
                tier: { type: 'string', enum: ['fable', 'heavy', 'careful', 'medium', 'light'] },
                after: { type: 'array', items: { type: 'integer' }, description: 'Numbers of the tasks this one waits for.' },
              },
              required: ['title', 'tier'],
            },
          },
        },
      },
    })
    await $.tool.register({
      name: 'step',
      description:
        'For savvy-flow workers: report progress on your own task to the agents panel. ' +
        'Right after reading the brief, call it with `total` (your plan in 3-8 steps) and `done: 0`; ' +
        'call it again as each step finishes. Cheap and silent: it only draws a bar.',
      inputSchema: {
        type: 'object',
        properties: {
          done: { type: 'integer', minimum: 0, description: 'Steps finished so far.' },
          total: { type: 'integer', minimum: 1, description: 'Steps planned; may change if the plan changes.' },
          note: { type: 'string', description: 'The step in progress, a few words.' },
        },
        required: ['done'],
      },
    })
    await $.command.register({
      name: 'agents-info',
      description: 'Show or hide the panel of subagents: running, finished and planned, with model, context, cost and time',
    })

    // Ticks the running agents' clocks; quiet when nothing runs.
    $.clock.every(1000, () => {
      void (async () => {
        const list = await read($, agents)
        if (!list.some(a => a.status === 'running')) return
        const at = await $.clock.now()
        await update($, now, () => at)
      })()
    })
    // The terminal's crabs and bars: redrawn while the main session or a worker
    // runs, or a bar slides to its new value.
    $.clock.every(FRAME_MS, () => {
      void (async () => {
        if (!isTerminal) return
        const isMoving = isGliding || (await read($, main)).isWorking || (await read($, agents)).some(a => a.status === 'running')
        if (isMoving) $.ui.invalidate('ui.render')
      })()
    })
    // The weather, now and every half hour; decoration, so a failure is no one's trouble.
    const askWeather = (): void => void refreshWeather($, weatherPlace).catch(() => undefined)
    askWeather()
    $.clock.every(WEATHER_EVERY_MS, askWeather)
    // A load starts no turn: one under way reports itself with its next start.
    const usd = await spentNow($)
    await update($, main, prev => ({ ...prev, isWorking: false, activity: '', costNow: usd ?? prev.costNow }))
    // Tidying up is no reason to fail the load.
    await settle($).catch(() => undefined)
    return started
  })

  on('command.run', { command: 'agents-info' }, async $ => {
    const isOpen = await togglePane($)
    return { text: isOpen ? tr().opened : tr().closed }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const input = e as unknown as ProgressInput
    const prev = await read($, flow)
    if (isNewFlow(prev, input) && input.title !== undefined) {
      // A new flow starts with a clean list; agents still running stay.
      await update($, agents, list => list.filter(a => a.status === 'running'))
    }
    const next = await update($, flow, p => merge(p, input))
    if (next && input.tasks?.length) await autoOpen($, next.title)
    // A flow that closes takes the pane with it, unless something still runs.
    if (next?.isFinished) $.clock.after(PANE_HIDE_MS, () => void closeIfIdle($))
    return { result: `ok: ${label(next ?? blank())}` }
  })

  // A worker's own progress: the call runs in the worker's loop, so agentId names it.
  on('tool.call', { tool: STEP_TOOL }, async ($, e) => {
    const input = e as unknown as { done?: number; total?: number; note?: string }
    const agentId = e.agentId
    if (!agentId) return { result: 'ignored: only subagents report steps' }
    const at = await $.clock.now()
    await update($, agents, list =>
      list.map(a => {
        if (a.agentId !== agentId) return a
        const total = Math.max(0, Math.round(input.total ?? a.stepTotal ?? 0))
        const done = Math.max(0, Math.round(input.done ?? a.stepDone ?? 0))
        return { ...a, lastAt: at, stepTotal: total, stepDone: total ? Math.min(total, done) : done, stepNote: input.note?.trim() || undefined }
      }),
    )
    return { result: 'ok' }
  })

  // Safety net: worker launches move the faint layer even if the orchestrator forgets to report.
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const type = String(e.subagent_type ?? '')
    if (!type.startsWith('savvy-')) return next(e)

    const at = await $.clock.now()
    await update($, flow, prev => {
      // With no flow reporting, the bar counts the runs by itself, and so also ends by itself.
      const base = prev && !prev.isFinished ? { ...blank(), ...prev } : autoFlow(at)
      return { ...base, running: base.running + 1, phase: base.phase === 'plan' ? 'delegate' : base.phase }
    })
    try {
      return await next(e)
    } finally {
      await update($, flow, prev => (prev ? { ...prev, running: Math.max(0, prev.running - 1) } : prev))
    }
  })

  // What the main session has in hand: each tool call of its own loop is named
  // in the band while it runs. A subagent's calls are its own business. The
  // hook only watches: should it fail, the call goes on as if it were not there.
  on('tool.call', async ($, e, next) => {
    if (e.agentId) return next(e)
    const note = toolNote(e as unknown as Record<string, unknown>)
    await update($, main, prev => ({ ...prev, activity: note }))
    try {
      return await next(e)
    } finally {
      // Back to thinking, unless a call started since is the one in hand.
      // Limit: two calls under way with the same note share it, and the first
      // to end clears it; count the calls per note if that ever shows.
      await update($, main, prev => (prev.activity === note ? { ...prev, activity: '' } : prev))
    }
  }).catch(($, e, next) => next(e))

  // The person's own prompt starts a turn: its cost counts from here, and the
  // record is put straight first. A notification or a peer's message continues it.
  on('prompt.submit', async ($, e, next) => {
    if (isPersonsPrompt(e.origin)) {
      const usd = await spentNow($)
      await update($, main, prev => ({ ...prev, costAtStart: usd ?? prev.costNow, costNow: usd ?? prev.costNow }))
      await settle($)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    const at = await $.clock.now()
    await update($, main, prev => ({ ...prev, isWorking: true, startedAt: at, activity: '', costAtStart: prev.costAtStart ?? prev.costNow }))
    return next(e)
  })

  // The engine's own total, where it says that it grew. Seen live on 2.1.295 it
  // says so rarely, so each answered request asks as well (turn.step below).
  on('session.measure', async ($, e, next) => {
    await noteSpent($, e.cost?.usd)
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny !== undefined) return started

    const at = await $.clock.now()
    await update($, agents, list => {
      const round = 1 + list.filter(a => norm(a.description) === norm(e.description) && e.description).length
      const run: AgentRun = {
        id: started.agentId ?? e.tool_use_id,
        agentId: started.agentId,
        type: e.subagentType,
        costume: dress(e.subagentType, list),
        description: e.description,
        model: started.model,
        status: 'running',
        startedAt: at,
        lastAt: at,
        contextTokens: 0,
        contextMax: windowOf(started.model),
        tokens: 0,
        costUsd: 0,
        steps: 0,
        round,
      }
      return [...list.filter(a => a.id !== run.id), run].slice(-200)
    })
    await update($, now, () => at)
    // No flow reporting: the bar starts by itself and counts the runs from here.
    await update($, flow, prev => (prev && !prev.isFinished ? prev : autoFlow(at)))
    await showForAgent($)
    return started
  })

  // Each model request of a subagent: live context, tokens and cost.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    // Every answered request moves the session's total, the main session's and a subagent's alike.
    await noteSpent($, await spentNow($))
    const agentId = e.agentId
    const usage = result.usage
    if (!agentId || !usage) return result

    const model = usage.model || e.model
    const at = await $.clock.now()
    await update($, agents, list =>
      list.map(a =>
        a.agentId !== agentId
          ? a
          : {
              ...a,
              lastAt: at,
              model,
              effort: typeof e.effort === 'string' ? e.effort : a.effort,
              status: 'running',
              endedAt: undefined,
              contextTokens:
                (usage.input_tokens || 0) +
                (usage.cache_read_input_tokens || 0) +
                (usage.cache_creation_input_tokens || 0) +
                (usage.output_tokens || 0),
              contextMax: windowOf(model),
              tokens:
                a.tokens +
                (usage.input_tokens || 0) +
                (usage.output_tokens || 0) +
                (usage.cache_read_input_tokens || 0) +
                (usage.cache_creation_input_tokens || 0),
              costUsd: a.costUsd + costOf(model, usage),
              steps: a.steps + 1,
            },
      ),
    )
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const agentId = e.agentId
    if (!agentId) {
      // The main turn is over: the band rests, with what the turn came to.
      const usd = await spentNow($)
      await update($, main, prev => ({ ...prev, isWorking: false, activity: '', costNow: usd ?? prev.costNow }))
    } else {
      const at = await $.clock.now()
      await update($, agents, list =>
        list.map(a => {
          if (a.agentId !== agentId) return a
          // A run whose steps went unseen still gets the turn's own sum.
          const fallback = a.steps === 0 && e.usage
          return {
            ...a,
            status: e.reason === 'answer' ? 'done' : 'failed',
            endedAt: at,
            ...(fallback && e.usage
              ? {
                  model: e.usage.model || a.model,
                  tokens:
                    e.usage.input_tokens +
                    e.usage.output_tokens +
                    e.usage.cache_read_input_tokens +
                    e.usage.cache_creation_input_tokens,
                  costUsd: costOf(e.usage.model || a.model, e.usage),
                }
              : {}),
          }
        }),
      )
      await update($, now, () => at)
      const isIdle = !(await read($, agents)).some(a => a.status === 'running')
      const closed = await update($, flow, f => (f?.isAuto && !f.isFinished && isIdle ? { ...f, isFinished: true, phase: 'close' } : f))
      const startedAt = closed?.isAuto && closed.isFinished ? closed.startedAt : undefined
      $.clock.after(PANE_HIDE_MS, () => void closeIfIdle($))
      if (startedAt !== undefined) {
        // Only the bar that closed: one started since is left alone.
        $.clock.after(AUTO_HIDE_MS, () => void update($, flow, f => (f?.isAuto && f.isFinished && f.startedAt === startedAt ? null : f)))
      }
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    isTerminal = e.surface === 'terminal'
    const s = tr()
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const list = await read($, agents)
    const f = await read($, flow)
    const p: Panel = await read($, panel)
    const at = Math.max(await read($, now), ...list.map(a => a.startedAt), 0)

    const running = list.filter(a => a.status === 'running').reverse()
    const finished = list.filter(a => a.status !== 'running').reverse()
    const planned = plannedOf(f, list)
    const t = totals(list, at)
    // The pane's title says "Agents"; inside, only the flow's own name.
    const title = f && !f.isFinished ? f.title : ''

    const toggleCompact = (
      <Button
        key="compact"
        label={p.isCompact ? s.expand : s.collapse}
        plain
        onPress={() => update($, panel, prev => ({ ...prev, isCompact: !prev.isCompact }))}
      />
    )
    const toggleDone = (
      <Button
        key="done"
        label={`${p.isDoneCollapsed ? '▸' : '▾'} ${s.finished} · ${finished.length}`}
        plain
        onPress={() => update($, panel, prev => ({ ...prev, isDoneCollapsed: !prev.isDoneCollapsed }))}
      />
    )
    const isEmpty = list.length === 0 && planned.length === 0
    const summary = `≈${fmtCost(t.cost)}, ${fmtTokens(t.tokens)} ${s.tokensWord}, ${fmtTime(t.time)}`

    if (e.surface === 'desktop' && 'Svg' in ui) {
      const { Svg } = ui
      const W = Math.max(240, Math.min(900, (e.props.bodyColumns || 40) * 8 - 8))
      const section = (key: string, text: string) => (
        <Text key={key} dimColor>
          {text}
        </Text>
      )

      if (p.isCompact) {
        return (
          <Box flexDirection="column" gap={1}>
            <Svg source={compactSvg(W, list, planned, t)} alt={`${list.length} ${s.agentsCount}, ${summary}`} width={W} height={32} />
            {toggleCompact}
          </Box>
        )
      }
      return (
        <Box flexDirection="column">
          <Svg source={headerSvg(W, title, t)} alt={title ? `${title}: ${summary}` : summary} width={W} height={headerHeight(title)} />
          {toggleCompact}
          {isEmpty && <Text dimColor>{s.empty}</Text>}
          {running.length > 0 && section('h-run', `${s.running} · ${running.length}`)}
          {running.map(a => (
            <Svg key={a.id} source={agentSvg(W, a, at)} alt={`${a.description}: ${modelName(a.model)}, ${s.isRunning}`} width={W} height={66} />
          ))}
          {finished.length > 0 && toggleDone}
          {!p.isDoneCollapsed &&
            finished.map(a => (
              <Svg key={a.id} source={agentSvg(W, a, at)} alt={`${a.description}: ${modelName(a.model)}, ${s.isFinished}`} width={W} height={66} />
            ))}
          {planned.length > 0 && section('h-plan', `${s.planned} · ${planned.length}`)}
          {planned.map(pl => (
            <Svg key={`plan-${pl.n}`} source={plannedSvg(W, pl)} alt={`${pl.n}. ${pl.title}: ${s.isPlanned}`} width={W} height={46} />
          ))}
        </Box>
      )
    }

    // Terminal: the same rows in cells. A crab is a Raster drawn from the
    // clock; where a surface has no Raster the row keeps its glyph.
    const Raster = 'Raster' in ui ? ui.Raster : null
    const frame = (await $.clock.now()) / 1000
    const cols = Math.max(24, e.props.bodyColumns || PANE_COLUMNS)
    const background = typeof options.paneBackground === 'string' ? options.paneBackground.trim() : ''
    // The engine paints a pane in its own color; a background of the person's
    // choosing is painted over the whole body.
    const fill = background ? { backgroundColor: background, width: cols, minHeight: e.props.scroll.bodyRows } : {}
    const row = (a: AgentRun) => {
      const tier = tierOf(a.type)
      const color = colorOf(tier)
      const costume = a.costume ?? costumeOf(a.type)
      const progress = progressOf(a)
      const filled = Math.round(STEP_WIDTH * (progress ?? ctxOf(a) / 100))
      const model = a.effort ? `${modelName(a.model)} · ${a.effort}` : modelName(a.model)
      const steps = a.stepTotal ? `${a.stepDone ?? 0}/${a.stepTotal}${a.stepNote ? ' ' + a.stepNote : ''}` : ''
      const draw = COSTUMES[costume] ?? ((g: Fill) => crabBody(g))
      return (
        <Box key={a.id} flexDirection="row" gap={1}>
          {Raster ? (
            <Raster
              key={`crab-${a.id}`}
              columns={SPRITE_COLS}
              rows={SPRITE_ROWS}
              cells={spriteCells(costume, g => draw(g, colorOf(costume)), frame, a.status === 'running')}
            />
          ) : (
            <Text color={color}>▣</Text>
          )}
          <Box flexDirection="column">
            <Text>
              <Text bold>{clip(a.description || a.type, cols - SPRITE_COLS - 4)}</Text>{' '}
              <Text color={a.status === 'failed' ? 'red' : a.status === 'done' ? 'green' : color}>{STATUS_GLYPH[a.status]}</Text>
            </Text>
            <Text dimColor wrap="truncate-end">
              {tier === 'other' ? a.type : tier} · {model}
              {a.round > 1 ? ` · ${s.round} ${a.round}` : ''}
            </Text>
            <Text wrap="truncate-end">
              {/* Without reported steps the bar falls back to the context, drawn grey. */}
              {progress === null ? <Text dimColor>{'━'.repeat(filled)}</Text> : <Text color={color}>{'━'.repeat(filled)}</Text>}
              <Text color={TRACK}>{'━'.repeat(STEP_WIDTH - filled)}</Text> {steps}
            </Text>
            <Text dimColor wrap="truncate-end">
              ctx {ctxOf(a)}% · {fmtTokens(a.contextTokens)} · ≈{fmtCost(a.costUsd)} · {fmtTime(elapsed(a, at))}
            </Text>
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" {...fill}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold wrap="truncate-end">
            {title}
          </Text>
          {toggleCompact}
        </Box>
        <Text dimColor>
          ≈{fmtCost(t.cost)} · {fmtTokens(t.tokens)} {s.tokensWord} · {fmtTime(t.time)}
        </Text>
        {p.isCompact ? (
          <Text wrap="truncate-end">
            {[...running, ...finished].map(a => (
              <Text key={a.id} color={colorOf(tierOf(a.type))}>
                {STATUS_GLYPH[a.status]}{' '}
              </Text>
            ))}
            {planned.map(pl => (
              <Text key={`plan-${pl.n}`} dimColor>
                ◷{' '}
              </Text>
            ))}
          </Text>
        ) : (
          <Box flexDirection="column" marginTop={1}>
            {isEmpty && <Text dimColor>{s.empty}</Text>}
            {running.length > 0 && <Text dimColor>{s.running} · {running.length}</Text>}
            {running.map(row)}
            {finished.length > 0 && toggleDone}
            {!p.isDoneCollapsed && finished.map(row)}
            {planned.length > 0 && <Text dimColor>{s.planned} · {planned.length}</Text>}
            {planned.map(pl => {
              const tier = pl.tier in TIER_COLOR ? pl.tier : 'other'
              return (
                <Box key={`plan-${pl.n}`} flexDirection="column" marginBottom={1}>
                  <Text dimColor wrap="truncate-end">
                    <Text color={colorOf(tier)}>▢</Text> {pl.n}. {pl.title} ◷
                  </Text>
                  <Text dimColor wrap="truncate-end">
                    {'  '}
                    {tier} · {TIER_MODEL[tier] ?? ''}
                    {pl.after.length ? ` · ${s.after} ${pl.after.join(', ')}` : ''}
                  </Text>
                </Box>
              )
            })}
          </Box>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    isTerminal = e.surface === 'terminal'
    const f = await read($, flow)
    if (e.props.hasSurvey || (f === null && e.surface !== 'terminal')) {
      // Nothing slides while nothing is drawn, or the frame timer never rests.
      isGliding = false
      return next(e)
    }

    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const list = await read($, agents)
    const crew = list.length + plannedOf(f, list).length
    const isWorking = list.some(a => a.status === 'running')
    const crewButton = (
      <Button key="savvy-agents" label={`×${crew}`} plain onPress={() => void togglePane($)} />
    )
    const dismiss = (
      <Button
        key="savvy-dismiss"
        label="✕"
        plain
        role="dismiss"
        onPress={() => update($, flow, () => null)}
      />
    )

    if (f !== null && e.surface === 'desktop' && 'Svg' in ui) {
      const { Svg } = ui
      // About 8 CSS px per reported column; the rest is the count, the dismiss
      // and their gaps. No floor above the slot: a row wider than it would wrap.
      const width = Math.max(180, Math.min(1600, (e.props.bodyColumns || 100) * 8 - 96))
      const percent = `${Math.round(ratio(f) * 100)}%`
      return (
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Svg source={rowSvg(f, width, isWorking)} alt={`${f.title}: ${label(f)}, ${percent}`} width={width} height={H} />
          {crewButton}
          {dismiss}
        </Box>
      )
    }

    // Terminal. The first row is the main session's own and is always there: a
    // bar that slides while it works, what it has in hand, and the two costs.
    const at = await $.clock.now()
    const s = tr()
    const own: Main = await read($, main)
    const cols = e.props.bodyColumns
    const active = list.filter(a => a.status === 'running').length
    const isBusy = e.props.isWorking
    const isLit = isBusy || active > 0
    // Both rows name who works in one column, so their bars start under each other.
    const flowTitle = f ? clip(f.title, Math.max(8, Math.min(30, Math.floor(cols / 3)))) : ''
    const who = MAIN_TITLE.padEnd(flowTitle.length)
    const barText = isBusy
      ? own.isWorking
        ? `${s.working} ${fmtTime(at - own.startedAt)}`
        : s.working
      : active
        ? `${s.waitFor} ${active} ${s.agentsCount}`
        : s.rest
    // With no bar beneath to say so, the row itself counts the workers still running.
    const crewNote = f === null && active ? `${active} ${s.agentsCount} ${s.busy}` : ''
    const note = isBusy ? [own.activity || s.thinking, crewNote].filter(Boolean).join(' · ') : ''
    const turnCost = own.costNow !== undefined && own.costAtStart !== undefined ? Math.max(0, own.costNow - own.costAtStart) : undefined
    const hasWords = cols >= COST_WORDS_MIN_COLUMNS
    const turnText = turnCost === undefined ? '' : `↻ ${hasWords ? s.turn + ' ' : ''}${fmtCents(turnCost)}`
    const sessionText = own.costNow === undefined ? '' : `Σ ${hasWords ? s.session + ' ' : ''}${fmtCents(own.costNow)}`
    // At rest the row offers the pane of the agents that ran; under a bar, the bar does.
    const paneLabel = f === null && list.length > 0 ? `×${list.length}` : ''
    const rowFixed = 2 + who.length + [turnText, sessionText, paneLabel].filter(Boolean).reduce((sum, part) => sum + part.length + 2, 0)
    // The weather comes last and gives way first: tomorrow goes before the note
    // of what is in hand loses its room, then the weather of now goes too.
    const reading = shownWeather(await read($, weather), weatherPlace, at)
    const sky = reading && hasWords ? weatherParts(reading, s.tomorrow) : null
    const noteRoom = note !== '' ? NOTE_WIDTH : 0
    const fits = (width: number): boolean => cols - rowFixed - width - 2 - 2 - MIN_BAR_WIDTH - 2 >= noteRoom
    const skyPart = sky ? [sky.full, sky.short].find(part => fits(part.width)) : undefined
    const taken = rowFixed + (skyPart ? skyPart.width + 2 : 0)
    // The note gets its share first, the bar what is left up to its full width.
    const mainWidth = Math.max(MIN_BAR_WIDTH, Math.min(40, cols - taken - 2 - 2 - noteRoom))
    const noteWidth = cols - taken - 2 - mainWidth - 2
    // A block slides while work is under way with nothing to measure it by.
    const sliding = (parts: { before: string; block: string; after: string }, fill: string) => (
      <Text>
        <Text backgroundColor={TRACK}>{parts.before}</Text>
        <Text bold color="#ffffff" backgroundColor={fill}>
          {parts.block}
        </Text>
        <Text backgroundColor={TRACK}>{parts.after}</Text>
      </Text>
    )
    const mainRow = (
      <Box flexDirection="row" gap={2}>
        <Text>
          {isLit ? <Text color={barColor}>● </Text> : <Text dimColor>○ </Text>}
          <Text bold>{who}</Text>
        </Text>
        {isBusy ? (
          sliding(slideParts(barText, at, mainWidth), barColor)
        ) : (
          <Text dimColor={!isLit} backgroundColor={TRACK}>
            {` ${barText}`.padEnd(mainWidth)}
          </Text>
        )}
        {note !== '' && noteWidth >= NOTE_MIN_WIDTH && <Text wrap="truncate-end">{clip(note, noteWidth)}</Text>}
        {turnText !== '' && <Text color={TURN}>{turnText}</Text>}
        {sessionText !== '' && <Text dimColor>{sessionText}</Text>}
        {skyPart && <Text>{skyPart.text}</Text>}
        {paneLabel !== '' && <Button key="savvy-agents" label={paneLabel} plain onPress={() => void togglePane($)} />}
      </Box>
    )
    if (f === null) {
      // Nothing slides while no bar is drawn, or the frame timer never rests.
      isGliding = false
      return mainRow
    }

    // Under it, the bar of the agents: it carries its own text, percent and time
    // left, and the fill slides under it; the line below says what they work on.
    const t = totals(list, at)
    const runs = flowRuns(f, list)
    const view = counted(f, runs)
    const target = liveRatio(f, runs)
    shown = glide(shown, target, at, GLIDE_PER_SECOND)
    isGliding = shown.ratio < target
    const color = f.isFinished ? DONE : barColor
    const title = flowTitle.padEnd(who.length)
    const spent = f.isAuto ? totals(runs, at) : t
    const crewCount = f.isAuto ? runs.length : crew
    const cost = `≈${fmtCost(spent.cost)}`
    const failed = runs.filter(a => a.status === 'failed').length
    const failedMark = failed ? `✗ ${failed}` : ''
    const quiet = stalledMinutes(runs, at)
    const quietMark = quiet ? `${s.quiet} ${quiet}m` : ''
    // The count, where the bar's own text does not say as much.
    const count = !view.total || f.isFinished ? '' : f.isAuto ? `${view.done}/${view.total} ${s.agentsCount}` : label(f)
    // Indent and title, bar, cost, crew and dismiss, two columns between each;
    // the marks always show, the count gives way first.
    const marks = [failedMark, quietMark].filter(Boolean)
    const fixed = 2 + title.length + cost.length + `×${crewCount}`.length + 1 + 4 * 2 + marks.reduce((sum, m) => sum + m.length + 2, 0)
    let room = cols - fixed
    const isCountShown = count !== '' && room - count.length - 2 >= MIN_BAR_WIDTH
    if (isCountShown) room -= count.length + 2
    const width = Math.max(MIN_BAR_WIDTH, Math.min(40, room))
    const time = totals(runs, at).time
    const bar = barParts(barLabel(view, target, shown.ratio, time), shown.ratio, width)
    // Work under way with nothing to measure it by: a block slides, no percent is made up.
    const isSliding = !f.isFinished && target === 0 && runs.some(a => a.status === 'running')
    const slide = isSliding ? slideParts(`${s.busy} · ${fmtTime(time)}`, at, width) : null
    return (
      <Box flexDirection="column">
        {mainRow}
        <Box flexDirection="row" gap={2}>
          <Text>
            {'  '}
            <Text bold>{title}</Text>
          </Text>
          {slide ? (
            sliding(slide, color)
          ) : (
            <Text>
              <Text bold color="#ffffff" backgroundColor={color}>
                {bar.filled}
              </Text>
              <Text color={color} backgroundColor={TRACK}>
                {bar.head}
              </Text>
              <Text backgroundColor={TRACK}>{bar.rest}</Text>
            </Text>
          )}
          {isCountShown && <Text dimColor>{count}</Text>}
          <Text>{cost}</Text>
          {failedMark !== '' && <Text color="red">{failedMark}</Text>}
          {quietMark !== '' && <Text color="yellow">{quietMark}</Text>}
          <Button key="savvy-agents" label={`×${crewCount}`} plain onPress={() => void togglePane($)} />
          {dismiss}
        </Box>
        <Text wrap="truncate-end">
          <Text dimColor>{'  ↳ '}</Text>
          {nowLine(view, list, f.isAuto ? runs.length : list.length, spent.tokens)}
        </Text>
      </Box>
    )
  })
}
