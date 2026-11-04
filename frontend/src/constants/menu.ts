import {
  LayoutDashboard,
  Info,
  Activity,
  ListTree,
  MonitorSmartphone,
  FolderSync,
  Package,
  Download,
  FileText,
  Globe,
  Radio,
  Smartphone,
  Terminal,
  Bot,
  Boxes,
  Wrench,
  ExternalLink
} from 'lucide-react'
/**
 * 菜单项配置
 * 供 Sidebar、App 等组件共享
 * 应用布局为实验项：侧栏是否展示由 modules/appLayout/enabled 控制
 */
export const menuItems = [
  { id: 'device-overview', label: '设备总览', icon: LayoutDashboard },
  { id: 'performance', label: '性能监控', icon: Activity },
  { id: 'process', label: '进程管理', icon: ListTree },
  { id: 'app-manager', label: '应用管理', icon: Package },
  { id: 'app-install', label: '应用安装', icon: Download },
  { id: 'app-layout', label: '应用布局', icon: Boxes },
  { id: 'screenshot', label: '投屏截屏', icon: MonitorSmartphone },
  { id: 'file-transfer', label: '文件传输', icon: FolderSync },
  { id: 'system-logs', label: '系统日志', icon: FileText },
  { id: 'network-capture', label: '鸿蒙抓包', icon: Globe },
  { id: 'track-log', label: '数据埋点', icon: Radio },
  { id: 'android-network-capture', label: '安卓抓包', icon: Smartphone },
  { id: 'system-info', label: '系统信息', icon: Info },
  { id: 'hdc-shell', label: '终端命令', icon: Terminal },
  { id: 'ai-automation', label: 'AI自动化', icon: Bot },
  { id: 'handy-tools', label: '便捷工具', icon: Wrench },
  { id: 'web-peek', label: '网页看看', icon: ExternalLink }
] as const

export type MenuItemId = (typeof menuItems)[number]['id']

/**
 * 根据菜单 ID 获取菜单标签
 */
export function getMenuLabel(menuId: string): string {
  const item = menuItems.find((m) => m.id === menuId)
  return item?.label ?? menuId
}

/**
 * 根据菜单 ID 获取菜单项（含 icon）
 */
export function getMenuItem(menuId: string): (typeof menuItems)[number] | undefined {
  return menuItems.find((m) => m.id === menuId)
}
