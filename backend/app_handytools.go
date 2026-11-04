package backend

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type HandyImageFile struct {
	Name    string `json:"name"`
	Mime    string `json:"mime"`
	Size    int64  `json:"size"`
	DataURL string `json:"dataUrl"`
}

// HandySelectImageFile 原生选图对话框（Wails WebView 不支持 <input type=file> 点击选文件）
// 取消选择返回 nil,nil；文件以 DataURL 返回供前端 Canvas/预览直接使用。
// ponytail: 限 20MB，够二维码/转 Base64；大图需流式时再改落盘路径模式。
func (a *App) HandySelectImageFile() (*HandyImageFile, error) {
	app := application.Get()
	if app == nil {
		return nil, fmt.Errorf("应用实例不可用")
	}
	path, err := app.Dialog.OpenFile().SetTitle("选择图片").
		AddFilter("图片", "*.png;*.jpg;*.jpeg;*.gif;*.webp;*.bmp").
		PromptForSingleSelection()
	if err != nil {
		return nil, err
	}
	if path == "" {
		return nil, nil
	}
	return readHandyImageFile(path)
}

// HandyReadImageFile 读取拖放得到的文件路径（配合 data-wails-dropzone 的 files-dropped 事件）
func (a *App) HandyReadImageFile(path string) (*HandyImageFile, error) {
	return readHandyImageFile(path)
}

func readHandyImageFile(path string) (*HandyImageFile, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, 20<<20+1))
	if err != nil {
		return nil, err
	}
	if len(raw) > 20<<20 {
		return nil, fmt.Errorf("图片超过 20MB")
	}
	mime := http.DetectContentType(raw)
	if !strings.HasPrefix(mime, "image/") {
		return nil, fmt.Errorf("不是图片文件: %s", mime)
	}
	return &HandyImageFile{
		Name: filepath.Base(path), Mime: mime, Size: int64(len(raw)),
		DataURL: "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(raw),
	}, nil
}

type HandyHTTPResponse struct {
	Status     int               `json:"status"`
	StatusText string            `json:"statusText"`
	Headers    map[string]string `json:"headers"`
	Body       string            `json:"body"`
	ElapsedMs  int64             `json:"elapsedMs"`
}

// HandySendHTTPRequest 纯转发：仅 http/https，30s 超时。
// ponytail: 响应体截断 2MB，够调试接口；需大响应/流式时再改分片。
func (a *App) HandySendHTTPRequest(method, url, headersJSON, reqBody string) (*HandyHTTPResponse, error) {
	if !strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://") {
		return nil, fmt.Errorf("URL 必须以 http:// 或 https:// 开头")
	}
	method = strings.ToUpper(strings.TrimSpace(method))
	if method == "" {
		method = http.MethodGet
	}
	var body io.Reader
	if reqBody != "" && method != http.MethodGet && method != http.MethodHead {
		body = strings.NewReader(reqBody)
	}
	httpReq, err := http.NewRequest(method, url, body)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(headersJSON) != "" {
		headers := map[string]string{}
		if err := json.Unmarshal([]byte(headersJSON), &headers); err != nil {
			return nil, fmt.Errorf("Headers JSON 解析失败: %w", err)
		}
		for k, v := range headers {
			httpReq.Header.Set(k, v)
		}
	}
	start := time.Now()
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return nil, err
	}
	headers := make(map[string]string, len(resp.Header))
	for k, v := range resp.Header {
		headers[k] = strings.Join(v, ", ")
	}
	return &HandyHTTPResponse{
		Status: resp.StatusCode, StatusText: resp.Status,
		Headers: headers, Body: string(raw), ElapsedMs: time.Since(start).Milliseconds(),
	}, nil
}
