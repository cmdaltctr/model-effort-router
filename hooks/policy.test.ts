import { describe, expect, test } from 'claude-code/testing'

import { capEffort, isOpenSpec, isPlanningPrompt, route, usableTier } from './policy'
import type { Decision, PolicyConfig } from './policy'

describe('effort cap', () => {
  test('holds ordinary work at the ceiling', () => {
    expect(capEffort('xhigh', false, 'high', 'xhigh')).toBe('high')
    expect(capEffort('max', false, 'high', 'xhigh')).toBe('high')
  })

  test('leaves effort under the ceiling alone', () => {
    expect(capEffort('medium', false, 'high', 'xhigh')).toBe('medium')
    expect(capEffort(undefined, false, 'high', 'xhigh')).toBe(undefined)
  })

  test('planning runs at the planning effort', () => {
    expect(capEffort('high', true, 'high', 'xhigh')).toBe('xhigh')
    expect(capEffort('low', true, 'high', 'xhigh')).toBe('xhigh')
  })

  test('a numeric effort is left alone', () => {
    expect(capEffort(9000, false, 'high', 'xhigh')).toBe(9000)
  })
})

const DOCS_BRIEF =
  'You write the decision record and all documentation for the OpenSpec change ' +
  '`separate-local-chat-and-classification` in the OMRS repo. I (the lead) write the Python backend ' +
  'and `openapi.yaml` in another worktree; a web agent writes `web/`. You own Markdown docs and `.env.example` only.'

describe('OpenSpec detection', () => {
  test('planning commands and skills', () => {
    expect(isOpenSpec('/opsx:propose add thing')).toBe(true)
    expect(isOpenSpec('opsx-explore')).toBe(true)
    expect(isOpenSpec('openspec-propose')).toBe(true)
    expect(isOpenSpec('openspec-new-change')).toBe(true)
    expect(isOpenSpec('openspec-update-change')).toBe(true)
    expect(isOpenSpec('opsx:verify')).toBe(true)
  })

  test('build and housekeeping commands are not planning', () => {
    expect(isOpenSpec('/opsx:apply add-thing')).toBe(false)
    expect(isOpenSpec('openspec-apply-change')).toBe(false)
    expect(isOpenSpec('opsx:archive')).toBe(false)
    expect(isOpenSpec('openspec-sync-specs')).toBe(false)
  })

  test('the word OpenSpec in prose is not a command', () => {
    expect(isOpenSpec('the OpenSpec change add-thing')).toBe(false)
    expect(isOpenSpec('read openspec/changes/foo/tasks.md')).toBe(false)
    expect(isOpenSpec(DOCS_BRIEF)).toBe(false)
    expect(isOpenSpec(undefined)).toBe(false)
  })
})

describe('planning prompts', () => {
  test('a prompt that starts with plan, or names a planning command', () => {
    expect(isPlanningPrompt('plan: the statement import')).toBe(true)
    expect(isPlanningPrompt('Plan the sync rollout')).toBe(true)
    expect(isPlanningPrompt('  planning the hub move')).toBe(true)
    expect(isPlanningPrompt('/opsx:propose add thing')).toBe(true)
    expect(isPlanningPrompt('run opsx-propose for this')).toBe(true)
  })

  test('plan later in the prompt, documentation and build prompts', () => {
    expect(isPlanningPrompt('carry on with the plan')).toBe(false)
    expect(isPlanningPrompt('can you plan this out?')).toBe(false)
    expect(isPlanningPrompt('planet icon is wrong')).toBe(false)
    expect(isPlanningPrompt(DOCS_BRIEF)).toBe(false)
    expect(isPlanningPrompt('/opsx:apply add-thing')).toBe(false)
    expect(isPlanningPrompt(undefined)).toBe(false)
  })
})

const TIERS = { fast: 'haiku', balanced: 'sonnet', deep: 'opus' }
const CONFIG: PolicyConfig = { tiers: TIERS, minUpgradeConfidence: 0.3, minDowngradeConfidence: 0.6 }
const FAST: Decision = { tier: 'fast', confidence: 0.9, effort: 0, effortConfidence: 0.9, risky: 0 } as Decision

describe('disabled models', () => {
  test('nothing is disabled by default', () => {
    expect(usableTier('fast', CONFIG)).toBe('fast')
    expect(route(FAST, { model: 'claude-opus-5' }, CONFIG).model).toBe('haiku')
  })

  test('a disabled tier falls to the next one up, whatever the effort', () => {
    const config = { ...CONFIG, disabledModels: ['haiku'] }
    expect(usableTier('fast', config)).toBe('balanced')
    expect(route(FAST, { model: 'claude-opus-5' }, config).model).toBe('sonnet')
    expect(route({ ...FAST, effort: 3 }, { model: 'claude-opus-5' }, config).model).toBe('sonnet')
  })

  test('matches full ids and ignores case', () => {
    const config = { ...CONFIG, tiers: { ...TIERS, fast: 'claude-haiku-4-5-20251001' }, disabledModels: ['HAIKU'] }
    expect(usableTier('fast', config)).toBe('balanced')
  })

  test('falls back to a cheaper tier when nothing above is enabled', () => {
    const config = { ...CONFIG, disabledModels: ['opus'] }
    expect(usableTier('deep', config)).toBe('balanced')
  })

  test('no usable tier leaves the model alone', () => {
    const config = { ...CONFIG, disabledModels: ['haiku', 'sonnet', 'opus'] }
    expect(usableTier('fast', config)).toBe(null)
    expect(route(FAST, { model: 'claude-opus-5' }, config).model).toBe(null)
  })
})
