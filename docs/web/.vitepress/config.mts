import { defineConfig } from 'vitepress'

const BASE = '/hadice/'

const zhNav = [
  { text: '首页', link: '/' },
  { text: '下载', link: '/download/' },
  { text: '文档', link: '/docs/' },
]

const zhSidebar = {
  '/docs/': [
    {
      text: '开始使用',
      items: [
        { text: '文档首页', link: '/docs/' },
        { text: '连接设备', link: '/docs/connect-device' },
      ],
    },
    {
      text: '功能指南',
      items: [
        { text: '设备总览', link: '/docs/device-overview' },
        { text: '性能监控', link: '/docs/performance' },
        { text: '进程管理', link: '/docs/process' },
        { text: '应用管理', link: '/docs/app-manager' },
        { text: '应用安装', link: '/docs/app-install' },
        { text: '投屏截屏', link: '/docs/screenshot' },
        { text: '文件传输', link: '/docs/file-transfer' },
        { text: '系统日志', link: '/docs/system-logs' },
        {
          text: '网络抓包',
          collapsed: false,
          items: [
            { text: '鸿蒙抓包', link: '/docs/network-capture/' },
            { text: '安卓抓包', link: '/docs/network-capture/android' },
          ],
        },
        { text: '系统信息', link: '/docs/system-info' },
        { text: '终端命令', link: '/docs/hdc-shell' },
        { text: 'AI 自动化', link: '/docs/ai-automation' },
      ],
    },
  ],
}

export default defineConfig({
  base: BASE,
  lang: 'zh-CN',
  title: 'Hadice',
  description: '安卓 & 鸿蒙桌面调试工具',
  head: [
    ['link', { rel: 'icon', href: `${BASE}assets/img/icon.png`, type: 'image/png' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'Hadice' }],
    ['meta', { property: 'og:image', content: `${BASE}assets/img/icon.png` }],
  ],
  themeConfig: {
    logo: '/assets/img/icon.png',
    socialLinks: [{ icon: 'github', link: 'https://github.com/HuolalaTech/hadice' }],
  },
  locales: {
    root: {
      label: '简体中文',
      lang: 'zh-CN',
      themeConfig: {
        nav: zhNav,
        sidebar: zhSidebar,
        outline: { label: '本页导航' },
        docFooter: { prev: '上一页', next: '下一页' },
        lastUpdated: { text: '更新于' },
        search: {
          provider: 'local',
          options: {
            translations: {
              button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
              modal: {
                noResultsText: '没有找到相关结果',
                resetButtonTitle: '清除查询条件',
                footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' },
              },
            },
          },
        },
        footer: {
          message: 'Apache-2.0 · 货拉拉出品',
          copyright: '© 2026 Hadice',
        },
      },
    },
  },
})
