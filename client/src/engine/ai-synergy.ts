/**
 * 武将技能与联动：把“这名武将能拿这张牌做什么”“失去牌/挨打会不会反而帮他”
 * 变成可打分的修正，供出牌、给牌、选目标共用。按技能 id 判断，扩展武将时自动生效。
 */
import { BasicCardName, Card, CardCategory, CardSuit, GameState, TrickCardName } from 'sgs3v3-shared'
import { getGeneralById } from './generals'
import { synergyWeight } from './general-meta'

export type GeneralView = GameState['generals'][number]

const SLASH_NAMES: string[] = [BasicCardName.ATTACK, BasicCardName.FIRE_SLASH, BasicCardName.THUNDER_SLASH]

function skillIdsOf(g: GeneralView | undefined): string[] {
    return getGeneralById(g?.generalId ?? '')?.skills.map((s) => s.id) ?? []
}

export function hasSkillOf(g: GeneralView | undefined, id: string): boolean {
    if (!g) return false
    if (g.acquiredSkills?.includes(id)) return true
    return skillIdsOf(g).includes(id)
}

/** 这张牌在这名角色手里的边际价值 0..3：能转化、能联动、能补缺口 */
export function cardFit(g: GeneralView | undefined, card: Card | undefined): number {
    if (!g || !card) return 0
    const has = (id: string) => hasSkillOf(g, id)
    const red = card.suit === CardSuit.HEART || card.suit === CardSuit.DIAMOND
    let fit = 0
    if (SLASH_NAMES.includes(card.name)) {
        if (has('zhangfei_paoxiao') || has('guanyu_wusheng') || has('lvbu_wushuang') ||
            has('machao_tieqi') || has('machao_jie_tieqi') || has('xuchu_luoyi') ||
            has('dianwei_jie_qiangxi') || has('fuwan_moukui')) fit += 2
    }
    if (card.name === BasicCardName.DODGE) {
        if (has('zhaoyun_longdan') || has('zhenji_qingguo') || has('xiaoqiao_hongyan')) fit += 2
    }
    if (red && (has('guanyu_wusheng') || has('huatuo_jijiu'))) fit += 1
    if (!red && (has('zhenji_qingguo') || has('zhenji_luoshen'))) fit += 1
    if (card.category === CardCategory.TRICK) {
        if (has('huangyueying_jizhi') || has('xunyou_qice')) fit += 1
        if (card.name === TrickCardName.NEGATE && has('zhugeliang_kongcheng')) fit += 1
    }
    if (card.category === CardCategory.EQUIPMENT) {
        if (has('sunshangxiang_xiaoji') || has('lingtong_xuanfeng') || has('caifuren_xianzhou')) fit += 1
    }
    if (card.name === BasicCardName.PEACH) fit += 1
    return Math.min(3, fit)
}

/**
 * 花色偏好（学自 QSanguosha 的 suit_value）：某些武将留住特定花色更有价值，
 * 弃牌与给牌时把这一点算进保留价值。
 */
export function suitAffinity(g: GeneralView | undefined, card: Card): number {
    if (!g) return 0
    const has = (id: string) => hasSkillOf(g, id)
    const suit = card.suit
    const red = suit === CardSuit.HEART || suit === CardSuit.DIAMOND
    const black = suit === CardSuit.SPADE || suit === CardSuit.CLUB
    let bonus = 0
    if (red && has('huatuo_jijiu')) bonus += 8
    if (black && (has('zhenji_qingguo') || has('zhenji_luoshen'))) bonus += 6
    if (black && (has('zhangjiao_guidao') || has('zhangjiao_leiji'))) bonus += 6
    if (has('shenzhaoyun_longhun') && (suit === CardSuit.HEART || suit === CardSuit.CLUB || suit === CardSuit.SPADE)) bonus += 4
    if (black && has('ganning_qixi')) bonus += 3
    if (red && has('guanyu_wusheng')) bonus += 3
    return bonus
}

/** 失去牌 / 失去装备时的联动收益 0..3 */
export function lossBenefit(g: GeneralView | undefined): number {
    if (!g) return 0
    const has = (id: string) => hasSkillOf(g, id)
    let value = 0
    if (has('lingtong_xuanfeng')) value += 3
    if (has('sunshangxiang_xiaoji')) value += 3
    if (has('luxun_jie_lianying')) value += 2
    if (has('dengai_tuntian')) value += 2
    return Math.min(3, value)
}

/** 打他反而给他收益（卖血 / 反击），非致死时压低目标优先级 */
export function damageBackfire(g: GeneralView | undefined): number {
    if (!g) return 0
    const has = (id: string) => hasSkillOf(g, id)
    let backfire = 0
    if (has('guojia_yiji') || has('guojia_jie_yiji')) backfire += 10
    if (has('caocao_jianxiong') || has('caocao_jie_jianxiong')) backfire += 8
    if (has('simayi_fankui') || has('simayi_jie_fankui')) backfire += 8
    if (has('xiahoudun_ganglie') || has('xiahoudun_jing_ganglie')) backfire += 10
    if (has('sunce_jiang')) backfire += 4
    return backfire
}

/** 给牌对象：牌型匹配 × 配合权重 × 手牌缺口 */
export function bestGiftTarget(
    allies: { g: GeneralView; index: number }[],
    card: Card | undefined,
    giverId: string,
) {
    const value = (a: { g: GeneralView; index: number }) =>
        (card ? cardFit(a.g, card) * 3 : lossBenefit(a.g) * 2) +
        synergyWeight(giverId, a.g.generalId) +
        (a.g.hand.length === 0 ? 4 : 0) - a.g.hand.length * 0.5
    return [...allies].sort((a, b) => value(b) - value(a) || a.index - b.index)[0]
}
