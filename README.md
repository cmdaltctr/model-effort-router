# model-effort-router

A Claude Code mod that picks the reasoning effort and the model for each task, and shows what was sent in the prompt footer.

The mod asks [Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev), TypeSafe's System One decision model, to rate each prompt. It then sets:

- the reasoning effort of the main conversation
- the model and the effort of each subagent, when the subagent starts

The footer shows the model and the effort of each request, for example `Opus 5.5 / low`.

## Contents

- [Agent instructions](#agent-instructions)
- [Features](#features)
- [Requirements](#requirements)
- [Install](#install)
- [Set up a backend](#set-up-a-backend)
- [How it works](#how-it-works)
- [Delegation to cheaper subagents](#delegation-to-cheaper-subagents)
- [Fable in the main chat](#fable-in-the-main-chat)
- [Naming a model or effort](#naming-a-model-or-effort)
- [Effort ceiling and planning](#effort-ceiling-and-planning)
- [Commands for one chat](#commands-for-one-chat)
- [Options](#options)
- [What you see in the transcript](#what-you-see-in-the-transcript)
- [Troubleshooting](#troubleshooting)
- [Privacy](#privacy)
- [Development](#development)
- [Credits and licence](#credits-and-licence)

<a id="agent-instructions"></a>

<details>
<summary><strong>Agent instructions: let a coding agent install the mod</strong></summary>

Paste this prompt into Claude Code or another coding agent. The agent installs the mod and turns on auto-update. It then asks you to add your TypeSafe key with `/plugin configure`, and stops before it restarts anything.

```text
Install the Claude Code mod "model-effort-router" from the marketplace at
https://github.com/cmdaltctr/model-effort-router. Do these steps in order:

1. Run `claude --version`. If it is older than 2.1.292, stop and tell me.
2. Run `claude plugin list`. If model-effort-router@inline is listed, or
   ~/.claude/settings.json has the folder in CLAUDE_CODE_PLUGIN_DIRS, stop and tell me.
   A folder copy replaces the marketplace copy.
3. Run:
   claude plugin install model-effort-router --marketplace cmdaltctr/model-effort-router
4. Run `claude plugin list` and show me that model-effort-router@model-effort-router is installed.
5. Turn on auto-update. Claude Code keeps it off for marketplaces that Anthropic does not run.
   a. Copy ~/.claude/settings.json to ~/.claude/settings.json.bak.
   b. In ~/.claude/settings.json, find "extraKnownMarketplaces" -> "model-effort-router".
      The install in step 3 wrote this entry. Add "autoUpdate": true to it, next to "source":
      "model-effort-router": {
        "source": { "source": "github", "repo": "cmdaltctr/model-effort-router" },
        "autoUpdate": true
      }
   c. Change nothing else in the file. Check that the file is valid JSON.
6. Ask me to add my TypeSafe key. Stop and show me exactly this:
     Type this command in the Claude Code prompt and press Enter:
     /plugin configure model-effort-router@model-effort-router
     Paste your TypeSafe key into the "TypeSafe API key" field and save.
     Reply "done" when you have saved it, or "skip" to run without a key.
   Wait for my reply. Do not ask me to paste the key into this chat.
   Do not run the command for me, and do not write the key into any file.
   If I reply "skip", tell me the mod uses Claude Code's built-in classifier,
   which only raises effort and never lowers it.
7. Tell me to restart Claude Code.
```

After the restart, run `claude --debug` and look for `hooks module model-effort-router@model-effort-router loaded`. See [Troubleshooting](#troubleshooting) if the line is missing.

</details>

## Features

- **Main conversation: effort only.** The mod does not change the main model by default. A model switch invalidates the prompt cache.
- **Subagents: model and effort.** The mod sets them once, when the subagent starts. A subagent starts with an empty context, so a model choice loses no cache.
- **Forks are left alone.** A fork shares its parent's cached context, so it keeps the parent's model and effort.
- **No subagent runs on Fable or Mythos.** These models run the main chat only. See [Fable in the main chat](#fable-in-the-main-chat).
- **Your choice wins.** A model the main chat names for a subagent, or an effort written in its brief, is kept.
- **Both directions.** A mechanical task can go to a cheaper model or a lower effort. A hard or risky task can go up.
- **Footer label.** The footer shows the model and effort sent on each main-loop request. A `⤷` before the label means the router changed it from the session's setting.
- **Subagent label.** When you open a subagent from the tasks list, the band above the prompt shows its own model and effort, for example `⤷ Haiku 5.5 / high`. A line that another mod draws in the band (for example worktree-tracker) stays, below this label.
- **Delegation hint.** Optional. When a task is cheap, the mod tells the main chat to hand it to a subagent on a cheaper model.
- **Never blocks a turn.** If the backend fails or is slow, the request goes out unchanged.

## Requirements

- Claude Code 2.1.292 or later for the one-step install below. Claude Code 2.1.287 and later run mods with no extra setting.
- Optional: a TypeSafe API key or a Vercel AI Gateway key. Without a key, the mod uses Claude Code's built-in classifier.

## Install

This repository is also a plugin marketplace. Install from it, and Claude Code can update the mod for you.

To let a coding agent do these steps, use the [agent instructions](#agent-instructions) at the top of this page.

1. Install the mod from your shell:

   ```sh
   claude plugin install model-effort-router --marketplace cmdaltctr/model-effort-router
   ```

   Inside a Claude Code session, you can use `/plugin install model-effort-router --marketplace cmdaltctr/model-effort-router` instead. Then choose a scope.

2. Turn on auto-update. Auto-update is off by default for marketplaces that Anthropic does not run.
   1. Run `/plugin`.
   2. Open the **Marketplaces** tab.
   3. Select `model-effort-router`.
   4. Select **Enable auto-update**.

   Or add `"autoUpdate": true` to the `model-effort-router` entry under `extraKnownMarketplaces` in `~/.claude/settings.json`. The install writes that entry.
3. Add your TypeSafe key. Inside a Claude Code session, run:

   ```text
   /plugin configure model-effort-router@model-effort-router
   ```

   Paste your key into the **TypeSafe API key** field and save. Claude Code keeps the key in the system keychain, not in `settings.json`. Skip this step to use the built-in classifier (see [Set up a backend](#set-up-a-backend)).
4. Restart Claude Code.

The mod has the id `model-effort-router@model-effort-router`. Its options go under that key in `pluginConfigs` (see [Options](#options)).

### Updates

Claude Code checks for a new version during an interactive session, up to ten minutes after your first message. When it finds one, it shows `Plugin updated: model-effort-router · Run /reload-plugins to apply`. Run `/reload-plugins`, or restart Claude Code.

To update now:

```sh
claude plugin update model-effort-router@model-effort-router
```

Claude Code compares the `version` in `.claude-plugin/plugin.json`. A push with no version change does not reach installed copies.

### Uninstall

```sh
claude plugin uninstall model-effort-router@model-effort-router
claude plugin marketplace remove model-effort-router
```

Removing the marketplace also deletes the saved options and keys of the mod.

### Install from a folder (development)

Use this method to change the code. The mod then has the id `model-effort-router@inline`, and it does not update by itself.

1. Clone the repository:

   ```sh
   git clone https://github.com/cmdaltctr/model-effort-router.git ~/.claude/mods/model-effort-router
   ```

2. Add the folder to `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`. Separate several folders with `:` on macOS and Linux.

   ```json
   {
     "env": {
       "CLAUDE_CODE_PLUGIN_DIRS": "~/.claude/mods/model-effort-router"
     }
   }
   ```

3. Restart Claude Code.

A folder copy replaces a marketplace copy with the same name. Do not use both methods on one machine. To try the mod for one session only, run `claude --plugin-dir ~/.claude/mods/model-effort-router`. On Claude Code older than 2.1.287, also set `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`.

## Set up a backend

The mod can use two backends. It picks the one whose key is set.

| Backend | Endpoint | Model | Confidence |
|---|---|---|---|
| `typesafe` | `POST api.typesafe.ai/v1/systemone` | `jev-latest` | Reported per answer |
| `gateway` | `POST ai-gateway.vercel.sh/v4/ai/evaluation-model` | `typesafe-ai/jev` | Derived from an optional distribution |

TypeSafe's own API wins when both keys are set, because only it reports a calibrated confidence. Set `provider` to force one backend, or to `builtin` to use neither. If you force a backend and its key is missing, the mod uses the built-in classifier and logs this once.

To add a key, run this inside a Claude Code session, then paste the key into the **TypeSafe API key** (or **Vercel AI Gateway API key**) field:

```text
/plugin configure model-effort-router@model-effort-router
```

From a shell, send the key as JSON on standard input instead. This keeps the key out of your shell history:

```sh
claude plugin configure model-effort-router@model-effort-router --values-stdin
```

Then type `{"typesafeApiKey": "<your key>"}` and press Ctrl-D.

Both ways store the key in the system keychain, not in `settings.json`. For a folder install, use the id `model-effort-router@inline`.

With no key set, the mod uses Claude Code's built-in classifier (`$.model.classify`). That classifier reports no confidence, so the mod only moves requests up, never down.

## How it works

1. **`prompt.submit`.** The mod sends your prompt to the backend before the turn starts.
2. **The backend answers three questions:**
   - `tier`: a choice between three descriptions of the work (mechanical, ordinary engineering, hard or high-stakes). The decision model never sees a model name.
   - `effort`: a score on a four-level rubric for how much step-by-step reasoning the task needs.
   - `risky`: whether the task touches production, money, credentials or state that cannot be undone.
3. **`turn.step`.** The mod applies the decision to the turn's first model request and keeps it for the rest of that turn.
4. **`agent.spawn`.** The mod rates each subagent's prompt and sets its model. It keeps the decision under the subagent's `agentId` and applies the effort at each of the subagent's requests. The Agent tool has no effort parameter.

### Confidence bars

A wrong upgrade and a wrong downgrade do not cost the same, so they have different bars:

- **Spend more** (bigger model, more reasoning): needs `minUpgradeConfidence`, default 0.3. A wrong upgrade only costs money.
- **Spend less**: needs `minDowngradeConfidence`, default 0.8. A wrong downgrade gives a task too little.
- **Risky above 0.7**: the task gets the deep tier and real reasoning, whatever the confidence.
- **No confidence reported** (built-in classifier, or the Gateway without a distribution): the mod only moves requests up.
- **Unknown model id or numeric effort**: the model gets the upgrade bar, and a numeric effort is left alone.

Any failure (a non-2xx response, a timeout, a malformed body, a thrown error) leaves the request as Claude Code built it.

A slash command with nothing after it, such as `/simplify`, is not rated. The decision model would see only the command's name. With text after the name, the prompt is rated like any other.

### Routing switches

| Switch | What it sets | Default |
|---|---|---|
| `routeSubagentModel` | The model of each subagent, at `agent.spawn` | On |
| `routeSubagentEffort` | The effort of each subagent, at its own `turn.step` | On |
| `routeMainEffort` | The effort of the main conversation, at `turn.step` | On |
| `routeMainModel` | The model of the main conversation, at `turn.step` | **Off** |

Keep `routeMainModel` off unless you have measured your own sessions. On a long context, re-caching after a model switch can cost more than the cheaper model saves.

### Model aliases

Each tier takes an alias (`haiku`, `sonnet`, `opus`) or a full model id. A subagent gets the name as given. The main loop needs an id, so the mod resolves an alias to a fixed id in `hooks/policy.ts`. Set a full id to pin a version. A decision for the tier the session already runs is not a change, so a session on a `[1m]` model keeps its 1M-context id.

## Delegation to cheaper subagents

This is on by default. Set `suggestDelegation` to `false` to turn it off.

1. Jev rates your prompt for a cheaper tier than the main chat, at `minDelegationConfidence` or higher, and not risky.
2. The mod adds a hidden note to the prompt. The note tells the main chat to start a subagent with the Agent tool and to write its brief.
3. The main chat writes the brief with the context the task needs. The main chat may decline for a reply to the current conversation, such as "yes" or an edit to work in progress.
4. At `agent.spawn`, the subagent uses the surer of two ratings: the prompt's and the brief's. It may move to a cheaper model at `minDelegationConfidence` instead of `minDowngradeConfidence`.
5. The subagent's answer comes back to the main chat as tool output. The main chat uses it and answers you.

The note is never added to background task notices, plugin prompts, scheduled prompts, messages from other sessions, slash commands, attachments or messages sent during a running turn.

## Fable in the main chat

Fable and Mythos rank one step above Opus. They run the main chat only. Before each subagent starts, the mod checks the model it would run on. If that model is Fable or Mythos, the mod changes it:

| Case | Subagent model | Subagent effort |
|---|---|---|
| Jev answered, at any confidence | Jev's tier (deep when risky) | From Jev |
| Jev gave no answer (timeout or failure) | Sonnet (the balanced tier) | High |
| `/router-off` | Sonnet (the balanced tier) | As Claude Code set it |
| The main chat named Fable | Jev's tier, or Sonnet with no answer | From Jev |

Forks are not changed. On a Fable main chat, the delegation note fires for every tier. A hard task suggests an Opus subagent. A risky task gets no note. See `docs/adr/007-fable-off-limits-for-subagents-named-choices-win.md`.

## Naming a model or effort

- **Model.** When the main chat passes a model to the Agent tool (`model: "opus"`), the mod keeps it. Jev does not move it. `model: inherit` counts as no model. Fable is still changed.
- **Effort.** The Agent tool has no effort field. Write the effort in the brief as `effort: high` or `xhigh effort`. The mod uses it in place of Jev's effort, also above `maxEffort`. This works only while the router is on.

## Effort ceiling and planning

The mod sends no more than `maxEffort` (default `high`).

These are lifted to `planningEffort` (default `high`):

- plan mode
- OpenSpec commands and skills (`propose`, `explore`, `new`, `continue`, `ff`, `update`, `verify`)
- prompts that start with "plan"
- the subagents they start

To change the planning effort or the ceiling, set one of these options. `xhigh` gives deeper planning but uses many tokens.

| Option | Value | Result |
|---|---|---|
| `planningEffort` | `xhigh`, `high`, `medium` or `low` | Planning always runs at that effort. |
| `planningEffort` | `off` | Planning is not lifted. It follows the router and `maxEffort` like other work. |
| `maxEffort` | `low`, `medium`, `high` or `xhigh` | The ceiling for all other work. |
| `enabled` | `false` | The router is paused. Requests go out unchanged. |

## Commands for one chat

A chat can override the options. The choice is saved per session and survives a resume.

| Command | Effect |
|---|---|
| `/router-off` | Pause the router for this chat. The footer still shows what is sent. |
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

The two command groups do not affect each other. `/router-maxEffort-<level>` changes the ceiling outside planning. `/router-planning-effort-<level>` changes only the effort of planning work.

Order of precedence for the main loop, highest first:

1. `/router-off` (nothing changes)
2. The planning effort, for planning turns
3. The chat ceiling
4. `maxEffort`

In each pair, the chat command wins over the option.

## Options

### Defaults changed in 0.2.3

Version 0.2.3 changed four defaults. An option you set yourself keeps your value.

| Option | Default from 0.2.3 | Default before 0.2.3 | What the new default does | To get the old behaviour |
|---|---|---|---|---|
| `disabledModels` | `haiku` | empty | No subagent runs on Haiku. A fast task goes to Sonnet. | Set `disabledModels` to `""`. |
| `minDowngradeConfidence` | `0.8` | `0.6` | Jev must be 80% sure before the router spends less. Fewer wrong downgrades. | Set `minDowngradeConfidence` to `0.6`. |
| `planningEffort` | `high` | `xhigh` | Planning runs at `high`. Uses fewer tokens. | Set `planningEffort` to `xhigh`. |
| `suggestDelegation` | `true` | `false` | The main chat gets a note to hand cheap tasks to a subagent. | Set `suggestDelegation` to `false`. |

All other defaults are unchanged. The tables below list every option.

### Set an option

Set options in `/config`, or in `pluginConfigs` in your user settings (`~/.claude/settings.json`). Project settings are not read for plugin options. An option you leave out uses its default.

```json
{
  "pluginConfigs": {
    "model-effort-router@model-effort-router": {
      "options": { "provider": "typesafe", "suggestDelegation": true }
    }
  }
}
```

For a folder install, the key is `model-effort-router@inline`.

The key must match the plugin's id. Under the wrong key, every option stays at its default and the `ready on` log line says `no key set`.

**Backend**

| Option | Default | What it does |
|---|---|---|
| `provider` | `auto` | `auto` picks TypeSafe, then the Gateway, then the built-in classifier. Or force `typesafe`, `gateway` or `builtin`. |
| `typesafeApiKey` | empty | Key for TypeSafe's API. |
| `gatewayApiKey` | empty | Key for the Vercel AI Gateway. |
| `typesafeBaseUrl`, `typesafeModel` | empty | Override the TypeSafe URL (`https://api.typesafe.ai`) and model (`jev-latest`). |
| `gatewayBaseUrl`, `gatewayModel` | empty | Override the Gateway URL and model (`typesafe-ai/jev`). |
| `timeoutMs` | `800` | How long to wait for a decision. After that, the request goes out unchanged. |

**Models and confidence**

| Option | Default | What it does |
|---|---|---|
| `fastModel`, `balancedModel`, `deepModel` | `haiku`, `sonnet`, `opus` | The model for each tier. Alias or full id. |
| `disabledModels` | `haiku` | Comma-separated models the router never picks. `haiku` also matches full ids. A disabled tier falls to the nearest more capable enabled tier, then to a cheaper one. Set an empty value (`""`) to allow every model. |
| `minUpgradeConfidence` | `0.3` | How sure Jev must be to spend more. |
| `minDowngradeConfidence` | `0.8` | How sure Jev must be to spend less. |

**What the router changes**

| Option | Default | What it does |
|---|---|---|
| `enabled` | `true` | Master switch. `/router-off` and `/router-on` override it per chat. |
| `routeMainEffort` | `true` | Change the effort of the main chat. |
| `routeMainModel` | `false` | Change the model of the main chat. |
| `routeSubagentModel` | `true` | Pick the model of each subagent when it starts. |
| `routeSubagentEffort` | `true` | Change the effort of each subagent. |

**Effort limits**

| Option | Default | What it does |
|---|---|---|
| `maxEffort` | `high` | The highest effort sent outside planning. |
| `planningEffort` | `high` | The effort for planning work. `off` leaves planning unlifted. |

**Delegation**

| Option | Default | What it does |
|---|---|---|
| `suggestDelegation` | `true` | Tell the main chat to hand cheap tasks to a subagent. |
| `minDelegationConfidence` | `0.6` | How sure Jev must be before the note is added. |

**Display and logs**

| Option | Default | What it does |
|---|---|---|
| `logDecisions` | `true` | Write each decision to the session log. |
| `showStatus` | `false` | Show Jev's last decision on the status line, for example `jev · balanced 0.88 · unchanged`. Use it for debugging. The footer's `⤷` already marks a change. |

## What you see in the transcript

With `logDecisions` on, the mod logs each step. Claude Code shows nothing else about it: the mod changes parameters of each request, so the session's own model and effort settings never move.

```
[model-effort-router] ready on typesafe (https://api.typesafe.ai/v1/systemone); routing subagent model, main effort
[model-effort-router] jev: tier fast (0.87) · effort 0.4 → low (0.71) · risky 0.02 · 249ms
[model-effort-router] main loop → effort low: fast (confidence 0.87)
[model-effort-router] jev: tier fast (0.41) · effort 0.4 → low (0.38) · risky 0.01 · 210ms
[model-effort-router] main loop: kept opus/medium, wanted haiku/low (confidence 0.41)
```

- The `ready on` line appears once per session. It shows that the module loaded and which backend answers.
- A `jev:` line is the decision model's reply, before the policy is applied.
- The line under it is what the policy did. The last pair shows the router declining: it wanted to spend less, but the confidence was below `minDowngradeConfidence`.
- `confidence n/d` means the backend reported no confidence.

## Troubleshooting

**No log lines at all.** Check these causes in this order:

1. **You ran `claude -p` or the SDK.** A headless run has no transcript. The lines go to the debug log, `~/.claude/debug/<session-id>.txt` (`latest` links to the newest). An SDK host receives each line as `ui_log`.
2. **The mod did not load.** Run `claude --debug`. A loaded module prints `hooks module model-effort-router@model-effort-router loaded (…); events: …`. Run `claude plugin list` to check that the mod is installed and enabled. For a folder install, check `CLAUDE_CODE_PLUGIN_DIRS`. Then restart Claude Code.
3. **Function hooks are off.** The debug log says `installed plugins' hooks modules not loaded: rollout flag (tengu_plugin_hooks_modules) is off`. Update Claude Code to 2.1.287 or later, or set `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`.

**`ready on the built-in classifier, no key set` when you set a key.** The key is under the wrong `pluginConfigs` entry. Use `model-effort-router@model-effort-router`, or `model-effort-router@inline` for a folder install.

**The footer shows the parent's label while you view a subagent.** This is expected. Claude Code does not tell the footer which transcript is on screen. The band above the prompt shows the subagent's label.

## Privacy

With a key set, prompt text goes to the backend that the key belongs to:

- the main loop sends the prompt
- the subagent path sends the subagent's prompt, its description and its agent type

Nothing else is sent. With no key set, nothing leaves the machine.

## Development

### Layout

| File | Purpose |
|---|---|
| `hooks/register.tsx` | The hooks module. Loads the router and draws the footer and the subagent band. |
| `hooks/router.ts` | The hooks: `prompt.submit`, `turn.step`, `agent.spawn` and the chat commands. |
| `hooks/policy.ts` | Pure decision rules: confidence bars, tiers, effort caps, the delegation note. |
| `hooks/chat.ts` | Per-chat command state. |
| `hooks/running.ts` | Footer state written on each main-loop request. |
| `.claude-plugin/plugin.json` | Manifest and option declarations (`userConfig`). |
| `types/index.d.ts` | Type declarations for the `$` API. |
| `docs/adr/` | Decision records: why the mod works the way it does. Start at `ADR_README.md`. |

A mod may load one hooks module and hook `turn.step` once. For this reason, `register.tsx` loads `router.ts`, and `router.ts` writes the footer state.

### Tests

```sh
claude plugin test .
claude plugin validate .
```

`validate` prints every event the mod hooks and every `$` call it makes.

### Notes

- To release a change to marketplace users, raise `version` in `.claude-plugin/plugin.json`, then push to `main`. Installed copies ignore a push with no version change.
- Mods are early access. The `$` API can change between Claude Code releases. The types follow Anthropic's declarations: https://github.com/anthropics/claude-code/tree/main/mods
- A mod runs without `node_modules`. The mod talks to both backends over HTTP through `$.http.fetch`. The TypeSafe wire shape comes from `@typesafe-ai/sdk` v0.6.0. The Gateway's shape is experimental and undocumented; it comes from `@ai-sdk/gateway` v4.0.86 and `@ai-sdk/provider` v4.0.17. Either can change.

## Credits and licence

This mod merges two earlier mods (2026-10-29):

- `model-effort`, a local footer mod.
- [`jev-model-router`](https://github.com/davila7/claude-code-templates) 0.4.2 from claude-code-templates, by Daniel (San) Ávila, MIT licence.

Released under the MIT licence. See [LICENSE](LICENSE).
