import { defineConfig } from 'vite'

// One self-contained server file (dagre inlined) so the plugin runs without npm install.
export default defineConfig({
  build: {
    ssr: 'server/server.js', outDir: 'app', emptyOutDir: true, target: 'node18', minify: false,
    rollupOptions: { output: { entryFileNames: 'server.mjs', format: 'es' } },
  },
  ssr: { noExternal: true, target: 'node' },
})
