/**
 * 领域类型定义。
 */
export interface Hero {
  /** 英雄代号（kebab-case，头像主键） */
  code: string
  /** 中文名 */
  name: string
  /** 属性（火焰/寒气/自然/光明/黑暗） */
  attr: string
  /** 职业（战士/骑士/刺客/法师/射手/精灵师） */
  role: string
  /** 合并胜率 % */
  wr: number
  /** 合并选取率 % */
  pick: number
  /** 合并对局样本数 */
  games: number
}

/** 对位/搭配样本（克制表只含 wr/g，配合表只含 gain/g） */
export interface Matchup {
  /** 对位胜率 %（克制表） */
  wr?: number
  /** 相对自身均值的提升（配合表） */
  gain?: number
  /** 对局样本数 */
  g: number
}
