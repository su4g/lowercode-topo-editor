# 09-后端业务点、表结构与数据库脚本

## 后端现状

当前后端是轻量 Fastify + Prisma 实现，业务逻辑主要写在 `apps/server/src/modules/*` 的路由处理函数里，暂未拆分独立 service 层。

后端入口：

- `apps/server/src/main.ts`

主要模块：

- `node-types.ts`：节点类型管理。
- `data-sources.ts`：数据源管理与预览。
- `topologies.ts`：拓扑保存、读取、版本列表、发布。
- `runtime.ts`：运行态数据源聚合查询。
- `assets.ts`：图片资源上传与访问。

共享类型和 schema：

- `packages/topology-shared/src/types/*`
- `packages/topology-shared/src/schemas/topology.ts`

## 后端业务点

### 健康检查

接口：

- `GET /api/health`

业务点：

- 返回服务名和当前时间。
- 不访问数据库。

### 节点类型管理

接口：

- `GET /api/topology/node-types`
- `POST /api/topology/node-types`
- `DELETE /api/topology/node-types/:id`

业务点：

- 查询时只返回 `enabled = true` 的节点类型。
- 按 `sortNo asc`、`createdAt asc` 排序。
- 新增或编辑使用 `typeCode` 做 upsert。
- 未传端口时，接口会使用共享包里的默认四方向端口。
- 删除是软删除，将 `enabled` 更新为 `false`。

当前未实现：

- 没有单独的 `PUT /api/topology/node-types/:id`。
- 没有校验节点类型是否已经被拓扑版本引用。
- 没有使用 Zod schema 校验节点类型配置完整性。
- 没有操作日志。

### 数据源管理

接口：

- `GET /api/topology/data-sources`
- `POST /api/topology/data-sources`
- `POST /api/topology/data-sources/preview`

业务点：

- 查询时只返回 `enabled = true` 的数据源。
- 新增或编辑使用 `sourceCode` 做 upsert。
- 未传 `enabled` 时默认启用。
- 预览接口只读取数据源配置里的 `configJson.data`。
- 预览接口支持按 `fields` 筛选返回字段。

当前未实现：

- 没有单独的 `PUT /api/topology/data-sources/:id`。
- 没有 `DELETE /api/topology/data-sources/:id`。
- 预览暂不实际请求 HTTP、WebSocket、MQTT。
- HTTP 数据源没有白名单、超时、鉴权、错误隔离。
- 没有操作日志。

### 拓扑管理

接口：

- `GET /api/topologies`
- `GET /api/topologies/:id`
- `POST /api/topologies`
- `PUT /api/topologies/:id`
- `GET /api/topologies/:id/versions`
- `POST /api/topologies/:id/publish`

业务点：

- 列表接口返回拓扑主表信息和最新版本号。
- 详情接口返回最新创建的拓扑版本 `configJson`。
- 新建拓扑时状态固定为 `draft`。
- 保存拓扑时使用 `topologyDataSchema` 做结构校验。
- 更新拓扑使用 `topologyCode` upsert 主表，并新增一条草稿版本。
- 版本列表按 `createdAt desc` 返回。
- 发布时只检查拓扑存在且存在至少一个版本。
- 发布成功后：
  - 最新版本 `published = true`。
  - 拓扑主表 `status = published`。
  - 拓扑主表 `currentVersionId = version.id`。

当前未实现：

- 没有保存前轻校验：
  - 节点 key 唯一。
  - 连线 key 唯一。
  - 连线起点和终点存在。
  - 端口存在。
  - 节点类型存在。
  - 分组引用存在。
  - 动态表单必填字段完整。
- 没有发布前强校验：
  - 连接规则。
  - 数据源可访问。
  - 映射字段存在。
  - 模板变量存在映射。
  - 规则字段存在。
  - 不存在循环依赖规则。
  - 关键设备不能孤立。
- 发布版本仍可能继续被后续逻辑间接覆盖状态。
- 没有按指定版本读取拓扑。
- 没有操作日志。
- 没有权限判断。

### 运行态聚合查询

接口：

- `POST /api/topologies/:id/runtime/query`

请求核心字段：

- `sourceIds`：要查询的数据源编码。
- `fields`：要返回的字段。
- `preview`：是否使用 mock/static 预览数据。
- `metaData`、`parentParams`：模板表达式上下文。
- `sources`：请求内嵌数据源配置。

业务点：

- 数据库数据源只查询 `enabled = true`。
- 请求体里的内嵌 `sources` 优先级高于数据库配置。
- `preview = true` 时优先返回 `mockData`，其次返回 `data`。
- `type = static` 时返回 `data`，没有则返回 `mockData`。
- `type = http` 时会按配置发起 HTTP 请求。
- HTTP 请求支持模板变量替换：
  - URL
  - headers
  - query
  - body
- 字段筛选支持点路径。
- 每个数据源响应都会补充：
  - `_quality`
  - `_timestamp`

当前未实现：

- 路径里的拓扑 ID 暂未参与查询约束。
- 没有运行态版本读取。
- HTTP 请求没有超时和错误兜底。
- 某个数据源失败可能影响整个聚合接口。
- WebSocket、MQTT 类型暂回退到静态数据。

### 图片资源

接口：

- `POST /api/topology/assets`
- `GET /uploads/:fileName`

业务点：

- 支持格式：
  - png
  - jpg/jpeg
  - webp
  - gif
  - svg
- 上传内容必须是 base64 dataUrl。
- 文件最大 5MB。
- SVG 必须包含 `<svg`。
- SVG 禁止 `<script`。
- SVG 禁止 `onxxx=` 事件属性。
- 文件名会过滤为安全字符。
- 文件保存在后端运行目录的 `uploads` 下。

当前未实现：

- 没有用户、权限和租户隔离。
- 没有文件去重。
- 没有删除接口。
- 读取文件不存在时没有业务化错误处理。

## 数据库表结构

数据库使用 PostgreSQL，ORM 使用 Prisma。

当前 Prisma schema：

- `apps/server/prisma/schema.prisma`

当前没有 migrations 目录，项目通过 `prisma db push` 同步结构。

### topology_node_type

用途：节点类型定义表。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | `TEXT` | 主键 | Prisma cuid |
| `type_code` | `VARCHAR(64)` | 唯一、非空 | 节点类型编码 |
| `type_name` | `VARCHAR(128)` | 非空 | 节点类型名称 |
| `category` | `VARCHAR(32)` | 非空 | 分类：equipment/container/annotation/control |
| `template_code` | `VARCHAR(64)` | 非空 | 前端 GoJS 模板编码 |
| `icon` | `VARCHAR(512)` | 可空 | 图标或图片引用 |
| `enabled` | `BOOLEAN` | 默认 true | 是否启用 |
| `sort_no` | `INTEGER` | 默认 0 | 排序号 |
| `config_json` | `JSONB` | 非空 | 端口、表单、绑定字段、动作等配置 |
| `created_at` | `TIMESTAMP(3)` | 默认当前时间 | 创建时间 |
| `updated_at` | `TIMESTAMP(3)` | 非空 | 更新时间，Prisma 写入时维护 |

### topology_data_source

用途：数据源定义表。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | `TEXT` | 主键 | Prisma cuid |
| `source_code` | `VARCHAR(64)` | 唯一、非空 | 数据源编码 |
| `source_name` | `VARCHAR(128)` | 非空 | 数据源名称 |
| `source_type` | `VARCHAR(32)` | 非空 | http/websocket/mqtt/static |
| `enabled` | `BOOLEAN` | 默认 true | 是否启用 |
| `config_json` | `JSONB` | 非空 | URL、method、data、mockData、headers、query、body 等 |
| `created_at` | `TIMESTAMP(3)` | 默认当前时间 | 创建时间 |
| `updated_at` | `TIMESTAMP(3)` | 非空 | 更新时间，Prisma 写入时维护 |

### topology

用途：拓扑主表，保存检索字段和当前发布版本指针。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | `TEXT` | 主键 | Prisma cuid |
| `topology_code` | `VARCHAR(64)` | 唯一、非空 | 拓扑编码 |
| `topology_name` | `VARCHAR(128)` | 非空 | 拓扑名称 |
| `status` | `VARCHAR(32)` | 非空 | draft/published/archived |
| `current_version_id` | `TEXT` | 可空 | 当前发布版本 ID |
| `remark` | `VARCHAR(512)` | 可空 | 备注 |
| `created_at` | `TIMESTAMP(3)` | 默认当前时间 | 创建时间 |
| `updated_at` | `TIMESTAMP(3)` | 非空 | 更新时间，Prisma 写入时维护 |

### topology_version

用途：拓扑版本表，保存完整拓扑 JSON。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | `TEXT` | 主键 | Prisma cuid |
| `topology_id` | `TEXT` | 外键、非空 | 关联 `topology.id` |
| `version_no` | `VARCHAR(32)` | 非空 | 版本号 |
| `version_name` | `VARCHAR(128)` | 可空 | 版本名称 |
| `config_json` | `JSONB` | 非空 | 完整 `TopologyData` |
| `published` | `BOOLEAN` | 默认 false | 是否发布 |
| `created_by` | `VARCHAR(64)` | 可空 | 创建人 |
| `created_at` | `TIMESTAMP(3)` | 默认当前时间 | 创建时间 |

索引和约束：

- `topology_id` 普通索引。
- 外键 `topology_id -> topology.id`。
- 删除拓扑时级联删除版本。

### topology_operation_log

用途：操作日志表。当前表已定义，但业务代码暂未写入。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | `TEXT` | 主键 | Prisma cuid |
| `topology_id` | `TEXT` | 可空 | 拓扑 ID |
| `operation_type` | `VARCHAR(64)` | 非空 | 操作类型 |
| `operation_desc` | `VARCHAR(512)` | 可空 | 操作描述 |
| `before_json` | `JSONB` | 可空 | 操作前 JSON |
| `after_json` | `JSONB` | 可空 | 操作后 JSON |
| `operator` | `VARCHAR(64)` | 可空 | 操作人 |
| `created_at` | `TIMESTAMP(3)` | 默认当前时间 | 创建时间 |

索引：

- `topology_id` 普通索引。

## 数据库脚本

### 项目内脚本命令

根目录 `package.json`：

```bash
pnpm db:create
pnpm db:push
pnpm db:seed
```

服务包 `apps/server/package.json`：

```bash
pnpm --filter @topo-editor/server prisma:generate
pnpm --filter @topo-editor/server prisma:push
pnpm --filter @topo-editor/server seed
```

### 推荐初始化流程

```bash
pnpm install
pnpm db:create
pnpm --filter @topo-editor/server prisma:generate
pnpm db:push
pnpm db:seed
```

### 建表 SQL

建表 SQL 已整理到：

- `apps/server/prisma/init.sql`

该脚本由以下命令基于当前 Prisma schema 生成：

```bash
pnpm --filter @topo-editor/server exec prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
```

注意：

- `id` 字段的 cuid 默认值由 Prisma Client 在写入时生成，DDL 中不会生成数据库侧默认值。
- `updated_at` 由 Prisma 的 `@updatedAt` 在写入时维护，DDL 中没有数据库触发器。
- 如果绕过 Prisma 直接执行 INSERT，需要自行提供 `id` 和 `updated_at`。

### 种子数据

种子脚本：

- `apps/server/src/seed.ts`

包含：

- 4 个默认节点类型：
  - `breaker`：断路器。
  - `lab`：实验室容器。
  - `text`：文本。
  - `button`：按钮。
- 2 个静态数据源：
  - `device_1001`
  - `lab_001`
- 1 个示例拓扑：
  - `topology_001`

执行：

```bash
pnpm db:seed
```

