<script setup lang="ts">
import { computed } from 'vue'
import { useData } from 'vitepress'

const { lang } = useData()
const isEn = computed(() => lang.value === 'en-US')

const content = computed(() =>
  isEn.value
    ? {
        title: 'Start debugging in three steps',
        lead: 'Connect once — after that, USB or wireless debugging gets you straight into the workspace.',
        steps: [
          {
            num: '01',
            title: 'Enable developer mode',
            text: 'HarmonyOS: Settings > System > Developer options, enable USB debugging. Android: Settings > Developer options, enable USB debugging.',
          },
          {
            num: '02',
            title: 'Connect your device',
            text: 'Plug in your phone with a USB cable, or pair with a device on the same LAN via wireless debugging.',
          },
          {
            num: '03',
            title: 'Refresh devices',
            text: 'Click "Refresh" and allow this computer on your phone. If something goes wrong, run "Connection Diagnostics".',
          },
        ],
      }
    : {
        title: '三步开始调试',
        lead: '连接一次，之后通过 USB 或无线调试都能直接进入工作台。',
        steps: [
          {
            num: '01',
            title: '开启开发者模式',
            text: '鸿蒙：设置 > 系统 > 开发者选项，启用 USB 调试；安卓：设置 > 开发者选项，启用 USB 调试。',
          },
          {
            num: '02',
            title: '连接设备',
            text: '用数据线连接手机，或通过无线调试配对同一局域网内的设备。',
          },
          {
            num: '03',
            title: '刷新设备',
            text: '点击「刷新」，在手机上允许此电脑调试设备；如有异常可运行「连接诊断」。',
          },
        ],
      }
)
</script>

<template>
  <section class="home-steps">
    <div class="home-steps__inner">
      <header class="home-steps__head">
        <h2>{{ content.title }}</h2>
        <p>{{ content.lead }}</p>
      </header>
      <ol class="home-steps__list">
        <li v-for="s in content.steps" :key="s.num" class="home-step">
          <p class="home-step__num">{{ s.num }}</p>
          <h3>{{ s.title }}</h3>
          <p>{{ s.text }}</p>
        </li>
      </ol>
    </div>
  </section>
</template>
