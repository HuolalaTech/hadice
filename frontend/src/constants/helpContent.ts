import type { MenuItemId } from './menu'

export interface HelpSection {
  title: string
  content: string | string[] // 字符串或字符串数组（每个元素一行）
  isList?: boolean // 是否作为列表渲染
}

export interface HelpTableRow {
  label: string
  sophon: string
  hiprofiler: string
}

export interface HelpSectionWithTable extends HelpSection {
  table?: HelpTableRow[]
}

export interface HelpFaq {
  question: string
  answer: string
}

export interface HelpContent {
  description: string
  sections: (HelpSection | HelpSectionWithTable)[]
  faqs: HelpFaq[]
}

export const helpContentMap: Record<MenuItemId, HelpContent> = {
  'device-overview': {
    description:
      '设备总览页面提供已连接设备的全局视图，展示设备基本信息、系统存储、电池状态等关键数据。',
    sections: [
      {
        title: '查看设备信息',
        content:
          '连接设备后，页面自动展示设备名称、型号、系统版本、序列号等基本信息。点击右上角"刷新"按钮可手动更新数据。'
      },
      {
        title: '存储与电池',
        content:
          '页面下方展示设备存储使用情况（总量/已用/可用）和电池状态（电量、充电状态、温度等）。'
      },
      {
        title: '多设备管理',
        content:
          '当连接多台设备时，通过顶部的设备选择下拉框切换当前操作的设备。支持同时连接鸿蒙和安卓设备。'
      }
    ],
    faqs: [
      {
        question: '为什么设备信息显示不完整？',
        answer: '请确保设备已正确连接并授权调试。尝试拔插USB线并重新授权，然后点击刷新按钮。'
      }
    ]
  },

  performance: {
    description:
      '性能监控页面提供设备 CPU、内存、FPS、网络流量等关键性能指标的实时可视化监控。',
    sections: [
      {
        title: 'CPU 监控',
        content:
          '实时展示设备的 CPU 总体使用率。可以观察到 CPU 占用峰值，判断是否存在 CPU 密集型操作。'
      },
      {
        title: '内存监控',
        content:
          '展示设备的总内存、已用内存、可用内存和内存使用率曲线。'
      },
      {
        title: 'FPS 监控',
        content:
          '实时显示当前屏幕的帧率。'
      },
      {
        title: '网络监控',
        content:
          '展示设备的网络上传和下载流量曲线。'
      }
    ],
    faqs: [
      {
        question: '监控数据多久刷新一次？',
        answer: '性能数据默认每3秒刷新一次。你可以在页面设置中调整采样间隔。'
      },
      {
        question: '性能监控会影响设备性能吗？',
        answer: '性能监控本身对设备的资源消耗非常小，不会对正常测试造成明显影响。'
      }
    ]
  },

  process: {
    description:
      '进程管理页面展示设备上运行的所有进程列表，支持查看进程详情、搜索过滤和结束进程。',
    sections: [
      {
        title: '进程列表',
        content:
          '页面展示所有正在运行的进程，包括进程名、PID、CPU 占用、内存占用等信息。支持按名称或 PID 搜索过滤。'
      },
      {
        title: '结束进程',
        content: '选中目标进程后，点击"强制结束"按钮可以终止该进程。请谨慎操作，系统关键进程无法被终止。'
      }
    ],
    faqs: [
      {
        question: '结束进程后应用自动重启了？',
        answer: '某些系统应用或服务被结束后会自动重启，这是系统自我保护机制，属于正常行为。'
      },
      {
        question: '为什么有些进程无法终止？',
        answer: '部分底层系统进程无权限终止，仅支持终止用户运行的APP进程。'
      }
    ]
  },

  'app-manager': {
    description:
      '应用管理页面展示设备上安装的所有应用列表，支持查看应用详情、卸载应用、清除应用数据等操作。',
    sections: [
      {
        title: '应用列表',
        content:
          '展示所有已安装的应用，包括应用名、包名、版本号、安装时间等信息。支持按名称或包名搜索，可筛选系统应用和第三方应用。'
      },
      {
        title: '应用操作',
        content:
          '选中应用后可以执行：查看应用详情（权限、签名等）、卸载应用、清除应用数据、强制停止应用等操作。'
      }
    ],
    faqs: [
      {
        question: '应用列表加载很慢？',
        answer: '首次加载需要读取所有应用信息，应用较多时可能需要几秒。'
      }
    ]
  },

  'app-install': {
    description:
      '应用安装页面支持通过快速安装 APK（安卓）或 HAP（鸿蒙）安装包到设备上。',
    sections: [
      {
        title: '拖拽安装',
        content:
          '将 APK/HAP 文件直接拖拽到页面的安装区域即可展示安装包信息，然后可点击安装。'
      },
      {
        title: '选择文件安装',
        content: '点击"选择文件"按钮，在文件对话框中选择要安装的安装包文件。'
      }
    ],
    faqs: [
      {
        question: '鸿蒙安装包安装失败怎么办？',
        answer:
          '鸿蒙系统仅支持安装经过华为签名认证的应用安装包，且设备 UDID 需要在开发者证书中注册。如需安装自定义应用，请联系鸿蒙 APP 开发者获取签名服务。'
      },
      {
        question: '支持后台安装吗？',
        answer: '安装过程需要保持页面开启，安装完成后可以切换到其他页面。'
      },
      {
        question: '可以覆盖安装吗？',
        answer: '可以。如果设备上已存在同包名的应用，会进行覆盖安装，但签名必须一致。'
      }
    ]
  },

  screenshot: {
    description:
      '投屏截屏页面支持将手机屏幕实时投射到电脑，并提供截屏保存、录屏等功能，方便演示和问题记录。',
    sections: [
      {
        title: '实时投屏',
        content:
          '点击"开始投屏"按钮后，手机屏幕画面会实时显示在页面上。支持鼠标点击操作手机，实现远程控制。'
      },
      {
        title: '截图功能',
        content:
          '投屏过程中可以随时点击"截图"按钮捕获当前画面，截图会自动保存到本地。支持在历史记录中查看和管理截图。'
      },
      {
        title: '录屏功能',
        content:
          '点击"开始录屏"按钮可以录制设备屏幕，录制完成后自动保存为视频文件。适合录制 Bug 复现过程。'
      },
      {
        title: '投屏设置',
        content:
          '可以在设置中调整投屏画质、帧率等参数。画质越高延迟可能越大，建议根据实际情况调整。'
      }
    ],
    faqs: [
      {
        question: '投屏画面黑屏？',
        answer: '请确保设备屏幕处于亮屏状态。部分应用可能禁止截屏投屏，这是应用自身的安全策略。'
      },
      {
        question: '投屏失败？',
        answer: '可以尝试多点几次投屏按钮，或者重启Hadice再试。'

      },
      {
        question: '截图保存在哪里？',
        answer: '截图和录屏默认保存在 ~/Documents/Hadice/screenshot，可以在历史列表中右键选择"打开所在文件夹"。'
      }
    ]
  },

  'file-transfer': {
    description:
      '文件传输页面支持在电脑和设备之间双向传输文件，提供可视化的文件浏览器，操作直观方便。',
    sections: [
      {
        title: '文件浏览',
        content:
          '左右双栏布局，左侧为电脑文件系统，右侧为设备文件系统。可以分别浏览和导航不同目录。'
      },
      {
        title: '上传文件到设备',
        content:
          '在左侧选择要传输的文件或文件夹，点击传输按钮或直接拖拽到右侧面板即可上传到设备。'
      },
      {
        title: '从设备下载文件',
        content:
          '在右侧选择设备上的文件，点击下载按钮或拖拽到左侧面板即可下载到电脑。'
      },
      {
        title: '常用目录快捷访问',
        content: '提供设备常用目录的快捷入口（如 Download、DCIM 等），方便快速定位目标目录。'
      }
    ],
    faqs: [
      {
        question: '无法访问某些设备目录？',
        answer: '部分系统目录需要 root 权限才能访问，普通调试模式只能访问应用沙箱目录和公共目录。'
      },
      {
        question: '传输中断了怎么办？',
        answer: '传输中断后需要重新传输，暂不支持断点续传。建议大文件传输时避免操作设备。'
      }
    ]
  },

  'system-logs': {
    description:
      '系统日志页面实时展示设备的系统日志（Logcat/Hilog），支持按级别、关键词、进程等条件过滤，帮助你快速定位问题。',
    sections: [
      {
        title: '实时日志流',
        content:
          '点击"开始监听"按钮后，日志会实时滚动显示。支持暂停/恢复滚动，方便查看特定时间段内的日志。'
      },
      {
        title: '日志过滤',
        content:
          '提供多种过滤方式：按日志级别（Verbose/Debug/Info/Warn/Error）、按关键词搜索、按进程 PID 过滤、按标签 Tag 过滤。'
      },
      {
        title: '日志搜索',
        content: '在搜索框中输入关键词可以高亮匹配的日志条目，支持正则表达式搜索。'
      }
    ],
    faqs: [
      {
        question: '日志量太大怎么办？',
        answer: '使用过滤功能只查看感兴趣的日志。按级别过滤到 Warn 或 Error 可以大幅减少日志量，也可以按包名过滤只看特定应用的日志。'
      },
      {
        question: '为什么看不到某个应用的日志？',
        answer: '请确认过滤条件没有排除该应用的日志。鸿蒙设备使用 Hilog 系统，安卓设备使用 Logcat，两者的日志格式略有不同。'
      }
    ]
  },

  'network-capture': {
    description:
      '鸿蒙抓包支持两种模式：Sophon 模式和 HiProfiler 模式。',
    sections: [
      {
        title: 'Sophon 模式',
        content: [
          '基于 @hll/Sophon 库的 HTTP 抓包，支持实时展示和 Mock 功能。',
          '使用步骤：',
          '• 目标 APP 需集成 @hll/Sophon 库',
          '• 在Hadice的网络请求页面点击"开始抓包"，等待提示"TCP 服务器已启动"',
          '• 在目标鸿蒙APP中开启 Sophon 悬浮窗的 HTTP 流量转发开关',
          '',
          'Mock 配置：在Hadice的网络请求页面点击"配置 Mock"，添加 Mock 规则，拦截匹配的请求并返回自定义响应。需要勾选"启用此规则"才能生效。'
        ],
        isList: true
      },
      {
        title: 'HiProfiler 模式',
        content: [
          '基于 HarmonyOS 系统级 HiProfiler 的 HTTP 抓包，无需在鸿蒙APP中集成额外库，但要求应用是可调试应用。',
          '使用步骤：',
          '• 在进程选择器中选择目标应用（仅显示可调试且正在运行的应用）',
          '• 点击"开始抓包"',
          '• 操作鸿蒙APP 触发网络请求，请求会显示在列表中',
          '',
        ],
        isList: true
      },
      {
        title: '模式对比',
        content: '',
        table: [
          { label: '前置条件', sophon: 'APP 需集成 @hll/Sophon 库', hiprofiler: 'APP是使用调试证书签名的应用' },
          { label: '实时展示', sophon: '✓ ', hiprofiler: '响应完成后由系统批量上报，尾批可能延迟' },
          { label: 'Mock 支持', sophon: '✓ ', hiprofiler: '✗ ' },
          { label: '数据来源', sophon: 'APP 层 Axios Hook', hiprofiler: '系统层 Hook' },
          { label: '适用场景', sophon: 'APP网络库是Axios/需要 Mock 功能', hiprofiler: '未使用Axios/不想引入Sophon库/无Mock需求' },
          { label: '额外操作', sophon: '需在 APP 中开启 Sophon 悬浮窗的 HTTP 流量转发', hiprofiler: '无需额外操作' }
        ]
      },
    ],
    faqs: [
      {
        question: 'HiProfiler 模式为什么看不到目标应用？',
        answer:
          'HiProfiler 模式只显示 debug 签名且正在运行的应用。请确认：\n• 应用使用 debug 证书签名\n• 应用正在运行中（进程存活）'
      },
      {
        question: 'Sophon 模式抓不到请求？',
        answer:
          '请依次检查：\n• 目标 APP 是否已集成 Sophon 库\n• Sophon 悬浮窗中 HTTP 流量转发是否已开启\n• 电脑端是否已点击"开始抓包"并显示服务器已启动'
      },
      {
        question: 'HiProfiler 模式首次开始抓包失败？',
        answer:
          '首次启动时需要重启设备上的 hiprofilerd 服务，可能需要等待几秒。如果持续失败，请断开设备重连后再试。'
      },
      {
        question: 'Mock 规则不生效？',
        answer:
          'Mock 功能仅 Sophon 模式支持。请确认：\n• 已切换到 Sophon 模式\n• 规则已勾选"启用此规则"\n• URL 匹配规则正确（可使用正则表达式）\n• 抓包功能处于开启状态'
      },
    ]
  },

  'android-network-capture': {
    description:
      '安卓抓包通过 JVMTI Agent 与 WebView CDP 并行采集 OkHTTP、Cronet、GNet 和 WebView 请求，实时展示请求与响应，并支持 Replace Mock。仅支持 debuggable 应用。',
    sections: [
      {
        title: '开始抓包',
        content: [
          '使用步骤：',
          '• 通过 USB 连接 Android 设备，并确认设备已授权调试',
          '• 在进程选择框中选择目标 debuggable 应用',
          '• 点击"开始抓包"，Hadice 会自动推送并附加 JVMTI Agent',
          '• 操作目标 App 触发网络请求，请求会实时显示在列表中',
          '• 如果目标 App 已经启动但抓不到请求，可杀掉 App 后重新开始抓包'
        ],
        isList: true
      },
      {
        title: '使用 Mock',
        content: [
          'Mock 用于让匹配的请求不访问真实服务器，直接返回你配置的状态码、响应头和响应体。',
          'WebView 仅支持 Replace 模式；命中规则后由 CDP 直接返回配置响应，不会发送真实请求。',
          '配置方式一：点击工具栏的"Mock"按钮，手动新增规则。',
          '配置方式二：在请求列表中右键目标请求，选择"mock该请求"',
          '编辑规则时，确认 URL 匹配规则能匹配完整请求 URL；可在"测试URL"中验证匹配结果。',
          '勾选左侧规则启用框后，点击"保存配置"。抓包中保存会立即同步到 Android Agent 与 WebView CDP 会话。',
        ],
        isList: true
      },
      {
        title: '前提条件',
        content: [
          '目标应用必须是 debuggable（android:debuggable="true"）。',
          '支持 OkHTTP3、org.chromium.net Cronet、gnet.android:gnet-cronet 3.0.3，以及启用了调试能力的 Android WebView。',
          'WebView 通过 Chromium DevTools Protocol 采集，响应体最多保留前 1 MiB；Mock 仅处理 Replace 规则。',
          '设备需通过 USB 连接并启用调试授权。',
          'Mock 能力依赖当前抓包 Agent 连接状态，停止抓包或 App 进程退出后需要重新开始抓包。'
        ],
        isList: true
      }
    ],
    faqs: [
      {
        question: '为什么抓不到请求？',
        answer:
          '请确认：\n• 目标应用是 debuggable 的\n• 请求经过 OkHTTP、Cronet、GNet 或 Android WebView\n• 设备已通过 USB 连接并授权调试\n• 已选择正确的目标进程\n• App 在开始抓包后重新触发了网络请求'
      },
      {
        question: '支持 HTTPS 抓包吗？',
        answer: '支持。OkHTTP、Cronet、GNet 在应用层采集，WebView 通过 CDP 采集，都可以查看 HTTPS 的明文请求和响应；响应体最多保留前 1 MiB。'
      },
      {
        question: 'Mock 规则不生效？',
        answer:
          '请确认：\n• 已勾选对应规则左侧的启用框\n• 已点击"保存配置"\n• 抓包处于开启状态，且 Android Agent 已连接\n• URL 匹配规则能匹配完整请求 URL，可使用"测试URL"验证\n• WebView 规则使用的是 Replace 模式\n• 修改规则后如果 App 进程已重启，需要重新开始抓包并等待配置推送'
      },
    ]
  },

  'system-info': {
    description:
      '系统信息页面展示设备的详细系统属性信息，包括硬件信息、系统版本、编译信息等，方便了解设备完整配置。',
    sections: [
      {
        title: '系统属性',
        content:
          '展示设备的所有系统属性（类似 Android 的 Build 类信息和鸿蒙的系统参数），包括品牌、型号、CPU 架构、屏幕分辨率等。'
      },
      {
        title: '搜索过滤',
        content: '支持在属性列表中搜索关键词，快速定位感兴趣的属性项。'
      }
    ],
    faqs: [
    ]
  },

  'hdc-shell': {
    description:
      '终端命令页面提供一个交互式终端环境，可以直接执行 Shell 命令，适合高级调试场景。',
    sections: [
      {
        title: '交互式终端',
        content:
          '页面提供一个完整的终端环境（基于 xterm.js），可以输入和执行 HDC/ADB Shell 命令。'
      },
      {
        title: '快捷命令',
        content:
          '可以将常用的命令保存为快捷命令，下次使用时一键执行。'
      },
      {
        title: '鸿蒙与安卓命令',
        content:
          '鸿蒙设备使用 HDC Shell 命令（基于 hdc 工具），安卓设备使用 ADB Shell 命令（基于 adb 工具）。'
      }
    ],
    faqs: [
      {
        question: '终端无响应怎么办？',
        answer: '尝试断开并重新连接设备，然后重新打开终端。如果问题持续，可以在快捷操作中点击"重启终端"。'
      },
      {
        question: '执行某些命令提示权限不足？',
        answer: '部分系统命令需要 root 权限才能执行，普通调试模式下无法使用这些命令。'
      }
    ]
  },

  'ai-automation': {
    description:
      'AI 自动化页面利用大语言模型（LLM）驱动设备自动执行操作，支持通过自然语言描述任务，AI 会自动规划并执行点击、滑动等操作。',
    sections: [
      {
        title: '配置 AI',
        content:
          '首次使用需要在设置中配置 API 密钥。目前支持智谱 AI 的 GLM 模型。在智谱 AI 开放平台申请免费的 API Key 后到设置填入即可。'
      },
      {
        title: '创建自动化任务',
        content:
          '在对话输入框中用自然语言描述你想执行的操作，例如"回到桌面找到微信打开并发送消息给张三"。AI 会自动分析当前屏幕并执行操作。'
      },
      {
        title: '操作记录',
        content:
          'AI 执行的每一步操作都会实时显示在对话中，包括点击位置、滑动方向、输入内容等。你可以随时暂停或取消正在执行的任务。'
      },
      {
        title: '使用建议',
        content:
          '描述任务时尽量具体明确，AI 会根据当前屏幕内容进行判断。建议在任务开始前先回到设备桌面，确保屏幕状态清晰。'
      }
    ],
    faqs: [
      {
        question: 'AI 操作不准确怎么办？',
        answer:
          '描述任务时尽量详细，包含具体的操作步骤和目标元素。'
      },
      {
        question: 'API Key 在哪里获取？',
        answer:
          '访问智谱 AI 开放平台 [https://bigmodel.cn/usercenter/proj-mgmt/apikeys]，注册账号后在控制台点击"添加新的 API Key"即可获取免费额度。'
      }
    ]
  },

}

export function getHelpContent(menuId: string): HelpContent | undefined {
  return helpContentMap[menuId as MenuItemId]
}
