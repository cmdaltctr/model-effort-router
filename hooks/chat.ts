import { EFFORT_ORDER } from './policy.ts'
import type { Effort } from './policy.ts'

/**
 * What the person set for this chat with a `/router-...` command. `null` means
 * "not set": the plugin options decide. Kept per session in the store, so a
 * resumed chat keeps it.
 */
export type ChatOverride = {
  /** `/router-off` is false, `/router-on` is true. */
  enabled: boolean | null
  /** `/router-maxEffort-<level>`: the effort ceiling for this chat. */
  max: Effort | null
  /** `/router-planning-effort-<level>`: the effort planning runs at; `off` means not lifted. */
  planning: Effort | 'off' | null
}

export const NO_OVERRIDE: ChatOverride = { enabled: null, max: null, planning: null }

const PLANNING_LEVELS = ['off', ...EFFORT_ORDER] as const
const PLANNING_PREFIX = 'router-planning-effort-'

/** A command name has no spaces, so every choice is its own dashed command. */
export const ROUTER_COMMANDS: readonly { name: string; description: string }[] = [
  { name: 'router-off', description: 'Pause the effort router for this chat; the session\'s own model and effort go through' },
  { name: 'router-on', description: 'Resume the effort router for this chat, even if the enabled setting is off' },
  ...EFFORT_ORDER.map(level => ({
    name: `router-maxEffort-${level}`,
    description: `Set this chat's effort ceiling to ${level}; the router may route up to it`,
  })),
  ...PLANNING_LEVELS.map(level => ({
    name: `${PLANNING_PREFIX}${level}`,
    description:
      level === 'off'
        ? 'Do not lift planning in this chat; plan mode and OpenSpec follow the router and the ceiling'
        : `Run plan mode and OpenSpec work at ${level} in this chat`,
  })),
]

/** The override after `command`, with the text to tell the person; null for a command that is not the router's. */
export function applyRouterCommand(command: string, current: ChatOverride): { next: ChatOverride; text: string } | null {
  if (command === 'router-off') {
    return { next: { ...current, enabled: false }, text: 'Router paused for this chat. /router-on resumes it.' }
  }
  if (command === 'router-on') {
    return { next: { ...current, enabled: true }, text: 'Router on for this chat.' }
  }
  const level = command.startsWith('router-maxEffort-') ? command.slice('router-maxEffort-'.length) : null
  if (level && (EFFORT_ORDER as readonly string[]).includes(level)) {
    return { next: { ...current, max: level as Effort }, text: `This chat's effort ceiling is now ${level}.` }
  }
  const planning = command.startsWith(PLANNING_PREFIX) ? command.slice(PLANNING_PREFIX.length) : null
  if (planning && (PLANNING_LEVELS as readonly string[]).includes(planning)) {
    return {
      next: { ...current, planning: planning as ChatOverride['planning'] },
      text: planning === 'off' ? 'Planning is not lifted in this chat.' : `This chat plans at ${planning}.`,
    }
  }
  return null
}

/** Reads a stored override; anything unreadable is "not set", never an error. */
export function readOverride(stored: unknown): ChatOverride {
  try {
    const value = typeof stored === 'string' ? JSON.parse(stored) : null
    const max = (EFFORT_ORDER as readonly string[]).includes(value?.max) ? (value.max as Effort) : null
    const planning = (PLANNING_LEVELS as readonly string[]).includes(value?.planning) ? value.planning : null
    return { enabled: typeof value?.enabled === 'boolean' ? value.enabled : null, max, planning }
  } catch {
    return NO_OVERRIDE
  }
}

/** The override of the running chat, loaded from the store on first use. */
export type Held = { current: ChatOverride | null }

/** Takes `$` from the hook, so the validator sees it passed to a function of this module. */
export async function chatOf($: any, held: Held): Promise<ChatOverride> {
  return (held.current ??= readOverride(await $.store.get(`router:${await $.session.id()}`)))
}

/** Whether the router acts in this chat: the chat's own word, else the `enabled` setting. */
export async function routerOn($: any, held: Held, setting: boolean): Promise<boolean> {
  return (await chatOf($, held)).enabled ?? setting
}
