<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useData } from 'vitepress'

const REPO = 'HuolalaTech/hadice'
const API = `https://api.github.com/repos/${REPO}/releases/latest`
const RELEASES_LATEST = `https://github.com/${REPO}/releases/latest`

interface Asset {
  name: string
  size: number
  url: string
}

const { lang } = useData()
const isEn = computed(() => lang.value === 'en-US')

const version = ref('')
const loading = ref(true)
const failed = ref(false)
const assets = reactive<Record<string, Asset | null>>({
  macArm: null,
  macIntel: null,
  win: null,
})

const labels = computed(() =>
  isEn.value
    ? {
        hero: 'Download Hadice',
        meta: 'macOS · Windows · GitHub Releases',
        macTitle: 'macOS',
        armChip: 'Apple Silicon · arm64',
        intelChip: 'Intel · x64',
        winTitle: 'Windows',
        winChip: 'x64',
        downloadDmg: 'Download DMG',
        downloadExe: 'Download EXE',
        checking: 'Checking latest release…',
        fallback: 'Open GitHub Releases',
        assetMissing: 'No matching asset found',
        guides: 'Installation guides',
      }
    : {
        hero: '下载 Hadice',
        meta: 'macOS · Windows · GitHub Releases',
        macTitle: 'macOS',
        armChip: 'Apple Silicon · arm64',
        intelChip: 'Intel · x64',
        winTitle: 'Windows',
        winChip: 'x64',
        downloadDmg: '下载 DMG',
        downloadExe: '下载 EXE',
        checking: '正在获取最新版本…',
        fallback: '打开 GitHub Releases',
        assetMissing: '未找到匹配的安装包',
        guides: '安装指南',
      }
)

function matchAsset(name: string, kind: 'macArm' | 'macIntel' | 'win'): boolean {
  if (kind === 'macArm') {
    return /\.dmg$/i.test(name) && /(mac-arm64|\.arm64\.|arm64)/i.test(name) && !/amd64|x64|x86_64|intel/i.test(name)
  }
  if (kind === 'macIntel') {
    return /\.dmg$/i.test(name) && /(mac-amd64|mac-x64|mac-intel|\.amd64\.|x86_64|x64|intel)/i.test(name) && !/arm64/i.test(name)
  }
  return /\.exe$/i.test(name) && /(windows|win-)/i.test(name)
}

function formatSize(bytes: number): string {
  const mb = bytes / 1024 / 1024
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`
}

async function fetchLatest() {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6000)
  try {
    const res = await fetch(API, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const list: Array<{ name: string; size: number; browser_download_url: string }> = Array.isArray(data.assets) ? data.assets : []
    version.value = data.tag_name || data.name || ''
    const pick = (kind: 'macArm' | 'macIntel' | 'win') => {
      const item = list.find((a) => matchAsset(a.name, kind))
      return item ? { name: item.name, size: item.size, url: item.browser_download_url } : null
    }
    assets.macArm = pick('macArm')
    assets.macIntel = pick('macIntel')
    assets.win = pick('win')
    failed.value = false
  } catch (err) {
    console.warn('[hadice] release fetch failed:', err)
    failed.value = true
  } finally {
    clearTimeout(timer)
    loading.value = false
  }
}

function open(asset: Asset | null) {
  if (asset?.url) {
    window.location.href = asset.url
  } else {
    window.open(RELEASES_LATEST, '_blank', 'noopener')
  }
}

onMounted(fetchLatest)
</script>

<template>
  <div>
    <p class="eyebrow">{{ labels.meta }}</p>
    <p v-if="version" class="download-card__meta">
      {{ isEn ? `Latest release: ${version}` : `最新版本：${version}` }}
    </p>
    <p v-else-if="loading" class="download-card__meta">{{ labels.checking }}</p>
    <p v-else-if="failed" class="download-card__meta">
      {{ isEn ? 'Could not read the latest release from GitHub.' : '无法从 GitHub 读取最新 Release。' }}
      <a :href="RELEASES_LATEST" target="_blank" rel="noopener noreferrer">{{ labels.fallback }}</a>
    </p>

    <div class="download-cards">
      <article class="download-card">
        <div class="download-card__head">
          <h2>{{ labels.macTitle }}</h2>
          <span class="download-card__chip">{{ labels.armChip }}</span>
        </div>
        <p class="download-card__file">{{ assets.macArm?.name || labels.assetMissing }}</p>
        <p class="download-card__size">{{ assets.macArm ? formatSize(assets.macArm.size) : '—' }}</p>
        <button class="VPButton medium brand" @click="open(assets.macArm)">{{ labels.downloadDmg }}</button>
      </article>

      <article class="download-card">
        <div class="download-card__head">
          <h2>{{ labels.macTitle }}</h2>
          <span class="download-card__chip">{{ labels.intelChip }}</span>
        </div>
        <p class="download-card__file">{{ assets.macIntel?.name || labels.assetMissing }}</p>
        <p class="download-card__size">{{ assets.macIntel ? formatSize(assets.macIntel.size) : '—' }}</p>
        <button class="VPButton medium brand" @click="open(assets.macIntel)">{{ labels.downloadDmg }}</button>
      </article>

      <article class="download-card">
        <div class="download-card__head">
          <h2>{{ labels.winTitle }}</h2>
          <span class="download-card__chip">{{ labels.winChip }}</span>
        </div>
        <p class="download-card__file">{{ assets.win?.name || labels.assetMissing }}</p>
        <p class="download-card__size">{{ assets.win ? formatSize(assets.win.size) : '—' }}</p>
        <button class="VPButton medium brand" @click="open(assets.win)">{{ labels.downloadExe }}</button>
      </article>
    </div>
  </div>
</template>
