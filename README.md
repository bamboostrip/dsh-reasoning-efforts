English | [简体中文](README-zh.md)

# dsh-reasoning-efforts

DSH plugin that **configures thinking levels (`reasoningEfforts`) for custom
models** added under the `llm-pi-ai` settings namespace, so you can edit them
from a Settings page instead of hand-editing `settings.yaml`.

> Pain point solved: when you add a custom provider / model in DSH's Models
> page, the `reasoningEfforts` map has to be filled in manually for every model.
> This plugin gives you a per-model editor with one-click level toggles, plus
> two assists: pre-filling levels the model catalog already knows, and endpoint
> detection that fills context / output capacities and lists models the
> provider advertises but you have not configured yet.

![示例截图](docs/images/reasoning.png)

## How it works

The client half is a Web Client settings page driving the official client wire
on `ctx.connection.api` (`settings.describe` / `llm.models` /
`llm.discoverModels` / `settings.mutate`), with UI copy localized through the
official locale service. Because the sanctioned `llm.discoverModels` channel
strips reasoning signals host-side (and a route named after a pi-ai catalog
provider answers from the catalog without touching the endpoint), the host
half registers one same-origin route — `GET
/thinking-levels/raw-models?route=<route>` — that returns the provider's
**raw** `/models` listing (stored credential resolved server-side, `/api`-style
browser trust fence). "Detect from endpoint" merges both, complementary:

- raw endpoint signal (`supported_features`, `supported_parameters`,
  `supports_reasoning`, …) decides reasoning yes/no (high confidence);
- the pi-ai catalog (`llm.models`) refines the offered level set and stands in
  when the endpoint said nothing (medium confidence);
- both silent → unknown; the user picks levels manually.

It targets the **real** DSH `llm-pi-ai` model schema: each `models[]` entry
accepts `reasoningEfforts` whose keys are pi-ai's levels
(`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`) and whose values
are the wire spellings sent to the provider. See
[`docs/integration.md`](docs/integration.md).

### Uninstall leaves no residue

The plugin only ever writes native `llm-pi-ai` fields you explicitly apply
(`reasoningEfforts`, plus detected `contextWindow` / `maxTokens` / `name`).
Those settings keep working after the plugin is gone — dsh itself consumes
them — and removing them (or models the plugin appended) is a plain
`settings.yaml` edit. The plugin never touches `cordis.yml` (its bundle row is
removed by `dsh plugin remove`) and stores nothing anywhere else.

## Build

```bash
pnpm install
pnpm build      # -> dist/index.js (ESM), dist/client.js (ModuleLoader factory)
pnpm typecheck  # optional
pnpm test       # builds + runs detection unit tests
```

## Install

**From npm (recommended):**

```bash
dsh plugin --profile web add dsh-reasoning-efforts
```

**From GitHub:**

```bash
dsh plugin --profile web add github:bamboostrip/dsh-reasoning-efforts
```

**From a local checkout** (development):

```bash
cd /path/to/dsh-reasoning-efforts   # the invoking directory anchors relative paths
dsh plugin --profile web add link:.
```

DSH plugins are managed with the `dsh plugin` command, which installs a package
into the target profile (via pnpm) and, if it declares `dsh.bundle`, mounts it
as a profile layer automatically. `dsh plugin` runs pnpm in the profile
directory (`$DSH_HOME/profiles/web`), then reconciles `dsh.profile.bundles` —
this package declares `dsh.bundle.patch: ./cordis.patch.yml`, so it joins the
layer stack and its `insert:` row mounts the plugin. **A DSH restart (or
reload) is required for the plugin to load.**

## Uninstall (no residue)

1. Remove the `dsh-reasoning-efforts` row from your composition / uninstall the
   package from Plugins settings.
2. Optionally remove `reasoningEfforts` lines you no longer want from the
   `llm-pi-ai` section of your `settings.yaml` (this plugin only writes what you
   explicitly apply — it never touches `cordis.yml` or other DSH files by
   itself).
3. Delete the built `dist/` / `node_modules/` from this directory if you no
   longer need them.

The plugin never modifies `cordis.yml` on its own and stores nothing outside the
`llm-pi-ai` settings you tell it to write, so removal leaves no residue.

## Layout

```
src/
  index.ts            Host: raw-models discovery route (same-origin, credential-resolved)
  client.tsx          Client: localized settings.section UI over the official wire
  shared/
    types.ts          Shared model / reasoningEfforts types
    detection.ts      Raw-listing detection + default-levels logic (pure, testable)
cordis.patch.yml      Mount row for DSH composition
package.json          Build + dsh host/client declaration
tsdown.config.ts      Bundle config (ESM node half + ModuleLoader-factory client half)
```
