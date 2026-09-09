package adb

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"Hadice/backend/device"
)

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

type ProcessStats struct {
	Total    int `json:"total"`
	Running  int `json:"running"`
	Sleeping int `json:"sleeping"`
	Stopped  int `json:"stopped"`
	Zombie   int `json:"zombie"`
}

type ProcessListResult struct {
	Stats     ProcessStats  `json:"stats"`
	Processes []ProcessInfo `json:"processes"`
}

type ProcessSortField string

const (
	SortByPid  ProcessSortField = "pid"
	SortByCpu  ProcessSortField = "cpu"
	SortByMem  ProcessSortField = "mem"
	SortByTime ProcessSortField = "time"
)

func GetProcessList(connectKey string, sortBy ProcessSortField) (*ProcessListResult, error) {
	// 使用 top 命令获取带 CPU%/MEM% 的进程列表
	// -n 1: 只刷新一次
	// -b: batch 模式
	// -s 6: 按内存排序（有效进程通常占用更多内存）
	sortArg := "6"
	if sortBy == SortByCpu {
		sortArg = "5" // 按 CPU 排序
	} else if sortBy == SortByPid {
		sortArg = "1"
	}

	result, err := ExecuteAdbWithTimeout([]string{"-s", connectKey, "shell", "top", "-n", "1", "-b", "-s", sortArg}, 15*time.Second)
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

	stateCount := make(map[string]int)
	zeroCount := 0

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		// 跳过统计行和表头
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

		if strings.Contains(line, "Mem:") || strings.Contains(line, "Swap:") ||
			strings.Contains(line, "PID") || strings.Contains(line, "%CPU") ||
			strings.Contains(line, "User") {
			continue
		}

		// 解析进程行: PID USER PR NI VIRT RES SHR S %CPU %MEM TIME+ ARGS
		parts := regexp.MustCompile(`\s+`).Split(line, -1)
		if len(parts) < 11 {
			continue
		}

		pid, err := strconv.Atoi(parts[0])
		if err != nil {
			continue
		}

		user := parts[1]
		priority, _ := strconv.Atoi(parts[2])
		nice, _ := strconv.Atoi(parts[3])
		virt := parts[4]
		res := parts[5]
		shr := parts[6]
		state := parts[7]
		cpuPercent, _ := strconv.ParseFloat(parts[8], 64)
		memPercent, _ := strconv.ParseFloat(parts[9], 64)
		timeVal := parts[10]
		command := strings.Join(parts[11:], " ")
		if command == "" {
			command = user
		}

		// 过滤内核线程：用方括号包裹的命令名如 [kworker/...] [kthreadd] 等
		if strings.HasPrefix(command, "[") && strings.HasSuffix(command, "]") {
			continue
		}

		// 截断零占用进程：CPU 和内存都为 0 时跳过
		// 最多保留 50 个零占用进程（已按内存排序，前面的有意义的进程已收集）
		if cpuPercent == 0 && memPercent == 0 {
			zeroCount++
			if zeroCount > 50 {
				continue
			}
		}

		stateCount[state]++

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
			Time:       timeVal,
			Command:    command,
		})
	}

	if stats.Total == 0 {
		stats.Total = len(processes)
	}

	return &ProcessListResult{
		Stats:     stats,
		Processes: processes,
	}, nil
}

func KillProcess(connectKey string, pid int, force bool) (*AdbResult, error) {
	args := []string{"-s", connectKey, "shell", "kill"}
	if force {
		args = append(args, "-9")
	}
	args = append(args, strconv.Itoa(pid))

	return ExecuteAdb(args)
}

func ForceStopApp(connectKey string, packageName string) (*AdbResult, error) {
	args := []string{"-s", connectKey, "shell", "am", "force-stop", packageName}
	return ExecuteAdb(args)
}

func GetProcessDetail(connectKey string, pid int) (map[string]string, error) {
	result, err := ExecuteAdb([]string{"-s", connectKey, "shell", "cat", fmt.Sprintf("/proc/%d/status", pid)})
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

var processProvider = &ProcessProvider{}

type ProcessProvider struct{}

func GetProcessProvider() *ProcessProvider {
	return processProvider
}

func (p *ProcessProvider) GetProcessList(connectKey string, sortBy string) (*ProcessListResult, error) {
	return GetProcessList(connectKey, ProcessSortField(sortBy))
}

func (p *ProcessProvider) KillProcess(connectKey string, pid int, force bool) (*device.CommandResult, error) {
	result, err := KillProcess(connectKey, pid, force)
	if err != nil {
		return nil, err
	}
	return &device.CommandResult{
		Success: result.Success,
		Output:  result.Output,
		Error:   result.Error,
	}, nil
}

func (p *ProcessProvider) ForceStopApp(connectKey string, packageName string) (*device.CommandResult, error) {
	result, err := ForceStopApp(connectKey, packageName)
	if err != nil {
		return nil, err
	}
	return &device.CommandResult{
		Success: result.Success,
		Output:  result.Output,
		Error:   result.Error,
	}, nil
}

func (p *ProcessProvider) GetProcessDetail(connectKey string, pid int) (map[string]string, error) {
	return GetProcessDetail(connectKey, pid)
}
