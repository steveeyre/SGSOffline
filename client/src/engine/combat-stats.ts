import { BattleSideStats, BattleStats, Card, Faction, GameState, GeneralInstance } from 'sgs3v3-shared'
import { getGeneralById } from './generals'

/** 本局战绩累计：赛后结算页读取，结算过程中只累加、不回溯 */
function blankSide(): BattleSideStats {
    return {
        skillUses: 0,
        draws: 0,
        damageDealt: 0,
        damageToEnemy: 0,
        kills: 0,
        damageTaken: 0,
        healing: 0,
    }
}

export function ensureBattleStats(state: GameState): BattleStats {
    if (!state.battleStats) {
        state.battleStats = { warm: blankSide(), cool: blankSide() }
    }
    return state.battleStats
}

function sideOf(stats: BattleStats, faction: Faction): BattleSideStats {
    return faction === Faction.WARM ? stats.warm : stats.cool
}

/** 实际扣减体力后调用：amount 为生效伤害值 */
export function recordDamage(
    state: GameState,
    attacker: GeneralInstance | null,
    target: GeneralInstance,
    amount: number,
): void {
    if (amount <= 0) return
    const stats = ensureBattleStats(state)
    sideOf(stats, target.faction).damageTaken += amount
    if (!attacker) return
    const atkStats = sideOf(stats, attacker.faction)
    atkStats.damageDealt += amount
    if (attacker.faction !== target.faction) atkStats.damageToEnemy += amount
}

/** 实际回复体力后调用 */
export function recordHeal(state: GameState, target: GeneralInstance | null | undefined, amount: number): void {
    if (!target || amount <= 0) return
    sideOf(ensureBattleStats(state), target.faction).healing += amount
}

/** 由其他阵营击杀时给击杀者记一次 */
export function recordKill(
    state: GameState,
    attacker: GeneralInstance | null,
    target: GeneralInstance,
): void {
    if (!attacker || attacker === target || attacker.faction === target.faction) return
    sideOf(ensureBattleStats(state), attacker.faction).kills += 1
}

/** 日志 `【武将名】发动【技能】` 是技能真正发动的统一文案；“可发动”询问不计 */
export function recordSkillLog(state: GameState, text: string): void {
    const matched = /^【([^】]+)】发动【/.exec(text)
    if (!matched) return
    const owner = state.generals.find(
        (g) => (getGeneralById(g.generalId)?.name ?? g.generalId) === matched[1],
    )
    if (!owner) return
    sideOf(ensureBattleStats(state), owner.faction).skillUses += 1
}

/**
 * 摸牌归属：牌堆摸出的牌先记 id，落到某名角色手牌时再计入该方「补牌」。
 * 这样获得/抢夺来的牌不会被算成摸牌，摸到后又立即用掉也不会漏计。
 */
const drawnCardIds = new WeakMap<GameState, Set<string>>()

export function noteDeckDraws(state: GameState, cards: Card[]): void {
    if (cards.length === 0) return
    let ids = drawnCardIds.get(state)
    if (!ids) {
        ids = new Set<string>()
        drawnCardIds.set(state, ids)
    }
    for (const card of cards) ids.add(card.id)
}

/** 手牌新增时调用：只返回其中来自牌堆、尚未结算过的张数 */
export function takeDeckDrawCount(state: GameState, addedIds: string[]): number {
    const ids = drawnCardIds.get(state)
    if (!ids || addedIds.length === 0) return 0
    let count = 0
    for (const id of addedIds) {
        if (ids.delete(id)) count += 1
    }
    return count
}

export function recordDraws(state: GameState, owner: GeneralInstance, count: number): void {
    if (count <= 0) return
    sideOf(ensureBattleStats(state), owner.faction).draws += count
}
