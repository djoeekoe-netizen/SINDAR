import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // مهم لـ Capacitor: مسارات نسبية داخل التطبيق
  base: "./",
});
