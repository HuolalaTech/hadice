package device

import (
	"log"
	"sync"
)

// Manager 设备管理器
type Manager struct {
	providers   []DeviceProvider
	mu          sync.RWMutex
	deviceCache []Device
	cacheValid  bool
}

// NewManager 创建设备管理器
func NewManager() *Manager {
	return &Manager{
		providers:   make([]DeviceProvider, 0),
		deviceCache: make([]Device, 0),
		cacheValid:  false,
	}
}

// RegisterProvider 注册设备提供者
func (m *Manager) RegisterProvider(provider DeviceProvider) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.providers = append(m.providers, provider)
	m.cacheValid = false
	log.Printf("[DeviceManager] 注册设备提供者: %s", provider.GetPlatform())
}

// ListAllDevices 列出所有设备（鸿蒙 + 安卓）
func (m *Manager) ListAllDevices(verbose bool) ([]Device, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// 并行获取所有提供者的设备列表
	type result struct {
		devices []Device
		err     error
	}

	resultChan := make(chan result, len(m.providers))

	for _, provider := range m.providers {
		go func(p DeviceProvider) {
			devices, err := p.ListDevices(verbose)
			resultChan <- result{devices: devices, err: err}
		}(provider)
	}

	// 收集结果
	var allDevices []Device
	for i := 0; i < len(m.providers); i++ {
		res := <-resultChan
		if res.err != nil {
			log.Printf("[DeviceManager] 获取设备列表失败: %v", res.err)
			continue
		}
		allDevices = append(allDevices, res.devices...)
	}

	// 更新缓存
	m.deviceCache = allDevices
	m.cacheValid = true

	return allDevices, nil
}

// GetProvider 获取指定平台的提供者
func (m *Manager) GetProvider(platform Platform) DeviceProvider {
	m.mu.RLock()
	defer m.mu.RUnlock()

	for _, provider := range m.providers {
		if provider.GetPlatform() == platform {
			return provider
		}
	}
	return nil
}

// GetProviders 获取所有提供者
func (m *Manager) GetProviders() []DeviceProvider {
	m.mu.RLock()
	defer m.mu.RUnlock()

	providers := make([]DeviceProvider, len(m.providers))
	copy(providers, m.providers)
	return providers
}

// GetDeviceByConnectKey 根据 connectKey 获取设备信息
// 优先从缓存获取，缓存不存在时查询设备
func (m *Manager) GetDeviceByConnectKey(connectKey string) *Device {
	m.mu.RLock()
	defer m.mu.RUnlock()

	// 从缓存中查找
	for i := range m.deviceCache {
		if m.deviceCache[i].ConnectKey == connectKey {
			return &m.deviceCache[i]
		}
	}

	// 缓存中没有，重新查询（此时已持有读锁，不能再获取写锁）
	// 返回 nil，让调用者处理
	return nil
}

// GetDevicePlatform 根据 connectKey 获取设备平台类型
// 注意：如果缓存中没有找到设备，返回空字符串，调用者应该自己处理
func (m *Manager) GetDevicePlatform(connectKey string) Platform {
	device := m.GetDeviceByConnectKey(connectKey)
	if device == nil {
		// 缓存中没有找到，返回空字符串表示未知
		// 调用者应该确保在调用此方法前已刷新设备列表，或使用已知的 platform 信息
		log.Printf("[DeviceManager] 警告: 设备 %s 未在缓存中找到，无法确定平台", connectKey)
		return ""
	}
	return device.Platform
}

// UpdateCache 更新设备缓存
func (m *Manager) UpdateCache(devices []Device) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.deviceCache = devices
	m.cacheValid = true
}
