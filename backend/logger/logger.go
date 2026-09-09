package logger

import (
	"io"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"gopkg.in/natefinch/lumberjack.v2"
)

var (
	// Logger 全局日志实例
	Logger *zap.Logger
	// Sugar 全局 Sugar 日志实例（更易用的 API）
	Sugar *zap.SugaredLogger
	// logFilePath 当前日志文件路径
	logFilePath string
	// logsDir 日志目录
	logsDir string
)

// InitLogger 初始化日志系统
// logDir: 日志目录路径，如果为空则使用默认路径
func InitLogger(logDir string) error {
	// 确定日志目录
	if logDir == "" {
		// 获取用户数据目录
		homeDir, err := os.UserHomeDir()
		if err != nil {
			return err
		}

		// 根据平台设置日志目录
		if runtime.GOOS == "darwin" {
			// macOS: ~/Library/Application Support/Hadice/logs
			logsDir = filepath.Join(homeDir, "Library", "Application Support", "Hadice", "logs")
		} else if runtime.GOOS == "windows" {
			// Windows: %APPDATA%\Hadice\logs
			appData := os.Getenv("APPDATA")
			if appData == "" {
				appData = filepath.Join(homeDir, "AppData", "Roaming")
			}
			logsDir = filepath.Join(appData, "Hadice", "logs")
		} else {
			// Linux: ~/.local/share/Hadice/logs
			logsDir = filepath.Join(homeDir, ".local", "share", "Hadice", "logs")
		}
	} else {
		logsDir = logDir
	}

	// 确保日志目录存在
	if err := os.MkdirAll(logsDir, 0755); err != nil {
		return err
	}

	// 生成日志文件名（日期-序号.log）
	now := time.Now()
	dateStr := now.Format("2006-01-02")
	logFilePath = filepath.Join(logsDir, dateStr+".log")

	// 配置 lumberjack（日志轮转）
	lumberjackLogger := &lumberjack.Logger{
		Filename:   logFilePath,
		MaxSize:    100,  // 每个日志文件最大 100MB
		MaxBackups: 10,   // 保留 10 个备份文件
		MaxAge:     30,   // 保留 30 天的日志
		Compress:   true, // 压缩旧日志文件
		LocalTime:  true, // 使用本地时间
	}

	// 配置 zap 编码器
	encoderConfig := zap.NewProductionEncoderConfig()
	encoderConfig.TimeKey = "timestamp"
	encoderConfig.EncodeTime = zapcore.ISO8601TimeEncoder
	encoderConfig.EncodeLevel = zapcore.LowercaseLevelEncoder
	encoderConfig.StacktraceKey = "stacktrace"
	encoderConfig.CallerKey = "caller"
	encoderConfig.MessageKey = "message"
	encoderConfig.LevelKey = "level"

	// 文件编码器（JSON 格式）
	fileEncoder := zapcore.NewJSONEncoder(encoderConfig)

	// 控制台编码器（更易读的格式）
	consoleEncoderConfig := zap.NewDevelopmentEncoderConfig()
	consoleEncoderConfig.EncodeTime = zapcore.TimeEncoderOfLayout("2006-01-02 15:04:05.000")
	consoleEncoderConfig.EncodeLevel = zapcore.CapitalColorLevelEncoder
	consoleEncoder := zapcore.NewConsoleEncoder(consoleEncoderConfig)

	// 文件写入器（异步）
	fileWriteSyncer := zapcore.AddSync(lumberjackLogger)

	// 控制台写入器
	consoleWriteSyncer := zapcore.AddSync(os.Stdout)

	// 创建核心（同时写入文件和控制台）
	core := zapcore.NewTee(
		// 文件输出：JSON 格式，所有级别（结构化日志，便于程序解析）
		zapcore.NewCore(fileEncoder, fileWriteSyncer, zapcore.DebugLevel),
		// 控制台输出：彩色格式，所有级别（确保所有控制台输出都写入文件）
		// 注意：由于文件输出已经包含所有级别，所以所有控制台显示的日志都会写入文件
		zapcore.NewCore(consoleEncoder, consoleWriteSyncer, zapcore.DebugLevel),
	)

	// 添加调用者信息
	callerOpt := zap.AddCaller()
	stackTraceOpt := zap.AddStacktrace(zapcore.ErrorLevel)

	// 创建 Logger
	Logger = zap.New(core, callerOpt, stackTraceOpt)
	Sugar = Logger.Sugar()

	// 重定向标准库 log 的输出到日志文件
	// 创建一个写入器，同时写入文件和控制台
	// 注意：lumberjackLogger 实现了 io.Writer 接口，可以直接使用
	logMultiWriter := io.MultiWriter(
		lumberjackLogger, // 写入日志文件
		os.Stdout,        // 保持控制台输出
	)
	log.SetOutput(logMultiWriter)
	log.SetFlags(0) // 移除默认的时间戳等，因为 zap 会添加

	// 记录日志系统初始化
	Sugar.Infow("日志系统初始化完成",
		"logDir", logsDir,
		"logFile", logFilePath,
		"platform", runtime.GOOS,
		"arch", runtime.GOARCH,
	)

	return nil
}

// GetLogFilePath 获取当前日志文件路径
func GetLogFilePath() string {
	return logFilePath
}

// GetLogsDirectory 获取日志目录路径
func GetLogsDirectory() string {
	return logsDir
}

// Sync 同步所有缓冲的日志条目
func Sync() error {
	if Logger != nil {
		return Logger.Sync()
	}
	return nil
}

// Close 关闭日志系统
func Close() error {
	if Logger != nil {
		err := Logger.Sync()
		Logger = nil
		Sugar = nil
		return err
	}
	return nil
}
