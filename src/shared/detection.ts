/**
 * Detection logic for the DSH Thinking Levels auto-detection plugin.
 *
 * Pure, framework-free functions so they can be unit-tested and shared between
 * the Host half (interrogating a provider endpoint) and any tooling.
 */

import type {
  ApiModelEntry,
  DetectionResult,
  ReasoningEfforts,
  ThinkingLevel,
} from './types.js'
import { THINKING_LEVELS } from './types.js'

/** Default level set proposed for a model whose API confirms reasoning. */
export const DEFAULT_REASONING_EFFORTS: ReasoningEfforts = {
  off: null,
  low: 'low',
  medium: 'medium',
  high: 'high',
}

/**
 * Fallback selectable levels shown for a model the endpoint does not confirm
 * reasons. This matches the user requirement: when the provider returns only a
 * bare OpenAI listing (`{id, object, owned_by}`), there is no reasoning info,
 * so we hand the user a few canonical levels to set themselves.
 */
export const FALLBACK_LEVELS: readonly ThinkingLevel[] = [
  'low',
  'medium',
  'high',
]

/** First positive numeric field present on an entry. */
function pickNumber(entry: ApiModelEntry, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = entry[key]
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  }
  return undefined
}

/** First non-empty string field present on an entry. */
function pickString(entry: ApiModelEntry, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = entry[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

/**
 * Detect whether one listing entry supports reasoning, and its capacity.
 *
 * Handles every metadata format described in the requirements:
 *   - `supported_features: [..., "reasoning"]`          (SenseNova-style rich)
 *   - `supported_parameters: [..., "reasoning"]`        (augmented format)
 *   - `supports_reasoning` / `supportsReasoning` boolean (flag format)
 *   - `can_reason`, `reasoning` booleans
 *   - presence of `reasoning_effort` / `supports_reasoning_effort`
 */
export function analyzeEntry(entry: ApiModelEntry): {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
  /** true = reasons, false = explicitly does not reason, undefined = no signal */
  reasoning: boolean | undefined
  reasoningSource: string | null
} {
  const e = entry ?? ({} as ApiModelEntry)
  let reasoning: boolean | undefined
  let source: string | null = null

  if (Array.isArray(e.supported_features) && e.supported_features.includes('reasoning')) {
    reasoning = true
    source = 'supported_features'
  } else if (
    Array.isArray(e.supported_parameters) &&
    (e.supported_parameters.includes('reasoning') ||
      e.supported_parameters.includes('include_reasoning'))
  ) {
    reasoning = true
    source = 'supported_parameters'
  } else if (typeof e.supports_reasoning === 'boolean') {
    reasoning = e.supports_reasoning
    source = 'supports_reasoning'
  } else if (typeof e.supportsReasoning === 'boolean') {
    reasoning = e.supportsReasoning
    source = 'supportsReasoning'
  } else if (typeof e.can_reason === 'boolean') {
    reasoning = e.can_reason
    source = 'can_reason'
  } else if (typeof e.reasoning === 'boolean') {
    reasoning = e.reasoning
    source = 'reasoning'
  } else if (e.reasoning_effort !== undefined || e.supports_reasoning_effort === true) {
    reasoning = true
    source = 'reasoning_effort'
  }
  // No signal means the endpoint disclosed nothing about reasoning. That is
  // "unknown", not "explicitly off": `supports_reasoning: false` explicitly
  // strips reasoning, while a bare `{id, object, owned_by}` listing just never
  // said. Both matter to the user, so we keep them distinct.

  return {
    id: pickString(e, 'id') ?? '',
    name: pickString(e, 'name', 'display_name'),
    contextWindow: pickNumber(e, 'context_window', 'context_length'),
    maxTokens: pickNumber(e, 'max_output_tokens', 'max_tokens', 'max_output_length'),
    reasoning,
    reasoningSource: source,
  }
}

/** Build a DetectionResult for one configured model id from its listing entry. */
export function detectModel(id: string, entry: ApiModelEntry | undefined): DetectionResult {
  if (!entry) {
    return {
      id,
      found: false,
      reasoning: 'unknown',
      confidence: 'low',
      note:
        'model not present in the endpoint listing (check the API key, or the provider exposes no usable /models listing)',
    }
  }
  const analyzed = analyzeEntry(entry)
  if (analyzed.reasoning === true) {
    return {
      id,
      found: true,
      reasoning: true,
      reasoningSource: analyzed.reasoningSource ?? undefined,
      contextWindow: analyzed.contextWindow,
      maxTokens: analyzed.maxTokens,
      name: analyzed.name,
      reasoningEfforts: DEFAULT_REASONING_EFFORTS,
      confidence: 'high',
    }
  }
  if (analyzed.reasoning === false) {
    return {
      id,
      found: true,
      reasoning: false,
      reasoningSource: analyzed.reasoningSource ?? undefined,
      contextWindow: analyzed.contextWindow,
      maxTokens: analyzed.maxTokens,
      name: analyzed.name,
      confidence: 'high',
    }
  }
  // No reasoning signal: unknown, fall back to manual levels.
  return {
    id,
    found: true,
    reasoning: 'unknown',
    contextWindow: analyzed.contextWindow,
    maxTokens: analyzed.maxTokens,
    name: analyzed.name,
    confidence: 'low',
  }
}

/** Default level set to offer when the user toggles reasoning manually. */
export function defaultManualEfforts(levels: readonly string[] = FALLBACK_LEVELS): ReasoningEfforts {
  const efforts: ReasoningEfforts = { off: null }
  for (const level of levels) {
    ;(efforts as Record<string, string | null>)[level] = level
  }
  return efforts
}

export { THINKING_LEVELS }
