package webpeek

import (
	"fmt"
	"net/url"
	"strings"
)

// NormalizeURL 校验并规范化 http/https；无 scheme 时补 https。
func NormalizeURL(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", fmt.Errorf("empty url")
	}
	if !strings.Contains(trimmed, "://") {
		trimmed = "https://" + trimmed
	}
	u, err := url.Parse(trimmed)
	if err != nil {
		return "", err
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", fmt.Errorf("only http/https allowed")
	}
	if u.Host == "" {
		return "", fmt.Errorf("missing host")
	}
	return u.String(), nil
}
