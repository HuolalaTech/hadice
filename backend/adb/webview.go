package adb

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// WebViewPage Chromium DevTools /json 里的一个可调试页面目标。
type WebViewPage struct {
	ID                   string `json:"id"`
	Type                 string `json:"type"`
	URL                  string `json:"url"`
	Title                string `json:"title"`
	FaviconURL           string `json:"faviconUrl,omitempty"`
	WebSocketDebuggerURL string `json:"webSocketDebuggerUrl,omitempty"`
}

// ListWebViews 列出 Android 应用当前可调试的 WebView 页面。
//
// ponytail: 多进程 WebView 页面常在子进程 socket；只扫传入 pid 会空表。
// 天花板=扫同包全部 pid；抓包会话已有 forward 时复用，避免双开抢 socket。
func ListWebViews(deviceID string, pid int, packageName string) ([]WebViewPage, error) {
	if deviceID == "" || pid <= 0 {
		return []WebViewPage{}, nil
	}

	pids := resolvePackagePids(deviceID, pid, packageName)
	unixTable, err := shellOutput(deviceID, "cat", "/proc/net/unix")
	if err != nil {
		return nil, err
	}
	socketNames := collectWebViewSocketNames(unixTable, pids)
	if len(socketNames) == 0 {
		return []WebViewPage{}, nil
	}

	pages := make([]WebViewPage, 0)
	seen := make(map[string]bool)
	for _, socketName := range socketNames {
		items, fetchErr := fetchSocketPages(deviceID, socketName)
		if fetchErr != nil {
			continue
		}
		for _, item := range items {
			if item.ID == "" || seen[item.ID] {
				continue
			}
			seen[item.ID] = true
			pages = append(pages, item)
		}
	}
	return pages, nil
}

func resolvePackagePids(deviceID string, pid int, packageName string) []int {
	pids := map[int]struct{}{pid: {}}
	pkg := strings.TrimSpace(packageName)
	if pkg == "" {
		cmdline, err := shellOutput(deviceID, "cat", fmt.Sprintf("/proc/%d/cmdline", pid))
		if err == nil {
			fields := strings.Fields(strings.ReplaceAll(cmdline, "\x00", " "))
			if len(fields) > 0 {
				pkg = fields[0]
			}
		}
	}
	if pkg != "" {
		pidofOut, err := shellOutput(deviceID, "pidof", pkg)
		if err == nil {
			for _, part := range strings.Fields(pidofOut) {
				n, convErr := strconv.Atoi(part)
				if convErr == nil && n > 0 {
					pids[n] = struct{}{}
				}
			}
		}
	}

	result := make([]int, 0, len(pids))
	for p := range pids {
		result = append(result, p)
	}
	return result
}

func collectWebViewSocketNames(unixTable string, pids []int) []string {
	seen := make(map[string]bool)
	var socketNames []string
	for _, line := range strings.Split(unixTable, "\n") {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) == 0 {
			continue
		}
		socket := strings.TrimPrefix(fields[len(fields)-1], "@")
		for _, p := range pids {
			pidText := strconv.Itoa(p)
			if !isWebViewSocketForPID(socket, pidText) {
				continue
			}
			if !seen[socket] {
				seen[socket] = true
				socketNames = append(socketNames, socket)
			}
		}
	}
	return socketNames
}

func isWebViewSocketForPID(socket, pidText string) bool {
	if !strings.HasPrefix(socket, "webview_devtools_remote") {
		return false
	}
	if !strings.HasSuffix(socket, pidText) {
		return false
	}
	prefixLen := len(socket) - len(pidText)
	if prefixLen <= 0 {
		return false
	}
	prev := socket[prefixLen-1]
	return prev < '0' || prev > '9'
}

func fetchSocketPages(deviceID, socketName string) ([]WebViewPage, error) {
	pages, err := openWebViewJSON(deviceID, socketName, false)
	if err == nil {
		return pages, nil
	}
	return openWebViewJSON(deviceID, socketName, true)
}

func openWebViewJSON(deviceID, socketName string, forceNew bool) ([]WebViewPage, error) {
	remote := "localabstract:" + socketName
	if forceNew {
		_ = removeLocalAbstractForwards(deviceID, remote)
	}

	port, err := ensureLocalAbstractForward(deviceID, remote)
	if err != nil {
		return nil, err
	}

	client := &http.Client{Timeout: 1500 * time.Millisecond}
	resp, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/json", port))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("devtools /json status %d: %s", resp.StatusCode, string(body))
	}

	var pages []WebViewPage
	if err := json.NewDecoder(resp.Body).Decode(&pages); err != nil {
		return nil, err
	}
	if pages == nil {
		pages = []WebViewPage{}
	}
	return pages, nil
}

func ensureLocalAbstractForward(deviceID, remote string) (int, error) {
	if port, ok := findExistingForwardPort(deviceID, remote); ok {
		return port, nil
	}

	port, err := allocateLocalTCPPort()
	if err != nil {
		return 0, err
	}
	local := fmt.Sprintf("tcp:%d", port)
	result, err := ExecuteAdbWithTimeout(
		[]string{"-s", deviceID, "forward", local, remote},
		10*time.Second,
	)
	if err != nil {
		return 0, err
	}
	if result == nil || !result.Success {
		errMsg := ""
		if result != nil {
			errMsg = result.Error
			if errMsg == "" {
				errMsg = result.Output
			}
		}
		return 0, fmt.Errorf("adb forward failed: %s", errMsg)
	}
	return port, nil
}

func removeLocalAbstractForwards(deviceID, remote string) error {
	result, err := ExecuteAdbWithTimeout([]string{"-s", deviceID, "forward", "--list"}, 10*time.Second)
	if err != nil || result == nil || !result.Success {
		return err
	}
	for _, line := range strings.Split(result.Output, "\n") {
		fields := strings.Fields(strings.TrimSpace(line))
		// format: <serial> tcp:PORT localabstract:NAME
		if len(fields) < 3 {
			continue
		}
		local, rem := fields[len(fields)-2], fields[len(fields)-1]
		if rem != remote {
			continue
		}
		_, _ = ExecuteAdbWithTimeout(
			[]string{"-s", deviceID, "forward", "--remove", local},
			10*time.Second,
		)
	}
	return nil
}

func findExistingForwardPort(deviceID, remote string) (int, bool) {
	result, err := ExecuteAdbWithTimeout([]string{"-s", deviceID, "forward", "--list"}, 10*time.Second)
	if err != nil || result == nil || !result.Success {
		return 0, false
	}
	for _, line := range strings.Split(result.Output, "\n") {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) < 3 {
			continue
		}
		local, rem := fields[len(fields)-2], fields[len(fields)-1]
		if rem != remote {
			continue
		}
		port, convErr := strconv.Atoi(strings.TrimPrefix(local, "tcp:"))
		if convErr == nil && port > 0 {
			return port, true
		}
	}
	return 0, false
}

func allocateLocalTCPPort() (int, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	port := listener.Addr().(*net.TCPAddr).Port
	if err := listener.Close(); err != nil {
		return 0, err
	}
	return port, nil
}

func shellOutput(deviceID string, shellArgs ...string) (string, error) {
	args := append([]string{"-s", deviceID, "shell"}, shellArgs...)
	result, err := ExecuteAdbWithTimeout(args, 10*time.Second)
	if err != nil {
		return "", err
	}
	if result == nil || !result.Success {
		errMsg := ""
		if result != nil {
			errMsg = result.Error
			if errMsg == "" {
				errMsg = result.Output
			}
		}
		return "", fmt.Errorf("adb shell failed: %s", errMsg)
	}
	return strings.TrimSpace(result.Output), nil
}
