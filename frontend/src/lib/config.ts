/**
 * 应用运行时配置（来自根目录 `.env.ci`，经 Vite 在构建时注入为 VITE_*）
 *
 * 开源仓库不包含 `.env.ci`；请复制 `.env.ci.example` 为 `.env.ci` 后填写。
 * 发布包不会附带 `.env.ci` 文件。
 */

function envString(key: keyof ImportMetaEnv | string, fallback = ''): string {
  const value = (import.meta.env as Record<string, string | undefined>)[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
}

/** 更新检查 JSON URL */
export const UPDATE_CHECK_URL = envString('VITE_UPDATE_CHECK_URL')

/** 在线文档 URL（为空则帮助页不展示文档入口） */
export const DOCS_URL = envString('VITE_DOCS_URL')
