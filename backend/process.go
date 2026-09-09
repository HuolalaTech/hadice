package backend

import (
	"Hadice/backend/adb"
	"Hadice/backend/device"
	"Hadice/backend/hdc"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type ProcessListResult struct {
	Stats     ProcessStats    `json:"stats"`
	Processes []ProcessInfoUI `json:"processes"`
}

type ProcessStats struct {
	Total    int `json:"total"`
	Running  int `json:"running"`
	Sleeping int `json:"sleeping"`
	Stopped  int `json:"stopped"`
	Zombie   int `json:"zombie"`
}

type ProcessInfoUI struct {
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

func (a *App) GetProcessList(connectKey string, sortBy string) (*ProcessListResult, error) {
	result, err := hdc.GetProcessList(connectKey, hdc.ProcessSortField(sortBy))
	if err != nil {
		return nil, err
	}
	return convertHdcProcessResult(result), nil
}

func (a *App) GetProcessListByPlatform(connectKey string, sortBy string, platform string) (*ProcessListResult, error) {
	if platform == string(device.PlatformAndroid) {
		result, err := adb.GetProcessList(connectKey, adb.ProcessSortField(sortBy))
		if err != nil {
			return nil, err
		}
		return convertAdbProcessResult(result), nil
	}

	result, err := hdc.GetProcessList(connectKey, hdc.ProcessSortField(sortBy))
	if err != nil {
		return nil, err
	}
	return convertHdcProcessResult(result), nil
}

func convertAdbProcessResult(result *adb.ProcessListResult) *ProcessListResult {
	processes := make([]ProcessInfoUI, len(result.Processes))
	for i, p := range result.Processes {
		processes[i] = ProcessInfoUI{
			Pid:        p.Pid,
			User:       p.User,
			Priority:   p.Priority,
			Nice:       p.Nice,
			Virt:       p.Virt,
			Res:        p.Res,
			Shr:        p.Shr,
			State:      p.State,
			CpuPercent: p.CpuPercent,
			MemPercent: p.MemPercent,
			Time:       p.Time,
			Command:    p.Command,
		}
	}
	return &ProcessListResult{
		Stats: ProcessStats{
			Total:    result.Stats.Total,
			Running:  result.Stats.Running,
			Sleeping: result.Stats.Sleeping,
			Stopped:  result.Stats.Stopped,
			Zombie:   result.Stats.Zombie,
		},
		Processes: processes,
	}
}

func convertHdcProcessResult(result *hdc.ProcessListResult) *ProcessListResult {
	processes := make([]ProcessInfoUI, len(result.Processes))
	for i, p := range result.Processes {
		processes[i] = ProcessInfoUI{
			Pid:        p.Pid,
			User:       p.User,
			Priority:   p.Priority,
			Nice:       p.Nice,
			Virt:       p.Virt,
			Res:        p.Res,
			Shr:        p.Shr,
			State:      p.State,
			CpuPercent: p.CpuPercent,
			MemPercent: p.MemPercent,
			Time:       p.Time,
			Command:    p.Command,
		}
	}
	return &ProcessListResult{
		Stats: ProcessStats{
			Total:    result.Stats.Total,
			Running:  result.Stats.Running,
			Sleeping: result.Stats.Sleeping,
			Stopped:  result.Stats.Stopped,
			Zombie:   result.Stats.Zombie,
		},
		Processes: processes,
	}
}

func (a *App) GetProcessListAsync(connectKey string, sortBy string) error {
	return hdc.GetProcessListAsync(a.ctx, connectKey, hdc.ProcessSortField(sortBy))
}

func (a *App) GetProcessListAsyncByPlatform(connectKey string, sortBy string, platform string) error {
	if platform == string(device.PlatformAndroid) {
		return a.getProcessListAsyncAndroid(connectKey, sortBy)
	}
	return hdc.GetProcessListAsync(a.ctx, connectKey, hdc.ProcessSortField(sortBy))
}

func (a *App) getProcessListAsyncAndroid(connectKey string, sortBy string) error {
	if a.ctx == nil {
		return nil
	}

	go func() {
		result, err := adb.GetProcessList(connectKey, adb.ProcessSortField(sortBy))

		if err != nil {
			app := application.Get()
			if app != nil {
				app.Event.Emit("process-list-error", map[string]interface{}{
					"connectKey": connectKey,
					"error":      err.Error(),
				})
			}
			return
		}

		processesData := make([]map[string]interface{}, len(result.Processes))
		for i, p := range result.Processes {
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
					"total":    result.Stats.Total,
					"running":  result.Stats.Running,
					"sleeping": result.Stats.Sleeping,
					"stopped":  result.Stats.Stopped,
					"zombie":   result.Stats.Zombie,
				},
				"processes": processesData,
			})
		}
	}()

	return nil
}

func (a *App) KillProcess(connectKey string, pid int, force bool) (*hdc.HdcResult, error) {
	return hdc.KillProcess(connectKey, pid, force)
}

func (a *App) KillProcessByPlatform(connectKey string, pid int, force bool, platform string) (*CommandResult, error) {
	if platform == string(device.PlatformAndroid) {
		result, err := adb.KillProcess(connectKey, pid, force)
		if err != nil {
			return nil, err
		}
		return &CommandResult{
			Success: result.Success,
			Output:  result.Output,
			Error:   result.Error,
		}, nil
	}

	result, err := hdc.KillProcess(connectKey, pid, force)
	if err != nil {
		return nil, err
	}
	return &CommandResult{
		Success: result.Success,
		Output:  result.Output,
		Error:   result.Error,
	}, nil
}

type CommandResult struct {
	Success bool   `json:"success"`
	Output  string `json:"output"`
	Error   string `json:"error,omitempty"`
}

func (a *App) GetProcessDetail(connectKey string, pid int) (map[string]string, error) {
	return hdc.GetProcessDetail(connectKey, pid)
}

func (a *App) GetProcessDetailByPlatform(connectKey string, pid int, platform string) (map[string]string, error) {
	if platform == string(device.PlatformAndroid) {
		return adb.GetProcessDetail(connectKey, pid)
	}
	return hdc.GetProcessDetail(connectKey, pid)
}

func (a *App) ForceStopApp(connectKey string, packageName string) (*hdc.HdcResult, error) {
	return hdc.ForceStopApp(connectKey, packageName)
}

func (a *App) ForceStopAppByPlatform(connectKey string, packageName string, platform string) (*CommandResult, error) {
	if platform == string(device.PlatformAndroid) {
		result, err := adb.ForceStopApp(connectKey, packageName)
		if err != nil {
			return nil, err
		}
		return &CommandResult{
			Success: result.Success,
			Output:  result.Output,
			Error:   result.Error,
		}, nil
	}

	result, err := hdc.ForceStopApp(connectKey, packageName)
	if err != nil {
		return nil, err
	}
	return &CommandResult{
		Success: result.Success,
		Output:  result.Output,
		Error:   result.Error,
	}, nil
}
