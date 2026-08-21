/**
 * Detection logic smoke tests against the API reply shapes from the
 * requirements, plus the explicit-off and augmented formats.
 */
import { detectModel, DEFAULT_REASONING_EFFORTS } from '../dist/detection.js'

const sensenova = {
  id: 'sensenova-6.7-flash-lite',
  context_length: 262144,
  max_output_length: 65536,
  supported_features: ['tools', 'json_mode', 'reasoning'],
}

const bare = { id: 'glm-5.2', object: 'model', created: 1787215695, owned_by: 'opencode' }

const augmented = {
  id: 'model-aug',
  context_length: 128000,
  supported_parameters: ['tools', 'reasoning', 'temperature'],
}

const explicitOff = { id: 'no-reason', supports_reasoning: false }

let failures = 0
const check = (name, cond) => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name)
  if (!cond) failures++
}

// Rich metadata (SenseNova)
const sr = detectModel('sensenova-6.7-flash-lite', sensenova)
check('rich: detects reasoning', sr.reasoning === true)
check('rich: proposes default reasoningEfforts', JSON.stringify(sr.reasoningEfforts) === JSON.stringify(DEFAULT_REASONING_EFFORTS))
check('rich: reads contextWindow', sr.contextWindow === 262144)
check('rich: reads maxTokens (max_output_length)', sr.maxTokens === 65536)
check('rich: confidence high', sr.confidence === 'high')

// Augmented format
const ar = detectModel('model-aug', augmented)
check('augmented: detects reasoning', ar.reasoning === true)
check('augmented: proposes efforts', ar.reasoningEfforts !== undefined)
check('augmented: reads contextWindow', ar.contextWindow === 128000)

// Explicit off
const or = detectModel('no-reason', explicitOff)
check('explicit-off: reasoning false', or.reasoning === false)
check('explicit-off: no reasoningEfforts', or.reasoningEfforts === undefined)

// Bare listing (no info) -> unknown
const br = detectModel('glm-5.2', bare)
check('bare: marks reasoning unknown', br.reasoning === 'unknown')
check('bare: proposes no reasoningEfforts', br.reasoningEfforts === undefined)
check('bare: confidence low', br.confidence === 'low')

// Missing from listing
const mr = detectModel('missing-model', undefined)
check('missing: reasoning unknown', mr.reasoning === 'unknown')
check('missing: not found', mr.found === false)

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
