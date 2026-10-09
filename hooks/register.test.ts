import { expect, mock, test } from 'claude-code/testing'

import { SPRITE_COLS, SPRITE_ROWS, barParts, glide, pickCostume, slideParts, spriteCells } from './terminal-art'
import type { Fill } from './terminal-art'
import { isPersonsPrompt, toolNote } from './main-session'
import { latestWeather, parseWeather, shownWeather, weatherParts, weatherUrl } from './weather'

const PLUGIN = 'savvy-progress'
const START = 1_000_000
const SITE = { scroll: { offset: 0, bodyRows: 40 }, view: {} }
const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 150, ...SITE } } as const
const PANE = {
  component: 'Pane',
  requestId: 'savvy-agents',
  props: { title: 'Agents', isFocused: false, bodyColumns: 42, placement: 'dock', ...SITE },
} as const

// The band while no model turn of the main session runs.
const REST = { ...BAND, props: { ...BAND.props, isWorking: false } } as const

const PROGRESS = 'mcp__savvy-progress__progress'
const STEP = 'mcp__savvy-progress__step'

const TASKS = ['Functie bouwen', 'Tests draaien', 'Docs bijwerken', 'Opruimen'].map(title => ({ title, tier: 'medium' }))
const AGENT_IDS: Record<string, string> = { 'Functie bouwen': 'a1', 'Code verkennen': 'a2' }

type Body = Parameters<typeof test>[1]

// Stands for the surface: seats the pane when asked, and keeps count.
const surface = (on: Parameters<Body>[1]): { opened: { id?: string; columns?: number }[]; closed: string[] } => {
  const seen = { opened: [] as { id?: string; columns?: number }[], closed: [] as string[] }
  on('ui.panes', () => ({ value: seen.opened.length > seen.closed.length ? [{ id: 'savvy-agents' }] : [] }))
  on('ui.open', (_$, e) => {
    seen.opened.push(e)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_$, e) => {
    seen.closed.push(e.id)
    return { value: {} }
  })
  return seen
}

// Stands for the engine beneath the main session's own events. Its ledger is
// what the plugin reads when it asks, and each measurement raised moves it, as
// the engine's own total moves.
const mainLoop = (on: Parameters<Body>[1], usd = 5): { usd: number } => {
  const ledger = { usd }
  on('session.usage', () => ({ value: { startedAt: START, context: { window: 1_000_000 }, rateLimits: [], cost: { usd: ledger.usd } } }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('session.measure', (_$, e) => {
    ledger.usd = e.cost?.usd ?? ledger.usd
    return { changed: e.changed }
  })
  return ledger
}

const measure = (usd: number) => ({ context: { window: 1_000_000 }, rateLimits: [], cost: { usd }, changed: ['cost' as const] })

const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } }) as never

// A flow of four planned tasks, none accepted, and one worker twenty seconds
// in and halfway through its own steps: an eighth of the work is done, so at
// this pace 2:20 is left. Only the worker's steps can have moved the bar.
const startFlow = async ($: Parameters<Body>[0], on: Parameters<Body>[1]): Promise<void> => {
  const clock = mock.clock(on, { now: START })
  on('agent.spawn', (_$, e) => ({ agentId: AGENT_IDS[e.description] ?? 'other', model: 'claude-opus-5-5' }))
  surface(on)
  await $.tool.call({ tool: PROGRESS, title: 'Proef', total: 4, done: 0, phase: 'delegate', tasks: TASKS })
  await $.agent.spawn({ prompt: 'bouw', description: 'Functie bouwen', subagentType: 'savvy-flow:savvy-medium', tool_use_id: 't1' })
  await $.tool.call({ tool: STEP, done: 2, total: 4, note: 'bestanden lezen', agentId: 'a1' })
  await clock.advance(20_000)
}

const plainCrab = (fill: Fill): void => {
  fill(7, 10, 16, 12, '#D97757')
  fill(9, 12, 2, 2, '#1F1E1D')
  fill(7, 22, 2, 4, '#D97757', 'la')
}

test('barParts cuts the text where the fill ends and keeps every column', () => {
  // Arrange
  const text = '50% · nog 0:10'
  const cols = 20

  // Act
  const empty = barParts(text, 0, cols)
  const onText = barParts(text, 18 / 160, cols)
  const onSpace = barParts(text, 124 / 160, cols)
  const full = barParts(text, 1, cols)

  // Assert
  for (const parts of [empty, onText, onSpace, full]) {
    expect(parts.filled.length + parts.head.length + parts.rest.length).toBe(cols)
  }
  expect(empty.filled).toBe('')
  expect(onText).toEqual({ filled: ' 5', head: '', rest: '0% · nog 0:10     ' })
  expect(onSpace.head).toBe('▌')
  expect(full).toEqual({ filled: ' 50% · nog 0:10     ', head: '', rest: '' })
})

test('barParts ends a text longer than the bar with an ellipsis', () => {
  // Arrange
  const cols = 16

  // Act
  const parts = barParts('25% · eta 12:34:56', 0.5, cols)
  const drawn = parts.filled + parts.head + parts.rest

  // Assert
  expect(drawn.length).toBe(cols)
  expect(drawn.endsWith('…')).toBe(true)
})

test('glide slides toward a higher value and jumps back to a lower one', () => {
  // Arrange
  const from = { ratio: 0, at: 1000 }

  // Act
  const halfway = glide(from, 0.5, 2000, 0.25)
  const arrived = glide(halfway, 0.5, 9000, 0.25)
  const reset = glide(arrived, 0, 9500, 0.25)

  // Assert
  expect(halfway).toEqual({ ratio: 0.25, at: 2000 })
  expect(arrived.ratio).toBe(0.5)
  expect(reset.ratio).toBe(0)
})

test('spriteCells fills the whole raster and a walking crab differs from a standing one', () => {
  // Arrange
  const bytes = SPRITE_COLS * SPRITE_ROWS * 12

  // Act
  const standing = spriteCells('other', plainCrab, 0.3, false)
  const walking = spriteCells('other', plainCrab, 0.3, true)

  // Assert
  expect(standing.length).toBe(4 * Math.ceil(bytes / 3))
  expect(walking).not.toBe(standing)
})

test('the terminal band shows percent, time left, cost and the task in hand', async ($, on) => {
  // Arrange
  await startFlow($, on)

  // Act
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })

  // Assert
  expect(await ui.find({ type: 'Text', text: /13% · eta 2:20/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Tasks 0\/4/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /≈\$0\.00/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /working on: Functie bouwen: bestanden lezen/ })).toBeDefined()
  expect(await ui.find({ key: 'savvy-dismiss' })).toBeDefined()
  // A miss is undefined, so the checks above cannot pass on nothing.
  expect(await ui.find({ key: 'no-such-key' })).toBeUndefined()
  await ui.unmount()
})

test('a subagent outside the plan does not move the bar', async ($, on) => {
  // Arrange
  await startFlow($, on)
  await $.agent.spawn({ prompt: 'zoek', description: 'Code verkennen', subagentType: 'Explore', tool_use_id: 't2' })
  await $.tool.call({ tool: STEP, done: 4, total: 4, agentId: 'a2' })

  // Act
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })

  // Assert
  expect(await ui.find({ type: 'Text', text: /13% · eta 2:20/ })).toBeDefined()
  await ui.unmount()
})

test('the terminal pane draws a crab for a running worker', async ($, on) => {
  // Arrange
  await startFlow($, on)

  // Act
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })

  // Assert
  expect(await ui.find({ key: 'crab-a1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /2\/4 bestanden lezen/ })).toBeDefined()
  await ui.unmount()
})

test('the desktop band still draws its SVG', async ($, on) => {
  // Arrange
  await startFlow($, on)

  // Act
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })

  // Assert
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  await ui.unmount()
})

test('any subagent starts a bar by itself, counted in agents', async ($, on) => {
  // Arrange: no flow reports anything; a lone explorer starts.
  const clock = mock.clock(on, { now: START })
  surface(on)
  on('agent.spawn', () => ({ agentId: 'e1', model: 'claude-haiku-5-5' }))
  await $.agent.spawn({ prompt: 'zoek', description: 'Code verkennen', subagentType: 'Explore', tool_use_id: 't9' })
  await clock.advance(10_000)

  // Act
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })

  // Assert
  expect(await ui.find({ type: 'Text', text: /^Agents$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /0\/1 agents/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /working on: Code verkennen/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /quiet/ })).toBeUndefined()
  await ui.unmount()
})

test('a worker with no sign of life for minutes is called out', async ($, on) => {
  // Arrange
  const clock = mock.clock(on, { now: START })
  surface(on)
  on('agent.spawn', () => ({ agentId: 'e1', model: 'claude-haiku-5-5' }))
  await $.agent.spawn({ prompt: 'zoek', description: 'Code verkennen', subagentType: 'Explore', tool_use_id: 't9' })
  await clock.advance(4 * 60_000 + 5_000)

  // Act
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })

  // Assert
  expect(await ui.find({ type: 'Text', text: /quiet 4m/ })).toBeDefined()
  await ui.unmount()
})

test('any subagent opens the pane by itself, and it closes after the last one ends', async ($, on) => {
  // Arrange
  const clock = mock.clock(on, { now: START })
  const seen = surface(on)
  on('agent.spawn', () => ({ agentId: 'e1', model: 'claude-haiku-5-5' }))
  on('turn.complete', () => ({ text: 'klaar' }))

  // Act
  await $.agent.spawn({ prompt: 'zoek', description: 'Code verkennen', subagentType: 'Explore', tool_use_id: 't9' })
  const whileRunning = { opened: seen.opened.length, closed: seen.closed.length }
  await $.turn.complete({ agentId: 'e1', reason: 'answer', answer: 'klaar', durationMs: 9000, isAborted: false, turnId: 'turn-1' })
  await clock.advance(4_000)
  const justAfter = [...seen.closed]
  await clock.advance(2_000)

  // Assert
  expect(whileRunning).toEqual({ opened: 1, closed: 0 })
  expect(seen.opened[0]?.columns).toBe(44)
  expect(justAfter).toEqual([])
  expect(seen.closed).toEqual(['savvy-agents'])
})

test('a pane the person opened closes too once the last subagent ends', async ($, on) => {
  // Arrange: the pane is already up when the agent starts.
  const clock = mock.clock(on, { now: START })
  const seen = surface(on)
  seen.opened.push({ id: 'savvy-agents' })
  on('agent.spawn', () => ({ agentId: 'e1', model: 'claude-haiku-5-5' }))
  on('turn.complete', () => ({ text: 'klaar' }))

  // Act
  await $.agent.spawn({ prompt: 'zoek', description: 'Code verkennen', subagentType: 'Explore', tool_use_id: 't9' })
  await $.turn.complete({ agentId: 'e1', reason: 'answer', answer: 'klaar', durationMs: 9000, isAborted: false, turnId: 'turn-1' })
  await clock.advance(6_000)

  // Assert
  expect(seen.opened.length).toBe(1)
  expect(seen.closed).toEqual(['savvy-agents'])
})

test('a pane the person closed comes back for the next subagent', async ($, on) => {
  // Arrange: one agent runs, the pane is up, and the person closes it by hand.
  mock.clock(on, { now: START })
  const seen = surface(on)
  on('agent.spawn', (_$, e) => ({ agentId: AGENT_IDS[e.description] ?? 'other', model: 'claude-haiku-5-5' }))
  await $.agent.spawn({ prompt: 'bouw', description: 'Functie bouwen', subagentType: 'Explore', tool_use_id: 't1' })
  seen.closed.push('savvy-agents')

  // Act
  await $.agent.spawn({ prompt: 'zoek', description: 'Code verkennen', subagentType: 'Explore', tool_use_id: 't2' })

  // Assert
  expect(seen.opened.length).toBe(2)
})

test('a collapsed pane shows its crabs again for the next subagent', async ($, on) => {
  // Arrange: one agent runs and the person collapses the pane to its glyphs.
  mock.clock(on, { now: START })
  surface(on)
  on('agent.spawn', (_$, e) => ({ agentId: AGENT_IDS[e.description] ?? 'other', model: 'claude-haiku-5-5' }))
  await $.agent.spawn({ prompt: 'bouw', description: 'Functie bouwen', subagentType: 'Explore', tool_use_id: 't1' })
  const collapsed = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await collapsed.press({ key: 'compact' })
  const hadCrab = await collapsed.find({ key: 'crab-a1' })
  await collapsed.unmount()

  // Act
  await $.agent.spawn({ prompt: 'zoek', description: 'Code verkennen', subagentType: 'Explore', tool_use_id: 't2' })
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })

  // Assert
  expect(hadCrab).toBeUndefined()
  expect(await ui.find({ key: 'crab-a1' })).toBeDefined()
  expect(await ui.find({ key: 'crab-a2' })).toBeDefined()
  await ui.unmount()
})

test('a pane that came back for a subagent still leaves by itself', async ($, on) => {
  // Arrange: the person closed the pane by hand, and the next agent brought it back.
  const clock = mock.clock(on, { now: START })
  const seen = surface(on)
  on('agent.spawn', (_$, e) => ({ agentId: AGENT_IDS[e.description] ?? 'other', model: 'claude-haiku-5-5' }))
  on('turn.complete', () => ({ text: 'klaar' }))
  await $.agent.spawn({ prompt: 'bouw', description: 'Functie bouwen', subagentType: 'Explore', tool_use_id: 't1' })
  seen.closed.push('savvy-agents')
  await $.agent.spawn({ prompt: 'zoek', description: 'Code verkennen', subagentType: 'Explore', tool_use_id: 't2' })

  // Act
  for (const agentId of ['a1', 'a2']) {
    await $.turn.complete({ agentId, reason: 'answer', answer: 'klaar', durationMs: 9000, isAborted: false, turnId: `turn-${agentId}` })
  }
  await clock.advance(21_000)

  // Assert: one close by hand, one by the mod.
  expect(seen.opened.length).toBe(2)
  expect(seen.closed.length).toBe(2)
})

test('pickCostume gives each new type its own costume and a known type the one it wears', () => {
  // Arrange
  const pool = ['medium', 'light', 'careful']

  // Act
  const first = pickCostume('general-purpose', [], pool)
  const second = pickCostume('code-reviewer', [{ type: 'general-purpose', costume: first }], pool)
  const worn = [
    { type: 'general-purpose', costume: first },
    { type: 'code-reviewer', costume: second },
  ]
  const again = pickCostume('general-purpose', worn, pool)
  const beyond = pickCostume('planner', [...worn, { type: 'tdd-guide', costume: 'careful' }], pool)

  // Assert
  expect(first).toBe('medium')
  expect(second).toBe('light')
  expect(again).toBe(first)
  expect(pool).toContain(beyond)
})

test('slideParts keeps every column and its block moves with the clock', () => {
  // Arrange
  const text = 'running · 0:10'
  const cols = 20

  // Act
  const atStart = slideParts(text, 0, cols)
  const later = slideParts(text, 2000, cols)

  // Assert
  for (const parts of [atStart, later]) {
    expect(parts.before + parts.block + parts.after).toBe(` ${text}`.padEnd(cols))
  }
  expect(atStart.before).toBe('')
  expect(atStart.block.length).toBe(8)
  expect(later.before.length).toBe(8)
})

test('a lone agent that reports no steps shows a sliding block, not a percent', async ($, on) => {
  // Arrange
  const clock = mock.clock(on, { now: START })
  surface(on)
  on('agent.spawn', () => ({ agentId: 'e1', model: 'claude-haiku-5-5' }))
  await $.agent.spawn({ prompt: 'zoek', description: 'Code verkennen', subagentType: 'general-purpose', tool_use_id: 't9' })
  await clock.advance(10_000)

  // Act
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })

  // Assert
  expect(await ui.find({ type: 'Text', text: /running · 0:10/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /0% · eta/ })).toBeUndefined()
  await ui.unmount()
})

test('toolNote names the tool and what its call is about', () => {
  // Act and assert: the call's own description first, else the file or the command's first line.
  expect(toolNote({ tool: 'Bash', command: 'ls -la', description: 'Bestanden tonen' })).toBe('Bash: Bestanden tonen')
  expect(toolNote({ tool: 'Read', file_path: '/home/me/project/register.tsx' })).toBe('Read: register.tsx')
  expect(toolNote({ tool: 'Bash', command: 'ls -la\necho klaar' })).toBe('Bash: ls -la')
  expect(toolNote({ tool: 'mcp__tracker__update_task', id: 94 })).toBe('tracker: update_task')
  expect(toolNote({ tool: 'ExitPlanMode' })).toBe('ExitPlanMode')
})

test('only a prompt of the person starts a turn over', () => {
  // Act and assert
  expect(isPersonsPrompt({ kind: 'composer' })).toBe(true)
  expect(isPersonsPrompt({ kind: 'plugin', asUser: true })).toBe(true)
  expect(isPersonsPrompt({ kind: 'task-notification' })).toBe(false)
  expect(isPersonsPrompt({ kind: 'peer' })).toBe(false)
})

test('at rest the band says the session waits for the person', async ($, on) => {
  // Arrange
  mock.clock(on, { now: START })
  surface(on)

  // Act
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...REST })

  // Assert
  expect(await ui.find({ type: 'Text', text: /Done, waiting for you/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /no agents running/ })).toBeUndefined()
  // No agent ran yet, so there is no pane to offer; no cost is known, so none is made up.
  expect(await ui.find({ key: 'savvy-agents' })).toBeUndefined()
  expect(await ui.find({ key: 'savvy-dismiss' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /session/ })).toBeUndefined()
  await ui.unmount()
})

test('the band names the tool the main session has in hand, then that it thinks', async ($, on) => {
  // Arrange: the band is read while the main session's Bash call is under way.
  mock.clock(on, { now: START })
  surface(on)
  mainLoop(on)
  let inHand: unknown
  on('tool.call', { tool: 'Bash' }, async (_$, e) => {
    if (e.agentId) return { result: 'ok' }
    const during = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
    inHand = await during.find({ type: 'Text', text: /^Bash: Bestanden tonen$/ })
    await during.unmount()
    return { result: 'ok' }
  })
  await $.turn.start({ text: 'doe iets', turnId: 'turn-1' })

  // Act: the main session's call, then one of a subagent's.
  await $.tool.call({ tool: 'Bash', command: 'ls', description: 'Bestanden tonen' })
  await $.tool.call({ tool: 'Bash', command: 'ls', description: 'Van de agent', agentId: 'a1' })
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })

  // Assert
  expect(inHand).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^thinking$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Bash:/ })).toBeUndefined()
  await ui.unmount()
})

test('while the main session works its row draws a bar with a sliding block and the time so far', async ($, on) => {
  // Arrange
  const clock = mock.clock(on, { now: START })
  surface(on)
  mainLoop(on)
  await $.turn.start({ text: 'doe iets', turnId: 'turn-1' })
  await clock.advance(10_000)

  // Act
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })

  // Assert: the text sits in a track padded to the bar's width, under the name of who works.
  expect(await ui.find({ type: 'Text', text: /^ Working 0:10 {10,}$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Claude$/ })).toBeDefined()
  await ui.unmount()
})

test('at rest the row keeps its bar, with nothing sliding', async ($, on) => {
  // Arrange
  mock.clock(on, { now: START })
  surface(on)

  // Act
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...REST })

  // Assert
  expect(await ui.find({ type: 'Text', text: /^ Done, waiting for you {2,}$/ })).toBeDefined()
  await ui.unmount()
})

test('the band labels what the turn cost and what the session cost', async ($, on) => {
  // Arrange: the session stood at $5.00 when the person sent their prompt.
  mock.clock(on, { now: START })
  surface(on)
  mainLoop(on, 5)
  await $.prompt.submit(typed('doe iets'))
  await $.turn.start({ text: 'doe iets', turnId: 'turn-1' })

  // Act
  await $.session.measure(measure(5.31))
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })

  // Assert
  expect(await ui.find({ type: 'Text', text: /turn \$0\.31/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /session \$5\.31/ })).toBeDefined()
  await ui.unmount()
})

test('the cost follows each model request, with no measurement raised', async ($, on) => {
  // Arrange: the person's prompt at $5.00; the engine raises no measurement.
  mock.clock(on, { now: START })
  surface(on)
  const ledger = mainLoop(on, 5)
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  await $.prompt.submit(typed('doe iets'))
  await $.turn.start({ text: 'doe iets', turnId: 'turn-1' })

  // Act: one request of the main session is answered, and the session's total has grown.
  ledger.usd = 5.31
  for await (const _chunk of $.turn.step({ turnId: 'turn-1', index: 0, model: 'claude-opus-5-5', messageCount: 2 })) {
    // Nothing to read: the response is all the plugin waits for.
  }
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })

  // Assert
  expect(await ui.find({ type: 'Text', text: /turn \$0\.31/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /session \$5\.31/ })).toBeDefined()
  await ui.unmount()
})

test('the costs are shown to the cent, as the status line shows them', async ($, on) => {
  // Arrange
  mock.clock(on, { now: START })
  surface(on)
  mainLoop(on, 13.09)
  await $.prompt.submit(typed('doe iets'))

  // Act
  await $.session.measure(measure(13.36))
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...REST })

  // Assert
  expect(await ui.find({ type: 'Text', text: /turn \$0\.27/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /session \$13\.36/ })).toBeDefined()
  await ui.unmount()
})

test('a notification does not start the cost of the turn over', async ($, on) => {
  // Arrange: the person's prompt at $5.00, then a background task reports in at $5.31.
  mock.clock(on, { now: START })
  surface(on)
  mainLoop(on, 5)
  await $.prompt.submit(typed('doe iets'))
  await $.session.measure(measure(5.31))

  // Act
  await $.prompt.submit({ text: 'agent klaar', wait: false, origin: { kind: 'task-notification' } } as never)
  await $.session.measure(measure(5.5))
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...REST })

  // Assert
  expect(await ui.find({ type: 'Text', text: /turn \$0\.50/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /session \$5\.50/ })).toBeDefined()
  await ui.unmount()
})

test('a lone savvy worker with no flow reporting still lets the pane go', async ($, on) => {
  // Arrange: the Agent call of a savvy worker, with no orchestrator reporting a flow.
  const clock = mock.clock(on, { now: START })
  const seen = surface(on)
  on('agent.spawn', () => ({ agentId: 'a1', model: 'claude-opus-5-5' }))
  on('turn.complete', () => ({ text: 'klaar' }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: 'launched' }))
  await $.tool.call({ tool: 'Agent', subagent_type: 'savvy-flow:savvy-medium', description: 'Functie bouwen', prompt: 'bouw' })
  await $.agent.spawn({ prompt: 'bouw', description: 'Functie bouwen', subagentType: 'savvy-flow:savvy-medium', tool_use_id: 't1' })

  // Act
  await $.turn.complete({ agentId: 'a1', reason: 'answer', answer: 'klaar', durationMs: 9000, isAborted: false, turnId: 'turn-1' })
  await clock.advance(6_000)

  // Assert
  expect(seen.closed).toEqual(['savvy-agents'])
})

test('a run the engine no longer lists is ended when the person sends a prompt', async ($, on) => {
  // Arrange: a subagent started, and its end never arrived (the process restarted).
  mock.clock(on, { now: START })
  const seen = surface(on)
  mainLoop(on)
  on('agent.spawn', () => ({ agentId: 'e1', model: 'claude-haiku-5-5' }))
  on('agent.list', () => ({ value: [] }))
  await $.agent.spawn({ prompt: 'zoek', description: 'Code verkennen', subagentType: 'Explore', tool_use_id: 't9' })

  // Act
  await $.prompt.submit(typed('verder'))
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...REST })

  // Assert
  expect(seen.closed).toEqual(['savvy-agents'])
  expect(await ui.find({ type: 'Text', text: /Done, waiting for you/ })).toBeDefined()
  await ui.unmount()
})

test('a run the engine still lists stays when the person sends a prompt', async ($, on) => {
  // Arrange
  mock.clock(on, { now: START })
  const seen = surface(on)
  mainLoop(on)
  on('agent.spawn', () => ({ agentId: 'e1', model: 'claude-haiku-5-5' }))
  on('agent.list', () => ({ value: [{ id: 'e1', description: 'Code verkennen', type: 'Explore', status: 'running' }] }))
  await $.agent.spawn({ prompt: 'zoek', description: 'Code verkennen', subagentType: 'Explore', tool_use_id: 't9' })

  // Act
  await $.prompt.submit(typed('verder'))
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...REST })

  // Assert
  expect(seen.closed).toEqual([])
  expect(await ui.find({ type: 'Text', text: /Waiting for 1 agents/ })).toBeDefined()
  await ui.unmount()
})

test('a run with no id of its own is left alone when the person sends a prompt', async ($, on) => {
  // Arrange: a workflow's agent has no id the engine lists it by.
  mock.clock(on, { now: START })
  const seen = surface(on)
  mainLoop(on)
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5' }))
  on('agent.list', () => ({ value: [] }))
  await $.agent.spawn({ prompt: 'zoek', description: 'Code verkennen', subagentType: 'Explore', tool_use_id: 't9' })

  // Act
  await $.prompt.submit(typed('verder'))
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...REST })

  // Assert
  expect(seen.closed).toEqual([])
  expect(await ui.find({ type: 'Text', text: /Waiting for 1 agents/ })).toBeDefined()
  await ui.unmount()
})

test('a pane the person opened at rest stays when they send a prompt', async ($, on) => {
  // Arrange: no agent runs, and the person has the pane up to look at the finished ones.
  mock.clock(on, { now: START })
  const seen = surface(on)
  seen.opened.push({ id: 'savvy-agents' })
  mainLoop(on)
  on('agent.list', () => ({ value: [] }))

  // Act
  await $.prompt.submit(typed('wat deed die agent?'))

  // Assert
  expect(seen.closed).toEqual([])
})

test('workers that start together get one notice that the pane found no room', async ($, on) => {
  // Arrange: a narrow terminal, where a waiting pane is listed once it is opened.
  const clock = mock.clock(on, { now: START })
  const toasts: string[] = []
  let opens = 0
  on('ui.panes', () => ({ value: opens > 0 ? [{ id: 'savvy-agents' }] : [] }))
  on('ui.open', async () => {
    await Promise.resolve()
    opens += 1
    return { value: { isPlaced: false, reason: 'below 144 columns' } }
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('agent.spawn', (_$, e) => ({ agentId: AGENT_IDS[e.description] ?? 'other', model: 'claude-haiku-5-5' }))

  // Act
  await Promise.all([
    $.agent.spawn({ prompt: 'bouw', description: 'Functie bouwen', subagentType: 'Explore', tool_use_id: 't1' }),
    $.agent.spawn({ prompt: 'zoek', description: 'Code verkennen', subagentType: 'Explore', tool_use_id: 't2' }),
  ])
  await clock.advance(1)

  // Assert: a second open of the same pane only retitles it; the notice is what would nag.
  expect(toasts.length).toBe(1)
})

test('on a narrow band the costs keep their marks and drop their words', async ($, on) => {
  // Arrange
  mock.clock(on, { now: START })
  surface(on)
  mainLoop(on, 5)
  await $.prompt.submit(typed('doe iets'))
  await $.session.measure(measure(5.31))

  // Act
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...REST, props: { ...REST.props, bodyColumns: 40 } })

  // Assert
  expect(await ui.find({ type: 'Text', text: /↻ \$0\.31/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Σ \$5\.31/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /turn|session/ })).toBeUndefined()
  await ui.unmount()
})

test('a pane that finds no room says how to open it', async ($, on) => {
  // Arrange: a terminal too narrow for a pane the person did not ask for.
  const clock = mock.clock(on, { now: START })
  const toasts: string[] = []
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'below 144 columns' } }))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('agent.spawn', () => ({ agentId: 'e1', model: 'claude-haiku-5-5' }))

  // Act
  await $.agent.spawn({ prompt: 'zoek', description: 'Code verkennen', subagentType: 'Explore', tool_use_id: 't9' })
  await clock.advance(1)

  // Assert
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toMatch(/\/agents-info/)
})

test('ordinary agent types each wear their own costume', async ($, on) => {
  // Arrange: two agents of different types, neither a savvy tier.
  mock.clock(on, { now: START })
  surface(on)
  on('agent.spawn', (_$, e) => ({ agentId: AGENT_IDS[e.description] ?? 'other', model: 'claude-haiku-5-5' }))
  await $.agent.spawn({ prompt: 'bouw', description: 'Functie bouwen', subagentType: 'general-purpose', tool_use_id: 't1' })
  await $.agent.spawn({ prompt: 'zoek', description: 'Code verkennen', subagentType: 'code-reviewer', tool_use_id: 't2' })

  // Act
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  const first = await ui.find({ key: 'crab-a1' })
  const second = await ui.find({ key: 'crab-a2' })

  // Assert
  expect(first?.props.cells).toBeDefined()
  expect(first?.props.cells).not.toBe(second?.props.cells)
  await ui.unmount()
})

test('a bar dismissed while a worker runs says so instead of resting', async ($, on) => {
  // Arrange
  mock.clock(on, { now: START })
  surface(on)
  on('agent.spawn', () => ({ agentId: 'e1', model: 'claude-haiku-5-5' }))
  await $.agent.spawn({ prompt: 'zoek', description: 'Code verkennen', subagentType: 'general-purpose', tool_use_id: 't9' })
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })

  // Act
  await ui.press({ key: 'savvy-dismiss' })

  // Assert
  expect(await ui.find({ type: 'Text', text: /1 agents running/ })).toBeDefined()
  expect(await ui.find({ key: 'savvy-agents' })).toBeDefined()
  await ui.unmount()
})

// What Open-Meteo answers for a clear day of 24.3 degrees with rain and 18.6 at most tomorrow.
const FORECAST = JSON.stringify({
  current: { temperature_2m: 24.3, weather_code: 0, is_day: 1 },
  daily: { weather_code: [0, 61], temperature_2m_max: [25.9, 18.6] },
})

// The settings of someone who reads Dutch and has set a place for the weather.
const DUTCH_WITH_WEATHER = { options: { language: 'nl', weatherPlace: '52.37,4.90' } }

// Starts a session as the engine does, which is when the mod asks for the weather.
// It answers each fetch with the next of `bodies`, the last one from then on.
const startSession = async ($: Parameters<Body>[0], on: Parameters<Body>[1], bodies: (string | null)[]): Promise<string[]> => {
  const fetched: string[] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('tool.register', () => ({ value: {} }) as never)
  on('command.register', () => ({ value: {} }) as never)
  on('agent.list', () => ({ value: [] }))
  on('http.fetch', (_$, e) => {
    const body = bodies[Math.min(fetched.length, bodies.length - 1)] ?? null
    fetched.push(e.url)
    return { value: { status: body === null ? 503 : 200, ok: body !== null, headers: {}, text: body ?? '' } }
  })
  await $.session.start({ cwd: '/root', surface: 'terminal', isInteractive: true })
  return fetched
}

test('parseWeather reads now and tomorrow, and refuses anything else', () => {
  // Act
  const read = parseWeather(FORECAST, START)

  // Assert
  expect(read).toEqual({ temp: 24, code: 0, isDay: true, nextCode: 61, nextMax: 19, at: START })
  expect(parseWeather('<html>503</html>', START)).toBeNull()
  expect(parseWeather(JSON.stringify({ current: { temperature_2m: 'warm', weather_code: 0, is_day: 1 }, daily: {} }), START)).toBeNull()
  expect(parseWeather(JSON.stringify({ current: { temperature_2m: 24, weather_code: 0, is_day: 1 }, daily: { weather_code: [0], temperature_2m_max: [25] } }), START)).toBeNull()
})

test('weatherUrl asks for the place given, and for nothing that is no place', () => {
  // Act and assert
  expect(weatherUrl('52.37,4.90')).toContain('latitude=52.37&longitude=4.90')
  expect(weatherUrl(' 52.37 , 4.9 ')).toContain('latitude=52.37&longitude=4.9')
  expect(weatherUrl('')).toBeNull()
  expect(weatherUrl('Amsterdam')).toBeNull()
  expect(weatherUrl('95,10')).toBeNull()
  expect(weatherUrl('52.37,4.90&apikey=x')).toBeNull()
})

test('weatherParts draws now and tomorrow, with the width each takes in cells', () => {
  // Arrange
  const day = { temp: 24, code: 0, isDay: true, nextCode: 61, nextMax: 19, at: START }

  // Act
  const parts = weatherParts(day, 'morgen')
  const night = weatherParts({ ...day, isDay: false, code: 95, temp: -3 }, 'morgen')

  // Assert: an icon is two cells wide, whatever its length as a string.
  expect(parts.short).toEqual({ text: '🌞 24°', width: 6 })
  expect(parts.full).toEqual({ text: '🌞 24° · morgen ☔ 19°', width: 22 })
  expect(night.short).toEqual({ text: '⚡ -3°', width: 6 })
  expect(weatherParts({ ...day, isDay: false }, 'morgen').short.text).toBe('🌙 24°')
})

test('the band shows the weather now and tomorrow, fetched as the session starts', DUTCH_WITH_WEATHER, async ($, on) => {
  // Arrange
  const clock = mock.clock(on, { now: START })
  surface(on)

  // Act
  const fetched = await startSession($, on, [FORECAST])
  await clock.advance(1)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...REST })

  // Assert: the place asked for is the one set.
  expect(fetched.length).toBe(1)
  expect(fetched[0]).toContain('latitude=52.37&longitude=4.90')
  expect(await ui.find({ type: 'Text', text: /^🌞 24° · morgen ☔ 19°$/ })).toBeDefined()
  await ui.unmount()
})

test('the weather is asked again every half hour', { ...DUTCH_WITH_WEATHER, timeoutMs: 30_000 }, async ($, on) => {
  // Arrange: a clear day first; half an hour on it is 21 degrees.
  const clock = mock.clock(on, { now: START })
  surface(on)
  const later = JSON.stringify({ current: { temperature_2m: 21, weather_code: 0, is_day: 1 }, daily: { weather_code: [0, 61], temperature_2m_max: [25.9, 18.6] } })
  const fetched = await startSession($, on, [FORECAST, later])

  // Act
  await clock.advance(30 * 60_000 + 1)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...REST })

  // Assert
  expect(fetched.length).toBe(2)
  expect(await ui.find({ type: 'Text', text: /^🌞 21° · morgen/ })).toBeDefined()
  await ui.unmount()
})

test('weather that could not be fetched is left out, not guessed', DUTCH_WITH_WEATHER, async ($, on) => {
  // Arrange
  const clock = mock.clock(on, { now: START })
  surface(on)

  // Act
  await startSession($, on, [null])
  await clock.advance(1)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...REST })

  // Assert
  expect(await ui.find({ type: 'Text', text: /°/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Klaar, wacht op jou/ })).toBeDefined()
  await ui.unmount()
})

test('a reading stays while the next fetch fails, until it is hours old', () => {
  // Arrange
  const read = { temp: 24, code: 0, isDay: true, nextCode: 61, nextMax: 19, at: START }
  const newer = { ...read, temp: 21, at: START + 30 * 60_000 }

  // Act and assert: a new reading always wins; a miss keeps the old one for two hours.
  expect(latestWeather(read, newer, newer.at)).toBe(newer)
  expect(latestWeather(read, null, START + 30 * 60_000)).toBe(read)
  expect(latestWeather(read, null, START + 2 * 60 * 60_000)).toBeNull()
  expect(latestWeather(null, null, START)).toBeNull()
})

test('until a place is set no weather is asked for', { options: { language: 'en' } }, async ($, on) => {
  // Arrange
  const clock = mock.clock(on, { now: START })
  surface(on)

  // Act
  const fetched = await startSession($, on, [FORECAST])
  await clock.advance(1)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...REST })

  // Assert
  expect(fetched).toEqual([])
  expect(await ui.find({ type: 'Text', text: /°/ })).toBeUndefined()
  await ui.unmount()
})

test('a kept reading is not drawn once the place is off or the reading is hours old', () => {
  // Arrange: the session's state outlives a reload, and so a change of the setting.
  const read = { temp: 24, code: 0, isDay: true, nextCode: 61, nextMax: 19, at: START }

  // Act and assert
  expect(shownWeather(read, '52.37,4.90', START + 60_000)).toBe(read)
  expect(shownWeather(read, '', START + 60_000)).toBeNull()
  expect(shownWeather(read, '52.37,4.90', START + 2 * 60 * 60_000)).toBeNull()
  expect(shownWeather(null, '52.37,4.90', START)).toBeNull()
})

test('beside a narrow band tomorrow gives way before the note of what is in hand', DUTCH_WITH_WEATHER, async ($, on) => {
  // Arrange: 95 columns, as the band has beside an open pane, with both costs shown.
  const clock = mock.clock(on, { now: START })
  surface(on)
  mainLoop(on, 5)
  await startSession($, on, [FORECAST])
  await clock.advance(1)
  await $.prompt.submit(typed('doe iets'))
  await $.turn.start({ text: 'doe iets', turnId: 'turn-1' })
  await $.session.measure(measure(5.31))

  // Act
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND, props: { ...BAND.props, bodyColumns: 95 } })

  // Assert
  expect(await ui.find({ type: 'Text', text: /^🌞 24°$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /morgen/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^denkt na$/ })).toBeDefined()
  await ui.unmount()
})

test('the bar is blue unless a color is set', async ($, on) => {
  // Arrange
  mock.clock(on, { now: START })
  surface(on)

  // Act
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })

  // Assert: the mark before the name wears the bar's color while work is under way.
  expect((await ui.find({ type: 'Text', text: /^● $/ }))?.props.color).toBe('#0079d2')
  await ui.unmount()
})

test('the bar wears the color set for it', { options: { barColor: '#FF8800' } }, async ($, on) => {
  // Arrange
  mock.clock(on, { now: START })
  surface(on)

  // Act
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })

  // Assert
  expect((await ui.find({ type: 'Text', text: /^● $/ }))?.props.color).toBe('#FF8800')
  await ui.unmount()
})

test('a color that is no hex color leaves the bar blue', { options: { barColor: 'sky blue' } }, async ($, on) => {
  // Arrange
  mock.clock(on, { now: START })
  surface(on)

  // Act
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })

  // Assert
  expect((await ui.find({ type: 'Text', text: /^● $/ }))?.props.color).toBe('#0079d2')
  await ui.unmount()
})
