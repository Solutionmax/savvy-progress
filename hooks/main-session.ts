// What the band above the prompt says of the main session: the tool it has in
// hand, and whose prompt starts the cost of a turn over.

// The arguments a call may carry that say what it is about, in the order tried.
const DETAIL_KEYS = ['description', 'file_path', 'pattern', 'query', 'url', 'skill', 'command'] as const

// A tool call in a few words: the tool, then the call's own description where
// it has one, else the file, the pattern or the command's first line.
export const toolNote = (call: Record<string, unknown>): string => {
  const tool = String(call.tool ?? '')
    .replace(/^mcp__(plugin_)?/, '')
    .replace(/__/g, ': ')
  const key = DETAIL_KEYS.find(k => typeof call[k] === 'string' && (call[k] as string).trim() !== '')
  if (!key) return tool
  const line = (call[key] as string).trim().split('\n')[0] ?? ''
  return `${tool}: ${key === 'file_path' ? (line.split('/').pop() ?? line) : line}`
}

// The origins that are the person's own message. Anything else (a background
// task's notification, another session, a trigger) continues the turn they began.
const PERSON_ORIGINS: ReadonlySet<string> = new Set(['composer', 'bridge', 'sdk', 'slack-ping'])

export const isPersonsPrompt = (origin: { kind: string; asUser?: boolean }): boolean =>
  PERSON_ORIGINS.has(origin.kind) || origin.asUser === true
