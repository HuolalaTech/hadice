package backend

import (
	"strings"
	"testing"
	"time"
)

func TestCreateSessionBoundaryMarker(t *testing.T) {
	clientID := "test-device-001"
	boundaryType := "disconnect"
	timestamp := int64(1640995200000) // 2022-01-01 00:00:00

	marker := createSessionBoundaryMarker(clientID, boundaryType, timestamp)

	// 验证基本字段
	if marker.ID == "" {
		t.Error("边界标记ID不应为空")
	}

	if marker.Timestamp != timestamp {
		t.Errorf("时间戳不匹配，期望: %d, 实际: %d", timestamp, marker.Timestamp)
	}

	if marker.Direction != "boundary" {
		t.Errorf("方向不正确，期望: boundary, 实际: %s", marker.Direction)
	}

	if !marker.IsSessionBoundary {
		t.Error("应该是会话边界标记")
	}

	if marker.BoundaryType != boundaryType {
		t.Errorf("边界类型不匹配，期望: %s, 实际: %s", boundaryType, marker.BoundaryType)
	}

	if marker.ClientID != clientID {
		t.Errorf("客户端ID不匹配，期望: %s, 实际: %s", clientID, marker.ClientID)
	}

	// 验证边界消息格式（允许时区差异）
	expectedPrefix := "客户端test-device-001已断开("
	expectedSuffix := ":00)"
	if !strings.HasPrefix(marker.BoundaryMessage, expectedPrefix) ||
	   !strings.HasSuffix(marker.BoundaryMessage, expectedSuffix) {
		t.Errorf("边界消息格式不正确，实际: %s", marker.BoundaryMessage)
	}

	// 验证ID格式
	expectedIDPrefix := "boundary-test-device-001-1640995200000"
	if marker.ID != expectedIDPrefix {
		t.Errorf("ID格式不正确，期望前缀: %s, 实际: %s", expectedIDPrefix, marker.ID)
	}
}

func TestNetworkRequestBoundaryFields(t *testing.T) {
	request := NetworkRequest{
		ID:                "test-123",
		Timestamp:         time.Now().UnixMilli(),
		Method:            "GET",
		URL:               "http://example.com",
		Direction:         "boundary",
		IsSessionBoundary: true,
		BoundaryType:      "disconnect",
		ClientID:          "client-001",
		BoundaryMessage:   "客户端client-001已断开(12:34:56)",
	}

	// 验证边界标记字段
	if !request.IsSessionBoundary {
		t.Error("应该是会话边界标记")
	}

	if request.BoundaryType != "disconnect" {
		t.Error("边界类型应该是disconnect")
	}

	if request.ClientID != "client-001" {
		t.Error("客户端ID不正确")
	}

	if request.BoundaryMessage == "" {
		t.Error("边界消息不应为空")
	}
}
