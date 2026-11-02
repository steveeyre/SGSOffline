/**
 * 战略层：集火目标与对手意图分析。
 * 只用公开信息（座位、体力、手牌数、公开日志），不读敌方手牌内容。
 */
import { GameState, SeatRole } from 'sgs3v3-shared'
import { getGeneralById } from './generals'
import { rolesOf } from './general-meta'
import { damageBackfire } from './ai-synergy'

export type GeneralView = GameState['generals'][number]

function nameOf(g: GeneralView): string {
    return getGeneralById(g.generalId)?.name ?? g.generalId
}

export interface StrategyView {
    /** 本回合集火目标（敌方座位），-1 表示无目标 */
    focusIndex: number
    /** 我方每个座位被针对的程度 */
    pressure: number[]
    /** 被针对最狠的我方座位，-1 表示没有明显针对 */
    pressureIndex: number
    /** 对手的核心角色（体力 + 手牌 + 定位） */
    enemyCarryIndex: number
    /** 对手在攒牌：手牌普遍偏多且近期几乎不出牌 */
    enemySaving: boolean
}

export function analyzeStrategy(state: GameState, playerId: string): StrategyView {
    const faction = state.players[playerId]?.faction
    const seats = state.generals.map((g, index) => ({ g, index }))
    const enemies = seats.filter((e) => e.g.alive && e.g.faction !== faction)
    const allies = seats.filter((e) => e.g.alive && e.g.faction === faction)
    const pressure = seats.map(() => 0)
    const ourHits = new Map<number, number>()
    let enemyPlays = 0

    for (const entry of state.log.slice(-48)) {
        const text = entry.text
        const use = text.match(/^【([^】]+)】对(.*)使用了/)
        if (!use) {
            // 伤害行不带来源，按“我方挨打”计入压力
            for (const ally of allies) {
                if (text.startsWith(`【${nameOf(ally.g)}】受到`)) pressure[ally.index] += 2
            }
            continue
        }
        const [, userName, targets] = use
        const user = seats.find((e) => nameOf(e.g) === userName)
        if (!user) continue
        if (user.g.faction === faction) {
            for (const enemy of enemies) {
                if (targets.includes(`【${nameOf(enemy.g)}】`)) {
                    ourHits.set(enemy.index, (ourHits.get(enemy.index) ?? 0) + 1)
                }
            }
            continue
        }
        enemyPlays += 1
        for (const ally of allies) {
            if (targets.includes(`【${nameOf(ally.g)}】`)) pressure[ally.index] += 1
        }
    }

    // 集火：主帅 > 已受伤 > 手牌少 > 我们正在打的目标 > 卖血将打折
    const focusScore = (e: { g: GeneralView; index: number }): number => {
        let score = e.g.seatRole === SeatRole.COMMANDER ? 40 : 0
        score += (e.g.maxHp - e.g.hp) * 6
        if (e.g.hp <= 1) score += 20
        score += Math.max(0, 3 - e.g.hand.length) * 4
        score += (ourHits.get(e.index) ?? 0) * 4
        score -= e.g.hp <= 1 ? 0 : damageBackfire(e.g)
        return score
    }
    let focusIndex = -1
    let focusBest = -Infinity
    for (const enemy of enemies) {
        const score = focusScore(enemy)
        if (score > focusBest) {
            focusBest = score
            focusIndex = enemy.index
        }
    }

    // 对手的核心：体力和手牌撑起来的那个，通常也是他们所有资源倾斜的对象
    const carryScore = (e: { g: GeneralView; index: number }): number =>
        e.g.hp * 3 + e.g.hand.length * 2 +
        (rolesOf(e.g.generalId).includes('core') ? 8 : 0) +
        (e.g.seatRole === SeatRole.COMMANDER ? 4 : 0)
    let enemyCarryIndex = -1
    let carryBest = -Infinity
    for (const enemy of enemies) {
        const score = carryScore(enemy)
        if (score > carryBest) {
            carryBest = score
            enemyCarryIndex = enemy.index
        }
    }

    let pressureIndex = -1
    let pressureBest = 0
    for (const ally of allies) {
        if (pressure[ally.index] > pressureBest) {
            pressureBest = pressure[ally.index]
            pressureIndex = ally.index
        }
    }

    // 对手在攒牌：平均手牌偏多，但近期几乎没出手
    const enemyHandAvg = enemies.length > 0
        ? enemies.reduce((sum, e) => sum + e.g.hand.length, 0) / enemies.length
        : 0
    const enemySaving = enemies.length > 0 && enemyHandAvg >= 2.5 && enemyPlays <= 1

    return { focusIndex, pressure, pressureIndex, enemyCarryIndex, enemySaving }
}
