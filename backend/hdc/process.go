package hdc

import (
	"context"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// ProcessInfo 进程信息
type ProcessInfo struct {
	Pid        int     `json:"pid"`
	User       string  `json:"user"`
	Priority   int     `json:"priority"`
	Nice       int     `json:"nice"`
	Virt       string  `json:"virt"`
	Res        string  `json:"res"`
	Shr        string  `json:"shr"`
	State      string  `json:"state"`
	CpuPercent float64 `json:"cpuPercent"`
	MemPercent float64 `json:"memPercent"`
	Time       string  `json:"time"`
	Command    string  `json:"command"`
}

// ProcessStats 进程统计信息
type ProcessStats struct {
	Total    int `json:"total"`
	Running  int `json:"running"`
	Sleeping int `json:"sleeping"`
	Stopped  int `json:"stopped"`
	Zombie   int `json:"zombie"`
}

// ProcessListResult 进程列表结果
type ProcessListResult struct {
	Stats     ProcessStats  `json:"stats"`
	Processes []ProcessInfo `json:"processes"`
}

// ProcessSortField 排序字段类型
type ProcessSortField string

const (
	SortByPid  ProcessSortField = "pid"
	SortByCpu  ProcessSortField = "cpu"
	SortByMem  ProcessSortField = "mem"
	SortByTime ProcessSortField = "time"
)

// GetProcessList 获取进程列表
// sortBy: 排序字段，默认按内存排序
func GetProcessList(connectKey string, sortBy ProcessSortField) (*ProcessListResult, error) {
	// top -s 参数: 1=PID, 5=%CPU, 6=RES(内存), 7=TIME
	sortMap := map[ProcessSortField]string{
		SortByPid:  "1",
		SortByCpu:  "5",
		SortByMem:  "6",
		SortByTime: "7",
	}

	sortArg := sortMap[sortBy]
	if sortArg == "" {
		sortArg = "6" // 默认按内存排序
	}

	// 使用较短的超时时间（15秒），避免阻塞太久
	result, err := ExecuteHdcWithTimeout([]string{"-t", connectKey, "shell", "top", "-n", "1", "-b", "-s", sortArg}, 15*time.Second)
	if err != nil {
		return nil, fmt.Errorf("failed to get process list: %w", err)
	}

	defaultResult := &ProcessListResult{
		Stats: ProcessStats{
			Total:    0,
			Running:  0,
			Sleeping: 0,
			Stopped:  0,
			Zombie:   0,
		},
		Processes: []ProcessInfo{},
	}

	if !result.Success || result.Output == "" {
		return defaultResult, nil
	}

	lines := strings.Split(result.Output, "\n")
	processes := []ProcessInfo{}
	stats := ProcessStats{}

	for _, line := range lines {
		// 解析统计行: Tasks: 193 total,   3 running, 189 sleeping,   0 stopped,   1 zombie
		if strings.Contains(line, "Tasks:") {
			parseInt := func(pattern string) int {
				match := regexp.MustCompile(pattern).FindStringSubmatch(line)
				if match != nil {
					if val, err := strconv.Atoi(match[1]); err == nil {
						return val
					}
				}
				return 0
			}

			stats.Total = parseInt(`(\d+)\s+total`)
			stats.Running = parseInt(`(\d+)\s+running`)
			stats.Sleeping = parseInt(`(\d+)\s+sleeping`)
			stats.Stopped = parseInt(`(\d+)\s+stopped`)
			stats.Zombie = parseInt(`(\d+)\s+zombie`)
			continue
		}

		// 跳过表头和其他行
		if line == "" || strings.Contains(line, "PID") || strings.Contains(line, "Mem:") ||
			strings.Contains(line, "Swap:") || strings.Contains(line, "%cpu") {
			continue
		}

		// 解析进程行
		// 格式: PID USER PR NI VIRT RES SHR S %CPU %MEM TIME+ ARGS
		parts := regexp.MustCompile(`\s+`).Split(strings.TrimSpace(line), -1)
		if len(parts) >= 11 {
			pid, err := strconv.Atoi(parts[0])
			if err != nil {
				continue
			}

			// 提取各字段
			user := parts[1]
			priority, _ := strconv.Atoi(parts[2])
			nice, _ := strconv.Atoi(parts[3])
			virt := parts[4]
			res := parts[5]
			shr := parts[6]
			state := parts[7]
			cpuPercent, _ := strconv.ParseFloat(parts[8], 64)
			memPercent, _ := strconv.ParseFloat(parts[9], 64)
			time := parts[10]
			// 命令可能包含空格，取剩余部分
			command := strings.Join(parts[11:], " ")
			if command == "" {
				command = user
			}

			processes = append(processes, ProcessInfo{
				Pid:        pid,
				User:       user,
				Priority:   priority,
				Nice:       nice,
				Virt:       virt,
				Res:        res,
				Shr:        shr,
				State:      state,
				CpuPercent: cpuPercent,
				MemPercent: memPercent,
				Time:       time,
				Command:    command,
			})
		}
	}

	return &ProcessListResult{
		Stats:     stats,
		Processes: processes,
	}, nil
}

// KillProcess 终止进程
// connectKey: 设备标识
// pid: 进程 ID
// force: 是否强制终止 (SIGKILL)
func KillProcess(connectKey string, pid int, force bool) (*HdcResult, error) {
	args := []string{"-t", connectKey, "shell", "kill"}
	if force {
		args = append(args, "-9")
	}
	args = append(args, strconv.Itoa(pid))

	return ExecuteHdc(args)
}

// ForceStopApp 使用 aa force-stop 命令停止应用
// connectKey: 设备标识
// packageName: 应用包名
func ForceStopApp(connectKey string, packageName string) (*HdcResult, error) {
	args := []string{"-t", connectKey, "shell", "aa", "force-stop", packageName}
	return ExecuteHdc(args)
}

// GetProcessDetail 获取进程详细信息
// connectKey: 设备标识
// pid: 进程 ID
func GetProcessDetail(connectKey string, pid int) (map[string]string, error) {
	result, err := ExecuteHdc([]string{"-t", connectKey, "shell", "cat", fmt.Sprintf("/proc/%d/status", pid)})
	if err != nil {
		return nil, fmt.Errorf("failed to get process detail: %w", err)
	}

	detail := make(map[string]string)

	if !result.Success || result.Output == "" {
		return detail, nil
	}

	lines := strings.Split(result.Output, "\n")
	for _, line := range lines {
		colonIndex := strings.Index(line, ":")
		if colonIndex > 0 {
			key := strings.TrimSpace(line[:colonIndex])
			value := strings.TrimSpace(line[colonIndex+1:])
			detail[key] = value
		}
	}

	return detail, nil
}

// GetProcessListAsync 异步获取进程列表
// 使用 goroutine + channel 实现异步处理，通过事件推送结果
// ctx: 上下文，用于发送事件
// connectKey: 设备标识
// sortBy: 排序字段
func GetProcessListAsync(ctx context.Context, connectKey string, sortBy ProcessSortField) error {
	if ctx == nil {
		return fmt.Errorf("context is required for async operation")
	}

	// 在 goroutine 中执行，不阻塞调用
	go func() {
		// top -s 参数: 1=PID, 5=%CPU, 6=RES(内存), 7=TIME
		sortMap := map[ProcessSortField]string{
			SortByPid:  "1",
			SortByCpu:  "5",
			SortByMem:  "6",
			SortByTime: "7",
		}

		sortArg := sortMap[sortBy]
		if sortArg == "" {
			sortArg = "6" // 默认按内存排序
		}

		// 使用较短的超时时间（15秒）
		result, err := ExecuteHdcWithTimeout([]string{"-t", connectKey, "shell", "top", "-n", "1", "-b", "-s", sortArg}, 15*time.Second)

		if err != nil {
			// 发送错误事件
			app := application.Get()
			if app != nil {
				app.Event.Emit("process-list-error", map[string]interface{}{
					"connectKey": connectKey,
					"error":      err.Error(),
				})
			}
			return
		}

		if !result.Success || result.Output == "" {
			// 发送空结果
			app := application.Get()
			if app != nil {
				app.Event.Emit("process-list-updated", map[string]interface{}{
					"connectKey": connectKey,
					"stats": map[string]interface{}{
						"total":    0,
						"running":  0,
						"sleeping": 0,
						"stopped":  0,
						"zombie":   0,
					},
					"processes": []interface{}{},
				})
			}
			return
		}

		// 解析进程列表
		lines := strings.Split(result.Output, "\n")
		processes := []ProcessInfo{}
		stats := ProcessStats{}

		for _, line := range lines {
			// 解析统计行: Tasks: 193 total,   3 running, 189 sleeping,   0 stopped,   1 zombie
			if strings.Contains(line, "Tasks:") {
				parseInt := func(pattern string) int {
					match := regexp.MustCompile(pattern).FindStringSubmatch(line)
					if match != nil {
						if val, err := strconv.Atoi(match[1]); err == nil {
							return val
						}
					}
					return 0
				}

				stats.Total = parseInt(`(\d+)\s+total`)
				stats.Running = parseInt(`(\d+)\s+running`)
				stats.Sleeping = parseInt(`(\d+)\s+sleeping`)
				stats.Stopped = parseInt(`(\d+)\s+stopped`)
				stats.Zombie = parseInt(`(\d+)\s+zombie`)
				continue
			}

			// 跳过表头和其他行
			if line == "" || strings.Contains(line, "PID") || strings.Contains(line, "Mem:") ||
				strings.Contains(line, "Swap:") || strings.Contains(line, "%cpu") {
				continue
			}

			// 解析进程行
			// 格式: PID USER PR NI VIRT RES SHR S %CPU %MEM TIME+ ARGS
			parts := regexp.MustCompile(`\s+`).Split(strings.TrimSpace(line), -1)
			if len(parts) >= 11 {
				pid, err := strconv.Atoi(parts[0])
				if err != nil {
					continue
				}

				// 提取各字段
				user := parts[1]
				priority, _ := strconv.Atoi(parts[2])
				nice, _ := strconv.Atoi(parts[3])
				virt := parts[4]
				res := parts[5]
				shr := parts[6]
				state := parts[7]
				cpuPercent, _ := strconv.ParseFloat(parts[8], 64)
				memPercent, _ := strconv.ParseFloat(parts[9], 64)
				time := parts[10]
				// 命令可能包含空格，取剩余部分
				command := strings.Join(parts[11:], " ")
				if command == "" {
					command = user
				}

				processes = append(processes, ProcessInfo{
					Pid:        pid,
					User:       user,
					Priority:   priority,
					Nice:       nice,
					Virt:       virt,
					Res:        res,
					Shr:        shr,
					State:      state,
					CpuPercent: cpuPercent,
					MemPercent: memPercent,
					Time:       time,
					Command:    command,
				})
			}
		}

		// 发送更新事件
		processesData := make([]map[string]interface{}, len(processes))
		for i, p := range processes {
			processesData[i] = map[string]interface{}{
				"pid":        p.Pid,
				"user":       p.User,
				"priority":   p.Priority,
				"nice":       p.Nice,
				"virt":       p.Virt,
				"res":        p.Res,
				"shr":        p.Shr,
				"state":      p.State,
				"cpuPercent": p.CpuPercent,
				"memPercent": p.MemPercent,
				"time":       p.Time,
				"command":    p.Command,
			}
		}

		app := application.Get()
		if app != nil {
			app.Event.Emit("process-list-updated", map[string]interface{}{
				"connectKey": connectKey,
				"stats": map[string]interface{}{
					"total":    stats.Total,
					"running":  stats.Running,
					"sleeping": stats.Sleeping,
					"stopped":  stats.Stopped,
					"zombie":   stats.Zombie,
				},
				"processes": processesData,
			})
		}
	}()

	return nil
}
