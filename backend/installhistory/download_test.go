package installhistory

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestDownloaderFollowsHTTPRedirectToPackage(t *testing.T) {
	var targetVisits atomic.Int32
	mux := http.NewServeMux()
	mux.HandleFunc("/getArtifact/app.apk", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/iotinstaller.apk", http.StatusMovedPermanently)
	})
	mux.HandleFunc("/iotinstaller.apk", func(w http.ResponseWriter, r *http.Request) {
		targetVisits.Add(1)
		_, _ = w.Write([]byte("apk"))
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	pkg, err := NewDownloader(server.Client(), 1024).Download(
		context.Background(),
		server.URL+"/getArtifact/app.apk",
		PlatformAndroid,
		t.TempDir(),
	)
	if err != nil {
		t.Fatalf("Download() error = %v", err)
	}
	if targetVisits.Load() != 1 {
		t.Fatalf("redirect target visited %d times", targetVisits.Load())
	}
	if pkg.FileName != "iotinstaller.apk" || pkg.FileSize != 3 {
		t.Fatalf("Download() = %+v", pkg)
	}
}

func TestDownloaderRejectsNonHTTPRedirectAndHTTPSDowngrade(t *testing.T) {
	fileReq, err := http.NewRequest(http.MethodGet, "file:///tmp/app.apk", nil)
	if err != nil {
		t.Fatal(err)
	}
	httpsReq, err := http.NewRequest(http.MethodGet, "https://cdn.example/app.apk", nil)
	if err != nil {
		t.Fatal(err)
	}
	httpReq, err := http.NewRequest(http.MethodGet, "http://cdn.example/app.apk", nil)
	if err != nil {
		t.Fatal(err)
	}
	startHTTPS, err := http.NewRequest(http.MethodGet, "https://api.example/app.apk", nil)
	if err != nil {
		t.Fatal(err)
	}

	if err := checkDownloadRedirect(fileReq, []*http.Request{httpsReq}); err == nil {
		t.Fatal("expected file:// redirect rejection")
	}
	if err := checkDownloadRedirect(httpReq, []*http.Request{startHTTPS}); err == nil {
		t.Fatal("expected https to http downgrade rejection")
	}

	via := make([]*http.Request, maxDownloadRedirects)
	for i := range via {
		via[i] = httpsReq
	}
	if err := checkDownloadRedirect(httpsReq, via); err == nil {
		t.Fatal("expected redirect hop limit rejection")
	}
}

func TestDownloaderRejectsOversizeBodyAndRemovesStagingFile(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.(http.Flusher).Flush()
		_, _ = w.Write([]byte("12345"))
	}))
	defer server.Close()

	stagingDir := t.TempDir()
	if _, err := NewDownloader(server.Client(), 4).Download(
		context.Background(),
		server.URL+"/app.apk",
		PlatformAndroid,
		stagingDir,
	); err == nil {
		t.Fatal("expected actual body size rejection")
	}
	entries, err := os.ReadDir(stagingDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("staging directory contains %d files after oversized body", len(entries))
	}
}

func TestDownloaderClonesClientAndSetsProductionTimeout(t *testing.T) {
	redirectSentinel := errors.New("original redirect policy")
	originalRedirect := func(_ *http.Request, _ []*http.Request) error {
		return redirectSentinel
	}
	client := &http.Client{
		CheckRedirect: originalRedirect,
		Timeout:       17 * time.Second,
	}

	downloader := NewDownloader(client, 1024)

	if client.Timeout != 17*time.Second {
		t.Fatalf("original client timeout = %v, want 17s", client.Timeout)
	}
	if err := client.CheckRedirect(nil, nil); !errors.Is(err, redirectSentinel) {
		t.Fatalf("original redirect policy changed: %v", err)
	}
	if downloader.client == client {
		t.Fatal("downloader retained original client pointer")
	}
	if downloader.client.Timeout != 30*time.Minute {
		t.Fatalf("downloader timeout = %v, want 30m", downloader.client.Timeout)
	}
	allowed, err := http.NewRequest(http.MethodGet, "https://cdn.example/app.apk", nil)
	if err != nil {
		t.Fatal(err)
	}
	start, err := http.NewRequest(http.MethodGet, "https://api.example/app.apk", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := downloader.client.CheckRedirect(allowed, []*http.Request{start}); err != nil {
		t.Fatalf("downloader should follow https redirect: %v", err)
	}
}

func TestDownloaderValidatesSchemeAndPlatformExtension(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("pkg"))
	}))
	defer server.Close()

	downloader := NewDownloader(server.Client(), 1024)
	dir := t.TempDir()
	if _, err := downloader.Download(context.Background(), "file:///tmp/a.apk", PlatformAndroid, dir); err == nil {
		t.Fatal("expected scheme rejection")
	}
	if _, err := downloader.Download(context.Background(), server.URL+"/a.hap", PlatformAndroid, dir); err == nil {
		t.Fatal("expected android extension rejection")
	}
	if _, err := downloader.Download(context.Background(), server.URL+"/a.exe", PlatformHarmonyOS, dir); err == nil {
		t.Fatal("expected unsupported HarmonyOS extension rejection")
	}
}

func TestDownloaderUsesSafeContentDispositionName(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Disposition", `attachment; filename="../../release.apk"`)
		_, _ = w.Write([]byte("apk"))
	}))
	defer server.Close()

	dir := t.TempDir()
	pkg, err := NewDownloader(server.Client(), 1024).Download(
		context.Background(),
		server.URL+"/fallback.apk",
		PlatformAndroid,
		dir,
	)
	if err != nil {
		t.Fatalf("Download() error = %v", err)
	}
	if pkg.FileName != "release.apk" || pkg.FileSize != 3 {
		t.Fatalf("Download() = %+v", pkg)
	}
	if filepath.Dir(pkg.Path) != dir || filepath.Ext(pkg.Path) != ".apk" {
		t.Fatalf("unexpected staging path: %s", pkg.Path)
	}
	if data, err := os.ReadFile(pkg.Path); err != nil || string(data) != "apk" {
		t.Fatalf("downloaded file = %q, %v", data, err)
	}
}

func TestDownloaderAcceptsSignedURLWithQuerySuffix(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/signed-artifact.zip" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte("zip"))
	}))
	defer server.Close()

	signed := server.URL + "/signed-artifact.zip?Expires=1793260603&OSSAccessKeyId=demo&Signature=abc%2Fdef%3D&response-content-type=application%2Foctet-stream"
	pkg, err := NewDownloader(server.Client(), 1024).Download(
		context.Background(),
		signed,
		PlatformHarmonyOS,
		t.TempDir(),
	)
	if err != nil {
		t.Fatalf("Download() error = %v", err)
	}
	if pkg.FileName != "signed-artifact.zip" || pkg.FileSize != 3 {
		t.Fatalf("Download() = %+v", pkg)
	}
}

func TestDownloaderUsesContentDispositionWhenURLHasNoExtension(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Disposition", `attachment; filename="app.apk"`)
		_, _ = w.Write([]byte("apk"))
	}))
	defer server.Close()

	pkg, err := NewDownloader(server.Client(), 1024).Download(
		context.Background(),
		server.URL+"/download",
		PlatformAndroid,
		t.TempDir(),
	)
	if err != nil {
		t.Fatalf("Download() error = %v", err)
	}
	if pkg.FileName != "app.apk" || pkg.FileSize != 3 {
		t.Fatalf("Download() = %+v", pkg)
	}
}

func TestDownloaderRejectsDownloadedFileWithoutInstallExtension(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("bin"))
	}))
	defer server.Close()

	_, err := NewDownloader(server.Client(), 1024).Download(
		context.Background(),
		server.URL+"/payload.bin",
		PlatformAndroid,
		t.TempDir(),
	)
	if err == nil || !strings.Contains(err.Error(), ".apk") {
		t.Fatalf("expected extension rejection after download, got %v", err)
	}
}

func TestDownloaderRejectsHTMLLoginPageAfterDownload(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte("<!DOCTYPE html><html><body>login</body></html>"))
	}))
	defer server.Close()

	_, err := NewDownloader(server.Client(), 1024).Download(
		context.Background(),
		server.URL+"/download?id=1",
		PlatformAndroid,
		t.TempDir(),
	)
	if err == nil || !strings.Contains(err.Error(), "网页") {
		t.Fatalf("expected HTML rejection after download, got %v", err)
	}
}

func TestDownloaderSniffsZipWhenURLHasNoExtension(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// minimal zip local-file magic
		_, _ = w.Write([]byte("PK\x03\x04fake-zip-body"))
	}))
	defer server.Close()

	pkg, err := NewDownloader(server.Client(), 1024).Download(
		context.Background(),
		server.URL+"/download?id=1710348",
		PlatformAndroid,
		t.TempDir(),
	)
	if err != nil {
		t.Fatalf("Download() error = %v", err)
	}
	if !strings.HasSuffix(strings.ToLower(pkg.FileName), ".zip") {
		t.Fatalf("expected sniffed .zip name, got %q", pkg.FileName)
	}
}

func TestDownloaderFollowsRedirectFromPathWithoutExtension(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/getArtifact", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/iotinstaller.apk", http.StatusFound)
	})
	mux.HandleFunc("/iotinstaller.apk", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("apk"))
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	pkg, err := NewDownloader(server.Client(), 1024).Download(
		context.Background(),
		server.URL+"/getArtifact?id=1",
		PlatformAndroid,
		t.TempDir(),
	)
	if err != nil {
		t.Fatalf("Download() error = %v", err)
	}
	if pkg.FileName != "iotinstaller.apk" || pkg.FileSize != 3 {
		t.Fatalf("Download() = %+v", pkg)
	}
}

func TestDownloaderAllowsRepeatedDownloadsToSameStagingDir(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("apk"))
	}))
	defer server.Close()

	dir := t.TempDir()
	downloader := NewDownloader(server.Client(), 1024)
	first, err := downloader.Download(context.Background(), server.URL+"/app.apk", PlatformAndroid, dir)
	if err != nil {
		t.Fatal(err)
	}
	second, err := downloader.Download(context.Background(), server.URL+"/app.apk", PlatformAndroid, dir)
	if err != nil {
		t.Fatal(err)
	}
	if first.Path == second.Path {
		t.Fatal("repeated downloads reused the same staging path")
	}
	if _, err := os.Stat(first.Path); err != nil {
		t.Fatalf("first staging file missing: %v", err)
	}
	if _, err := os.Stat(second.Path); err != nil {
		t.Fatalf("second staging file missing: %v", err)
	}
}

func TestDownloaderRejectsContentLengthAndHTTPErrorWithoutLeavingFile(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/large.apk", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "5")
		_, _ = w.Write([]byte("12345"))
	})
	mux.HandleFunc("/missing.apk", func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "missing", http.StatusNotFound)
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	dir := t.TempDir()
	downloader := NewDownloader(server.Client(), 4)
	if _, err := downloader.Download(context.Background(), server.URL+"/large.apk", PlatformAndroid, dir); err == nil {
		t.Fatal("expected Content-Length rejection")
	}
	if _, err := downloader.Download(context.Background(), server.URL+"/missing.apk", PlatformAndroid, dir); err == nil || !strings.Contains(err.Error(), "404") {
		t.Fatalf("expected error containing status code 404, got %v", err)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("staging directory contains %d files after failures", len(entries))
	}
}

func TestDownloaderReportsExpiredSignedURL(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?>
<Error>
  <Code>AccessDenied</Code>
  <Message>Request has expired.</Message>
</Error>`))
	}))
	defer server.Close()

	_, err := NewDownloader(server.Client(), 1024).Download(
		context.Background(),
		server.URL+"/signed-artifact.zip?Expires=1&Signature=x",
		PlatformHarmonyOS,
		t.TempDir(),
	)
	if err == nil || !strings.Contains(err.Error(), "链接已过期") {
		t.Fatalf("expected expired URL message, got %v", err)
	}
}
