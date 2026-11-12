import { GeneralDefinition, GameState } from 'sgs3v3-shared'
import { GENERALS, getGeneralPool } from '../../engine/generals'
import { draftScore, setDraftTrace } from '../../engine/local-ai'
import { drawOddities, pickOddity } from '../../engine/oddity'
import { shuffleInPlace } from '../../engine/rng'

/** 斗地主模式剔除的武将 */
export const LANDLORD_EXCLUDED_GENERAL_IDS = ['wenpin', 'zhugejin']

/** 斗地主武将池：乱斗池去掉文聘、诸葛瑾 */
export function getLandlordGeneralPool(): GeneralDefinition[] {
    return getGeneralPool('brawl').filter((g) => !LANDLORD_EXCLUDED_GENERAL_IDS.includes(g.id))
}

/** 点将候选顺序：与 generals.ts 中 GENERALS 的定义顺序一致 */
const GENERAL_ORDER = new Map(GENERALS.map((g, i) => [g.id, i]))

/** 点将池：模式全池按 GENERALS 定义顺序排列 */
export function getLandlordPointPickPool(): GeneralDefinition[] {
    return getLandlordGeneralPool()
        .sort((a, b) => (GENERAL_ORDER.get(a.id) ?? 0) - (GENERAL_ORDER.get(b.id) ?? 0))
}

/** 洗牌后发三池：地主 6、农民一 5、农民二 5，互不重复 */
export function buildLandlordPools(): GeneralDefinition[][] {
    const shuffled = shuffleInPlace([...getLandlordGeneralPool()])
    return [shuffled.slice(0, 6), shuffled.slice(6, 11), shuffled.slice(11, 16)]
}

/**
 * 地主是单打独斗：只能对其他角色用的增益技能（结姻/资援/仁德/明鉴/弘援/英魂/好施/救主）
 * 没有受益对象，抓将时按技能本身的价值扣掉。
 */
const LANDLORD_SOLO_SKILLS: Record<string, number> = {
    zhaoyun_jiuzhu: 10,
    sunshangxiang_jieyin: 8, sunshangxiang_jie_jieyin: 8,
    mizhu_ziyuan: 8,
    liubei_rende: 8, liubei_jie_rende: 8,
    caorui_mingjian: 8,
    zhugejin_hongyuan: 6, zhugejin_jing_hongyuan: 6,
    sunjian_yinghun: 6, sunjian_jie_yinghun: 6,
    lusu_jie_haoshi: 6,
}

/** 地主席位修正：把只能给队友用的技能从评分里减掉，避免拿它们当地主 */
export function landlordSeatBonus(def: GeneralDefinition): number {
    return -(def.skills ?? []).reduce(
        (sum, skill) => sum + (LANDLORD_SOLO_SKILLS[skill.id] ?? 0), 0)
}

/** AI 在某个池里挑综合评分最高的武将 */
export function pickBestForPool(
    pool: GeneralDefinition[],
    allyPicked: GeneralDefinition[],
    rivalPicked: GeneralDefinition[] = [],
    seatBonus?: (def: GeneralDefinition) => number,
): GeneralDefinition {
    let best = pool[0]
    let bestScore = -Infinity
    for (const def of pool) {
        const score = draftScore(def, allyPicked, rivalPicked).total + (seatBonus?.(def) ?? 0)
        if (score > bestScore) {
            bestScore = score
            best = def
        }
    }
    return best
}

/**
 * AI 补齐自己一方的选将（三方同时选，AI 立刻选完）。
 * 人类一方（执地主时的地主池 / 执农民时的两个农民池）保持不变。
 */
export function aiLandlordDraft(state: GameState, onAllPicked?: () => void): boolean {
    const pick = state.landlordPick
    if (!pick) return false
    const humanSide = state.landlordHumanSide ?? 'landlord'
    const seats = [0, 1, 2].filter((i) =>
        pick.picked[i] === null && (i === 0 ? humanSide === 'farmers' : humanSide === 'landlord'))
    if (seats.length === 0) return false

    // 点将可能选出池外武将，按模式全池兜底查找
    const allyPicked: GeneralDefinition[] = pick.picked
        .map((id, i) => (id
            ? pick.pools[i].find((g) => g.id === id)
                ?? getLandlordPointPickPool().find((g) => g.id === id)
            : undefined))
        .filter((g): g is GeneralDefinition => !!g)
    const takenIds = new Set(pick.picked.filter((id): id is string => !!id))
    for (const i of seats) {
        // 玩家可能先用点将抢走本池的武将，AI 只在剩下的里挑
        const available = pick.pools[i].filter((g) => !takenIds.has(g.id))
        const pool = available.length > 0
            ? available
            : getLandlordPointPickPool().filter((g) => !takenIds.has(g.id))
        const seatBonus = i === 0 ? landlordSeatBonus : undefined
        const graded = pool.map((def) => ({
            id: def.id,
            score: Math.round(draftScore(def, allyPicked, []).total + (seatBonus?.(def) ?? 0)),
        }))
        const def = pickBestForPool(pool, allyPicked, [], seatBonus)
        takenIds.add(def.id)
        setDraftTrace({
            phase: 'pick',
            candidates: graded.map((g) => ({ ...g, chosen: g.id === def.id })),
            chosenId: def.id,
        })
        pick.picked[i] = def.id
        if (pick.oddityPicked) {
            // 玩家先选：AI 席位的候选建局时没抽，这里现场抽，并避开全桌已定的奇技
            const taken = pick.oddityPicked.filter((id): id is string => !!id)
            const own = pick.pools[i].flatMap((g) => g.skills.map((s) => s.id))
            if (!pick.oddities?.[i]?.length && pick.oddities) {
                pick.oddities[i] = drawOddities([...own, ...taken])
            }
            const options = (pick.oddities?.[i] ?? []).filter((o) => !taken.includes(o.skillId))
            const oddity = options.length > 0 ? pickOddity(options) : pickOddity(drawOddities([...own, ...taken]))
            if (oddity) pick.oddityPicked[i] = oddity.skillId
        }
        allyPicked.push(def)
    }
    const allPicked = pick.picked.every((id) => id !== null)
        && (!pick.oddityPicked || pick.oddityPicked.every((id) => id !== null))
    if (allPicked) onAllPicked?.()
    return true
}
