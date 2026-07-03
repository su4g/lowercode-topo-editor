import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue() as never],
  server: {
    port: 5173
  }
});
