<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";

const route = useRoute();
const router = useRouter();

const items = [
  { label: "拓扑编辑", path: "/topologies", match: (path: string) => path === "/topologies" || path.startsWith("/topologies/") },
  { label: "调试运行", path: "/runtime-list", match: (path: string) => path === "/runtime-list" || path.startsWith("/runtime/") },
  { label: "节点库管理", path: "/node-types", match: (path: string) => path === "/node-types" },
  { label: "素材文件", path: "/files", match: (path: string) => path === "/files" }
];

const activePath = computed(() => route.path);
</script>

<template>
  <nav class="module-nav" aria-label="模块导航">
    <button
      v-for="item in items"
      :key="item.path"
      class="module-nav-item"
      :class="{ active: item.match(activePath) }"
      type="button"
      @click="router.push(item.path)"
    >
      {{ item.label }}
    </button>
  </nav>
</template>
