import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// Local development: the website runs on 5173 and forwards /api to the server on 5000.
// In production Netlify does the same forwarding (public/_redirects).
export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5174, strictPort: true, proxy: { '/api': 'http://localhost:5001' } },
})
