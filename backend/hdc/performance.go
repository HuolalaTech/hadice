package hdc

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// CpuDetailInfo 详细 CPU 使用信息
type CpuDetailInfo struct {
	Total       float64 `json:"total"`
	User        float64 `json:"user"`
	System      float64 `json:"system"`
	Kernel      float64 `json:"kernel"`
	Idle        float64 `json:"idle"`
	Iowait      float64 `json:"iowait"`
	Irq         float64 `json:"irq"`
	LoadAverage struct {
		One     float64 `json:"one"`
		Five    float64 `json:"five"`
		Fifteen float64 `json:"fifteen"`
	} `json:"loadAverage"`
}

// ProcessCpuEntry 进程 CPU 使用率（来自 hidumper --cpuusage）
type ProcessCpuEntry struct {
	Pid         int     `json:"pid"`
	TotalUsage  float64 `json:"totalUsage"`
	UserSpace   float64 `json:"userSpace"`
	KernelSpace float64 `json:"kernelSpace"`
	Name        string  `json:"name"`
}

// MemoryDetailInfo 详细内存信息
type MemoryDetailInfo struct {
	Total       int64   `json:"total"`
	Used        int64   `json:"used"`
	Free        int64   `json:"free"`
	Available   int64   `json:"available"`
	Cached      int64   `json:"cached"`
	Buffers     int64   `json:"buffers"`
	SwapTotal   int64   `json:"swapTotal"`
	SwapUsed    int64   `json:"swapUsed"`
	SwapFree    int64   `json:"swapFree"`
	UsedPercent float64 `json:"usedPercent"`
}

// NetworkTrafficInfo 网络流量信息
type NetworkTrafficInfo struct {
	Interface  string `json:"interface"`
	RxBytes    int64  `json:"rxBytes"`
	TxBytes    int64  `json:"txBytes"`
	RxPackets  int64  `json:"rxPackets"`
	TxPackets  int64  `json:"txPackets"`
}

// GraphicsInfo 图形性能信息
type GraphicsInfo struct {
	GpuVendor    string `json:"gpuVendor"`
	GpuRenderer  string `json:"gpuRenderer"`
	GpuVersion   string `json:"gpuVersion"`
	SurfaceMemory int64  `json:"surfaceMemory"`
	FpsCount     struct {
		Fps60  int `json:"fps60"`
		Fps90  int `json:"fps90"`
		Fps120 int `json:"fps120"`
	} `json:"fpsCount"`
}

// GetCpuDetailInfo 获取详细 CPU 使用信息（使用 hidumper --cpuusage）
func GetCpuDetailInfo(connectKey string) (*CpuDetailInfo, error) {
	result, err := ExecuteHdc([]string{"-t", connectKey, "shell", "hidumper", "--cpuusage"})
	if err != nil {
		return nil, fmt.Errorf("failed to get CPU detail info: %w", err)
	}

	defaultInfo := &CpuDetailInfo{
		Total:  0,
		User:   0,
		System: 0,
		Kernel: 0,
		Idle:   100,
		Iowait: 0,
		Irq:     0,
	}

	if !result.Success || result.Output == "" {
		return defaultInfo, nil
	}

	output := result.Output

	// 解析负载均值: Load average: 12.6 / 12.6 / 12.8
	loadMatch := regexp.MustCompile(`Load average:\s*([\d.]+)\s*/\s*([\d.]+)\s*/\s*([\d.]+)`).FindStringSubmatch(output)
	if loadMatch != nil {
		if val, err := strconv.ParseFloat(loadMatch[1], 64); err == nil {
			defaultInfo.LoadAverage.One = val
		}
		if val, err := strconv.ParseFloat(loadMatch[2], 64); err == nil {
			defaultInfo.LoadAverage.Five = val
		}
		if val, err := strconv.ParseFloat(loadMatch[3], 64); err == nil {
			defaultInfo.LoadAverage.Fifteen = val
		}
	}

	// 解析 CPU 使用率: Total: 9.46%; User Space: 3.79%; Kernel Space: 5.67%; iowait: 0.00%; irq: 1.18%; idle: 89.36%
	if match := regexp.MustCompile(`Total:\s*([\d.]+)%`).FindStringSubmatch(output); match != nil {
		if val, err := strconv.ParseFloat(match[1], 64); err == nil {
			defaultInfo.Total = val
		}
	}
	if match := regexp.MustCompile(`User Space:\s*([\d.]+)%`).FindStringSubmatch(output); match != nil {
		if val, err := strconv.ParseFloat(match[1], 64); err == nil {
			defaultInfo.User = val
		}
	}
	if match := regexp.MustCompile(`Kernel Space:\s*([\d.]+)%`).FindStringSubmatch(output); match != nil {
		if val, err := strconv.ParseFloat(match[1], 64); err == nil {
			defaultInfo.Kernel = val
			defaultInfo.System = val
		}
	}
	if match := regexp.MustCompile(`iowait:\s*([\d.]+)%`).FindStringSubmatch(output); match != nil {
		if val, err := strconv.ParseFloat(match[1], 64); err == nil {
			defaultInfo.Iowait = val
		}
	}
	if match := regexp.MustCompile(`irq:\s*([\d.]+)%`).FindStringSubmatch(output); match != nil {
		if val, err := strconv.ParseFloat(match[1], 64); err == nil {
			defaultInfo.Irq = val
		}
	}
	if match := regexp.MustCompile(`idle:\s*([\d.]+)%`).FindStringSubmatch(output); match != nil {
		if val, err := strconv.ParseFloat(match[1], 64); err == nil {
			defaultInfo.Idle = val
		}
	}

	return defaultInfo, nil
}

// GetProcessCpuUsage 获取进程级 CPU 使用率（来自 hidumper --cpuusage）
func GetProcessCpuUsage(connectKey string, pid int) ([]ProcessCpuEntry, error) {
	args := []string{"-t", connectKey, "shell", "hidumper", "--cpuusage"}
	if pid > 0 {
		args = append(args, strconv.Itoa(pid))
	}
	result, err := ExecuteHdc(args)
	if err != nil {
		return nil, fmt.Errorf("failed to get process cpu usage: %w", err)
	}

	if !result.Success || result.Output == "" {
		return nil, nil
	}

	// 解析进程列表:
	//     PID   Total Usage	   User Space    Kernel Space    Page Fault Minor    Page Fault Major    Name
	//     570        6.96%           6.11%          0.86%        893255046                2955            hilogd
	re := regexp.MustCompile(`^\s*(\d+)\s+([\d.]+)%\s+([\d.]+)%\s+([\d.]+)%\s+\d+\s+\d+\s+(\S+)`)
	var entries []ProcessCpuEntry
	for _, line := range strings.Split(result.Output, "\n") {
		match := re.FindStringSubmatch(line)
		if match == nil {
			continue
		}
		entry := ProcessCpuEntry{Name: match[5]}
		if v, err := strconv.Atoi(match[1]); err == nil {
			entry.Pid = v
		}
		if v, err := strconv.ParseFloat(match[2], 64); err == nil {
			entry.TotalUsage = v
		}
		if v, err := strconv.ParseFloat(match[3], 64); err == nil {
			entry.UserSpace = v
		}
		if v, err := strconv.ParseFloat(match[4], 64); err == nil {
			entry.KernelSpace = v
		}
		entries = append(entries, entry)
	}
	return entries, nil
}

// GetMemoryDetailInfo 获取详细内存信息
func GetMemoryDetailInfo(connectKey string) (*MemoryDetailInfo, error) {
	result, err := ExecuteHdc([]string{"-t", connectKey, "shell", "cat", "/proc/meminfo"})
	if err != nil {
		return nil, fmt.Errorf("failed to get memory detail info: %w", err)
	}

	defaultInfo := &MemoryDetailInfo{
		Total:       0,
		Used:        0,
		Free:        0,
		Available:   0,
		Cached:      0,
		Buffers:     0,
		SwapTotal:   0,
		SwapUsed:    0,
		SwapFree:    0,
		UsedPercent: 0,
	}

	if !result.Success || result.Output == "" {
		return defaultInfo, nil
	}

	output := result.Output

	// 解析 /proc/meminfo
	parseInt := func(pattern string) int64 {
		match := regexp.MustCompile(pattern).FindStringSubmatch(output)
		if match != nil {
			if val, err := strconv.ParseInt(match[1], 10, 64); err == nil {
				return val * 1024 // 转换为字节
			}
		}
		return 0
	}

	defaultInfo.Total = parseInt(`MemTotal:\s*(\d+)\s*kB`)
	defaultInfo.Free = parseInt(`MemFree:\s*(\d+)\s*kB`)
	defaultInfo.Available = parseInt(`MemAvailable:\s*(\d+)\s*kB`)
	defaultInfo.Cached = parseInt(`Cached:\s*(\d+)\s*kB`)
	defaultInfo.Buffers = parseInt(`Buffers:\s*(\d+)\s*kB`)
	defaultInfo.SwapTotal = parseInt(`SwapTotal:\s*(\d+)\s*kB`)
	defaultInfo.SwapFree = parseInt(`SwapFree:\s*(\d+)\s*kB`)

	defaultInfo.Used = defaultInfo.Total - defaultInfo.Available
	defaultInfo.SwapUsed = defaultInfo.SwapTotal - defaultInfo.SwapFree

	if defaultInfo.Total > 0 {
		defaultInfo.UsedPercent = float64(defaultInfo.Used) / float64(defaultInfo.Total) * 100
	}

	return defaultInfo, nil
}

// GetNetworkTrafficInfo 获取网络流量信息
func GetNetworkTrafficInfo(connectKey string) ([]NetworkTrafficInfo, error) {
	result, err := ExecuteHdc([]string{"-t", connectKey, "shell", "cat", "/proc/net/dev"})
	if err != nil {
		return nil, fmt.Errorf("failed to get network traffic info: %w", err)
	}

	if !result.Success || result.Output == "" {
		return []NetworkTrafficInfo{}, nil
	}

	networks := []NetworkTrafficInfo{}
	lines := strings.Split(result.Output, "\n")

	for _, line := range lines {
		// 跳过表头
		if strings.Contains(line, "Inter-") || strings.Contains(line, "face") {
			continue
		}

		// 匹配 wlan 和 rmnet 接口
		// 格式: wlan0: 123456 789 0 0 0 0 0 0 98765 432 0 0 0 0 0 0
		match := regexp.MustCompile(`^\s*(wlan\d+|rmnet\d+|eth\d+):\s*(\d+)\s+(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)\s+(\d+)`).FindStringSubmatch(line)
		if match != nil {
			rxBytes, _ := strconv.ParseInt(match[2], 10, 64)
			rxPackets, _ := strconv.ParseInt(match[3], 10, 64)
			txBytes, _ := strconv.ParseInt(match[4], 10, 64)
			txPackets, _ := strconv.ParseInt(match[5], 10, 64)

			// 只添加有流量的接口
			if rxBytes > 0 || txBytes > 0 {
				networks = append(networks, NetworkTrafficInfo{
					Interface: match[1],
					RxBytes:   rxBytes,
					TxBytes:   txBytes,
					RxPackets: rxPackets,
					TxPackets: txPackets,
				})
			}
		}
	}

	return networks, nil
}

// GetGraphicsInfo 获取图形性能信息
func GetGraphicsInfo(connectKey string) (*GraphicsInfo, error) {
	defaultInfo := &GraphicsInfo{
		GpuVendor:    "Unknown",
		GpuRenderer:  "Unknown",
		GpuVersion:   "Unknown",
		SurfaceMemory: 0,
	}

	// 并行获取 GPU 信息、Surface 内存、FPS 统计
	glesResult, _ := ExecuteHdc([]string{"-t", connectKey, "shell", "hidumper", "-s", "RenderService", "-a", "gles"})
	memResult, _ := ExecuteHdc([]string{"-t", connectKey, "shell", "hidumper", "-s", "RenderService", "-a", "allSurfacesMem"})
	fpsResult, _ := ExecuteHdc([]string{"-t", connectKey, "shell", "hidumper", "-s", "RenderService", "-a", "fpsCount"})

	// 解析 GPU 信息
	if glesResult != nil && glesResult.Success && glesResult.Output != "" {
		output := glesResult.Output
		if match := regexp.MustCompile(`GL_VENDOR:\s*(.+)`).FindStringSubmatch(output); match != nil {
			defaultInfo.GpuVendor = strings.TrimSpace(match[1])
		}
		if match := regexp.MustCompile(`GL_RENDERER:\s*(.+)`).FindStringSubmatch(output); match != nil {
			defaultInfo.GpuRenderer = strings.TrimSpace(match[1])
		}
		if match := regexp.MustCompile(`GL_VERSION:\s*(.+)`).FindStringSubmatch(output); match != nil {
			defaultInfo.GpuVersion = strings.TrimSpace(match[1])
		}
	}

	// 解析 Surface 内存
	if memResult != nil && memResult.Success && memResult.Output != "" {
		if match := regexp.MustCompile(`memory size of all surfaces buffer is\s*:\s*([\d.]+)`).FindStringSubmatch(memResult.Output); match != nil {
			if val, err := strconv.ParseFloat(match[1], 64); err == nil {
				defaultInfo.SurfaceMemory = int64(val)
			}
		}
	}

	// 解析 FPS 统计
	if fpsResult != nil && fpsResult.Success && fpsResult.Output != "" {
		output := fpsResult.Output
		if match := regexp.MustCompile(`Refresh Rate:60,\s*Count:(\d+)`).FindStringSubmatch(output); match != nil {
			if val, err := strconv.Atoi(match[1]); err == nil {
				defaultInfo.FpsCount.Fps60 = val
			}
		}
		if match := regexp.MustCompile(`Refresh Rate:90,\s*Count:(\d+)`).FindStringSubmatch(output); match != nil {
			if val, err := strconv.Atoi(match[1]); err == nil {
				defaultInfo.FpsCount.Fps90 = val
			}
		}
		if match := regexp.MustCompile(`Refresh Rate:120,\s*Count:(\d+)`).FindStringSubmatch(output); match != nil {
			if val, err := strconv.Atoi(match[1]); err == nil {
				defaultInfo.FpsCount.Fps120 = val
			}
		}
	}

	return defaultInfo, nil
}

// CpuFreqCore CPU 核心频率信息
type CpuFreqCore struct {
	Core        int `json:"core"`
	CurrentFreq int `json:"currentFreq"` // kHz
	MaxFreq     int `json:"maxFreq"`     // kHz
}

// CpuFreqInfo CPU 频率信息
type CpuFreqInfo struct {
	Cores []CpuFreqCore `json:"cores"`
}

// ProcessMemoryCategory 进程内存分类
type ProcessMemoryCategory struct {
	Name     string `json:"name"`     // native heap, ark ts heap, .so ...
	PssTotal int64  `json:"pssTotal"` // kB
}

// ProcessMemoryDetail 进程内存详情
type ProcessMemoryDetail struct {
	Categories []ProcessMemoryCategory `json:"categories"`
	TotalPss   int64                   `json:"totalPss"`  // kB
	SwapUsed   int64                   `json:"swapUsed"`  // kB
	HeapSize   int64                   `json:"heapSize"`  // kB
	HeapAlloc  int64                   `json:"heapAlloc"` // kB
	Dma        int64                   `json:"dma"`       // kB
	Ashmem     int64                   `json:"ashmem"`    // kB
}

// FaultLogEntry 故障日志条目
type FaultLogEntry struct {
	Time        string `json:"time"`
	Foreground  bool   `json:"foreground"`
	Reason      string `json:"reason"`
	RecordId    string `json:"recordId"`
	ProcessName string `json:"processName"`
}

// ProcessIOInfo 进程 IO 信息
type ProcessIOInfo struct {
	Rchar               int64 `json:"rchar"`
	Wchar               int64 `json:"wchar"`
	Syscr               int64 `json:"syscr"`
	Syscw               int64 `json:"syscw"`
	ReadBytes           int64 `json:"readBytes"`
	WriteBytes          int64 `json:"writeBytes"`
	CancelledWriteBytes int64 `json:"cancelledWriteBytes"`
}

// IpcInterface IPC 接口统计
type IpcInterface struct {
	CallingPid     int    `json:"callingPid"`
	DescriptorCode string `json:"descriptorCode"`
	Count          int    `json:"count"`
	MaxTime        int64  `json:"maxTime"`
	MinTime        int64  `json:"minTime"`
	AvgTime        int64  `json:"avgTime"`
}

// IpcStatInfo IPC 统计信息
type IpcStatInfo struct {
	TotalCount    int64          `json:"totalCount"`
	TotalTimeCost int64          `json:"totalTimeCost"`
	Interfaces    []IpcInterface `json:"interfaces"`
}

// GetCpuFreqInfo 获取 CPU 频率信息（使用 hidumper --cpufreq）
func GetCpuFreqInfo(connectKey string) (*CpuFreqInfo, error) {
	result, err := ExecuteHdc([]string{"-t", connectKey, "shell", "hidumper", "--cpufreq"})
	if err != nil {
		return nil, fmt.Errorf("failed to get CPU freq info: %w", err)
	}

	info := &CpuFreqInfo{Cores: []CpuFreqCore{}}

	if !result.Success || result.Output == "" {
		return info, nil
	}

	// 用正则解析各核频率
	lines := strings.Split(result.Output, "\n")
	curFreqRe := regexp.MustCompile(`cpu(\d+)/cpufreq/cpuinfo_cur_freq`)
	maxFreqRe := regexp.MustCompile(`cpu(\d+)/cpufreq/cpuinfo_max_freq`)

	// findNextInt 从指定行开始，找到第一个非空行的整数值
	findNextInt := func(lines []string, start int) int {
		for j := start; j < len(lines); j++ {
			s := strings.TrimSpace(lines[j])
			if s == "" {
				continue
			}
			if v, err := strconv.Atoi(s); err == nil {
				return v
			}
			return 0
		}
		return 0
	}

	coreFreqs := make(map[int]*CpuFreqCore)
	for i := 0; i < len(lines); i++ {
		line := strings.TrimSpace(lines[i])

		if match := curFreqRe.FindStringSubmatch(line); match != nil {
			coreNum, _ := strconv.Atoi(match[1])
			if coreFreqs[coreNum] == nil {
				coreFreqs[coreNum] = &CpuFreqCore{Core: coreNum}
			}
			coreFreqs[coreNum].CurrentFreq = findNextInt(lines, i+1)
		}

		if match := maxFreqRe.FindStringSubmatch(line); match != nil {
			coreNum, _ := strconv.Atoi(match[1])
			if coreFreqs[coreNum] == nil {
				coreFreqs[coreNum] = &CpuFreqCore{Core: coreNum}
			}
			coreFreqs[coreNum].MaxFreq = findNextInt(lines, i+1)
		}
	}

	for _, core := range coreFreqs {
		info.Cores = append(info.Cores, *core)
	}

	return info, nil
}

// GetProcessMemoryDetail 获取进程内存详情（使用 hidumper --mem {pid}）
func GetProcessMemoryDetail(connectKey string, pid int) (*ProcessMemoryDetail, error) {
	pidStr := strconv.Itoa(pid)
	result, err := ExecuteHdc([]string{"-t", connectKey, "shell", "hidumper", "--mem", pidStr})
	if err != nil {
		return nil, fmt.Errorf("failed to get process memory detail: %w", err)
	}

	detail := &ProcessMemoryDetail{
		Categories: []ProcessMemoryCategory{},
	}

	if !result.Success || result.Output == "" {
		return detail, nil
	}

	lines := strings.Split(result.Output, "\n")
	inTable := false
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)

		// 检测表格数据区开始（在分隔线之后）
		if strings.HasPrefix(trimmed, "---") && strings.Contains(trimmed, "---") {
			inTable = true
			continue
		}

		// 检测 Total 行（第二个分隔线后）
		if inTable && strings.HasPrefix(trimmed, "Total") {
			inTable = false
			// 解析 Total PSS
			fields := strings.Fields(trimmed)
			if len(fields) >= 2 {
				if val, err := strconv.ParseInt(fields[1], 10, 64); err == nil {
					detail.TotalPss = val
				}
			}
			continue
		}

		// 检测第二个分隔线（Total 后面）
		if inTable && strings.HasPrefix(trimmed, "---") {
			inTable = false
			continue
		}

		if !inTable {
			continue
		}

		// 解析分类行：名称（可能含空格如 "ark ts heap"）+ 数值列
		// 找到第一个数字 token，之前所有非数字 token 组成名称，该数字即 PSS Total
		fields := strings.Fields(trimmed)
		if len(fields) < 2 {
			continue
		}
		nameParts := []string{}
		pssIdx := -1
		for i, f := range fields {
			if _, err := strconv.ParseInt(f, 10, 64); err == nil {
				pssIdx = i
				break
			}
			nameParts = append(nameParts, f)
		}
		if pssIdx < 0 || len(nameParts) == 0 {
			continue
		}
		name := strings.Join(nameParts, " ")
		if name == "Pss" || name == "Total" || name == "-------" || name == "(kB)" {
			continue
		}
		pssTotal, _ := strconv.ParseInt(fields[pssIdx], 10, 64)
		detail.Categories = append(detail.Categories, ProcessMemoryCategory{
			Name:     name,
			PssTotal: pssTotal,
		})
	}

	// 解析 Swap
	if match := regexp.MustCompile(`Total\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)`).FindStringSubmatch(result.Output); match != nil {
		if val, err := strconv.ParseInt(match[1], 10, 64); err == nil {
			detail.SwapUsed = val
		}
	}

	// 解析 Heap
	heapSizeRe := regexp.MustCompile(`jemalloc heap:\s+(\d+)`)
	if match := heapSizeRe.FindStringSubmatch(result.Output); match != nil {
		// Heap Size 从 native heap 行解析
	}

	// 从 Total 行解析 Heap Size 和 Alloc
	// 查找包含 Heap Size 的数据
	// 从表格 Total 行中提取 Heap 信息（第 8、9、10 列）
	heapRe := regexp.MustCompile(`Total\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)\s+(\d+)`)
	if match := heapRe.FindStringSubmatch(result.Output); match != nil {
		if val, err := strconv.ParseInt(match[1], 10, 64); err == nil {
			detail.HeapSize = val
		}
		if val, err := strconv.ParseInt(match[2], 10, 64); err == nil {
			detail.HeapAlloc = val
		}
	}

	// 解析 DMA
	if match := regexp.MustCompile(`Dma:\s*(\d+)\s*kB`).FindStringSubmatch(result.Output); match != nil {
		if val, err := strconv.ParseInt(match[1], 10, 64); err == nil {
			detail.Dma = val
		}
	}

	// 解析 Ashmem
	if match := regexp.MustCompile(`Total Ashmem:\s*(\d+)\s*kB`).FindStringSubmatch(result.Output); match != nil {
		if val, err := strconv.ParseInt(match[1], 10, 64); err == nil {
			detail.Ashmem = val
		}
	}

	return detail, nil
}

// GetFaultLogList 获取故障日志列表（使用 hidumper -e --list）
func GetFaultLogList(connectKey string, processName string, n int) ([]FaultLogEntry, error) {
	args := []string{"-t", connectKey, "shell", "hidumper", "-e", "--list", "-n", strconv.Itoa(n)}
	if processName != "" {
		args = []string{"-t", connectKey, "shell", "hidumper", "-e", "--list", processName, "-n", strconv.Itoa(n)}
	}

	result, err := ExecuteHdc(args)
	if err != nil {
		return nil, fmt.Errorf("failed to get fault log list: %w", err)
	}

	entries := []FaultLogEntry{}

	if !result.Success || result.Output == "" {
		return entries, nil
	}

	lines := strings.Split(result.Output, "\n")
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "time") || strings.HasPrefix(trimmed, "no records") {
			continue
		}

		fields := strings.Fields(trimmed)
		// 格式: 2026-04-24 16:01:46  False  LowMemoryKill  09668447288596707695  com.ohos.mms
		// 时间可能占 2 个字段 (日期 + 时间)
		if len(fields) >= 6 {
			timeStr := fields[0] + " " + fields[1]
			foreground := fields[2] == "True"
			reason := fields[3]
			recordId := fields[4]
			processName := fields[5]

			entries = append(entries, FaultLogEntry{
				Time:        timeStr,
				Foreground:  foreground,
				Reason:      reason,
				RecordId:    recordId,
				ProcessName: processName,
			})
		}
	}

	return entries, nil
}

// GetFaultLogDetail 获取故障日志详情（使用 hidumper -e --print recordId）
func GetFaultLogDetail(connectKey string, recordId string) (string, error) {
	result, err := ExecuteHdc([]string{"-t", connectKey, "shell", "hidumper", "-e", "--print", recordId})
	if err != nil {
		return "", fmt.Errorf("failed to get fault log detail: %w", err)
	}

	if !result.Success || result.Output == "" {
		return "", nil
	}

	return strings.TrimSpace(result.Output), nil
}

// GetProcessIOInfo 获取进程 IO 信息（使用 hidumper --storage {pid}）
func GetProcessIOInfo(connectKey string, pid int) (*ProcessIOInfo, error) {
	pidStr := strconv.Itoa(pid)
	result, err := ExecuteHdc([]string{"-t", connectKey, "shell", "hidumper", "--storage", pidStr})
	if err != nil {
		return nil, fmt.Errorf("failed to get process IO info: %w", err)
	}

	info := &ProcessIOInfo{}

	if !result.Success || result.Output == "" {
		return info, nil
	}

	output := result.Output

	parseIOField := func(pattern string) int64 {
		match := regexp.MustCompile(pattern).FindStringSubmatch(output)
		if match != nil {
			if val, err := strconv.ParseInt(match[1], 10, 64); err == nil {
				return val
			}
		}
		return 0
	}

	info.Rchar = parseIOField(`rchar:\s*(\d+)`)
	info.Wchar = parseIOField(`wchar:\s*(\d+)`)
	info.Syscr = parseIOField(`syscr:\s*(\d+)`)
	info.Syscw = parseIOField(`syscw:\s*(\d+)`)
	info.ReadBytes = parseIOField(`read_bytes:\s*(\d+)`)
	info.WriteBytes = parseIOField(`write_bytes:\s*(\d+)`)
	info.CancelledWriteBytes = parseIOField(`cancelled_write_bytes:\s*(\d+)`)

	return info, nil
}

// StartIpcStat 开始 IPC 统计（使用 hidumper --ipc {pid} --start-stat）
func StartIpcStat(connectKey string, pid int) error {
	pidStr := strconv.Itoa(pid)
	result, err := ExecuteHdc([]string{"-t", connectKey, "shell", "hidumper", "--ipc", pidStr, "--start-stat"})
	if err != nil {
		return fmt.Errorf("failed to start IPC stat: %w", err)
	}
	if result != nil && !result.Success {
		return fmt.Errorf("failed to start IPC stat: %s", result.Error)
	}
	return nil
}

// GetIpcStat 获取 IPC 统计数据（使用 hidumper --ipc {pid} --stat）
func GetIpcStat(connectKey string, pid int) (*IpcStatInfo, error) {
	pidStr := strconv.Itoa(pid)
	result, err := ExecuteHdc([]string{"-t", connectKey, "shell", "hidumper", "--ipc", pidStr, "--stat"})
	if err != nil {
		return nil, fmt.Errorf("failed to get IPC stat: %w", err)
	}

	info := &IpcStatInfo{
		Interfaces: []IpcInterface{},
	}

	if !result.Success || result.Output == "" {
		return info, nil
	}

	output := result.Output

	// 解析全局统计
	if match := regexp.MustCompile(`TotalCount:\s*(\d+)`).FindStringSubmatch(output); match != nil {
		if val, err := strconv.ParseInt(match[1], 10, 64); err == nil {
			info.TotalCount = val
		}
	}
	if match := regexp.MustCompile(`TotalTimeCost:\s*(\d+)`).FindStringSubmatch(output); match != nil {
		if val, err := strconv.ParseInt(match[1], 10, 64); err == nil {
			info.TotalTimeCost = val
		}
	}

	// 解析各接口统计
	// CallingPid:1673
	// CallingPidTotalCount:1
	// CallingPidTotalTimeCost:73
	// DescriptorCode:OHOS.ILocalAbilityManager_6
	// DescriptorCodeCount:2
	// Total:2214 | Max:1444 | Min:770 | Avg:1107
	lines := strings.Split(output, "\n")
	var currentIface *IpcInterface
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)

		if match := regexp.MustCompile(`DescriptorCode:\s*(.+)`).FindStringSubmatch(trimmed); match != nil {
			if currentIface != nil {
				info.Interfaces = append(info.Interfaces, *currentIface)
			}
			currentIface = &IpcInterface{
				DescriptorCode: strings.TrimSpace(match[1]),
			}
		}

		if currentIface == nil {
			// 尝试提取 CallingPid
			if match := regexp.MustCompile(`CallingPid:\s*(\d+)`).FindStringSubmatch(trimmed); match != nil {
				if currentIface == nil {
					currentIface = &IpcInterface{}
				}
				currentIface.CallingPid, _ = strconv.Atoi(match[1])
			}
			continue
		}

		if match := regexp.MustCompile(`CallingPid:\s*(\d+)`).FindStringSubmatch(trimmed); match != nil {
			currentIface.CallingPid, _ = strconv.Atoi(match[1])
		}
		if match := regexp.MustCompile(`DescriptorCodeCount:\s*(\d+)`).FindStringSubmatch(trimmed); match != nil {
			currentIface.Count, _ = strconv.Atoi(match[1])
		}
		if match := regexp.MustCompile(`Total:\s*(\d+)\s*\|\s*Max:\s*(\d+)\s*\|\s*Min:\s*(\d+)\s*\|\s*Avg:\s*(\d+)`).FindStringSubmatch(trimmed); match != nil {
			currentIface.AvgTime, _ = strconv.ParseInt(match[1], 10, 64) // Total
			currentIface.MaxTime, _ = strconv.ParseInt(match[2], 10, 64)
			currentIface.MinTime, _ = strconv.ParseInt(match[3], 10, 64)
			currentIface.AvgTime, _ = strconv.ParseInt(match[4], 10, 64) // Avg
		}
	}
	if currentIface != nil {
		info.Interfaces = append(info.Interfaces, *currentIface)
	}

	return info, nil
}

// StopIpcStat 停止 IPC 统计（使用 hidumper --ipc {pid} --stop-stat）
func StopIpcStat(connectKey string, pid int) error {
	pidStr := strconv.Itoa(pid)
	result, err := ExecuteHdc([]string{"-t", connectKey, "shell", "hidumper", "--ipc", pidStr, "--stop-stat"})
	if err != nil {
		return fmt.Errorf("failed to stop IPC stat: %w", err)
	}
	if result != nil && !result.Success {
		return fmt.Errorf("failed to stop IPC stat: %s", result.Error)
	}
	return nil
}

// GetUptimeInfo 获取系统运行时间（精确版）
func GetUptimeInfo(connectKey string) (map[string]interface{}, error) {
	result, err := ExecuteHdc([]string{"-t", connectKey, "shell", "uptime"})
	if err != nil {
		return map[string]interface{}{
			"uptime":      "Unknown",
			"uptimeDays":  0,
			"loadAverage": "0, 0, 0",
		}, nil
	}

	if !result.Success || result.Output == "" {
		return map[string]interface{}{
			"uptime":      "Unknown",
			"uptimeDays":  0,
			"loadAverage": "0, 0, 0",
		}, nil
	}

	output := strings.TrimSpace(result.Output)

	// 解析运行时间
	// 格式: 09:17:56 up 38 days, 23:42,  0 users,  load average: 15.47, 13.14, 12.78
	uptime := "Unknown"
	uptimeDays := 0

	uptimeMatch := regexp.MustCompile(`up\s+(.+?),\s*\d+\s*users?`).FindStringSubmatch(output)
	if uptimeMatch != nil {
		uptime = strings.TrimSpace(uptimeMatch[1])
		// 提取天数
		daysMatch := regexp.MustCompile(`(\d+)\s*days?`).FindStringSubmatch(uptime)
		if daysMatch != nil {
			if val, err := strconv.Atoi(daysMatch[1]); err == nil {
				uptimeDays = val
			}
		}
	}

	loadMatch := regexp.MustCompile(`load average:\s*([\d.,\s]+)`).FindStringSubmatch(output)
	loadAverage := "0, 0, 0"
	if loadMatch != nil {
		loadAverage = strings.TrimSpace(loadMatch[1])
	}

	return map[string]interface{}{
		"uptime":      uptime,
		"uptimeDays":  uptimeDays,
		"loadAverage": loadAverage,
	}, nil
}

