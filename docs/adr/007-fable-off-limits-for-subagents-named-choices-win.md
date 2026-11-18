# ADR-007: Fable is off limits for subagents; a named model or effort wins

- **Date:** 2026-11-17
- **Status:** Accepted (2026-11-18, after a live check: a Fable parent's helper ran on claude-sonnet-5-5)
- **Deciders:** Mod owner

## Context

Fable 5.2 costs $8/$40 per million tokens, twice the price of Opus 5.5. The owner runs the main chat on Fable and wants subagents never to run on it.

The mod knew only Haiku, Sonnet and Opus. Fable had no rank, so:
1. A subagent stayed on Fable when Jev timed out, failed or was below 0.3 confidence, or when `/router-off` was on.
2. The delegation note never fired on a Fable parent, because no tier counted as cheaper.

The owner sometimes asks for a subagent on a given model and effort (for example "Opus, high"). The mod could lower a named model, and the Agent tool has no effort field, so a named effort was lost.

## Decision

1. Rank Fable and Mythos one step above Opus.
2. Fable and Mythos never run a subagent. One check runs before every subagent starts, `/router-off` included:
   - Jev answered: use Jev's tier, however unsure (the deep tier when risky). Haiku is disabled in the owner's settings, so this gives Sonnet or Opus.
   - Jev gave no answer: use Sonnet at `high` effort.
   - `/router-off`: use Sonnet; leave the effort as Claude Code set it.
   - A parent that names Fable still gets the swap.
3. Forks are not changed. They are a different thing from subagents (ADR-002).
4. On a Fable parent, the delegation note fires for every tier, hard tasks included (an Opus helper). Risky tasks get no note.
5. A model the parent names in the Agent call is kept. Jev does not move it. `model: inherit` counts as no model named.
6. An effort the parent writes in the brief (`effort: high`, `xhigh effort`) wins over Jev and over `maxEffort`. It applies only while the router is on.
7. The delegation note tells the parent to keep a model or effort the user named.

## Consequences
### Positive
- No subagent runs on Fable.
- On Fable, most hard work can go to Opus helpers at half the price.
- The owner's explicit model and effort are kept.
### Negative
- A parent on Fable acts mostly as a manager; helpers see only the brief.
- A named effort is read from text, so only the two written forms count.
### Neutral
- This amends ADR-002 (an explicit model was a starting point) and ADR-003 (no answer meant no change).

## Alternatives Considered
| Option | Rejected Because |
|--------|-----------------|
| **Opus as the no-answer default** | The owner chose Sonnet at high effort as the cheaper default. |
| **Hint for easy and medium tasks only** | The owner wants Fable to hand hard work to Opus too. |
| **Rank Fable without the fallback** | A move down from Fable would need 0.8 confidence, so more subagents would stay on Fable. |
| **Keep the effort cap for a named effort** | The owner asks for an effort on purpose. |

## References
- `hooks/policy.ts` (`rankOf`, `offLimitsForSubagents`, `subagentFallback`, `namedEffort`, `delegationNote`)
- `hooks/router.ts` (`agent.spawn`: `offFable`, `namedEfforts`, `NO_ANSWER`)
- Tests: `tests/policy.test.ts`, `hooks/register.test.ts` ("subagents of a Fable parent")
- Backup before the change: `~/.agents/backups/mods-20261117/`
