export interface LayoutBounds {
  left: number
  top: number
  right: number
  bottom: number
}

export interface LayoutNode {
  id: string
  type: string
  text?: string
  resourceId?: string
  desc?: string
  clickable?: boolean
  bounds: LayoutBounds
  children?: LayoutNode[]
}

export interface LayoutPageInfo {
  name: string
  label?: string
}

export interface LayoutDumpResult {
  platform: string
  packageName?: string
  pageName?: string
  nodeCount: number
  root: LayoutNode | null
  screenshotB64?: string
  screenshotMime?: string
  width?: number
  height?: number
  rawHint?: string
}

export interface LayoutAppRow {
  packageName: string
  appName: string
  icon?: string
}
