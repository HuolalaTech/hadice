package backend

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"Hadice/backend/hdc"
	"Hadice/backend/installhistory"
)

func TestBuildInstallHistoryItemKeepsFailure(t *testing.T) {
	info := &hdc.InstallPackageInfo{
		AppName:     "Demo",
		BundleName:  "com.example.demo",
		VersionName: "1.2.3",
		VersionCode: 12,
	}
	cached := installhistory.CachedPackage{
		Path: "/cache/hash.apk", SHA256: "hash", FileName: "demo.apk", FileSize: 10,
	}
	item := buildInstallHistoryItem(
		"android", "url", "https://example.com/demo.apk", cached, info,
		&hdc.HdcResult{Success: false, Error: "INSTALL_FAILED"},
	)
	if item.Success || item.Error != "INSTALL_FAILED" || item.PackageName != "com.example.demo" {
		t.Fatalf("unexpected item: %#v", item)
	}
}

func TestBuildInstallHistoryItemFromInstallError(t *testing.T) {
	result, attempt := buildInstallAttemptResult(nil, errors.New("install command failed"))
	item := buildInstallHistoryItem(
		installhistory.PlatformAndroid,
		installhistory.SourceLocal,
		"/tmp/demo.apk",
		installhistory.CachedPackage{Path: "/cache/hash.apk"},
		nil,
		result,
	)

	if item.Success || item.Error != "install command failed" {
		t.Fatalf("unexpected history item: %#v", item)
	}
	if attempt.Success || attempt.Error != "install command failed" {
		t.Fatalf("unexpected attempt result: %#v", attempt)
	}
}

func TestInstallAttemptReturnsFailureWithoutGoError(t *testing.T) {
	attempt := &InstallAttemptResult{
		Success:        false,
		Error:          "install command failed",
		HistoryWarning: "history write failed",
	}

	result, err := finishInstallAttempt(attempt, errors.New("install command failed"))

	if err != nil {
		t.Fatalf("completed install attempt must not reject: %v", err)
	}
	if result != attempt || result.Success || result.Error != "install command failed" {
		t.Fatalf("unexpected attempt result: %#v", result)
	}
	if result.HistoryWarning != "history write failed" {
		t.Fatalf("history warning was lost: %#v", result)
	}
}

func TestInstallAttemptKeepsCachedPath(t *testing.T) {
	attempt := &InstallAttemptResult{Success: true, CachedPath: "/cache/hash.apk"}
	result, err := finishInstallAttempt(attempt, nil)
	if err != nil || result.CachedPath != "/cache/hash.apk" {
		t.Fatalf("cached path lost: result=%#v err=%v", result, err)
	}
}

func TestInstallAttemptRejectsBeforeCommandWhenResultMissing(t *testing.T) {
	installErr := errors.New("cache failed")
	result, err := finishInstallAttempt(nil, installErr)
	if result != nil || err != installErr {
		t.Fatalf("pre-command failure should reject, got result=%#v err=%v", result, err)
	}
}

func TestCleanupPreparedInstallSourceRemovesURLStagingFile(t *testing.T) {
	stagingDir := t.TempDir()
	filePath := filepath.Join(stagingDir, "demo.apk")
	if err := os.WriteFile(filePath, []byte("apk"), 0o600); err != nil {
		t.Fatal(err)
	}

	warning := cleanupPreparedInstallSource(
		installhistory.SourceURL,
		filePath,
		stagingDir,
		os.Remove,
	)
	if warning != "" {
		t.Fatalf("unexpected warning: %s", warning)
	}
	if _, err := os.Stat(filePath); !os.IsNotExist(err) {
		t.Fatalf("URL staging file still exists: %v", err)
	}
}

func TestCleanupPreparedInstallSourceKeepsLocalSource(t *testing.T) {
	stagingDir := t.TempDir()
	filePath := filepath.Join(stagingDir, "local.apk")
	if err := os.WriteFile(filePath, []byte("apk"), 0o600); err != nil {
		t.Fatal(err)
	}

	warning := cleanupPreparedInstallSource(
		installhistory.SourceLocal,
		filePath,
		stagingDir,
		os.Remove,
	)
	if warning != "" {
		t.Fatalf("unexpected warning: %s", warning)
	}
	if _, err := os.Stat(filePath); err != nil {
		t.Fatalf("local source was removed: %v", err)
	}
}

func TestCleanupPreparedInstallSourceKeepsURLOutsideStaging(t *testing.T) {
	stagingDir := t.TempDir()
	filePath := filepath.Join(t.TempDir(), "outside.apk")
	if err := os.WriteFile(filePath, []byte("apk"), 0o600); err != nil {
		t.Fatal(err)
	}

	warning := cleanupPreparedInstallSource(
		installhistory.SourceURL,
		filePath,
		stagingDir,
		os.Remove,
	)
	if warning != "" {
		t.Fatalf("unexpected warning: %s", warning)
	}
	if _, err := os.Stat(filePath); err != nil {
		t.Fatalf("URL source outside staging was removed: %v", err)
	}
}

func TestCleanupPreparedInstallSourceReportsDeleteFailure(t *testing.T) {
	stagingDir := t.TempDir()
	filePath := filepath.Join(stagingDir, "demo.apk")
	if err := os.WriteFile(filePath, []byte("apk"), 0o600); err != nil {
		t.Fatal(err)
	}

	warning := cleanupPreparedInstallSource(
		installhistory.SourceURL,
		filePath,
		stagingDir,
		func(string) error { return errors.New("permission denied") },
	)
	if !strings.Contains(warning, "permission denied") {
		t.Fatalf("unexpected warning: %q", warning)
	}
}

func TestInstallSourceRejectsUnknownType(t *testing.T) {
	app := NewApp()
	app.installStore = installhistory.NewStore(t.TempDir(), 50)

	result, err := app.InstallAppWithHistory("unused", "/missing/demo.apk", "remote", "")
	if err == nil || !strings.Contains(err.Error(), "安装来源") {
		t.Fatalf("expected source type error, got result=%#v err=%v", result, err)
	}
	items, listErr := app.installStore.List(installhistory.PlatformAndroid)
	if listErr != nil {
		t.Fatal(listErr)
	}
	if len(items) != 0 {
		t.Fatalf("invalid source wrote history: %#v", items)
	}
}

func TestInstallSourceWarningDoesNotChangeSuccessfulResult(t *testing.T) {
	attempt := &InstallAttemptResult{Success: true, Output: "installed"}
	addInstallWarning(attempt, "cleanup failed")
	addInstallWarning(attempt, "history failed")

	if !attempt.Success || attempt.Output != "installed" || attempt.Error != "" {
		t.Fatalf("warning changed install result: %#v", attempt)
	}
	if attempt.HistoryWarning != "cleanup failed; history failed" {
		t.Fatalf("warning not recorded: %#v", attempt)
	}
}
