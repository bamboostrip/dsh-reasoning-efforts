/**
 * Client half of the DSH Thinking Levels plugin.
 *
 * Registers an additive `settings.section` page ("Thinking Levels"). The
 * plugin is client-only: profile plugins have no `harness`/`host` globals
 * (that RPC pair belongs to the dynamic-package sandbox), so every capability
 * flows through the official client wire on `ctx.connection.api`:
 *
 *   - `settings.describe`   read the `llm-pi-ai` namespace (providers + models)
 *   - `llm.models`          provider/model catalog with reasoning metadata
 *                           (pi-ai's own knowledge of a model id)
 *   - `llm.discoverModels`  host-side GET {baseURL}/models for one route
 *                           (credentials resolved host-side) — capacities only
 *   - `settings.mutate`     write reasoningEfforts back into settings.yaml
 *
 * Reasoning auto-detection from raw endpoint metadata (supported_features
 * etc.) is not reachable through the client wire: `llm.discoverModels`
 * narrows to id/name/contextWindow/maxTokens. The catalog (`llm.models`)
 * still pre-fills known levels, and everything else stays manual.
 *
 * Copy is localized through the official locale service (`ctx.locale`,
 * `@deepseek-ai/dsh-client-locale`): dictionaries register under this
 * plugin's namespace, the slot label resolves through a function so the
 * settings nav follows the UI language, and the section component receives
 * the bound translator as a slot prop.
 */

import * as React from 'react'
import type { ApiModelEntry, DetectionResult, ReasoningEfforts } from './shared/types.js'
import {
  DEFAULT_REASONING_EFFORTS,
  THINKING_LEVELS,
  defaultManualEfforts,
  detectModel,
} from './shared/detection.js'

/** Official RPC envelope shared by every `connection.api` method. */
type RpcError = { code: string; message: string; details?: unknown }
type RpcResponse<T> = { result: { ok: true; value: T } | { ok: false; error: RpcError } }

interface DiscoveredModel {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
}

interface CatalogReasoning {
  efforts: Array<{ id: string; name: string }>
  defaultEffort?: string
}

interface SettingsNamespaceView {
  ns: string
  value: unknown
  user?: unknown
  revision: number
}

interface CatalogValue {
  groups: Array<{ id: string; models: Array<{ id: string; reasoning?: CatalogReasoning }> }>
  failures: Array<{ id: string; message: string }>
}

/** Structural slice of the shared API client (types only — nothing imported at runtime). */
interface ApiClient {
  settings: {
    describe(req: {}): Promise<RpcResponse<{ writable: boolean; namespaces: SettingsNamespaceView[] }>>
    mutate(req: {
      ns: string
      ops: Array<{ op: 'set'; path: string[]; value: unknown }>
      expectedRevision?: number
    }): Promise<RpcResponse<SettingsNamespaceView>>
  }
  llm: {
    discoverModels(req: {
      settingsNs: string
      provider?: string
      baseURL?: string
      apiKey?: string
    }): Promise<RpcResponse<{ models: DiscoveredModel[] }>>
    models(req: {}): Promise<RpcResponse<CatalogValue>>
  }
}

/** Translator bound to this plugin's dictionary namespace. */
type Translator = (key: string) => string

/** Locale service face (`@deepseek-ai/dsh-client-locale`). */
interface LocaleService {
  register(ns: string, dictionaries: Record<string, Record<string, string>>): unknown
  bind(ns: string): Translator
}

/** Client context slice: the services this plugin injects. */
interface ClientContext {
  get(name: 'connection'): { api: ApiClient } | undefined
  get(name: 'locale'): LocaleService | undefined
  get(name: 'slots'):
    | {
        inject(key: string, cb: () => unknown): () => void
        register(
          def: {
            name: string
            id: string
            order?: number
            label?: string | (() => string)
            inject?: () => Record<string, unknown>
          },
          render: (props: Record<string, unknown>) => React.ReactElement,
        ): () => void
      }
    | undefined
  effect(setup: () => () => void, label?: string): () => void
}

const NS = 'llm-pi-ai'
/** This plugin's locale dictionary namespace. */
const LOCALE_NS = 'thinking-levels'

/** Simplified Chinese dictionary (source of truth for the key set). */
const zh: Record<string, string> = {
  'nav': '思考级别',
  'title': '思考级别',
  'intro':
    '为每个自定义模型配置可用的思考档位（reasoningEfforts）。模型目录已知的档位可一键预填；端点检测会填充上下文/输出容量，并列出服务商已提供但尚未配置的模型。保存将写入 llm-pi-ai 设置（providers.<route>.models）。',
  'prefill': '从目录预填',
  'detect': '从端点检测',
  'apply': '应用到设置',
  'working': '处理中…',
  'saved': '已保存到 llm-pi-ai 设置（providers.{route}.models）。',
  'noProviders': '在 llm-pi-ai 设置中未找到自定义服务商。',
  'wireUnavailable': '设置通道不可用。',
  'offerLevels': '提供思考档位',
  'badgeReasoning': '思考 ✓',
  'badgeOff': '思考关闭',
  'badgeUnknown': '未知',
  'badgeNotConfigured': '未配置',
  'capCtx': '上下文 {n}K',
  'capOut': '输出 {n}K',
  'noteMissing': '模型未出现在端点列表中（请检查 API key，或该服务商不提供可用的 /models 列表）',
  'noteNew': '端点已提供该模型但尚未配置；应用后会将其加入设置',
  'srcEndpoint': '端点',
  'srcCatalog': '目录',
  'rawFallbackNote': '原始 /models 读取失败（{detail}），已回退官方发现通道（仅容量，不含推理信号）',
  'errNotLoaded': 'llm-pi-ai 设置尚未加载',
  'errNoCatalog': '模型目录没有该服务商的思考档位信息，请手动设置。',
  'errNothingToApply': '没有可应用的内容：请先为至少一个模型启用思考档位。',
}

/** English dictionary, key-aligned with zh. */
const en: Record<string, string> = {
  'nav': 'Thinking Levels',
  'title': 'Thinking Levels',
  'intro':
    'Configure which thinking levels (reasoningEfforts) each custom model offers. Levels the model catalog already knows can be pre-filled; endpoint detection fills context/output capacities and lists models the provider advertises but settings do not configure yet. Saving writes to llm-pi-ai settings (providers.<route>.models).',
  'prefill': 'Pre-fill from catalog',
  'detect': 'Detect from endpoint',
  'apply': 'Apply to settings',
  'working': 'Working…',
  'saved': 'Saved to llm-pi-ai settings (providers.{route}.models).',
  'noProviders': 'No providers found in llm-pi-ai settings.',
  'wireUnavailable': 'Settings wire unavailable.',
  'offerLevels': 'Offer thinking levels',
  'badgeReasoning': 'reasoning ✓',
  'badgeOff': 'reasoning off',
  'badgeUnknown': 'unknown',
  'badgeNotConfigured': 'not configured',
  'capCtx': 'ctx {n}K',
  'capOut': 'out {n}K',
  'noteMissing':
    'model not present in the endpoint listing (check the API key, or the provider exposes no usable /models listing)',
  'noteNew': 'advertised by the endpoint but not configured yet; applying will add it',
  'srcEndpoint': 'endpoint',
  'srcCatalog': 'catalog',
  'rawFallbackNote':
    'raw /models read failed ({detail}); fell back to the official discovery channel (capacities only, no reasoning signals)',
  'errNotLoaded': 'llm-pi-ai settings not loaded yet',
  'errNoCatalog': 'The model catalog reports no reasoning knowledge for this provider; set levels manually.',
  'errNothingToApply': 'Nothing to apply: enable thinking levels on at least one model first.',
}

/** Fallback translator for the (inject-guaranteed-unlikely) missing locale service. */
const fallbackT: Translator = (key) => en[key] ?? key

/** Substitute `{name}` placeholders in a translated string. */
function fmt(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  )
}

interface ProviderView {
  route: string
  displayName: string
  baseURL?: string
  apiKeyEnv?: string
  api?: string
  /** Raw profile record, used as the merge base when applying edits. */
  raw: Record<string, unknown>
  models: Array<Record<string, unknown>>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cloneJson(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(cloneJson)
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>)) {
    out[key] = cloneJson((value as Record<string, unknown>)[key])
  }
  return out
}

/** Unwrap an RPC response or throw its error message. */
function unwrap<T>(response: RpcResponse<T>): T {
  if (!response || !response.result) throw new Error('empty RPC response')
  if (response.result.ok !== true) throw new Error(response.result.error?.message ?? 'RPC failed')
  return response.result.value
}

/** Read one provider view out of the llm-pi-ai namespace view. */
function providersOf(view: SettingsNamespaceView): ProviderView[] {
  const section = isRecord(view.user) ? view.user : isRecord(view.value) ? view.value : {}
  const providers = isRecord(section.providers) ? section.providers : {}
  const out: ProviderView[] = []
  for (const route of Object.keys(providers)) {
    const profile = providers[route]
    if (!isRecord(profile)) continue
    out.push({
      route,
      displayName:
        typeof profile.displayName === 'string' && profile.displayName.length > 0
          ? profile.displayName
          : route,
      baseURL: typeof profile.baseURL === 'string' ? profile.baseURL : undefined,
      apiKeyEnv: typeof profile.apiKeyEnv === 'string' ? profile.apiKeyEnv : undefined,
      api: typeof profile.api === 'string' ? profile.api : undefined,
      raw: profile,
      models: Array.isArray(profile.models)
        ? profile.models.filter((m) => isRecord(m) && typeof (m as { id?: unknown }).id === 'string')
        : [],
    })
  }
  return out
}

/** Reasoning levels the llm catalog knows for one model, keyed by route then id. */
type KnownReasoning = Map<string, Map<string, { levels: string[]; defaultEffort?: string }>>

function knownReasoningOf(catalog: CatalogValue): KnownReasoning {
  const known: KnownReasoning = new Map()
  for (const group of catalog.groups ?? []) {
    const byId = new Map<string, { levels: string[]; defaultEffort?: string }>()
    for (const entry of group.models ?? []) {
      if (!entry?.reasoning) continue
      const levels = (entry.reasoning.efforts ?? [])
        .map((e) => e?.id)
        .filter((id): id is string => typeof id === 'string' && (THINKING_LEVELS as readonly string[]).includes(id))
      if (levels.length === 0) continue
      byId.set(entry.id, { levels, defaultEffort: entry.reasoning.defaultEffort })
    }
    if (byId.size > 0) known.set(group.id, byId)
  }
  return known
}

/** Same-origin host route registered by this plugin's host half (src/index.ts). */
const RAW_MODELS_PATH = '/thinking-levels/raw-models'

interface RawModelsReply {
  ok: boolean
  error?: string
  url?: string
  data?: ApiModelEntry[]
}

/**
 * Read the provider's raw /models listing through the plugin's host route,
 * which resolves the stored credential server-side. Returns the raw entries
 * (reasoning signals intact) or the failure detail.
 */
async function fetchRawModels(route: string): Promise<{ data?: ApiModelEntry[]; error?: string }> {
  try {
    const response = await fetch(`${RAW_MODELS_PATH}?route=${encodeURIComponent(route)}`)
    const body = (await response.json()) as RawModelsReply
    if (body && body.ok && Array.isArray(body.data)) return { data: body.data }
    return { error: body?.error ?? `HTTP ${response.status}` }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Complementary merge over one detectModel result: the endpoint's explicit
 * signal wins for yes/no; the catalog refines the offered level set, and
 * stands in when the endpoint said nothing.
 */
function mergeCatalogInto(
  det: DetectionResult,
  info: { levels: string[]; defaultEffort?: string } | undefined,
): DetectionResult {
  if (det.reasoning === true) {
    return {
      ...det,
      reasoningSource: 'endpoint',
      reasoningEfforts: info ? defaultManualEfforts(info.levels) : det.reasoningEfforts ?? DEFAULT_REASONING_EFFORTS,
    }
  }
  if (det.reasoning === 'unknown' && info) {
    return {
      ...det,
      reasoning: true,
      reasoningSource: 'llm catalog',
      reasoningEfforts: defaultManualEfforts(info.levels),
      confidence: 'medium',
    }
  }
  return det
}

const CSS = `
.tl-root{max-width:720px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:14px}
.tl-title{margin:0;font-size:16px;font-weight:500;line-height:24px}
.tl-intro{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
.tl-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.tl-select{height:34px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-field-fill);color:var(--dsw-alias-label-primary);font:inherit;padding:0 10px;min-width:220px}
.tl-btn{height:34px;border:none;border-radius:17px;padding:0 16px;font:inherit;font-size:13px;line-height:20px;cursor:pointer;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.tl-btn:disabled{opacity:.55;cursor:default}
.tl-btn.ghost{background:var(--dsw-alias-button-secondary-fill);color:var(--dsw-alias-label-primary)}
.tl-err{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;margin:0}
.tl-note{color:var(--dsw-alias-state-warn-label);font-size:12px;line-height:18px;margin:0}
.tl-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.tl-card{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:8px}
.tl-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.tl-id{font-size:14px;font-weight:500;line-height:22px}
.tl-name{color:var(--dsw-alias-label-tertiary);font-size:12px}
.tl-badge{font-size:11px;line-height:16px;border-radius:4px;padding:1px 6px;border:1px solid var(--dsw-alias-border-l3)}
.tl-badge.yes{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.tl-badge.no{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.tl-badge.unk{color:var(--dsw-alias-state-warn-label);border-color:var(--dsw-alias-state-warn-label)}
.tl-cap{font-size:12px;color:var(--dsw-alias-label-secondary)}
.tl-toggle{display:flex;align-items:center;gap:6px;font-size:13px}
.tl-efforts{display:flex;flex-wrap:wrap;gap:6px}
.tl-chip{display:inline-flex;align-items:center;gap:4px;font-size:12px;border:1px solid var(--dsw-alias-border-l3);border-radius:6px;padding:2px 8px}
.tl-chip input[type=text]{width:64px;border:none;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;border-bottom:1px dashed var(--dsw-alias-border-l3)}
`

interface PanelProps {
  api: ApiClient
  t: Translator
}

function ThinkingLevelsPanel({ api, t }: PanelProps): React.ReactElement {
  const [providers, setProviders] = React.useState<ProviderView[]>([])
  const [route, setRoute] = React.useState('')
  const [revision, setRevision] = React.useState<number | undefined>(undefined)
  const [detections, setDetections] = React.useState<Record<string, DetectionResult>>({})
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [saved, setSaved] = React.useState(false)

  const selected = providers.find((p) => p.route === route) ?? null

  const load = React.useCallback(async () => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const value = unwrap(
        await api.settings.describe({}),
      )
      const view = value.namespaces.find((n) => n && n.ns === NS)
      if (!view) throw new Error(t('errNotLoaded'))
      const list = providersOf(view)
      setProviders(list)
      setRevision(typeof view.revision === 'number' ? view.revision : undefined)
      setDetections({})
      setRoute((current) => (list.some((p) => p.route === current) ? current : (list[0]?.route ?? '')))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [api, t])

  React.useEffect(() => {
    void load()
  }, [load])

  const onRouteChange = (value: string) => {
    setRoute(value)
    setDetections({})
    setError(null)
    setNotice(null)
    setSaved(false)
  }

  /** Pre-fill reasoning levels the llm catalog already knows for this route's models. */
  const prefillFromCatalog = async () => {
    if (!selected) return
    setBusy(true)
    setError(null)
    setNotice(null)
    setSaved(false)
    try {
      const catalog = unwrap(await api.llm.models({}))
      const known = knownReasoningOf(catalog).get(selected.route)
      const next: Record<string, DetectionResult> = {}
      for (const m of selected.models) {
        const id = (m as { id: string }).id
        const info = known?.get(id)
        next[id] = info
          ? {
              id,
              found: true,
              reasoning: true,
              reasoningSource: 'llm catalog',
              reasoningEfforts: defaultManualEfforts(info.levels),
              confidence: 'medium',
            }
          : { id, found: true, reasoning: 'unknown', confidence: 'low' }
      }
      setDetections(next)
      if (!known || known.size === 0) {
        setError(t('errNoCatalog'))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  /** Host-side endpoint discovery: fills capacities and flags unconfigured models. */
  const detectAll = async () => {
    if (!selected) return
    setBusy(true)
    setError(null)
    setNotice(null)
    setSaved(false)
    try {
      // Catalog half of the complementary pair (pi-ai's own model knowledge).
      let known: Map<string, { levels: string[]; defaultEffort?: string }> | undefined
      try {
        known = knownReasoningOf(unwrap(await api.llm.models({}))).get(selected.route)
      } catch {
        known = undefined
      }

      // Raw endpoint half: the plugin's host route keeps reasoning signals.
      const raw = await fetchRawModels(selected.route)
      if (raw.data !== undefined) {
        const entries = new Map(raw.data.map((entry) => [String(entry?.id ?? ''), entry]))
        const next: Record<string, DetectionResult> = {}
        for (const m of selected.models) {
          const id = (m as { id: string }).id
          next[id] = mergeCatalogInto(detectModel(id, entries.get(id)), known?.get(id))
        }
        // Models the endpoint advertises but settings do not configure yet.
        const configured = new Set(selected.models.map((m) => (m as { id: string }).id))
        for (const [id, entry] of entries) {
          if (id.length === 0 || configured.has(id)) continue
          const det = mergeCatalogInto(detectModel(id, entry), known?.get(id))
          next[id] = { ...det, note: det.found ? t('noteNew') : t('noteMissing') }
        }
        setDetections(next)
        return
      }

      // Fallback: the official discovery channel (capacities only).
      const value = unwrap(
        await api.llm.discoverModels({ settingsNs: NS, provider: selected.route }),
      )
      const found = new Map(value.models.map((m) => [m.id, m]))
      const next: Record<string, DetectionResult> = {}
      for (const m of selected.models) {
        const id = (m as { id: string }).id
        const entry = found.get(id)
        const info = known?.get(id)
        next[id] = entry
          ? {
              id,
              found: true,
              reasoning: info ? true : 'unknown',
              reasoningSource: info ? 'llm catalog' : undefined,
              contextWindow: entry.contextWindow,
              maxTokens: entry.maxTokens,
              name: entry.name,
              reasoningEfforts: info ? defaultManualEfforts(info.levels) : undefined,
              confidence: info ? 'medium' : 'low',
            }
          : {
              id,
              found: false,
              reasoning: 'unknown',
              confidence: 'low',
              note: t('noteMissing'),
            }
      }
      const configured = new Set(selected.models.map((m) => (m as { id: string }).id))
      for (const [id, entry] of found) {
        if (configured.has(id)) continue
        const info = known?.get(id)
        next[id] = {
          id,
          found: true,
          reasoning: info ? true : 'unknown',
          reasoningSource: info ? 'llm catalog' : undefined,
          contextWindow: entry.contextWindow,
          maxTokens: entry.maxTokens,
          name: entry.name,
          reasoningEfforts: info ? defaultManualEfforts(info.levels) : undefined,
          confidence: info ? 'medium' : 'low',
          note: t('noteNew'),
        }
      }
      setDetections(next)
      setNotice(fmt(t('rawFallbackNote'), { detail: raw.error ?? '' }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const setEffort = (id: string, level: string, value: string | null | undefined) => {
    setDetections((prev) => {
      const cur: DetectionResult = prev[id] ?? ({ id } as DetectionResult)
      const efforts: ReasoningEfforts = { ...(cur.reasoningEfforts ?? {}) }
      if (value === undefined || value === null) delete efforts[level as keyof ReasoningEfforts]
      else efforts[level as keyof ReasoningEfforts] = value
      const next: DetectionResult = { ...cur, reasoningEfforts: efforts }
      return { ...prev, [id]: next }
    })
  }

  const toggleReasoning = (id: string, enabled: boolean) => {
    setDetections((prev) => {
      const cur: DetectionResult = prev[id] ?? ({ id } as DetectionResult)
      const known = cur.reasoning === true && cur.reasoningEfforts ? cur.reasoningEfforts : undefined
      const efforts: ReasoningEfforts | undefined = enabled
        ? known ?? defaultManualEfforts()
        : undefined
      const next: DetectionResult = {
        ...cur,
        reasoningEfforts: efforts,
        reasoning: enabled ? 'manual' : 'off',
      }
      return { ...prev, [id]: next }
    })
  }

  const apply = async () => {
    if (!selected || revision === undefined) return
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const edits = Object.keys(detections).filter(
        (id) => detections[id].reasoningEfforts !== undefined,
      )
      if (edits.length === 0) {
        setError(t('errNothingToApply'))
        return
      }
      const nextModels = selected.models.map((m) => {
        const id = (m as { id: string }).id
        const det = detections[id]
        const out = cloneJson(m) as Record<string, unknown>
        if (!det) return out
        if (det.reasoningEfforts !== undefined) {
          const enabled = Object.keys(det.reasoningEfforts)
          out.reasoningEfforts =
            enabled.length === 0 ? false : cloneJson(det.reasoningEfforts)
        }
        if (det.contextWindow !== undefined) out.contextWindow = det.contextWindow
        if (det.maxTokens !== undefined) out.maxTokens = det.maxTokens
        if (det.name !== undefined) out.name = det.name
        return out
      })
      // Append model ids present in edits but not yet configured.
      const configured = new Set(selected.models.map((m) => (m as { id: string }).id))
      for (const id of edits) {
        if (configured.has(id)) continue
        const det = detections[id]
        const entry: Record<string, unknown> = { id }
        if (det.name !== undefined) entry.name = det.name
        if (det.contextWindow !== undefined) entry.contextWindow = det.contextWindow
        if (det.maxTokens !== undefined) entry.maxTokens = det.maxTokens
        if (det.reasoningEfforts !== undefined) {
          const enabled = Object.keys(det.reasoningEfforts)
          entry.reasoningEfforts = enabled.length === 0 ? false : cloneJson(det.reasoningEfforts)
        }
        nextModels.push(entry)
      }
      const view = unwrap(
        await api.settings.mutate({
          ns: NS,
          ops: [{ op: 'set', path: ['providers', selected.route, 'models'], value: nextModels }],
          expectedRevision: revision,
        }),
      )
      setRevision(typeof view.revision === 'number' ? view.revision : undefined)
      setSaved(true)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const configuredIds: string[] = selected ? selected.models.map((m) => (m as { id: string }).id) : []
  const models: string[] = Array.from(new Set([...configuredIds, ...Object.keys(detections)]))

  return (
    <div className="tl-root">
      <h2 className="tl-title">{t('title')}</h2>
      <p className="tl-intro">{t('intro')}</p>
      <div className="tl-row">
        <select
          className="tl-select"
          value={route}
          disabled={busy}
          onChange={(e) => onRouteChange(e.target.value)}
        >
          {providers.map((p) => (
            <option key={p.route} value={p.route}>
              {p.displayName} ({p.route})
            </option>
          ))}
        </select>
        <button className="tl-btn ghost" onClick={prefillFromCatalog} disabled={busy || !selected}>
          {t('prefill')}
        </button>
        <button className="tl-btn" onClick={detectAll} disabled={busy || !selected}>
          {busy ? t('working') : t('detect')}
        </button>
        <button
          className="tl-btn ghost"
          onClick={apply}
          disabled={busy || Object.keys(detections).length === 0}
        >
          {t('apply')}
        </button>
      </div>
      {error ? <p className="tl-err">{error}</p> : null}
      {notice ? <p className="tl-note">{notice}</p> : null}
      {saved ? <p className="tl-note">{fmt(t('saved'), { route })}</p> : null}
      {!selected ? <p className="tl-intro">{t('noProviders')}</p> : null}
      <ul className="tl-list">
        {models.map((id) => {
          const det = detections[id]
          const configured = selected?.models.find((m) => (m as { id: string }).id === id)
          const badge = det ? (
            det.reasoning === true || det.reasoning === 'manual' ? (
              <span className="tl-badge yes">{t('badgeReasoning')}</span>
            ) : det.reasoning === 'off' ? (
              <span className="tl-badge no">{t('badgeOff')}</span>
            ) : (
              <span className="tl-badge unk">{t('badgeUnknown')}</span>
            )
          ) : null
          const enabled = !!det && det.reasoningEfforts !== undefined
          const efforts = enabled ? (det.reasoningEfforts as ReasoningEfforts) : {}
          const cap: string[] = []
          const ctx = det?.contextWindow ?? (configured?.contextWindow as number | undefined)
          const out = det?.maxTokens ?? (configured?.maxTokens as number | undefined)
          if (ctx) cap.push(fmt(t('capCtx'), { n: Math.round(ctx / 1000) }))
          if (out) cap.push(fmt(t('capOut'), { n: Math.round(out / 1000) }))
          return (
            <li key={id} className="tl-card">
              <div className="tl-head">
                <span className="tl-id">{id}</span>
                {det?.name || (configured?.name as string | undefined) ? (
                  <span className="tl-name">
                    {String(det?.name ?? (configured?.name as string | undefined))}
                  </span>
                ) : null}
                {badge}
                {det?.reasoningSource === 'endpoint' || det?.reasoningSource === 'llm catalog' ? (
                  <span className="tl-name">
                    {det.reasoningSource === 'endpoint' ? t('srcEndpoint') : t('srcCatalog')}
                  </span>
                ) : null}
                {!configured ? <span className="tl-badge unk">{t('badgeNotConfigured')}</span> : null}
              </div>
              {cap.length ? <div className="tl-cap">{cap.join(' · ')}</div> : null}
              {det?.note ? <div className="tl-note">{det.note}</div> : null}
              <label className="tl-toggle">
                <input
                  type="checkbox"
                  checked={enabled}
                  disabled={busy}
                  onChange={(e) => toggleReasoning(id, e.target.checked)}
                />
                {t('offerLevels')}
              </label>
              {enabled ? (
                <div className="tl-efforts">
                  {THINKING_LEVELS.map((level) => (
                    <label key={level} className="tl-chip">
                      <input
                        type="checkbox"
                        checked={level in efforts}
                        disabled={busy}
                        onChange={(e) =>
                          e.target.checked
                            ? setEffort(id, level, level === 'off' ? null : level)
                            : setEffort(id, level, undefined)
                        }
                      />
                      {level}
                      {level in efforts && level !== 'off' ? (
                        <input
                          type="text"
                          value={efforts[level as keyof ReasoningEfforts] ?? ''}
                          disabled={busy}
                          onChange={(e) => setEffort(id, level, e.target.value)}
                        />
                      ) : null}
                    </label>
                  ))}
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Client plugin apply: register dictionaries + the settings.section contribution. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const locale = ctx.get('locale')
    locale?.register(LOCALE_NS, { zh, en })
    const t = locale?.bind(LOCALE_NS) ?? fallbackT

    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-thinking-levels'
    style.textContent = CSS
    document.head.appendChild(style)
    const api = ctx.get('connection')?.api
    const slots = ctx.get('slots')
    const disposeSlot = slots?.inject('settings.section', () =>
      slots.register(
        {
          name: 'settings.section',
          id: 'thinking-levels',
          order: 11,
          // Function form: the settings nav re-resolves it when the UI language changes.
          label: () => t('nav'),
          inject: () => ({ api, t }),
        },
        ({ api, t: sectionT }: { api?: ApiClient; t?: Translator }) =>
          api && sectionT ? (
            <ThinkingLevelsPanel api={api} t={sectionT} />
          ) : (
            <p className="tl-intro">{fallbackT('wireUnavailable')}</p>
          ),
      ),
    )
    return () => {
      disposeSlot?.()
      style.remove()
    }
  }, 'thinking-levels: settings section')
}

/** Required services: the connection (settings wire), the slot system, and the locale registry. */
export const inject = ['connection', 'slots', 'locale']
export const name = 'dsh-thinking-levels'
