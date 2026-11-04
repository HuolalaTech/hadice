package backend

import (
	"archive/zip"
	"os"
	"path/filepath"
	"testing"
)

func TestFindApkFileInExtractedZip(t *testing.T) {
	dir := t.TempDir()
	nested := filepath.Join(dir, "payload")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	apkPath := filepath.Join(nested, "demo.apk")
	if err := os.WriteFile(apkPath, []byte("apk"), 0o644); err != nil {
		t.Fatal(err)
	}
	found, err := findApkFile(dir)
	if err != nil {
		t.Fatal(err)
	}
	if found != apkPath {
		t.Fatalf("findApkFile() = %q, want %q", found, apkPath)
	}
}

func TestExtractZipAndFindApk(t *testing.T) {
	sourceDir := t.TempDir()
	zipPath := filepath.Join(sourceDir, "bundle.zip")
	if err := writeZipWithFile(zipPath, "inner/app.apk", []byte("apk-bytes")); err != nil {
		t.Fatal(err)
	}

	found, err := extractAndFindPackage(zipPath, ".apk")
	if err != nil {
		t.Fatalf("extractAndFindPackage() error = %v", err)
	}
	if filepath.Base(found) != "app.apk" {
		t.Fatalf("extracted apk = %q", found)
	}
	data, err := os.ReadFile(found)
	if err != nil || string(data) != "apk-bytes" {
		t.Fatalf("apk content = %q, %v", data, err)
	}
}

func writeZipWithFile(zipPath, name string, content []byte) error {
	file, err := os.Create(zipPath)
	if err != nil {
		return err
	}
	defer file.Close()

	writer := zip.NewWriter(file)
	entry, err := writer.Create(name)
	if err != nil {
		return err
	}
	if _, err := entry.Write(content); err != nil {
		return err
	}
	return writer.Close()
}
