# -*- coding: utf-8 -*-
"""数据同步脚本：E7 RTA 资料库工作区 → 微信小程序分包。

职责：
1. 读取源工作区 RTA_克制推荐_数据.json（双服合并，348 英雄 / 111 克制情报 / 108 配合情报）
2. 生成小程序 TS 数据模块：
   - miniprogram/modules/rta-bp/data/hero-list.ts     英雄基础数据 + 元信息
   - miniprogram/modules/rta-bp/data/matchup-table.ts 克制/配合对位表
3. 头像：按需入库（games≥500 或 pick≥1% 的英雄才会被展示）→ assets/avatars/{code}.webp
4. 图标：属性 5 + 职业 6 → assets/icons/{attr|role}-{en}.png

用法：python3 scripts/sync-data.py
仅搬运选中字段，未使用的字段（face/rar/avi）不入包。
"""
import json
import os
import shutil

# 源工作区（E7 资料库）；如移动工程请同步修改
SRC_DIR = "/Users/mac/WorkBuddy/E7/E7-RTA资料库工作区_2026-11-06_1793900423826657105/2026-11-05-20-02-06"
SRC_JSON = os.path.join(SRC_DIR, "RTA_克制推荐_数据.json")
SRC_AVATAR_DIR = os.path.join(SRC_DIR, "E7英雄头像")
SRC_ICON_DIR = os.path.join(SRC_DIR, "E7图标素材")

PKG_ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "miniprogram", "modules", "rta-bp")
DATA_DIR = os.path.join(PKG_ROOT, "data")
AVATAR_DIR = os.path.join(PKG_ROOT, "assets", "avatars")
ICON_DIR = os.path.join(PKG_ROOT, "assets", "icons")

ATTR_EN = {"火焰": "fire", "寒气": "ice", "自然": "wind", "光明": "light", "黑暗": "dark"}
ROLE_EN = {"战士": "warrior", "骑士": "knight", "刺客": "assassin", "法师": "mage", "射手": "ranger", "精灵师": "manauser"}


def gen_hero_list(heroes, meta):
    rows = ",\n  ".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) for r in heroes)
    return f"""/**
 * 英雄基础数据（自动生成，勿手改）——由 scripts/sync-data.py 从 E7 资料库工作区同步。
 * 口径：国服 + 外服按对局数合并（{meta['generated']}）。
 */
import {{ Hero }} from './types'

export interface DataMeta {{
  generated: string
  note: string
  heroTotal: number
}}

export const DATA_META: DataMeta = {json.dumps(meta, ensure_ascii=False, indent=2)}

export const HEROES: Hero[] = [
  {rows},
]
"""


def gen_matchup_table(ctr, syn):
    # 字段瘦身：引擎只用 CTR 的 wr/g 与 SYN 的 gain/g，其余不入包
    ctr_slim = {
        a: {b: {"wr": m["wr"], "g": m["g"]} for b, m in mp.items()}
        for a, mp in ctr.items()
    }
    syn_slim = {
        a: {b: {"gain": m["gain"], "g": m["g"]} for b, m in mp.items()}
        for a, mp in syn.items()
    }
    ctr_js = json.dumps(ctr_slim, ensure_ascii=False, separators=(",", ":"))
    syn_js = json.dumps(syn_slim, ensure_ascii=False, separators=(",", ":"))
    return f"""/**
 * 对位表（自动生成，勿手改）——由 scripts/sync-data.py 从 E7 资料库工作区同步。
 * COUNTER_MAP[H][E]：H 对 E 的对位样本（wr 对位胜率 / g 对局数），双服合并。
 * SYNERGY_MAP[A][B]：A 与 B 同队搭配样本（gain 相对自身均值的提升 / g 对局数），双服合并。
 */
import {{ Matchup }} from './types'

export const COUNTER_MAP: Record<string, Record<string, Matchup>> = {ctr_js}

export const SYNERGY_MAP: Record<string, Record<string, Matchup>> = {syn_js}
"""


def main():
    data = json.load(open(SRC_JSON, encoding="utf-8"))
    heroes = [
        {
            "code": h["code"], "name": h["name"], "attr": h["attr"], "role": h["role"],
            "wr": h["wr"], "pick": h["pick"], "games": h["games"],
        }
        for h in data["heroes"]
    ]
    meta = {
        "generated": data.get("generated", ""),
        "note": data.get("merged_note", ""),
        "heroTotal": len(heroes),
    }

    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(AVATAR_DIR, exist_ok=True)
    os.makedirs(ICON_DIR, exist_ok=True)

    with open(os.path.join(DATA_DIR, "hero-list.ts"), "w", encoding="utf-8") as f:
        f.write(gen_hero_list(heroes, meta))
    with open(os.path.join(DATA_DIR, "matchup-table.ts"), "w", encoding="utf-8") as f:
        f.write(gen_matchup_table(data["ctr"], data["syn"]))
    print(f"[ok] hero-list.ts / matchup-table.ts ({len(heroes)} heroes, ctr {len(data['ctr'])}, syn {len(data['syn'])})")

    n_avi = 0
    keep = set()
    for h in data["heroes"]:
        # 头像按需入库：games<500 且 pick<1% 的英雄不进推荐榜也不进常用池，头像不会展示，不入包
        if h["games"] < 500 and h["pick"] < 1.0:
            continue
        src = os.path.join(SRC_DIR, h["avi"])
        dst = os.path.join(AVATAR_DIR, h["code"] + ".webp")
        if os.path.exists(src):
            shutil.copyfile(src, dst)
            keep.add(h["code"] + ".webp")
            n_avi += 1
        else:
            print(f"[warn] 头像缺失: {h['code']} ({src})")
    # 清理陈旧头像（数据刷新后英雄被移出常用集的情况）
    pruned = 0
    for fn in os.listdir(AVATAR_DIR):
        if fn not in keep:
            os.remove(os.path.join(AVATAR_DIR, fn))
            pruned += 1
    print(f"[ok] avatars {n_avi} 张（低样本不入包），清理陈旧 {pruned} 张")

    n_ico = 0
    for cn, en in ATTR_EN.items():
        shutil.copyfile(os.path.join(SRC_ICON_DIR, "属性", f"属性_{cn}.png"), os.path.join(ICON_DIR, f"attr-{en}.png"))
        n_ico += 1
    for cn, en in ROLE_EN.items():
        shutil.copyfile(os.path.join(SRC_ICON_DIR, "职业", f"职业_{cn}.png"), os.path.join(ICON_DIR, f"role-{en}.png"))
        n_ico += 1
    print(f"[ok] icons {n_ico} 个")

    total = sum(os.path.getsize(os.path.join(dp, fn)) for dp, _, fns in os.walk(PKG_ROOT) for fn in fns)
    print(f"[ok] 分包总体积 {total / 1048576:.2f} MB（上限 2.00 MB）")


if __name__ == "__main__":
    main()
