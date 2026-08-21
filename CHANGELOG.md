# Changelog

## 0.1.0 (2026-08-21)

首个版本。

- 设置页新增「思考级别」（Thinking Levels）页面：为 `llm-pi-ai` 自定义服务商的每个模型配置 `reasoningEfforts`，无需手改 `settings.yaml`
- 「从端点检测」互补检测：
  - 宿主半边注册同源路由 `GET /thinking-levels/raw-models`，凭证在宿主侧解析，返回原始 `/models` 列表（保留 `supported_features` / `supports_reasoning` 等推理信号），带 `/api` 同款浏览器信任围栏
  - 原始信号判定推理支持（高置信度）；`llm.models` 目录补充/细化档位（中置信度）；两者皆无 → 未知，由用户手动勾选
  - 同时填充 `contextWindow` / `maxTokens` / `name`，并列出端点已提供但未配置的模型
- 「从目录预填」：用 pi-ai 目录已知的档位一键预填
- 「应用到设置」：`settings.mutate` 带 `expectedRevision` 乐观并发写回 `providers.<route>.models`
- 中英双语（官方 locale 服务），导航标签跟随界面语言
- 官方 client bundle 形态（`window.__ModuleLoader__.load` 闭包工厂），profile 插件标准结构
