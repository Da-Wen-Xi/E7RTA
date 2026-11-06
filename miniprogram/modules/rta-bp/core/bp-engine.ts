/**
 * BP 评分引擎（纯函数，与 HTML 版 RTA_BP模拟器 算法逐行对应）。
 *
 * - 克制分：对位胜率相对 50% 的偏移（我方视角 + 对手视角反号，按样本加权平均）
 * - 配合分：与队友搭配增益（相对自身均值）
 * - 强度分：合并胜率经贝叶斯收缩后减 50
 * - 综合分 = 克制 ×1 + 配合 ×0.5 + 强度 ×(有情报 0.2 / 无情报 0.35)
 * - 预测胜率 = 50 + 13·tanh(双方综合分差/6)
 */
import { COUNTER_MAP, SYNERGY_MAP } from '../data/matchup-table'
import { Hero, Matchup } from '../data/types'
import { HEROES } from '../data/hero-list'
import { MIN_GAMES, SHRINK } from './constants'

const heroByCode = new Map<string, Hero>()
for (const h of HEROES) {
  heroByCode.set(h.code, h)
}

export function getHero(code: string): Hero | undefined {
  return heroByCode.get(code)
}

export function heroName(code: string): string {
  return heroByCode.get(code)?.name ?? code
}

/** 收缩后胜率，避免「1 场 1 胜 = 100%」这类噪声 */
export function wrAdj(h: Hero): number {
  const wins = (h.wr / 100) * h.games
  return ((wins + SHRINK * 0.5) / (h.games + SHRINK)) * 100
}

export interface MatchupEdge {
  /** 百分点增益（正 = 克制对方） */
  gain: number
  /** 双向合计样本 */
  samples: number
  /** 本方视角对位胜率（可能为 null） */
  hwr: number | null
}

/** 对位强度：H 视角 + 对手视角反号，按样本加权 */
export function matchupEdge(H: string, E: string): MatchupEdge | null {
  let n = 0
  let d = 0
  let hwr: number | null = null
  const hMap: Record<string, Matchup> | undefined = COUNTER_MAP[H]
  if (hMap && hMap[E]) {
    const m = hMap[E]
    n += ((m.wr as number) - 50) * m.g
    d += m.g
    hwr = m.wr as number
  }
  const eMap: Record<string, Matchup> | undefined = COUNTER_MAP[E]
  if (eMap && eMap[H]) {
    const m = eMap[H]
    n += (50 - (m.wr as number)) * m.g
    d += m.g
  }
  if (!d) return null
  return { gain: n / d, samples: d, hwr }
}

export interface VsItem {
  code: string
  name: string
  gain: number
  /** 对位胜率（仅克制项有） */
  wr: number | null
}

export interface ScoreResult {
  code: string
  hero: Hero
  counter: number | null
  synergy: number | null
  strength: number
  score: number
  known: boolean
  vsE: VsItem[]
  vsO: VsItem[]
}

/** 计算一个英雄在给定双方阵容下的得分 */
export function scoreOf(code: string, own: string[], opp: string[]): ScoreResult | null {
  const h = heroByCode.get(code)
  if (!h) return null
  let cN = 0
  let cD = 0
  let sN = 0
  let sD = 0
  const vsE: VsItem[] = []
  const vsO: VsItem[] = []
  for (const e of opp) {
    const cg = matchupEdge(code, e)
    if (cg && cg.samples > 0) {
      cN += cg.gain * cg.samples
      cD += cg.samples
      vsE.push({ code: e, name: heroName(e), gain: cg.gain, wr: cg.hwr })
    }
  }
  for (const m of own) {
    const sm: Matchup | undefined = (SYNERGY_MAP[code] || {})[m] || (SYNERGY_MAP[m] || {})[code]
    if (sm && sm.gain !== undefined && sm.gain > 0) {
      sN += sm.gain * sm.g
      sD += sm.g
      vsO.push({ code: m, name: heroName(m), gain: sm.gain, wr: null })
    }
  }
  const counter = cD > 0 ? cN / cD : null
  const synergy = sD > 0 ? sN / sD : null
  const strength = wrAdj(h) - 50
  const known = counter !== null || synergy !== null
  const score = (counter || 0) * 1.0 + (synergy || 0) * 0.5 + strength * (known ? 0.2 : 0.35)
  vsE.sort((a, b) => b.gain - a.gain)
  vsO.sort((a, b) => b.gain - a.gain)
  return { code, hero: h, counter, synergy, strength, score, known, vsE, vsO }
}

export interface RankContext {
  own: string[]
  opp: string[]
  used?: Set<string>
}

/** 候选排序（低样本不进推荐榜） */
export function rank(ctx: RankContext): ScoreResult[] {
  const used = ctx.used || new Set<string>()
  const out: ScoreResult[] = []
  for (const h of HEROES) {
    if (used.has(h.code)) continue
    if (h.games < MIN_GAMES) continue
    const s = scoreOf(h.code, ctx.own, ctx.opp)
    if (s) out.push(s)
  }
  out.sort((a, b) => b.score - a.score || b.hero.wr - a.hero.wr)
  return out
}

export interface TeamScoreResult {
  counter: number | null
  synergy: number | null
  strength: number
  score: number
  n: number
}

export function teamScore(codes: string[], oppCodes: string[]): TeamScoreResult | null {
  const arr: ScoreResult[] = []
  for (const c of codes) {
    const s = scoreOf(c, codes.filter((x) => x !== c), oppCodes)
    if (s) arr.push(s)
  }
  if (!arr.length) return null
  const avg = (k: 'counter' | 'synergy' | 'strength') => arr.reduce((sum, x) => sum + (x[k] || 0), 0) / arr.length
  return {
    counter: avg('counter'),
    synergy: avg('synergy'),
    strength: avg('strength'),
    score: arr.reduce((sum, x) => sum + x.score, 0) / arr.length,
    n: arr.length,
  }
}

/** 预测胜率：选/禁之后双方的相对胜率指数 */
export function predictWR(myCodes: string[], enemyCodes: string[]): number {
  if (!myCodes.length) return 50
  const ms = teamScore(myCodes, enemyCodes)
  const es = enemyCodes.length ? teamScore(enemyCodes, myCodes) : null
  const diff = (ms ? ms.score : 0) - (es ? es.score : 0)
  return 50 + 13 * Math.tanh(diff / 6)
}
