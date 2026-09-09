import type {
  PerformanceHistory,
  CpuFreqHistory,
  ProcessPerformanceEntry,
  ProcessMemoryHistory,
  IpcHistory,
  ProcessIOHistory
} from '@/hooks/usePerformanceData'
import type { FaultLogEntry } from '@/types/hdc'
import { performanceAPI } from '@/lib/hdc-api/performance'
import { formatOutputTimestamp, sanitizeOutputComponent } from '@/lib/outputNaming'

interface ExportData {
  platform: 'android' | 'harmony'
  deviceName: string
  history: PerformanceHistory[]
  cpuFreqHistory: CpuFreqHistory[]
  processHistory: ProcessPerformanceEntry[]
  processMemoryHistory: ProcessMemoryHistory[]
  ipcHistory: IpcHistory[]
  processIOHistory: ProcessIOHistory[]
  faultLogs: FaultLogEntry[]
  selectedPids: number[]
}

function escapeCSV(value: string | number): string {
  const s = String(value)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export async function exportPerformanceToCSV(data: ExportData): Promise<string> {
  const {
    platform, deviceName,
    history, cpuFreqHistory, processHistory,
    processMemoryHistory, ipcHistory, processIOHistory,
    faultLogs, selectedPids
  } = data

  if (history.length === 0) return ''

  const sections: string[] = []

  // ===== 1. 系统概览 =====
  const sysHeaders = [
    'Time', 'CPU Total (%)', 'CPU User (%)', 'CPU Kernel (%)',
    'Memory Used (KB)', 'Memory Total (KB)', 'Memory (%)', 'Swap Used (KB)',
    'Battery (%)', 'Temperature (°C)',
    'Network RX (B/s)', 'Network TX (B/s)', 'FPS'
  ]
  const sysRows = history.map(h => [
    escapeCSV(h.time), h.cpuTotal.toFixed(2), h.cpuUser.toFixed(2), h.cpuKernel.toFixed(2),
    h.memUsed, h.memTotal, h.memPercent, h.swapUsed,
    h.batteryCapacity, h.batteryTemperature.toFixed(1),
    Math.round(h.networkRx), Math.round(h.networkTx), h.fps
  ].join(','))
  sections.push(['[系统概览]', sysHeaders.join(','), ...sysRows].join('\n'))

  // ===== 2. CPU 频率 =====
  if (cpuFreqHistory.length > 0) {
    const freqHeaders = ['Time', 'Big Core (MHz)', 'Mid Core (MHz)', 'Little Core (MHz)']
    const freqRows = cpuFreqHistory.map(h => [
      escapeCSV(h.time), h.bigCore, h.midCore, h.littleCore
    ].join(','))
    sections.push(['[CPU 频率]', freqHeaders.join(','), ...freqRows].join('\n'))
  }

  // ===== 3. 进程 CPU 使用率 =====
  if (processHistory.length > 0 && selectedPids.length > 0) {
    const pidInfo = selectedPids.map(pid => {
      const lastEntry = processHistory[processHistory.length - 1]
      const name = lastEntry?.processes[pid]?.command || `PID:${pid}`
      return { pid, name }
    })

    const flatHeaders = ['Time']
    for (const p of pidInfo) {
      flatHeaders.push(`${p.name} (PID:${p.pid}) Total (%)`)
      flatHeaders.push(`${p.name} (PID:${p.pid}) User (%)`)
      flatHeaders.push(`${p.name} (PID:${p.pid}) Kernel (%)`)
    }

    const procRows = processHistory.map(h => {
      const row: string[] = [escapeCSV(h.time)]
      for (const { pid } of pidInfo) {
        const proc = h.processes[pid]
        row.push(
          proc ? proc.cpuPercent.toFixed(2) : '0',
          proc ? proc.cpuUser.toFixed(2) : '0',
          proc ? proc.cpuKernel.toFixed(2) : '0'
        )
      }
      return row.join(',')
    })
    sections.push(['[进程 CPU 使用率]', flatHeaders.map(escapeCSV).join(','), ...procRows].join('\n'))
  }

  // ===== 4. 进程内存详情 =====
  if (processMemoryHistory.length > 0 && selectedPids.length > 0) {
    const allCategories = new Set<string>()
    for (const h of processMemoryHistory) {
      for (const cat of Object.keys(h.categories)) {
        allCategories.add(cat)
      }
    }
    const catList = Array.from(allCategories)
    const memHeaders = ['Time', ...catList.map(c => `${c} (MB)`), 'Total PSS (MB)']
    const memRows = processMemoryHistory.map(h => {
      const row: string[] = [escapeCSV(h.time)]
      for (const cat of catList) {
        row.push((h.categories[cat] || 0).toFixed(1))
      }
      row.push(h.totalPss.toFixed(1))
      return row.join(',')
    })
    sections.push(['[进程内存详情]', memHeaders.map(escapeCSV).join(','), ...memRows].join('\n'))
  }

  // ===== 5. IPC 通信统计 =====
  if (ipcHistory.length > 0) {
    const ipcHeaders = ['Time', 'IPC Call Count (delta)', 'Avg Time Cost (μs)']
    const ipcRows = ipcHistory.map(h => [
      escapeCSV(h.time), h.callCount, h.avgTimeCost
    ].join(','))
    sections.push(['[IPC 通信统计]', ipcHeaders.join(','), ...ipcRows].join('\n'))
  }

  // ===== 6. 进程 IO =====
  if (processIOHistory.length > 0) {
    const ioHeaders = ['Time', 'Read Rate (B/s)', 'Write Rate (B/s)', 'Read Total (B)', 'Write Total (B)']
    const ioRows = processIOHistory.map(h => [
      escapeCSV(h.time), Math.round(h.readRate), Math.round(h.writeRate),
      h.readTotal, h.writeTotal
    ].join(','))
    sections.push(['[进程 IO]', ioHeaders.join(','), ...ioRows].join('\n'))
  }

  // ===== 7. 崩溃记录 =====
  if (faultLogs.length > 0) {
    const faultHeaders = ['Time', 'Process Name', 'Reason', 'Foreground', 'Record ID']
    const faultRows = faultLogs.map(log => [
      escapeCSV(log.time), escapeCSV(log.processName),
      escapeCSV(log.reason), log.foreground ? 'Yes' : 'No',
      escapeCSV(log.recordId)
    ].join(','))
    sections.push(['[崩溃记录]', faultHeaders.join(','), ...faultRows].join('\n'))
  }

  const csv = sections.join('\n\n')
  const filename = `performance_${platform}_${sanitizeOutputComponent(deviceName, 'device')}_${formatOutputTimestamp()}.csv`
  const savedPath = await performanceAPI.saveTextFile(`performance/${filename}`, csv)
  return savedPath
}
