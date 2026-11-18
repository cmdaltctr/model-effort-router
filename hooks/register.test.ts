import { describe, expect, mock, test } from 'claude-code/testing'

import { footerLabel, modelName, subagentLabel } from './register'

const SESSION = { cwd: '/work', surface: 'terminal', isInteractive: true } as const

type Part = { text: string; color?: string }

function parts(node: any, inherited: Omit<Part, 'text'> = {}): Part[] {
  if (typeof node === 'string') return node ? [{ text: node, ...inherited }] : []
  if (!node || !Array.isArray(node.children)) return []
  const style = node.type === 'Text' ? { color: node.props?.color ?? inherited.color } : inherited
  return node.children.flatMap((child: any) => parts(child, style))
}

/** Stands in for the engine and the OMMS mod: the footer draws `● omms: connected`. */
function world(on: any, model: string, effortLevel?: string | Record<string, unknown>) {
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }) as any)
  on('session.id', () => ({ value: 's1' }) as any)
  const store = new Map<string, unknown>()
  on('store.get', (_$: any, e: any) => ({ value: store.get(e.key) }) as any)
  on('store.set', (_$: any, e: any) => (store.set(e.key, e.value), { value: undefined }) as any)
  on('store.delete', (_$: any, e: any) => (store.delete(e.key), { value: undefined }) as any)
  on('session.model', () => ({ value: model }))
  on('settings.read', () => ({
    value: typeof effortLevel === 'object' ? effortLevel : effortLevel ? { effortLevel } : {},
  }))
  on('ui.render', { component: 'SessionMode' }, (_$: any, e: any) => ({
    type: 'Box',
    props: { flexDirection: 'row' },
    children: [
      ...(e.props.modes.length ? [e.props.modes.join(' & '), ' · '] : []),
      { type: 'Text', props: { color: 'success' }, children: ['● omms: connected'] },
    ],
  }))
}

async function footer($: any, modes: string[] = []) {
  const mounted = await $.ui.mount({
    plugin: 'model-effort-router',
    surface: 'terminal',
    component: 'SessionMode',
    props: { modes },
  })
  return async () => parts(await mounted.drawn())
}

describe('model and effort', () => {
  test('model name from an id', () => {
    expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(modelName('claude-opus-5-5[1m]')).toBe('Opus 5.5 (1M)')
    expect(modelName('opus')).toBe('Opus')
  })

  test('at start, the model\'s own effort setting wins over the global one', async ($, on) => {
    world(on, 'claude-opus-5-5', {
      effortLevel: 'high',
      modelSettings: { 'claude-opus-5-5': { effortLevel: 'medium' } },
    })
    const draw = await footer($)
    await $.session.start(SESSION)
    expect((await draw()).map(p => p.text).join('')).toBe('Opus 5.5 / medium · ● omms: connected')
  })

  test('blue model and effort, left of the OMMS label', async ($, on) => {
    world(on, 'claude-opus-5-5', 'high')
    const draw = await footer($)
    await $.session.start(SESSION)
    const runs = await draw()
    expect(runs.map(p => p.text).join('')).toBe('Opus 5.5 / high · ● omms: connected')
    expect(runs.find(p => p.text === 'Opus 5.5')?.color).toBe('#5fafff')
    expect(runs.find(p => p.text === 'high')?.color).toBe('#5fafff')
  })

  test('sits between engine mode labels and the OMMS label', async ($, on) => {
    world(on, 'claude-opus-5-5', 'high')
    const draw = await footer($, ['plan mode'])
    await $.session.start(SESSION)
    const text = (await draw()).map(p => p.text).join('')
    expect(text).toBe('plan mode · Opus 5.5 / high · ● omms: connected')
  })

  test('a main-loop request updates the label', async ($, on) => {
    world(on, 'claude-opus-5-5', 'high')
    on('turn.step', async function* (_$: any, e: any) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
    })
    const draw = await footer($)
    await $.session.start(SESSION)
    for await (const _ of $.turn.step({
      turnId: 't',
      index: 0,
      model: 'claude-sonnet-5-5',
      effort: 'medium',
      messageCount: 1,
    }))
      void _
    const text = (await draw()).map(p => p.text).join('')
    expect(text).toBe('Sonnet 5.5 / medium · ● omms: connected')
  })

  test('effort above the ceiling is sent as high outside planning', async ($, on) => {
    world(on, 'claude-opus-5-5', 'high')
    on('turn.step', async function* (_$: any, e: any) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
    })
    const draw = await footer($)
    await $.session.start(SESSION)
    for await (const _ of $.turn.step({
      turnId: 't',
      index: 0,
      model: 'claude-sonnet-5-5',
      effort: 'max',
      messageCount: 1,
    }))
      void _
    const text = (await draw()).map(p => p.text).join('')
    expect(text).toBe('⤷ Sonnet 5.5 / high · ● omms: connected')
  })

  /** Sends one main-loop request through the hooks and returns the effort that reached the engine. */
  async function sentEffort($: any, on: any, effort: string, commands: string[] = []) {
    world(on, 'claude-opus-5-5', 'high')
    const sent: unknown[] = []
    on('turn.step', async function* (_$: any, e: any) {
      sent.push(e.effort)
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
    })
    await footer($)
    await $.session.start(SESSION)
    for (const command of commands) await $.command.run({ command, args: '' } as any)
    for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', effort, messageCount: 1 }))
      void _
    return sent[0]
  }

  test('/router-maxEffort-low lowers this chat\'s ceiling', async ($, on) => {
    expect(await sentEffort($, on, 'high', ['router-maxEffort-low'])).toBe('low')
  })

  test('/router-maxEffort-xhigh raises this chat\'s ceiling above the setting', async ($, on) => {
    expect(await sentEffort($, on, 'xhigh', ['router-maxEffort-xhigh'])).toBe('xhigh')
  })

  test('/router-off sends the session\'s own effort', async ($, on) => {
    expect(await sentEffort($, on, 'max', ['router-off'])).toBe('max')
  })

  test('/router-on after /router-off caps again', async ($, on) => {
    expect(await sentEffort($, on, 'max', ['router-off', 'router-on'])).toBe('high')
  })

  test('the enabled setting off pauses the router; /router-on overrides it', { options: { enabled: false } }, async ($, on) => {
    expect(await sentEffort($, on, 'max')).toBe('max')
  })

  test('/router-on turns on a router the enabled setting paused', { options: { enabled: false } }, async ($, on) => {
    expect(await sentEffort($, on, 'max', ['router-on'])).toBe('high')
  })

  /** A planning prompt ("plan ..."), then one main-loop request at `effort`. */
  async function planningEffort($: any, on: any, effort: string, commands: string[] = []) {
    world(on, 'claude-opus-5-5', 'high')
    mock.clock(on)
    on('prompt.submit', (_$: any, e: any) => ({ text: e.text }) as any)
    on('ui.log', () => ({ value: undefined }) as any)
    on('ui.status', () => ({ value: undefined }) as any)
    on('model.classify', () => ({ value: null }) as any)
    const sent: unknown[] = []
    on('turn.step', async function* (_$: any, e: any) {
      sent.push(e.effort)
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
    })
    await footer($)
    await $.session.start(SESSION)
    for (const command of commands) await $.command.run({ command, args: '' } as any)
    await $.prompt.submit({ text: 'plan the migration of the store' } as any)
    for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', effort, messageCount: 1 }))
      void _
    return sent[0]
  }

  test('planning is lifted to the planning effort by default', async ($, on) => {
    expect(await planningEffort($, on, 'medium')).toBe('high')
  })

  test('planningEffort off caps planning at the normal ceiling', { options: { planningEffort: 'off' } }, async ($, on) => {
    expect(await planningEffort($, on, 'xhigh')).toBe('high')
  })

  test('planningEffort off does not raise planning', { options: { planningEffort: 'off' } }, async ($, on) => {
    expect(await planningEffort($, on, 'medium')).toBe('medium')
  })

  test('/router-planning-effort-high plans at high instead of the setting', async ($, on) => {
    expect(await planningEffort($, on, 'medium', ['router-planning-effort-high'])).toBe('high')
  })

  test('/router-planning-effort-off stops the planning lift for this chat', async ($, on) => {
    expect(await planningEffort($, on, 'xhigh', ['router-planning-effort-off'])).toBe('high')
  })

  test('/router-planning-effort-xhigh lifts planning when the setting is off', { options: { planningEffort: 'off' } }, async ($, on) => {
    expect(await planningEffort($, on, 'medium', ['router-planning-effort-xhigh'])).toBe('xhigh')
  })

  test('the chat ceiling does not change the planning effort', async ($, on) => {
    expect(await planningEffort($, on, 'medium', ['router-maxEffort-low'])).toBe('high')
  })

  // The router changes the request, not the session's setting, so the footer
  // must show the effort actually sent, whichever hook runs first.
  test(
    'the footer shows the effort Jev sent, marked with ⤷, not the session setting',
    { options: { provider: 'typesafe', typesafeApiKey: 'test-key' } },
    async ($, on) => {
      world(on, 'claude-opus-5-5', 'high')
      mock.clock(on)
      on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: jevAnswer('fast', 0.95, 0.1) } }) as any)
      on('prompt.submit', (_$: any, e: any) => ({ text: e.text }) as any)
      on('ui.log', () => ({ value: undefined }) as any)
      on('ui.status', () => ({ value: undefined }) as any)
      const sent: unknown[] = []
      on('turn.step', async function* (_$: any, e: any) {
        sent.push(e.effort)
        return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
      })
      const draw = await footer($)
      await $.session.start(SESSION)
      await $.prompt.submit({ text: 'rename x to count' } as any)
      for await (const _ of $.turn.step({
        turnId: 't',
        index: 0,
        model: 'claude-opus-5-5',
        effort: 'high',
        messageCount: 1,
      }))
        void _
      expect(sent).toEqual(['low'])
      const text = (await draw()).map(p => p.text).join('')
      expect(text).toBe('⤷ Opus 5.5 / low · ● omms: connected')
      // The next request of the same turn reuses the decision: still marked.
      for await (const _ of $.turn.step({ turnId: 't', index: 1, model: 'claude-opus-5-5', effort: 'high', messageCount: 3 }))
        void _
      expect((await draw()).map(p => p.text).join('')).toBe('⤷ Opus 5.5 / low · ● omms: connected')
    },
  )
})

describe('subagents', () => {
  /** Sends one subagent request through the hooks, as the engine would. */
  async function subagentStep($: any, agentId: string, model: string, effort: string) {
    for await (const _ of $.turn.step({ turnId: `t-${agentId}`, index: 0, agentId, model, effort, messageCount: 1 }))
      void _
  }

  /** Stands in for the engine: answers requests and turn ends. */
  function engine(on: any) {
    on('turn.step', async function* (_$: any, e: any) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
    })
    on('turn.complete', (_$: any, e: any) => ({ text: e.answer ?? '' }) as any)
  }

  async function shown(draw: () => Promise<Part[]>) {
    return (await draw()).map(p => p.text).join('')
  }

  test('the parent footer shows only its own model while subagents run', async ($, on) => {
    world(on, 'claude-opus-5-5', 'high')
    engine(on)
    const draw = await footer($)
    await $.session.start(SESSION)
    await subagentStep($, 'a1', 'claude-haiku-5-5', 'low')
    await subagentStep($, 'a2', 'claude-sonnet-5-5', 'medium')
    expect(await shown(draw)).toBe('Opus 5.5 / high · ● omms: connected')
  })

  /** Mounts the band above the prompt with `agentId`'s transcript on screen. */
  async function band($: any, agentId?: string) {
    const mounted = await $.ui.mount({
      plugin: 'model-effort-router',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: {
        hasSurvey: false,
        isWorking: false,
        maxRows: 10,
        bodyColumns: 80,
        scroll: { offset: 0, bodyRows: 10 },
        view: agentId ? { agentId } : {},
      },
    })
    return async () => parts(await mounted.drawn())
  }

  test('the band shows the viewed subagent\'s own model and effort with ⤷', async ($, on) => {
    world(on, 'claude-opus-5-5', 'high')
    engine(on)
    on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box', props: {}, children: [] }) as any)
    await $.session.start(SESSION)
    await subagentStep($, 'a1', 'claude-haiku-5-5', 'high')
    await subagentStep($, 'a2', 'claude-sonnet-5-5', 'medium')
    const runs = await (await band($, 'a1'))()
    expect(runs.map(p => p.text).join('')).toBe('⤷ Haiku 5.5 / high')
    expect(runs.find(p => p.text === 'Haiku 5.5')?.color).toBe('#5fafff')
    expect((await shown(await band($, 'a2')))).toBe('⤷ Sonnet 5.5 / medium')
  })

  test('the band keeps a line another mod draws, below its own', async ($, on) => {
    world(on, 'claude-opus-5-5', 'high')
    engine(on)
    on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', props: {}, children: ['⎇ wt'] }) as any)
    await $.session.start(SESSION)
    await subagentStep($, 'a1', 'claude-haiku-5-5', 'high')
    expect(await shown(await band($, 'a1'))).toBe('⤷ Haiku 5.5 / high⎇ wt')
  })

  test('the band adds nothing on the main transcript or for an unknown agent', async ($, on) => {
    world(on, 'claude-opus-5-5', 'high')
    engine(on)
    on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box', props: {}, children: [] }) as any)
    await $.session.start(SESSION)
    await subagentStep($, 'a1', 'claude-haiku-5-5', 'high')
    expect(await shown(await band($))).toBe('')
    expect(await shown(await band($, 'other'))).toBe('')
  })

  // The session started on `opus` at `high`: the defaults the ⤷ compares with.
  const DEFAULTS = { model: 'opus', effort: 'high' }
  const PARENT = { model: 'claude-opus-5-5', effort: 'high', defaults: DEFAULTS }
  const SEEN = [
    { id: 'a1', model: 'claude-haiku-5-5', effort: 'high' },
    { id: 'fork', model: 'claude-opus-5-5', effort: 'high' },
  ]

  test('a subagent is marked when its model or effort is not the default', () => {
    expect(subagentLabel(PARENT, SEEN, 'a1')).toEqual({ mark: true, model: 'claude-haiku-5-5', effort: 'high' })
    expect(subagentLabel(PARENT, SEEN, 'fork')).toEqual({ mark: false, model: 'claude-opus-5-5', effort: 'high' })
    expect(subagentLabel(PARENT, SEEN, 'nobody')).toBeNull()
  })

  test('the parent is marked whenever it differs from the default, on every request', () => {
    expect(footerLabel(PARENT)).toEqual({ mark: false, model: 'claude-opus-5-5', effort: 'high' })
    expect(footerLabel({ ...PARENT, effort: 'low' })).toEqual({ mark: true, model: 'claude-opus-5-5', effort: 'low' })
    expect(footerLabel({ ...PARENT, model: 'claude-sonnet-5-5' })?.mark).toBe(true)
  })

  test('nothing to show before the parent model is known', () => {
    expect(footerLabel({ model: null, effort: null, defaults: DEFAULTS })).toBeNull()
  })
})

describe('status line', () => {
  /** Runs one routed main-loop turn and returns the status lines the router set. */
  async function statusesAfterTurn($: any, on: any) {
    const statuses: unknown[] = []
    world(on, 'claude-opus-5-5', 'high')
    mock.clock(on)
    on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: jevAnswer('fast', 0.95, 0.1) } }) as any)
    on('prompt.submit', (_$: any, e: any) => ({ text: e.text }) as any)
    on('ui.log', () => ({ value: undefined }) as any)
    on('ui.status', (_$: any, e: any) => {
      statuses.push(e)
      return { value: undefined } as any
    })
    on('turn.step', async function* (_$: any, e: any) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
    })
    await $.session.start(SESSION)
    await $.prompt.submit({ text: 'rename x to count' } as any)
    for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 }))
      void _
    return statuses
  }

  test(
    'the router sets no status text by default, and clears any left on screen',
    { options: { provider: 'typesafe', typesafeApiKey: 'test-key' } },
    async ($, on) => {
      // A status an earlier session left on screen is cleared; no text is set.
      const statuses = (await statusesAfterTurn($, on)) as { text?: string }[]
      expect(statuses.length).toBeGreaterThan(0)
      expect(statuses.every(s => !s.text)).toBe(true)
    },
  )

  test(
    'showStatus turns the status line on',
    { options: { provider: 'typesafe', typesafeApiKey: 'test-key', showStatus: true } },
    async ($, on) => {
      expect((await statusesAfterTurn($, on)).length).toBeGreaterThan(0)
    },
  )
})

describe('the ⤷ baseline', () => {
  // The baseline is the effort the engine builds (the session's setting), so a
  // settings read at start that gives no effort cannot hide a change.
  test(
    'Jev lowering high to medium is marked, with no effort in the settings read',
    { options: { provider: 'typesafe', typesafeApiKey: 'test-key' } },
    async ($, on) => {
      world(on, 'claude-opus-5-5')
      mock.clock(on)
      on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: jevAnswer('balanced', 0.95, 1) } }) as any)
      on('prompt.submit', (_$: any, e: any) => ({ text: e.text }) as any)
      on('ui.log', () => ({ value: undefined }) as any)
      on('turn.step', async function* (_$: any, e: any) {
        return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
      })
      await $.session.start(SESSION)
      const draw = await footer($)
      await $.prompt.submit({ text: 'explain this function' } as any)
      for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 }))
        void _
      expect((await draw()).map(p => p.text).join('')).toBe('⤷ Opus 5.5 / medium · ● omms: connected')
    },
  )
})

describe('delegation note', () => {
  /** Submits one prompt Jev rates fast and returns the context it carried. */
  async function contextOf($: any, on: any, origin?: object) {
    let seen: readonly string[] | undefined
    world(on, 'claude-opus-5-5', 'high')
    mock.clock(on)
    on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: jevAnswer('fast', 0.66, 1) } }) as any)
    on('prompt.submit', (_$: any, e: any) => {
      seen = e.context
      return { text: e.text, context: e.context } as any
    })
    on('ui.log', () => ({ value: undefined }) as any)
    await $.session.start(SESSION)
    await $.prompt.submit({ text: 'list the files in hooks', ...(origin ? { origin } : {}) } as any)
    return (seen ?? []).join('\n')
  }

  test(
    'with suggestDelegation on, a task Jev rates for Haiku carries the note',
    { options: { provider: 'typesafe', typesafeApiKey: 'test-key', suggestDelegation: true, disabledModels: '' } },
    async ($, on) => {
      const context = await contextOf($, on)
      expect(context).toContain('haiku')
      expect(context).toContain('subagent')
    },
  )

  test(
    'a background task\'s notification gets no note',
    { options: { provider: 'typesafe', typesafeApiKey: 'test-key', suggestDelegation: true } },
    async ($, on) => {
      expect(await contextOf($, on, { kind: 'task-notification' })).toBe('')
    },
  )

  test(
    'on by default: a cheap task carries the note',
    { options: { provider: 'typesafe', typesafeApiKey: 'test-key' } },
    async ($, on) => {
      expect(await contextOf($, on)).toContain('subagent')
    },
  )

  test(
    'suggestDelegation off: no note',
    { options: { provider: 'typesafe', typesafeApiKey: 'test-key', suggestDelegation: false } },
    async ($, on) => {
      expect(await contextOf($, on)).toBe('')
    },
  )
})

describe('delegated subagents', () => {
  /**
   * One delegated turn: Jev rates the prompt `promptConfidence` and the
   * subagent's brief 0.55. Returns the model the subagent was started with.
   */
  async function spawnedModel($: any, on: any, promptConfidence: number, spawn: Record<string, unknown> = {}, briefConfidence = 0.55) {
    let model: unknown = 'unset'
    world(on, 'claude-opus-5-5', 'high')
    mock.clock(on)
    on('http.fetch', (_$: any, e: any) => {
      const brief = String(e.init?.body ?? '').includes('the brief')
      const answer = jevAnswer('fast', brief ? briefConfidence : promptConfidence, 1)
      return { value: { status: 200, ok: true, headers: {}, text: answer } } as any
    })
    on('prompt.submit', (_$: any, e: any) => ({ text: e.text, context: e.context }) as any)
    on('ui.log', () => ({ value: undefined }) as any)
    on('agent.spawn', (_$: any, e: any) => {
      model = e.model
      return { model: e.model ?? e.parentModel, agentId: 'a1' } as any
    })
    await $.session.start(SESSION)
    await $.prompt.submit({ text: 'check the links in the README' } as any)
    await $.agent.spawn({
      prompt: 'the brief',
      description: 'check links',
      subagentType: 'general-purpose',
      parentModel: 'claude-opus-5-5',
      ...spawn,
    } as any)
    return model
  }

  const OPTIONS = { provider: 'typesafe', typesafeApiKey: 'test-key', suggestDelegation: true, minDowngradeConfidence: 0.8, disabledModels: '' }

  test('a Plan subagent always starts on Opus, whatever Jev rates it', { options: OPTIONS }, async ($, on) => {
    expect(await spawnedModel($, on, 0.94, { subagentType: 'Plan' })).toBe('opus')
  })

  test('a subagent spawned in plan mode starts on Opus', { options: OPTIONS }, async ($, on) => {
    expect(await spawnedModel($, on, 0.94, { permissionMode: 'plan' })).toBe('opus')
  })

  test('a subagent started in a delegated turn gets the turn\'s surer rating', { options: OPTIONS }, async ($, on) => {
    expect(await spawnedModel($, on, 0.94)).toBe('haiku')
  })

  test('a delegated turn below 0.8 but above the delegation bar still gets Haiku', { options: OPTIONS }, async ($, on) => {
    expect(await spawnedModel($, on, 0.74)).toBe('haiku')
  })

  test('by default Haiku is off: a fast task goes to Sonnet', { options: { provider: 'typesafe', typesafeApiKey: 'test-key' } }, async ($, on) => {
    expect(await spawnedModel($, on, 0.94)).toBe('sonnet')
  })

  test('without a delegation note, the brief\'s own rating decides', { options: OPTIONS }, async ($, on) => {
    // 0.5 is below minDelegationConfidence: no note, so nothing is carried.
    expect(await spawnedModel($, on, 0.5)).toBeUndefined()
  })

  test('a subagent with no delegation note keeps the 0.8 bar', { options: OPTIONS }, async ($, on) => {
    // The prompt (0.5) gets no note; the brief alone is 0.7, below 0.8.
    expect(await spawnedModel($, on, 0.5, {}, 0.7)).toBeUndefined()
  })

  test('a subagent started by a subagent is not lent the turn\'s rating', { options: OPTIONS }, async ($, on) => {
    expect(await spawnedModel($, on, 0.94, { parentAgentId: 'p1' })).toBeUndefined()
  })
})

describe('subagents of a Fable parent', () => {
  const OPTIONS = { provider: 'typesafe', typesafeApiKey: 'test-key', minDowngradeConfidence: 0.8, disabledModels: 'haiku' }

  /**
   * Starts one subagent under a Fable parent. `jev` is Jev's answer, or
   * 'fail' for a call that throws. Returns the model the subagent started with
   * and the effort its first request was sent with.
   */
  async function child(
    $: any,
    on: any,
    jev: { tier: string; confidence: number; risky?: number } | 'fail',
    spawn: Record<string, unknown> = {},
    commands: string[] = [],
    parent = 'claude-fable-5-2',
  ) {
    let model: unknown = 'unset'
    let effort: unknown = 'unset'
    world(on, parent, 'medium')
    mock.clock(on)
    on('http.fetch', () => {
      if (jev === 'fail') throw new Error('offline')
      return { value: { status: 200, ok: true, headers: {}, text: jevAnswer(jev.tier, jev.confidence, 1, jev.risky) } } as any
    })
    on('ui.log', () => ({ value: undefined }) as any)
    on('agent.spawn', (_$: any, e: any) => {
      model = e.model
      return { model: e.model ?? e.parentModel, agentId: 'a1' } as any
    })
    on('turn.step', async function* (_$: any, e: any) {
      if (e.agentId) effort = e.effort
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
    })
    await $.session.start(SESSION)
    for (const command of commands) await $.command.run({ command, args: '' } as any)
    await $.agent.spawn({
      prompt: 'the brief',
      description: 'a task',
      subagentType: 'general-purpose',
      parentModel: parent,
      ...spawn,
    } as any)
    for await (const _ of $.turn.step({ turnId: 't-a1', index: 0, agentId: 'a1', model: String(model ?? parent), effort: 'medium', messageCount: 1 }))
      void _
    return { model, effort }
  }

  test('an unsure Jev answer still moves the child off Fable, to Jev\'s pick', { options: OPTIONS }, async ($, on) => {
    expect((await child($, on, { tier: 'balanced', confidence: 0.2 })).model).toBe('sonnet')
  })

  test('an unsure hard rating goes to Opus', { options: OPTIONS }, async ($, on) => {
    expect((await child($, on, { tier: 'deep', confidence: 0.2 })).model).toBe('opus')
  })

  test('a sure easy rating clears the step down from Fable', { options: OPTIONS }, async ($, on) => {
    expect((await child($, on, { tier: 'fast', confidence: 0.5 })).model).toBe('sonnet')
  })

  test('no Jev answer: Sonnet at high effort', { options: OPTIONS }, async ($, on) => {
    expect(await child($, on, 'fail')).toEqual({ model: 'sonnet', effort: 'high' })
  })

  test('/router-off: Sonnet, effort left as Claude Code set it', { options: OPTIONS }, async ($, on) => {
    expect(await child($, on, 'fail', {}, ['router-off'])).toEqual({ model: 'sonnet', effort: 'medium' })
  })

  test('a parent that names Fable still gets Jev\'s pick', { options: OPTIONS }, async ($, on) => {
    expect((await child($, on, { tier: 'deep', confidence: 0.9 }, { model: 'fable' })).model).toBe('opus')
  })

  test('a Plan child with the deep tier off does not fall back to Fable', { options: { ...OPTIONS, disabledModels: 'opus' } }, async ($, on) => {
    expect((await child($, on, { tier: 'deep', confidence: 0.9 }, { subagentType: 'Plan' })).model).toBe('sonnet')
  })

  test('a forked child is left alone', { options: OPTIONS }, async ($, on) => {
    expect((await child($, on, { tier: 'fast', confidence: 0.9 }, { fork: true })).model).toBeUndefined()
  })

  test('a model the parent names is kept, not moved by Jev', { options: OPTIONS }, async ($, on) => {
    const result = await child($, on, { tier: 'fast', confidence: 0.95 }, { model: 'opus' }, [], 'claude-opus-5-5')
    expect(result.model).toBe('opus')
  })

  test('"inherit" is not a named model', { options: OPTIONS }, async ($, on) => {
    const result = await child($, on, { tier: 'fast', confidence: 0.95 }, { model: 'inherit' }, [], 'claude-opus-5-5')
    expect(result.model).toBe('sonnet')
  })

  test('an effort named in the brief wins, above the cap too', { options: OPTIONS }, async ($, on) => {
    const result = await child($, on, { tier: 'fast', confidence: 0.95 }, { prompt: 'the brief. effort: xhigh', model: 'opus' }, [], 'claude-opus-5-5')
    expect(result).toEqual({ model: 'opus', effort: 'xhigh' })
  })
})

/** A TypeSafe System One answer: the tier, an effort score and the risk. */
function jevAnswer(tier: string, confidence: number, effort: number, risky = 0.01) {
  return JSON.stringify({
    model: 'jev-1.13',
    answers: {
      tier: { type: 'choice', choice: tier, confidence, probabilities: { [tier]: confidence } },
      effort: { type: 'score', score: effort, confidence },
      risky: { type: 'noul', noul: risky },
    },
  })
}
