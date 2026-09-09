import { useState, useCallback, useEffect, useRef } from 'react'
import { isHdcAvailable } from '@/lib/hdc'
import { ScrcpyPlayer } from '@/lib/video/ScrcpyPlayer'
import type { VideoCodecInfo } from '@/lib/video/types'
import { captureEvent } from '@/lib/posthog'

const MAX_PENDING_FRAMES = 200

type PendingAndroidFrame = {
  data: string
  isKeyframe: boolean
  isConfig: boolean
  pts: number
}

export function useScreenMirror(
  selectedDevice: { connectKey: string; platform?: string } | null,
  videoQuality: '0.2' | '0.3' | '0.4' | '0.5' | '0.6' | '0.7' | '0.8' | '0.9'
) {
  const [isStreaming, setIsStreaming] = useState(false)
  const [isStreamingLoading, setIsStreamingLoading] = useState(false)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [displaySize, setDisplaySize] = useState<{ width: number; height: number } | null>(null)
  const [isH264, setIsH264] = useState(false)

  const frameUnsubscribeRef = useRef<(() => void) | null>(null)
  const errorUnsubscribeRef = useRef<(() => void) | null>(null)
  const codecUnsubscribeRef = useRef<(() => void) | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const playerRef = useRef<ScrcpyPlayer | null>(null)
  const previousDeviceKeyRef = useRef<string | null>(null)
  const isStreamingRef = useRef(false)
  const pendingFramesRef = useRef<PendingAndroidFrame[]>([])

  const isAndroid = selectedDevice?.platform === 'android'

  const cleanupStreaming = useCallback((destroyPlayer: boolean = false) => {
    console.log('[useScreenMirror] cleanupStreaming called, destroyPlayer:', destroyPlayer)
    pendingFramesRef.current = []
    setIsH264(false)
    if (frameUnsubscribeRef.current) {
      frameUnsubscribeRef.current()
      frameUnsubscribeRef.current = null
    }
    if (errorUnsubscribeRef.current) {
      errorUnsubscribeRef.current()
      errorUnsubscribeRef.current = null
    }
    if (codecUnsubscribeRef.current) {
      codecUnsubscribeRef.current()
      codecUnsubscribeRef.current = null
    }
    if (destroyPlayer && playerRef.current) {
      console.log('[useScreenMirror] Destroying player in cleanupStreaming')
      playerRef.current.destroy()
      playerRef.current = null
    }
  }, [])

  const handleStartStreaming = useCallback(async () => {
    if (!selectedDevice || !isHdcAvailable()) {
      setStreamError('设备未选择或 HDC API 不可用')
      return
    }

    setIsStreamingLoading(true)
    setStreamError(null)
    cleanupStreaming(true)

    try {
      const scale = parseFloat(videoQuality)

      if (canvasRef.current) {
        console.log('[useScreenMirror] Setting up H.264 event listeners, canvas:', !!canvasRef.current)
        pendingFramesRef.current = []

        codecUnsubscribeRef.current = window.hdc.screenMirror.onCodec(
          (deviceSn: string, codecInfo: VideoCodecInfo) => {
            console.log('[useScreenMirror] onCodec callback fired, deviceSn:', deviceSn, 'codecInfo:', codecInfo, 'selectedDevice:', selectedDevice.connectKey)
            if (deviceSn === selectedDevice.connectKey) {
              setIsH264(true)
              console.log('[useScreenMirror] Device match! Creating player, canvasRef:', !!canvasRef.current)
              if (canvasRef.current && !playerRef.current) {
                playerRef.current = new ScrcpyPlayer(canvasRef.current)
                console.log('[useScreenMirror] Player created')
              }
              if (playerRef.current) {
                playerRef.current.init(codecInfo)
                console.log('[useScreenMirror] Player initialized')
                const pending = pendingFramesRef.current
                for (const f of pending) {
                  playerRef.current.feedFrame(f.data, f.isKeyframe, f.isConfig, f.pts)
                }
                pendingFramesRef.current = []
              }
              setDisplaySize({ width: codecInfo.width, height: codecInfo.height })
            } else {
              console.log('[useScreenMirror] Device mismatch, ignoring')
            }
          }
        )

        frameUnsubscribeRef.current = window.hdc.screenMirror.onFrame(
          (deviceSn: string, frameDataBase64: string, isKeyframe: boolean, isConfig: boolean, pts: number, transport?: string) => {
            if (deviceSn === selectedDevice.connectKey) {
              if (transport !== 'h264' && !isAndroid) {
                if (imgRef.current) {
                  imgRef.current.src = `data:image/jpeg;base64,${frameDataBase64}`
                }
                return
              }
              setIsH264(true)
              if (!playerRef.current) {
                const q = pendingFramesRef.current
                if (q.length >= MAX_PENDING_FRAMES) {
                  q.shift()
                }
                q.push({
                  data: frameDataBase64,
                  isKeyframe: !!isKeyframe,
                  isConfig: !!isConfig,
                  pts: pts ?? 0
                })
                return
              }
              if (!playerRef.current.isConfigured()) {
                console.warn('[useScreenMirror] Frame received but player not configured')
              }
              playerRef.current.feedFrame(frameDataBase64, isKeyframe, isConfig, pts)
            }
          }
        )
      } else {
        frameUnsubscribeRef.current = window.hdc.screenMirror.onFrame(
          (deviceSn: string, frameDataBase64: string) => {
            if (deviceSn === selectedDevice.connectKey && imgRef.current) {
              try {
                const dataUrl = `data:image/jpeg;base64,${frameDataBase64}`
                imgRef.current.src = dataUrl
              } catch {
                // 静默处理错误
              }
            }
          }
        )
      }

      errorUnsubscribeRef.current = window.hdc.screenMirror.onError(
        (deviceSn: string, errorMsg: string) => {
          if (deviceSn === selectedDevice.connectKey) {
            setStreamError(errorMsg)
            setIsStreaming(false)
            isStreamingRef.current = false
            setIsStreamingLoading(false)
            cleanupStreaming(true)
          }
        }
      )

      const result = await window.hdc.screenMirror.start(selectedDevice.connectKey, scale)
      if (!result.success) {
        setStreamError(result.error || '开始投屏失败')
        setIsStreamingLoading(false)
        cleanupStreaming(true)
        return
      }

      setIsStreaming(true)
      isStreamingRef.current = true
      setIsH264(result.transport === 'h264' || isAndroid)
      captureEvent('screen mirror started', { video_quality: videoQuality, platform: selectedDevice.platform || 'harmony' })

      const sizeResult = await window.hdc.screenMirror.getDisplaySize(selectedDevice.connectKey)
      if (sizeResult.success && sizeResult.size) {
        setDisplaySize(sizeResult.size)
      }
    } catch (err) {
      setStreamError(err instanceof Error ? err.message : '开始投屏失败')
      setIsStreaming(false)
      isStreamingRef.current = false
      cleanupStreaming(true)
    } finally {
      setIsStreamingLoading(false)
    }
  }, [selectedDevice, videoQuality, cleanupStreaming, isAndroid])

  const handleStopStreaming = useCallback(async () => {
    if (!selectedDevice || !isHdcAvailable()) {
      return
    }

    setIsStreamingLoading(true)
    isStreamingRef.current = false
    cleanupStreaming(true)

    try {
      await window.hdc.screenMirror.stop(selectedDevice.connectKey)
      setIsStreaming(false)
      setStreamError(null)
      captureEvent('screen mirror stopped', { platform: selectedDevice.platform || 'harmony' })
    } catch (err) {
      setStreamError(err instanceof Error ? err.message : '停止投屏失败')
    } finally {
      setIsStreamingLoading(false)
    }
  }, [selectedDevice, cleanupStreaming])

  const handleControlAction = useCallback(
    async (action: string) => {
      if (!selectedDevice || !isHdcAvailable() || !isStreaming) {
        return
      }

      try {
        let result: { success: boolean; error?: string } | undefined

        switch (action) {
          case 'back':
            result = await window.hdc.screenMirror.pressBack(selectedDevice.connectKey)
            break
          case 'home':
            result = await window.hdc.screenMirror.pressHome(selectedDevice.connectKey)
            break
          case 'volumeUp':
            result = await window.hdc.screenMirror.pressKey(selectedDevice.connectKey, 16)
            break
          case 'volumeDown':
            result = await window.hdc.screenMirror.pressKey(selectedDevice.connectKey, 17)
            break
          case 'power':
            result = await window.hdc.screenMirror.pressKey(selectedDevice.connectKey, 18)
            break
        }

        if (result && !result.success && result.error) {
          setStreamError(`操作失败: ${result.error}`)
          setTimeout(() => {
            setStreamError(null)
          }, 3000)
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : '未知错误'
        setStreamError(`操作异常: ${errorMsg}`)
        setTimeout(() => {
          setStreamError(null)
        }, 3000)
      }
    },
    [selectedDevice, isStreaming, displaySize]
  )

  useEffect(() => {
    const currentDeviceKey = selectedDevice?.connectKey || null

    if (
      previousDeviceKeyRef.current &&
      previousDeviceKeyRef.current !== currentDeviceKey &&
      isStreamingRef.current
    ) {
      cleanupStreaming(true)
      if (previousDeviceKeyRef.current && isHdcAvailable()) {
        window.hdc.screenMirror.stop(previousDeviceKeyRef.current).catch(() => {
          // 静默处理错误
        })
      }
      setIsStreaming(false)
      isStreamingRef.current = false
      setIsStreamingLoading(false)
    }

    previousDeviceKeyRef.current = currentDeviceKey
  }, [selectedDevice?.connectKey, cleanupStreaming])

  useEffect(() => {
    return () => {
      if (isStreamingRef.current) {
        cleanupStreaming(true)
        if (selectedDevice && isHdcAvailable()) {
          window.hdc.screenMirror.stop(selectedDevice.connectKey).catch(() => {
            // 静默处理错误
          })
        }
      }
    }
  }, [selectedDevice, cleanupStreaming])

  return {
    isStreaming,
    isStreamingLoading,
    streamError,
    displaySize,
    isH264,
    imgRef,
    canvasRef,
    handleStartStreaming,
    handleStopStreaming,
    handleControlAction
  }
}
