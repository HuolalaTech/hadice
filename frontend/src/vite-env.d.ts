/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_POSTHOG_KEY?: string
  readonly VITE_POSTHOG_HOST?: string
  readonly VITE_UPDATE_CHECK_URL?: string
  readonly VITE_DOCS_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
