export interface VideoCodecInfo {
  codecId: number
  width: number
  height: number
}

export interface VideoFrameData {
  deviceSn: string
  data: string
  transport?: 'h264' | 'jpeg'
  isKeyframe: boolean
  isConfig: boolean
  pts: number
}

export type VideoCodec = 'h264' | 'h265' | 'av1'

export function getCodecString(codecId: number): string {
  switch (codecId) {
    case 0:
      return 'avc1.42001E'
    case 1:
      return 'hev1.1.6.L93.B0'
    case 2:
      return 'av01.0.04M.08'
    default:
      return 'avc1.42001E'
  }
}

export function getCodecName(codecId: number): VideoCodec {
  switch (codecId) {
    case 0:
      return 'h264'
    case 1:
      return 'h265'
    case 2:
      return 'av1'
    default:
      return 'h264'
  }
}
