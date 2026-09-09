import { VideoCodecInfo, getCodecString } from './types'

export class ScrcpyPlayer {
  private decoder: VideoDecoder | null = null
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private width: number = 0
  private height: number = 0
  private configured: boolean = false
  private codecId: number = 0
  private frameCount: number = 0
  private lastFpsTime: number = 0
  private fps: number = 0
  private pendingFrames: Array<{
    data: Uint8Array
    isKeyframe: boolean
    pts: number
  }> = []
  private isConfiguring = false
  private destroyed: boolean = false
  private consecutiveErrors: number = 0
  private waitingForKeyframe: boolean = false

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    console.log('[ScrcpyPlayer] Constructor called')
  }

  init(codecInfo: VideoCodecInfo): void {
    console.log('[ScrcpyPlayer] init called with:', codecInfo)
    this.width = codecInfo.width
    this.height = codecInfo.height
    this.codecId = codecInfo.codecId

    this.canvas.width = this.width
    this.canvas.height = this.height

    this.frameCount = 0
    this.lastFpsTime = performance.now()
    this.fps = 0
    this.destroyed = false
    this.consecutiveErrors = 0
    this.waitingForKeyframe = false

    if (this.decoder) {
      try {
        this.decoder.close()
      } catch (_) {
        /* ignore */
      }
      this.decoder = null
    }

    this.configured = false
    this.pendingFrames = []
    this.isConfiguring = false

    try {
      this.decoder = new VideoDecoder({
        output: (frame) => {
          this.renderFrame(frame)
        },
        error: (e) => {
          console.error('[ScrcpyPlayer] VideoDecoder error:', e)
          this.consecutiveErrors++
          if (this.consecutiveErrors > 3) {
            this.waitingForKeyframe = true
            this.consecutiveErrors = 0
          }
        },
      })
      console.log(
        '[ScrcpyPlayer] VideoDecoder created for codec:',
        getCodecString(this.codecId),
      )
    } catch (e) {
      console.error('[ScrcpyPlayer] Failed to create VideoDecoder:', e)
    }
  }

  private renderFrame(frame: VideoFrame): void {
    if (this.destroyed) {
      frame.close()
      return
    }
    try {
      this.ctx.drawImage(frame, 0, 0, this.width, this.height)
      frame.close()
      this.consecutiveErrors = 0

      this.frameCount++
      const now = performance.now()
      if (now - this.lastFpsTime >= 1000) {
        this.fps = Math.round(
          (this.frameCount * 1000) / (now - this.lastFpsTime),
        )
        this.frameCount = 0
        this.lastFpsTime = now
      }
    } catch (e) {
      console.error('[ScrcpyPlayer] Render error:', e)
    }
  }

  /**
   * Feed a frame from the backend. Data is already in AVCC format (regular frames)
   * or AVCDecoderConfigurationRecord (config frames).
   */
  feedFrame(
    data: string,
    isKeyframe: boolean,
    isConfig: boolean,
    pts: number,
  ): void {
    if (this.destroyed) return
    if (!this.decoder) {
      console.warn('[ScrcpyPlayer] No decoder, dropping frame')
      return
    }

    try {
      const binaryString = atob(data)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }

      if (Boolean(isConfig)) {
        console.log(
          '[ScrcpyPlayer] Got config frame (AVCDecoderConfigRecord), size:',
          bytes.length,
          'hex:',
          Array.from(bytes.subarray(0, Math.min(12, bytes.length)))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join(' '),
        )
        void this.configureDecoder(bytes)
        return
      }

      if (!this.configured) {
        if (this.isConfiguring) {
          this.pendingFrames.push({ data: bytes, isKeyframe, pts })
          return
        }
        console.warn(
          '[ScrcpyPlayer] Decoder not configured, dropping frame',
        )
        return
      }

      this.decodeFrame(bytes, isKeyframe, pts)
    } catch (e) {
      console.error('[ScrcpyPlayer] Feed frame error:', e)
    }
  }

  /**
   * Decode a single AVCC-formatted frame.
   */
  private decodeFrame(
    data: Uint8Array,
    isKeyframe: boolean,
    pts: number,
  ): void {
    if (!this.decoder || this.destroyed || !this.configured) return

    if (this.decoder.state !== 'configured') {
      console.error(
        '[ScrcpyPlayer] Decoder in unexpected state:',
        this.decoder.state,
      )
      this.configured = false
      return
    }

    try {
      if (this.waitingForKeyframe && !isKeyframe) {
        return
      }
      if (isKeyframe) {
        this.waitingForKeyframe = false
      }

      const chunk = new EncodedVideoChunk({
        type: isKeyframe ? 'key' : 'delta',
        timestamp: pts,
        data: data,
      })
      this.decoder.decode(chunk)
    } catch (e) {
      console.error('[ScrcpyPlayer] Decode frame error:', e)
      if (
        e instanceof DOMException &&
        e.name === 'InvalidStateError'
      ) {
        this.configured = false
      }
    }
  }

  /**
   * Configure the decoder using an AVCDecoderConfigurationRecord.
   * The record bytes are used directly as the `description` in VideoDecoderConfig.
   */
  private async configureDecoder(
    configRecord: Uint8Array,
  ): Promise<void> {
    if (!this.decoder || this.destroyed) {
      console.error('[ScrcpyPlayer] No decoder to configure')
      return
    }
    if (this.configured) {
      console.log('[ScrcpyPlayer] Already configured')
      return
    }
    if (this.isConfiguring) return

    this.isConfiguring = true
    try {
      // Extract codec string from AVCDecoderConfigurationRecord bytes [1..3]
      let codecStr = getCodecString(this.codecId)
      if (configRecord.length >= 4 && configRecord[0] === 1) {
        const p = configRecord[1].toString(16).padStart(2, '0')
        const c = configRecord[2].toString(16).padStart(2, '0')
        const l = configRecord[3].toString(16).padStart(2, '0')
        codecStr = `avc1.${p}${c}${l}`
      }

      const config: VideoDecoderConfig = {
        codec: codecStr,
        codedWidth: this.width,
        codedHeight: this.height,
        description: configRecord.buffer,
      }

      console.log(
        '[ScrcpyPlayer] Configuring decoder with AVCC description, codec:',
        codecStr,
        'size:',
        this.width,
        'x',
        this.height,
        'description size:',
        configRecord.length,
      )

      const result = await VideoDecoder.isConfigSupported(config)
      console.log('[ScrcpyPlayer] Config supported:', result.supported)

      if (this.destroyed || !this.decoder) return
      if (this.configured) return

      if (!result.supported) {
        console.error(
          '[ScrcpyPlayer] Config not supported, codec:',
          codecStr,
        )
        this.pendingFrames = []
        return
      }

      this.decoder.configure(config)

      if (this.decoder.state !== 'configured') {
        console.error(
          '[ScrcpyPlayer] Decoder state after configure():',
          this.decoder.state,
        )
        this.pendingFrames = []
        return
      }

      this.configured = true
      console.log('[ScrcpyPlayer] Decoder configured successfully')

      for (const frame of this.pendingFrames) {
        this.decodeFrame(frame.data, frame.isKeyframe, frame.pts)
      }
      this.pendingFrames = []
    } catch (e) {
      console.error('[ScrcpyPlayer] Configure decoder error:', e)
      this.pendingFrames = []
    } finally {
      this.isConfiguring = false
    }
  }

  destroy(): void {
    console.log('[ScrcpyPlayer] destroy called')
    this.destroyed = true
    this.pendingFrames = []
    if (this.decoder) {
      try {
        this.decoder.close()
      } catch (e) {
        console.error('[ScrcpyPlayer] Close decoder error:', e)
      }
      this.decoder = null
    }
    this.configured = false
    this.isConfiguring = false
  }

  getFps(): number {
    return this.fps
  }

  getSize(): { width: number; height: number } {
    return { width: this.width, height: this.height }
  }

  isConfigured(): boolean {
    return this.configured
  }
}
