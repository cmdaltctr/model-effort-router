import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Running, Subagents } from '../types'
import { clearSubagents, effortName } from './running.ts'
import { registerRouter } from './router.ts'
import { ROUTER_COMMANDS } from './chat.ts'

// Session model and effort, drawn in the prompt footer just left of the OMMS
// label: `Opus 5.5 / high · ● omms: connected`. The model and effort are blue.
// ⤷ marks a model or effort other than the session's setting. A subagent opened
// from the tasks list shows in the band above the prompt (`⤷ Haiku 5.5 / high`):
// only that band is told whose transcript is on screen; the footer is not.
// Both are read at session start, then taken from each main-loop model
// request as the router sends it, so the label shows the effort Jev chose
// and a /model or /effort change shows on the next turn.

const BLUE = '#5fafff'
const OMMS_MARK = '● omms'

// The same state the router writes in running.ts; the loader wants each file
// that reads or writes it to name it here, by its literal plugin and key.
const running = atom({ plugin: 'model-effort-router', key: 'running' } as const, {
  model: null,
  effort: null,
} as Running)
const subagents = atom({ plugin: 'model-effort-router', key: 'subagents' } as const, [] as Subagents)

/** `claude-opus-5-5[1m]` → `Opus 5.5 (1M)`; an alias or unknown id is kept as given. */
export function modelName(id: string): string {
  const wide = /\[1m\]$/i.test(id)
  const bare = id.replace(/\[1m\]$/i, '')
  const match = /^(?:claude-)?([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/i.exec(bare)
  const family = match?.[1] ?? bare
  const name = family.charAt(0).toUpperCase() + family.slice(1)
  const version = match ? (match[3] ? `${match[2]}.${match[3]}` : match[2]) : ''
  return `${name}${version ? ` ${version}` : ''}${wide ? ' (1M)' : ''}`
}

function textOf(node: unknown): string {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node && typeof node === 'object' && 'children' in node) {
    return textOf((node as { children: unknown }).children)
  }
  return ''
}

/**
 * The tree with `label` put before the first node whose text starts with the
 * OMMS mark, or null when the tree has no such node.
 */
function insertBefore(node: unknown, label: unknown[]): unknown | null {
  if (!node || typeof node !== 'object' || !('children' in node)) return null
  const children = (node as { children: unknown }).children
  if (!Array.isArray(children)) return null
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if (textOf(child).trimStart().startsWith(OMMS_MARK)) {
      const next = [...children.slice(0, i), ...label, ...children.slice(i)]
      return { ...(node as object), children: next }
    }
    const inner = insertBefore(child, label)
    if (inner) {
      const next = [...children]
      next[i] = inner
      return { ...(node as object), children: next }
    }
  }
  return null
}

/** `claude-opus-5-5` and `opus` are one model: compared by family name. */
function family(model: string | null): string | null {
  return model ? modelName(model).split(' ')[0].toLowerCase() : null
}

type Label = { mark: boolean; model: string; effort: string | null }

/** Marked when the model or effort differs from the session's setting. */
function labelOf(shown: { model: string; effort: string | null }, defaults: Running['defaults']): Label {
  const mark = !!defaults && (family(shown.model) !== family(defaults.model) || shown.effort !== defaults.effort)
  return { mark, model: shown.model, effort: shown.effort }
}

/** The parent's label for the footer, or null before its model is known. */
export function footerLabel(parent: Running): Label | null {
  return parent.model ? labelOf({ model: parent.model, effort: parent.effort }, parent.defaults) : null
}

/** A subagent's label for the band, or null when no request of it was seen. */
export function subagentLabel(parent: Running, seen: Subagents, agentId: string): Label | null {
  const agent = seen.find(a => a.id === agentId)
  return agent ? labelOf(agent, parent.defaults) : null
}

/** `⤷ Haiku 5.5 / high`: the ⤷ only when marked, the model and effort blue. */
function labelParts(label: Label, Text: any): unknown[] {
  return [
    ...(label.mark ? [<Text dimColor>⤷ </Text>] : []),
    <Text color={BLUE}>{modelName(label.model)}</Text>,
    ...(label.effort ? [<Text dimColor> / </Text>, <Text color={BLUE}>{label.effort}</Text>] : []),
  ]
}

export const register: Register = (on, options) => {
  // The router hooks `turn.step` and records each main-loop request it sends.
  registerRouter(on, options)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // Answered by the router's `command.run` hook.
    for (const command of ROUTER_COMMANDS) await $.command.register(command)
    const model = await $.session.model()
    const settings = await $.settings.read()
    // /effort saves per model (`modelSettings`), which the engine reads first.
    const effort = effortName(settings.modelSettings?.[model]?.effortLevel ?? settings.effortLevel)
    await update($, running, now => ({
      model: model || now.model,
      effort: effort ?? now.effort,
      defaults: { model: model || now.model, effort: effort ?? now.effort },
    }))
    await clearSubagents($)
    return started
  })

  // The band above the prompt is told whose transcript is on screen, so a
  // subagent opened from the tasks list shows its own model and effort here.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const agentId = e.props.view.agentId
    if (!agentId || e.props.hasSurvey) return next(e)
    const label = subagentLabel(await read($, running), await read($, subagents), agentId)
    if (!label) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return <Box flexDirection="row">{labelParts(label, Text)}</Box>
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const inner = await next(e)
    const shown = footerLabel(await read($, running))
    if (!shown) return inner
    const { Box, Text } = $.ui.resolve(e)
    const label = [...labelParts(shown, Text), <Text dimColor> · </Text>]
    // OMMS drawn inside this hook: sit just before it. Otherwise lead the row,
    // so a plugin drawing after this one still lands to the right.
    const placed = insertBefore(inner, label)
    if (placed) return placed as typeof inner
    return (
      <Box flexDirection="row">
        {label}
        {inner}
      </Box>
    )
  })
}
