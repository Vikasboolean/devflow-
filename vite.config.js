import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    {
      name: 'devflow-content-security-policy',
      transformIndexHtml() {
        const dev = mode === 'development'
        const script = dev ? "'self' 'unsafe-inline' 'unsafe-eval'" : "'self'"
        const connect = dev ? "'self' ws://localhost:5173 http://localhost:5173" : "'self'"
        const policy = [
          "default-src 'none'",
          `script-src ${script}`,
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob: https:",
          "font-src 'self' data:",
          `connect-src ${connect}`,
          "object-src 'none'",
          "base-uri 'none'",
          "frame-src 'none'",
          "form-action 'self'"
        ].join('; ')
        return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' }]
      }
    }
  ],
}))
