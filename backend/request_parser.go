package backend

import (
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/samber/lo"
)

// parseNetworkRequest 解析网络请求
// 参考 HarmonyDeviceDock/src/main/ipc/handlers/networkCapture/parser.ts 的实现
func parseNetworkRequest(msg map[string]interface{}) *NetworkRequest {
	// 检查是否是 SocketPacket 格式 (version + type + data)
	version, hasVersion := msg["version"].(float64)
	msgType, hasType := msg["type"].(string)

	if hasVersion && hasType {
		// 处理 http_record 类型
		if msgType == "http_record" {
			return parseHttpRecord(msg, version)
		}

		// 处理 mock_check 类型（不返回NetworkRequest，而是返回nil表示特殊处理）
		if msgType == "mock_check" {
			// Mock检查请求由调用方单独处理，不在这里返回NetworkRequest
			return nil
		}

		log.Printf("[NetworkCapture] parseNetworkRequest: 未知的 SocketPacket 类型: %s (version=%.0f)", msgType, version)
		return nil
	}

	// 兼容旧格式：type == "http" 或 "network"
	if msgType == "http" || msgType == "network" {
		return parseLegacyFormat(msg)
	}

	log.Printf("[NetworkCapture] parseNetworkRequest: 无法识别的消息格式, type=%v, hasVersion=%v", msgType, hasVersion)
	return nil
}

// parseHttpRecord 解析 http_record 格式的请求
func parseHttpRecord(msg map[string]interface{}, version float64) *NetworkRequest {
	data, ok := msg["data"].(map[string]interface{})
	if !ok {
		log.Printf("[NetworkCapture] parseNetworkRequest: http_record 类型但 data 字段不存在或类型错误")
		return nil
	}

	request := &NetworkRequest{
		Direction: "request",
	}

	// 提取 extra 信息
	extra := extractHttpExtra(data)
	if extra != nil {
		request.Extra = extra
		// 使用 extra.id 和 extra.uid 生成唯一 ID
		if extra.ID > 0 {
			request.ID = fmt.Sprintf("http-%d-%s", extra.ID, extra.UID)
		} else {
			request.ID = fmt.Sprintf("%d-%s", time.Now().UnixNano(), extra.UID)
		}
		// 使用 extra.reqTime 作为时间戳
		if extra.ReqTime > 0 {
			request.Timestamp = extra.ReqTime
		} else {
			request.Timestamp = time.Now().UnixMilli()
		}
	} else {
		// 如果没有 extra，生成默认值
		request.ID = fmt.Sprintf("%d-%s", time.Now().UnixNano(), fmt.Sprintf("%d", time.Now().UnixNano())[:9])
		request.Timestamp = time.Now().UnixMilli()
	}

	// 提取请求信息
	if reqData, ok := data["request"].(map[string]interface{}); ok {
		extractRequestInfo(request, reqData)
	}

	// 提取响应信息
	if respData, ok := data["response"].(map[string]interface{}); ok {
		extractResponseInfo(request, respData)
	}

	// 保存原始数据
	rawBytes, err := json.MarshalIndent(msg, "", "  ")
	if err == nil {
		request.RawData = string(rawBytes)
	} else {
		request.RawData = fmt.Sprintf("%v", msg)
	}

	log.Printf("[NetworkCapture] parseNetworkRequest: 成功解析 http_record, ID=%s, Method=%s, URL=%s, Direction=%s",
		request.ID, request.Method, request.URL, request.Direction)
	return request
}

// extractHttpExtra 提取 HTTP Extra 信息
func extractHttpExtra(httpData map[string]interface{}) *HttpExtra {
	extraData, ok := httpData["extra"].(map[string]interface{})
	if !ok {
		return nil
	}

	extra := &HttpExtra{}
	if id, ok := extraData["id"].(float64); ok {
		extra.ID = int(id)
	}
	if uid, ok := extraData["uid"].(string); ok {
		extra.UID = uid
	}
	if reqTime, ok := extraData["reqTime"].(float64); ok {
		extra.ReqTime = int64(reqTime)
	}
	if respTime, ok := extraData["respTime"].(float64); ok {
		extra.RespTime = int64(respTime)
	}

	return extra
}

// extractRequestInfo 提取请求信息
func extractRequestInfo(request *NetworkRequest, reqData map[string]interface{}) {
	// 提取方法
	if method, ok := reqData["method"].(string); ok {
		request.Method = strings.ToUpper(method)
	} else {
		request.Method = "GET"
	}

	// 提取和构建 URL
	url := ""
	if urlStr, ok := reqData["url"].(string); ok {
		url = urlStr
	}

	baseURL := ""
	if baseURLStr, ok := reqData["baseURL"].(string); ok {
		baseURL = baseURLStr
	}

	// 保存 BaseURL 用于前端展示
	request.BaseURL = baseURL

	// 构建完整 URL
	if baseURL != "" && url != "" {
		if strings.HasPrefix(url, "http://") || strings.HasPrefix(url, "https://") {
			request.FullURL = url
			request.URL = url
		} else {
			// 拼接 baseURL 和 url
			base := strings.TrimSuffix(baseURL, "/")
			if strings.HasPrefix(url, "?") {
				request.FullURL = base + url
				request.URL = url
			} else {
				path := url
				if !strings.HasPrefix(path, "/") {
					path = "/" + path
				}
				request.FullURL = base + path
				request.URL = url
			}
		}
	} else if url != "" {
		request.URL = url
		request.FullURL = url
	}

	// 提取请求头（使用lo.MapValues优化）
	if headers, ok := reqData["headers"].(map[string]interface{}); ok {
		request.RequestHeaders = lo.MapValues(headers, func(v interface{}, _ string) string {
			if str, ok := v.(string); ok {
				return str
			}
			return fmt.Sprintf("%v", v)
		})
	}

	// 提取请求体（对于 GET 请求，不将 params 当作 Body）
	// params 将被单独提取作为 RequestParams
	request.RequestBody = extractBody(reqData, "data")
	
	// 提取 URL Query Parameters (新增)
	if params, ok := reqData["params"].(map[string]interface{}); ok {
		request.RequestParams = params
	}
}

// extractResponseInfo 提取响应信息
func extractResponseInfo(request *NetworkRequest, respData map[string]interface{}) {
	request.Direction = "response"

	if status, ok := respData["status"].(float64); ok {
		request.StatusCode = int(status)
	}

	// 提取响应头（使用lo.MapValues优化）
	if headers, ok := respData["headers"].(map[string]interface{}); ok {
		request.ResponseHeaders = lo.MapValues(headers, func(v interface{}, _ string) string {
			if str, ok := v.(string); ok {
				return str
			}
			return fmt.Sprintf("%v", v)
		})
	}

	// 提取响应体
	request.ResponseBody = extractBody(respData, "data")
}

// extractBody 提取请求体或响应体
func extractBody(data map[string]interface{}, fields ...string) string {
	for _, field := range fields {
		if dataField, ok := data[field]; ok {
			if dataStr, ok := dataField.(string); ok {
				return dataStr
			}
			bodyBytes, err := json.MarshalIndent(dataField, "", "  ")
			if err == nil {
				return string(bodyBytes)
			}
			return fmt.Sprintf("%v", dataField)
		}
	}
	return ""
}

// parseLegacyFormat 解析旧格式的请求
func parseLegacyFormat(msg map[string]interface{}) *NetworkRequest {
	request := &NetworkRequest{
		ID:        fmt.Sprintf("%d-%s", time.Now().UnixNano(), fmt.Sprintf("%d", time.Now().UnixNano())[:9]),
		Timestamp: time.Now().UnixMilli(),
		Direction: "request",
	}

	if method, ok := msg["method"].(string); ok {
		request.Method = method
	} else {
		request.Method = "GET"
	}

	if url, ok := msg["url"].(string); ok {
		request.URL = url
		request.FullURL = url
	} else if path, ok := msg["path"].(string); ok {
		request.URL = path
		request.FullURL = path
	}

	if statusCode, ok := msg["statusCode"].(float64); ok {
		request.StatusCode = int(statusCode)
		request.Direction = "response"
	}

	// 使用lo.MapValues优化请求头提取
	if reqHeaders, ok := msg["requestHeaders"].(map[string]interface{}); ok {
		request.RequestHeaders = lo.MapValues(reqHeaders, func(v interface{}, _ string) string {
			if str, ok := v.(string); ok {
				return str
			}
			return ""
		})
	}

	if respHeaders, ok := msg["responseHeaders"].(map[string]interface{}); ok {
		request.ResponseHeaders = lo.MapValues(respHeaders, func(v interface{}, _ string) string {
			if str, ok := v.(string); ok {
				return str
			}
			return ""
		})
	}

	if reqBody, ok := msg["requestBody"].(string); ok {
		request.RequestBody = reqBody
	}

	if respBody, ok := msg["responseBody"].(string); ok {
		request.ResponseBody = respBody
	}

	if rawData, ok := msg["rawData"].(string); ok {
		request.RawData = rawData
	} else {
		rawBytes, _ := json.MarshalIndent(msg, "", "  ")
		request.RawData = string(rawBytes)
	}

	if direction, ok := msg["direction"].(string); ok && direction == "response" {
		request.Direction = "response"
	}

	log.Printf("[NetworkCapture] parseNetworkRequest: 成功解析旧格式, ID=%s, Method=%s, URL=%s",
		request.ID, request.Method, request.URL)
	return request
}
