<script setup lang="ts">
import { computed } from 'vue'
import { useData, withBase } from 'vitepress'

interface Feature {
  idx: string
  title: string
  desc: string
  img: string
  link: string
}

const { lang } = useData()
const isEn = computed(() => lang.value === 'en-US')

const zhFeatures: Feature[] = [
  { idx: '01', title: '设备总览', desc: '查看电池、CPU、内存、存储与系统信息。', img: '/screenshots/01-overview.png', link: '/docs/device-overview' },
  { idx: '02', title: '性能监控', desc: 'CPU / 内存 / 网络 / 帧率曲线，支持导出。', img: '/screenshots/02-performance.png', link: '/docs/performance' },
  { idx: '03', title: '进程管理', desc: '按 CPU / 内存排序，搜索并结束进程。', img: '/screenshots/03-process.png', link: '/docs/process' },
  { idx: '04', title: '应用管理', desc: '启动、停止、卸载与清理应用数据。', img: '/screenshots/04-apps.png', link: '/docs/app-manager' },
  { idx: '05', title: '应用安装', desc: '拖拽或选择 APK / HAP 快速安装。', img: '/screenshots/05-install.png', link: '/docs/app-install' },
  { idx: '06', title: '投屏截屏', desc: '实时镜像、截图、录屏与历史管理。', img: '/screenshots/06-mirror.png', link: '/docs/screenshot' },
  { idx: '07', title: '文件传输', desc: '设备与电脑双向互传，支持批量队列。', img: '/screenshots/07-transfer.png', link: '/docs/file-transfer' },
  { idx: '08', title: '系统日志', desc: 'hilog / logcat 实时查看、过滤与保存。', img: '/screenshots/08-logs.png', link: '/docs/system-logs' },
  { idx: '09', title: '网络抓包', desc: '鸿蒙 / 安卓抓包，详情预览、Mock 与导出。', img: '/screenshots/09-capture.png', link: '/docs/network-capture/' },
  { idx: '10', title: '系统信息', desc: '浏览并搜索设备系统属性。', img: '/screenshots/10-infos.png', link: '/docs/system-info' },
  { idx: '11', title: '终端命令', desc: 'HDC / ADB Shell 与本地终端。', img: '/screenshots/11-terms.png', link: '/docs/hdc-shell' },
  { idx: '12', title: 'AI 自动化', desc: '基于视觉与指令的设备自动化操作。', img: '/screenshots/12-ai-auto.png', link: '/docs/ai-automation' },
]

const enFeatures: Feature[] = [
  { idx: '01', title: 'Device Overview', desc: 'Battery, CPU, memory, storage, and system info.', img: '/screenshots/01-overview.png', link: '/docs/device-overview' },
  { idx: '02', title: 'Performance', desc: 'CPU / memory / network / FPS charts with export.', img: '/screenshots/02-performance.png', link: '/docs/performance' },
  { idx: '03', title: 'Process Manager', desc: 'Sort by CPU / memory, search, and kill processes.', img: '/screenshots/03-process.png', link: '/docs/process' },
  { idx: '04', title: 'App Manager', desc: 'Start, stop, uninstall, and clear app data.', img: '/screenshots/04-apps.png', link: '/docs/app-manager' },
  { idx: '05', title: 'App Install', desc: 'Drag-and-drop or pick APK / HAP to install quickly.', img: '/screenshots/05-install.png', link: '/docs/app-install' },
  { idx: '06', title: 'Screen Mirror', desc: 'Live mirror, screenshot, record, and history.', img: '/screenshots/06-mirror.png', link: '/docs/screenshot' },
  { idx: '07', title: 'File Transfer', desc: 'Bidirectional transfer with batch queue.', img: '/screenshots/07-transfer.png', link: '/docs/file-transfer' },
  { idx: '08', title: 'System Logs', desc: 'Live hilog / logcat with filter and save.', img: '/screenshots/08-logs.png', link: '/docs/system-logs' },
  { idx: '09', title: 'Network Capture', desc: 'HarmonyOS / Android capture, preview, Mock, and export.', img: '/screenshots/09-capture.png', link: '/docs/network-capture/' },
  { idx: '10', title: 'System Info', desc: 'Browse and search device system properties.', img: '/screenshots/10-infos.png', link: '/docs/system-info' },
  { idx: '11', title: 'Terminal', desc: 'HDC / ADB Shell and local terminal.', img: '/screenshots/11-terms.png', link: '/docs/hdc-shell' },
  { idx: '12', title: 'AI Automation', desc: 'Vision-based automated device operations.', img: '/screenshots/12-ai-auto.png', link: '/docs/ai-automation' },
]

const features = computed(() => (isEn.value ? enFeatures : zhFeatures))
const title = computed(() =>
  isEn.value ? '12 features covering a complete debugging workflow' : '12 个功能，覆盖一条调试主路径'
)
const lead = computed(() =>
  isEn.value
    ? 'Plug in and go. From overview and performance to capture and AI automation, every menu has inline help and can be opened in a standalone window.'
    : '设备连接后即用即走。从总览、性能到抓包与 AI 自动化，每个菜单都有帮助说明，也可以单独拆成独立窗口。'
)
const notes = computed(() =>
  isEn.value
    ? [
        { k: 'Help', text: 'Every menu has a help button next to its title — click it to read the detailed usage guide.', img: '/screenshots/help.png' },
        { k: 'Window', text: 'Every menu can be detached into a standalone window for parallel use.', img: '/screenshots/open-in-window.png' },
      ]
    : [
        { k: 'Help', text: '每个菜单标题右侧都有帮助按钮，点击查看详细使用说明。', img: '/screenshots/help.png' },
        { k: 'Window', text: '每个菜单都可以拆分为独立窗口显示，方便并行使用。', img: '/screenshots/open-in-window.png' },
      ]
)
</script>

<template>
  <section class="home-section" style="margin-top: 48px">
    <header class="home-section--lead">
      <h2>{{ title }}</h2>
    </header>

    <div class="feature-grid">
      <article v-for="f in features" :key="f.idx" class="feature-card">
        <a :href="f.link">
          <div class="feature-card__media">
            <img :src="withBase(f.img)" :alt="f.title" loading="lazy" />
          </div>
          <div class="feature-card__body">
            <p class="feature-card__idx">{{ f.idx }}</p>
            <h3 class="feature-card__title">{{ f.title }}</h3>
            <p class="feature-card__desc">{{ f.desc }}</p>
          </div>
        </a>
      </article>
    </div>

    <div class="home-notes">
      <div v-for="n in notes" :key="n.k" class="home-note">
        <p class="home-note__k">{{ n.k }}</p>
        <p class="home-note__t">{{ n.text }}</p>
        <img :src="withBase(n.img)" :alt="n.k" loading="lazy" />
      </div>
    </div>
  </section>
</template>
