# Topo Editor

Vue 3 + Node.js + PostgreSQL 的 GoJS 拓扑编辑器工程。

## 本地环境

- Node.js 20+
- pnpm 11+
- PostgreSQL，本机库名：`topo_editor`

环境变量：

```txt
apps/server/.env
DATABASE_URL="postgresql://zhoutong@localhost:5432/topo_editor?schema=public"
SERVER_PORT=3000

apps/web/.env
VITE_API_BASE_URL="http://localhost:3000"
```

如果本机 PostgreSQL 需要密码，修改 `apps/server/.env` 中的 `DATABASE_URL` 即可。

## 常用命令

```bash
pnpm install
pnpm db:create
pnpm db:push
pnpm db:seed
pnpm typecheck
pnpm build
pnpm dev:server
pnpm dev:web
```

## 访问地址

- 前端编辑器：http://localhost:5173/editor
- 运行态页面：http://localhost:5173/runtime
- 后端健康检查：http://localhost:3000/api/health

## 当前已完成

- monorepo 工程骨架。
- 共享拓扑类型与基础 schema。
- Fastify + Prisma 后端。
- PostgreSQL 表结构。
- 节点类型、数据源、拓扑、运行态聚合接口。
- seed 数据：断路器、实验室、文本节点和示例拓扑。
- Vue 3 前端基础页面。
- GoJS 画布基础渲染。
- 节点库、属性面板、保存拓扑、运行态轮询文本刷新。
