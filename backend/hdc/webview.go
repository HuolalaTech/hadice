package hdc

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

// ListWebViews 列出指定包在设备上的 WebView / ArkWeb 调试页面。
//
// ponytail: 鸿蒙多进程 Web，页面常在子进程 socket；只扫传入 pid 会空表。
// 天花板=扫同包全部 pid + 清僵死 fport 重试一次（对齐 echo）。
func ListWebViews(connectKey string, pid int, bundleName string) ([]WebViewPage, error) {
	if connectKey == "" || pid <= 0 {
		return []WebViewPage{}, nil
	}

	pids := resolvePackagePids(connectKey, pid, bundleName)

	unixTable, err := shellOutput(connectKey, "cat", "/proc/net/unix")
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
		items, fetchErr := fetchSocketPages(connectKey, socketName)
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

func resolvePackagePids(connectKey string, pid int, bundleName string) []int {
	pids := map[int]struct{}{pid: {}}
	pkg := strings.TrimSpace(bundleName)
	if pkg == "" {
		cmdline, err := shellOutput(connectKey, "cat", fmt.Sprintf("/proc/%d/cmdline", pid))
		if err == nil {
			fields := strings.Fields(strings.ReplaceAll(cmdline, "\x00", " "))
			if len(fields) > 0 {
				pkg = fields[0]
			}
		}
	}
	if pkg != "" {
		pidofOut, err := shellOutput(connectKey, "pidof", pkg)
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
		for _, pid := range pids {
			pidText := strconv.Itoa(pid)
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

func fetchSocketPages(connectKey, socketName string) ([]WebViewPage, error) {
	pages, err := openWebViewJSON(connectKey, socketName, false)
	if err == nil {
		return pages, nil
	}
	// 主进程 socket 常僵死：清 fport 再试一次
	return openWebViewJSON(connectKey, socketName, true)
}

func openWebViewJSON(connectKey, socketName string, forceNew bool) ([]WebViewPage, error) {
	remote := "localabstract:" + socketName
	if forceNew {
		_ = removeLocalAbstractForwards(connectKey, remote)
	}

	port, err := ensureLocalAbstractForward(connectKey, remote)
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

func ensureLocalAbstractForward(connectKey, remote string) (int, error) {
	if port, ok := findExistingForwardPort(connectKey, remote); ok {
		return port, nil
	}

	port, err := allocateLocalTCPPort()
	if err != nil {
		return 0, err
	}
	local := fmt.Sprintf("tcp:%d", port)
	result, err := ExecuteHdcWithTimeout(
		[]string{"-t", connectKey, "fport", local, remote},
		10*time.Second,
	)
	if err != nil {
		return 0, err
	}
	if result == nil || !result.Success || !strings.Contains(result.Output, "result:OK") {
		errMsg := ""
		if result != nil {
			errMsg = result.Output
			if result.Error != "" {
				errMsg = result.Error
			}
		}
		return 0, fmt.Errorf("hdc fport failed: %s", errMsg)
	}
	return port, nil
}

func removeLocalAbstractForwards(connectKey, remote string) error {
	result, err := ExecuteHdcWithTimeout([]string{"-t", connectKey, "fport", "ls"}, 10*time.Second)
	if err != nil || result == nil || !result.Success {
		return err
	}
	for _, line := range strings.Split(result.Output, "\n") {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) < 2 {
			continue
		}
		if fields[1] != remote {
			continue
		}
		_, _ = ExecuteHdcWithTimeout(
			[]string{"-t", connectKey, "fport", "rm", fields[0], remote},
			10*time.Second,
		)
	}
	return nil
}

func findExistingForwardPort(connectKey, remote string) (int, bool) {
	result, err := ExecuteHdcWithTimeout([]string{"-t", connectKey, "fport", "ls"}, 10*time.Second)
	if err != nil || result == nil || !result.Success {
		return 0, false
	}
	for _, line := range strings.Split(result.Output, "\n") {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) < 2 || fields[1] != remote {
			continue
		}
		local := strings.TrimPrefix(fields[0], "tcp:")
		port, convErr := strconv.Atoi(local)
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

func shellOutput(connectKey string, shellArgs ...string) (string, error) {
	args := append([]string{"-t", connectKey, "shell"}, shellArgs...)
	result, err := ExecuteHdcWithTimeout(args, 10*time.Second)
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
		return "", fmt.Errorf("hdc shell failed: %s", errMsg)
	}
	return strings.TrimSpace(result.Output), nil
}
