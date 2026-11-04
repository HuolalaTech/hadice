package installhistory

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	PlatformAndroid   = "android"
	PlatformHarmonyOS = "harmonyos"
	SourceLocal       = "local"
	SourceURL         = "url"
	historyVersion    = 1
)

type Item struct {
	ID          string `json:"id"`
	Platform    string `json:"platform"`
	SourceType  string `json:"sourceType"`
	Source      string `json:"source"`
	FileName    string `json:"fileName"`
	FileSize    int64  `json:"fileSize"`
	CachedPath  string `json:"cachedPath"`
	SHA256      string `json:"sha256"`
	AppName     string `json:"appName,omitempty"`
	PackageName string `json:"packageName,omitempty"`
	VersionName string `json:"versionName,omitempty"`
	VersionCode int    `json:"versionCode,omitempty"`
	InstalledAt int64  `json:"installedAt"`
	Success     bool   `json:"success"`
	Error       string `json:"error,omitempty"`
}

type CachedPackage struct {
	Path     string
	SHA256   string
	FileName string
	FileSize int64
}

type diskHistory struct {
	Version   int               `json:"version"`
	Platforms map[string][]Item `json:"platforms"`
}

type Store struct {
	baseDir        string
	historyPath    string
	packagesDir    string
	stagingDir     string
	maxPerPlatform int
	mu             sync.Mutex
}

func NewStore(baseDir string, maxPerPlatform int) *Store {
	if maxPerPlatform <= 0 || maxPerPlatform > 50 {
		maxPerPlatform = 50
	}
	return &Store{
		baseDir:        baseDir,
		historyPath:    filepath.Join(baseDir, "history.json"),
		packagesDir:    filepath.Join(baseDir, "packages"),
		stagingDir:     filepath.Join(baseDir, "staging"),
		maxPerPlatform: maxPerPlatform,
	}
}

// DescribeLocalPackage 只读取本地原文件元数据，不拷贝到 packages 缓存。
func (s *Store) DescribeLocalPackage(sourcePath string) (CachedPackage, error) {
	source, err := os.Open(sourcePath)
	if err != nil {
		return CachedPackage{}, err
	}
	defer source.Close()

	info, err := source.Stat()
	if err != nil {
		return CachedPackage{}, err
	}
	if !info.Mode().IsRegular() {
		return CachedPackage{}, fmt.Errorf("source package is not a regular file: %s", sourcePath)
	}

	hash := sha256.New()
	if _, err := io.Copy(hash, source); err != nil {
		return CachedPackage{}, err
	}
	absPath, err := filepath.Abs(sourcePath)
	if err != nil {
		return CachedPackage{}, err
	}
	return CachedPackage{
		Path:     absPath,
		SHA256:   hex.EncodeToString(hash.Sum(nil)),
		FileName: info.Name(),
		FileSize: info.Size(),
	}, nil
}

// CachePackage 将安装包拷贝到受管缓存（仅用于链接下载后的持久化）。
func (s *Store) CachePackage(sourcePath string) (CachedPackage, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	source, err := os.Open(sourcePath)
	if err != nil {
		return CachedPackage{}, err
	}
	defer source.Close()

	info, err := source.Stat()
	if err != nil {
		return CachedPackage{}, err
	}
	if !info.Mode().IsRegular() {
		return CachedPackage{}, fmt.Errorf("source package is not a regular file: %s", sourcePath)
	}
	if err := os.MkdirAll(s.packagesDir, 0o755); err != nil {
		return CachedPackage{}, err
	}

	temp, err := os.CreateTemp(s.packagesDir, ".cache-*")
	if err != nil {
		return CachedPackage{}, err
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)

	hash := sha256.New()
	_, copyErr := io.Copy(io.MultiWriter(temp, hash), source)
	syncErr := temp.Sync()
	closeErr := temp.Close()
	if err := errors.Join(copyErr, syncErr, closeErr); err != nil {
		return CachedPackage{}, err
	}

	digest := hex.EncodeToString(hash.Sum(nil))
	target := filepath.Join(s.packagesDir, digest+strings.ToLower(filepath.Ext(info.Name())))
	if _, err := os.Stat(target); err == nil {
		return CachedPackage{
			Path:     target,
			SHA256:   digest,
			FileName: info.Name(),
			FileSize: info.Size(),
		}, nil
	} else if !os.IsNotExist(err) {
		return CachedPackage{}, err
	}
	if err := os.Rename(tempPath, target); err != nil {
		return CachedPackage{}, err
	}

	return CachedPackage{
		Path:     target,
		SHA256:   digest,
		FileName: info.Name(),
		FileSize: info.Size(),
	}, nil
}

func (s *Store) Append(item Item) (Item, error) {
	if err := validatePlatform(item.Platform); err != nil {
		return Item{}, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	history, err := s.loadLocked()
	if err != nil {
		return Item{}, err
	}
	if item.ID == "" {
		item.ID, err = newID()
		if err != nil {
			return Item{}, err
		}
	}
	if item.InstalledAt == 0 {
		item.InstalledAt = time.Now().UnixMilli()
	}

	items := append([]Item{item}, history.Platforms[item.Platform]...)
	if s.maxPerPlatform > 0 && len(items) > s.maxPerPlatform {
		items = items[:s.maxPerPlatform]
	}
	history.Platforms[item.Platform] = items
	if err := s.saveLocked(history); err != nil {
		return Item{}, err
	}
	if err := s.removeUnreferencedPackagesLocked(history); err != nil {
		return Item{}, err
	}
	return item, nil
}

func (s *Store) List(platform string) ([]Item, error) {
	if err := validatePlatform(platform); err != nil {
		return nil, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	history, err := s.loadLocked()
	if err != nil {
		return nil, err
	}
	return append([]Item(nil), history.Platforms[platform]...), nil
}

func (s *Store) Find(platform, id string) (Item, error) {
	if err := validatePlatform(platform); err != nil {
		return Item{}, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	history, err := s.loadLocked()
	if err != nil {
		return Item{}, err
	}
	for _, item := range history.Platforms[platform] {
		if item.ID == id {
			return item, nil
		}
	}
	return Item{}, fmt.Errorf("install history item %q not found", id)
}

func (s *Store) Delete(platform, id string) error {
	if err := validatePlatform(platform); err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	history, err := s.loadLocked()
	if err != nil {
		return err
	}
	items := history.Platforms[platform]
	index := -1
	for i := range items {
		if items[i].ID == id {
			index = i
			break
		}
	}
	if index < 0 {
		return fmt.Errorf("install history item %q not found", id)
	}
	history.Platforms[platform] = append(items[:index], items[index+1:]...)
	if err := s.saveLocked(history); err != nil {
		return err
	}
	if err := s.removeUnreferencedPackagesLocked(history); err != nil {
		return fmt.Errorf("历史记录已删除，但缓存清理失败：%w", err)
	}
	return nil
}

func (s *Store) Clear(platform string) error {
	if err := validatePlatform(platform); err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	history, err := s.loadLocked()
	if err != nil {
		return err
	}
	history.Platforms[platform] = nil
	if err := s.saveLocked(history); err != nil {
		return err
	}
	if err := s.removeUnreferencedPackagesLocked(history); err != nil {
		return fmt.Errorf("历史记录已清空，但缓存清理失败：%w", err)
	}
	return nil
}

func (s *Store) CleanupStaging() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := os.RemoveAll(s.stagingDir); err != nil {
		return err
	}
	return os.MkdirAll(s.stagingDir, 0o755)
}

func (s *Store) StagingDir() (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := os.MkdirAll(s.stagingDir, 0o755); err != nil {
		return "", err
	}
	return s.stagingDir, nil
}

func validatePlatform(platform string) error {
	if platform != PlatformAndroid && platform != PlatformHarmonyOS {
		return fmt.Errorf("unsupported platform %q", platform)
	}
	return nil
}

func newID() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

func (s *Store) loadLocked() (diskHistory, error) {
	history := diskHistory{
		Version: historyVersion,
		Platforms: map[string][]Item{
			PlatformAndroid:   nil,
			PlatformHarmonyOS: nil,
		},
	}
	data, err := os.ReadFile(s.historyPath)
	if os.IsNotExist(err) {
		return history, nil
	}
	if err != nil {
		return diskHistory{}, err
	}
	if err := json.Unmarshal(data, &history); err != nil {
		corruptPath := fmt.Sprintf("%s.corrupt-%d", s.historyPath, time.Now().Unix())
		if renameErr := os.Rename(s.historyPath, corruptPath); renameErr != nil {
			return diskHistory{}, errors.Join(err, renameErr)
		}
		return diskHistory{}, fmt.Errorf("invalid install history moved to %s: %w", corruptPath, err)
	}
	if history.Platforms == nil {
		history.Platforms = make(map[string][]Item)
	}
	return history, nil
}

func (s *Store) saveLocked(history diskHistory) error {
	if err := os.MkdirAll(s.baseDir, 0o755); err != nil {
		return err
	}
	history.Version = historyVersion
	data, err := json.MarshalIndent(history, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')

	tempPath := s.historyPath + ".tmp"
	file, err := os.OpenFile(tempPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	if _, err := file.Write(data); err != nil {
		file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(tempPath, s.historyPath)
}

func (s *Store) removeUnreferencedPackagesLocked(history diskHistory) error {
	entries, err := os.ReadDir(s.packagesDir)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}

	referenced := make(map[string]struct{})
	for _, platform := range []string{PlatformAndroid, PlatformHarmonyOS} {
		items := history.Platforms[platform]
		for _, item := range items {
			if item.CachedPath == "" {
				continue
			}
			path, err := filepath.Abs(item.CachedPath)
			if err == nil {
				referenced[path] = struct{}{}
			}
		}
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		path := filepath.Join(s.packagesDir, entry.Name())
		absolutePath, err := filepath.Abs(path)
		if err != nil {
			return err
		}
		if _, ok := referenced[absolutePath]; !ok {
			if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
				return err
			}
		}
	}
	return nil
}
