import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Tauri's devPath is fixed at http://localhost:5173. Pin Vite to that port and
  // fail loudly (strictPort) instead of silently moving to 5174 — otherwise the
  // Tauri dev window loads nothing and just sits blank.
  server: {
    port: 5173,
    strictPort: true,
  },
})
