import {
    Card,
    CardSuit,
    CardCategory,
    BasicCardName,
    TrickCardName,
    TrickType,
    EquipmentCardName,
    EquipSlot,
} from 'sgs3v3-shared'
import { shuffleInPlace } from './rng'

// ─────────────────────────────────────────────────────────────
// 卡牌模板工厂
// ─────────────────────────────────────────────────────────────

const S = CardSuit.SPADE
const H = CardSuit.HEART
const C = CardSuit.CLUB
const D = CardSuit.DIAMOND

let _cardId = 0
function nextId(): string { return `card_${++_cardId}` }

function basic(suit: CardSuit, value: number, name: BasicCardName): Card {
    return { id: nextId(), suit, value, category: CardCategory.BASIC, name }
}

function slash(suit: CardSuit, value: number, nature: 'normal' | 'fire' | 'thunder'): Card {
    const name = nature === 'fire'
        ? BasicCardName.FIRE_SLASH
        : nature === 'thunder'
            ? BasicCardName.THUNDER_SLASH
            : BasicCardName.ATTACK
    return { id: nextId(), suit, value, category: CardCategory.BASIC, name, nature }
}

function trick(suit: CardSuit, value: number, name: TrickCardName, type: TrickType = TrickType.INSTANT): Card {
    return { id: nextId(), suit, value, category: CardCategory.TRICK, name, trickType: type }
}

function weapon(suit: CardSuit, value: number, name: EquipmentCardName, range: number): Card {
    return { id: nextId(), suit, value, category: CardCategory.EQUIPMENT, name, equipSlot: EquipSlot.WEAPON, attackRange: range }
}

function armor(suit: CardSuit, value: number, name: EquipmentCardName): Card {
    return { id: nextId(), suit, value, category: CardCategory.EQUIPMENT, name, equipSlot: EquipSlot.ARMOR }
}

function plusHorse(suit: CardSuit, value: number): Card {
    return { id: nextId(), suit, value, category: CardCategory.EQUIPMENT, name: EquipmentCardName.PLUS_HORSE, equipSlot: EquipSlot.PLUS_HORSE }
}

function minusHorse(suit: CardSuit, value: number): Card {
    return { id: nextId(), suit, value, category: CardCategory.EQUIPMENT, name: EquipmentCardName.MINUS_HORSE, equipSlot: EquipSlot.MINUS_HORSE }
}

export type DeckType = 'tongshuai156' | 'standard108'

export const DECK_STORAGE_KEY = 'sgs3v3_deck'

/** 读取用户牌堆偏好，默认统率156 */
export function getDeckPreference(): DeckType {
    try {
        const v = typeof localStorage !== 'undefined' ? localStorage.getItem(DECK_STORAGE_KEY) : null
        return v === 'standard108' ? 'standard108' : 'tongshuai156'
    } catch {
        return 'tongshuai156'
    }
}

/** 写入用户牌堆偏好（localStorage 不可用时静默忽略） */
export function setDeckPreference(t: DeckType): void {
    try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(DECK_STORAGE_KEY, t)
    } catch {
        /* ignore */
    }
}

// ─────────────────────────────────────────────────────────────
// 156 张（军争 161 去 5 张：两张闪电、一张藤甲♠2、一张无懈♦Q、一张木牛流马）
// 基本:锦囊:装备 = 85:47:24
// ─────────────────────────────────────────────────────────────

function buildTongshuai156(): Card[] {
    _cardId = 0
    const DDG = BasicCardName.DODGE
    const PCH = BasicCardName.PEACH
    const WINE = BasicCardName.WINE
    const N = 'normal' as const
    const F = 'fire' as const
    const T = 'thunder' as const

    return [
        // ══════════════════ 基本牌 (85) ══════════════════

        // 普通杀 (30)：黑 21 红 9
        slash(S, 7, N), slash(S, 8, N), slash(S, 8, N),
        slash(S, 9, N), slash(S, 9, N), slash(S, 10, N), slash(S, 10, N),
        slash(C, 2, N), slash(C, 3, N), slash(C, 4, N), slash(C, 5, N),
        slash(C, 6, N), slash(C, 7, N), slash(C, 8, N), slash(C, 8, N),
        slash(C, 9, N), slash(C, 9, N), slash(C, 10, N), slash(C, 10, N),
        slash(C, 11, N), slash(C, 11, N),
        slash(H, 10, N), slash(H, 10, N), slash(H, 11, N),
        slash(D, 6, N), slash(D, 7, N), slash(D, 8, N),
        slash(D, 9, N), slash(D, 10, N), slash(D, 13, N),

        // 火杀 (5)：全红
        slash(H, 4, F), slash(H, 7, F), slash(H, 10, F),
        slash(D, 4, F), slash(D, 10, F),

        // 雷杀 (9)：全黑
        slash(S, 4, T), slash(S, 5, T), slash(S, 6, T), slash(S, 7, T), slash(S, 8, T),
        slash(C, 5, T), slash(C, 6, T), slash(C, 7, T), slash(C, 8, T),

        // 闪 (24)
        basic(D, 2, DDG), basic(D, 2, DDG), basic(D, 3, DDG), basic(D, 4, DDG),
        basic(D, 5, DDG), basic(D, 6, DDG), basic(D, 7, DDG), basic(D, 8, DDG),
        basic(D, 9, DDG), basic(D, 10, DDG), basic(D, 11, DDG), basic(D, 11, DDG),
        basic(H, 2, DDG), basic(H, 2, DDG), basic(H, 4, DDG), basic(H, 5, DDG),
        basic(H, 6, DDG), basic(H, 7, DDG), basic(H, 8, DDG), basic(H, 9, DDG),
        basic(H, 10, DDG), basic(H, 11, DDG), basic(H, 12, DDG), basic(H, 13, DDG),

        // 桃 (12)
        basic(H, 2, PCH), basic(H, 3, PCH), basic(H, 4, PCH), basic(H, 5, PCH),
        basic(H, 6, PCH), basic(H, 7, PCH), basic(H, 8, PCH), basic(H, 9, PCH),
        basic(H, 10, PCH), basic(H, 12, PCH), basic(D, 2, PCH), basic(D, 12, PCH),

        // 酒 (5)
        basic(D, 9, WINE), basic(C, 3, WINE), basic(C, 9, WINE),
        basic(S, 3, WINE), basic(S, 9, WINE),

        // ══════════════════ 锦囊牌 (47) ══════════════════

        // 过河拆桥 (6)
        trick(H, 12, TrickCardName.DISMANTLE),
        trick(C, 3, TrickCardName.DISMANTLE), trick(C, 4, TrickCardName.DISMANTLE),
        trick(S, 3, TrickCardName.DISMANTLE), trick(S, 4, TrickCardName.DISMANTLE),
        trick(S, 12, TrickCardName.DISMANTLE),

        // 顺手牵羊 (5)
        trick(S, 3, TrickCardName.STEAL), trick(S, 4, TrickCardName.STEAL),
        trick(S, 11, TrickCardName.STEAL),
        trick(D, 3, TrickCardName.STEAL), trick(D, 4, TrickCardName.STEAL),

        // 无中生有 (4)
        trick(H, 7, TrickCardName.DRAW_TWO), trick(H, 8, TrickCardName.DRAW_TWO),
        trick(H, 9, TrickCardName.DRAW_TWO), trick(H, 11, TrickCardName.DRAW_TWO),

        // 无懈可击 (6)
        trick(H, 1, TrickCardName.NEGATE), trick(S, 11, TrickCardName.NEGATE),
        trick(C, 12, TrickCardName.NEGATE), trick(H, 13, TrickCardName.NEGATE),
        trick(S, 13, TrickCardName.NEGATE), trick(C, 13, TrickCardName.NEGATE),

        // 南蛮入侵 (3)
        trick(S, 7, TrickCardName.BARBARIANS),
        trick(C, 7, TrickCardName.BARBARIANS), trick(C, 13, TrickCardName.BARBARIANS),

        // 决斗 (3)
        trick(D, 1, TrickCardName.DUEL), trick(S, 1, TrickCardName.DUEL),
        trick(C, 1, TrickCardName.DUEL),

        // 借刀杀人 (2)
        trick(C, 12, TrickCardName.BORROW_SWORD), trick(C, 13, TrickCardName.BORROW_SWORD),

        // 五谷丰登 (2)
        trick(H, 3, TrickCardName.HARVEST), trick(H, 4, TrickCardName.HARVEST),

        // 万箭齐发 (1)
        trick(H, 1, TrickCardName.ARROWS),

        // 桃园结义 (1)
        trick(H, 1, TrickCardName.PEACH_GARDEN),

        // 乐不思蜀 (3)
        trick(S, 6, TrickCardName.OVERINDULGENCE, TrickType.DELAYED),
        trick(C, 6, TrickCardName.OVERINDULGENCE, TrickType.DELAYED),
        trick(H, 6, TrickCardName.OVERINDULGENCE, TrickType.DELAYED),

        // 兵粮寸断 (2)
        trick(C, 4, TrickCardName.SUPPLY_SHORTAGE, TrickType.DELAYED),
        trick(S, 10, TrickCardName.SUPPLY_SHORTAGE, TrickType.DELAYED),

        // 铁索连环 (6)
        trick(C, 10, TrickCardName.IRON_CHAIN), trick(C, 11, TrickCardName.IRON_CHAIN),
        trick(C, 12, TrickCardName.IRON_CHAIN), trick(C, 13, TrickCardName.IRON_CHAIN),
        trick(S, 11, TrickCardName.IRON_CHAIN), trick(S, 12, TrickCardName.IRON_CHAIN),

        // 火攻 (3)
        trick(H, 2, TrickCardName.FIRE_ATTACK), trick(H, 3, TrickCardName.FIRE_ATTACK),
        trick(D, 12, TrickCardName.FIRE_ATTACK),

        // ══════════════════ 装备牌 (24) ══════════════════

        // 连弩 (2)
        weapon(D, 1, EquipmentCardName.CROSSBOW, 1),
        weapon(C, 1, EquipmentCardName.CROSSBOW, 1),
        // 寒冰剑♠A / 青釭剑♠2 / 雌雄双股剑♠2 / 古锭刀♠A
        weapon(S, 1, EquipmentCardName.ICE_SWORD, 2),
        weapon(S, 2, EquipmentCardName.QINGGANG_SWORD, 2),
        weapon(S, 2, EquipmentCardName.DOUBLE_SWORDS, 2),
        weapon(S, 1, EquipmentCardName.GUDING_BLADE, 2),
        // 青龙偃月刀♠5 / 贯石斧♦5 / 丈八蛇矛♠Q
        weapon(S, 5, EquipmentCardName.GREEN_DRAGON, 3),
        weapon(D, 5, EquipmentCardName.STONE_AXE, 3),
        weapon(S, 12, EquipmentCardName.ZHANGBA_SPEAR, 3),
        // 方天画戟♦Q / 朱雀羽扇♦A
        weapon(D, 12, EquipmentCardName.FANGTIAN_HALBERD, 4),
        weapon(D, 1, EquipmentCardName.ZHUQUE_FAN, 4),
        // 麒麟弓♥5
        weapon(H, 5, EquipmentCardName.KYLIN_BOW, 5),

        // 防具 (5)：八卦×2 / 仁王 / 藤甲 / 白银狮子
        armor(S, 2, EquipmentCardName.EIGHT_TRIGRAMS),
        armor(C, 2, EquipmentCardName.EIGHT_TRIGRAMS),
        armor(C, 2, EquipmentCardName.NIOH_SHIELD),
        armor(C, 2, EquipmentCardName.VINE),
        armor(C, 1, EquipmentCardName.SILVER_LION),

        // +1 马 (4)
        plusHorse(H, 13), plusHorse(C, 5), plusHorse(S, 5), plusHorse(D, 13),

        // -1 马 (3)
        minusHorse(H, 5), minusHorse(S, 13), minusHorse(D, 13),
    ]
}

// ─────────────────────────────────────────────────────────────
// 标准版 108（53:37:18 的分布，用于牌堆切换）
// ─────────────────────────────────────────────────────────────
function buildStandard108(): Card[] {
    _cardId = 0
    const ATK = BasicCardName.ATTACK
    const DDG = BasicCardName.DODGE
    const PCH = BasicCardName.PEACH
    return [
        basic(S, 7, ATK), basic(S, 8, ATK), basic(S, 8, ATK),
        basic(S, 9, ATK), basic(S, 9, ATK), basic(S, 10, ATK), basic(S, 10, ATK),
        basic(C, 2, ATK), basic(C, 3, ATK), basic(C, 4, ATK), basic(C, 5, ATK),
        basic(C, 6, ATK), basic(C, 7, ATK), basic(C, 8, ATK), basic(C, 8, ATK),
        basic(C, 9, ATK), basic(C, 9, ATK), basic(C, 10, ATK), basic(C, 10, ATK),
        basic(C, 11, ATK), basic(C, 11, ATK),
        basic(H, 10, ATK), basic(H, 10, ATK), basic(H, 11, ATK),
        basic(D, 6, ATK), basic(D, 7, ATK), basic(D, 8, ATK),
        basic(D, 9, ATK), basic(D, 10, ATK), basic(D, 13, ATK),
        basic(D, 2, DDG), basic(D, 2, DDG), basic(D, 3, DDG), basic(D, 4, DDG),
        basic(D, 5, DDG), basic(D, 6, DDG), basic(D, 7, DDG), basic(D, 8, DDG),
        basic(D, 9, DDG), basic(D, 10, DDG), basic(D, 11, DDG), basic(D, 11, DDG),
        basic(H, 2, DDG), basic(H, 2, DDG), basic(H, 13, DDG),
        basic(H, 3, PCH), basic(H, 4, PCH), basic(H, 6, PCH), basic(H, 7, PCH),
        basic(H, 8, PCH), basic(H, 9, PCH), basic(H, 12, PCH), basic(D, 12, PCH),
        trick(H, 12, TrickCardName.DISMANTLE),
        trick(C, 3, TrickCardName.DISMANTLE), trick(C, 4, TrickCardName.DISMANTLE),
        trick(S, 3, TrickCardName.DISMANTLE), trick(S, 4, TrickCardName.DISMANTLE),
        trick(S, 12, TrickCardName.DISMANTLE),
        trick(S, 3, TrickCardName.STEAL), trick(S, 4, TrickCardName.STEAL),
        trick(S, 11, TrickCardName.STEAL),
        trick(D, 3, TrickCardName.STEAL), trick(D, 4, TrickCardName.STEAL),
        trick(H, 7, TrickCardName.DRAW_TWO), trick(H, 8, TrickCardName.DRAW_TWO),
        trick(H, 9, TrickCardName.DRAW_TWO), trick(H, 11, TrickCardName.DRAW_TWO),
        trick(S, 11, TrickCardName.NEGATE),
        trick(C, 12, TrickCardName.NEGATE), trick(C, 13, TrickCardName.NEGATE),
        trick(H, 12, TrickCardName.NEGATE), trick(D, 12, TrickCardName.NEGATE),
        trick(S, 7, TrickCardName.BARBARIANS), trick(S, 13, TrickCardName.BARBARIANS),
        trick(C, 7, TrickCardName.BARBARIANS),
        trick(D, 1, TrickCardName.DUEL), trick(S, 1, TrickCardName.DUEL),
        trick(C, 1, TrickCardName.DUEL),
        trick(C, 12, TrickCardName.BORROW_SWORD), trick(C, 13, TrickCardName.BORROW_SWORD),
        trick(H, 3, TrickCardName.HARVEST), trick(H, 4, TrickCardName.HARVEST),
        trick(H, 1, TrickCardName.ARROWS),
        trick(H, 1, TrickCardName.PEACH_GARDEN),
        trick(S, 6, TrickCardName.OVERINDULGENCE, TrickType.DELAYED),
        trick(C, 6, TrickCardName.OVERINDULGENCE, TrickType.DELAYED),
        trick(H, 6, TrickCardName.OVERINDULGENCE, TrickType.DELAYED),
        trick(C, 12, TrickCardName.SUPPLY_SHORTAGE, TrickType.DELAYED),
        trick(S, 1, TrickCardName.SUPPLY_SHORTAGE, TrickType.DELAYED),
        weapon(D, 1, EquipmentCardName.CROSSBOW, 1),
        weapon(C, 1, EquipmentCardName.CROSSBOW, 1),
        weapon(S, 2, EquipmentCardName.DOUBLE_SWORDS, 2),
        weapon(S, 6, EquipmentCardName.QINGGANG_SWORD, 2),
        weapon(S, 2, EquipmentCardName.ICE_SWORD, 2),
        weapon(S, 12, EquipmentCardName.ZHANGBA_SPEAR, 3),
        weapon(S, 5, EquipmentCardName.GREEN_DRAGON, 3),
        weapon(D, 5, EquipmentCardName.STONE_AXE, 3),
        weapon(D, 12, EquipmentCardName.FANGTIAN_HALBERD, 4),
        weapon(H, 5, EquipmentCardName.KYLIN_BOW, 5),
        armor(S, 2, EquipmentCardName.EIGHT_TRIGRAMS),
        armor(C, 2, EquipmentCardName.NIOH_SHIELD),
        plusHorse(H, 13), plusHorse(C, 5), plusHorse(S, 5),
        minusHorse(H, 5), minusHorse(S, 13), minusHorse(D, 13),
    ]
}

export function createDeck(deckType: DeckType = 'tongshuai156'): Card[] {
    return deckType === 'standard108' ? buildStandard108() : buildTongshuai156()
}

/**
 * 斗地主/欢乐成双牌堆：统率三军 156 张 + 两张【闪电】（♠A / ♥Q），共 158 张。
 * 独立 id，避免与常规牌堆的牌的 id 冲突影响复现。
 */
export function createDeck158(deckType: DeckType = 'tongshuai156'): Card[] {
    const base = createDeck(deckType)
    return [
        ...base,
        { id: 'ddz_lightning_spade_a', suit: S, value: 1, category: CardCategory.TRICK, name: TrickCardName.LIGHTNING, trickType: TrickType.DELAYED },
        { id: 'ddz_lightning_heart_q', suit: H, value: 12, category: CardCategory.TRICK, name: TrickCardName.LIGHTNING, trickType: TrickType.DELAYED },
    ]
}

/** 洗牌（Fisher-Yates） */
export function shuffleDeck(deck: Card[]): Card[] {
    return shuffleInPlace([...deck])
}
