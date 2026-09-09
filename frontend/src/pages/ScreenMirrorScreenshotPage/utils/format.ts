/**
 * 格式化时间戳
 */
export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

/**
 * 格式化时间为简短格式
 */
export function formatTimeShort(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

/**
 * 读取图片尺寸
 */
export function getImageDimensions(imageData: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new window.Image()
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
    }
    img.onerror = () => {
      // 如果读取失败，返回默认尺寸
      resolve({ width: 1260, height: 2720 })
    }
    img.src = imageData
  })
}






