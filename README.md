# model-effort-router

Changes the reasoning effort of the main conversation and of each subagent with [Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev), and shows the model and the effort actually sent in the prompt footer: `Opus 5.5 / low · ● omms: connected`. The footer follows each request, so it moves when Jev changes the effort. The footer always shows the parent. A subagent opened from the tasks list shows its own model and effort in the band above the prompt (`⤷ Haiku 5.5 / high`); the footer keeps the parent's label, because Claude Code tells the footer nothing about which transcript is on screen.

Merged on 2026-10-29 from two mods: `model-effort` (the footer) and `jev-model-router` 0.4.2 from claude-code-templates (MIT), with a local patch for subagent effort. The main conversation's model is never routed by default, because a model switch invalidates its prompt cache. Each subagent's model is routed once, at its start: a subagent begins with an empty context, so nothing cached is lost, and its model never changes mid-run. A fork keeps its parent's model and effort and is never routed. The log lines start with `[model-effort-router]`. A `⤷` before a label means its model or effort differs from the session's setting (the model and effort Claude Code builds each request with before the router changes it, for example `opus` / `high`). It stays as long as the difference does, for the parent and for a viewed subagent. The one-line status (`jev · balanced 0.88 · unchanged`) is off by default; turn on `showStatus` to see it. With `suggestDelegation` on, a task Jev rates for a cheaper tier than the parent (at `minDelegationConfidence`, default 0.6, and not risky) adds a hidden note to the prompt telling the parent to delegate it to a subagent and write that subagent's prompt; the parent may decline for follow-ups. A subagent the parent starts in that turn uses the surer of the prompt's and its brief's rating, and may move to a cheaper model at `minDelegationConfidence` instead of `minDowngradeConfidence`. At session start the footer reads the model's own effort (`modelSettings.<model>.effortLevel`, where `/effort` saves it) before the global `effortLevel`.

A mod may load one hooks module and hook `turn.step` once, so `hooks/register.tsx` loads the router (`hooks/router.ts`), and the router writes the footer's state (`hooks/running.ts`) on every main-loop request it sends.

The router's original notes follow.


Picks the model and the reasoning effort each task runs with, using [Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev), TypeSafe's System One decision model: unstructured state in, a typed choice with a probability distribution out, no free-form text.

Two backends, chosen by whichever key is set:

| Backend | Endpoint | Model | Confidence |
|---|---|---|---|
| `typesafe` | `POST api.typesafe.ai/v1/systemone` | `jev-latest` | reported per answer |
| `gateway` | `POST ai-gateway.vercel.sh/v4/ai/evaluation-model` | `typesafe-ai/jev` | derived from an optional distribution |

TypeSafe's own API wins when both keys are set: it is the only one that reports a calibrated confidence, which is what the confidence bars below read. Set `provider` to force one, or to `builtin` to use neither. Each backend keeps its own URL and model option, so an override written for one is never sent to the other. A `provider` forced onto a backend whose key is missing degrades to the built-in classifier and says so once in the log.

Four switches, and they are not equally safe:

| Switch | What it sets | Default |
|---|---|---|
| `routeSubagentModel` | the model of each subagent, at `agent.spawn`, once per subagent | on |
| `routeSubagentEffort` | the reasoning effort of each subagent, at its own `turn.step` | on |
| `routeMainEffort` | the reasoning effort of the main conversation, at `turn.step` | on |
| `routeMainModel` | the model of the main conversation, at `turn.step` | **off** |

A subagent starts with its own context, so routing its model costs nothing beyond the classification. Changing the main loop's *model* mid-session is the expensive one: it invalidates the prompt cache, and on a long context re-caching can cost more than the cheaper tier saves. Turn it on once you have measured your own sessions, not before.

The Agent tool has no effort parameter, so a subagent's effort is set on its own requests: the decision made at its spawn is kept under its `agentId` and applied at each of its `turn.step`s. A fork is left alone, model and effort, because it shares its parent's cached context.

**Both directions, both dimensions.** A task read as mechanical is routed down; one read as hard is routed up — model and effort alike.

The prompt is classified at `prompt.submit`, which runs before the turn starts, and the decision is applied to the turn's first model request and reused by the rest of that turn.

**With no key configured the mod still works**: it falls back to the engine's own `$.model.classify`, which answers the same question with the small fast model. That path reports no confidence, so the threshold does not apply to it.

## What it asks

One request, three questions evaluated in parallel:

- `tier` — a `choice` between three descriptions of the *work* (mechanical and local / ordinary engineering / hard or high-stakes). The decision model never sees a model name.
- `effort` — a `score` on a four-level rubric, for how much step-by-step reasoning the task needs.
- `risky` — whether the task touches production, money, credentials, or state that cannot be undone. A `noul` on TypeSafe's API, a `boolean` on the Gateway: the same question under two names.

## How it decides

TypeSafe's API reports a `confidence` per answer. The Gateway's answer shape carries **no `confidence` field**, so on that backend confidence is read as the highest probability in the distribution — and that distribution is itself optional in the schema, in which case confidence is absent and the threshold does not fire.

The two mistakes do not cost the same, so they do not clear the same bar:

- Spending **more** (a bigger model, more reasoning) needs `minUpgradeConfidence`, 0.3 by default. Being wrong costs money.
- Spending **less** needs `minDowngradeConfidence`, 0.6 by default. Being wrong means a task handled by too small a model or too little thought.
- `risky` above 0.7 takes the deep tier and real reasoning, past both bars. That one is not a confidence question.
- A backend that reports no confidence at all — the Gateway without a distribution, or the built-in classifier — may only move a request **up**. Spending less on an unmeasured hunch is the bad trade.
- A model id matching no tier, or a numeric effort (the caller's own scale), has no knowable direction: the model gets the gentler upgrade bar, and a numeric effort is left alone.

Every other failure — a non-2xx response, a timeout, a malformed body, a thrown error — leaves the request exactly as the engine built it. The router never blocks a turn.

A slash command with nothing after it (`/simplify`) is not classified: the decision model would see only the command's name, never what the command does. Its turn keeps the session's model and effort. With text after the name, the prompt is classified like any other.

## What you see in the transcript

With `logDecisions` on (the default), the router reports every step of its own
work, because nothing else in Claude Code shows it: the model and effort it
rewrites are parameters of each request, not the session's settings, so the
status line, the header and the effort box never move whatever it decides.

```
[model-effort-router] ready on typesafe (https://api.typesafe.ai/v1/systemone); routing subagent model, main effort
[model-effort-router] jev: tier fast (0.87) · effort 0.4 → low (0.71) · risky 0.02 · 249ms
[model-effort-router] main loop → effort low: fast (confidence 0.87)
[model-effort-router] jev: tier fast (0.41) · effort 0.4 → low (0.38) · risky 0.01 · 210ms
[model-effort-router] main loop: kept opus/medium, wanted haiku/low (confidence 0.41)
```

- The first line appears once per session, the first time a hook runs. It is
  the proof the module loaded and which backend answers it.
- A `jev:` line is what the decision model replied, before any policy is
  applied — the tier, the effort score and the risk, each with its confidence,
  and how long the call took.
- The line under it is what the policy then did. The last pair above is a
  working router declining to act: it wanted to spend less but did not clear
  `minDowngradeConfidence`.

It also keeps a one-line status on screen, replaced as it goes:

```
jev · fast 0.87 → haiku/low
jev · fast 0.41 · unchanged
```

`confidence n/d` means the backend reported no confidence, which the built-in
classifier never does and the Gateway does whenever its probability
distribution is absent; the `ready on` line says which one answered.

**No lines at all** has three causes, and only the last is the module failing
to load. Check them in this order:

1. **You ran `claude -p` (or the SDK).** A headless run has no transcript and
   no status row: every line still goes to the debug log,
   `~/.claude/debug/<session-id>.txt` (a `.txt`, not a `.log`; `latest` is a
   symlink to the newest), and an SDK host receives each one as `ui_log`. The
   router is working; look there.
2. **The plugin was never loaded.** Claude Code adopts a plugin from a
   project's `.claude/skills/` (where `--mod` writes it) only once the
   project is trusted: it is repository content, so an untrusted folder's
   `.claude/` is not read at all, and `claude -p` never asks. Open `claude`
   interactively in the folder and accept the trust prompt, or name the
   plugin explicitly with `--plugin-dir` (see Install). `claude --debug`
   settles it: a loaded module prints
   `hooks module jev-model-router@skills-dir loaded (worker, …); events: prompt.submit,turn.step,agent.spawn`
   (`@inline` when loaded with `--plugin-dir`); `Found N plugins` without it
   means the plugin is not in the session.
3. **Function hooks are off.** Without `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`
   the debug log says `installed plugins' hooks modules not loaded: rollout
   flag (tengu_plugin_hooks_modules) is off`. Set the flag; Claude Code must
   be 2.1.259+.

A `ready on the built-in classifier, no key set` line when you did set a key
means the key sits under the wrong `pluginConfigs` entry: the key must match
the plugin's id, which depends on how it was loaded (see Options).

## Effort ceiling, planning and chat commands

The router sends no more than `maxEffort` (default `high`). Plan mode, OpenSpec commands and skills (`propose`, `explore`, `new`, `continue`, `ff`, `update`, `verify`), prompts that start with "plan", and the subagents they start are lifted to `planningEffort` (default `xhigh`).

`xhigh` costs many tokens. To stop it, use one of these in the mod's options:

| Option | Value | Result |
|---|---|---|
| `planningEffort` | `high`, `medium` or `low` | Planning always runs at that effort. |
| `planningEffort` | `off` | Planning is not lifted. It follows the router and the `maxEffort` ceiling like other work. Planning subagents also follow the router. |
| `maxEffort` | `low`, `medium`, `high` or `xhigh` | The ceiling for all other work. |
| `enabled` | `false` | The router is paused. The session's own model and effort go through unchanged. |

### Commands for one chat

A chat can override the options. A command name has no spaces, so each choice is its own command with dashes. The choice is saved per session and survives a resume.

| Command | Effect |
|---|---|
| `/router-off` | Pause the router for this chat. No classification, no subagent routing. The footer still shows what is sent. |
| `/router-on` | Resume the router. This also overrides `enabled: false`. |
| `/router-maxEffort-low` | Set the ceiling of this chat to `low`. |
| `/router-maxEffort-medium` | Set the ceiling of this chat to `medium`. |
| `/router-maxEffort-high` | Set the ceiling of this chat to `high`. |
| `/router-maxEffort-xhigh` | Set the ceiling of this chat to `xhigh`. |
| `/router-planning-effort-off` | Do not lift planning in this chat. |
| `/router-planning-effort-low` | Plan at `low` in this chat. |
| `/router-planning-effort-medium` | Plan at `medium` in this chat. |
| `/router-planning-effort-high` | Plan at `high` in this chat. |
| `/router-planning-effort-xhigh` | Plan at `xhigh` in this chat. |

The router still routes up and down. `/router-maxEffort-<level>` only changes the highest effort it may send outside planning. `/router-planning-effort-<level>` only changes the effort of planning work. The two do not affect each other.

The old `/xhigh` and `/xhigh-off` commands are removed. Use `/router-maxEffort-xhigh` and `/router-planning-effort-xhigh`.

Order of precedence for the main loop, highest first: `/router-off` (nothing changes), the planning effort (for planning turns), the chat ceiling, then `maxEffort`. In each pair, the chat command wins over the option.

## Privacy

With a key set, the prompt text leaves the machine and goes to whichever backend the key belongs to. The main-loop path sends the prompt; the subagent path sends the subagent's prompt, its description and its agent type. Nothing else. With no key set, nothing leaves the machine.

## Options

Set them in `/config` or in `pluginConfigs` (see below). An option you leave out uses its default.

**Backend**

| Option | Default | What it does |
|---|---|---|
| `provider` | `auto` | `auto` picks TypeSafe, then the Gateway, then the built-in classifier. Or force `typesafe`, `gateway` or `builtin`. |
| `typesafeApiKey` | empty | Key for TypeSafe's API. Preferred, because only it reports a calibrated confidence. |
| `gatewayApiKey` | empty | Key for the Vercel AI Gateway. |
| `typesafeBaseUrl`, `typesafeModel` | empty | Override the TypeSafe URL (`https://api.typesafe.ai`) and model (`jev-latest`). |
| `gatewayBaseUrl`, `gatewayModel` | empty | Override the Gateway URL and model (`typesafe-ai/jev`). |
| `timeoutMs` | `800` | Wait this long for a decision. After that the request goes through unchanged. |

**Models and confidence**

| Option | Default | What it does |
|---|---|---|
| `fastModel`, `balancedModel`, `deepModel` | `haiku`, `sonnet`, `opus` | The model for each tier. Alias or full id. |
| `disabledModels` | empty | Comma-separated models the router never picks, at any effort. `haiku` also matches full ids. A disabled tier falls to the nearest more capable enabled tier, then to a cheaper one. Empty disables nothing. |
| `minUpgradeConfidence` | `0.3` | How sure Jev must be to spend more. Low, because a wrong upgrade only costs money. |
| `minDowngradeConfidence` | `0.6` | How sure Jev must be to spend less. High, because a wrong downgrade gives a task too little. |

**What the router changes**

| Option | Default | What it does |
|---|---|---|
| `enabled` | `true` | Master switch. Off: every request goes out as Claude Code built it. `/router-off` and `/router-on` override it per chat. |
| `routeMainEffort` | `true` | Change the effort of the main chat. |
| `routeMainModel` | `false` | Change the model of the main chat. Off, because a model switch invalidates the prompt cache. |
| `routeSubagentModel` | `true` | Pick the model of each subagent when it starts. |
| `routeSubagentEffort` | `true` | Change the effort of each subagent. |

**Effort limits**

| Option | Default | What it does |
|---|---|---|
| `maxEffort` | `high` | The highest effort sent outside planning. `low`, `medium`, `high` or `xhigh`. |
| `planningEffort` | `xhigh` | The effort for plan mode, OpenSpec and planning subagents. `off` leaves planning unlifted. |

**Delegation**

| Option | Default | What it does |
|---|---|---|
| `suggestDelegation` | `false` | When Jev rates a task for a cheaper model, tell the main chat to hand it to a subagent. The main chat may decline. |
| `minDelegationConfidence` | `0.6` | How sure Jev must be before that note is added. |

**Display and logs**

| Option | Default | What it does |
|---|---|---|
| `logDecisions` | `true` | Write each decision to the session log. |
| `showStatus` | `false` | Show Jev's last decision on the status line, for example `jev · balanced 0.88 · unchanged`. The `⤷` in the footer already marks a change, so this is only for debugging. |

The three tiers take an alias (`haiku`, `sonnet`, `opus`) or a full model id.
A subagent is spawned with the name as given, the way the Agent tool takes it;
the main loop's request needs an id, so there an alias is resolved to the
family's current id (`haiku` → `claude-haiku-4-5-20251001`, `sonnet` →
`claude-sonnet-5`, `opus` → `claude-opus-5`). Set a full id to pin a
specific version. A decision for the tier the session already runs is not a
change, so a session on `claude-opus-5[1m]` keeps its 1M-context id.

Declared in `.claude-plugin/plugin.json` (`userConfig`). Set them in `/config`, in user settings (`~/.claude/settings.json`, not project settings), with `--settings <file>` or in managed settings:

```json
{ "pluginConfigs": { "jev-model-router@skills-dir": { "options": { "typesafeApiKey": "" } } } }
```

The entry's key is the plugin's id, and the id follows how the plugin was
loaded: `"jev-model-router@skills-dir"` when auto-loaded from `.claude/skills/`
(the `--mod` install), `"jev-model-router"` with `--plugin-dir`. Under the
wrong key every option stays at its default, and the `ready on` line reports
`no key set`.

## Install

```sh
npx claude-code-templates@latest --mod productivity/jev-model-router
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude
```

`--mod` writes the plugin to `.claude/skills/jev-model-router/` in the project,
and Claude Code auto-loads it as `jev-model-router@skills-dir` **in a trusted
project**: a folder's `.claude/` is repository content and is not read until
you accept the trust prompt on the first interactive `claude` there (`-p`
never asks, so a headless run in a fresh folder never sees it). The options
then go under the `"jev-model-router@skills-dir"` key in `pluginConfigs` (see
Options).

For one session with hot reload, or in a folder you do not want to trust,
name it on the command line instead — it loads as `jev-model-router@inline`
and reads options from the `"jev-model-router"` key:

```sh
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir .claude/skills/jev-model-router
```

Either way, `claude plugin validate .claude/skills/jev-model-router` prints
every event it hooks and every `$` call it makes.

## Tests

```sh
bun test cli-tool/components/mods/productivity/jev-model-router/tests
```

**Early access.** Mods need Claude Code 2.1.259+ with `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`; the `$` API may change between releases. Typed against Anthropic's declarations: https://github.com/anthropics/claude-code/tree/main/mods

A mod runs without `node_modules`, so neither `@typesafe-ai/sdk` nor the AI SDK is available here: both backends are spoken to over HTTP through `$.http.fetch`. The TypeSafe wire shape was read from `@typesafe-ai/sdk` v0.6.0; the Gateway's, which is `experimental` in the AI SDK (`experimental_evaluate`, 7.0.105+) and not documented publicly, from `@ai-sdk/gateway` v4.0.86 and `@ai-sdk/provider` v4.0.17. Either may change.
