package backend

// Response 统一响应结构
type Response struct {
	Success bool        `json:"success"`
	Error   string      `json:"error,omitempty"`
	Data    interface{} `json:"data,omitempty"`
}

// NewSuccessResponse 创建成功响应
func NewSuccessResponse(data interface{}) map[string]interface{} {
	return map[string]interface{}{
		"success": true,
		"data":    data,
	}
}

// NewErrorResponse 创建错误响应
func NewErrorResponse(err error) map[string]interface{} {
	if err == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "未知错误",
		}
	}
	return map[string]interface{}{
		"success": false,
		"error":   err.Error(),
	}
}

// NewErrorResponseWithMsg 创建带自定义错误消息的响应
func NewErrorResponseWithMsg(msg string) map[string]interface{} {
	return map[string]interface{}{
		"success": false,
		"error":   msg,
	}
}

// NewSimpleSuccessResponse 创建简单的成功响应（无数据）
func NewSimpleSuccessResponse() map[string]interface{} {
	return map[string]interface{}{
		"success": true,
	}
}
