<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import ModuleNav from "../components/ModuleNav.vue";
import { listTopologies, type TopologySummary } from "../services/topologyApi";

const router = useRouter();
const loading = ref(false);
const topologies = ref<TopologySummary[]>([]);

async function load() {
  loading.value = true;
  try {
    topologies.value = await listTopologies();
  } finally {
    loading.value = false;
  }
}

async function openRuntime(row: TopologySummary) {
  await router.push(`/runtime/${row.id}`);
}

async function openEditor(row: TopologySummary) {
  await router.push(`/topologies/${row.id}/editor`);
}

onMounted(load);
</script>

<template>
  <main class="module-page">
    <header class="topbar">
      <span class="topbar-title">拓扑展示态列表</span>
      <ModuleNav />
      <span class="topbar-spacer" />
      <el-button @click="load">刷新</el-button>
    </header>

    <section class="module-body">
      <div class="module-card">
        <div class="module-card-header">
          <div>
            <div class="module-card-title">可展示拓扑</div>
            <div class="module-card-subtitle">打开运行态页面，按实时数据刷新文本、状态和规则结果</div>
          </div>
        </div>

        <el-table v-loading="loading" :data="topologies" height="calc(100vh - 138px)">
          <el-table-column prop="name" label="拓扑名称" min-width="220" />
          <el-table-column prop="id" label="编码" min-width="180" />
          <el-table-column prop="status" label="状态" width="110">
            <template #default="{ row }">
              <el-tag :type="row.status === 'published' ? 'success' : 'info'">{{ row.status }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="version" label="版本" width="100" />
          <el-table-column prop="updatedAt" label="更新时间" min-width="180" />
          <el-table-column label="操作" width="210" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openRuntime(row)">打开展示态</el-button>
              <el-button link @click="openEditor(row)">编辑</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </section>
  </main>
</template>
