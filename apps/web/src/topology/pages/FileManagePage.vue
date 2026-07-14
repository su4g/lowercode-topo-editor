<script setup lang="ts">
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, onMounted, ref } from "vue";
import ModuleNav from "../components/ModuleNav.vue";
import { uploadImageAsset } from "../services/assetApi";
import {
  deleteTopologyFile,
  listTopologyFiles,
  topologyFileUrl,
  type TopologyFile
} from "../services/fileApi";

const loading = ref(false);
const uploading = ref(false);
const keyword = ref("");
const files = ref<TopologyFile[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const fileInput = ref<HTMLInputElement | null>(null);

const emptyText = computed(() => keyword.value ? "没有匹配的素材" : "还没有拓扑素材");

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

async function load() {
  loading.value = true;
  try {
    const result = await listTopologyFiles({
      keyword: keyword.value.trim() || undefined,
      page: page.value,
      pageSize
    });
    files.value = result.rows;
    total.value = result.total;
  } finally {
    loading.value = false;
  }
}

async function handleUpload(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  uploading.value = true;
  try {
    await uploadImageAsset(file, { businessType: "topology-asset" });
    ElMessage.success("素材上传成功");
    page.value = 1;
    await load();
  } finally {
    uploading.value = false;
  }
}

async function removeFile(file: TopologyFile) {
  await ElMessageBox.confirm(`确定删除素材「${file.fileName}」吗？已保存拓扑中引用该素材的节点将无法显示图片。`, "删除素材", {
    confirmButtonText: "删除",
    cancelButtonText: "取消",
    type: "warning"
  });
  await deleteTopologyFile(file.id);
  ElMessage.success("素材已删除");
  await load();
}

function search() {
  page.value = 1;
  void load();
}

onMounted(load);
</script>

<template>
  <main class="module-page">
    <header class="topbar">
      <span class="topbar-title">素材文件</span>
      <ModuleNav />
      <span class="topbar-spacer" />
      <el-input v-model="keyword" placeholder="搜索文件名" clearable style="width: 220px" @keyup.enter="search" @clear="search" />
      <el-button @click="search">搜索</el-button>
      <el-button type="primary" :loading="uploading" @click="fileInput?.click()">上传图片</el-button>
      <input ref="fileInput" hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" @change="handleUpload" />
    </header>

    <section class="module-body">
      <div class="module-card">
        <div class="module-card-header">
          <div>
            <div class="module-card-title">拓扑素材库</div>
            <div class="module-card-subtitle">统一查看和清理节点图标、状态图片与背景图</div>
          </div>
        </div>
        <el-table v-loading="loading" :data="files" :empty-text="emptyText" height="calc(100vh - 190px)">
          <el-table-column label="预览" width="90">
            <template #default="{ row }">
              <el-image :src="topologyFileUrl(row)" fit="contain" style="width: 48px; height: 48px" :preview-src-list="[topologyFileUrl(row)]" preview-teleported />
            </template>
          </el-table-column>
          <el-table-column prop="fileName" label="文件名" min-width="260" />
          <el-table-column prop="contentType" label="类型" min-width="150" />
          <el-table-column label="大小" width="110">
            <template #default="{ row }">{{ formatSize(row.fileSize) }}</template>
          </el-table-column>
          <el-table-column prop="createdAt" label="上传时间" min-width="190" />
          <el-table-column label="操作" width="150" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" tag="a" :href="topologyFileUrl(row)" :download="row.fileName">下载</el-button>
              <el-button link type="danger" @click="removeFile(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-pagination
          v-model:current-page="page"
          :page-size="pageSize"
          :total="total"
          layout="total, prev, pager, next"
          style="justify-content: flex-end; margin-top: 16px"
          @current-change="load"
        />
      </div>
    </section>
  </main>
</template>
