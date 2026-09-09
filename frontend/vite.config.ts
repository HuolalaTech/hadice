import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Parse root `.env.ci` (gitignored). Existing process env wins.
 */
function loadRootCIEnv(): Record<string, string> {
  const envPath = resolve(__dirname, '../.env.ci')
  const parsed: Record<string, string> = {}
  if (!existsSync(envPath)) {
    console.warn('[vite] .env.ci not found at project root; private VITE_* vars disabled')
    return parsed
  }

  const text = readFileSync(envPath, 'utf8')
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const normalized = line.startsWith('export ') ? line.slice(7).trim() : line
    const eq = normalized.indexOf('=')
    if (eq <= 0) continue
    const key = normalized.slice(0, eq).trim()
    let value = normalized.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!key) continue
    parsed[key] = value
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
  return parsed
}

const ciEnv = loadRootCIEnv()

// Explicitly inject VITE_* into the client bundle (Vite does not load `.env.ci` by default).
const viteDefines = Object.fromEntries(
  Object.entries(ciEnv)
    .filter(([key]) => key.startsWith('VITE_'))
    .map(([key, value]) => [
      `import.meta.env.${key}`,
      JSON.stringify(process.env[key] ?? value ?? '')
    ])
)

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: viteDefines,
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@wails': resolve(__dirname, './wailsjs')
    }
  }
})
