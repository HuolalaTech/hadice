package installhistory

import (
	"os"
	"path/filepath"
	"testing"
)

func TestStoreClampsMaxPerPlatform(t *testing.T) {
	for _, test := range []struct {
		name     string
		input    int
		expected int
	}{
		{name: "negative defaults to 50", input: -1, expected: 50},
		{name: "zero defaults to 50", input: 0, expected: 50},
		{name: "one remains one", input: 1, expected: 1},
		{name: "fifty remains fifty", input: 50, expected: 50},
		{name: "above fifty clamps to 50", input: 51, expected: 50},
	} {
		t.Run(test.name, func(t *testing.T) {
			store := NewStore(t.TempDir(), test.input)
			if store.maxPerPlatform != test.expected {
				t.Fatalf("maxPerPlatform = %d, want %d", store.maxPerPlatform, test.expected)
			}
		})
	}
}

func TestStoreSeparatesPlatformsAndPrunesOldest(t *testing.T) {
	store := NewStore(t.TempDir(), 2)
	for _, item := range []Item{
		{Platform: PlatformAndroid, SourceType: SourceLocal, Source: "/a.apk", SHA256: "a"},
		{Platform: PlatformAndroid, SourceType: SourceLocal, Source: "/b.apk", SHA256: "b"},
		{Platform: PlatformAndroid, SourceType: SourceLocal, Source: "/c.apk", SHA256: "c"},
		{Platform: PlatformHarmonyOS, SourceType: SourceURL, Source: "https://example.com/a.hap", SHA256: "h"},
	} {
		if _, err := store.Append(item); err != nil {
			t.Fatal(err)
		}
	}

	android, err := store.List(PlatformAndroid)
	if err != nil {
		t.Fatal(err)
	}
	if len(android) != 2 || android[0].SHA256 != "c" || android[1].SHA256 != "b" {
		t.Fatalf("unexpected android history: %#v", android)
	}
	harmony, err := store.List(PlatformHarmonyOS)
	if err != nil {
		t.Fatal(err)
	}
	if len(harmony) != 1 || harmony[0].SHA256 != "h" {
		t.Fatalf("unexpected harmony history: %#v", harmony)
	}
}

func TestDeleteRemovesPackageOnlyAfterLastReference(t *testing.T) {
	baseDir := t.TempDir()
	source := filepath.Join(baseDir, "demo.apk")
	if err := os.WriteFile(source, []byte("same package"), 0o600); err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(baseDir, "history"), 50)
	cached, err := store.CachePackage(source)
	if err != nil {
		t.Fatal(err)
	}
	first, err := store.Append(Item{Platform: PlatformAndroid, SHA256: cached.SHA256, CachedPath: cached.Path})
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.Append(Item{Platform: PlatformAndroid, SHA256: cached.SHA256, CachedPath: cached.Path})
	if err != nil {
		t.Fatal(err)
	}

	if err := store.Delete(PlatformAndroid, first.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(cached.Path); err != nil {
		t.Fatalf("shared cache removed too early: %v", err)
	}
	if err := store.Delete(PlatformAndroid, second.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(cached.Path); !os.IsNotExist(err) {
		t.Fatalf("cache should be removed, got %v", err)
	}
}

func TestDescribeLocalPackageDoesNotCopyIntoPackages(t *testing.T) {
	baseDir := t.TempDir()
	source := filepath.Join(baseDir, "demo.apk")
	if err := os.WriteFile(source, []byte("local package"), 0o600); err != nil {
		t.Fatal(err)
	}
	store := NewStore(filepath.Join(baseDir, "history"), 50)
	described, err := store.DescribeLocalPackage(source)
	if err != nil {
		t.Fatal(err)
	}
	absSource, err := filepath.Abs(source)
	if err != nil {
		t.Fatal(err)
	}
	if described.Path != absSource {
		t.Fatalf("DescribeLocalPackage path = %q, want %q", described.Path, absSource)
	}
	entries, err := os.ReadDir(filepath.Join(baseDir, "history", "packages"))
	if err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("local describe should not create cache files, got %d", len(entries))
	}
}

func TestCachePackageReusesSameContentAndNormalizedExtension(t *testing.T) {
	baseDir := t.TempDir()
	firstSource := filepath.Join(baseDir, "first.APK")
	secondSource := filepath.Join(baseDir, "second.apk")
	for _, source := range []string{firstSource, secondSource} {
		if err := os.WriteFile(source, []byte("same package"), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	store := NewStore(filepath.Join(baseDir, "history"), 50)
	first, err := store.CachePackage(firstSource)
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.CachePackage(secondSource)
	if err != nil {
		t.Fatal(err)
	}
	if first.Path != second.Path {
		t.Fatalf("same content and extension should reuse cache: %q != %q", first.Path, second.Path)
	}
	if filepath.Ext(first.Path) != ".apk" {
		t.Fatalf("cache extension = %q, want .apk", filepath.Ext(first.Path))
	}
}

func TestCachePackageKeepsSameContentWithDifferentExtensions(t *testing.T) {
	baseDir := t.TempDir()
	apkSource := filepath.Join(baseDir, "demo.apk")
	hapSource := filepath.Join(baseDir, "demo.hap")
	for _, source := range []string{apkSource, hapSource} {
		if err := os.WriteFile(source, []byte("same package"), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	store := NewStore(filepath.Join(baseDir, "history"), 50)
	apk, err := store.CachePackage(apkSource)
	if err != nil {
		t.Fatal(err)
	}
	hap, err := store.CachePackage(hapSource)
	if err != nil {
		t.Fatal(err)
	}
	if apk.SHA256 != hap.SHA256 {
		t.Fatalf("same content should have same SHA-256: %q != %q", apk.SHA256, hap.SHA256)
	}
	if apk.Path == hap.Path {
		t.Fatalf("different extensions should have distinct cache paths: %q", apk.Path)
	}
	for _, path := range []string{apk.Path, hap.Path} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("expected cache file %q: %v", path, err)
		}
	}
}
