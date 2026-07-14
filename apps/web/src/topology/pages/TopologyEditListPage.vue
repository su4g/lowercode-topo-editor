<script setup lang="ts">
import type { TopologyData } from "@topo-editor/topology-shared";
import { ElMessage, ElMessageBox } from "element-plus";
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import ModuleNav from "../components/ModuleNav.vue";
import { createTopology, deleteTopology, listTopologies, type TopologySummary } from "../services/topologyApi";

const router = useRouter();
const loading = ref(false);
const topologies = ref<TopologySummary[]>([]);

function createEmptyTopology(): TopologyData {
  const now = Date.now();
  return {
    id: `topology_${now}`,
    name: `新建拓扑 ${new Date(now).toLocaleString()}`,
    version: "1.0.0",
    nodes: [],
    links: []
  };
}

async function load() {
  loading.value = true;
  try {
    topologies.value = await listTopologies();
  } finally {
    loading.value = false;
  }
}

async function createNew() {
  const topology = createEmptyTopology();
  const saved = await createTopology(topology);
  ElMessage.success("拓扑已创建");
  await router.push(`/topologies/${saved.id}/editor`);
}

async function openEditor(row: TopologySummary) {
  await router.push(`/topologies/${row.id}/editor`);
}

async function openRuntime(row: TopologySummary) {
  await router.push(`/runtime/${row.id}`);
}

async function confirmCreate() {
  await ElMessageBox.confirm("将创建一张空白拓扑并进入编辑器。", "新建拓扑", {
    confirmButtonText: "创建",
    cancelButtonText: "取消",
    type: "info"
  });
  await createNew();
}

async function removeTopology(row: TopologySummary) {
  await ElMessageBox.confirm(`确定删除拓扑「${row.name}」吗？该操作会同时删除所有版本。`, "删除拓扑", {
    confirmButtonText: "删除",
    cancelButtonText: "取消",
    type: "warning"
  });
  await deleteTopology(row.id);
  ElMessage.success("拓扑已删除");
  await load();
}

onMounted(load);
</script>

<template>
  <main class="module-page">
    <header class="topbar">
      <span class="topbar-title">拓扑编辑</span>
      <ModuleNav />
      <span class="topbar-spacer" />
      <el-button type="primary" @click="confirmCreate">新建拓扑</el-button>
      <el-button @click="load">刷新</el-button>
    </header>

    <section class="module-body">
      <div class="module-card">
        <div class="module-card-header">
          <div>
            <div class="module-card-title">拓扑配置列表</div>
            <div class="module-card-subtitle">进入编辑器维护节点、连线、分组、数据绑定和运行规则</div>
          </div>
        </div>

        <el-table v-loading="loading" :data="topologies" height="calc(100vh - 138px)">
          <el-table-column prop="name" label="拓扑名称" min-width="220" />
          <el-table-column prop="id" label="编码" min-width="180" />
          <el-table-column prop="status" label="状态" width="110" />
          <el-table-column prop="version" label="版本" width="100" />
          <el-table-column prop="updatedAt" label="更新时间" min-width="180" />
          <el-table-column label="操作" width="240" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openEditor(row)">编辑</el-button>
              <el-button link @click="openRuntime(row)">预览</el-button>
              <el-button link type="danger" @click="removeTopology(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </section>
  </main>
</template>
