# Integration notes

This plugin targets the **real** DSH `llm-pi-ai` model configuration. Before
reading the code, know the actual schema so the mental model matches the DSH
docs rather than the original PLAN.md (which assumed a bespoke namespace).

## The `llm-pi-ai` settings namespace

Each provider route in `llm-pi-ai` (`providers.<route>`) has a `models[]` list.
Every entry accepts these configurable fields:

| Field | Meaning |
| --- | --- |
| `id` | model id (required) |
| `name` | display name |
| `contextWindow` | context capacity |
| `maxTokens` | configured output cap (becomes request default) |
| `reasoningEfforts` | thinking-level offer: `{ level: wireSpelling, ... }` or `false` |
| `compat` | per-model wire-compat switches |

### `reasoningEfforts`

- Keys come from pi-ai's level set: `off`, `minimal`, `low`, `medium`, `high`,
  `xhigh`, `max`. Only declared levels are offered.
- Each value is the spelling sent on the wire; canonical names pass through,
  `max: ultra` renames it for a gateway with its own vocabulary.
- `off` is the one three-state key:
  - left out → no Off offered, an explicit Off request is refused;
  - `off:` (empty/`null`) → Off offered, selecting it sends nothing (pi-ai's
    own default for the deepseek dialect sends `thinking: {type: "disabled"}`);
  - `off: none` → that value goes on the wire.
- `false` declares a non-reasoning model (strips reasoning from a catalog model
  the gateway cannot serve). `{}` (empty) is refused by validation.

Example that this plugin writes for a reasoning model:

```yaml
models:
  - id: deepseek-v4-flash
    reasoningEfforts:
      off:
      low: low
      medium: medium
      high: high
```

## How detection maps to reasoningEfforts

| Endpoint signal | Plugin result |
| --- | --- |
| `supported_features` includes `"reasoning"` | reasoning = true → default `{off, low, medium, high}` |
| `supported_parameters` includes `"reasoning"` / `"include_reasoning"` | reasoning = true |
| `supports_reasoning` / `supportsReasoning` / `can_reason` / `reasoning` boolean | reasoning per flag |
| `reasoning_effort` present / `supports_reasoning_effort: true` | reasoning = true |
| bare `{id, object, owned_by}` (no signal) | reasoning = unknown → user picks from `low/medium/high` |
| `supports_reasoning: false` | reasoning = false → no efforts offered |

## Client wire contract

The plugin's client half drives everything through the official client wire on
`ctx.connection.api`:

- `settings.describe({})` → namespaces; the `llm-pi-ai` view carries `user`
  (the editable layer with `providers`), `value` (merged effective fallback)
  and `revision` (used as `expectedRevision` on writes).
- `llm.models({})` → catalog groups keyed by provider route; entries may carry
  `reasoning.efforts` (pi-ai's own knowledge of a model id) used to pre-fill
  levels.
- `llm.discoverModels({ settingsNs: 'llm-pi-ai', provider: route })` →
  host-side `GET {baseURL}/models` with the stored API key; returns
  `{ models: [{ id, name?, contextWindow?, maxTokens? }] }` — the fallback
  channel, capacities only (the host narrows the listing before the wire, and
  a route whose name matches a pi-ai catalog provider answers from the catalog
  without touching the endpoint at all).
- `settings.mutate({ ns, ops: [{ op: 'set', path: ['providers', route,
  'models'], value }], expectedRevision })` → writes the merged `models`
  array (array replaces wholesale) and returns the new redacted namespace view
  with a fresh `revision`.

## Host raw-discovery route

The sanctioned discovery channel strips reasoning signals host-side, so the
plugin's host half registers one same-origin web route that returns the
provider's **raw** `/models` listing:

```
GET /thinking-levels/raw-models?route=<llm-pi-ai route>
  → { ok: true, url, data: [<raw entries, reasoning signals intact>] }
  → { ok: false, error }
```

It reads the route's `baseURL`/`apiKeyEnv` from `llm-pi-ai` settings, resolves
the credential through the credentials service (unset key probes
unauthenticated), fetches server-side (no CORS, no key in the reply), and only
reaches routes already configured in the user's settings. A `/api`-style
browser trust fence (loopback Host / matching Origin / same-site
`Sec-Fetch-Site`; `cross-site` always rejected) guards it.

Detection combines both halves ("Detect from endpoint"):

- Raw endpoint signal (`supported_features` / `supported_parameters` /
  `supports_reasoning` / …) decides reasoning yes/no (high confidence).
- Catalog (`llm.models`) refines the offered level set when it knows the
  model, and stands in (medium confidence) when the endpoint said nothing.
- Both silent → unknown; the user picks levels manually.

## Client

Registers an additive `settings.section` entry (`id: 'thinking-levels'`,
`order: 11`, function `label` bound to the plugin's locale namespace), so it
appears beside the shipped Models page without replacing it. Copy is localized
through the official locale service (`ctx.locale.register` / `bind`). The
client bundle is a `window.__ModuleLoader__.load({ id, factory })` closure
artifact (the web shell serves it as a classic script); platform modules
(`react`, …) resolve through the loader's module table.

## Install / uninstall

See [`../README.md`](../README.md). The plugin is a real DSH **bundle**: it
declares `dsh.bundle.patch: ./cordis.patch.yml`, whose `insert:` row mounts
`dsh-reasoning-efforts` into the profile roster. Install with the official
`dsh plugin` command:

```bash
dsh plugin --profile web add link:<this repo path>   # local
# or
dsh plugin --profile web add dsh-reasoning-efforts      # published
```

`dsh plugin` runs pnpm in `$DSH_HOME/profiles/web` and auto-reconciles
`dsh.profile.bundles`, so a `dsh.bundle`-declaring package is mounted
automatically. Uninstall removes the row and the dependency:

```bash
dsh plugin --profile web remove dsh-reasoning-efforts
```

The plugin never edits `cordis.yml` or anything outside the `llm-pi-ai` settings
you explicitly apply, so removal leaves no residue.
