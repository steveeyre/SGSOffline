/**
 * 记忆层：记住公开亮出过的牌，据此推测对手手牌、未知牌池密度与对手下一步行动。
 * 只用公开信息（明牌、弃牌堆、装备区、判定区、手牌数），不读取暗牌与牌堆顺序。
 */
import {
    BasicCardName, Card, CardSuit, EquipmentCardName, GameState, SeatRole, TrickCardName,
} from 'sgs3v3-shared'
import { DECK_SIZE, KEY_CARD_COUNTS } from './deck-meta'
import { getAttackRange } from './game-state'

export type GeneralView = GameState['generals'][number]
export type HandKind = 'slash' | 'dodge' | 'peach' | 'negate'

interface Remembered {
    card: Card
    ownerIndex: number
    source: string
    round: number
}

/** 一局一份记忆；state 对象在对局中就地更新，故用 WeakMap 挂靠 */
const memories = new WeakMap<GameState, Map<string, Remembered>>()

function memoryOf(state: GameState): Map<string, Remembered> {
    let map = memories.get(state)
    if (!map) {
        map = new Map()
        memories.set(state, map)
    }
    return map
}

/** 记录公开亮出的牌：火攻展示、五谷挑选、智愚/反间/裸衣亮牌等 */
export function rememberCards(state: GameState, generalIndex: number, cards: Card[], source: string): void {
    if (generalIndex < 0 || cards.length === 0) return
    const map = memoryOf(state)
    const round = state.roundState?.roundNumber ?? 0
    for (const card of cards) map.set(card.id, { card, ownerIndex: generalIndex, source, round })
}

/** 记忆里的明牌中，此刻仍在指定角色手上的那些（牌一旦离手记忆即作废） */
export function knownHand(state: GameState, generalIndex: number): Card[] {
    const map = memories.get(state)
    const g = state.generals[generalIndex]
    if (!map || !g) return []
    const ids = new Set(g.hand.map((c) => c.id))
    const out: Card[] = []
    for (const [id, rec] of [...map]) {
        if (rec.ownerIndex !== generalIndex) continue
        if (ids.has(id)) out.push(rec.card)
        else map.delete(id)
    }
    return out
}

function matches(kind: HandKind, card: Card): boolean {
    switch (kind) {
        case 'slash': return card.name === BasicCardName.ATTACK
        case 'dodge': return card.name === BasicCardName.DODGE
        case 'peach': return card.name === BasicCardName.PEACH
        case 'negate': return card.name === TrickCardName.NEGATE
    }
}

const KIND_BY_NAME: Record<string, keyof typeof KEY_CARD_COUNTS | undefined> = {
    [BasicCardName.ATTACK]: 'slash',
    [BasicCardName.DODGE]: 'dodge',
    [BasicCardName.PEACH]: 'peach',
    [BasicCardName.WINE]: 'wine',
    [TrickCardName.NEGATE]: 'negate',
    [TrickCardName.OVERINDULGENCE]: 'overindulgence',
    [TrickCardName.SUPPLY_SHORTAGE]: 'supply_shortage',
    [TrickCardName.BARBARIANS]: 'barbarians',
    [TrickCardName.ARROWS]: 'arrows',
    [TrickCardName.HARVEST]: 'harvest',
    [TrickCardName.PEACH_GARDEN]: 'peach_garden',
    [TrickCardName.DUEL]: 'duel',
    [TrickCardName.FIRE_ATTACK]: 'fire_attack',
}

export interface PoolView {
    /** 尚未被任何人看到的牌数（牌堆 + 敌方暗牌） */
    unseen: number
    /** 一张未知牌属于某类牌的概率 */
    rate: (kind: keyof typeof KEY_CARD_COUNTS) => number
    /** 某类牌还剩几张没露面 */
    left: (kind: keyof typeof KEY_CARD_COUNTS) => number
}

/**
 * 未知牌池：用弃牌堆、装备区、判定区、将牌、己方手牌和记忆中的明牌，
 * 反推“牌堆与敌方暗牌里还剩多少张杀/闪/桃/无懈”。
 */
export function poolView(state: GameState, playerId: string): PoolView {
    const faction = state.players[playerId]?.faction
    const seen: Card[] = [...state.discard]
    if (state.harvestPool) seen.push(...state.harvestPool)
    state.generals.forEach((g, index) => {
        for (const slot of Object.keys(g.equip) as (keyof typeof g.equip)[]) {
            const card = g.equip[slot]
            if (card) seen.push(card)
        }
        seen.push(...g.judgeZone)
        if (g.generalPile) seen.push(...g.generalPile)
        if (g.faction === faction) seen.push(...g.hand)
        else seen.push(...knownHand(state, index))
    })
    const unseen = Math.max(1, DECK_SIZE - seen.length)
    const counted = new Map<string, number>()
    for (const card of seen) {
        const kind = KIND_BY_NAME[card.name]
        if (kind) counted.set(kind, (counted.get(kind) ?? 0) + 1)
    }
    const left = (kind: keyof typeof KEY_CARD_COUNTS) =>
        Math.max(0, KEY_CARD_COUNTS[kind] - (counted.get(kind) ?? 0))
    return {
        unseen,
        left,
        rate: (kind) => Math.min(0.9, left(kind) / unseen),
    }
}

export interface HandGuess {
    size: number
    known: Card[]
    unknown: number
    /** 未知部分里各类牌的期望张数 */
    expected: Record<HandKind, number>
    /** 整手牌里至少有一张某类牌的概率（明牌直接算 1） */
    atLeastOne: (kind: HandKind) => number
}

/** 猜一名角色的手牌：明牌 + 未知部分按剩余牌池密度折算 */
export function guessHand(state: GameState, playerId: string, generalIndex: number): HandGuess {
    const g = state.generals[generalIndex]
    const known = knownHand(state, generalIndex)
    const size = g?.hand.length ?? 0
    const unknown = Math.max(0, size - known.length)
    const pool = poolView(state, playerId)
    const expected = {
        slash: 0,
        dodge: 0,
        peach: 0,
        negate: 0,
    } as Record<HandKind, number>
    const atLeastOne = (kind: HandKind): number => {
        if (known.some((c) => matches(kind, c))) return 1
        if (unknown <= 0) return 0
        return 1 - Math.pow(1 - pool.rate(kind), unknown)
    }
    for (const kind of ['slash', 'dodge', 'peach', 'negate'] as HandKind[]) {
        const knownCount = known.filter((c) => matches(kind, c)).length
        expected[kind] = knownCount + unknown * pool.rate(kind)
    }
    return { size, known, unknown, expected, atLeastOne }
}

/** 一名角色手里“闪得开”的概率：明牌有闪即 1，否则按未知牌密度估 */
export function handDodgeChance(state: GameState, playerId: string, generalIndex: number): number {
    return guessHand(state, playerId, generalIndex).atLeastOne('dodge')
}

// ─────────────────────────────────────────────────────────────
// 对手的后几个回合
// ─────────────────────────────────────────────────────────────

export interface EnemyTurnPlan {
    index: number
    /** 不受延时干扰时，下一回合能造成的伤害 */
    rawDamage: number
    /** 现有延时锦囊折算后的实际伤害 */
    damage: number
    /** 攻击范围能否够到我们主帅 */
    reachesCommander: boolean
    /** 本大回合还没行动（马上就要动） */
    actsThisRound: boolean
    /** 综合威胁：先贴延时、先集火都看这个值 */
    threat: number
}

/**
 * 预测敌方下一回合的行动：手里还估得出多少张杀、有没有连弩、能不能够到主帅，
 * 以及判定区里已有的乐/兵会削弱多少。连续多回合的威胁按同一套估计外推。
 */
export function predictEnemyTurn(
    state: GameState,
    playerId: string,
    index: number,
    commanderIndex: number,
): EnemyTurnPlan {
    const g = state.generals[index]
    const guess = guessHand(state, playerId, index)
    const commander = commanderIndex >= 0 ? state.generals[commanderIndex] : undefined
    const crossbow = g.equip.weapon?.name === EquipmentCardName.CROSSBOW
    const reachesCommander = !!commander &&
        getAttackRange(g, commander, state.generals).inRange
    // 对方主帅手里的闪决定我们这边挨不挨得住
    const dodge = commander ? Math.min(0.8, 0.2 + commander.hand.length * 0.12) : 0.4
    const slashCap = crossbow ? 3 : 1
    const rawDamage = reachesCommander
        ? Math.min(guess.expected.slash, slashCap) * (1 - dodge) +
            (guess.atLeastOne('slash') > 0.5 && guess.size >= 3 ? 0.3 : 0)
        : 0
    let tempoScale = 1
    if (g.judgeZone.some((c) => c.name === TrickCardName.OVERINDULGENCE)) tempoScale = 0.25
    if (g.judgeZone.some((c) => c.name === TrickCardName.SUPPLY_SHORTAGE)) tempoScale *= 0.5
    const damage = rawDamage * tempoScale
    const actsThisRound = !g.hasActed
    const threat = Math.round(
        (damage * 10 + guess.size * 1.5 + (crossbow ? 4 : 0) +
            (g.seatRole === SeatRole.COMMANDER ? 3 : 0) + (actsThisRound ? 4 : 0)) * 10,
    ) / 10
    return { index, rawDamage, damage, reachesCommander, actsThisRound, threat }
}

/** 敌方全部座位的下一回合预测，按威胁从高到低 */
export function enemyPlans(state: GameState, playerId: string): EnemyTurnPlan[] {
    const faction = state.players[playerId]?.faction
    const commanderIndex = state.generals.findIndex(
        (g) => g.alive && g.faction === faction && g.seatRole === SeatRole.COMMANDER,
    )
    return state.generals
        .map((g, index) => ({ g, index }))
        .filter(({ g }) => g.alive && g.faction !== faction)
        .map(({ index }) => predictEnemyTurn(state, playerId, index, commanderIndex))
        .sort((a, b) => b.threat - a.threat || a.index - b.index)
}

/** 我方主帅在下一轮预计要吃的伤害 */
export function incomingDamage(state: GameState, playerId: string): number {
    return enemyPlans(state, playerId).reduce((sum, plan) => sum + plan.damage, 0)
}

/** 敌方手里已知的【无懈可击】数量 */
export function knownNegates(state: GameState, playerId: string): number {
    const faction = state.players[playerId]?.faction
    return state.generals.reduce((sum, g, index) => {
        if (!g.alive || g.faction === faction) return sum
        return sum + knownHand(state, index).filter((c) => c.name === TrickCardName.NEGATE).length
    }, 0)
}

/** 记忆里某名角色明牌含有的花色集合，用于火攻这类“按花色”结算的牌 */
export function knownSuits(state: GameState, generalIndex: number): Set<CardSuit> {
    return new Set(knownHand(state, generalIndex).map((c) => c.suit))
}
