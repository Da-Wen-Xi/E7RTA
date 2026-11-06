/**
 * RTA 选人沙盘 · BAN/PICK 主页面。
 *
 * 状态机与 HTML 版 RTA_BP模拟器 逐行对应：
 * 预禁 2+2 → 选人 1-2-2-2-2-1（各 5）→ 后禁 1+1（第 3 手保护位不可禁）→ 4v4 结算。
 * state / history 为非渲染数据；refresh() 每次把全部视图模型一次性 setData。
 */
import { DATA_META, HEROES } from '../../data/hero-list'
import { Hero } from '../../data/types'
import {
  ATTR_COLORS,
  ATTR_FILTERS,
  ENEMY_BAN_CAND,
  FIRST_DRAFT,
  POOL_PICK_MIN,
  PRESETS,
  PRE_BAN_MINE,
  ROLE_FILTERS,
  SORT_OPTIONS,
  SortOption,
  avatarUrl,
  ATTR_ICONS,
  ROLE_ICONS,
} from '../../core/constants'
import { predictWR, rank, scoreOf, teamScore, ScoreResult } from '../../core/bp-engine'

// ---------------- 领域状态 ----------------
type Phase = 'pre' | 'draft' | 'post' | 'done'

interface BpState {
  first: 'mine' | 'enemy'
  phase: Phase
  preMine: string[]
  preEnemy: string[]
  picksMine: string[]
  picksEnemy: string[]
  banMine: string | null
  banEnemy: string | null
  draftIdx: number
}

const initialState = (): BpState => ({
  first: 'mine',
  phase: 'pre',
  preMine: [],
  preEnemy: [],
  picksMine: [],
  picksEnemy: [],
  banMine: null,
  banEnemy: null,
  draftIdx: 0,
})

// ---------------- 视图模型 ----------------
interface StepVM { num: string; label: string; state: 'done' | 'cur' | 'todo' }
interface TagVM { text: string; cls: string }
interface RecVM {
  code: string; name: string; avatar: string; attrRole: string
  scoreLabel: string; scoreCls: string
  tags: TagVM[]; barC: number; barS: number; barW: number
}
interface BanVM { idx: number; empty: boolean; code: string; avatar: string; name: string }
interface PickVM {
  idx: number; empty: boolean; isTurn: boolean; turnText: string
  code: string; name: string; avatar: string; attrIcon: string; roleIcon: string
  stText: string; isProtect: boolean; isFinalBan: boolean; isSugBan: boolean
  cls: string
}
interface TeamVM { countText: string; bans: BanVM[]; picks: PickVM[] }
interface CellVM {
  code: string; name: string; avatar: string; color: string
  dim: boolean; mark: string; markCls: string; recBadge: number
}
interface ResultRowVM { label: string; mine: string; enemy: string; mineCls: string; enemyCls: string }
interface ResultVM {
  wrText: string; verdict: string; diffText: string
  mineSide: Array<{ name: string; avatar: string; out: boolean }>
  enemySide: Array<{ name: string; avatar: string; out: boolean }>
  rows: ResultRowVM[]
  pillEnemyBan: string; pillMineBan: string
  pillMineCount: string; pillEnemyCount: string
}

interface SimulatorData {
  meta: { generated: string; heroTotal: number; poolTotal: number }
  firstSeg: Array<{ key: string; label: string; active: boolean }>
  steps: StepVM[]
  progressText: string
  wrBadge: { text: string; cls: string } | null
  phase: { title: string; step: string; hint: string }
  quickPicks: Array<{ code: string; name: string }>
  recs: RecVM[]
  recsEmpty: string
  pool: {
    query: string
    attrs: Array<{ key: string; label: string; icon: string; active: boolean }>
    roles: Array<{ key: string; label: string; icon: string; active: boolean }>
    sorts: string[]
    sortIndex: number
    cells: CellVM[]
    countText: string
  }
  mine: TeamVM
  enemy: TeamVM
  mineActive: boolean
  enemyActive: boolean
  canUndo: boolean
  canAuto: boolean
  showResult: boolean
  result: ResultVM | null
}

const f1 = (x: number): string => x.toFixed(1)
const clampPct = (v: number, max: number): number => Math.max(0, Math.min(100, (v / max) * 100))

// ---------------- 页面 ----------------
Page({
  data: {
    meta: { generated: DATA_META.generated, heroTotal: DATA_META.heroTotal, poolTotal: 0 },
    firstSeg: [
      { key: 'mine', label: '我先手', active: true },
      { key: 'enemy', label: '对手先手', active: false },
    ],
    steps: [],
    progressText: '0/16',
    wrBadge: null,
    phase: { title: '预禁阶段', step: '', hint: '' },
    quickPicks: [],
    recs: [],
    recsEmpty: '',
    pool: { query: '', attrs: [], roles: [], sorts: [], sortIndex: 1, cells: [], countText: '' },
    mine: { countText: '', bans: [], picks: [] },
    enemy: { countText: '', bans: [], picks: [] },
    mineActive: true,
    enemyActive: false,
    canUndo: false,
    canAuto: true,
    showResult: false,
    result: null,
  } as unknown as SimulatorData,

  // 非渲染字段
  state: initialState(),
  history: [] as BpState[],
  query: '',
  attrFilter: '',
  roleFilter: '',
  sortIndex: 1,
  recList: [] as ScoreResult[],
  sugBan: null as string | null,

  onLoad() {
    const poolTotal = HEROES.filter((h) => h.pick >= POOL_PICK_MIN).length
    this.setData({ meta: { generated: DATA_META.generated, heroTotal: DATA_META.heroTotal, poolTotal } })
    this.refresh()
  },

  // ---------------- 状态机 ----------------
  usedSet(): Set<string> {
    const s = this.state
    return new Set([...s.preMine, ...s.preEnemy, ...s.picksMine, ...s.picksEnemy])
  },

  draftOrder(): Array<'M' | 'E'> {
    return FIRST_DRAFT.map((x) => (this.state.first === 'mine' ? x : x === 'M' ? 'E' : 'M'))
  },

  curTurn(): 'M' | 'E' | null {
    if (this.state.phase !== 'draft') return null
    return this.draftOrder()[this.state.draftIdx]
  },

  snapshot(): void {
    this.history.push(JSON.parse(JSON.stringify(this.state)) as BpState)
    if (this.history.length > 80) this.history.shift()
  },

  recalcPhase(): void {
    const s = this.state
    if (s.preMine.length < 2 || s.preEnemy.length < 2) s.phase = 'pre'
    else if (s.draftIdx < 10) s.phase = 'draft'
    else if (!s.banMine || !s.banEnemy) s.phase = 'post'
    else s.phase = 'done'
  },

  /** 点英雄池 / 推荐卡 / 槽位的核心入口（与 HTML 版 onPoolClick 一致） */
  handlePoolClick(code: string): void {
    const s = this.state
    if (s.phase === 'done') return
    const used = this.usedSet()
    if (used.has(code)) {
      // 点击已用英雄 → 撤回该步
      this.snapshot()
      if (s.preMine.indexOf(code) >= 0) s.preMine = s.preMine.filter((x) => x !== code)
      else if (s.preEnemy.indexOf(code) >= 0) s.preEnemy = s.preEnemy.filter((x) => x !== code)
      else if (s.picksMine.indexOf(code) >= 0) s.picksMine = s.picksMine.filter((x) => x !== code)
      else if (s.picksEnemy.indexOf(code) >= 0) s.picksEnemy = s.picksEnemy.filter((x) => x !== code)
      this.recalcPhase()
      this.refresh()
      return
    }
    this.snapshot()
    if (s.phase === 'pre') {
      if (s.preMine.length < 2) s.preMine.push(code)
      else if (s.preEnemy.length < 2) s.preEnemy.push(code)
    } else if (s.phase === 'draft') {
      const t = this.curTurn()
      if (t === 'M') {
        if (s.picksMine.length >= 5) return
        s.picksMine.push(code)
      } else {
        if (s.picksEnemy.length >= 5) return
        s.picksEnemy.push(code)
      }
      s.draftIdx++
    } else if (s.phase === 'post') {
      // 后禁规则：各自队伍的第 3 手是保护位，不可被禁
      if (s.picksEnemy.indexOf(code) >= 0 && !s.banMine) {
        if (code === s.picksEnemy[2]) return
        s.banMine = code
      } else if (s.picksMine.indexOf(code) >= 0 && s.banMine && !s.banEnemy) {
        if (code === s.picksMine[2]) return
        s.banEnemy = code
      } else {
        return
      }
    }
    this.recalcPhase()
    this.refresh()
  },

  autoEnemy(): void {
    const s = this.state
    this.snapshot()
    let guard = 0
    while (s.phase !== 'done' && guard++ < 24) {
      if (s.phase === 'pre') {
        if (s.preMine.length < 2) break
        while (s.preEnemy.length < 2) {
          const r = rank({ own: s.preEnemy, opp: s.picksMine, used: this.usedSet() })
          const pick = r.find((x) => ENEMY_BAN_CAND.indexOf(x.code) >= 0) || r[0]
          if (!pick) break
          s.preEnemy.push(pick.code)
        }
      } else if (s.phase === 'draft' && this.curTurn() === 'E') {
        const r = rank({ own: s.picksEnemy, opp: s.picksMine, used: this.usedSet() })
        if (!r.length) break
        s.picksEnemy.push(r[0].code)
        s.draftIdx++
      } else if (s.phase === 'post' && !s.banEnemy && s.banMine) {
        const prot = s.picksMine[2]
        const me = HEROES
          .filter((h) => s.picksMine.indexOf(h.code) >= 0 && h.code !== s.banMine && h.code !== prot)
          .map((h) => scoreOf(h.code, s.picksMine.filter((x) => x !== h.code), s.picksEnemy))
          .filter(Boolean)
          .sort((a, b) => (b as ScoreResult).score - (a as ScoreResult).score)
        if (me.length) s.banEnemy = (me[0] as ScoreResult).code
        else break
      } else {
        break
      }
      this.recalcPhase()
    }
    this.recalcPhase()
    this.refresh()
  },

  applyPreset(key: string): void {
    const s = this.state
    const codes = (PRESETS[key] || []).filter((c) => !this.usedSet().has(c))
    this.snapshot()
    PRE_BAN_MINE.forEach((c) => {
      if (s.preMine.indexOf(c) < 0 && s.preMine.length < 2) s.preMine.push(c)
    })
    codes.forEach((c) => {
      if (s.picksMine.length < 5) s.picksMine.push(c)
    })
    let guard = 0
    while (s.phase === 'pre' && s.preEnemy.length < 2 && guard++ < 6) {
      s.preEnemy.push(ENEMY_BAN_CAND[s.preEnemy.length])
    }
    this.recalcPhase()
    this.refresh()
  },

  runDemo(): void {
    const s = this.state
    this.history = []
    this.applyPreset('A')
    let guard = 0
    while (s.phase !== 'done' && guard++ < 40) {
      if (s.phase === 'draft') {
        const t = this.curTurn()
        const own = t === 'M' ? s.picksMine : s.picksEnemy
        const opp = t === 'M' ? s.picksEnemy : s.picksMine
        const r = rank({ own, opp, used: this.usedSet() })
        if (!r.length) break
        if (t === 'M') s.picksMine.push(r[0].code)
        else s.picksEnemy.push(r[0].code)
        s.draftIdx++
      } else if (s.phase === 'post' && !s.banMine) {
        const prot = s.picksEnemy[2]
        const r = rank({ own: s.picksEnemy, opp: s.picksMine, used: new Set<string>() })
          .filter((x) => s.picksEnemy.indexOf(x.code) >= 0 && x.code !== prot)
        if (!r.length) break
        s.banMine = r[0].code
      } else if (s.phase === 'post' && !s.banEnemy) {
        const prot = s.picksMine[2]
        const cand = HEROES
          .filter((h) => s.picksMine.indexOf(h.code) >= 0 && h.code !== s.banMine && h.code !== prot)
          .map((h) => scoreOf(h.code, s.picksMine.filter((x) => x !== h.code), s.picksEnemy))
          .filter(Boolean)
          .sort((a, b) => (b as ScoreResult).score - (a as ScoreResult).score)
        if (!cand.length) break
        s.banEnemy = (cand[0] as ScoreResult).code
      } else {
        break
      }
      this.recalcPhase()
    }
    this.recalcPhase()
    this.refresh()
  },

  undo(): void {
    if (!this.history.length) return
    this.state = this.history.pop() as BpState
    this.refresh()
  },

  reset(): void {
    this.snapshot()
    this.state = initialState()
    this.refresh()
  },

  /** 当前局面（含后禁扣除）实时胜率 */
  curMatchWR(): number | null {
    const s = this.state
    let mine = s.picksMine.slice()
    let enemy = s.picksEnemy.slice()
    if (s.banMine) enemy = enemy.filter((c) => c !== s.banMine)
    if (s.banEnemy) mine = mine.filter((c) => c !== s.banEnemy)
    if (!mine.length || !enemy.length) return null
    return predictWR(mine, enemy)
  },

  // ---------------- 视图模型 ----------------
  refresh(): void {
    this.computeSugBan()
    const recs = this.buildRecs()
    this.recList = recs
    this.setData({
      firstSeg: this.buildFirstSeg(),
      steps: this.buildSteps(),
      progressText: this.buildProgress(),
      wrBadge: this.buildWrBadge(),
      phase: this.buildPhase(recs),
      quickPicks: this.buildQuickPicks(),
      recs: this.buildRecVMs(recs),
      recsEmpty: this.state.phase === 'done' ? '推演已完成 · 下方查看阵容对比' : recs.length ? '' : '没有可用英雄',
      pool: this.buildPool(),
      mine: this.buildTeam('mine'),
      enemy: this.buildTeam('enemy'),
      mineActive: this.isTeamActive('mine'),
      enemyActive: this.isTeamActive('enemy'),
      canUndo: this.history.length > 0,
      canAuto: this.state.phase !== 'done',
      showResult: this.state.phase === 'done',
      result: this.buildResult(),
    })
  },

  computeSugBan(): void {
    const s = this.state
    this.sugBan = null
    if (s.phase === 'post' && !s.banMine && s.picksEnemy.length) {
      const prot = s.picksEnemy[2]
      const top = rank({ own: s.picksEnemy, opp: s.picksMine, used: new Set<string>() })
        .filter((x) => s.picksEnemy.indexOf(x.code) >= 0 && x.code !== prot)[0]
      if (top) this.sugBan = top.code
    }
  },

  buildFirstSeg(): Array<{ key: string; label: string; active: boolean }> {
    return [
      { key: 'mine', label: '我先手', active: this.state.first === 'mine' },
      { key: 'enemy', label: '对手先手', active: this.state.first === 'enemy' },
    ]
  },

  buildSteps(): StepVM[] {
    const s = this.state
    const curKey = s.phase === 'pre' ? 1 : s.phase === 'draft' ? 2 : s.phase === 'post' ? 3 : 4
    const done = [true, s.phase !== 'pre', s.draftIdx >= 10, !!(s.banMine && s.banEnemy), s.phase === 'done']
    const labels = ['准备', '预禁', '选人', '后禁', '结果']
    return labels.map((label, i) => ({
      num: String(i + 1),
      label,
      state: done[i] && i !== curKey ? 'done' : i === curKey ? 'cur' : 'todo',
    }))
  },

  buildProgress(): string {
    const s = this.state
    const prog = s.preMine.length + s.preEnemy.length + s.draftIdx + (s.banMine ? 1 : 0) + (s.banEnemy ? 1 : 0)
    return `${prog}/16`
  },

  buildWrBadge(): { text: string; cls: string } | null {
    const wr = this.curMatchWR()
    if (wr == null) return null
    const v = Math.round(wr)
    return { text: `我方 ${v}%`, cls: v >= 55 ? 'hi' : v < 45 ? 'lo' : '' }
  },

  buildRecs(): ScoreResult[] {
    const s = this.state
    if (s.phase === 'pre') {
      return rank({ own: [], opp: [], used: this.usedSet() }).slice(0, 6)
    }
    if (s.phase === 'draft') {
      const t = this.curTurn()
      if (t === 'M') return rank({ own: s.picksMine, opp: s.picksEnemy, used: this.usedSet() }).slice(0, 8)
      return rank({ own: s.picksEnemy, opp: s.picksMine, used: this.usedSet() }).slice(0, 5)
    }
    if (s.phase === 'post') {
      if (!s.banMine) {
        const prot = s.picksEnemy[2]
        return rank({ own: s.picksEnemy, opp: s.picksMine, used: new Set<string>() })
          .filter((x) => s.picksEnemy.indexOf(x.code) >= 0 && x.code !== prot)
          .slice(0, 5)
      }
      const prot = s.picksMine[2]
      return HEROES
        .filter((h) => s.picksMine.indexOf(h.code) >= 0 && h.code !== s.banMine && h.code !== prot)
        .map((h) => scoreOf(h.code, s.picksMine.filter((x) => x !== h.code), s.picksEnemy))
        .filter(Boolean)
        .sort((a, b) => (b as ScoreResult).score - (a as ScoreResult).score) as ScoreResult[]
    }
    return []
  },

  buildPhase(recs: ScoreResult[]): { title: string; step: string; hint: string } {
    const s = this.state
    let title = '预禁阶段'
    let step = ''
    let hint = ''
    if (s.phase === 'pre') {
      hint = s.preMine.length < 2
        ? `先禁掉最威胁我方的英雄（已禁 ${s.preMine.length}/2），点下方英雄池即可。`
        : `对手的 2 个预禁（已禁 ${s.preEnemy.length}/2），可点高频候选快捷填入。`
    } else if (s.phase === 'draft') {
      title = `选人阶段 · 第 ${s.draftIdx + 1}/10 手`
      step = `${Math.round((s.draftIdx / 10) * 100)}%`
      const t = this.curTurn()
      if (t === 'M') {
        hint = s.picksMine.length === 0
          ? '你的第一手：优先抢「克制对手已选 + 强度高」的核心，百分比为选后我方胜率。'
          : s.picksMine.length >= 3
            ? '注意后禁：对手会禁掉你威胁最高的一个，第 5 手尽量选「被禁也不亏」的。'
            : '继续按克制/配合补强，百分比为选后我方胜率。'
      } else {
        hint = '对手回合。以下是「对手最可能选」预测（百分比为选后对手胜率），用来提前准备应对。'
      }
    } else if (s.phase === 'post') {
      title = '后禁阶段'
      step = '92%'
      hint = !s.banMine
        ? '从对手出战里禁掉威胁最大的一个（第 3 手保护位不可禁），百分比 = 禁他之后我方胜率。'
        : '对手的后禁不能碰第 3 手保护位——百分比 = 被禁该英雄后我方胜率（越低越可能被禁）。'
    } else {
      title = '推演完成'
      hint = '推演完成，见下方结算。'
    }
    void recs
    return { title, step, hint }
  },

  buildQuickPicks(): Array<{ code: string; name: string }> {
    const s = this.state
    if (s.phase !== 'pre' || s.preMine.length < 2) return []
    return ENEMY_BAN_CAND.map((c) => ({ code: c, name: this.heroDisplayName(c) }))
  },

  heroDisplayName(code: string): string {
    const h = HEROES.find((x) => x.code === code)
    return h ? h.name : code
  },

  buildRecVMs(list: ScoreResult[]): RecVM[] {
    const s = this.state
    return list.map((r, i) => {
      const h = r.hero
      const tags: TagVM[] = []
      if (r.vsE[0]) {
        const g = r.vsE[0].gain
        const wrPart = r.vsE[0].wr ? `（对位 ${Math.round(r.vsE[0].wr)}%）` : ''
        tags.push({ text: `克 ${r.vsE[0].name} ${g >= 0 ? '+' : ''}${f1(g)}pt${wrPart}`, cls: g >= 0 ? 'g' : 'r' })
      }
      if (r.vsO[0]) {
        const g = r.vsO[0].gain
        tags.push({ text: `配 ${r.vsO[0].name} ${g >= 0 ? '+' : ''}${f1(g)}`, cls: g >= 0 ? 'b' : 'r' })
      }
      if (!r.known) tags.push({ text: '情报不足', cls: '' })
      tags.push({ text: `胜率 ${h.wr}%`, cls: '' })
      tags.push({ text: `选取 ${h.pick}%`, cls: '' })

      let pwr: number | null = null
      if (s.phase === 'draft') {
        const t = this.curTurn()
        pwr = t === 'M'
          ? predictWR([...s.picksMine, r.code], s.picksEnemy)
          : predictWR([...s.picksEnemy, r.code], s.picksMine)
      } else if (s.phase === 'post') {
        pwr = !s.banMine
          ? predictWR(s.picksMine, s.picksEnemy.filter((c) => c !== r.code))
          : predictWR(s.picksMine.filter((c) => c !== r.code), s.picksEnemy)
      }
      const p = pwr == null ? null : Math.round(pwr)

      return {
        code: r.code,
        name: `${i + 1}. ${h.name}`,
        avatar: avatarUrl(r.code),
        attrRole: `${h.attr}·${h.role}`,
        scoreLabel: p == null ? r.score.toFixed(2) : `${p}%`,
        scoreCls: p == null ? '' : p >= 55 ? 'hi' : p < 45 ? 'lo' : '',
        tags,
        barC: r.counter == null ? 0 : Math.round(clampPct(r.counter, 12)),
        barS: r.synergy == null ? 0 : Math.round(clampPct(r.synergy, 10)),
        barW: Math.round(clampPct(r.strength, 8)),
      }
    })
  },

  buildPool(): SimulatorData['pool'] {
    const s = this.state
    const used = this.usedSet()
    const q = this.query.trim().toLowerCase()
    const recScore: Record<string, number> = {}
    this.recList.forEach((x) => { recScore[x.code] = x.score })
    const recIdx: Record<string, number> = {}
    this.recList.slice(0, 3).forEach((x, i) => { recIdx[x.code] = i + 1 })

    let list = HEROES.filter((h) => {
      if (h.pick < POOL_PICK_MIN) return false
      if (this.attrFilter && h.attr !== this.attrFilter) return false
      if (this.roleFilter && h.role !== this.roleFilter) return false
      if (q && !(h.name.toLowerCase().indexOf(q) >= 0 || h.code.indexOf(q) >= 0)) return false
      return true
    })
    const sortKey = SORT_OPTIONS[this.sortIndex].key
    if (sortKey === 'wr') list = list.slice().sort((a, b) => b.wr - a.wr)
    else if (sortKey === 'pick') list = list.slice().sort((a, b) => b.pick - a.pick)
    else if (sortKey === 'name') list = list.slice().sort((a, b) => a.name.localeCompare(b.name, 'zh'))
    else {
      list = list.slice().sort((a, b) =>
        (recScore[b.code] || -99) - (recScore[a.code] || -99) || b.wr - a.wr)
    }

    const cells: CellVM[] = list.map((h: Hero) => {
      const isMine = s.picksMine.indexOf(h.code) >= 0 || s.preMine.indexOf(h.code) >= 0
      const dim = used.has(h.code)
      const mark = dim
        ? isMine
          ? (s.preMine.indexOf(h.code) >= 0 || s.banEnemy === h.code) ? '已禁' : '我方'
          : '对手'
        : ''
      return {
        code: h.code,
        name: h.name,
        avatar: avatarUrl(h.code),
        color: ATTR_COLORS[h.attr] || '#666666',
        dim,
        mark,
        markCls: isMine ? 'mine' : 'enemy',
        recBadge: !dim && recIdx[h.code] ? recIdx[h.code] : 0,
      }
    })

    return {
      query: this.query,
      attrs: ATTR_FILTERS.map((o) => ({ ...o, active: o.key === this.attrFilter })),
      roles: ROLE_FILTERS.map((o) => ({ ...o, active: o.key === this.roleFilter })),
      sorts: SORT_OPTIONS.map((o: SortOption) => o.label),
      sortIndex: this.sortIndex,
      cells,
      countText: `RTA 常用 ${list.length} 名（选取率 ≥${POOL_PICK_MIN}%）`,
    }
  },

  isTeamActive(side: 'mine' | 'enemy'): boolean {
    const s = this.state
    const t = this.curTurn()
    if (side === 'mine') {
      return t === 'M' || (s.phase === 'pre' && s.preMine.length < 2) || (s.phase === 'post' && !s.banMine)
    }
    return t === 'E' || (s.phase === 'pre' && s.preMine.length >= 2 && s.preEnemy.length < 2) ||
      (s.phase === 'post' && !!s.banMine && !s.banEnemy)
  },

  buildBanVMs(codes: string[]): BanVM[] {
    return [0, 1].map((i) => {
      const code = codes[i]
      if (!code) return { idx: i, empty: true, code: '', avatar: '', name: '' }
      return { idx: i, empty: false, code, avatar: avatarUrl(code), name: this.heroDisplayName(code) }
    })
  },

  buildPickVMs(codes: string[], side: 'mine' | 'enemy'): PickVM[] {
    const s = this.state
    const t = this.curTurn()
    const isMineSide = side === 'mine'
    return [0, 1, 2, 3, 4].map((idx) => {
      const code = codes[idx]
      const isTurn = s.phase === 'draft' &&
        ((t === 'M' && isMineSide && s.picksMine.length === idx) ||
          (t === 'E' && !isMineSide && s.picksEnemy.length === idx))
      if (!code) {
        const turnText = isTurn ? '当前回合 · 点英雄池或推荐' : idx === 2 ? '保护位 · 不可被后禁' : '等待选人'
        return {
          idx, empty: true, isTurn, turnText,
          code: '', name: '', avatar: '', attrIcon: '', roleIcon: '', stText: '',
          isProtect: idx === 2, isFinalBan: false, isSugBan: false,
          cls: isTurn ? 'turn' : '',
        }
      }
      const h = HEROES.find((x) => x.code === code)
      const finalBan = (isMineSide && s.banEnemy === code) || (!isMineSide && s.banMine === code)
      const sugBan = !isMineSide && code === this.sugBan && s.phase === 'post' && !s.banMine
      return {
        idx, empty: false, isTurn: false, turnText: '',
        code,
        name: h ? h.name : code,
        avatar: avatarUrl(code),
        attrIcon: h ? ATTR_ICONS[h.attr] || '' : '',
        roleIcon: h ? ROLE_ICONS[h.role] || '' : '',
        stText: h ? `胜率 ${h.wr}% · 选取 ${h.pick}%` : '',
        isProtect: idx === 2,
        isFinalBan: finalBan,
        isSugBan: sugBan,
        cls: `${finalBan ? 'finalban ' : ''}${sugBan ? 'sugban' : ''}`.trim(),
      }
    })
  },

  buildTeam(side: 'mine' | 'enemy'): TeamVM {
    const s = this.state
    const isMineSide = side === 'mine'
    return {
      countText: `禁 ${isMineSide ? s.preMine.length : s.preEnemy.length}/2 · 选 ${isMineSide ? s.picksMine.length : s.picksEnemy.length}/5`,
      bans: this.buildBanVMs(isMineSide ? s.preMine : s.preEnemy),
      picks: this.buildPickVMs(isMineSide ? s.picksMine : s.picksEnemy, side),
    }
  },

  buildResult(): ResultVM | null {
    const s = this.state
    if (s.phase !== 'done') return null
    const mine = s.picksMine.filter((c) => c !== s.banEnemy)
    const enemy = s.picksEnemy.filter((c) => c !== s.banMine)
    const ms = teamScore(mine, enemy)
    const es = teamScore(enemy, mine)
    const diff = (ms ? ms.score : 0) - (es ? es.score : 0)
    const wr = 50 + 13 * Math.tanh(diff / 6)

    const row = (label: string, a: number | null, b: number | null, fmt?: (x: number) => string): ResultRowVM => {
      const f = fmt || ((x: number) => x.toFixed(2))
      const av = a == null ? null : a
      const bv = b == null ? null : b
      const mineCls = (av || 0) > (bv || 0) ? 'win' : (av || 0) < (bv || 0) ? 'lose' : ''
      const enemyCls = (bv || 0) > (av || 0) ? 'win' : (bv || 0) < (av || 0) ? 'lose' : ''
      return { label, mine: av == null ? '—' : f(av), enemy: bv == null ? '—' : f(bv), mineCls, enemyCls }
    }

    const sideVM = (codes: string[], out: string | null) =>
      codes.map((c) => ({
        name: this.heroDisplayName(c),
        avatar: avatarUrl(c),
        out: out === c,
      }))

    return {
      wrText: `${f1(wr)}%`,
      verdict: wr >= 55 ? '优势' : wr <= 45 ? '劣势' : '均势',
      diffText: `${diff >= 0 ? '+' : ''}${f1(diff)} 分`,
      mineSide: sideVM(s.picksMine, s.banEnemy),
      enemySide: sideVM(s.picksEnemy, s.banMine),
      rows: [
        row('对位克制净分', ms ? ms.counter : null, es ? es.counter : null),
        row('队内配合净分', ms ? ms.synergy : null, es ? es.synergy : null),
        row('平均合并胜率', ms ? ms.strength : null, es ? es.strength : null, (x) => `${f1(50 + x)}%`),
        row('综合指数', ms ? ms.score : null, es ? es.score : null),
      ],
      pillEnemyBan: s.banMine ? this.heroDisplayName(s.banMine) : '—',
      pillMineBan: s.banEnemy ? this.heroDisplayName(s.banEnemy) : '—',
      pillMineCount: `我方出战 ${s.picksMine.length} → 留 ${mine.length}`,
      pillEnemyCount: `对手出战 ${s.picksEnemy.length} → 留 ${enemy.length}`,
    }
  },

  // ---------------- 事件 ----------------
  tapCell(e: WechatMiniprogram.TouchEvent): void {
    const code = e.currentTarget.dataset.code as string
    if (code) this.handlePoolClick(code)
  },

  tapFirstSeg(e: WechatMiniprogram.TouchEvent): void {
    const key = e.currentTarget.dataset.key as 'mine' | 'enemy'
    if (key === this.state.first) return
    this.snapshot()
    this.state.first = key
    this.recalcPhase()
    this.refresh()
  },

  tapFilterAttr(e: WechatMiniprogram.TouchEvent): void {
    this.attrFilter = (e.currentTarget.dataset.key as string) || ''
    this.refresh()
  },

  tapFilterRole(e: WechatMiniprogram.TouchEvent): void {
    this.roleFilter = (e.currentTarget.dataset.key as string) || ''
    this.refresh()
  },

  onSearch(e: WechatMiniprogram.Input): void {
    this.query = e.detail.value || ''
    this.setData({ 'pool.query': this.query, 'pool.cells': this.buildPool().cells, 'pool.countText': this.buildPool().countText })
  },

  onSortChange(e: WechatMiniprogram.PickerChange): void {
    this.sortIndex = Number(e.detail.value)
    this.refresh()
  },

  tapUndo(): void { this.undo() },
  tapReset(): void { this.reset() },
  tapAuto(): void { this.autoEnemy() },
  tapDemo(): void { this.runDemo() },
  tapPreset(e: WechatMiniprogram.TouchEvent): void {
    this.applyPreset(e.currentTarget.dataset.key as string)
  },
})
