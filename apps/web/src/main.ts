import ElementPlus from "element-plus";
import "element-plus/dist/index.css";
import { createPinia } from "pinia";
import { createApp } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import App from "./App.vue";
import TopologyEditorPage from "./topology/pages/TopologyEditorPage.vue";
import TopologyEditListPage from "./topology/pages/TopologyEditListPage.vue";
import TopologyRuntimeListPage from "./topology/pages/TopologyRuntimeListPage.vue";
import TopologyRuntimePage from "./topology/pages/TopologyRuntimePage.vue";
import NodeTypeManagePage from "./topology/pages/NodeTypeManagePage.vue";
import "./styles.css";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/topologies" },
    { path: "/topologies", component: TopologyEditListPage },
    { path: "/topologies/:id/editor", component: TopologyEditorPage },
    { path: "/runtime-list", component: TopologyRuntimeListPage },
    { path: "/runtime/:id", component: TopologyRuntimePage },
    { path: "/node-types", component: NodeTypeManagePage },
    { path: "/editor", redirect: "/topologies/topology_001/editor" },
    { path: "/runtime", redirect: "/runtime-list" }
  ]
});

createApp(App)
  .use(createPinia())
  .use(router)
  .use(ElementPlus)
  .mount("#app");
