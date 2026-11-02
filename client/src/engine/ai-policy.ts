/**
 * 出牌决策表：基础分 + 动态修正分。
 *
 * 基础分只表示同一回合内的相对优先级，不是绝对数值。所有修正都按类别
 * 封顶，避免某一类修正把层次顺序整个翻转；执行一个动作后由 aiPlayOne
 * 的调用方重新进入本函数，用最新的手牌与公开信息重新评分。
 */
import {
    BasicCardName, Card, CardCategory, EquipmentCardName, EquipSlot, GameState,
    SeatRole, TrickCardName,
} from 'sgs3v3-shared'
import { DECK_SIZE, KEY_CARD_COUNTS } from './deck-meta'
import { rolesOf } from './general-meta'

export type GeneralView = GameState['generals'][number]
export type PlanKind = 'value' | 'control' | 'burst' | 'defense'

/** 低于此分的动作视为“不如留牌”，直接结束出牌阶段 */
export const PASS_SCORE = 20
/** 计划胜出时给该计划内动作的加成，只用来打破同分，不改变层次顺序 */
export const PLAN_BONUS = 4
/** §4 目标公式的缩放：让目标修正与基础分同量级 */
const TARGET_SCALE = 0.15

/** §1 主动牌基础分 */
export const BASE_SCORE = {
    peach: 10,
    draw_two: 90,
    harvest: 40,
    peach_garden: 30,
    overindulgence: 70,
    supply_shortage: 65,
    dismantle: 60,
    steal: 65,
    iron_chain: 20,
    iron_chain_ready: 50,
    iron_chain_recast: 78,
    wine: 15,
    slash: 50,
    duel: 55,
    fire_attack: 50,
    barbarians: 45,
    arrows: 45,
    borrow_sword: 40,
    skill: 60,
} as const

/** §2 装备基础分 */
export const EQUIP_BASE: Record<string, number> = {
    [EquipmentCardName.PLUS_HORSE]: 70,
    [EquipmentCardName.MINUS_HORSE]: 40,
    [EquipmentCardName.EIGHT_TRIGRAMS]: 55,
    [EquipmentCardName.NIOH_SHIELD]: 55,
    [EquipmentCardName.VINE]: 45,
    [EquipmentCardName.SILVER_LION]: 60,
    [EquipmentCardName.CROSSBOW]: 30,
    [EquipmentCardName.ICE_SWORD]: 35,
    [EquipmentCardName.QINGGANG_SWORD]: 40,
    [EquipmentCardName.GUDING_BLADE]: 35,
    [EquipmentCardName.DOUBLE_SWORDS]: 30,
    [EquipmentCardName.GREEN_DRAGON]: 35,
    [EquipmentCardName.STONE_AXE]: 40,
    [EquipmentCardName.ZHANGBA_SPEAR]: 30,
    [EquipmentCardName.FANGTIAN_HALBERD]: 30,
    [EquipmentCardName.ZHUQUE_FAN]: 40,
    [EquipmentCardName.KYLIN_BOW]: 30,
}

const SLASH_NAMES: string[] = [BasicCardName.ATTACK, BasicCardName.FIRE_SLASH, BasicCardName.THUNDER_SLASH]

function isSlash(card: Card): boolean {
    return card.category === CardCategory.BASIC && SLASH_NAMES.includes(card.name)
}

function isDodge(card: Card): boolean {
    return card.category === CardCategory.BASIC && card.name === BasicCardName.DODGE
}

function isPeach(card: Card): boolean {
    return card.category === CardCategory.BASIC && card.name === BasicCardName.PEACH
}

// ─────────────────────────────────────────────────────────────
// §5 节奏修正
// ─────────────────────────────────────────────────────────────

export interface Tempo {
    aggressive: boolean
    /** 铁索/酒/属性杀/连弩计划 */
    burst: number
    /** 延时控制与保留计划 */
    control: number
    /** 常规输出 */
    output: number
    /** 防具/+1 马 */
    defense: number
    /** 保留牌惩罚增量 */
    hold: number
}

export function matchTempo(
    state: GameState,
    playerId: string,
    flags: { killWindow: boolean; commanderKill: boolean },
): Tempo {
    const faction = state.players[playerId]?.faction
    const aggressive = !!faction && state.roundState?.firstMover === faction
    const commander = state.generals.find((g) => g.playerId === playerId && g.seatRole === SeatRole.COMMANDER)
    const tempo: Tempo = {
        aggressive,
        burst: aggressive ? 30 : 0,
        control: aggressive ? 15 : 20,
        output: aggressive ? 5 : -10,
        defense: aggressive ? 20 : 0,
        hold: aggressive ? 0 : 10,
    }
    if ((commander?.hp ?? 9) <= 2) {
        tempo.defense += 30
        tempo.burst -= 20
        tempo.hold += 30
    }
    if (flags.killWindow) tempo.burst += 10
    if (flags.commanderKill) {
        tempo.burst += 30
        tempo.output += 10
    }
    if (faction) {
        // 敌方出现虚弱目标就是收人窗口；己方有人虚弱则先留牌兜底
        if (state.generals.some((g) => g.alive && g.faction !== faction && isWeak(g))) tempo.burst += 6
        if (state.generals.some((g) => g.alive && g.faction === faction && isWeak(g))) tempo.defense += 6
    }
    return tempo
}

// ─────────────────────────────────────────────────────────────
// 信息修正：只用公开信息 + 自己的手牌估计牌堆密度
// ─────────────────────────────────────────────────────────────

export interface DeckInfo {
    dodgeThin: boolean
    slashThin: boolean
}

export function deckInfo(state: GameState, own: GeneralView): DeckInfo {
    const publicCards: Card[] = [...state.discard]
    for (const g of state.generals) {
        for (const slot of Object.values(EquipSlot)) {
            const card = g.equip[slot]
            if (card) publicCards.push(card)
        }
        publicCards.push(...g.judgeZone)
    }
    const visible = publicCards.length + own.hand.length
    const unseen = Math.max(1, DECK_SIZE - visible)
    const seenDodge = publicCards.filter(isDodge).length + own.hand.filter(isDodge).length
    const seenSlash = publicCards.filter(isSlash).length + own.hand.filter(isSlash).length
    const dodgeDensity = Math.max(0, KEY_CARD_COUNTS.dodge - seenDodge) / unseen
    const slashDensity = Math.max(0, KEY_CARD_COUNTS.slash - seenSlash) / unseen
    return {
        dodgeThin: dodgeDensity < (KEY_CARD_COUNTS.dodge / DECK_SIZE) * 0.8,
        slashThin: slashDensity < (KEY_CARD_COUNTS.slash / DECK_SIZE) * 0.8,
    }
}

// ─────────────────────────────────────────────────────────────
// §4 目标评分
// ─────────────────────────────────────────────────────────────

export interface TargetTerms {
    ally?: boolean
    allyRisk?: number
    chained?: boolean
    armorMatch?: boolean
    /** 这次动作直接致死的概率 0..1 */
    killChance?: number
    /** 目标还能防住这次动作的期望 0..1 */
    defense?: number
    /** 击杀边锋的人数差收益 0..1 */
    edgeGain?: number
    /** 威胁度 0..3 */
    threat?: number
}

export function targetScore(g: GeneralView, terms: TargetTerms): number {
    const isKing = g.seatRole === SeatRole.COMMANDER
    const raw =
        100 * (isKing ? 1 : 0) +
        30 * (isKing ? 0 : (terms.edgeGain ?? 0)) +
        20 * (terms.threat ?? 0) +
        12 * Math.max(0, 3 - g.hp) +
        10 * Math.max(0, 4 - g.hand.length) +
        10 * (terms.chained ? 1 : 0) +
        15 * (terms.armorMatch ? 1 : 0) +
        25 * (terms.killChance ?? 0) -
        20 * (terms.defense ?? 0) -
        30 * (terms.ally ? (terms.allyRisk ?? 1) : 0)
    return Math.max(-10, Math.min(28, raw * TARGET_SCALE))
}

/**
 * 嘲讽值（学自 QSanguosha 的 ai_chaofeng）：越能持续改变局势的武将越该先压。
 * 治疗/摸牌引擎（辅助）> 控制/核心 > 输出 > 盾将；握牌多的再加一档。
 */
const ROLE_TAUNT: Record<string, number> = {
    support: 2,
    control: 1,
    core: 1,
    damage: 0.5,
    tank: -0.5,
}

export function tauntOf(g: GeneralView): number {
    const roles = rolesOf(g.generalId)
    return roles.reduce((best, role) => Math.max(best, ROLE_TAUNT[role] ?? 0), 0)
}

/** 威胁度 0..3，供 targetScore 使用 */
export function threatLevel(g: GeneralView): number {
    const raw = 1 + tauntOf(g) + (g.hand.length >= 4 ? 1 : 0)
    return Math.max(0, Math.min(3, raw))
}

/** 虚弱（学自 QSanguosha 的 isWeak）：体力≤1，或体力≤2 且手牌≤2 */
export function isWeak(g: GeneralView): boolean {
    return g.alive && (g.hp <= 1 || (g.hp <= 2 && g.hand.length <= 2))
}

// ─────────────────────────────────────────────────────────────
// 风险 / 保留 / 组合修正
// ─────────────────────────────────────────────────────────────

/** 消耗关键牌的机会成本（作为负分使用） */
export function holdPenalty(
    card: Card,
    ctx: { peaches: number; dodges: number; danger: boolean },
): number {
    if (isPeach(card)) return ctx.peaches <= 1 && !ctx.danger ? 20 : 0
    if (isDodge(card)) return ctx.dodges <= 1 ? 12 : 4
    if (card.name === TrickCardName.NEGATE) return 20
    if (card.name === BasicCardName.WINE) return 8
    return 0
}

export interface EquipContext {
    active: GeneralView
    tempo: Tempo
    slashes: number
    reachGain: boolean
    burst: boolean
    /** 敌方有火伤威胁（火杀/火攻/朱雀羽扇） */
    enemyFire: boolean
    /** 敌方群伤与普通杀密集 */
    aoeHeavy: boolean
    /** 我方能打出火伤且敌方可能穿藤甲 */
    needFire: boolean
    targetArmor: boolean
    targetHorse: boolean
    targetBare: boolean
    targetOppositeGender: boolean
}

export function equipmentScore(card: Card, ctx: EquipContext): number {
    let score = EQUIP_BASE[card.name] ?? 30
    switch (card.name) {
        case EquipmentCardName.CROSSBOW:
            if (ctx.slashes >= 2 && (ctx.burst || ctx.reachGain)) score += 50
            break
        case EquipmentCardName.QINGGANG_SWORD:
            if (ctx.targetArmor) score += 30
            break
        case EquipmentCardName.GUDING_BLADE:
            if (ctx.targetBare) score += 30
            break
        case EquipmentCardName.DOUBLE_SWORDS:
            if (ctx.targetOppositeGender) score += 15
            break
        case EquipmentCardName.KYLIN_BOW:
            if (ctx.targetHorse) score += 15
            break
        case EquipmentCardName.ZHUQUE_FAN:
            if (ctx.needFire) score += 15
            break
        case EquipmentCardName.VINE:
            score += ctx.aoeHeavy ? 15 : 0
            score -= ctx.enemyFire ? 15 : 0
            break
        case EquipmentCardName.EIGHT_TRIGRAMS:
        case EquipmentCardName.NIOH_SHIELD:
        case EquipmentCardName.SILVER_LION:
        case EquipmentCardName.PLUS_HORSE:
            score += ctx.tempo.defense
            break
    }
    if (card.equipSlot === EquipSlot.WEAPON) {
        if (ctx.reachGain) score += 20
        if (ctx.burst) score += 30
    }
    if (card.equipSlot === EquipSlot.MINUS_HORSE && ctx.reachGain) score += 20
    return score
}

// ─────────────────────────────────────────────────────────────
// §3 无懈可击响应评分
// ─────────────────────────────────────────────────────────────

export interface NegateEvent {
    ownTrick: boolean
    allyTarget: boolean
    isCurrentlyNegated: boolean
    allyKeyDelayed: boolean
    lethalOnAlly: boolean
    allyLosingKeyCard: boolean
    mediumOnAlly: boolean
    /** 敌方手牌见底时使用无中生有/五谷 */
    enemyLowHandDraw: boolean
    enemyGreedyValue: boolean
    aoeNonLethal: boolean
    myNegates: number
    /** 己方关键延时未贴、爆发未启动、主帅低血 */
    savingNegate: boolean
}

export function negateScore(e: NegateEvent): number {
    if (e.isCurrentlyNegated) return e.ownTrick || e.allyTarget ? 95 : 0
    if (e.ownTrick) return 0
    let score = 0
    if (e.allyKeyDelayed) score = 100
    else if (e.lethalOnAlly) score = 90
    else if (e.allyLosingKeyCard) score = 75
    else if (e.mediumOnAlly) score = 70
    else if (e.enemyLowHandDraw) score = 40
    else if (e.enemyGreedyValue) score = 30
    else if (e.aoeNonLethal) score = 10
    if (score === 0) return 0
    if (e.myNegates >= 2) score += 10
    // 只剩一张无懈时留给乐/兵粮/致死一击，别为拆顺掉一张牌用掉
    if (e.savingNegate) score -= 25
    return score
}

// ─────────────────────────────────────────────────────────────
// 计划评分
// ─────────────────────────────────────────────────────────────

export interface ScoredAction {
    score: number
    plans: PlanKind[]
}

export function choosePlan(actions: ScoredAction[]): PlanKind {
    const order: PlanKind[] = ['burst', 'control', 'value', 'defense']
    let best: PlanKind = 'value'
    let bestScore = -Infinity
    for (const plan of order) {
        const scores = actions
            .filter((a) => a.plans.includes(plan))
            .map((a) => a.score)
            .sort((a, b) => b - a)
        if (scores.length === 0) continue
        const total = scores[0] + 0.85 * (scores[1] ?? 0) + 0.7 * (scores[2] ?? 0)
        if (total > bestScore) {
            bestScore = total
            best = plan
        }
    }
    return best
}
