import { atom, update } from 'claude-code'

import type { Running, Subagents } from '../types'

// The footer's label: the main loop's model and the effort of its last request
// as sent. Written by the router at `turn.step`, read by the footer drawing.
const running = atom({ plugin: 'model-effort-router', key: 'running' } as const, {
  model: null,
  effort: null,
} as Running)

// Each subagent's model and effort, shown in the band above the prompt while
// its transcript is on screen. Kept after it ends, so an old one still shows.
const subagents = atom({ plugin: 'model-effort-router', key: 'subagents' } as const, [] as Subagents)

/** The most subagents kept; the oldest go first. */
const KEEP = 64

export function effortName(effort: unknown): string | null {
  if (typeof effort === 'string' && effort) return effort
  if (typeof effort === 'number') return String(effort)
  return null
}

/**
 * Records a main-loop request as it is sent. The request as the engine built it,
 * before the router, carries the session's setting: that is the ⤷ baseline.
 */
export async function showSent($: any, model: string, effort: unknown, built: { model: string; effort: unknown }): Promise<void> {
  await update($, running, () => ({
    model,
    effort: effortName(effort),
    defaults: { model: built.model, effort: effortName(built.effort) },
  }))
}

/** Records a subagent request as it is sent; a new subagent joins the end. */
export async function showSubagent($: any, id: string, model: string, effort: unknown): Promise<void> {
  const entry = { id, model, effort: effortName(effort) }
  await update($, subagents, now =>
    now.some(a => a.id === id) ? now.map(a => (a.id === id ? entry : a)) : [...now, entry].slice(-KEEP),
  )
}

/** Forgets the subagents, for a new session. */
export async function clearSubagents($: any): Promise<void> {
  await update($, subagents, () => [])
}
