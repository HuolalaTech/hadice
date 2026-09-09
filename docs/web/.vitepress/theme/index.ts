import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import FeatureGrid from './components/FeatureGrid.vue'
import HomeSteps from './components/HomeSteps.vue'
import DownloadCards from './components/DownloadCards.vue'
import './style.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('FeatureGrid', FeatureGrid)
    app.component('HomeSteps', HomeSteps)
    app.component('DownloadCards', DownloadCards)
  },
} satisfies Theme
