/**
 * 预测层：一次出牌的期望结果、对手关键牌的持有概率、双方剩余行动数。
 * 全部基于公开信息（手牌数、装备、体力、日志）与牌堆比例做估计。
 */
import {
    BasicCardName, Card, CardCategory, CardSuit, EquipmentCardName, GameState, TrickCardName,
} from 'sgs3v3-shared'
import { getGeneralById } from './generals'
import { DECK_SIZE, KEY_CARD_COUNTS } from './deck-meta'
import { guessHand, knownNegates, poolView } from './ai-memory'
import { slashDamageBonus } from './general-playbook'

export type GeneralView = GameState['generals'][number]

const DODGE_RATE = KEY_CARD_COUNTS.dodge / DECK_SIZE

function hasSkill(g: GeneralView, id: string): boolean {
    if (g.acquiredSkills?.includes(id)) return true
    return !!getGeneralById(g.generalId)?.skills.some((s) => s.id === id)
}

function isBlack(card: Card): boolean {
    return card.suit === CardSuit.SPADE || card.suit === CardSuit.CLUB
}

/** n 张未知牌里至少有一张指定牌的概率 */
function atLeastOne(rate: number, count: number): number {
    if (count <= 0) return 0
    return 1 - Math.pow(1 - rate, count)
}

/** 己方全部手牌 + 本大回合还剩几次行动 */
export interface TeamView {
    slashes: number
    dodges: number
    peaches: number
    negates: number
    ourRemainingTurns: number
    enemyRemainingTurns: number
}

export function teamView(state: GameState, playerId: string): TeamView {
    const faction = state.players[playerId]?.faction
    const ours = state.generals.filter((g) => g.alive && g.faction === faction)
    const theirs = state.generals.filter((g) => g.alive && g.faction !== faction)
    const count = (pred: (c: Card) => boolean) =>
        ours.reduce((sum, g) => sum + g.hand.filter(pred).length, 0)
    return {
        slashes: count((c) => c.category === CardCategory.BASIC && c.name === BasicCardName.ATTACK),
        dodges: count((c) => c.category === CardCategory.BASIC && c.name === BasicCardName.DODGE),
        peaches: count((c) => c.category === CardCategory.BASIC && c.name === BasicCardName.PEACH),
        negates: count((c) => c.name === TrickCardName.NEGATE),
        ourRemainingTurns: ours.filter((g) => !g.hasActed).length,
        enemyRemainingTurns: theirs.filter((g) => !g.hasActed).length,
    }
}

// ─────────────────────────────────────────────────────────────
// 单张牌的后果
// ─────────────────────────────────────────────────────────────

export interface SlashPrediction {
    dodgeChance: number
    hitChance: number
    expectedDamage: number
    killChance: number
}

/**
 * 一次【杀】的期望结果：手牌里凑出【闪】的概率 + 防具 + 不可闪避。
 * 青釭剑无视防具由调用方传 ignoresArmor。
 */
export function predictSlash(
    target: GeneralView,
    slash: Card,
    opts: { damage?: number; ignoresArmor?: boolean; cannotDodge?: boolean; dodgeChance?: number } = {},
): SlashPrediction {
    const damage = opts.damage ?? 1
    // dodgeChance 由记忆层给出：明牌里有闪就是 1，其余按剩余牌池密度估
    let dodge = opts.cannotDodge ? 0 : (opts.dodgeChance ?? atLeastOne(DODGE_RATE, target.hand.length))
    const armor = target.equip.armor?.name
    if (!opts.ignoresArmor && !opts.cannotDodge) {
        if (armor === EquipmentCardName.NIOH_SHIELD && isBlack(slash)) dodge = 1
        else if (armor === EquipmentCardName.VINE && slash.name === BasicCardName.ATTACK) dodge = 1
        else if (armor === EquipmentCardName.EIGHT_TRIGRAMS) dodge = dodge + (1 - dodge) * 0.5
    }
    const hitChance = Math.max(0, Math.min(1, 1 - dodge))
    return {
        dodgeChance: dodge,
        hitChance,
        expectedDamage: hitChance * damage,
        killChance: target.hp <= damage ? hitChance : 0,
    }
}

/** 决斗：按双方可动用的【杀】估计胜负（对手手里已知的杀直接算数） */
export function predictDuel(
    state: GameState, playerId: string, ourSlashes: number, target: GeneralView,
): { winChance: number; expectedDamage: number } {
    const theirs = guessHand(state, playerId, state.generals.indexOf(target)).expected.slash
    const margin = ourSlashes - theirs
    const winChance = margin >= 2 ? 0.92 : margin >= 1 ? 0.78 : margin >= 0.5 ? 0.6 : margin >= 0 ? 0.45 : 0.2
    return { winChance, expectedDamage: winChance }
}

export interface AoePrediction {
    enemyLoss: number
    allyLoss: number
    net: number
}

/** 南蛮入侵 / 万箭齐发：双方各自的期望掉血（藤甲免疫，按手牌估计能否响应） */
export function predictAoe(state: GameState, playerId: string, kind: 'barbarians' | 'arrows'): AoePrediction {
    const faction = state.players[playerId]?.faction
    const answerKind = kind === 'barbarians' ? 'slash' : 'dodge'
    let enemyLoss = 0
    let allyLoss = 0
    state.generals.forEach((g, index) => {
        if (!g.alive) return
        if (g.equip.armor?.name === EquipmentCardName.VINE) return
        // 己方手牌本就是明的，敌方用记忆层折算：明牌有杀/闪就一定挡得住
        const answer = guessHand(state, playerId, index).atLeastOne(answerKind)
        const loss = 1 - answer
        if (g.faction === faction) allyLoss += loss
        else enemyLoss += loss
    })
    return { enemyLoss, allyLoss, net: enemyLoss - allyLoss }
}

/**
 * 延时锦囊真正生效的概率：判定花色会解除，且对方有改判将时更容易被改掉。
 * 乐不思蜀判定♥解除，兵粮寸断判定♣解除，基础概率都按 25% 估。
 */
export function delayedSuccessChance(state: GameState, target: GeneralView): number {
    const escapeRate = 0.25
    const helpers = judgeHelpers(state, target.faction).length
    const escape = Math.min(0.95, escapeRate + helpers * 0.2)
    return 1 - escape
}

/**
 * 敌方还有【无懈可击】的概率（按已打出的无懈与手牌数估计）。
 */
export function negateRisk(state: GameState, playerId: string): number {
    const faction = state.players[playerId]?.faction
    const enemies = state.generals.filter((g) => g.alive && g.faction !== faction)
    if (enemies.length === 0) return 0
    // 明牌里已经看到无懈，就不必再估了
    if (knownNegates(state, playerId) > 0) return 1
    // 已打出的无懈在弃牌堆里，poolView 已经把它从剩余张数里扣掉
    const remaining = poolView(state, playerId).left('negate')
    const hands = enemies.reduce((sum, g) => sum + g.hand.length, 0)
    return Math.min(1, atLeastOne(remaining / DECK_SIZE, hands))
}

// ─────────────────────────────────────────────────────────────
// 留【闪】的权衡
// ─────────────────────────────────────────────────────────────

/** 留闪的收益拆项，供审计与自对弈解释用 */
export interface DodgeHoldValue {
    /** 这一刀硬吃会掉多少体力 */
    currentDamage: number
    /** 之后还可能吃到的那一刀有多痛（已含酒等加成） */
    futureDamage: number
    /** 之后那一刀真的会打过来的概率 0..1 */
    futureRisk: number
    /** 这一刀命中是否附带额外负面（弃牌、弃坐骑等） */
    extraLoss: boolean
    /** 留闪是否值得：true 表示宁可吃这一下也要留住闪 */
    hold: boolean
    /** 结论来源，写进日志便于复核 */
    reason: string
}

/** 一次【杀】命中时，除掉血外还会带走的牌数 */
function slashExtraLoss(attacker: GeneralView | undefined, target: GeneralView): number {
    if (!attacker) return 0
    const weapon = attacker.equip.weapon?.name
    // 寒冰剑：弃 2 张牌且不造伤
    if (weapon === EquipmentCardName.ICE_SWORD) {
        return Math.min(2, target.hand.length + Object.values(target.equip).filter(Boolean).length)
    }
    // 麒麟弓：拆坐骑
    if (weapon === EquipmentCardName.KYLIN_BOW) {
        return (target.equip.plus_horse ? 1 : 0) + (target.equip.minus_horse ? 1 : 0)
    }
    return 0
}

/**
 * 该不该留住【闪】、硬吃这一刀。
 *
 *  1. 这一刀自身已经很痛（酒杀/忠义/裸衣等加成），或命中附带额外牌差 ⇒ 必须闪。
 *  2. 这一刀只是普通 1 点，但对方还捏着【酒】或本回合还能再出【杀】，
 *     且我方体力够厚 ⇒ 留闪，把闪留给更痛的那一刀。
 *  3. 这一刀或下一刀直接致命 ⇒ 眼前这一刀必须处理，不能为了留闪送命。
 */
export function dodgeHoldValue(
    state: GameState,
    playerId: string,
    targetIndex: number,
    attackerIndex: number,
): DodgeHoldValue {
    const target = state.generals[targetIndex]
    const attacker = attackerIndex >= 0 ? state.generals[attackerIndex] : undefined
    const current = slashDamageBonus(state, attacker, target, 'current')
    const currentDamage = 1 + current.amount
    const extraCards = slashExtraLoss(attacker, target)
    const extraLoss = extraCards > 0

    // 之后那一刀：先确认对手**真的能**再打出一刀，再谈那一刀有多痛
    const future = slashDamageBonus(state, attacker, target, 'future')
    let futureDamage = 1 + future.amount
    let futureRisk = 0
    if (attacker) {
        const guess = guessHand(state, playerId, attackerIndex)
        const crossbow = attacker.equip.weapon?.name === EquipmentCardName.CROSSBOW
        // 一回合一张杀是常态；要再出第二刀得有硬证据：连弩、咆哮，或明牌的【酒】
        const multiSlash = crossbow || hasSkill(attacker, 'zhangfei_paoxiao')
        const knownWine = guess.known.some((c) => c.name === BasicCardName.WINE)
        // 酒杀要花「酒 + 杀」两张牌，手里还得有余牌撑住这个消耗
        const spare = attacker.hand.length >= 2
        if (spare && (knownWine || multiSlash)) futureDamage += 1

        if (multiSlash) futureRisk += 0.6
        if (knownWine) futureRisk += 0.4
        // 既没有连弩也没有明牌酒时，“也许会有”不足以拿体力去赌
        if (!multiSlash && !knownWine) {
            futureRisk += Math.max(0, guess.atLeastOne('slash') - 0.5) * 0.4
        }
        futureRisk = Math.min(1, futureRisk)
    }

    const lethalNow = target.hp <= currentDamage
    const lethalFuture = target.hp <= futureDamage

    let hold = false
    let reason = ''
    if (lethalNow) {
        reason = '这一刀直接致死，不能省闪'
    } else if (currentDamage >= 2 || extraLoss) {
        const bits: string[] = []
        if (currentDamage >= 2) bits.push(`${currentDamage} 点伤害（${current.reasons.join('+')}）`)
        if (extraLoss) bits.push(`附带 ${extraCards} 张牌差`)
        reason = `这一刀已很重：${bits.join('，')}，闪出去更划算`
    } else if (lethalFuture) {
        reason = `之后那一刀 ${futureDamage} 点会直接致死，闪也挡不住，先把眼前扛过去`
    } else if (futureRisk >= 0.5 && futureDamage >= 2 && target.hp >= 3) {
        reason = `留闪：之后有 ${(futureRisk * 100).toFixed(0)}% 概率吃到 ${futureDamage} 点的一刀，` +
            '现在只掉 1 点还能扛'
        hold = true
    } else {
        reason = '普通一刀，正常出闪'
    }

    return { currentDamage, futureDamage, futureRisk, extraLoss, hold, reason }
}

/** 判定系武将（鬼才 / 鬼道 / 缓释）是否在指定阵营里 */
export function judgeHelpers(state: GameState, faction: string | undefined): GeneralView[] {
    return state.generals.filter((g) => g.alive && g.faction === faction && g.hand.length > 0 &&
        (hasSkill(g, 'simayi_guicai') || hasSkill(g, 'simayi_jie_guicai') ||
            hasSkill(g, 'zhangjiao_guidao') || hasSkill(g, 'zhugejin_huanshi')))
}
