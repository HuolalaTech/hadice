package hypium

import (
	"encoding/json"
	"fmt"
	"time"
)

// RpcClient RPC 客户端
type RpcClient struct {
	device       *Device
	objIndex     int
	serverStarted bool
}

// NewRpcClient 创建新的 RPC 客户端
func NewRpcClient(device *Device) *RpcClient {
	return &RpcClient{
		device:       device,
		objIndex:     0,
		serverStarted: false,
	}
}

// CallUiTest 调用 UiTest API
// api: API 名称，如 "Driver.getDisplaySize"
// thisRef: this 引用，如 "Driver#0"
// params: 参数列表
func (r *RpcClient) CallUiTest(api string, thisRef string, params ...interface{}) (string, error) {
	// 确保服务器已启动
	if !r.serverStarted {
		if err := r.device.InitDevice(); err != nil {
			return "", fmt.Errorf("初始化设备失败: %v", err)
		}
		r.serverStarted = true
	}

	// 构建 RPC 消息
	rpcParams := map[string]interface{}{
		"api":         api,
		"this":        thisRef,
		"args":        params,
		"message_type": "hypium",
	}

	rpcMessage := map[string]interface{}{
		"module":     "com.ohos.devicetest.hypiumApiHelper",
		"method":     "callHypiumApi",
		"params":     rpcParams,
		"request_id": fmt.Sprintf("%d", time.Now().UnixNano()),
	}

	// 序列化为 JSON
	msgBytes, err := json.Marshal(rpcMessage)
	if err != nil {
		return "", fmt.Errorf("序列化 RPC 消息失败: %v", err)
	}

	// 发送 RPC 消息
	response, err := r.device.Rpc(string(msgBytes))
	if err != nil {
		return "", err
	}

	// 解析响应
	var result map[string]interface{}
	if err := json.Unmarshal([]byte(response), &result); err != nil {
		return "", fmt.Errorf("解析 RPC 响应失败: %v", err)
	}

	// 检查是否有异常
	if exception, ok := result["exception"]; ok && exception != nil {
		return "", fmt.Errorf("RPC 调用返回异常: %v", exception)
	}

	// 返回结果
	if resultStr, ok := result["result"].(string); ok {
		return resultStr, nil
	}

	// 如果 result 不是字符串，序列化为 JSON
	resultBytes, err := json.Marshal(result["result"])
	if err != nil {
		return "", fmt.Errorf("序列化结果失败: %v", err)
	}

	return string(resultBytes), nil
}

// Disconnect 断开连接
func (r *RpcClient) Disconnect() error {
	return r.device.Close()
}

