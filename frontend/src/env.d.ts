/// <reference types="vite/client" />

import type { HdcAPI } from './lib/hdc-api'

declare global {
  interface Window {
    hdc: HdcAPI
  }
}

export {}

