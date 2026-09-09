/**
 * 格式化内存大小
 */
export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + sizes[i]
}

/**
 * 格式化文件大小（别名，保持向后兼容）
 */
export function formatFileSize(bytes: number, decimals = 1): string {
  return formatBytes(bytes, decimals)
}

/**
 * 格式化日期时间
 */
export function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}
