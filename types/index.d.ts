/**
 * The parent's model and effort as last sent, and the session's defaults (its
 * model and effort setting at start), which a ⤷ in the footer is measured from.
 */
export type Running = {
  model: string | null
  effort: string | null
  defaults?: { model: string | null; effort: string | null }
}

/** Subagents seen this session, oldest first: each one's id, model and effort as last sent. */
export type Subagents = { id: string; model: string; effort: string | null }[]

declare module 'claude-code' {
  interface PluginState {
    'model-effort-router': { running: Running; subagents: Subagents }
  }
}
