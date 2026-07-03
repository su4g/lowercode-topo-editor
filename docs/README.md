# GoJS 拓扑编辑器技术文档索引

本文档集基于 `/Users/zhoutong/Downloads/gojs-topology-design.md` 拆分，目标是把原始设计落成一个 Vue 3 前端、Node.js 后端的可迭代工程方案。

## 阅读顺序

1. [00-实施总览](./00-implementation-overview.md)
2. [01-领域模型与数据契约](./01-domain-model-and-contracts.md)
3. [02-后端服务落地方案](./02-backend-service-plan.md)
4. [03-前端工程落地方案](./03-frontend-vue3-plan.md)
5. [04-拓扑编辑器落地步骤](./04-editor-implementation-steps.md)
6. [05-运行态与外部控制](./05-runtime-and-controller.md)
7. [06-规则引擎与数据绑定](./06-rule-engine-and-binding.md)
8. [07-校验发布与权限](./07-validation-release-permission.md)
9. [08-里程碑任务与验收](./08-milestones-and-acceptance.md)

## 第一版目标

第一版只做最小可闭环能力：

- 节点类型管理：断路器、实验室、文本节点。
- 拓扑编辑器：左侧节点库、GoJS 画布、右侧属性面板。
- 基础交互：拖拽、分组、端口连线、保存恢复。
- 数据绑定：`sourceId + mappings + 文本模板`。
- 运行规则：断路器闭合后连线运行、异常值触发故障样式。
- 运行态控制：外部 API 控制分组显示隐藏、聚焦节点。
- 事件暴露：节点、连线、分组点击事件。

## 推荐技术栈

| 层级 | 技术 |
|---|---|
| 前端 | Vue 3、TypeScript、Vite、Pinia、Vue Router、GoJS 2.3.10、Element Plus |
| 后端 | Node.js、TypeScript、NestJS 或 Fastify、Prisma、MySQL/PostgreSQL |
| 实时数据 | 第一版轮询，第二版 WebSocket |
| 测试 | Vitest、Playwright、后端接口集成测试 |

## 工程原则

- 节点类型定义能力，拓扑实例只使用能力。
- GoJS 只负责交互与渲染，不承载业务规则。
- 规则引擎统一计算 `runtime`，模板只绑定 `runtime`。
- 拓扑配置、表单和规则使用 JSON 保存，核心检索字段结构化。
- 第一版不支持任意 JS 脚本，条件、模板和动作都结构化。
