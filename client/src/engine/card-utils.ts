import { Card, CardSuit, GameState, GeneralInstance, TrickCardName } from 'sgs3v3-shared'
import { getGeneralById } from './generals'

const CARD_DISPLAY: Record<string, string> = {
    attack: '杀', fire_slash: '火杀', thunder_slash: '雷杀', dodge: '闪', peach: '桃', wine: '酒',
    draw_two: '无中生有', dismantle: '过河拆桥', steal: '顺手牵羊',
    duel: '决斗', barbarians: '南蛮入侵', arrows: '万箭齐发',
    peach_garden: '桃园结义', harvest: '五谷丰登', negate: '无懈可击',
    borrow_sword: '借刀杀人', overindulgence: '乐不思蜀',
    supply_shortage: '兵粮寸断', fire_attack: '火攻', iron_chain: '铁索连环', lightning: '闪电',
    crossbow: '连弩',
    green_dragon: '青龙偃月刀', zhangba_spear: '丈八蛇矛',
    fangtian_halberd: '方天画戟', kylin_bow: '麒麟弓',
    double_swords: '雌雄双股剑', qinggang_sword: '青釭剑',
    ice_sword: '寒冰剑', stone_axe: '贯石斧',
    guding_blade: '古锭刀', zhuque_fan: '朱雀羽扇',
    eight_trigrams: '八卦阵', nioh_shield: '仁王盾',
    vine: '藤甲', silver_lion: '白银狮子',
    plus_horse: '+1马', minus_horse: '-1马',
}

export function cardDisplayName(card: Pick<Card, 'name'>): string {
    return CARD_DISPLAY[card.name] ?? card.name
}

/** 按卡牌 name 取中文名：界面统一走这里，避免各处自建映射表漏项 */
export function cardNameOf(name: string): string {
    return CARD_DISPLAY[name] ?? name
}

export function suitSymbol(suit: CardSuit): string {
    return { spade: '♠', heart: '♥', club: '♣', diamond: '♦' }[suit] ?? suit
}

export function valueName(value: number): string {
    return { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' }[value] ?? String(value)
}

/** 完整牌名，如 "♠A【杀】" */
export function cardFullName(card: Pick<Card, 'suit' | 'value' | 'name'>): string {
    return `${suitSymbol(card.suit as CardSuit)}${valueName(card.value as number)}【${cardDisplayName(card as Pick<Card, 'name'>)}】`
}

function hasSkillId(general: GeneralInstance, skillId: string): boolean {
    const def = getGeneralById(general.generalId)
    return (def?.skills.some(s => s.id === skillId) ?? false)
        || (general.acquiredSkills?.includes(skillId) ?? false)
}

/** 能否将这张牌当【无懈可击】打出（看破 / 龙魂♠） */
export function canPlayAsNegate(general: GeneralInstance, card: Card): boolean {
    if (card.name === TrickCardName.NEGATE) return true
    if (hasSkillId(general, 'wolong_kanpo')
        && (card.suit === CardSuit.SPADE || card.suit === CardSuit.CLUB)) return true
    if (hasSkillId(general, 'shenzhaoyun_longhun') && card.suit === CardSuit.SPADE) return true
    return false
}

/** 检查所有武将中是否有人持有（或可转化出）无懈可击 */
export function anyoneHasNegate(state: GameState): boolean {
    return state.generals.some(g => g.alive && g.hand.some(c => canPlayAsNegate(g, c)))
}
