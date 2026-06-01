import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// https://vitejs.com/config/
export default defineConfig({
  plugins: [vue()],

  clearScreen: false,

  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
