import { GeneralDefinition, GameState } from 'sgs3v3-shared'
import { getGeneralPool } from '../../engine/generals'
import { draftScore, setDraftTrace } from '../../engine/local-ai'
import { shuffleInPlace } from '../../engine/rng'

/** 斗地主模式剔除的武将 */
export const LANDLORD_EXCLUDED_GENERAL_IDS = ['wenpin', 'zhugejin']

/** 斗地主武将池：洛书池去掉文聘、诸葛瑾 */
export function getLandlordGeneralPool(): GeneralDefinition[] {
    return getGeneralPool('luoshu').filter((g) => !LANDLORD_EXCLUDED_GENERAL_IDS.includes(g.id))
}

/** 洗牌后发三池：地主 6、农民一 5、农民二 5，互不重复 */
export function buildLandlordPools(): GeneralDefinition[][] {
    const shuffled = shuffleInPlace([...getLandlordGeneralPool()])
    return [shuffled.slice(0, 6), shuffled.slice(6, 11), shuffled.slice(11, 16)]
}

/** AI 在某个池里挑综合评分最高的武将 */
export function pickBestForPool(
    pool: GeneralDefinition[],
    allyPicked: GeneralDefinition[],
    rivalPicked: GeneralDefinition[] = [],
): GeneralDefinition {
    let best = pool[0]
    let bestScore = -Infinity
    for (const def of pool) {
        const score = draftScore(def, allyPicked, rivalPicked).total
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

    const allyPicked: GeneralDefinition[] = pick.picked
        .map((id, i) => (id ? pick.pools[i].find((g) => g.id === id) : undefined))
        .filter((g): g is GeneralDefinition => !!g)
    for (const i of seats) {
        const pool = pick.pools[i]
        const graded = pool.map((def) => ({
            id: def.id,
            score: Math.round(draftScore(def, allyPicked, []).total),
        }))
        const def = pickBestForPool(pool, allyPicked)
        setDraftTrace({
            phase: 'pick',
            candidates: graded.map((g) => ({ ...g, chosen: g.id === def.id })),
            chosenId: def.id,
        })
        pick.picked[i] = def.id
        allyPicked.push(def)
    }
    if (pick.picked.every((id) => id !== null)) onAllPicked?.()
    return true
}
