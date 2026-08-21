# DSH Thinking Levels 自动检测插件 — 开发方案

## 1. 项目概述

### 1.1 目标

开发一个 DSH 插件，在用户添加自定义模型时，自动从 API 获取模型信息，检测是否支持 reasoning（思考强度），并自动配置 `reasoningEfforts`。

### 1.2 核心价值

- **自动化**：无需手动为每个模型配置 reasoning
- **智能检测**：从 API 响应中自动识别 reasoning 能力
- **容错设计**：获取不到就跳过，不影响正常使用
- **用户体验**：提供 UI 让用户确认/修改自动检测的结果

### 1.3 参考项目

- [dsh-thinking-levels-settings](https://github.com/blackteaYES/dsh-thinking-levels-settings) — 现有的手动配置插件
- [model-catalog](https://github.com/JohnXu22786/model-catalog) — 模型发现插件

---

## 2. 技术架构

### 2.1 插件类型

**Host + Client 混合插件**

- Host：提供模型信息获取工具（调用 API）
- Client：提供设置页面 UI（显示检测结果，让用户确认/修改）

### 2.2 数据流

```
┌─────────────────────────────────────────────────────────────┐
│                     用户操作流程                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 用户在 DSH Settings 中添加自定义 Provider               │
│     ↓                                                       │
│  2. 用户添加 Model（填写 id, name）                          │
│     ↓                                                       │
│  3. 插件自动调用 API 获取模型信息                             │
│     GET /v1/models 或 provider 特定端点                      │
│     ↓                                                       │
│  4. 检查响应中的 reasoning 能力信息                          │
│     - supported_features 包含 "reasoning"                   │
│     - 或其他字段表明支持 reasoning                           │
│     ↓                                                       │
│  5a. 检测到 reasoning → 自动配置 reasoningEfforts            │
│      默认: { off: "", high: "high" }                        │
│      ↓                                                      │
│  5b. 未检测到 → 跳过，用户可手动配置                         │
│     ↓                                                       │
│  6. 显示检测结果，让用户确认/修改                             │
│     ↓                                                       │
│  7. 保存到 settings.yaml                                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 支持的 API 响应格式

#### 格式 1：OpenAI 兼容格式（标准）

```json
{
  "data": [
    {
      "id": "model-id",
      "object": "model",
      "owned_by": "provider"
    }
  ]
}
```

**检测策略**：此格式不包含 reasoning 信息，跳过自动检测。

#### 格式 2：富元数据格式（如你提供的示例）

```json
{
  "data": [
    {
      "id": "sensenova-6.7-flash-lite",
      "context_length": 262144,
      "max_output_length": 65536,
      "supported_features": ["tools", "json_mode", "reasoning"],
      "supported_sampling_parameters": ["temperature", "stop"]
    }
  ]
}
```

**检测策略**：
- 检查 `supported_features` 是否包含 `"reasoning"`
- 如果包含，自动配置 reasoningEfforts

#### 格式 3：增强格式（augmented）

```json
{
  "data": [
    {
      "id": "model-id",
      "context_length": 128000,
      "supported_parameters": ["tools", "reasoning", "temperature"]
    }
  ]
}
```

**检测策略**：
- 检查 `supported_parameters` 是否包含 `"reasoning"` 或 `"include_reasoning"`
- 如果包含，自动配置 reasoningEfforts

#### 格式 4：能力标志格式（flag）

```json
{
  "model-id": {
    "supports_reasoning": true,
    "max_input_tokens": 128000,
    "max_output_tokens": 16384
  }
}
```

**检测策略**：
- 检查 `supports_reasoning` 字段
- 如果为 true，自动配置 reasoningEfforts

---

## 3. 文件结构

```
dsh-thinking-levels/
├── PLAN.md                          # 本方案文档
├── package.json                     # npm 包配置
├── tsconfig.json                    # TypeScript 配置
├── cordis.patch.yml                 # Cordis composition patch
├── src/
│   ├── index.ts                     # Host 入口（no-op，纯 Client 插件）
│   ├── client/
│   │   ├── index.ts                 # Client 入口
│   │   ├── AutoDetectPanel.tsx      # 自动检测面板组件
│   │   ├── ModelCard.tsx            # 单个模型卡片组件
│   │   ├── LevelSelector.tsx        # 思考强度选择器组件
│   │   └── styles.css               # 样式
│   ├── shared/
│   │   ├── types.ts                 # 共享类型定义
│   │   ├── presets.ts               # 预设配置（DeepSeek/OpenAI/Grok）
│   │   └── detection.ts             # 检测逻辑（支持的 API 格式）
│   └── invariant.ts                 # 不变量检查
├── docs/
│   └── integration.md               # 集成文档
└── README.md                        # 项目说明
```

---

## 4. 核心模块设计

### 4.1 类型定义 (`src/shared/types.ts`)

```typescript
/** 支持的 API 响应格式 */
export interface ApiModelEntry {
  id: string
  name?: string
  context_length?: number
  max_output_length?: number
  supported_features?: string[]
  supported_parameters?: string[]
  supports_reasoning?: boolean
  // ... 其他字段
}

/** API 响应格式 */
export interface ApiResponse {
  data?: ApiModelEntry[]
  // 或者 flag 格式
  [modelId: string]: {
    supports_reasoning?: boolean
    max_input_tokens?: number
    max_output_tokens?: number
  } | unknown
}

/** 检测结果 */
export interface DetectionResult {
  modelId: string
  hasReasoning: boolean
  contextWindow?: number
  maxOutput?: number
  source: 'api' | 'manual' | 'unknown'
  confidence: 'high' | 'medium' | 'low'
}

/** reasoningEfforts 配置 */
export interface ReasoningEfforts {
  off?: string
  minimal?: string
  low?: string
  medium?: string
  high?: string
  xhigh?: string
  max?: string
}

/** 模型配置 */
export interface ModelConfig {
  id: string
  name?: string
  contextWindow?: number
  maxOutput?: number
  reasoningEfforts?: ReasoningEfforts | false
}

/** Provider 配置 */
export interface ProviderConfig {
  id: string
  displayName?: string
  apiKeyEnv?: string
  api?: string
  baseURL?: string
  models?: ModelConfig[]
}
```

### 4.2 检测逻辑 (`src/shared/detection.ts`)

```typescript
import type { ApiModelEntry, DetectionResult, ReasoningEfforts } from './types'

/**
 * 从 API 响应中检测模型的 reasoning 能力
 */
export function detectReasoning(
  model: ApiModelEntry
): DetectionResult {
  const result: DetectionResult = {
    modelId: model.id,
    hasReasoning: false,
    source: 'unknown',
    confidence: 'low',
  }

  // 格式 1：supported_features 包含 "reasoning"
  if (Array.isArray(model.supported_features)) {
    if (model.supported_features.includes('reasoning')) {
      result.hasReasoning = true
      result.source = 'api'
      result.confidence = 'high'
    }
  }

  // 格式 2：supported_parameters 包含 "reasoning"
  if (Array.isArray(model.supported_parameters)) {
    if (
      model.supported_parameters.includes('reasoning') ||
      model.supported_parameters.includes('include_reasoning')
    ) {
      result.hasReasoning = true
      result.source = 'api'
      result.confidence = 'high'
    }
  }

  // 格式 3：supports_reasoning 字段
  if (typeof model.supports_reasoning === 'boolean') {
    result.hasReasoning = model.supports_reasoning
    result.source = 'api'
    result.confidence = 'high'
  }

  // 提取上下文信息
  if (typeof model.context_length === 'number') {
    result.contextWindow = model.context_length
  }
  if (typeof model.max_output_length === 'number') {
    result.maxOutput = model.max_output_length
  }

  return result
}

/**
 * 根据检测结果生成 reasoningEfforts 配置
 */
export function generateReasoningEfforts(
  detection: DetectionResult,
  preset?: 'deepseek' | 'openai' | 'grok' | 'default'
): ReasoningEfforts | false {
  if (!detection.hasReasoning) {
    return false
  }

  // 根据预设生成配置
  switch (preset) {
    case 'deepseek':
      return { off: '', low: 'low', high: 'high', max: 'max' }
    case 'openai':
      return { off: '', low: 'low', medium: 'medium', high: 'high' }
    case 'grok':
      return { low: 'low', medium: 'medium', high: 'high' }
    default:
      // 默认：保守配置，只配 off 和 high
      return { off: '', high: 'high' }
  }
}
```

### 4.3 Client UI 组件

#### 4.3.1 主面板 (`src/client/AutoDetectPanel.tsx`)

```typescript
import * as React from 'react'
import type { DetectionResult, ModelConfig } from '../shared/types'
import { detectReasoning, generateReasoningEfforts } from '../shared/detection'
import { ModelCard } from './ModelCard'

interface PanelProps {
  providerId: string
  providerName: string
  models: ModelConfig[]
  onSave: (models: ModelConfig[]) => void
}

export function AutoDetectPanel({ providerId, providerName, models, onSave }: PanelProps) {
  const [results, setResults] = React.useState<Map<string, DetectionResult>>(new Map())
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // 批量检测所有模型
  const detectAll = async () => {
    setLoading(true)
    setError(null)
    
    try {
      const newResults = new Map<string, DetectionResult>()
      
      for (const model of models) {
        // 调用 Host 工具获取模型信息
        const modelInfo = await host.call('thinking-levels.detectModel', {
          providerId,
          modelId: model.id,
        })
        
        // 检测 reasoning 能力
        const detection = detectReasoning(modelInfo)
        newResults.set(model.id, detection)
      }
      
      setResults(newResults)
    } catch (err) {
      setError(err instanceof Error ? err.message : '检测失败')
    } finally {
      setLoading(false)
    }
  }

  // 应用检测结果
  const applyResults = () => {
    const updatedModels = models.map(model => {
      const detection = results.get(model.id)
      if (!detection) return model
      
      return {
        ...model,
        contextWindow: detection.contextWindow || model.contextWindow,
        maxOutput: detection.maxOutput || model.maxOutput,
        reasoningEfforts: detection.hasReasoning
          ? generateReasoningEfforts(detection)
          : model.reasoningEfforts,
      }
    })
    
    onSave(updatedModels)
  }

  return (
    <div className="thinking-levels-panel">
      <h3>🧠 思考强度自动检测</h3>
      <p>Provider: {providerName}</p>
      
      <div className="actions">
        <button onClick={detectAll} disabled={loading}>
          {loading ? '检测中...' : '🔍 自动检测'}
        </button>
        <button onClick={applyResults} disabled={results.size === 0}>
          ✅ 应用结果
        </button>
      </div>
      
      {error && <div className="error">{error}</div>}
      
      <div className="model-list">
        {models.map(model => (
          <ModelCard
            key={model.id}
            model={model}
            detection={results.get(model.id)}
          />
        ))}
      </div>
    </div>
  )
}
```

#### 4.3.2 模型卡片 (`src/client/ModelCard.tsx`)

```typescript
import * as React from 'react'
import type { DetectionResult, ModelConfig, ReasoningEfforts } from '../shared/types'
import { LevelSelector } from './LevelSelector'

interface CardProps {
  model: ModelConfig
  detection?: DetectionResult
  onOverride?: (modelId: string, efforts: ReasoningEfforts | false) => void
}

export function ModelCard({ model, detection, onOverride }: CardProps) {
  const [customEfforts, setCustomEfforts] = React.useState<ReasoningEfforts | false | null>(null)
  
  const efforts = customEfforts ?? model.reasoningEfforts
  const hasAutoDetection = detection !== undefined

  return (
    <div className={`model-card ${detection?.hasReasoning ? 'has-reasoning' : ''}`}>
      <div className="model-header">
        <span className="model-id">{model.id}</span>
        {model.name && <span className="model-name">{model.name}</span>}
      </div>
      
      {hasAutoDetection && (
        <div className="detection-info">
          <span className={`badge ${detection!.hasReasoning ? 'success' : 'warning'}`}>
            {detection!.hasReasoning ? '✅ 支持 Reasoning' : '⚠️ 未检测到 Reasoning'}
          </span>
          <span className="source">
            来源: {detection!.source === 'api' ? 'API 自动检测' : '手动配置'}
          </span>
          <span className="confidence">
            置信度: {detection!.confidence === 'high' ? '高' : detection!.confidence === 'medium' ? '中' : '低'}
          </span>
        </div>
      )}
      
      {model.contextWindow && (
        <div className="context-info">
          上下文: {(model.contextWindow / 1000).toFixed(0)}K
          {model.maxOutput && ` | 输出: ${(model.maxOutput / 1000).toFixed(0)}K`}
        </div>
      )}
      
      <LevelSelector
        value={efforts}
        onChange={(v) => {
          setCustomEfforts(v)
          onOverride?.(model.id, v)
        }}
      />
    </div>
  )
}
```

#### 4.3.3 思考强度选择器 (`src/client/LevelSelector.tsx`)

```typescript
import * as React from 'react'
import type { ReasoningEfforts } from '../shared/types'

const LEVELS = [
  { id: 'off', label: 'Off', description: '关闭思考' },
  { id: 'minimal', label: 'Minimal', description: '最小思考' },
  { id: 'low', label: 'Low', description: '低强度思考' },
  { id: 'medium', label: 'Medium', description: '中等强度思考' },
  { id: 'high', label: 'High', description: '高强度思考' },
  { id: 'xhigh', label: 'XHigh', description: '极高强度思考' },
  { id: 'max', label: 'Max', description: '最大强度思考' },
] as const

const PRESETS = [
  { id: 'deepseek', label: 'DeepSeek', efforts: { off: '', low: 'low', high: 'high', max: 'max' } },
  { id: 'openai', label: 'OpenAI', efforts: { off: '', low: 'low', medium: 'medium', high: 'high' } },
  { id: 'grok', label: 'Grok', efforts: { low: 'low', medium: 'medium', high: 'high' } },
] as const

interface SelectorProps {
  value: ReasoningEfforts | false | null
  onChange: (value: ReasoningEfforts | false) => void
}

export function LevelSelector({ value, onChange }: SelectorProps) {
  const isEnabled = value !== false && value !== null
  const efforts = typeof value === 'object' && value !== null ? value : {}

  return (
    <div className="level-selector">
      <div className="toggle">
        <label>
          <input
            type="checkbox"
            checked={isEnabled}
            onChange={(e) => onChange(e.target.checked ? { off: '', high: 'high' } : false)}
          />
          启用思考强度
        </label>
      </div>
      
      {isEnabled && (
        <>
          <div className="presets">
            <span>预设:</span>
            {PRESETS.map(preset => (
              <button
                key={preset.id}
                onClick={() => onChange(preset.efforts)}
                className="preset-btn"
              >
                {preset.label}
              </button>
            ))}
          </div>
          
          <div className="levels">
            {LEVELS.map(level => (
              <label key={level.id} className="level-option">
                <input
                  type="checkbox"
                  checked={level.id in efforts}
                  onChange={(e) => {
                    const newEfforts = { ...efforts }
                    if (e.target.checked) {
                      newEfforts[level.id] = level.id === 'off' ? '' : level.id
                    } else {
                      delete newEfforts[level.id]
                    }
                    onChange(newEfforts)
                  }}
                />
                <span className="level-label">{level.label}</span>
                <span className="level-desc">{level.description}</span>
                {level.id in efforts && level.id !== 'off' && (
                  <input
                    type="text"
                    value={efforts[level.id] || ''}
                    onChange={(e) => {
                      onChange({ ...efforts, [level.id]: e.target.value })
                    }}
                    placeholder="wire spelling"
                    className="wire-input"
                  />
                )}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
```

---

## 5. Host 工具设计

### 5.1 模型检测工具

```typescript
// src/index.ts 中注册 Host 工具

export function apply(ctx) {
  const tools = ctx.get('tools')
  if (!tools) return

  tools.register({
    name: 'thinking-levels.detectModel',
    description: '从 API 获取模型信息并检测 reasoning 能力',
    parameters: {
      type: 'object',
      properties: {
        providerId: { type: 'string', description: 'Provider ID' },
        modelId: { type: 'string', description: 'Model ID' },
        baseUrl: { type: 'string', description: 'API Base URL (可选)' },
        apiKey: { type: 'string', description: 'API Key (可选)' },
      },
      required: ['providerId', 'modelId'],
    },
    async execute(args) {
      // 1. 从 settings 获取 provider 配置
      const settings = ctx.get('settings')
      const config = settings.get('llm-pi-ai')
      
      const provider = config?.providers?.[args.providerId]
      if (!provider) {
        throw new Error(`Provider ${args.providerId} not found`)
      }

      // 2. 构建 API URL
      const baseUrl = args.baseUrl || provider.baseURL
      if (!baseUrl) {
        throw new Error('No base URL configured')
      }

      // 3. 调用 API 获取模型信息
      const response = await fetch(`${baseUrl}/v1/models`, {
        headers: {
          'Authorization': `Bearer ${resolveApiKey(provider.apiKeyEnv)}`,
        },
      })

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const data = await response.json()

      // 4. 查找目标模型
      const models = data.data || data
      const model = Array.isArray(models)
        ? models.find(m => m.id === args.modelId)
        : models[args.modelId]

      if (!model) {
        return { found: false, message: 'Model not found in API response' }
      }

      // 5. 返回模型信息
      return {
        found: true,
        id: model.id,
        name: model.name,
        contextLength: model.context_length,
        maxOutputLength: model.max_output_length,
        supportedFeatures: model.supported_features,
        supportedParameters: model.supported_parameters,
        supportsReasoning: model.supports_reasoning,
        raw: model,
      }
    },
  })
}
```

---

## 6. Cordis Composition

### 6.1 `cordis.patch.yml`

```yaml
- id: ui-thinking-levels
  name: dsh-thinking-levels
  config: {}
```

### 6.2 `package.json`

```json
{
  "name": "dsh-thinking-levels",
  "version": "0.1.0",
  "description": "DSH plugin: auto-detect and configure thinking levels for custom models",
  "main": "dist/src/index.js",
  "files": [
    "dist/src/**",
    "cordis.patch.yml"
  ],
  "scripts": {
    "build": "tsdown",
    "dev": "tsdown --watch"
  },
  "dsh": {
    "client": "dist/src/client.js",
    "host": "dist/src/index.js"
  },
  "dependencies": {},
  "devDependencies": {
    "@deepseek-ai/dsh-api-remotes": "latest",
    "@deepseek-ai/dsh-host-apiproxy": "latest",
    "react": "^19.0.0",
    "tsdown": "latest",
    "typescript": "^5.7.0"
  }
}
```

---

## 7. 实现步骤

### Phase 1：基础框架（1-2 天）

- [ ] 创建项目结构
- [ ] 配置 TypeScript 和构建工具
- [ ] 实现 Host 入口（no-op）
- [ ] 实现 Client 入口（注册 settings section）

### Phase 2：检测逻辑（2-3 天）

- [ ] 实现 API 调用逻辑
- [ ] 实现多格式检测（supported_features / supported_parameters / supports_reasoning）
- [ ] 实现 reasoningEfforts 生成逻辑
- [ ] 添加预设配置（DeepSeek / OpenAI / Grok）

### Phase 3：Client UI（3-4 天）

- [ ] 实现 AutoDetectPanel 组件
- [ ] 实现 ModelCard 组件
- [ ] 实现 LevelSelector 组件
- [ ] 添加样式和交互

### Phase 4：集成测试（1-2 天）

- [ ] 测试不同 API 格式的检测
- [ ] 测试设置保存和加载
- [ ] 测试边界情况（网络错误、API 不支持等）

### Phase 5：发布（1 天）

- [ ] 编写 README
- [ ] 发布到 npm
- [ ] 提交到 awesome-dsh-plugins

---

## 8. 测试用例

### 8.1 测试 API 格式

```json
// 格式 1：标准 OpenAI（无 reasoning 信息）
{
  "data": [
    { "id": "gpt-4o", "object": "model" }
  ]
}
// 预期：跳过检测，用户手动配置

// 格式 2：富元数据（有 reasoning）
{
  "data": [
    {
      "id": "sensenova-6.7-flash-lite",
      "context_length": 262144,
      "supported_features": ["tools", "json_mode", "reasoning"]
    }
  ]
}
// 预期：自动配置 reasoningEfforts: { off: "", high: "high" }

// 格式 3：增强格式
{
  "data": [
    {
      "id": "model-id",
      "supported_parameters": ["tools", "reasoning", "temperature"]
    }
  ]
}
// 预期：自动配置 reasoningEfforts
```

### 8.2 测试边界情况

- API 不可达 → 显示错误，跳过检测
- API 返回空列表 → 显示"未找到模型"
- API 返回格式不识别 → 跳过检测，用户手动配置
- 模型部分信息缺失 → 只填充电脑的字段

---

## 9. 扩展计划

### 9.1 未来功能

- **批量检测**：一次性检测 Provider 下所有模型
- **缓存**：缓存检测结果，避免重复调用 API
- **自定义检测规则**：用户可以添加自己的检测规则
- **集成 model-catalog**：复用 model-catalog 插件的检测逻辑

### 9.2 与 model-catalog 集成

如果 model-catalog 插件已安装，可以复用其检测结果：

```typescript
// 检查 model-catalog 是否已安装
const modelCatalog = ctx.get('modelCatalog')
if (modelCatalog) {
  // 使用 model-catalog 的检测结果
  const catalogResult = await modelCatalog.detect(args.modelId)
  // ...
}
```

---

## 10. 注意事项

### 10.1 安全性

- API Key 通过环境变量引用，不存储明文
- 检测请求使用最小权限
- 不存储敏感信息

### 10.2 性能

- 检测请求设置超时（10 秒）
- 支持取消检测
- 缓存检测结果

### 10.3 兼容性

- 支持 DSH 0.1.0-rc.7+
- 支持 pi-ai 0.82.1+
- 不依赖特定 Provider

---

## 11. 参考资源

- [DSH 官方文档](https://deepseek-harness.io)
- [pi-ai Catalog 类型定义](https://github.com/earendil-works/pi)
- [dsh-thinking-levels-settings 源码](https://github.com/blackteaYES/dsh-thinking-levels-settings)
- [model-catalog 插件](https://github.com/JohnXu22786/model-catalog)
- [awesome-dsh-plugins](https://github.com/AdamPlatin123/awesome-dsh-plugins)
