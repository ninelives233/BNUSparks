# BNU 资料库 — 项目指引

## 设计规范

- **在修改任何 CSS/HTML/UI 之前**，必须先调用前端设计技能确定设计方向
- 优先调用顺序：`/frontend-design` (Anthropic官方) → `/web-design-engineer` (确定风格) → `/emil-design-eng` (精细化)
- 禁止产出 "AI 模板风"（浅蓝按钮、圆角卡片、灰色渐变等默认样式）
- 每次设计前先确定一个明确的审美锚点（编辑风、工业风、复古未来风、有机风等），锁定后再写代码
- 使用 OKLCH 色彩空间，维护 CSS 变量体系（--brand-hue 控制全局调性）
- 动效使用 `/animation-vocabulary` 确定方案，用 `/review-animations` 审核实现

## 开发流程

1. 需求讨论 → 确定设计方案 → 调设计 skill → 写代码
2. 不要直接写 UI 代码而不经过设计阶段
3. 重要 UI 改动先出方案再动手
