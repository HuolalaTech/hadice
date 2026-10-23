import React, { useCallback, useMemo } from 'react'
import { WebViewPagesPanel } from '@/components/network/WebViewPagesPanel'
import { networkCaptureAPI } from '@/lib/hdc-api/network-capture'
import type { HarmonyDebuggableApp } from '@/types/hdc'

interface HarmonyWebViewPanelProps {
  deviceId: string
  deviceLabel?: string
  app: HarmonyDebuggableApp | null
}

export function HarmonyWebViewPanel({
  deviceId,
  deviceLabel,
  app
}: HarmonyWebViewPanelProps): React.JSX.Element {
  const target = useMemo(
    () =>
      app
        ? {
            pid: app.pid,
            packageName: app.bundleName || app.processName || ''
          }
        : null,
    [app]
  )

  const listPages = useCallback(
    (id: string, pid: number, packageName: string) =>
      networkCaptureAPI.ListHarmonyWebViews(id, pid, packageName),
    []
  )

  return (
    <WebViewPagesPanel
      deviceId={deviceId}
      deviceLabel={deviceLabel}
      app={target}
      listPages={listPages}
    />
  )
}
