package adb

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"

	"Hadice/backend/hdc"
)

// GetCpuDetailInfo 获取 Android 设备的详细 CPU 使用信息
// 使用 /proc/stat 和 /proc/loadavg
func GetCpuDetailInfo(connectKey string) (*hdc.CpuDetailInfo, error) {
	// 获取 CPU 统计信息
	statResult, err := ExecuteAdb([]string{"-s", connectKey, "shell", "cat", "/proc/stat"})
	if err != nil {
		return nil, fmt.Errorf("failed to get CPU stat: %w", err)
	}

	// 获取负载均值
	loadResult, _ := ExecuteAdb([]string{"-s", connectKey, "shell", "cat", "/proc/loadavg"})

	defaultInfo := &hdc.CpuDetailInfo{
		Total:  0,
		User:   0,
		System: 0,
		Kernel: 0,
		Idle:   100,
		Iowait: 0,
		Irq:    0,
	}

	if statResult.Success && statResult.Output != "" {
		// 解析 /proc/stat 第一行
		// 格式: cpu  user nice system idle iowait irq softirq steal guest guest_nice
		// 示例: cpu  15486998 1479760 20259940 167573496 364097 6299751 752475 0 0 0
		cpuLine := ""
		lines := strings.Split(statResult.Output, "\n")
		for _, line := range lines {
			if strings.HasPrefix(line, "cpu ") {
				cpuLine = strings.TrimSpace(line)
				break
			}
		}

		if cpuLine != "" {
			fields := strings.Fields(cpuLine)
			if len(fields) >= 8 {
				// fields[0] = "cpu"
				user, _ := strconv.ParseFloat(fields[1], 64)
				nice, _ := strconv.ParseFloat(fields[2], 64)
				system, _ := strconv.ParseFloat(fields[3], 64)
				idle, _ := strconv.ParseFloat(fields[4], 64)
				iowait, _ := strconv.ParseFloat(fields[5], 64)
				irq, _ := strconv.ParseFloat(fields[6], 64)

				total := user + nice + system + idle + iowait + irq
				if total > 0 {
					defaultInfo.Total = (total - idle) / total * 100
					defaultInfo.User = (user + nice) / total * 100
					defaultInfo.System = system / total * 100
					defaultInfo.Kernel = system / total * 100
					defaultInfo.Idle = idle / total * 100
					defaultInfo.Iowait = iowait / total * 100
					defaultInfo.Irq = irq / total * 100
				}
			}
		}
	}

	// 解析负载均值
	// 格式: 18.48 18.55 19.59 4/12069 2887
	if loadResult != nil && loadResult.Success && loadResult.Output != "" {
		fields := strings.Fields(loadResult.Output)
		if len(fields) >= 3 {
			defaultInfo.LoadAverage.One, _ = strconv.ParseFloat(fields[0], 64)
			defaultInfo.LoadAverage.Five, _ = strconv.ParseFloat(fields[1], 64)
			defaultInfo.LoadAverage.Fifteen, _ = strconv.ParseFloat(fields[2], 64)
		}
	}

	return defaultInfo, nil
}

// GetMemoryDetailInfo 获取 Android 设备的详细内存信息
// 使用 /proc/meminfo
func GetMemoryDetailInfo(connectKey string) (*hdc.MemoryDetailInfo, error) {
	result, err := ExecuteAdb([]string{"-s", connectKey, "shell", "cat", "/proc/meminfo"})
	if err != nil {
		return nil, fmt.Errorf("failed to get memory info: %w", err)
	}

	defaultInfo := &hdc.MemoryDetailInfo{
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

// GetNetworkTrafficInfo 获取 Android 设备的网络流量信息
// 使用 /proc/net/dev
func GetNetworkTrafficInfo(connectKey string) ([]hdc.NetworkTrafficInfo, error) {
	result, err := ExecuteAdb([]string{"-s", connectKey, "shell", "cat", "/proc/net/dev"})
	if err != nil {
		return nil, fmt.Errorf("failed to get network traffic: %w", err)
	}

	if !result.Success || result.Output == "" {
		return []hdc.NetworkTrafficInfo{}, nil
	}

	networks := []hdc.NetworkTrafficInfo{}
	lines := strings.Split(result.Output, "\n")

	for _, line := range lines {
		// 跳过表头
		if strings.Contains(line, "Inter-") || strings.Contains(line, "face") {
			continue
		}

		// 匹配网络接口
		// 格式: wlan0: 7570986   10609    0 5414    0     0          0         0  1420601    8750   10    0    0     0       0          0
		// 接口名:rxBytes rxPackets rxErrs rxDrop ... txBytes txPackets ...
		match := regexp.MustCompile(`^\s*(wlan\d+|rmnet\d+|eth\d+|ccmni\d+|tun\d+):\s*(\d+)\s+(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)\s+(\d+)`).FindStringSubmatch(line)
		if match != nil {
			rxBytes, _ := strconv.ParseInt(match[2], 10, 64)
			rxPackets, _ := strconv.ParseInt(match[3], 10, 64)
			txBytes, _ := strconv.ParseInt(match[4], 10, 64)
			txPackets, _ := strconv.ParseInt(match[5], 10, 64)

			// 只添加有流量的接口
			if rxBytes > 0 || txBytes > 0 {
				networks = append(networks, hdc.NetworkTrafficInfo{
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

// GetGraphicsInfo 获取 Android 设备的图形性能信息
// 使用 dumpsys SurfaceFlinger 获取 GPU 信息
func GetGraphicsInfo(connectKey string) (*hdc.GraphicsInfo, error) {
	defaultInfo := &hdc.GraphicsInfo{
		GpuVendor:     "Unknown",
		GpuRenderer:   "Unknown",
		GpuVersion:    "Unknown",
		SurfaceMemory: 0,
	}

	// 获取 GPU 信息
	result, err := ExecuteAdb([]string{"-s", connectKey, "shell", "dumpsys", "SurfaceFlinger"})
	if err != nil {
		// 如果失败，尝试获取硬件属性
		hwResult, _ := ExecuteAdb([]string{"-s", connectKey, "shell", "getprop", "ro.hardware"})
		if hwResult != nil && hwResult.Success && hwResult.Output != "" {
			defaultInfo.GpuVendor = strings.TrimSpace(hwResult.Output)
			defaultInfo.GpuRenderer = strings.TrimSpace(hwResult.Output)
		}
		return defaultInfo, nil
	}

	if !result.Success || result.Output == "" {
		return defaultInfo, nil
	}

	output := result.Output

	// 解析 GLES 信息
	lines := strings.Split(output, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "GLES:") {
			parts := strings.SplitN(line, ":", 2)
			if len(parts) == 2 {
				glesInfo := strings.TrimSpace(parts[1])
				glesParts := strings.Split(glesInfo, ",")
				if len(glesParts) >= 3 {
					defaultInfo.GpuVendor = strings.TrimSpace(glesParts[0])
					defaultInfo.GpuRenderer = strings.TrimSpace(glesParts[1])
					defaultInfo.GpuVersion = strings.TrimSpace(strings.Join(glesParts[2:], ","))
				}
			}
			break
		}
	}

	// 解析 GPU 内存缓存
	cacheMatch := regexp.MustCompile(`Skia's GPU Caches:\s*(\d+)\s*bytes`).FindStringSubmatch(output)
	if cacheMatch != nil {
		if val, err := strconv.ParseInt(cacheMatch[1], 10, 64); err == nil {
			defaultInfo.SurfaceMemory = val / (1024 * 1024)
		}
	}

	return defaultInfo, nil
}

// GetGraphicsInfoWithPid 获取 GPU 信息 + FPS 帧数（通过 dumpsys gfxinfo）
func GetGraphicsInfoWithPid(connectKey string, pid int) (*hdc.GraphicsInfo, error) {
	info, err := GetGraphicsInfo(connectKey)
	if err != nil {
		return info, err
	}

	if pid <= 0 {
		return info, nil
	}

	// 从 PID 获取包名
	pkgName := getPackageNameFromPid(connectKey, pid)
	if pkgName == "" {
		return info, nil
	}

	// 获取帧数统计
	gfxResult, err := ExecuteAdb([]string{"-s", connectKey, "shell", "dumpsys", "gfxinfo", pkgName})
	if err != nil || !gfxResult.Success || gfxResult.Output == "" {
		return info, nil
	}

	// 解析 Total frames rendered: 76137
	if match := regexp.MustCompile(`Total frames rendered:\s*(\d+)`).FindStringSubmatch(gfxResult.Output); match != nil {
		if val, err := strconv.Atoi(match[1]); err == nil {
			info.FpsCount.Fps60 = val // 复用 fps60 字段存储总帧数
		}
	}

	return info, nil
}

// GetUptimeInfo 获取 Android 设备的系统运行时间
// 使用 uptime 命令
func GetUptimeInfo(connectKey string) (map[string]interface{}, error) {
	result, err := ExecuteAdb([]string{"-s", connectKey, "shell", "uptime"})
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
	// 格式: 16:26:51 up 5 days,  1:28,  0 users,  load average: 19.24, 18.71, 19.63
	uptime := "Unknown"
	uptimeDays := 0

	// 提取 up 之后到 users 之前的部分
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

	// 提取负载均值
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

// ===== 新增：安卓进程级性能数据采集 =====

// GetProcessCpuUsage 获取进程级 CPU 使用率（使用 top -b -n 1）
func GetProcessCpuUsage(connectKey string, pid int) ([]hdc.ProcessCpuEntry, error) {
	result, err := ExecuteAdb([]string{"-s", connectKey, "shell", "top", "-b", "-n", "1"})
	if err != nil {
		return nil, fmt.Errorf("failed to get process cpu usage: %w", err)
	}

	if !result.Success || result.Output == "" {
		return nil, nil
	}

	// 解析 top 输出:
	// PID USER         PR  NI VIRT  RES  SHR S[%CPU] %MEM     TIME+ ARGS
	// 16950 u0_a316    20   0  53G 1.1G 721M S 50.0  10.4  22:31.57 tv.danmaku.bili
	var entries []hdc.ProcessCpuEntry
	lines := strings.Split(result.Output, "\n")
	for _, line := range lines {
		fields := strings.Fields(line)
		if len(fields) < 9 {
			continue
		}
		// 第一列必须是数字（PID）
		pidVal, err := strconv.Atoi(fields[0])
		if err != nil {
			continue
		}
		// %CPU 列（fields[8]），可能带方括号如 [50.0]
		cpuStr := strings.Trim(fields[8], "[]")
		cpuVal, err := strconv.ParseFloat(cpuStr, 64)
		if err != nil {
			continue
		}
		// 进程名：最后一列（fields[11+]），内核线程带方括号
		name := ""
		if len(fields) > 11 {
			name = strings.Join(fields[11:], " ")
		} else if len(fields) == 11 {
			name = fields[10]
		}
		name = strings.Trim(name, "[]")

		entry := hdc.ProcessCpuEntry{
			Pid:         pidVal,
			TotalUsage:  cpuVal,
			UserSpace:   cpuVal, // top 无法区分 user/kernel，全部记为 user
			KernelSpace: 0,
			Name:        name,
		}

		if pid > 0 {
			if pidVal == pid {
				return []hdc.ProcessCpuEntry{entry}, nil
			}
			continue
		}
		entries = append(entries, entry)
	}
	return entries, nil
}

// GetCpuFreqInfo 获取 CPU 频率信息（读取 sysfs）
func GetCpuFreqInfo(connectKey string) (*hdc.CpuFreqInfo, error) {
	info := &hdc.CpuFreqInfo{Cores: []hdc.CpuFreqCore{}}

	// 获取在线 CPU 范围
	onlineResult, err := ExecuteAdb([]string{"-s", connectKey, "shell", "cat", "/sys/devices/system/cpu/online"})
	if err != nil || !onlineResult.Success || onlineResult.Output == "" {
		return info, nil
	}

	// 解析范围如 "0-7" 或 "0-3,4-7"
	cpuIndices := parseCpuRange(strings.TrimSpace(onlineResult.Output))
	if len(cpuIndices) == 0 {
		return info, nil
	}

	for _, cpuNum := range cpuIndices {
		// 读取当前频率（优先 scaling_cur_freq，其次 cpuinfo_cur_freq）
		curFreq := 0
		curResult, err := ExecuteAdb([]string{"-s", connectKey, "shell", "cat",
			fmt.Sprintf("/sys/devices/system/cpu/cpu%d/cpufreq/scaling_cur_freq", cpuNum)})
		if err == nil && curResult.Success && curResult.Output != "" {
			curFreq, _ = strconv.Atoi(strings.TrimSpace(curResult.Output))
		}
		if curFreq == 0 {
			curResult, err = ExecuteAdb([]string{"-s", connectKey, "shell", "cat",
				fmt.Sprintf("/sys/devices/system/cpu/cpu%d/cpufreq/cpuinfo_cur_freq", cpuNum)})
			if err == nil && curResult.Success && curResult.Output != "" {
				curFreq, _ = strconv.Atoi(strings.TrimSpace(curResult.Output))
			}
		}

		// 读取最大频率
		maxFreq := 0
		maxResult, err := ExecuteAdb([]string{"-s", connectKey, "shell", "cat",
			fmt.Sprintf("/sys/devices/system/cpu/cpu%d/cpufreq/cpuinfo_max_freq", cpuNum)})
		if err == nil && maxResult.Success && maxResult.Output != "" {
			maxFreq, _ = strconv.Atoi(strings.TrimSpace(maxResult.Output))
		}

		if curFreq > 0 || maxFreq > 0 {
			info.Cores = append(info.Cores, hdc.CpuFreqCore{
				Core:        cpuNum,
				CurrentFreq: curFreq,
				MaxFreq:     maxFreq,
			})
		}
	}

	return info, nil
}

// parseCpuRange 解析 CPU 范围字符串，如 "0-7" 或 "0-3,4-7"
func parseCpuRange(s string) []int {
	var indices []int
	parts := strings.Split(s, ",")
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if strings.Contains(part, "-") {
			rangeParts := strings.Split(part, "-")
			if len(rangeParts) == 2 {
				start, err1 := strconv.Atoi(rangeParts[0])
				end, err2 := strconv.Atoi(rangeParts[1])
				if err1 == nil && err2 == nil {
					for i := start; i <= end; i++ {
						indices = append(indices, i)
					}
				}
			}
		} else {
			if val, err := strconv.Atoi(part); err == nil {
				indices = append(indices, val)
			}
		}
	}
	sort.Ints(indices)
	return indices
}

// GetProcessMemoryDetail 获取进程内存详情（使用 dumpsys meminfo）
func GetProcessMemoryDetail(connectKey string, pid int) (*hdc.ProcessMemoryDetail, error) {
	detail := &hdc.ProcessMemoryDetail{
		Categories: []hdc.ProcessMemoryCategory{},
	}

	result, err := ExecuteAdb([]string{"-s", connectKey, "shell", "dumpsys", "meminfo", strconv.Itoa(pid)})
	if err != nil || !result.Success || result.Output == "" {
		return detail, nil
	}

	output := result.Output
	lines := strings.Split(output, "\n")

	// 解析详细区域（在 ** MEMINFO 和 App Summary 之间）
	// 格式: "  Native Heap   270911   270868       24   171280   272332   649084   462118   182649"
	inDetail := false
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "** MEMINFO") || strings.HasPrefix(trimmed, "Pss") && strings.Contains(trimmed, "Private") {
			inDetail = true
			continue
		}
		if strings.HasPrefix(trimmed, "App Summary") {
			inDetail = false
			continue
		}
		if strings.HasPrefix(trimmed, "------") {
			continue
		}
		if strings.HasPrefix(trimmed, "TOTAL") || strings.HasPrefix(trimmed, "Objects") {
			inDetail = false
			continue
		}
		if !inDetail {
			continue
		}

		// 解析分类行：名称 + 数字列
		fields := strings.Fields(trimmed)
		if len(fields) < 2 {
			continue
		}
		// 找名称：从开头到第一个数字之间的所有 token
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
		pssTotal, _ := strconv.ParseInt(fields[pssIdx], 10, 64)
		if pssTotal == 0 {
			continue
		}
		detail.Categories = append(detail.Categories, hdc.ProcessMemoryCategory{
			Name:     name,
			PssTotal: pssTotal,
		})
	}

	// 从 App Summary 区域提取关键字段
	if match := regexp.MustCompile(`TOTAL PSS:\s*(\d+)`).FindStringSubmatch(output); match != nil {
		detail.TotalPss, _ = strconv.ParseInt(match[1], 10, 64)
	}
	if match := regexp.MustCompile(`TOTAL SWAP PSS:\s*(\d+)`).FindStringSubmatch(output); match != nil {
		detail.SwapUsed, _ = strconv.ParseInt(match[1], 10, 64)
	}

	// Heap: Java Heap + Native Heap 的 Heap Size 列
	// 从详细区域提取 Heap Size（第7列）和 Heap Alloc（第8列）
	heapSize := int64(0)
	heapAlloc := int64(0)
	heapSizeRe := regexp.MustCompile(`(?:Native|Dalvik) Heap\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)\s+(\d+)`)
	matches := heapSizeRe.FindAllStringSubmatch(output, -1)
	for _, m := range matches {
		if s, err := strconv.ParseInt(m[1], 10, 64); err == nil {
			heapSize += s
		}
		if a, err := strconv.ParseInt(m[2], 10, 64); err == nil {
			heapAlloc += a
		}
	}
	detail.HeapSize = heapSize
	detail.HeapAlloc = heapAlloc

	return detail, nil
}

// faultLogCache 缓存崩溃日志详情
var (
	faultLogCache   = make(map[string]string)
	faultLogCacheMu sync.Mutex
)

// GetFaultLogList 获取崩溃日志列表（使用 dumpsys dropbox）
func GetFaultLogList(connectKey string, processName string, n int) ([]hdc.FaultLogEntry, error) {
	result, err := ExecuteAdbWithTimeout([]string{"-s", connectKey, "shell", "dumpsys", "dropbox", "--print"}, 15*1e9)
	if err != nil || !result.Success || result.Output == "" {
		return []hdc.FaultLogEntry{}, nil
	}

	// 按 "========" 分割条目
	blocks := strings.Split(result.Output, "========================================")
	var entries []hdc.FaultLogEntry
	faultLogCacheMu.Lock()
	defer faultLogCacheMu.Unlock()

	for i := len(blocks) - 1; i >= 0 && len(entries) < n; i-- {
		block := blocks[i]
		// 跳过非 TOMBSTONE 条目
		if !strings.Contains(block, "SYSTEM_TOMBSTONE") && !strings.Contains(block, "DATA_APP_CRASH") && !strings.Contains(block, "SYSTEM_APP_CRASH") {
			continue
		}

		// 提取时间
		timeStr := ""
		if match := regexp.MustCompile(`Time:\s*(20\d{2}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})`).FindStringSubmatch(block); match != nil {
			timeStr = match[1]
		}
		if timeStr == "" {
			// 从块头部提取日期
			if match := regexp.MustCompile(`(20\d{2}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+SYSTEM_TOMBSTONE`).FindStringSubmatch(block); match != nil {
				timeStr = match[1]
			}
		}
		if timeStr == "" {
			continue
		}

		// 提取进程名
		cmdName := ""
		if match := regexp.MustCompile(`Cmdline:\s*(\S+)`).FindStringSubmatch(block); match != nil {
			cmdName = match[1]
		}
		if cmdName == "" {
			continue
		}

		// 按进程名过滤
		if processName != "" && !strings.Contains(cmdName, processName) {
			continue
		}

		// 提取崩溃原因
		reason := "Unknown"
		if match := regexp.MustCompile(`signal\s+(\d+\s*\([^)]+\))`).FindStringSubmatch(block); match != nil {
			reason = match[1]
		} else if match := regexp.MustCompile(`FATAL\s+EXCEPTION:\s*(.+)`).FindStringSubmatch(block); match != nil {
			reason = strings.TrimSpace(match[1])
		}

		// 生成 recordId 并缓存详情
		recordId := timeStr + "_" + cmdName
		recordId = strings.ReplaceAll(recordId, " ", "_")
		faultLogCache[recordId] = strings.TrimSpace(block)

		entries = append(entries, hdc.FaultLogEntry{
			Time:        timeStr,
			Foreground:  true,
			Reason:      reason,
			RecordId:    recordId,
			ProcessName: cmdName,
		})
	}

	// 结果已按时间倒序，反转为正序
	for i, j := 0, len(entries)-1; i < j; i, j = i+1, j-1 {
		entries[i], entries[j] = entries[j], entries[i]
	}

	return entries, nil
}

// GetFaultLogDetail 获取崩溃日志详情（从缓存读取）
func GetFaultLogDetail(connectKey string, recordId string) (string, error) {
	faultLogCacheMu.Lock()
	defer faultLogCacheMu.Unlock()
	if content, ok := faultLogCache[recordId]; ok {
		return content, nil
	}
	return "", nil
}

// GetProcessIOInfo 获取进程 IO 信息（Android 非 root 无法读取，返回零值）
func GetProcessIOInfo(connectKey string, pid int) (*hdc.ProcessIOInfo, error) {
	return &hdc.ProcessIOInfo{}, nil
}

// getPackageNameFromPid 从 PID 获取包名（读取 /proc/{pid}/cmdline）
func getPackageNameFromPid(connectKey string, pid int) string {
	result, err := ExecuteAdb([]string{"-s", connectKey, "shell", "cat", fmt.Sprintf("/proc/%d/cmdline", pid)})
	if err != nil || !result.Success || result.Output == "" {
		return ""
	}
	// cmdline 以 null 字符分隔，第一个字段就是包名
	pkg := strings.Split(result.Output, "\x00")[0]
	return strings.TrimSpace(pkg)
}
