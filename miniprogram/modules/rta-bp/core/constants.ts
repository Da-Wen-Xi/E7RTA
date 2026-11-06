/**
 * 流程常量与静态元数据（与 HTML 版 RTA_BP模拟器 口径一致）。
 */
export type Side = 'mine' | 'enemy'
/** 选人顺序 1-2-2-2-2-1，M=先手方 E=后手方 */
export const FIRST_DRAFT: Array<'M' | 'E'> = ['M', 'E', 'E', 'M', 'M', 'E', 'E', 'M', 'M', 'E']

/** 样本低于此值不进入推荐榜（仍可在英雄池手动选） */
export const MIN_GAMES = 500
/** 英雄池只显示选取率 ≥ 1% 的 RTA 常用英雄 */
export const POOL_PICK_MIN = 1.0
/** 贝叶斯收缩强度：把低样本胜率拉回 50% */
export const SHRINK = 300

/** 我方固定预禁 */
export const PRE_BAN_MINE = ['lisette', 'lady-of-the-scales']
/** 对手预禁高频候选（快捷按钮用） */
export const ENEMY_BAN_CAND = ['perfumer-byblis', 'rhianna-and-luciella', 'notos', 'school-nurse-yulha']

/** 方案 A/B/C 预设（对应禁用应对方案报告的作战手册） */
export const PRESETS: Record<string, string[]> = {
  A: ['arbiter-vildred', 'perfumer-byblis', 'aube'],
  B: ['genesis-ras', 'school-nurse-yulha', 'eye-of-the-abyss-fumyr'],
  C: ['estelle', 'notos', 'harsetti'],
}

/** 属性色条颜色 */
export const ATTR_COLORS: Record<string, string> = {
  火焰: '#ff6b5e',
  寒气: '#4ea3ff',
  自然: '#5fce6b',
  光明: '#f2c14e',
  黑暗: '#b07cff',
}

const ICON_BASE = '/modules/rta-bp/assets/icons'
const AVATAR_BASE = '/modules/rta-bp/assets/avatars'

/** 属性图标路径 */
export const ATTR_ICONS: Record<string, string> = {
  火焰: `${ICON_BASE}/attr-fire.png`,
  寒气: `${ICON_BASE}/attr-ice.png`,
  自然: `${ICON_BASE}/attr-wind.png`,
  光明: `${ICON_BASE}/attr-light.png`,
  黑暗: `${ICON_BASE}/attr-dark.png`,
}

/** 职业图标路径 */
export const ROLE_ICONS: Record<string, string> = {
  战士: `${ICON_BASE}/role-warrior.png`,
  骑士: `${ICON_BASE}/role-knight.png`,
  刺客: `${ICON_BASE}/role-assassin.png`,
  法师: `${ICON_BASE}/role-mage.png`,
  射手: `${ICON_BASE}/role-ranger.png`,
  精灵师: `${ICON_BASE}/role-manauser.png`,
}

export const avatarUrl = (code: string): string => `${AVATAR_BASE}/${code}.webp`

export interface FilterOption {
  key: string
  label: string
  icon: string
}

/** 属性筛选按钮（含「全部」） */
export const ATTR_FILTERS: FilterOption[] = [
  { key: '', label: '全部', icon: '' },
  { key: '火焰', label: '火', icon: ATTR_ICONS['火焰'] },
  { key: '寒气', label: '水', icon: ATTR_ICONS['寒气'] },
  { key: '自然', label: '木', icon: ATTR_ICONS['自然'] },
  { key: '光明', label: '光', icon: ATTR_ICONS['光明'] },
  { key: '黑暗', label: '暗', icon: ATTR_ICONS['黑暗'] },
]

/** 职业筛选按钮（含「全部」） */
export const ROLE_FILTERS: FilterOption[] = [
  { key: '', label: '全部', icon: '' },
  { key: '战士', label: '战士', icon: ROLE_ICONS['战士'] },
  { key: '骑士', label: '骑士', icon: ROLE_ICONS['骑士'] },
  { key: '刺客', label: '刺客', icon: ROLE_ICONS['刺客'] },
  { key: '法师', label: '法师', icon: ROLE_ICONS['法师'] },
  { key: '射手', label: '射手', icon: ROLE_ICONS['射手'] },
  { key: '精灵师', label: '精灵师', icon: ROLE_ICONS['精灵师'] },
]

export interface SortOption {
  key: 'rec' | 'pick' | 'wr' | 'name'
  label: string
}

/** 英雄池排序选项 */
export const SORT_OPTIONS: SortOption[] = [
  { key: 'rec', label: '按推荐分' },
  { key: 'pick', label: '按选取率' },
  { key: 'wr', label: '按合并胜率' },
  { key: 'name', label: '按名称' },
]
