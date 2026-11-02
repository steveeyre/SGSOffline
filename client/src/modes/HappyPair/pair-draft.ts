import { Faction, GeneralDefinition, GameState } from 'sgs3v3-shared'
import { getGeneralPool } from '../../engine/generals'
import { draftScore, setDraftTrace } from '../../engine/local-ai'
import { shuffleInPlace } from '../../engine/rng'
import { LANDLORD_EXCLUDED_GENERAL_IDS } from '../FightTheLandlord/landlord-draft'

/** 欢乐成双剔除的武将（与斗地主一致） */
export const PAIR_EXCLUDED_GENERAL_IDS = LANDLORD_EXCLUDED_GENERAL_IDS

/** 欢乐成双武将池：洛书池去掉文聘、诸葛瑾 */
export function getPairGeneralPool(): GeneralDefinition[] {
    return getGeneralPool('luoshu').filter((g) => !PAIR_EXCLUDED_GENERAL_IDS.includes(g.id))
}

/** 洗牌后发四个座位池（各 5 名，互不重复） */
export function buildPairPools(): GeneralDefinition[][] {
    const shuffled = shuffleInPlace([...getPairGeneralPool()])
    return [
        shuffled.slice(0, 5),
        shuffled.slice(5, 10),
        shuffled.slice(10, 15),
        shuffled.slice(15, 20),
    ]
}

/** 某阵营的两个座位（1、4 号位为冷色；2、3 号位为暖色） */
export function pairSeatsOf(faction: Faction): number[] {
    return faction === Faction.COOL ? [0, 3] : [1, 2]
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
 * AI 补齐自己一方的两个座位（四方同时选，AI 立刻选完）。
 * 人类一方的两个座位保持不变。
 */
export function aiPairDraft(state: GameState, onAllPicked?: () => void): boolean {
    const pick = state.pairPick
    if (!pick) return false
    const humanSide = state.pairHumanSide
    if (!humanSide) return false
    const aiSeats = pairSeatsOf(humanSide === Faction.WARM ? Faction.COOL : Faction.WARM)
    const seats = aiSeats.filter((i) => pick.picked[i] === null)
    if (seats.length === 0) return false

    const allyPicked: GeneralDefinition[] = []
    for (const i of pairSeatsOf(humanSide === Faction.WARM ? Faction.COOL : Faction.WARM)) {
        const id = pick.picked[i]
        if (!id) continue
        const def = pick.pools[i].find((g) => g.id === id)
        if (def) allyPicked.push(def)
    }
    const rivalPicked: GeneralDefinition[] = []
    for (const i of pairSeatsOf(humanSide)) {
        const id = pick.picked[i]
        if (!id) continue
        const def = pick.pools[i].find((g) => g.id === id)
        if (def) rivalPicked.push(def)
    }

    for (const i of seats) {
        const pool = pick.pools[i]
        const graded = pool.map((def) => ({
            id: def.id,
            score: Math.round(draftScore(def, allyPicked, rivalPicked).total),
        }))
        const def = pickBestForPool(pool, allyPicked, rivalPicked)
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
