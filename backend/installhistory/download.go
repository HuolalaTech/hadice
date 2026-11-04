package installhistory

import (
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	MaxDownloadBytes     int64 = 4 * 1024 * 1024 * 1024
	maxDownloadRedirects       = 5
)

type DownloadedPackage struct {
	Path     string
	FileName string
	FileSize int64
}

type Downloader struct {
	client   *http.Client
	maxBytes int64
}

func NewDownloader(client *http.Client, maxBytes int64) *Downloader {
	if client == nil {
		client = http.DefaultClient
	}
	clonedClient := *client
	clonedClient.CheckRedirect = checkDownloadRedirect
	clonedClient.Timeout = 30 * time.Minute
	return &Downloader{client: &clonedClient, maxBytes: maxBytes}
}

func (d *Downloader) Download(
	ctx context.Context,
	rawURL string,
	platform string,
	stagingDir string,
) (DownloadedPackage, error) {
	parsedURL, err := url.ParseRequestURI(rawURL)
	if err != nil || (parsedURL.Scheme != "http" && parsedURL.Scheme != "https") || parsedURL.Host == "" {
		return DownloadedPackage{}, fmt.Errorf("下载地址无效：仅支持 http/https 直链")
	}
	// ponytail: 不在下载前卡 path 后缀——OSS 签名链常带 ?Expires=…，制品站也可能是无后缀再 302；
	// 真实后缀在 Content-Disposition / 最终 URL / 解压阶段再校验（见 validatePackageExtension）。
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, parsedURL.String(), nil)
	if err != nil {
		return DownloadedPackage{}, fmt.Errorf("创建下载请求失败：%w", err)
	}
	resp, err := d.client.Do(req)
	if err != nil {
		return DownloadedPackage{}, fmt.Errorf("下载失败：%w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return DownloadedPackage{}, fmt.Errorf("%s", formatDownloadHTTPError(resp))
	}

	finalURL := parsedURL
	if resp.Request != nil && resp.Request.URL != nil {
		finalURL = resp.Request.URL
	}
	// ponytail: 先收下再验——制品站常是 /download?id= 无后缀，真实类型靠落盘后嗅探
	fileName := downloadFileName(resp.Header.Get("Content-Disposition"), finalURL)
	if resp.ContentLength > d.maxBytes {
		return DownloadedPackage{}, fmt.Errorf("安装包大小超过限制：最大 %d 字节", d.maxBytes)
	}

	file, err := os.CreateTemp(stagingDir, stagingFilePattern(fileName))
	if err != nil {
		return DownloadedPackage{}, fmt.Errorf("创建暂存文件失败：%w", err)
	}
	stagingPath := file.Name()
	keepFile := false
	defer func() {
		_ = file.Close()
		if !keepFile {
			_ = os.Remove(stagingPath)
		}
	}()

	fileSize, err := io.Copy(file, io.LimitReader(resp.Body, d.maxBytes+1))
	if err != nil {
		return DownloadedPackage{}, fmt.Errorf("写入安装包失败：%w", err)
	}
	if fileSize > d.maxBytes {
		return DownloadedPackage{}, fmt.Errorf("安装包实际大小超过限制：最大 %d 字节", d.maxBytes)
	}
	if err := file.Close(); err != nil {
		return DownloadedPackage{}, fmt.Errorf("关闭暂存文件失败：%w", err)
	}

	resolvedName, err := resolveDownloadedPackageName(stagingPath, fileName, platform)
	if err != nil {
		return DownloadedPackage{}, err
	}
	fileName = resolvedName

	keepFile = true
	return DownloadedPackage{Path: stagingPath, FileName: fileName, FileSize: fileSize}, nil
}

// ponytail: 只吃前 4KB 错误体——够解析 OSS/S3 XML，避免把 HTML 错误页整页读进内存。
func formatDownloadHTTPError(resp *http.Response) string {
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	code, message := parseObjectStorageError(body)
	if strings.EqualFold(message, "Request has expired.") || strings.Contains(strings.ToLower(message), "expired") {
		return "下载失败：链接已过期，请重新获取带签名的下载地址后再试"
	}
	if code != "" && message != "" {
		return fmt.Sprintf("下载失败：服务器返回状态码 %d（%s：%s）", resp.StatusCode, code, message)
	}
	if message != "" {
		return fmt.Sprintf("下载失败：服务器返回状态码 %d（%s）", resp.StatusCode, message)
	}
	return fmt.Sprintf("下载失败：服务器返回状态码 %d", resp.StatusCode)
}

type objectStorageErrorXML struct {
	XMLName xml.Name `xml:"Error"`
	Code    string   `xml:"Code"`
	Message string   `xml:"Message"`
}

func parseObjectStorageError(body []byte) (code, message string) {
	trimmed := strings.TrimSpace(string(body))
	if trimmed == "" {
		return "", ""
	}
	var parsed objectStorageErrorXML
	if err := xml.Unmarshal([]byte(trimmed), &parsed); err == nil && (parsed.Code != "" || parsed.Message != "") {
		return strings.TrimSpace(parsed.Code), strings.TrimSpace(parsed.Message)
	}
	if len(trimmed) > 200 {
		trimmed = trimmed[:200] + "…"
	}
	return "", trimmed
}

func checkDownloadRedirect(req *http.Request, via []*http.Request) error {
	if len(via) >= maxDownloadRedirects {
		return fmt.Errorf("下载失败：重定向次数超过限制")
	}
	if req.URL == nil || (req.URL.Scheme != "http" && req.URL.Scheme != "https") || req.URL.Host == "" {
		return fmt.Errorf("下载失败：重定向目标不是 http/https")
	}
	if len(via) > 0 && via[0].URL != nil && via[0].URL.Scheme == "https" && req.URL.Scheme != "https" {
		return fmt.Errorf("下载失败：不允许从 https 重定向到 http")
	}
	return nil
}

func stagingFilePattern(fileName string) string {
	extension := filepath.Ext(fileName)
	baseName := strings.TrimSuffix(filepath.Base(fileName), extension)
	if baseName == "" || baseName == "." {
		baseName = "package"
	}
	return baseName + "-*" + extension
}

func downloadFileName(contentDisposition string, parsedURL *url.URL) string {
	if _, params, err := mime.ParseMediaType(contentDisposition); err == nil {
		if fileName := filepath.Base(params["filename"]); fileName != "" && fileName != "." {
			return fileName
		}
	}
	return filepath.Base(parsedURL.Path)
}

var (
	androidInstallExtensions = []string{".apk", ".zip", ".gz", ".7z", ".tar", ".tgz", ".tar.gz"}
	harmonyInstallExtensions = []string{".hap", ".hsp", ".har", ".zip", ".gz", ".7z", ".tar", ".tgz", ".tar.gz"}
)

func hasInstallExtension(name string, extensions []string) bool {
	lowerName := strings.ToLower(name)
	for _, extension := range extensions {
		if strings.HasSuffix(lowerName, extension) {
			return true
		}
	}
	return false
}

func validatePackageExtension(fileName string, platform string) error {
	switch platform {
	case PlatformAndroid:
		if hasInstallExtension(fileName, androidInstallExtensions) {
			return nil
		}
		return fmt.Errorf("Android 安装包仅支持 .apk 或 .zip/.gz/.7z/.tar 等压缩包")
	case PlatformHarmonyOS:
		if hasInstallExtension(fileName, harmonyInstallExtensions) {
			return nil
		}
		return fmt.Errorf("HarmonyOS 安装包仅支持 .hap、.hsp、.har、.zip、.gz、.7z、.tar 等")
	default:
		return fmt.Errorf("不支持的平台：%s", platform)
	}
}

// resolveDownloadedPackageName：下载完成后再判类型；无后缀但内容是 zip 则补 .zip；HTML 登录页直接报错。
func resolveDownloadedPackageName(path, fileName, platform string) (string, error) {
	if looksLikeHTMLFile(path) {
		return "", fmt.Errorf("下载到的是网页而不是安装包（可能需登录或鉴权，请改用可直接下载的 http/https 地址）")
	}
	if err := validatePackageExtension(fileName, platform); err == nil {
		return fileName, nil
	}
	if looksLikeZipFile(path) {
		base := strings.TrimSuffix(filepath.Base(fileName), filepath.Ext(fileName))
		if base == "" || base == "." {
			base = "package"
		}
		guess := base + ".zip"
		if err := validatePackageExtension(guess, platform); err == nil {
			return guess, nil
		}
	}
	return "", validatePackageExtension(fileName, platform)
}

func readFileHead(path string, n int) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	buf := make([]byte, n)
	got, err := io.ReadFull(f, buf)
	if err == io.EOF || err == io.ErrUnexpectedEOF {
		return buf[:got], nil
	}
	if err != nil {
		return nil, err
	}
	return buf, nil
}

func looksLikeHTMLFile(path string) bool {
	head, err := readFileHead(path, 512)
	if err != nil || len(head) == 0 {
		return false
	}
	s := strings.ToLower(string(head))
	s = strings.TrimSpace(s)
	return strings.HasPrefix(s, "<!doctype html") ||
		strings.HasPrefix(s, "<html") ||
		strings.Contains(s, "<html")
}

func looksLikeZipFile(path string) bool {
	head, err := readFileHead(path, 4)
	if err != nil || len(head) < 2 {
		return false
	}
	// PK\x03\x04 local file / PK\x05\x06 empty / PK\x07\x08 spanned
	return head[0] == 'P' && head[1] == 'K'
}
