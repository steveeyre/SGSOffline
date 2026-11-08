/**
 * 目标层：先识别当前最该达成的一件事，再让出牌候选围绕它排序。
 *
 * 目标只负责“往哪打”，具体收益/风险仍由 ai-policy 的动作评分计算；
 * 这样 AI 的行为会围绕一个明确目的展开，而不是每个动作各自为战。
 */
import { GameState, SeatRole, TrickCardName } from 'sgs3v3-shared'
import type { EnemyTurnPlan } from './ai-memory'

export type GeneralView = GameState['generals'][number]

export type ObjectiveKind =
    | 'break-ally-delayed'
    | 'protect-ally'
    | 'limit-enemy-next'
    | 'focus-core'

export interface ObjectivePlan {
    kind: ObjectiveKind
    priority: number
    targetIndex: number
    /** 按推荐执行顺序排列的动作 key */
    sequence: string[]
    reason: string
}

export interface ObjectiveContext {
    focusIndex: number
    allies: Array<{ g: GeneralView; index: number }>
    enemies: Array<{ g: GeneralView; index: number }>
    plans: EnemyTurnPlan[]
    killWindow: boolean
    commanderKill: boolean
}

const DELAYED = new Set<string>([
    TrickCardName.OVERINDULGENCE,
    TrickCardName.SUPPLY_SHORTAGE,
    TrickCardName.LIGHTNING,
])

function hasDelayed(g: GeneralView): boolean {
    return g.judgeZone.some((card) => DELAYED.has(card.name))
}

/**
 * 一次只返回一个最高优先级目标。优先级从高到低：
 * 斩杀核心 > 解除队友延时 > 限制高威胁敌人 > 保护残血队友 > 常规集火。
 */
export function detectObjective(ctx: ObjectiveContext): ObjectivePlan | null {
    const candidates: ObjectivePlan[] = []
    const focus = ctx.enemies.find(({ index }) => index === ctx.focusIndex)

    // 1. 核心已经进入斩杀线：所有伤害动作围绕这一刀
    if (focus && (ctx.commanderKill || (ctx.killWindow && focus.g.hp <= 2))) {
        candidates.push({
            kind: 'focus-core',
            priority: ctx.commanderKill ? 120 : 100,
            targetIndex: focus.index,
            sequence: ['wine', 'slash', 'lihuo', 'longdan', 'wusheng', 'duel', 'fire_attack',
                'barbarians', 'arrows'],
            reason: ctx.commanderKill ? '敌方主帅已进入斩杀线' : '核心目标已进入斩杀线',
        })
    }

    // 2. 队友判定区被贴了乐/兵粮/闪电：先拆掉，别让队友空过
    const delayedAlly = ctx.allies.find(({ g }) => g.alive && hasDelayed(g))
    if (delayedAlly) {
        candidates.push({
            kind: 'break-ally-delayed',
            priority: delayedAlly.g.seatRole === SeatRole.COMMANDER ? 105 : 95,
            targetIndex: delayedAlly.index,
            sequence: ['dismantle_ally', 'steal_ally'],
            reason: '解除队友判定区的延时锦囊',
        })
    }

    // 3. 高威胁敌人马上要动，又没被延时：先限制他这一回合
    const threat = ctx.plans.find((plan) => plan.actsThisRound && plan.threat > 0 &&
        ctx.enemies.some(({ index }) => index === plan.index))
    if (threat) {
        const enemy = ctx.enemies.find(({ index }) => index === threat.index)
        if (enemy && !hasDelayed(enemy.g)) {
            candidates.push({
                kind: 'limit-enemy-next',
                priority: 85,
                targetIndex: threat.index,
                sequence: ['overindulgence', 'supply_shortage', 'dismantle', 'steal', 'borrow_sword'],
                reason: '限制下回合威胁最高的敌人',
            })
        }
    }

    // 4. 队友残血：先补防御/回血，保住他进下一个出牌阶段
    const weakAlly = ctx.allies.find(({ g }) => g.alive &&
        (g.hp <= 1 || (g.hp <= 2 && g.hand.length <= 2)))
    if (weakAlly) {
        candidates.push({
            kind: 'protect-ally',
            priority: 75,
            targetIndex: weakAlly.index,
            sequence: ['peach_garden', 'harvest', 'equip_armor', 'equip_plus_horse', 'steal_ally'],
            reason: '队友体力见底，先补防御',
        })
    }

    // 5. 常规集火：没有更紧急的事时，所有伤害往核心身上压
    if (focus) {
        candidates.push({
            kind: 'focus-core',
            priority: 55,
            targetIndex: focus.index,
            sequence: ['wine', 'slash', 'lihuo', 'longdan', 'wusheng', 'duel', 'fire_attack',
                'barbarians', 'arrows'],
            reason: '集火敌方核心',
        })
    }

    candidates.sort((a, b) => b.priority - a.priority)
    return candidates[0] ?? null
}
