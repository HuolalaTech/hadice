package android

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"Hadice/backend/adb"
)

var androidProcessNamePattern = regexp.MustCompile(`^[A-Za-z0-9._:-]+$`)

const (
	DefaultAgentRemotePath = "/data/local/tmp/libnetwork_agent.so"
	DefaultAgentSocketName = "network_agent"
)

type AgentManager struct {
	agentLocalPath  string
	agentRemotePath string
}

func NewAgentManager(agentPath string) *AgentManager {
	return &AgentManager{
		agentLocalPath:  agentPath,
		agentRemotePath: DefaultAgentRemotePath,
	}
}

func (m *AgentManager) SetAgentPath(localPath string) {
	m.agentLocalPath = localPath
}

func GetDefaultAgentPathForABI(abi string) string {
	exePath, err := os.Executable()
	if err != nil {
		return ""
	}
	exeDir := filepath.Dir(exePath)
	// macOS .app: .../Contents/MacOS -> .../Contents
	contentsDir := filepath.Dir(exeDir)

	paths := []string{
		// Packaged macOS app: Contents/Resources/agent/<abi>/
		filepath.Join(contentsDir, "Resources", "agent", abi, "libnetwork_agent.so"),
		filepath.Join(contentsDir, "resources", "agent", abi, "libnetwork_agent.so"),
		// Packaged Windows/Linux: next to executable
		filepath.Join(exeDir, "resources", "agent", abi, "libnetwork_agent.so"),
		filepath.Join(exeDir, "agent", abi, "libnetwork_agent.so"),
		// Dev / legacy layouts
		filepath.Join(contentsDir, "agent", "build", abi, "libnetwork_agent.so"),
		filepath.Join("agent", "build", abi, "libnetwork_agent.so"),
	}

	for _, p := range paths {
		if _, err := os.Stat(p); err == nil {
			log.Printf("[AndroidAgent] Found agent at: %s", p)
			return p
		}
	}

	return ""
}

func GetDefaultAgentPath() string {
	return GetDefaultAgentPathForABI("arm64-v8a")
}

func GetProcessAgentABI(deviceID string, pid int) (string, error) {
	if pid <= 0 {
		return "", fmt.Errorf("invalid process PID: %d", pid)
	}

	packageName, _ := getPackageNameForPID(deviceID, pid)

	// app_process32/app_process64 is the most direct representation of the
	// process bitness and does not depend on the device's supported ABIs.
	exeCommands := []string{fmt.Sprintf("readlink /proc/%d/exe", pid)}
	if packageName != "" {
		exeCommands = append(exeCommands, fmt.Sprintf("run-as %s readlink /proc/%d/exe", packageName, pid))
	}
	for _, command := range exeCommands {
		exeResult, err := adb.ExecuteShellCommand(deviceID, command)
		if err == nil && exeResult != nil && exeResult.Success {
			exePath := strings.TrimSpace(exeResult.Output)
			if strings.Contains(exePath, "app_process64") {
				return "arm64-v8a", nil
			}
			if strings.Contains(exePath, "app_process32") {
				return "armeabi-v7a", nil
			}
		}
	}

	// Some devices restrict readlink for shell. The linker mapping remains
	// visible to the app UID via run-as and reliably distinguishes process ABI.
	mapsCommands := []string{fmt.Sprintf("cat /proc/%d/maps", pid)}
	if packageName != "" {
		mapsCommands = append(mapsCommands, fmt.Sprintf("run-as %s cat /proc/%d/maps", packageName, pid))
	}
	for _, command := range mapsCommands {
		mapsResult, mapsErr := adb.ExecuteShellCommand(deviceID, command)
		if mapsErr == nil && mapsResult != nil && mapsResult.Success {
			maps := mapsResult.Output
			if strings.Contains(maps, "/linker64") || strings.Contains(maps, "/lib64/") {
				return "arm64-v8a", nil
			}
			if strings.Contains(maps, "/linker") || strings.Contains(maps, "/lib/") {
				return "armeabi-v7a", nil
			}
		}
	}

	// On production devices, SELinux may block /proc/<pid>/exe and maps even
	// for adb shell. The package's primary ABI is the runtime ABI for its main
	// process, so use it as the final unprivileged fallback.
	cmdlineResult, cmdlineErr := adb.ExecuteShellCommand(
		deviceID, fmt.Sprintf("cat /proc/%d/cmdline", pid),
	)
	if cmdlineErr == nil && cmdlineResult != nil && cmdlineResult.Success {
		cmdlinePackageName := strings.Split(strings.TrimSpace(cmdlineResult.Output), "\x00")[0]
		if separator := strings.Index(cmdlinePackageName, ":"); separator > 0 {
			cmdlinePackageName = cmdlinePackageName[:separator]
		}
		if cmdlinePackageName != "" {
			packageResult, packageErr := adb.ExecuteShellCommand(
				deviceID, fmt.Sprintf("dumpsys package %s", cmdlinePackageName),
			)
			if packageErr == nil && packageResult != nil && packageResult.Success {
				if strings.Contains(packageResult.Output, "primaryCpuAbi=armeabi-v7a") {
					return "armeabi-v7a", nil
				}
				if strings.Contains(packageResult.Output, "primaryCpuAbi=arm64-v8a") {
					return "arm64-v8a", nil
				}
			}
		}
	}

	return "", fmt.Errorf("cannot determine ABI for PID %d", pid)
}

func (m *AgentManager) PushAgent(deviceID string, pid int) error {
	if m.agentLocalPath == "" {
		abi, err := GetProcessAgentABI(deviceID, pid)
		if err != nil {
			return fmt.Errorf("failed to determine target process ABI: %w", err)
		}

		m.agentLocalPath = GetDefaultAgentPathForABI(abi)
		if m.agentLocalPath == "" {
			return fmt.Errorf("agent file not found for ABI %s, please build agent first", abi)
		}
		log.Printf("[AndroidAgent] Selected %s agent for PID %d: %s", abi, pid, m.agentLocalPath)
	}

	args := []string{"-s", deviceID, "push", m.agentLocalPath, m.agentRemotePath}
	result, err := adb.ExecuteAdb(args)
	if err != nil {
		return fmt.Errorf("failed to push agent: %w", err)
	}
	if !result.Success {
		return fmt.Errorf("failed to push agent: %s", result.Error)
	}

	log.Printf("[AndroidAgent] Agent pushed to device %s: %s", deviceID, m.agentRemotePath)
	return nil
}

func GetDebuggableApps(deviceID string) ([]AndroidApp, error) {
	args := []string{"-s", deviceID, "jdwp"}
	result, err := adb.ExecuteAdbWithTimeout(args, 2*time.Second)

	// jdwp 是交互式命令，超时是正常行为
	// 即使超时，result.Output 也应该包含已收集的 PID
	if err != nil {
		if result != nil && strings.Contains(result.Error, "timeout") {
			log.Printf("[AndroidAgent] jdwp command timed out (expected), using collected output")
		} else if err.Error() != "" {
			return nil, fmt.Errorf("failed to get jdwp processes: %w", err)
		}
	}

	if result == nil {
		return []AndroidApp{}, nil
	}

	pids := strings.Fields(strings.TrimSpace(result.Output))
	if len(pids) == 0 {
		return []AndroidApp{}, nil
	}

	var apps []AndroidApp
	var wg sync.WaitGroup
	var mu sync.Mutex

	for _, pidStr := range pids {
		pid, err := strconv.Atoi(pidStr)
		if err != nil {
			continue
		}

		wg.Add(1)
		go func(p int) {
			defer wg.Done()
			pkg, proc := getPackageNameForPID(deviceID, p)
			if pkg != "" {
				name := getAppName(deviceID, pkg)
				mu.Lock()
				apps = append(apps, AndroidApp{
					PackageName: pkg,
					ProcessName: proc,
					PID:         p,
					Name:        name,
					Debuggable:  true,
				})
				mu.Unlock()
			}
		}(pid)
	}

	wg.Wait()
	return apps, nil
}

func getPackageNameForPID(deviceID string, pid int) (packageName string, processName string) {
	// 读取 /proc/<pid>/cmdline 获取进程名
	args := []string{"-s", deviceID, "shell", fmt.Sprintf("cat /proc/%d/cmdline", pid)}
	result, err := adb.ExecuteAdb(args)
	if err != nil || !result.Success {
		return "", ""
	}

	proc := strings.TrimSpace(result.Output)
	// /proc/<pid>/cmdline 用 \x00 分隔参数，进程名后通常有大量 trailing \x00
	// TrimSuffix 只能去掉最后一个，需要用 Split 取首段并 TrimSpace 清理全部 null 字节
	if fields := strings.Split(proc, "\x00"); len(fields) > 0 {
		proc = strings.TrimSpace(fields[0])
	}
	processName = proc

	// 提取纯包名（去除 :process 后缀）
	if idx := strings.Index(proc, ":"); idx > 0 {
		packageName = proc[:idx]
	} else {
		packageName = proc
	}

	return packageName, processName
}

// QueryPidByProcessName 通过完整进程名查询当前 PID。
// found=false 表示 adb 查询成功但进程未运行；err!=nil 表示设备或 adb 查询失败。
func QueryPidByProcessName(deviceID, processName string) (pid int, found bool, err error) {
	processName = strings.TrimSpace(processName)
	if processName == "" || !androidProcessNamePattern.MatchString(processName) {
		return 0, false, fmt.Errorf("invalid Android process name: %q", processName)
	}

	// pidof 在未找到进程时退出码为 1；用 true 保留“查询成功但无 PID”的语义。
	args := []string{"-s", deviceID, "shell", fmt.Sprintf("pidof %s || true", processName)}
	result, err := adb.ExecuteAdbWithTimeout(args, 3*time.Second)
	if err != nil {
		return 0, false, err
	}
	if result == nil {
		return 0, false, fmt.Errorf("empty adb result")
	}
	if !result.Success {
		return 0, false, fmt.Errorf("pidof failed: %s", result.Error)
	}

	output := strings.TrimSpace(result.Output)
	if output == "" {
		return 0, false, nil
	}
	for _, field := range strings.Fields(output) {
		if pid, err := strconv.Atoi(field); err == nil && pid > 0 {
			return pid, true, nil
		}
	}
	return 0, false, nil
}

// GetPidByPackageName 保留给前端的快速查询入口；参数也支持完整的子进程名。
// 返回 0 表示进程未运行或查询失败。
func GetPidByPackageName(deviceID, packageName string) int {
	pid, found, err := QueryPidByProcessName(deviceID, packageName)
	if err != nil || !found {
		return 0
	}
	return pid
}

func getAppName(deviceID, packageName string) string {
	args := []string{"-s", deviceID, "shell", fmt.Sprintf("dumpsys package %s | grep 'labelRes' | head -1", packageName)}
	result, err := adb.ExecuteAdb(args)
	if err != nil || !result.Success {
		return packageName
	}

	line := strings.TrimSpace(result.Output)
	if strings.Contains(line, "labelRes=") {
		parts := strings.Split(line, "labelRes=")
		if len(parts) > 1 {
			return strings.TrimSpace(parts[1])
		}
	}

	return packageName
}

func SetupPortForward(deviceID, local, remote string) error {
	args := []string{"-s", deviceID, "forward", local, remote}
	result, err := adb.ExecuteAdb(args)
	if err != nil {
		return fmt.Errorf("failed to setup port forward: %w", err)
	}
	if !result.Success {
		return fmt.Errorf("failed to setup port forward: %s", result.Error)
	}
	return nil
}

func SetupJDWPForward(deviceID string, localPort int, pid int) error {
	local := fmt.Sprintf("tcp:%d", localPort)
	remote := fmt.Sprintf("jdwp:%d", pid)
	return SetupPortForward(deviceID, local, remote)
}

func RemovePortForward(deviceID string, localPort int) error {
	args := []string{"-s", deviceID, "forward", "--remove", fmt.Sprintf("tcp:%d", localPort)}

	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		result, err := adb.ExecuteAdb(args)
		if err == nil && result != nil && result.Success {
			log.Printf("[AndroidAgent] Port forward removed: tcp:%d", localPort)
			return nil
		}
		if err != nil {
			lastErr = err
		} else if result != nil && !result.Success {
			lastErr = fmt.Errorf("adb: %s", result.Error)
		}
		if attempt < 2 {
			time.Sleep(100 * time.Millisecond)
		}
	}
	log.Printf("[AndroidAgent] Failed to remove port forward tcp:%d after 3 attempts: %v", localPort, lastErr)
	return fmt.Errorf("failed to remove port forward tcp:%d: %w", localPort, lastErr)
}

func SetupReversePortForward(deviceID, remote, local string) error {
	args := []string{"-s", deviceID, "reverse", remote, local}
	result, err := adb.ExecuteAdb(args)
	if err != nil {
		return fmt.Errorf("failed to setup reverse port forward: %w", err)
	}
	if !result.Success {
		return fmt.Errorf("failed to setup reverse port forward: %s", result.Error)
	}
	log.Printf("[AndroidAgent] Reverse port forward setup: %s -> %s", remote, local)
	return nil
}

func VerifyReversePortForward(deviceID string, port int) bool {
	args := []string{"-s", deviceID, "reverse", "--list"}
	result, err := adb.ExecuteAdb(args)
	if err != nil || !result.Success {
		log.Printf("[AndroidAgent] Failed to list reverse forwards: %v", err)
		return false
	}

	portStr := fmt.Sprintf("tcp:%d", port)
	return strings.Contains(result.Output, portStr)
}

func SetupReversePortForwardWithVerify(deviceID string, port int) error {
	remote := fmt.Sprintf("tcp:%d", port)
	local := fmt.Sprintf("tcp:%d", port)

	if err := SetupReversePortForward(deviceID, remote, local); err != nil {
		return err
	}

	for i := 0; i < 10; i++ {
		if VerifyReversePortForward(deviceID, port) {
			log.Printf("[AndroidAgent] Reverse port forward verified: tcp:%d", port)
			return nil
		}
		log.Printf("[AndroidAgent] Waiting for reverse port forward to be ready... (attempt %d)", i+1)
		time.Sleep(100 * time.Millisecond)
	}

	return fmt.Errorf("reverse port forward verification failed for tcp:%d", port)
}

func RemoveReversePortForward(deviceID string, remotePort int) error {
	args := []string{"-s", deviceID, "reverse", "--remove", fmt.Sprintf("tcp:%d", remotePort)}

	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		result, err := adb.ExecuteAdb(args)
		if err == nil && result != nil && result.Success {
			log.Printf("[AndroidAgent] Reverse port forward removed: tcp:%d", remotePort)
			return nil
		}
		if err != nil {
			lastErr = err
		} else if result != nil && !result.Success {
			lastErr = fmt.Errorf("adb: %s", result.Error)
		}
		if attempt < 2 {
			time.Sleep(100 * time.Millisecond)
		}
	}
	log.Printf("[AndroidAgent] Failed to remove reverse port forward tcp:%d after 3 attempts: %v", remotePort, lastErr)
	return fmt.Errorf("failed to remove reverse port forward tcp:%d: %w", remotePort, lastErr)
}

func AttachAgentViaJDWP(deviceID string, pid int, jdwpPort int, agentPath string) error {
	client, err := NewJDWPClient("localhost", jdwpPort)
	if err != nil {
		return fmt.Errorf("failed to connect to JDWP: %w", err)
	}
	defer client.Close()

	if err := client.LoadAgent(agentPath, ""); err != nil {
		return fmt.Errorf("failed to load agent: %w", err)
	}

	log.Printf("[AndroidAgent] Agent loaded successfully for PID %d", pid)
	return nil
}

func AttachAgentViaAM(deviceID string, pid int, agentPath string) error {
	// 使用 ExecuteShellCommand 避免参数解析问题
	shellCmd := fmt.Sprintf("am attach-agent %d %s", pid, agentPath)
	result, err := adb.ExecuteShellCommand(deviceID, shellCmd)
	if err != nil {
		return fmt.Errorf("failed to attach agent via am: %w", err)
	}
	if !result.Success {
		return fmt.Errorf("failed to attach agent via am: %s", result.Error)
	}

	log.Printf("[AndroidAgent] Agent attached via am for PID %d", pid)
	return nil
}

func CheckAgentExists(deviceID string) bool {
	// 使用 ExecuteShellCommand 避免 && 解析问题
	result, err := adb.ExecuteShellCommand(deviceID, "test -f /data/local/tmp/libnetwork_agent.so && echo exists")
	if err != nil {
		return false
	}
	return result.Success && strings.Contains(result.Output, "exists")
}

// IsAgentLoaded 检查当前 PID 的内存映射中是否已经加载过 network agent。
// 文件仍然存在不代表当前进程已加载，因此必须以 /proc/<pid>/maps 为准。
func IsAgentLoaded(deviceID, packageName string, pid int) (bool, error) {
	if pid <= 0 {
		return false, fmt.Errorf("invalid process PID: %d", pid)
	}

	commands := []string{
		fmt.Sprintf("cat /proc/%d/maps", pid),
		fmt.Sprintf("run-as %s cat /proc/%d/maps", packageName, pid),
	}

	var lastErr string
	for _, command := range commands {
		result, err := adb.ExecuteShellCommand(deviceID, command)
		if err != nil {
			lastErr = err.Error()
			continue
		}
		if result == nil || !result.Success {
			if result != nil {
				lastErr = result.Error
			}
			continue
		}

		for _, line := range strings.Split(result.Output, "\n") {
			if strings.Contains(line, "libnetwork_agent.so") {
				log.Printf("[AndroidAgent] Agent already loaded in PID %d: %s", pid, strings.TrimSpace(line))
				return true, nil
			}
		}
		return false, nil
	}

	if lastErr == "" {
		lastErr = "permission denied"
	}
	return false, fmt.Errorf("cannot inspect memory maps for PID %d: %s", pid, lastErr)
}

func PushAgentToAppPrivateDir(deviceID, packageName string) (string, error) {
	tempPath := "/data/local/tmp/libnetwork_agent.so"
	appAgentPath := fmt.Sprintf("/data/data/%s/libnetwork_agent.so", packageName)

	// StartAndroidCapture has already pushed the ABI-matched Agent to tempPath.
	// Do not create a new default manager here: it always preferred arm64-v8a
	// and replaced the correct armeabi-v7a binary for 32-bit processes.
	if !CheckAgentExists(deviceID) {
		return "", fmt.Errorf("ABI-matched agent is missing from temp location")
	}

	// 使用 stdin 方式执行 run-as cp 命令
	shellCmd := fmt.Sprintf("run-as %s cp %s %s", packageName, tempPath, appAgentPath)
	result, err := adb.ExecuteShellCommand(deviceID, shellCmd)
	if err != nil {
		log.Printf("[AndroidAgent] run-as cp failed: %v", err)
		// 尝试替代方法：使用 dd
		shellCmd = fmt.Sprintf("run-as %s dd if=%s of=%s", packageName, tempPath, appAgentPath)
		result, err = adb.ExecuteShellCommand(deviceID, shellCmd)
		if err != nil {
			return "", fmt.Errorf("failed to copy agent to app private dir: %w", err)
		}
	}
	if result != nil && !result.Success {
		log.Printf("[AndroidAgent] run-as cp result: %s", result.Error)
	}

	// 设置可执行权限
	shellCmd = fmt.Sprintf("run-as %s chmod 755 %s", packageName, appAgentPath)
	adb.ExecuteShellCommand(deviceID, shellCmd)

	// 验证文件是否存在
	shellCmd = fmt.Sprintf("run-as %s ls -la %s", packageName, appAgentPath)
	result, _ = adb.ExecuteShellCommand(deviceID, shellCmd)
	if result != nil {
		log.Printf("[AndroidAgent] Agent file check: %s", result.Output)
	}

	log.Printf("[AndroidAgent] Agent copied to app private dir: %s", appAgentPath)
	return appAgentPath, nil
}

func CheckAgentInAppPrivateDir(deviceID, packageName string) bool {
	appAgentPath := fmt.Sprintf("/data/data/%s/libnetwork_agent.so", packageName)
	shellCmd := fmt.Sprintf("run-as %s test -f %s && echo exists", packageName, appAgentPath)
	result, err := adb.ExecuteShellCommand(deviceID, shellCmd)
	if err != nil {
		return false
	}
	return result.Success && strings.Contains(result.Output, "exists")
}
