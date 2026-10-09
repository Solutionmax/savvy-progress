export type Phase = 'plan' | 'design' | 'delegate' | 'review' | 'close'

export type PlannedTask = {
  title: string
  tier: string
  after: number[]
}

export type Flow = {
  title: string
  total: number
  done: number
  running: number
  phase: Phase
  isFinished: boolean
  tasks: PlannedTask[]
  /** Started by a subagent with no flow reporting: it counts the runs since `startedAt`. */
  isAuto?: boolean
  startedAt?: number
}

export type AgentStatus = 'running' | 'done' | 'failed'

export type AgentRun = {
  id: string
  agentId?: string
  type: string
  /** The costume its crab wears, picked as it starts; a run from before this was kept has none. */
  costume?: string
  description: string
  model: string
  effort?: string
  status: AgentStatus
  startedAt: number
  endedAt?: number
  /** The last sign of life: a model request or a reported step. */
  lastAt?: number
  contextTokens: number
  contextMax: number
  tokens: number
  costUsd: number
  steps: number
  round: number
  /** Self-reported by the worker through the `step` tool. */
  stepDone?: number
  stepTotal?: number
  stepNote?: string
}

export type Panel = {
  isCompact: boolean
  isDoneCollapsed: boolean
  autoOpenedFor: string
}

/** What the band says of the main session: its turn, the tool in hand and the cost. */
export type Main = {
  /** True between the start of a main turn and its end. */
  isWorking: boolean
  /** When the main turn under way began. */
  startedAt: number
  /** The tool call in hand, in a few words; empty while the model thinks. */
  activity: string
  /** The session's cost, in USD, when the person sent the prompt this turn answers. */
  costAtStart?: number
  /** The session's cost as the engine totals it, the last it said. */
  costNow?: number
}

/** The last weather read for the band: now, and tomorrow's sky and maximum. */
export type Weather = {
  /** Degrees Celsius now, rounded. */
  temp: number
  /** WMO weather code now. */
  code: number
  isDay: boolean
  /** WMO weather code of tomorrow. */
  nextCode: number
  /** Tomorrow's maximum in degrees Celsius, rounded. */
  nextMax: number
  /** When it was read. */
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    'savvy-progress': {
      flow: Flow | null
      agents: AgentRun[]
      panel: Panel
      now: number
      main: Main
      weather: Weather | null
    }
  }
}
