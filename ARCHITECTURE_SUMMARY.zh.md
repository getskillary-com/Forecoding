# Forecoding 系统架构总结

## 目的
Forecoding 帮助非技术用户把模糊的产品想法转化为可由 Cursor 等 AI IDE 实现的结构化蓝图。它负责需求澄清、架构产出以及生成文件级规格说明。

## 高层组件
- 基于 Next.js App Router 的 Web UI（`app` 目录）。
- 用于评估、蓝图生成与批量审查的 API 路由。
- Gemini 集成用于推理与内容生成。
- 通过浏览器 localStorage（`fl_projects_v2`）持久化项目数据。
- 通过 JSZip 打包并下载蓝图。

## 关键路由与模块
- `app/page.tsx`：落地页。
- `app/dashboard/page.tsx`：项目创建与管理。
- `app/wizard/page.tsx`：主工作区（聊天、架构图、PRD、蓝图）。
- `app/api/evaluate/route.ts`：流式需求评估。
- `app/api/generate/route.ts`：蓝图 JSON 生成。
- `app/api/batch-analyze/route.ts`：批量审查（SSE 流）。
- `lib/gemini.ts`：Gemini 调用、回退、JSON 解析与后处理。
- `lib/prompts.ts`：系统提示词。
- `lib/batch-processing.ts`：文件树分批与聚合分析。
- `components/FileTreeDisplay.tsx`：蓝图渲染与打包。

## 核心数据模型
- `Project`：包含多个 `ProjectVersion`。
- `ProjectVersion`：保存 `ProjectVersionData`（消息、评估、蓝图、架构图）。
- `EvaluationResponse`：密度评分、已澄清/缺失信息。
- `GenerationResponse`：`projectTree`、`toolStack`、`cursorPrompt`。

## 核心流程
1. 项目创建
   - 在 Dashboard 创建项目。
   - 生成 v1 并写入 localStorage。

2. 聊天评估
   - Wizard 将消息发送到 `/api/evaluate`。
   - 服务端流式返回 XML 标签结构。
   - 客户端解析密度、架构图、已澄清/缺失项。

3. 蓝图生成
   - Wizard 调用 `/api/generate` 传入摘要与架构图。
   - Gemini 返回蓝图 JSON。
   - 服务端后处理：注入基础配置、质量规则、可选 Prisma/NextAuth 规范。
   - 客户端渲染并打包下载。

4. 批量审查
   - Wizard 调用 `/api/batch-analyze`。
   - 服务端分批分析并汇总。
   - 客户端展示进度与最终报告。

## 后处理与约束
- JSON 解析增强：提取 JSON 并重试。
- 缺失基础配置自动补齐。
- toolStack 为空时应用默认栈。
- 文件级规格自动注入质量约束、模板指导、正反例。
- 检测 Prisma / NextAuth 时自动补齐相关规范与 README 初始化步骤。

## 当前限制
- 无服务器端数据库；全部存于 localStorage。
- Forecoding 本身没有账号体系。
- localStorage 容量限制会影响超大蓝图。

## 规划演进（可维护性）
- 将项目状态存入数据库，支持多端与多人协作。
- 支持导入真实代码仓库，进行读取、索引与差分。
- 版本操作升级为对代码树的增量变更（差量更新），而非重生成蓝图。

## 环境要求
- `.env.local` 中需要 `GEMINI_API_KEY`。
