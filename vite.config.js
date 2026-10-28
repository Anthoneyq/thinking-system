import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// VITE_REPLAY=1 builds the public demo (one run, played back) from demo/ into demo-dist/.
const replay = !!process.env.VITE_REPLAY

export default defineConfig({
  plugins: [react()],
  ...(replay ? { publicDir: 'demo', build: { outDir: 'demo-dist' } } : {}),
  server: { proxy: { '/api': 'http://localhost:4477' } },
})
