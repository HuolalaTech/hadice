import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * 快捷命令项
 */
export interface CommandItem {
  /** 命令 ID */
  id: string
  /** 命令名称 */
  name: string
  /** 实际命令 */
  command: string
  /** 创建时间 */
  createdAt: number
}

interface CommandStoreState {
  /** 自定义快捷命令列表 */
  customCommands: CommandItem[]

  /** 添加自定义命令 */
  addCommand: (name: string, command: string) => void
  /** 删除自定义命令 */
  removeCommand: (id: string) => void
  /** 更新自定义命令 */
  updateCommand: (id: string, name: string, command: string) => void
  /** 获取所有命令（内置 + 自定义） */
  getAllCommands: () => CommandItem[]
}

/**
 * 内置快捷命令列表
 */
const BUILT_IN_COMMANDS: CommandItem[] = [
  {
    id: 'builtin-list-targets-verbose',
    name: '列出设备（详细）',
    command: 'hdc list targets -v',
    createdAt: 0
  },
  {
    id: 'builtin-shell-reboot',
    name: '重启设备',
    command: 'hdc shell reboot',
    createdAt: 0
  },
  {
    id: 'builtin-shell-shutdown',
    name: '关机',
    command: 'hdc shell shutdown',
    createdAt: 0
  },
  {
    id: 'builtin-version',
    name: '查看版本',
    command: 'hdc -v',
    createdAt: 0
  },
  {
    id: 'builtin-check-server',
    name: '检查服务状态',
    command: 'hdc checkserver',
    createdAt: 0
  },
  {
    id: 'builtin-start-server',
    name: '启动服务',
    command: 'hdc start',
    createdAt: 0
  },
  {
    id: 'builtin-kill-server',
    name: '停止服务',
    command: 'hdc kill',
    createdAt: 0
  },
  {
    id: 'builtin-shell-pm-list',
    name: '列出应用',
    command: 'hdc shell bm dump -a',
    createdAt: 0
  },
  {
    id: 'builtin-shell-dumpsys',
    name: '系统信息',
    command: 'hdc shell dumpsys',
    createdAt: 0
  },
  {
    id: 'builtin-shell-getprop',
    name: '系统属性',
    command: 'hdc shell param get',
    createdAt: 0
  },
  {
    id: 'builtin-shell-top',
    name: '进程监控',
    command: 'hdc shell top',
    createdAt: 0
  },
  {
    id: 'builtin-shell-ps',
    name: '进程列表',
    command: 'hdc shell ps',
    createdAt: 0
  },
  {
    id: 'builtin-shell-df',
    name: '磁盘空间',
    command: 'hdc shell df -h',
    createdAt: 0
  },
  {
    id: 'builtin-shell-free',
    name: '内存信息',
    command: 'hdc shell free -h',
    createdAt: 0
  },
  {
    id: 'builtin-shell-ifconfig',
    name: '网络配置',
    command: 'hdc shell ifconfig',
    createdAt: 0
  },
  {
    id: 'builtin-shell-hilog',
    name: '查看 HiLog',
    command: 'hdc shell hilog',
    createdAt: 0
  },
  {
    id: 'builtin-file-list',
    name: '列出文件',
    command: 'hdc shell ls -la /data/local/tmp',
    createdAt: 0
  },
  {
    id: 'builtin-install',
    name: '安装应用',
    command: 'hdc shell bm install -p <hap_path>',
    createdAt: 0
  },
  {
    id: 'builtin-uninstall',
    name: '卸载应用',
    command: 'hdc shell bm uninstall -n <package_name>',
    createdAt: 0
  },
  {
    id: 'builtin-screen-cap',
    name: '截图',
    command: 'hdc shell snapshot_display -f /data/local/tmp/screenshot.jpeg',
    createdAt: 0
  },
  {
    id: 'builtin-tconn',
    name: 'TCP 连接',
    command: 'hdc tconn <ip:port>',
    createdAt: 0
  },
  {
    id: 'builtin-tport',
    name: 'TCP 端口转发',
    command: 'hdc tport <local_port> <remote_port>',
    createdAt: 0
  }
]

/**
 * 快捷命令 Store
 * 使用 localStorage 持久化自定义命令
 */
export const useCommandStore = create<CommandStoreState>()(
  persist(
    (set, get) => ({
      customCommands: [],

      /**
       * 添加自定义命令
       */
      addCommand: (name: string, command: string) => {
        const newCommand: CommandItem = {
          id: `custom-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
          name,
          command,
          createdAt: Date.now()
        }
        set((state) => ({
          customCommands: [...state.customCommands, newCommand]
        }))
      },

      /**
       * 删除自定义命令
       */
      removeCommand: (id: string) => {
        set((state) => ({
          customCommands: state.customCommands.filter((cmd) => cmd.id !== id)
        }))
      },

      /**
       * 更新自定义命令
       */
      updateCommand: (id: string, name: string, command: string) => {
        set((state) => ({
          customCommands: state.customCommands.map((cmd) =>
            cmd.id === id ? { ...cmd, name, command } : cmd
          )
        }))
      },

      /**
       * 获取所有命令（内置 + 自定义）
       */
      getAllCommands: () => {
        const { customCommands } = get()
        return [...BUILT_IN_COMMANDS, ...customCommands]
      }
    }),
    {
      name: 'harmony-hdc-commands', // localStorage key
      partialize: (state) => ({ customCommands: state.customCommands }) // 只持久化自定义命令
    }
  )
)

