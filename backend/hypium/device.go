package hypium

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"Hadice/backend/hdc"
)

const (
	// UITEST_SERVER_PORT uitest 服务端口
	UITEST_SERVER_PORT = 8012
	// RPC_TIMEOUT RPC 调用超时时间（5分钟）
	RPC_TIMEOUT = 5 * time.Minute
	// AGENT_REMOTE_PATH 设备上 agent.so 的路径
	AGENT_REMOTE_PATH = "/data/local/tmp/agent.so"
)

// Device hypium 设备连接
type Device struct {
	deviceSn    string
	hdcHost     string
	hdcPort     int
	rpcPort     int
	rpcSock     net.Conn
	rpcTimeout  time.Duration
	isNewUiTest bool
	fportList   []int
	initFlag    bool
	mu          sync.Mutex
}

// NewDevice 创建新的设备连接
func NewDevice(deviceSn string) *Device {
	return &Device{
		deviceSn:   deviceSn,
		hdcHost:    "127.0.0.1",
		hdcPort:    8710,
		rpcTimeout: RPC_TIMEOUT,
		fportList:  make([]int, 0),
	}
}

// InitDevice 初始化设备
// 1. 检查并推送 agent.so
// 2. 启动 uitest 服务
// 3. 创建端口转发
// 4. 建立 RPC Socket 连接
func (d *Device) InitDevice() error {
	d.mu.Lock()
	defer d.mu.Unlock()

	if d.initFlag {
		return nil
	}

	// 1. 检查 uitest 版本
	if err := d.initUiTestVersion(); err != nil {
		return fmt.Errorf("初始化 uitest 版本失败: %v", err)
	}

	// 2. 检查并推送 agent.so
	agentPath := d.getAgentPath()
	if agentPath == "" {
		return fmt.Errorf("未找到 agent.so 文件")
	}

	needUpdate, err := d.needUpdateAgent(agentPath, AGENT_REMOTE_PATH)
	if err != nil {
		return fmt.Errorf("检查 agent.so 更新失败: %v", err)
	}

	if needUpdate {
		if err := d.stopUiTest(); err != nil {
			// 忽略停止失败的错误
		}
		// 先删除旧的 agent.so 文件，确保干净的推送状态
		if err := d.removeFile(AGENT_REMOTE_PATH); err != nil {
			// 忽略删除失败的错误（文件可能不存在）
		}
		if err := d.pushFile(agentPath, AGENT_REMOTE_PATH); err != nil {
			return fmt.Errorf("推送 agent.so 失败: %v", err)
		}
	}

	// 3. 启动 uitest 服务
	isRunning, err := d.isUiTestRunning()
	if err != nil {
		return fmt.Errorf("检查 uitest 运行状态失败: %v", err)
	}

	if !isRunning {
		if err := d.startUiTest(); err != nil {
			return fmt.Errorf("启动 uitest 失败: %v", err)
		}
	}

	// 4. 创建端口转发
	rpcPort, err := d.getFreePort()
	if err != nil {
		return fmt.Errorf("获取空闲端口失败: %v", err)
	}

	var remoteAddr string
	if d.isNewUiTest {
		remoteAddr = "localabstract:uitest_socket"
	} else {
		remoteAddr = fmt.Sprintf("tcp:%d", UITEST_SERVER_PORT)
	}

	if err := d.createForward(fmt.Sprintf("tcp:%d", rpcPort), remoteAddr); err != nil {
		return fmt.Errorf("创建端口转发失败: %v", err)
	}

	d.rpcPort = rpcPort
	d.fportList = append(d.fportList, rpcPort)
	d.initFlag = true

	return nil
}

// initUiTestVersion 初始化 uitest 版本
func (d *Device) initUiTestVersion() error {
	result, err := hdc.ExecuteHdc([]string{"-t", d.deviceSn, "shell", "/system/bin/uitest", "--version"})
	if err != nil {
		return err
	}

	version := strings.TrimSpace(result.Output)
	// 比较版本号，如果 >= 6.0.2.2 则是新版本
	if compareVersion(version, "6.0.2.2") >= 0 {
		d.isNewUiTest = true
	}

	return nil
}

// needUpdateAgent 检查是否需要更新 agent.so
func (d *Device) needUpdateAgent(localPath, remotePath string) (bool, error) {
	// 检查设备上的文件是否存在
	result, err := hdc.ExecuteHdc([]string{"-t", d.deviceSn, "shell", "ls", remotePath})
	if err != nil || !result.Success {
		// 文件不存在，需要更新
		return true, nil
	}

	// 提取本地文件版本号
	localName := filepath.Base(localPath)
	versionRegex := regexp.MustCompile(`(\d+\.\d+\.\d+)`)
	localMatch := versionRegex.FindStringSubmatch(localName)
	if len(localMatch) < 2 {
		return false, nil
	}
	localVersion := localMatch[1]

	// 获取设备上的版本号
	result, err = hdc.ExecuteHdc([]string{"-t", d.deviceSn, "shell", "cat", remotePath, "|", "grep", "-a", "UITEST_AGENT_LIBRARY"})
	if err != nil || !result.Success {
		return true, nil // 如果获取失败，默认更新
	}

	remoteMatch := versionRegex.FindStringSubmatch(result.Output)
	if len(remoteMatch) < 2 {
		return true, nil // 如果无法解析版本号，默认更新
	}
	remoteVersion := remoteMatch[1]

	// 比较版本号
	if compareVersion(localVersion, remoteVersion) > 0 {
		return true, nil
	}

	return false, nil
}

// getAgentPath 获取 agent.so 文件路径
func (d *Device) getAgentPath() string {
	// 优先从打包后的资源目录查找
	resourcesDir := hdc.GetResourcesDir()
	if resourcesDir != "" {
		agentDir := filepath.Join(resourcesDir, "uitest")
		if agentPath := d.findAgentInDir(agentDir); agentPath != "" {
			return agentPath
		}
	}

	// 回退到开发环境的路径
	cwd, _ := os.Getwd()
	var platformDir string
	if runtime.GOOS == "darwin" {
		platformDir = fmt.Sprintf("darwin/%s", runtime.GOARCH)
	} else {
		platformDir = runtime.GOARCH
	}
	agentDir := filepath.Join(cwd, "assets", platformDir, "bin", "uitest")
	if agentPath := d.findAgentInDir(agentDir); agentPath != "" {
		return agentPath
	}

	return ""
}

// findAgentInDir 在指定目录中查找 agent.so 文件
func (d *Device) findAgentInDir(agentDir string) string {
	// 查找 uitest_agent 开头的文件
	entries, err := os.ReadDir(agentDir)
	if err != nil {
		return ""
	}

	versionRegex := regexp.MustCompile(`(\d+\.\d+\.\d+)`)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		name := entry.Name()
		if strings.HasPrefix(name, "uitest_agent") {
			// 检查版本号
			match := versionRegex.FindStringSubmatch(name)
			if len(match) >= 2 {
				version := match[1]
				// 如果是新版本 uitest，需要 >= 1.2.1
				if d.isNewUiTest {
					if compareVersion(version, "1.2.1") >= 0 {
						return filepath.Join(agentDir, name)
					}
				} else {
					return filepath.Join(agentDir, name)
				}
			}
		}
	}

	return ""
}

// startUiTest 启动 uitest 服务
func (d *Device) startUiTest() error {
	_, err := hdc.ExecuteHdc([]string{"-t", d.deviceSn, "shell", "/system/bin/uitest", "start-daemon", "singleness", "&"})
	if err != nil {
		return err
	}

	// 等待服务启动
	time.Sleep(2 * time.Second)

	// 检查是否启动成功
	result, err := hdc.ExecuteHdc([]string{"-t", d.deviceSn, "shell", "ps", "-ef", "|", "grep", "uitest"})
	if err != nil {
		return err
	}

	if strings.Contains(result.Output, "uitest start-daemon singleness") {
		return nil
	}

	return fmt.Errorf("uitest 启动失败")
}

// stopUiTest 停止 uitest 服务
func (d *Device) stopUiTest() error {
	_, err := hdc.ExecuteHdc([]string{"-t", d.deviceSn, "shell", "killall", "-9", "uitest"})
	return err
}

// isUiTestRunning 检查 uitest 是否在运行
func (d *Device) isUiTestRunning() (bool, error) {
	if d.isNewUiTest {
		// 检查 Unix socket
		result, err := hdc.ExecuteHdc([]string{"-t", d.deviceSn, "shell", "cat", "/proc/net/unix", "|", "grep", "uitest_socket"})
		if err != nil {
			return false, err
		}
		return strings.Contains(result.Output, "uitest_socket"), nil
	}
	// 旧版本通过进程检测
	result, err := hdc.ExecuteHdc([]string{"-t", d.deviceSn, "shell", "ps", "-ef", "|", "grep", "uitest"})
	if err != nil {
		return false, err
	}
	return strings.Contains(result.Output, "uitest start-daemon"), nil
}

// createForward 创建端口转发
func (d *Device) createForward(localPort, remoteAddr string) error {
	result, err := hdc.ExecuteHdc([]string{"-t", d.deviceSn, "fport", localPort, remoteAddr})
	if err != nil {
		return err
	}

	if strings.Contains(result.Output, "result:OK") {
		return nil
	}

	return fmt.Errorf("创建端口转发失败: %s", result.Output)
}

// removeForward 移除端口转发
func (d *Device) removeForward(localPort, remoteAddr string) error {
	result, err := hdc.ExecuteHdc([]string{"-t", d.deviceSn, "fport", "rm", localPort, remoteAddr})
	if err != nil {
		return err
	}

	if strings.Contains(result.Output, "result:OK") {
		return nil
	}

	return fmt.Errorf("移除端口转发失败: %s", result.Output)
}

// getFreePort 获取空闲端口
func (d *Device) getFreePort() (int, error) {
	addr, err := net.ResolveTCPAddr("tcp", "localhost:0")
	if err != nil {
		return 0, err
	}

	l, err := net.ListenTCP("tcp", addr)
	if err != nil {
		return 0, err
	}
	defer l.Close()

	return l.Addr().(*net.TCPAddr).Port, nil
}

// pushFile 推送文件到设备
func (d *Device) pushFile(localPath, remotePath string) error {
	result, err := hdc.PushFileToDevice(d.deviceSn, localPath, remotePath)
	if err != nil {
		return err
	}

	if result.Success {
		return nil
	}

	return fmt.Errorf("推送文件失败: %s", result.Error)
}

// removeFile 删除设备上的文件
func (d *Device) removeFile(remotePath string) error {
	result, err := hdc.ExecuteHdc([]string{"-t", d.deviceSn, "shell", "rm", remotePath})
	if err != nil {
		return err
	}

	if result.Success {
		return nil
	}

	return fmt.Errorf("删除文件失败: %s", result.Error)
}

// Rpc 发送 RPC 消息并读取响应
// 注意：此方法会读取完整的 JSON 响应，但不适合用于持续流式数据（如 startCaptureScreen）
func (d *Device) Rpc(msg string) (string, error) {
	if err := d.InitDevice(); err != nil {
		return "", err
	}

	d.mu.Lock()
	defer d.mu.Unlock()

	// 如果连接不存在或已关闭，创建新连接
	if d.rpcSock == nil {
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", d.hdcHost, d.rpcPort), d.rpcTimeout)
		if err != nil {
			return "", fmt.Errorf("连接 RPC 服务器失败: %v", err)
		}
		d.rpcSock = conn
	}

	// 发送消息
	if _, err := d.rpcSock.Write([]byte(msg)); err != nil {
		d.rpcSock.Close()
		d.rpcSock = nil
		return "", fmt.Errorf("发送 RPC 消息失败: %v", err)
	}

	// 读取响应
	d.rpcSock.SetReadDeadline(time.Now().Add(d.rpcTimeout))

	// 读取数据直到收到完整的 JSON 响应
	var response bytes.Buffer
	buffer := make([]byte, 4096)

	for {
		n, err := d.rpcSock.Read(buffer)
		if err != nil {
			if err == io.EOF {
				break
			}
			return "", fmt.Errorf("读取 RPC 响应失败: %v", err)
		}

		response.Write(buffer[:n])

		// 检查是否收到完整的 JSON 响应
		data := response.Bytes()
		if len(data) > 0 {
			// 尝试解析 JSON，如果成功则说明响应完整
			var testJSON interface{}
			if json.Unmarshal(data, &testJSON) == nil {
				// 检查是否是有效的 JSON 响应
				if strings.Contains(string(data), "\"result\"") || strings.Contains(string(data), "\"exception\"") {
					break
				}
			}
		}
	}

	return response.String(), nil
}

// GetRpcSocket 获取 RPC Socket 连接（用于流式数据读取）
func (d *Device) GetRpcSocket() (net.Conn, error) {
	if err := d.InitDevice(); err != nil {
		return nil, err
	}

	d.mu.Lock()
	defer d.mu.Unlock()

	// 检查连接是否存在且有效
	if d.rpcSock != nil {
		// 检查连接状态：尝试设置读取超时来检测连接是否有效
		d.rpcSock.SetReadDeadline(time.Now().Add(10 * time.Millisecond))
		one := make([]byte, 1)
		_, err := d.rpcSock.Read(one)
		d.rpcSock.SetReadDeadline(time.Time{}) // 清除超时

		// 如果读取失败且不是超时错误，说明连接已关闭
		if err != nil && err != io.EOF {
			if netErr, ok := err.(interface{ Timeout() bool }); !ok || !netErr.Timeout() {
				// 连接已关闭，需要重新创建
				log.Printf("[Device] RPC Socket connection closed, closing old connection: %v", err)
				d.rpcSock.Close()
				d.rpcSock = nil
			}
		}
	}

	// 如果连接不存在或已关闭，创建新连接
	if d.rpcSock == nil {
		log.Printf("[Device] Creating new RPC Socket connection to %s:%d", d.hdcHost, d.rpcPort)
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", d.hdcHost, d.rpcPort), d.rpcTimeout)
		if err != nil {
			return nil, fmt.Errorf("连接 RPC 服务器失败: %v", err)
		}
		d.rpcSock = conn
		log.Printf("[Device] RPC Socket connection created successfully")
	}

	return d.rpcSock, nil
}

// HealthCheck 检测 RPC 服务是否正常响应
// 返回 true 表示健康，false 表示不健康
func (d *Device) HealthCheck() bool {
	d.mu.Lock()
	defer d.mu.Unlock()

	if !d.initFlag || d.rpcPort == 0 {
		return false
	}

	conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", d.hdcHost, d.rpcPort), 3*time.Second)
	if err != nil {
		log.Printf("[Device] HealthCheck: failed to connect: %v", err)
		return false
	}
	defer conn.Close()

	msg := `{"module":"com.ohos.devicetest.hypiumApiHelper","method":"callHypiumApi","params":{"api":"Driver.getDisplaySize","this":"Driver#0","args":[]},"request_id":"health_check"}`

	conn.SetWriteDeadline(time.Now().Add(2 * time.Second))
	if _, err := conn.Write([]byte(msg)); err != nil {
		log.Printf("[Device] HealthCheck: failed to write: %v", err)
		return false
	}

	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	buffer := make([]byte, 4096)
	n, err := conn.Read(buffer)
	if err != nil {
		log.Printf("[Device] HealthCheck: failed to read: %v", err)
		return false
	}

	response := string(buffer[:n])
	if strings.Contains(response, "\"result\"") {
		log.Printf("[Device] HealthCheck: healthy")
		return true
	}

	log.Printf("[Device] HealthCheck: unhealthy response: %s", response)
	return false
}

// RestartUiTest 重启 uitest 服务
// 用于恢复卡死的服务状态
func (d *Device) RestartUiTest() error {
	log.Printf("[Device] RestartUiTest: restarting uitest service for device %s", d.deviceSn)

	d.mu.Lock()
	if d.rpcSock != nil {
		d.rpcSock.Close()
		d.rpcSock = nil
	}
	d.initFlag = false
	d.mu.Unlock()

	for _, port := range d.fportList {
		var remoteAddr string
		if d.isNewUiTest {
			remoteAddr = "localabstract:uitest_socket"
		} else {
			remoteAddr = fmt.Sprintf("tcp:%d", UITEST_SERVER_PORT)
		}
		d.removeForward(fmt.Sprintf("tcp:%d", port), remoteAddr)
	}
	d.fportList = make([]int, 0)

	_, _ = hdc.ExecuteHdc([]string{"-t", d.deviceSn, "shell", "pkill", "-9", "uitest"})

	time.Sleep(2 * time.Second)

	if err := d.startUiTest(); err != nil {
		log.Printf("[Device] RestartUiTest: failed to start uitest: %v", err)
		return err
	}

	log.Printf("[Device] RestartUiTest: uitest service restarted successfully")
	return nil
}

// EnsureHealthy 确保 uitest 服务健康，不健康则自动重启
func (d *Device) EnsureHealthy() error {
	if d.HealthCheck() {
		return nil
	}

	log.Printf("[Device] EnsureHealthy: uitest service unhealthy, attempting restart")
	return d.RestartUiTest()
}

// Close 关闭设备连接
func (d *Device) Close() error {
	d.mu.Lock()
	defer d.mu.Unlock()

	// 移除所有端口转发
	for _, port := range d.fportList {
		var remoteAddr string
		if d.isNewUiTest {
			remoteAddr = "localabstract:uitest_socket"
		} else {
			remoteAddr = fmt.Sprintf("tcp:%d", UITEST_SERVER_PORT)
		}
		d.removeForward(fmt.Sprintf("tcp:%d", port), remoteAddr)
	}

	// 关闭 RPC Socket
	if d.rpcSock != nil {
		d.rpcSock.Close()
		d.rpcSock = nil
	}

	d.initFlag = false
	return nil
}

// compareVersion 比较版本号
// 返回值: >0 表示 v1 > v2, =0 表示 v1 = v2, <0 表示 v1 < v2
func compareVersion(v1, v2 string) int {
	parts1 := strings.Split(v1, ".")
	parts2 := strings.Split(v2, ".")

	maxLen := len(parts1)
	if len(parts2) > maxLen {
		maxLen = len(parts2)
	}

	for i := 0; i < maxLen; i++ {
		var num1, num2 int
		if i < len(parts1) {
			num1, _ = strconv.Atoi(parts1[i])
		}
		if i < len(parts2) {
			num2, _ = strconv.Atoi(parts2[i])
		}

		if num1 > num2 {
			return 1
		} else if num1 < num2 {
			return -1
		}
	}

	return 0
}
