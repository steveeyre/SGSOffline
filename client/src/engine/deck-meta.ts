/**
 * 统率三军 156 张牌堆的常见比例（社区统计），供 AI 估计“未知牌里有什么”。
 * 只做概率估计，不读取牌堆内容：AI 仍然不知道牌堆顺序。
 */
export const DECK_SIZE = 156

export const KEY_CARD_COUNTS = {
    slash: 44,
    dodge: 24,
    wine: 5,
    peach: 12,
    negate: 6,
    overindulgence: 3,
    supply_shortage: 2,
    crossbow: 2,
    barbarians: 3,
    arrows: 1,
    harvest: 2,
    peach_garden: 1,
    duel: 3,
    fire_attack: 3,
} as const

/** 从 n 张未知牌里至少摸到一张指定牌的概率（不放回抽样） */
export function atLeastOneChance(draws: number, count: number, deckSize = DECK_SIZE): number {
    if (draws <= 0 || count <= 0) return 0
    let miss = 1
    for (let i = 0; i < draws; i++) {
        miss *= Math.max(0, deckSize - count - i) / Math.max(1, deckSize - i)
    }
    return 1 - miss
}

/** 对方 n 张手牌时，期望能拿出多少张【杀】 */
export function expectedSlashes(handSize: number, deckSize = DECK_SIZE): number {
    return (handSize * KEY_CARD_COUNTS.slash) / deckSize
}

/** 对方 n 张手牌时，期望能拿出多少张【闪】 */
export function expectedDodges(handSize: number, deckSize = DECK_SIZE): number {
    return (handSize * KEY_CARD_COUNTS.dodge) / deckSize
}
