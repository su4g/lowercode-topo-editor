# 02-后端服务落地方案

## 目标

用 Node.js 提供拓扑配置、节点类型、数据源、版本、运行态聚合和校验发布能力。

推荐框架：

- 首选：NestJS + Prisma + PostgreSQL/MySQL。
- 轻量版：Fastify + Prisma。

## 后端目录

```txt
apps/server/src/
  modules/
    node-types/
    data-sources/
    topologies/
    topology-versions/
    runtime/
    validation/
    operation-logs/
  common/
    errors/
    guards/
    pipes/
    response.ts
  prisma/
    schema.prisma
```

## 数据表

### `topology_node_type`

用途：保存节点类型定义。

关键字段：

| 字段 | 说明 |
|---|---|
| `type_code` | 节点类型编码，对应 `NodeTypeDefinition.id` |
| `type_name` | 名称 |
| `category` | `equipment/container/annotation` |
| `template_code` | GoJS 模板编码 |
| `config_json` | 端口、动态表单、可绑定字段、连接能力 |
| `enabled` | 是否启用 |

### `topology_data_source`

用途：保存数据源定义。

关键字段：

| 字段 | 说明 |
|---|---|
| `source_code` | 数据源编码 |
| `source_type` | `http/websocket/mqtt/static` |
| `config_json` | URL、method、interval、topic、responseMapping |
| `enabled` | 是否启用 |

### `topology`

用途：拓扑主表，只放检索字段和当前版本指针。

关键字段：

| 字段 | 说明 |
|---|---|
| `topology_code` | 拓扑编码 |
| `topology_name` | 拓扑名称 |
| `status` | `draft/published/archived` |
| `current_version_id` | 当前发布或编辑版本 |

### `topology_version`

用途：保存完整拓扑 JSON 和版本。

关键字段：

| 字段 | 说明 |
|---|---|
| `topology_id` | 拓扑 ID |
| `version_no` | 版本号 |
| `config_json` | 完整 `TopologyData` |
| `published` | 是否发布 |
| `created_by` | 创建人 |

### `topology_operation_log`

用途：记录关键操作。

记录操作：

- 新增、编辑、删除节点类型。
- 保存拓扑。
- 发布拓扑。
- 外部运行态控制。
- 数据源配置变更。

## API 设计

### 节点类型

```txt
GET    /api/topology/node-types
POST   /api/topology/node-types
PUT    /api/topology/node-types/:id
DELETE /api/topology/node-types/:id
```

落地步骤：

1. 定义 DTO。
2. 使用共享 schema 校验 `config_json`。
3. 新增唯一性校验：`type_code` 不重复。
4. 删除前检查是否被拓扑版本引用。

验收：

- 可新增断路器、实验室、文本节点。
- 禁用节点类型后前端 Palette 不再展示。
- 删除被使用的节点类型时返回业务错误。

### 数据源

```txt
GET    /api/topology/data-sources
POST   /api/topology/data-sources
PUT    /api/topology/data-sources/:id
DELETE /api/topology/data-sources/:id
POST   /api/topology/data-sources/preview
```

第一版策略：

- `static` 数据源直接读取 `config_json.data`。
- `http` 数据源只允许访问后端白名单域名或内部服务。
- `preview` 返回字段样例，用于前端配置映射。

验收：

- 可预览 `device_1001` 的 `voltage/current/breakerState`。
- 禁用数据源后运行态聚合不再读取。

### 拓扑配置

```txt
GET  /api/topologies
GET  /api/topologies/:id
POST /api/topologies
PUT  /api/topologies/:id
POST /api/topologies/:id/versions
GET  /api/topologies/:id/versions
POST /api/topologies/:id/publish
```

保存流程：

1. 接收 `TopologyData`。
2. 做保存前轻校验。
3. 保存为新版本或覆盖草稿版本。
4. 写操作日志。
5. 返回版本信息。

发布流程：

1. 读取待发布版本。
2. 做发布前强校验。
3. 校验通过后设置 `published = true`。
4. 更新 `topology.current_version_id`。
5. 写操作日志。

验收：

- 保存不合法连线时返回校验报告。
- 发布后可按版本读取。
- 发布版本不会被直接覆盖。

### 运行态

```txt
GET  /api/topologies/:id/runtime
POST /api/topologies/:id/runtime/query
```

聚合请求：

```json
{
  "sourceIds": ["device_1001", "device_1002"],
  "fields": ["breakerState", "voltage", "current"]
}
```

聚合响应：

```json
{
  "code": 0,
  "data": {
    "device_1001": {
      "breakerState": "closed",
      "voltage": 220,
      "current": 12.5,
      "_quality": {
        "voltage": "good"
      },
      "_timestamp": 1782912000000
    }
  }
}
```

第一版实现：

- 使用 mock provider 或 static provider。
- 每个 provider 实现统一接口：`query(sourceIds, fields)`。
- 第二版再接入 HTTP/WebSocket/MQTT。

验收：

- 前端运行态页面可批量查询所需 sourceId 和 fields。
- 不同数据源异常时不会导致整体接口失败，可返回字段质量信息。

## 服务实现顺序

1. 建库和迁移。
2. 节点类型接口。
3. 拓扑保存读取接口。
4. 数据源与预览接口。
5. 运行态聚合 mock。
6. 校验和发布。
7. 操作日志。
8. 权限。

## 后端测试

至少覆盖：

- 节点类型 CRUD。
- 拓扑保存 schema 校验。
- 发布前强校验。
- 运行态聚合接口。
- 删除被引用节点类型的失败场景。
