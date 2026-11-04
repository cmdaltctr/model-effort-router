/**
 * jev-model-router — Claude Mod (EARLY ACCESS)
 *
 * Picks the model each task runs on with TypeSafe's Jev, a System One
 * decision model: unstructured state in, a typed choice with a probability
 * distribution out.
 *
 * Jev is reached one of two ways, whichever key is configured: TypeSafe's
 * own API (`typesafeApiKey`), which reports a calibrated confidence per
 * answer, or the Vercel AI Gateway (`gatewayApiKey`), which does not. With
 * neither, the engine's own `$.model.classify` stands in, so the mod is
 * useful without any account.
 *
 * Three things it can set, each on its own switch:
 *   agent.spawn  — the model of each subagent (on by default)
 *   turn.step    — the reasoning effort of the main loop (on by default)
 *   turn.step    — the model of the main loop (off by default: switching
 *                  models mid-session invalidates the prompt cache, which can
 *                  cost more than the cheaper tier saves)
 *
 * Every one of them moves in both directions: a task the decision model reads
 * as mechanical is routed down, one it reads as hard is routed up. The two
 * mistakes do not cost the same, so they do not clear the same confidence bar
 * (see `minUpgradeConfidence` / `minDowngradeConfidence` in policy.ts).
 *
 * The Agent tool has no effort parameter, so a subagent's effort is set on its
 * own requests instead: the decision made at its spawn is kept under its
 * agentId and applied at each of its `turn.step`s (`routeSubagentEffort`).
 *
 * The prompt is classified at `prompt.submit`, which runs before the turn
 * starts, and the decision is applied at the turn's first request.
 *
 * Every failure path is fail-open: a classification that errors or runs past
 * the latency budget leaves the request exactly as the engine built it.
 *
 * The API key comes from the plugin's options (userConfig "typesafeApiKey"
 * or "gatewayApiKey"). Never hardcode it in this file.
 *
 * Needs CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 (Claude Code >= 2.1.259). Typed
 * against Anthropic's declarations: https://github.com/anthropics/claude-code/tree/main/mods
 *
 * Privacy: with a key set, the prompt text is sent to whichever backend the
 * key belongs to.
 */
import type { Register } from 'claude-code'
import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  describeDecision,
  describeSetup,
  describeStatus,
  endpoint,
  pendingDecisions,
  agentDecisions,
  readDecision,
  selectProvider,
  requestBody,
  requestHeaders,
  requestModelId,
  route,
  TIER_ORDER,
  usableTier,
  bareCommand,
  capEffort,
  delegationNote,
  isOpenSpec,
  isPlanningPrompt,
  moreConfident,
} from './policy.ts'
import { showSent, showSubagent } from './running.ts'
import { applyRouterCommand, chatOf, routerOn, ROUTER_COMMANDS } from './chat.ts'
import type { ChatOverride, Held } from './chat.ts'
import type { Decision, Effort, PolicyConfig, Provider, Tier } from './policy.ts'

// A module may hook `turn.step` once, so the footer's label is fed from here,
// with the request as it is actually sent.
export const registerRouter: Register = (on, options) => {
  const text = (key: string, fallback: string) =>
    typeof options[key] === 'string' && options[key] ? (options[key] as string) : fallback
  const number = (key: string, fallback: number) =>
    typeof options[key] === 'number' ? (options[key] as number) : fallback
  const flag = (key: string, fallback: boolean) =>
    typeof options[key] === 'boolean' ? (options[key] as boolean) : fallback

  // TypeSafe's own API is preferred when both keys are set: it is the only
  // one that reports a calibrated confidence, which the policy's threshold
  // reads. `provider` forces one, including "builtin" to use neither.
  const typesafeKey = text('typesafeApiKey', '')
  const gatewayKey = text('gatewayApiKey', '')
  const forced = text('provider', 'auto')
  const active: Provider | null = selectProvider(forced, typesafeKey, gatewayKey)

  // Each backend keeps its own URL and model, so an override written for one
  // can never be sent to the other when `auto` picks differently than expected.
  const apiKey = active === 'typesafe' ? typesafeKey : active === 'gateway' ? gatewayKey : ''
  const modelId = !active
    ? ''
    : active === 'typesafe'
      ? text('typesafeModel', DEFAULT_MODEL.typesafe)
      : text('gatewayModel', DEFAULT_MODEL.gateway)
  const url = !active
    ? ''
    : active === 'typesafe'
      ? endpoint('typesafe', text('typesafeBaseUrl', DEFAULT_BASE_URL.typesafe))
      : endpoint('gateway', text('gatewayBaseUrl', DEFAULT_BASE_URL.gateway))

  // A backend named in the options but missing its key degrades to the
  // built-in classifier, which is silent; say so once, when a hook first runs.
  let unusableReported = forced === 'auto' || forced === 'builtin' || active !== null

  const timeoutMs = number('timeoutMs', 800)
  const routeSubagentModel = flag('routeSubagentModel', true)
  // The one-line status (`jev · balanced 0.88 · unchanged`); off, as the footer's
  // ⤷ already shows when Jev changed a request.
  const showStatus = flag('showStatus', false)
  // Suggest a subagent to the parent when Jev wants a cheaper model than it
  // runs on; off by default.
  const suggestDelegation = flag('suggestDelegation', false)
  const minDelegationConfidence = number('minDelegationConfidence', 0.6)
  // The decision of the last prompt whose parent was told to delegate; lent to
  // the subagents the main loop starts until the next prompt replaces it.
  let delegated: Decision | null = null
  const routeSubagentEffort = flag('routeSubagentEffort', true)
  const routeSubagent = routeSubagentModel || routeSubagentEffort
  const routeMainEffort = flag('routeMainEffort', true)
  const routeMainModel = flag('routeMainModel', false)
  const routeMainLoop = routeMainEffort || routeMainModel
  const logDecisions = flag('logDecisions', true)
  // Effort ceiling outside planning, and the effort planning runs at.
  const maxEffort = text('maxEffort', 'high') as Effort
  // `off` leaves plan mode, OpenSpec and planning subagents unlifted: they
  // follow the router and the ceiling like any other work.
  const planningSetting = text('planningEffort', 'xhigh') as Effort | 'off'
  // The `enabled` setting is the default; /router-off and /router-on override it per chat.
  const enabledSetting = flag('enabled', true)

  // Plan mode is read from the classic prompt hook, the one place a mod sees
  // it; OpenSpec from the prompt or a skill the turn loads.
  let permissionMode: string | undefined
  let openSpecTurn = false
  const planningLevel = (override: ChatOverride) => override.planning ?? planningSetting
  const planning = (override: ChatOverride) =>
    planningLevel(override) !== 'off' && (permissionMode === 'plan' || openSpecTurn)
  // Subagents spawned for planning, which plan at the planning effort too.
  const planningAgents = new Set<string>()
  // `/router-off`, `/router-on`, `/router-maxEffort-<level>` and
  // `/router-planning-effort-<level>`, kept per session in the store so a
  // resumed chat keeps them; read on first use.
  const held: Held = { current: null }
  // The ceiling of this chat, and the effort planning runs at under it.
  const ceiling = (override: ChatOverride) => override.max ?? maxEffort
  const planningDeep = (override: ChatOverride) => {
    const level = planningLevel(override)
    return level === 'off' ? ceiling(override) : level
  }

  for (const { name } of ROUTER_COMMANDS) {
    on('command.run', { command: name }, async $ => {
      const done = applyRouterCommand(name, await chatOf($, held))
      if (!done) return { text: `${name} is not a router command.` }
      held.current = done.next
      await $.store.set(`router:${await $.session.id()}`, JSON.stringify(done.next))
      return { text: done.text }
    })
  }

  const policy: PolicyConfig = {
    tiers: {
      fast: text('fastModel', 'haiku'),
      balanced: text('balancedModel', 'sonnet'),
      deep: text('deepModel', 'opus'),
    },
    disabledModels: text('disabledModels', '')
      .split(',')
      .map(entry => entry.trim())
      .filter(Boolean),
    minUpgradeConfidence: number('minUpgradeConfidence', 0.3),
    minDowngradeConfidence: number('minDowngradeConfidence', 0.6),
  }

  // The classification waiting for the turn that reads its prompt, and what
  // the current turn settled on. Both are single slots: main-loop turns run
  // one at a time, so nothing accumulates over a long session. `pending`
  // reports no decision when two prompts are waiting at once, rather than
  // routing a turn on a decision made for a different prompt.
  const pending = pendingDecisions()
  const agents = agentDecisions()
  // Said once, the first time a hook runs. A router that loaded and one that
  // never loaded are otherwise told apart only by the absence of later lines,
  // and absence is not evidence: the policy leaves most turns alone anyway.
  let announced = false
  let appliedTurnId: string | undefined
  let applied: { model?: string; effort?: Effort } | null = null

  on('classic.UserPromptSubmit', async ($, e, next) => {
    permissionMode = e.permission_mode
    return next(e)
  })

  on('skill.prompt', async ($, e, next) => {
    if (isOpenSpec(e.skill)) openSpecTurn = true
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    openSpecTurn = isPlanningPrompt(e.text) || isOpenSpec(e.command?.name)
    // Before the routing guards: a module whose switches are all off has still
    // loaded, and that is exactly when its silence is most misleading.
    if (!announced) {
      announced = true
      if (logDecisions) {
        $.ui.log(
          `[model-effort-router] ${describeSetup(
            active,
            url,
            {
              subagentModel: routeSubagentModel,
              subagentEffort: routeSubagentEffort,
              mainEffort: routeMainEffort,
              mainModel: routeMainModel,
            },
            forced === 'builtin',
          )}`,
        )
      }
    }
    if (!routeMainLoop) return next(e)
    // Paused for this chat: no classification, no hand-off, nothing changed.
    if (!(await routerOn($, held, enabledSetting))) {
      pending.put(null)
      return next(e)
    }

    if (!unusableReported) {
      unusableReported = true
      $.ui.log(`[model-effort-router] provider "${forced}" has no key set; using the built-in classifier`)
    }

    // A slash command alone gives the decision model only the command's name.
    // Its turn keeps the session's model and effort; the null put keeps a
    // previous prompt's decision from reaching it.
    if (bareCommand(e.text)) {
      if (logDecisions) $.ui.log('[model-effort-router] a command with nothing after it; leaving the turn alone')
      pending.put(null)
      return next(e)
    }

    const startedAt = await $.clock.now()
    let decision: Decision | null = null
    if (active) {
      try {
        const response = await Promise.race([
          $.http.fetch(url, {
            method: 'POST',
            headers: requestHeaders(active, apiKey, modelId),
            body: requestBody(active, { prompt: e.text }, modelId),
          }),
          $.clock.sleep(timeoutMs),
        ])
        if (response && response.ok) decision = readDecision(response.text)
        else if (response) $.ui.log(`[model-effort-router] ${active} responded ${response.status}`)
        else $.ui.log(`[model-effort-router] classification passed ${timeoutMs}ms; leaving the turn alone`)
      } catch (error) {
        $.ui.log(`[model-effort-router] classification failed: ${String(error)}`)
      }
    } else {
      // No backend: the engine's own small-model classifier answers the same
      // question, without the confidence the policy's threshold reads.
      try {
        const label = await $.model.classify(e.text, TIER_ORDER)
        if (label) {
          decision = {
            tier: label as Tier,
            confidence: null,
            risky: null,
            effort: null,
            effortConfidence: null,
          }
        }
      } catch (error) {
        $.ui.log(`[model-effort-router] built-in classifier failed: ${String(error)}`)
      }
    }

    // What the decision model actually answered, whatever the policy then
    // does with it. This is the line that proves the classification ran.
    if (logDecisions) {
      const ms = (await $.clock.now()) - startedAt
      $.ui.log(`[model-effort-router] jev: ${describeDecision(decision, ms)}`)
    }

    pending.put(decision)
    delegated = null
    // Only the person's own prompt at an idle session: never a background
    // task's notification, a plugin's prompt, a routine's, a peer session's,
    // a command, attachments or a mid-turn message.
    const notTyped = ['plugin', 'task-notification', 'scheduled-trigger', 'peer'].includes(e.origin?.kind ?? '')
    const ownPrompt = !notTyped && !e.command && !e.attachments?.length && !e.turnId
    if (suggestDelegation && ownPrompt) {
      const note = delegationNote(decision, await $.session.model(), policy, minDelegationConfidence)
      if (note) {
        delegated = decision
        if (logDecisions) $.ui.log(`[model-effort-router] suggested a ${decision?.tier} subagent to the parent`)
        return next({ ...e, context: [...(e.context ?? []), note] })
      }
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId) {
      // A subagent's request: the effort decided at its spawn, measured from
      // the effort the engine built this request with. The same answer on
      // every request, so its effort never changes under its own tool loop.
      const override = await chatOf($, held)
      if (!(await routerOn($, held, enabledSetting))) {
        await showSubagent($, e.agentId, e.model, e.effort)
        return yield* next(e)
      }
      const decision = routeSubagentEffort ? agents.get(e.agentId) : undefined
      const capped = (out: typeof e) => ({
        ...out,
        effort: capEffort(out.effort, planningAgents.has(e.agentId as string), ceiling(override), planningDeep(override)),
      })
      if (!decision) {
        const out = capped(e)
        await showSubagent($, e.agentId, out.model, out.effort)
        return yield* next(out)
      }
      const { effort, reason } = route(decision, { model: e.model, effort: e.effort }, policy)
      if (logDecisions && e.index === 0) {
        $.ui.log(`[model-effort-router] subagent ${effort ? `→ effort ${effort}` : 'effort'}: ${reason}`)
      }
      const out = capped(effort ? { ...e, effort } : e)
      await showSubagent($, e.agentId, out.model, out.effort)
      return yield* next(out)
    }
    // Capped at every step, so an OpenSpec skill loaded mid-turn lifts it.
    const override = await chatOf($, held)
    const send = async function* (routed: typeof e) {
      const lifted = planning(override)
      const out = {
        ...routed,
        effort: capEffort(routed.effort, lifted, ceiling(override), planningDeep(override)),
      }
      if (logDecisions && out.effort !== routed.effort) {
        const why = lifted ? 'planning' : 'cap'
        $.ui.log(`[model-effort-router] effort ${routed.effort} → ${out.effort} (${why})`)
      }
      await showSent($, out.model, out.effort, e)
      return yield* next(out)
    }
    if (!routeMainLoop) return yield* send(e)
    // Paused for this chat: the request goes out as Claude Code built it.
    if (!(await routerOn($, held, enabledSetting))) {
      pending.take()
      await showSent($, e.model, e.effort, e)
      return yield* next(e)
    }

    // Every request after the first reuses what the turn settled on, so
    // neither the model nor the effort changes under its own tool loop.
    if (e.index > 0 && e.turnId === appliedTurnId) {
      return yield* send(applied ? { ...e, ...applied } : e)
    }

    const decision = pending.take()
    const routing = route(decision, { model: e.model, effort: e.effort }, policy)
    const change: { model?: string; effort?: Effort } = {}
    // The main loop's `model` is sent to the API as written, so an alias
    // becomes its id here; a subagent's (agent.spawn) may stay an alias.
    if (routeMainModel && routing.model) change.model = requestModelId(routing.model)
    if (routeMainEffort && routing.effort) change.effort = routing.effort

    appliedTurnId = e.turnId
    applied = Object.keys(change).length > 0 ? change : null
    // A row in the transcript scrolls away; this line stays on screen.
    // Off, it is cleared instead: a status stays on screen until a mod clears
    // it, so one an earlier session left would otherwise never go away.
    $.ui.status(showStatus ? describeStatus(decision, applied) : undefined)

    if (!applied) {
      // A turn left alone is the common case, and it used to be silent, which
      // made a working mod look like one that never loaded. Say what happened.
      if (logDecisions) {
        const suppressed = routing.model && !routeMainModel ? ' (main-loop model routing off)' : ''
        $.ui.log(`[model-effort-router] main loop: ${routing.reason}${suppressed}`)
      }
      return yield* send(e)
    }
    if (logDecisions) {
      const what = [change.model, change.effort && `effort ${change.effort}`]
        .filter(Boolean)
        .join(', ')
      $.ui.log(`[model-effort-router] main loop → ${what}: ${routing.reason}`)
    }
    return yield* send({ ...e, ...change })
  })

  on('agent.spawn', async ($, e, next) => {
    // Before the routing guards: a module whose switches are all off has still
    // loaded, and that is exactly when its silence is most misleading.
    if (!announced) {
      announced = true
      if (logDecisions) {
        $.ui.log(
          `[model-effort-router] ${describeSetup(
            active,
            url,
            {
              subagentModel: routeSubagentModel,
              subagentEffort: routeSubagentEffort,
              mainEffort: routeMainEffort,
              mainModel: routeMainModel,
            },
            forced === 'builtin',
          )}`,
        )
      }
    }

    if (!(await routerOn($, held, enabledSetting))) return next(e)

    // Planning subagents always run on the deep tier, whatever Jev would say.
    // A fork inherits its parent's model; `model` is ignored for it.
    const override = await chatOf($, held)
    if (planningLevel(override) !== 'off' && (e.permissionMode === 'plan' || planning(override) || e.subagentType === 'Plan')) {
      const deep = usableTier('deep', policy)
      const model = e.fork || !deep ? undefined : policy.tiers[deep]
      if (logDecisions) {
        $.ui.log(`[model-effort-router] ${e.subagentType}: planning → ${model ?? 'parent model'}/${planningDeep(override)}`)
      }
      const started = await next(model ? { ...e, model } : e)
      if ('agentId' in started && started.agentId) planningAgents.add(started.agentId)
      return started
    }

    if (!routeSubagent || e.fork) return next(e)

    if (!unusableReported) {
      unusableReported = true
      $.ui.log(`[model-effort-router] provider "${forced}" has no key set; using the built-in classifier`)
    }

    const startedAt = await $.clock.now()
    let decision: Decision | null = null
    if (active) {
      try {
        const response = await Promise.race([
          $.http.fetch(url, {
            method: 'POST',
            headers: requestHeaders(active, apiKey, modelId),
            body: requestBody(
              active,
              { prompt: e.prompt, description: e.description, agentType: e.subagentType },
              modelId,
            ),
          }),
          $.clock.sleep(timeoutMs),
        ])
        if (response && response.ok) decision = readDecision(response.text)
        else if (response) $.ui.log(`[model-effort-router] ${active} responded ${response.status}`)
        else $.ui.log(`[model-effort-router] classification passed ${timeoutMs}ms; leaving the subagent alone`)
      } catch (error) {
        $.ui.log(`[model-effort-router] classification failed: ${String(error)}`)
      }
    } else {
      try {
        const label = await $.model.classify(e.prompt, TIER_ORDER)
        if (label) {
          decision = {
            tier: label as Tier,
            confidence: null,
            risky: null,
            effort: null,
            effortConfidence: null,
          }
        }
      } catch (error) {
        $.ui.log(`[model-effort-router] built-in classifier failed: ${String(error)}`)
      }
    }

    if (logDecisions) {
      const ms = (await $.clock.now()) - startedAt
      $.ui.log(`[model-effort-router] jev (${e.subagentType}): ${describeDecision(decision, ms)}`)
    }

    // A subagent the main loop starts after the parent was told to delegate:
    // the brief is the parent's rewording, often rated less surely than the
    // prompt itself, so the surer of the two decides.
    if (delegated && !e.parentAgentId) {
      const surer = moreConfident(delegated, decision)
      if (surer !== decision && logDecisions) {
        $.ui.log(`[model-effort-router] ${e.subagentType}: using the delegated turn's rating (${describeDecision(surer, null)})`)
      }
      decision = surer
    }
    // A delegated subagent may move down at the bar that fired the note: it
    // starts fresh, so a cheaper model costs it no cache.
    const delegatedSpawn = !!delegated && !e.parentAgentId
    const spawnPolicy = delegatedSpawn
      ? { ...policy, minDowngradeConfidence: Math.min(policy.minDowngradeConfidence, minDelegationConfidence) }
      : policy

    // The subagent's own model wins when the caller named one; otherwise it
    // would inherit the parent's, so that is what a change is measured from.
    // The Agent tool takes no effort; that is applied at the subagent's own
    // turn.step, from the decision kept under the agentId the spawn returns.
    const current = e.model ?? e.parentModel
    const { model: routed, reason } = route(decision, { model: current }, spawnPolicy)
    const model = routeSubagentModel ? routed : null
    if (logDecisions && routeSubagentModel) {
      $.ui.log(`[model-effort-router] ${e.subagentType}${model ? ` → ${model}` : ''}: ${reason}`)
    }
    const started = await next(model ? { ...e, model } : e)
    if (routeSubagentEffort && decision && 'agentId' in started && started.agentId) {
      agents.put(started.agentId, decision)
    }
    return started
  })
}
