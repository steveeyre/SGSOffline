/**
 * 记忆层：记住公开亮出过的牌，据此推测对手手牌、未知牌池密度与对手下一步行动。
 * 只用公开信息（明牌、弃牌堆、装备区、判定区、手牌数），不读取暗牌与牌堆顺序。
 */
import {
    BasicCardName, Card, CardSuit, EquipmentCardName, GameState, SeatRole, TrickCardName,
} from 'sgs3v3-shared'
import { atLeastOneChance, DECK_SIZE, KEY_CARD_COUNTS } from './deck-meta'
import { getAttackRange } from './game-state'
import { handTendencyOf, type HandTendency } from './hand-tendency'

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

const CORE_KINDS: HandKind[] = ['slash', 'dodge', 'peach', 'negate']
const CORE_KIND_SET = new Set<string>(CORE_KINDS)

/** 转化牌（国色、断粮等）按原始牌名计数，否则会把方块闪误记成乐不思蜀 */
function actualName(card: Card): string {
    return card.originalName ?? card.name
}

function coreWeight(tendency: HandTendency, kind: keyof typeof KEY_CARD_COUNTS): number {
    return CORE_KIND_SET.has(kind) ? tendency[kind as HandKind] : tendency.other
}

export interface PoolView {
    /** 尚未被任何人看到的实体牌数（牌堆 + 敌方暗牌 + 未知隐藏牌） */
    unseen: number
    /** 一张未知牌属于某类牌的概率 */
    rate: (kind: keyof typeof KEY_CARD_COUNTS) => number
    /** 某类牌还剩几张没露面 */
    left: (kind: keyof typeof KEY_CARD_COUNTS) => number
    /** 已公开、按牌名可数的实体牌数（按 id 去重） */
    seenCount: number
    /** 已离开未知区域、但牌名不公开的牌数（伏兵等） */
    hiddenCount: number
    /** 弃牌堆里已使用/已弃置的关键牌数量 */
    played: (kind: HandKind) => number
}

/**
 * 未知牌池：用弃牌堆、装备区、判定区、将牌、己方手牌和记忆中的明牌，
 * 反推“牌堆与敌方暗牌里还剩多少张杀/闪/桃/无懈”。
 *
 * 同一张牌可能同时出现在弃牌堆和某个公开区域，按 id 只扣一次；
 * 伏兵/粮只公开张数、不公开牌名，因此只减少 unseen，不进入按牌名的计数。
 */
export function poolView(state: GameState, playerId: string): PoolView {
    const faction = state.players[playerId]?.faction
    const known = new Map<string, Card>()
    const hidden = new Set<string>()
    const claimed = new Set<string>()

    const addKnown = (card: Card | undefined): void => {
        if (!card || card.virtual || claimed.has(card.id)) return
        claimed.add(card.id)
        known.set(card.id, card)
    }
    const addHidden = (card: Card | undefined): void => {
        if (!card || card.virtual || claimed.has(card.id)) return
        claimed.add(card.id)
        hidden.add(card.id)
    }

    for (const card of state.discard) addKnown(card)
    for (const card of state.harvestPool ?? []) addKnown(card)

    state.generals.forEach((g, index) => {
        for (const slot of Object.keys(g.equip) as (keyof typeof g.equip)[]) {
            addKnown(g.equip[slot])
        }
        for (const card of g.judgeZone) addKnown(card)
        for (const card of g.generalPile ?? []) addKnown(card)
        addKnown(g.loyaltyCard)
        if (g.faction === faction) {
            for (const card of g.hand) addKnown(card)
        } else {
            for (const card of knownHand(state, index)) addKnown(card)
        }
        // 扣置牌只公开张数，不读牌面
        for (const entry of g.fubing ?? []) addHidden(entry.card)
        for (const card of g.liangCards ?? []) addHidden(card)
    })

    const unseen = Math.max(1, DECK_SIZE - known.size - hidden.size)
    const counted = new Map<string, number>()
    for (const card of known.values()) {
        const kind = KIND_BY_NAME[actualName(card)]
        if (kind) counted.set(kind, (counted.get(kind) ?? 0) + 1)
    }
    const left = (kind: keyof typeof KEY_CARD_COUNTS) =>
        Math.max(0, KEY_CARD_COUNTS[kind] - (counted.get(kind) ?? 0))

    const playedCounts = new Map<HandKind, number>()
    const playedIds = new Set<string>()
    for (const card of state.discard) {
        if (playedIds.has(card.id)) continue
        playedIds.add(card.id)
        const kind = KIND_BY_NAME[actualName(card)]
        if (kind === 'slash' || kind === 'dodge' || kind === 'peach' || kind === 'negate') {
            playedCounts.set(kind, (playedCounts.get(kind) ?? 0) + 1)
        }
    }

    return {
        unseen,
        left,
        rate: (kind) => Math.min(0.9, left(kind) / unseen),
        seenCount: known.size,
        hiddenCount: hidden.size,
        played: (kind) => playedCounts.get(kind) ?? 0,
    }
}

export interface HandGuess {
    size: number
    known: Card[]
    unknown: number
    /** 整手牌里各类牌的期望张数 */
    expected: Record<HandKind, number>
    /** 整手牌里至少有一张某类牌的概率（明牌直接算 1） */
    atLeastOne: (kind: HandKind) => number
    /** 关键牌名的期望张数（明牌 + 未知部分） */
    keyCardOdds: Record<keyof typeof KEY_CARD_COUNTS, number>
    /** 关键牌名至少一张的概率（明牌直接算 1） */
    atLeastOneKey: (kind: keyof typeof KEY_CARD_COUNTS) => number
    /** 明牌占手牌的比例，越高越确定 */
    knownRatio: number
    /** 估计置信度：明牌越多越确定；空手牌视为完全确定 */
    confidence: number
    /** 本次使用的留牌权重，便于复盘 */
    tendency: HandTendency
}

/**
 * 猜一名角色的手牌：明牌固定，未知部分按剩余牌池密度 × 武将留牌倾向折算。
 * 至少一张用无放回的超几何近似，而不是独立同分布。
 */
export function guessHand(state: GameState, playerId: string, generalIndex: number): HandGuess {
    const g = state.generals[generalIndex]
    const known = knownHand(state, generalIndex)
    const size = g?.hand.length ?? 0
    const unknown = Math.max(0, size - known.length)
    const pool = poolView(state, playerId)
    const tendency = handTendencyOf(g)

    const coreLeft = CORE_KINDS.reduce((sum, kind) => sum + pool.left(kind), 0)
    const otherLeft = Math.max(0, pool.unseen - coreLeft)
    const weightedCore = CORE_KINDS.reduce(
        (sum, kind) => sum + pool.left(kind) * tendency[kind], 0)
    const totalWeighted = Math.max(1, weightedCore + otherLeft * tendency.other)

    const weightedLeft = (kind: keyof typeof KEY_CARD_COUNTS): number =>
        pool.left(kind) * coreWeight(tendency, kind)
    const rateOf = (kind: keyof typeof KEY_CARD_COUNTS): number =>
        Math.min(0.95, weightedLeft(kind) / totalWeighted)
    const knownCountOf = (kind: keyof typeof KEY_CARD_COUNTS): number =>
        known.filter((c) => KIND_BY_NAME[actualName(c)] === kind).length
    const chanceOf = (kind: keyof typeof KEY_CARD_COUNTS): number => {
        if (knownCountOf(kind) > 0) return 1
        if (unknown <= 0) return 0
        const deckSize = Math.max(unknown + 1, Math.round(totalWeighted))
        const count = Math.min(
            Math.round(weightedLeft(kind)),
            Math.max(0, deckSize - 1),
        )
        return atLeastOneChance(unknown, count, deckSize)
    }

    const expected = {
        slash: 0,
        dodge: 0,
        peach: 0,
        negate: 0,
    } as Record<HandKind, number>
    for (const kind of CORE_KINDS) {
        expected[kind] = knownCountOf(kind) + unknown * rateOf(kind)
    }

    const keyCardOdds = {} as Record<keyof typeof KEY_CARD_COUNTS, number>
    for (const kind of Object.keys(KEY_CARD_COUNTS) as (keyof typeof KEY_CARD_COUNTS)[]) {
        keyCardOdds[kind] = knownCountOf(kind) + unknown * rateOf(kind)
    }

    return {
        size,
        known,
        unknown,
        expected,
        atLeastOne: (kind) => chanceOf(kind),
        keyCardOdds,
        atLeastOneKey: chanceOf,
        knownRatio: size > 0 ? known.length / size : 0,
        confidence: size > 0 ? known.length / size : 1,
        tendency,
    }
}

/** 一名角色手里“闪得开”的概率：明牌有闪即 1，否则按未知牌密度估 */
export function handDodgeChance(state: GameState, playerId: string, generalIndex: number): number {
    return guessHand(state, playerId, generalIndex).atLeastOne('dodge')
}

export type TeamSharedKind = 'peach' | 'negate'

export interface TeamResource {
    kind: TeamSharedKind
    /** 参与统计的存活队友数 */
    members: number
    /** 明牌（仍在手）里的张数 */
    known: number
    /** 全队未知手牌里的期望张数 */
    expected: number
    /** 全队至少一张的概率：任一队友有就成立，按互补概率合并 */
    atLeastOne: number
    /** 全队手牌总数 */
    hands: number
}

/**
 * 桃与无懈是全队共享资源：濒死救援、无懈响应都可由任一存活队友打出。
 * `guessHand` 只回答“这个人手里有多少”，团队决策必须看这里。
 *
 * 已使用/已弃置的桃与无懈由 `poolView` 扣减，会同时压低全队的 `expected`。
 */
export function teamResource(
    state: GameState, playerId: string, kind: TeamSharedKind,
): TeamResource {
    const faction = state.players[playerId]?.faction
    const members = state.generals
        .map((g, index) => ({ g, index }))
        .filter(({ g }) => g.alive && g.faction !== faction)

    let known = 0
    let expected = 0
    let hands = 0
    let miss = 1
    for (const { index } of members) {
        const guess = guessHand(state, playerId, index)
        known += guess.known.filter((c) => KIND_BY_NAME[actualName(c)] === kind).length
        expected += guess.expected[kind]
        hands += guess.size
        miss *= 1 - guess.atLeastOne(kind)
    }
    return { kind, members: members.length, known, expected, atLeastOne: 1 - miss, hands }
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
    // 连弩是“可额外使用 3 张杀”，即一回合最多 4 张；没有连弩时为 1 张
    const slashCap = crossbow ? 4 : 1
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
