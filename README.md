# Topo Editor

从业务平台中独立出来的 GoJS 拓扑编辑器能力项目。前端使用 Vue 3，后端继续使用 Node.js（Fastify + Prisma），数据存储使用 PostgreSQL。

本项目独立维护拓扑、节点类型、数据源、运行态和素材文件，不依赖 `foundation_platform` 的权限、租户、项目或虚拟设备服务。

## 功能

- 拓扑新建、编辑、保存、删除、版本记录和发布校验
- GoJS 节点、容器、标注、控件与连线编辑
- 节点端口方位、位置、方向和最大连接数配置
- 节点属性、状态图片、标签样式和容器样式配置
- 节点状态、容器样式、按钮显隐和连线运行规则
- 多条件规则编辑与运行态规则命中追踪
- Rule Engine V2：稳定数据源/节点引用、历史规则迁移、失效规则诊断和业务语义摘要
- 编辑态与调试态规则总览，统一的 Mock/运行态表达式上下文
- HTTP、WebSocket、MQTT、静态数据源配置
- Mock 数据预览、运行态轮询和表达式模板
- 节点库管理和本地素材文件管理
- 可嵌入的 `TopologyRenderEngine` 运行态渲染组件

虚拟设备及参数点位绑定属于原平台业务，本项目不包含该能力。

本次抽离以 `foundation_platform` 提交 `5bea299` 为固定边界，不包含其后续 `a2e040e feat: topo editor add publish module` 中的拓扑发布编排、发布运行态和相关页面/API。

## 工程结构

```text
apps/web                    Vue 3 编辑器和运行态页面
apps/server                 Node.js API 服务
packages/topology-shared    前后端共享类型、schema 和规则工具
```

## 本地环境

- Node.js 22.13+
- pnpm 11+
- PostgreSQL，本机默认库名：`topo_editor`

环境变量：

```txt
apps/server/.env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/topo_editor?schema=public"
SERVER_PORT=3000
RUNTIME_API_BASE_URL="http://localhost:3000"

apps/web/.env
VITE_API_BASE_URL="http://localhost:3000"
```

请按实际数据库账号修改 `DATABASE_URL`。不要提交 `.env`。

## 安装与初始化

```bash
pnpm install
pnpm db:create
pnpm db:push
pnpm db:seed
```

`db:push` 会创建或同步节点类型、数据源、拓扑版本、操作日志和素材文件表。

## 开发

```bash
pnpm dev
```

也可以分别启动：

```bash
pnpm dev:server
pnpm dev:web
```

访问地址：

- 拓扑列表：http://localhost:5173/topologies
- 调试运行：http://localhost:5173/runtime-list
- 节点库管理：http://localhost:5173/node-types
- 素材文件：http://localhost:5173/files
- 后端健康检查：http://localhost:3000/api/health

## 验证

```bash
pnpm typecheck
pnpm test
pnpm build
```

测试覆盖共享 schema、端口归一化、表单默认值、节点标识、Rule Engine V2 迁移/健康检查、统一运行时上下文、规则条件编辑和服务端发布前校验。

## 运行态嵌入

`apps/web/src/topology/engine/TopologyRenderEngine.vue` 可作为独立运行态渲染组件使用，接收拓扑编码、元数据和请求参数，并负责节点类型加载、数据刷新、规则计算和事件转发。

运行态 HTTP 数据源支持相对路径。相对路径会基于后端 `RUNTIME_API_BASE_URL` 解析；生产部署时应配置为允许访问的业务 API 基地址。
