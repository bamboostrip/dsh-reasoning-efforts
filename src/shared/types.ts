/**
 * Shared types for the DSH Thinking Levels auto-detection plugin.
 *
 * This plugin targets the real DSH `llm-pi-ai` settings namespace, where each
 * provider route's `models[]` entries accept a `reasoningEfforts` map. Keys are
 * pi-ai's canonical levels (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`,
 * `max`); each value is the wire spelling sent to the provider (the canonical
 * name passes through, `max: ultra` renames it). `off` may leave the value empty
 * (`null` / `off:`) which means "send nothing" — pi-ai's own default.
 */

/** One raw entry as returned by a provider's `GET /models` endpoint. */
export interface ApiModelEntry {
  id: string
  name?: string
  display_name?: string
  /** OpenAI / pi-ai rich metadata */
  context_length?: number
  context_window?: number
  max_output_tokens?: number
  max_tokens?: number
  supported_features?: string[]
  supported_parameters?: string[]
  supports_reasoning?: boolean
  supportsReasoning?: boolean
  can_reason?: boolean
  reasoning?: boolean
  supports_reasoning_effort?: boolean
  reasoning_effort?: unknown
  [key: string]: unknown
}

/** A provider's `GET /models` reply (OpenAI-compatible list shape). */
export interface ApiModelListResponse {
  data?: ApiModelEntry[]
  object?: string
  [key: string]: unknown
}

/** Canonical pi-ai thinking levels, in escalation order. */
export const THINKING_LEVELS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const
export type ThinkingLevel = (typeof THINKING_LEVELS)[number]

/**
 * reasoningEfforts map written into a model entry.
 * key = offered level, value = wire spelling (empty/null only legal for `off`).
 * `false` (not represented here) declares a non-reasoning model.
 */
export type ReasoningEfforts = Partial<Record<ThinkingLevel, string | null>>

/** The model fields DSH's llm-pi-ai schema accepts (configurable subset). */
export interface ModelConfig {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
  reasoningEfforts?: ReasoningEfforts | false
}

/** One provider route from the llm-pi-ai settings section. */
export interface ProviderConfig {
  route: string
  displayName?: string
  apiKeyEnv?: string
  baseURL?: string
  api?: string
  models: ModelConfig[]
}

/** The full resolved `llm-pi-ai` settings section (as read via ctx.settings.get). */
export interface LlmPiAiSettings {
  providers?: Record<string, Omit<ProviderConfig, 'route'>>
}

/** Per-model detection outcome, returned by the Host `detect` RPC. */
export interface DetectionResult {
  id: string
  found: boolean
  /**
   * true = reasoning confirmed, false = explicitly no reasoning,
   * 'unknown' = no info. The client may override a detection to 'manual'
   * (user offered levels by hand) or 'off' (user disabled reasoning).
   */
  reasoning: boolean | 'unknown' | 'manual' | 'off'
  reasoningSource?: string
  contextWindow?: number
  maxTokens?: number
  name?: string
  /** Proposed reasoningEfforts (undefined when not reasoning / unknown). */
  reasoningEfforts?: ReasoningEfforts
  confidence: 'high' | 'medium' | 'low'
  note?: string
}
