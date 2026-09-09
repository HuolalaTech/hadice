package backend

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"

	applogger "Hadice/backend/logger"
)

const ciEnvFileName = ".env.ci"

// LoadCIEnv loads private CI config into the process environment.
// Order (later sources do not overwrite already-set keys):
//  1. Existing process environment
//  2. Local `.env.ci` (dev / CI checkout only — never shipped in the app bundle)
//  3. Build-time embedded defaults from generate:cienv (cienv_generated.go)
// Missing file is not an error (open-source / local builds may omit it).
func LoadCIEnv() {
	path := findCIEnvPath()
	if path == "" {
		if applogger.Sugar != nil {
			applogger.Sugar.Info("[Env] .env.ci not found; using embedded defaults if any")
		}
	} else if err := loadEnvFile(path); err != nil {
		if applogger.Sugar != nil {
			applogger.Sugar.Warnf("[Env] failed to load %s: %v", path, err)
		}
	} else if applogger.Sugar != nil {
		applogger.Sugar.Infof("[Env] loaded %s", path)
	}

	applyEmbeddedCIEnv()
}

// applyEmbeddedCIEnv fills empty env keys from values baked in at build time.
func applyEmbeddedCIEnv() {
	applied := 0
	for key, val := range embeddedCIEnv {
		val = strings.TrimSpace(val)
		if val == "" || os.Getenv(key) != "" {
			continue
		}
		_ = os.Setenv(key, val)
		applied++
	}
	if applied > 0 && applogger.Sugar != nil {
		applogger.Sugar.Infof("[Env] applied %d embedded CI default(s)", applied)
	}
}

func findCIEnvPath() string {
	if explicit := os.Getenv("HADICE_ENV_CI"); explicit != "" {
		if fileExists(explicit) {
			return explicit
		}
	}

	candidates := []string{}

	if cwd, err := os.Getwd(); err == nil {
		candidates = append(candidates, filepath.Join(cwd, ciEnvFileName))
		candidates = append(candidates, walkUpForCIEnv(cwd)...)
	}

	// Packaged apps must not ship `.env.ci`; private keys are embedded at build time.
	// Only look beside the executable for local/dev convenience (same folder as binary).
	if exe, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exe)
		candidates = append(candidates, filepath.Join(exeDir, ciEnvFileName))
	}

	for _, p := range candidates {
		if fileExists(p) {
			return p
		}
	}
	return ""
}

func walkUpForCIEnv(start string) []string {
	var found []string
	dir := start
	for i := 0; i < 8; i++ {
		candidate := filepath.Join(dir, ciEnvFileName)
		if fileExists(candidate) {
			found = append(found, candidate)
		}
		// Prefer project root (has Taskfile.yml / go.mod)
		if fileExists(filepath.Join(dir, "Taskfile.yml")) || fileExists(filepath.Join(dir, "go.mod")) {
			break
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return found
}

func loadEnvFile(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "export ") {
			line = strings.TrimSpace(strings.TrimPrefix(line, "export "))
		}
		eq := strings.IndexByte(line, '=')
		if eq <= 0 {
			continue
		}
		key := strings.TrimSpace(line[:eq])
		val := strings.TrimSpace(line[eq+1:])
		if key == "" {
			continue
		}
		val = unquoteEnvValue(val)
		if os.Getenv(key) == "" {
			_ = os.Setenv(key, val)
		}
	}
	return scanner.Err()
}

func unquoteEnvValue(val string) string {
	if len(val) >= 2 {
		if (val[0] == '"' && val[len(val)-1] == '"') || (val[0] == '\'' && val[len(val)-1] == '\'') {
			return val[1 : len(val)-1]
		}
	}
	return val
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

// EnvOr returns the first non-empty environment value among keys, or fallback.
func EnvOr(fallback string, keys ...string) string {
	for _, key := range keys {
		if v := strings.TrimSpace(os.Getenv(key)); v != "" {
			return v
		}
	}
	return fallback
}
