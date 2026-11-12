import { Faction, GeneralDefinition, GameState } from 'sgs3v3-shared'
import { GENERALS, getGeneralPool } from '../../engine/generals'
import { draftScore, setDraftTrace } from '../../engine/local-ai'
import { drawOddities, pickOddity } from '../../engine/oddity'
import { shuffleInPlace } from '../../engine/rng'
import { LANDLORD_EXCLUDED_GENERAL_IDS } from '../FightTheLandlord/landlord-draft'

/** 欢乐成双剔除的武将（与斗地主一致） */
export const PAIR_EXCLUDED_GENERAL_IDS = LANDLORD_EXCLUDED_GENERAL_IDS

/** 欢乐成双武将池：乱斗池去掉文聘、诸葛瑾 */
export function getPairGeneralPool(): GeneralDefinition[] {
    return getGeneralPool('brawl').filter((g) => !PAIR_EXCLUDED_GENERAL_IDS.includes(g.id))
}

/** 点将候选顺序：与 generals.ts 中 GENERALS 的定义顺序一致 */
const GENERAL_ORDER = new Map(GENERALS.map((g, i) => [g.id, i]))

/** 点将池：模式全池按 GENERALS 定义顺序排列 */
export function getPairPointPickPool(): GeneralDefinition[] {
    return getPairGeneralPool()
        .sort((a, b) => (GENERAL_ORDER.get(a.id) ?? 0) - (GENERAL_ORDER.get(b.id) ?? 0))
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
        // 点将可能选出池外武将，按模式全池兜底查找
        const def = pick.pools[i].find((g) => g.id === id)
            ?? getPairPointPickPool().find((g) => g.id === id)
        if (def) allyPicked.push(def)
    }
    const rivalPicked: GeneralDefinition[] = []
    for (const i of pairSeatsOf(humanSide)) {
        const id = pick.picked[i]
        if (!id) continue
        // 点将可能选出池外武将，按模式全池兜底查找
        const def = pick.pools[i].find((g) => g.id === id)
            ?? getPairPointPickPool().find((g) => g.id === id)
        if (def) rivalPicked.push(def)
    }

    const takenIds = new Set(pick.picked.filter((id): id is string => !!id))
    for (const i of seats) {
        // 玩家可能先用点将抢走本池的武将，AI 只在剩下的里挑
        const available = pick.pools[i].filter((g) => !takenIds.has(g.id))
        const pool = available.length > 0
            ? available
            : getPairPointPickPool().filter((g) => !takenIds.has(g.id))
        const graded = pool.map((def) => ({
            id: def.id,
            score: Math.round(draftScore(def, allyPicked, rivalPicked).total),
        }))
        const def = pickBestForPool(pool, allyPicked, rivalPicked)
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
