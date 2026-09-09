package hiprofiler

import (
	"encoding/binary"
	"fmt"
	"strings"

	"google.golang.org/protobuf/encoding/protowire"
)

// HTTPRequest 表示一个解析后的HTTP请求记录
type HTTPRequest struct {
	URL             string `json:"url"`
	Method          string `json:"method"`
	RequestHeaders  string `json:"requestHeaders"`
	RequestBody     string `json:"requestBody"`
	StatusCode      int    `json:"statusCode"`
	ResponseHeaders string `json:"responseHeaders"`
	ResponseBody    string `json:"responseBody"`
	Aborted         bool   `json:"aborted"`
}

// ParseHtraceData 解析 htrace 二进制数据，返回解析到的 HTTP 请求列表
func ParseHtraceData(data []byte) ([]HTTPRequest, error) {
	if len(data) < 1024 {
		return nil, fmt.Errorf("htrace 文件太小: %d bytes", len(data))
	}
	if string(data[0:8]) != "OHOSPROF" {
		return nil, fmt.Errorf("无效的 htrace 文件头")
	}

	var allRequests []HTTPRequest
	offset := uint64(1024)

	for offset+4 < uint64(len(data)) {
		segLen := binary.LittleEndian.Uint32(data[offset : offset+4])
		offset += 4
		if offset+uint64(segLen) > uint64(len(data)) {
			break
		}
		segData := data[offset : offset+uint64(segLen)]
		offset += uint64(segLen)

		// 解析 ProfilerPluginData (protobuf wire format)
		// field 1 (string) = plugin name
		// field 3 (bytes) = plugin data
		pluginName := ""
		var pluginDataBytes []byte

		buf := segData
		for len(buf) > 0 {
			num, typ, n := protowire.ConsumeTag(buf)
			if n <= 0 {
				break
			}
			buf = buf[n:]

			switch {
			case num == 1 && typ == protowire.BytesType:
				val, m := protowire.ConsumeBytes(buf)
				if m <= 0 {
					goto nextSegment
				}
				buf = buf[m:]
				pluginName = string(val)
			case num == 3 && typ == protowire.BytesType:
				val, m := protowire.ConsumeBytes(buf)
				if m <= 0 {
					goto nextSegment
				}
				buf = buf[m:]
				pluginDataBytes = val
			default:
				m := protowire.ConsumeFieldValue(num, typ, buf)
				if m <= 0 {
					goto nextSegment
				}
				buf = buf[m:]
			}
		}

		if pluginName != "network-profiler" || len(pluginDataBytes) == 0 {
			continue
		}

		// 遍历 AgentData 的 repeated field 1 (事件组)
		buf = pluginDataBytes
		for len(buf) > 0 {
			num, typ, n := protowire.ConsumeTag(buf)
			if n <= 0 {
				break
			}
			buf = buf[n:]
			if typ != protowire.BytesType || num != 1 {
				m := protowire.ConsumeFieldValue(num, typ, buf)
				if m <= 0 {
					break
				}
				buf = buf[m:]
				continue
			}
			eventGroupData, m := protowire.ConsumeBytes(buf)
			if m <= 0 {
				break
			}
			buf = buf[m:]

			req := parseEventGroup(eventGroupData)
			if req != nil && req.URL != "" {
				allRequests = append(allRequests, *req)
			}
		}

	nextSegment:
	}

	return allRequests, nil
}

// parseEventGroup 解析单个事件组 (field 1 of AgentData)
func parseEventGroup(data []byte) *HTTPRequest {
	fields := extractFields(data)
	httpData := bytesVal(fields, 9)
	if httpData == nil {
		return nil
	}

	req := &HTTPRequest{}
	parseHTTPBinaryData(httpData, req)
	return req
}

// parseHTTPBinaryData 解析 field 9 的自定义二进制格式
// 格式: [4字节type LE][4字节length LE][payload...] 重复
//
// 当前 OpenHarmony NetStack 的 STRING 字段顺序:
//
//	[0] RequestId, [1] URL, [2] Method, [3] RequestHeaders,
//	[4] ResponseHeaders, [5] EffectiveURL, [6] IP, [7] HTTPVersion,
//	[8] ReasonPhrase, [9] ResponseBody
//
// ResponseBody 可能被 NetStack 截断为 64 KiB，因此不能通过“是否为完整 JSON”
// 判断其是否有效。旧系统格式继续使用启发式解析作为兼容回退。
func parseHTTPBinaryData(data []byte, req *HTTPRequest) {
	pos := 0
	var parts []string
	var uint32Parts []uint32

	for pos+8 <= len(data) {
		dataType := binary.LittleEndian.Uint32(data[pos : pos+4])
		dataLen := binary.LittleEndian.Uint32(data[pos+4 : pos+8])
		pos += 8

		if pos+int(dataLen) > len(data) {
			break
		}

		payload := data[pos : pos+int(dataLen)]
		pos += int(dataLen)

		switch dataType {
		case 0x01: // timestamp block，跳过
		case 0x02: // uint32 data，当前格式中为响应状态码
			if len(payload) >= 4 {
				uint32Parts = append(uint32Parts, binary.LittleEndian.Uint32(payload[:4]))
			}
		case 0x03: // string data
			parts = append(parts, string(payload))
		}
	}

	if parseCurrentHTTPFields(parts, uint32Parts, req) {
		return
	}
	parseLegacyHTTPFields(parts, req)
}

// parseCurrentHTTPFields 按 OpenHarmony NetStack 的 DfxMessage/TLV 固定字段顺序解析。
func parseCurrentHTTPFields(parts []string, uint32Parts []uint32, req *HTTPRequest) bool {
	if len(parts) < 10 || len(uint32Parts) == 0 || !isHTTPMethod(parts[2]) {
		return false
	}

	req.URL = parts[1]
	req.Method = parts[2]
	req.RequestHeaders = parts[3]
	req.StatusCode = int(uint32Parts[0])
	req.ResponseHeaders = parts[4]
	req.ResponseBody = parts[9]
	return true
}

// parseLegacyHTTPFields 兼容旧版本中字段顺序不固定的 payload。
func parseLegacyHTTPFields(parts []string, req *HTTPRequest) {
	if len(parts) >= 2 {
		req.URL = parts[1]
	}

	// 两遍扫描：第一遍识别 method、请求头、响应头，收集 JSON
	var method string
	var reqHeaderParts []string
	var respHeaderParts []string
	var reqJsonParts []string  // 状态行之前的 JSON（请求体）
	var respJsonParts []string // 状态行之后的 JSON（响应体）
	seenStatusLine := false

	for i, s := range parts {
		if i <= 1 {
			continue
		}
		if isHTTPMethod(s) {
			method = s
			continue
		}
		if strings.HasPrefix(s, "HTTP/") {
			respHeaderParts = append(respHeaderParts, s)
			seenStatusLine = true
			continue
		}
		if looksLikeHeader(s) {
			if seenStatusLine {
				respHeaderParts = append(respHeaderParts, s)
			} else {
				reqHeaderParts = append(reqHeaderParts, s)
			}
			continue
		}
		if looksLikeJSON(s) {
			if seenStatusLine {
				respJsonParts = append(respJsonParts, s)
			} else {
				reqJsonParts = append(reqJsonParts, s)
			}
			continue
		}
	}

	// 设置 Method
	if method == "" {
		method = "GET"
	}
	req.Method = method

	// 设置 Headers
	if len(reqHeaderParts) > 0 {
		req.RequestHeaders = strings.Join(reqHeaderParts, "\n")
	}
	if len(respHeaderParts) > 0 {
		req.ResponseHeaders = strings.Join(respHeaderParts, "\n")
	}

	// 根据 JSON 出现位置分配 body：状态行前 = 请求体，状态行后 = 响应体
	if len(reqJsonParts) >= 1 {
		req.RequestBody = reqJsonParts[0]
	}
	if len(respJsonParts) >= 1 {
		req.ResponseBody = respJsonParts[0]
	}
}

func isHTTPMethod(s string) bool {
	switch s {
	case "GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS", "CONNECT", "TRACE":
		return true
	}
	return false
}

func looksLikeHeader(s string) bool {
	lower := strings.ToLower(s)
	return strings.Contains(lower, "content-type:") ||
		strings.Contains(lower, "host:") ||
		strings.Contains(lower, "user-agent:") ||
		strings.Contains(lower, "authorization:") ||
		strings.Contains(lower, "accept:") ||
		strings.Contains(lower, "connection:") ||
		strings.Contains(lower, "content-length:") ||
		strings.Contains(lower, "transfer-encoding:")
}

func looksLikeJSON(s string) bool {
	return (strings.HasPrefix(s, "{") && strings.HasSuffix(s, "}")) ||
		(strings.HasPrefix(s, "[") && strings.HasSuffix(s, "]"))
}

// extractFields 提取 protobuf wire format 的所有字段
func extractFields(data []byte) map[protowire.Number][]interface{} {
	fields := make(map[protowire.Number][]interface{})
	for len(data) > 0 {
		num, typ, n := protowire.ConsumeTag(data)
		if n <= 0 {
			break
		}
		data = data[n:]
		switch typ {
		case protowire.VarintType:
			val, m := protowire.ConsumeVarint(data)
			if m <= 0 {
				return fields
			}
			data = data[m:]
			fields[num] = append(fields[num], val)
		case protowire.BytesType:
			val, m := protowire.ConsumeBytes(data)
			if m <= 0 {
				return fields
			}
			data = data[m:]
			fields[num] = append(fields[num], val)
		default:
			m := protowire.ConsumeFieldValue(num, typ, data)
			if m <= 0 {
				return fields
			}
			data = data[m:]
		}
	}
	return fields
}

// bytesVal 从 fields map 中获取指定字段号的 bytes 值
func bytesVal(fields map[protowire.Number][]interface{}, num protowire.Number) []byte {
	vals := fields[num]
	if len(vals) == 0 {
		return nil
	}
	if v, ok := vals[0].([]byte); ok {
		return v
	}
	return nil
}
