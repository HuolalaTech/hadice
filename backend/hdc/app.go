package hdc

// AppInfo 应用信息
type AppInfo struct {
	PackageName string `json:"packageName"` // 包名
	AppName     string `json:"appName"`     // 应用名称
	Version     string `json:"version"`     // 版本名称
	VersionCode int    `json:"versionCode"` // 版本号
	Size        int64  `json:"size"`        // 应用大小（字节）
	Icon        string `json:"icon"`        // 应用图标（base64 data URL）
	IsSystemApp bool   `json:"isSystemApp"` // 是否为系统应用
	IsRunning   bool   `json:"isRunning"`   // 是否正在运行
	IsEnabled   bool   `json:"isEnabled"`   // 是否启用
	InstallTime int64  `json:"installTime"` // 安装时间戳
}

// AppStats 应用统计信息
type AppStats struct {
	Total      int `json:"total"`      // 总应用数
	System     int `json:"system"`     // 系统应用数
	ThirdParty int `json:"thirdParty"` // 第三方应用数
	Running    int `json:"running"`    // 运行中的应用数
}

// AppListResult 应用列表结果
type AppListResult struct {
	Stats AppStats  `json:"stats"` // 统计信息
	Apps  []AppInfo `json:"apps"`  // 应用列表
}

// InstallPackageInfo 安装包信息（平台无关，支持 HAP/APK）
type InstallPackageInfo struct {
	// 通用字段
	FilePath         string                   `json:"filePath"`
	FileSize         int64                    `json:"fileSize"`
	AppName          string                   `json:"appName"`
	Icon             string                   `json:"icon,omitempty"`
	BundleName       string                   `json:"bundleName"` // Android: packageName
	VersionName      string                   `json:"versionName"`
	VersionCode      int                      `json:"versionCode"`
	MinAPIVersion    int                      `json:"minAPIVersion,omitempty"`    // Android: minSdkVersion
	TargetAPIVersion int                      `json:"targetAPIVersion,omitempty"` // Android: targetSdkVersion
	Permissions      []map[string]interface{} `json:"permissions"`

	// 鸿蒙 HAP 特有字段
	ExtractedHapPath  string                   `json:"extractedHapPath,omitempty"`
	LayeredIcon       map[string]string        `json:"layeredIcon,omitempty"`
	Vendor            string                   `json:"vendor,omitempty"`
	ModuleName        string                   `json:"moduleName,omitempty"`
	ModuleDescription string                   `json:"moduleDescription,omitempty"`
	CompileSdkVersion string                   `json:"compileSdkVersion,omitempty"`
	CompileMode       string                   `json:"compileMode,omitempty"`
	VirtualMachine    string                   `json:"virtualMachine,omitempty"`
	DeviceTypes       []string                 `json:"deviceTypes,omitempty"`
	Abilities         []map[string]interface{} `json:"abilities,omitempty"`

	// Android APK 特有字段
	NativeCode []string `json:"nativeCode,omitempty"` // 如: arm64-v8a, armeabi-v7a
}

// HapAppInfo 向后兼容别名
// Deprecated: 使用 InstallPackageInfo 代替
type HapAppInfo = InstallPackageInfo

// ShortcutInfo 应用快捷方式信息
type ShortcutInfo struct {
	ID             string        `json:"id"`
	Label          string        `json:"label"`
	LabelID        int           `json:"labelId"`
	Icon           string        `json:"icon"`
	IconID         int           `json:"iconId"`
	BundleName     string        `json:"bundleName"`
	ModuleName     string        `json:"moduleName"`
	IsEnables      bool          `json:"isEnables"`
	IsHomeShortcut bool          `json:"isHomeShortcut"`
	IsStatic       bool          `json:"isStatic"`
	Intents        []interface{} `json:"intents"`
}

// MissionInfo 任务信息
type MissionInfo struct {
	MissionID       int             `json:"missionId"`
	MissionName     string          `json:"missionName"`
	LockedState     int             `json:"lockedState"`
	MissionAffinity string          `json:"missionAffinity"`
	AbilityRecords  []AbilityRecord `json:"abilityRecords"`
}

// AbilityRecord 能力记录
type AbilityRecord struct {
	AbilityRecordID int    `json:"abilityRecordId"`
	AppName         string `json:"appName"`
	MainName        string `json:"mainName"`
	BundleName      string `json:"bundleName"`
	AbilityType     int    `json:"abilityType"`
	State           int    `json:"state"`
	StartTime       int64  `json:"startTime"`
	AppState        int    `json:"appState"`
	Ready           bool   `json:"ready"`
	WindowAttached  bool   `json:"windowAttached"`
	Launcher        bool   `json:"launcher"`
	IsKeepAlive     bool   `json:"isKeepAlive"`
}

// RunningRecord 运行中的应用记录
type RunningRecord struct {
	RecordID             int        `json:"recordId"`
	ProcessName          string     `json:"processName"`
	PID                  int        `json:"pid"`
	UID                  int        `json:"uid"`
	State                int        `json:"state"`
	UIExtensionProviders []Provider `json:"uiExtensionProviders"`
	RootCallers          []Caller   `json:"rootCallers"`
}

// Provider UI扩展提供者
type Provider struct {
	PID int `json:"pid"`
}

// Caller 根调用者
type Caller struct {
	PID int `json:"pid"`
}
