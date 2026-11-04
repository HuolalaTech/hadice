import type { InstallPlatform } from '@/types/install'

/**
 * 仅校验协议；后缀在下载后由后端根据 Content-Disposition / 最终 URL 判定。
 * OSS 签名链（path 含 .zip/.apk 但带 ?Expires=…）与无后缀再 302 的制品站链接都允许提交。
 */
export function validateInstallPackageUrl(
  rawUrl: string,
  _platform: InstallPlatform
): string | null {
  const trimmedUrl = rawUrl.trim()
  let parsedUrl: URL
  try {
    parsedUrl = new URL(trimmedUrl)
  } catch {
    return '请输入有效的 HTTP/HTTPS 安装包链接'
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return '仅支持 HTTP/HTTPS 安装包链接'
  }

  return null
}
