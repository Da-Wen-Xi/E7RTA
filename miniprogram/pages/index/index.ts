// index 启动页：数据摘要 + 沙盘入口
import { DATA_META, HEROES } from '../../modules/rta-bp/data/hero-list'
import { POOL_PICK_MIN } from '../../modules/rta-bp/core/constants'

const poolTotal = HEROES.filter((h) => h.pick >= POOL_PICK_MIN).length

Page({
  data: {
    generated: DATA_META.generated,
    heroTotal: DATA_META.heroTotal,
    poolTotal,
  },
  goSimulator() {
    wx.navigateTo({ url: '/modules/rta-bp/pages/simulator/simulator' })
  },
})
