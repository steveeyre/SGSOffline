/**
 * 角色嘲讽向量：主动能力 / 被动能力 / 健康状态 / 身份。
 *
 * 不再把“嘲讽”压成一个由定位推出来的单值，而是分别估计：
 *  - active：放任不管时，这名角色能持续制造的收益（伤害、牌差、控制、回复）；
 *  - passive：攻击他时，他会反过来带来的收益（卖血、反击、防御、让敌人无法集火），
 *    以 0 为“无防御”、负值表示防御强度；
 *  - health：当前体力、手牌 + 装备、距离、防具构成的生存状态；
 *  - identity：主帅/地主这类直接决定胜负的特殊身份。
 *
 * 目标排序时用 tauntScore 把前三维压成一个标量，identity 单独计价。
 */
import {
    EquipmentCardName, GameState, SeatRole, SkillType, TrickCardName,
} from 'sgs3v3-shared'
import { getAttackRange } from './game-state'
import { getGeneralById } from './generals'
import { synergyWeight } from './general-meta'

export type GeneralView = GameState['generals'][number]

export interface TauntPreset {
    /** 主动能力基础值 0..100 */
    active: number
    /** 被动能力基础值 -100..0；0 为无防御，越负表示越难啃 */
    passive: number
    /** 每多一张手牌，主动能力增加多少（百分制；用牌型武将更高） */
    hand: number
    /** 觉醒后的主动能力增量，默认 15 */
    awaken?: number
}

export interface TauntVector {
    /** 0..100 */
    active: number
    /** -100..0 */
    passive: number
    /** 0..100 */
    health: number
    /** 0..100 */
    identity: number
}

const DEFAULT_AWAKEN = 15

const clamp = (v: number, min: number, max: number): number =>
    Math.max(min, Math.min(max, v))

/**
 * 每名武将的基础预设。数值为体验向估计，不是官方数据；
 * 主动/被动只描述“技能本身”，手牌、判定区、翻面、觉醒、连携等由下面的函数动态修正。
 */
export const GENERAL_TAUNT: Record<string, TauntPreset> = {
    caocao: { active: 30, passive: -80, hand: 3 },
    simayi: { active: 40, passive: -80, hand: 3 },
    zhangliao: { active: 70, passive: 0, hand: 5 },
    guojia: { active: 25, passive: -90, hand: 2 },
    zhenji: { active: 65, passive: -45, hand: 6 },
    xiahouyuan: { active: 70, passive: 0, hand: 4 },
    xuhuang_jing: { active: 70, passive: 0, hand: 5 },
    xiahoudun: { active: 25, passive: -95, hand: 1 },
    xiahoudun_jing: { active: 35, passive: -85, hand: 2 },
    wenpin: { active: 40, passive: -70, hand: 3 },
    wenpin_jing: { active: 40, passive: -70, hand: 3 },
    liubei: { active: 70, passive: -40, hand: 5 },
    liubei_jie: { active: 70, passive: -40, hand: 5 },
    guanyu: { active: 75, passive: 0, hand: 5 },
    zhangfei: { active: 80, passive: 0, hand: 7 },
    zhugeliang: { active: 65, passive: -35, hand: 5 },
    zhaoyun_jing: { active: 75, passive: -50, hand: 4 },
    machao: { active: 75, passive: 0, hand: 3 },
    huangyueying: { active: 80, passive: 0, hand: 6 },
    jiangwei: { active: 70, passive: 0, hand: 6 },
    jiangwei_jie: { active: 70, passive: 0, hand: 6 },
    sunquan: { active: 80, passive: 0, hand: 8 },
    sunquan_jie: { active: 82, passive: 0, hand: 8 },
    ganning: { active: 70, passive: 0, hand: 4 },
    huanggai: { active: 70, passive: 0, hand: 4 },
    zhouyu: { active: 75, passive: 0, hand: 5 },
    daqiao: { active: 70, passive: -40, hand: 4 },
    sunshangxiang: { active: 70, passive: 0, hand: 5 },
    sunjian: { active: 70, passive: 0, hand: 4 },
    xiaoqiao: { active: 40, passive: -75, hand: 4 },
    sunce: { active: 65, passive: -50, hand: 5 },
    zhugejin: { active: 60, passive: 0, hand: 4 },
    huatuo: { active: 80, passive: -20, hand: 5 },
    lvbu: { active: 40, passive: 0, hand: 3 },
    diaochan: { active: 70, passive: 0, hand: 3 },
    pangde: { active: 75, passive: 0, hand: 3 },
    jiaxu: { active: 70, passive: -40, hand: 4 },
    chengong: { active: 65, passive: -30, hand: 4 },
    jushou: { active: 65, passive: -35, hand: 4 },
    fuwan: { active: 65, passive: 0, hand: 4 },
    zhangjiao: { active: 70, passive: -35, hand: 4 },
    zhangjiao_jie: { active: 80, passive: -50, hand: 4 },
    lidian_jie: { active: 65, passive: -25, hand: 3 },
    simayi_jing: { active: 45, passive: -80, hand: 3 },
    xuchu_jie: { active: 80, passive: 0, hand: 2 },
    dengai: { active: 70, passive: 0, hand: 7 },
    xunyou: { active: 75, passive: -35, hand: 6 },
    wangyi: { active: 65, passive: -50, hand: 4 },
    wangji: { active: 70, passive: 0, hand: 6 },
    yuejin: { active: 70, passive: 0, hand: 3 },
    simalang: { active: 60, passive: 0, hand: 3 },
    litong: { active: 70, passive: -30, hand: 4 },
    caocao_jie: { active: 35, passive: -85, hand: 3 },
    dianwei_jie: { active: 75, passive: -35, hand: 3 },
    machao_jie: { active: 80, passive: 0, hand: 3 },
    madai: { active: 70, passive: 0, hand: 3 },
    sunshangxiang_sp: { active: 60, passive: 0, hand: 3 },
    zhoucang: { active: 70, passive: 0, hand: 4 },
    dongyun: { active: 60, passive: -40, hand: 4 },
    yanyan: { active: 70, passive: -40, hand: 3 },
    wangping: { active: 65, passive: 0, hand: 4 },
    huangquan_jing: { active: 60, passive: 0, hand: 4 },
    sunqian: { active: 60, passive: 0, hand: 3 },
    sunqian_jie: { active: 65, passive: 0, hand: 3 },
    lingtong: { active: 70, passive: -45, hand: 5 },
    ganning_jie: { active: 75, passive: 0, hand: 4 },
    zhouyu_jie: { active: 80, passive: 0, hand: 5 },
    luxun_jie: { active: 75, passive: -40, hand: 6 },
    guyong: { active: 65, passive: 0, hand: 6 },
    guyong_jie: { active: 65, passive: 0, hand: 6 },
    dingfeng: { active: 75, passive: 0, hand: 4 },
    yufan: { active: 65, passive: 0, hand: 4 },
    yufan_jie: { active: 65, passive: 0, hand: 4 },
    zumao: { active: 40, passive: -65, hand: 2 },
    zhugeke: { active: 75, passive: -30, hand: 4 },
    lingcao: { active: 70, passive: 0, hand: 5 },
    caifuren: { active: 60, passive: 0, hand: 4 },
    lvbu_jing: { active: 40, passive: 0, hand: 3 },
    liuchen: { active: 70, passive: 0, hand: 3 },
    huaxiong_jie: { active: 60, passive: -60, hand: 3 },
    weiyan: { active: 75, passive: 0, hand: 4 },
    luji: { active: 50, passive: -48, hand: 2 },
    haozhao: { active: 60, passive: 0, hand: 4 },
    xuyou: { active: 80, passive: 0, hand: 8 },
    handang: { active: 70, passive: 0, hand: 5 },
    fazheng: { active: 65, passive: -50, hand: 4 },
    masu: { active: 65, passive: 0, hand: 4 },
    zhongyao: { active: 70, passive: 0, hand: 6 },
    chengpu: { active: 65, passive: -25, hand: 3 },
    cenhun: { active: 60, passive: 0, hand: 5 },
    sundeng: { active: 60, passive: 0, hand: 3 },
    guotu: { active: 65, passive: -35, hand: 5 },
    xiahoushi: { active: 65, passive: 0, hand: 3 },
    gongsunyuan: { active: 65, passive: 0, hand: 3 },
    quancong: { active: 60, passive: -33, hand: 3 },
    xiahouyuan_jie: { active: 75, passive: 0, hand: 4 },
    caoren: { active: 45, passive: -80, hand: 3 },
    caoren_sp: { active: 45, passive: -75, hand: 3 },
    guanyinping: { active: 70, passive: 0, hand: 5 },
    chenqun: { active: 60, passive: 0, hand: 6 },
    xunyu: { active: 68, passive: -28, hand: 3 },
    zhurong_jie: { active: 65, passive: 0, hand: 3 },
    liushan: { active: 50, passive: -30, hand: 3 },
    zhangzhaozhanghong_jie: { active: 60, passive: 0, hand: 3 },
    dongzhuo: { active: 50, passive: 0, hand: 3 },
    pangtong: { active: 65, passive: -40, hand: 4 },
    yanliangwenchou_jie: { active: 75, passive: 0, hand: 4 },
    wolong: { active: 70, passive: -40, hand: 5 },
    zhoufei: { active: 60, passive: 0, hand: 5 },
    lusu_jie: { active: 95, passive: 0, hand: 9 },
    bulianshi_jie: { active: 60, passive: 0, hand: 5 },
    kuailiangkuaiyue: { active: 65, passive: -35, hand: 5 },
    gaoshun_jie: { active: 80, passive: 0, hand: 3 },
    zhoufang: { active: 65, passive: 0, hand: 4 },
    zhugeliang_jie: { active: 70, passive: -45, hand: 5 },
    sunjian_jie: { active: 75, passive: -45, hand: 4 },
    sunce_jie: { active: 70, passive: -50, hand: 5 },
    guojia_jie: { active: 30, passive: -90, hand: 2 },
    huatuo_jie: { active: 85, passive: -20, hand: 6 },
    diaochan_jie: { active: 75, passive: 0, hand: 3 },
    xuhuang_jie: { active: 75, passive: 0, hand: 5 },
    huangyueying_jie: { active: 85, passive: 0, hand: 7 },
    zhangliao_jie: { active: 75, passive: 0, hand: 5 },
    zhenji_jie: { active: 70, passive: -45, hand: 6 },
    huanggai_jie: { active: 70, passive: 0, hand: 4 },
    pangde_jie: { active: 80, passive: 0, hand: 3 },
    jiaxu_jie: { active: 75, passive: -40, hand: 4 },
    chengong_jie: { active: 70, passive: -30, hand: 4 },
    sunshangxiang_jie: { active: 75, passive: 0, hand: 5 },
    xuezong: { active: 65, passive: 0, hand: 5 },
    jiangqin: { active: 60, passive: 0, hand: 5 },
    zhoucang_jie: { active: 65, passive: 0, hand: 4 },
    daqiao_jie: { active: 75, passive: -40, hand: 4 },
    chengpu_jie: { active: 65, passive: -25, hand: 3 },
    caifuren_jie: { active: 65, passive: 0, hand: 4 },
    caoxiu_jie: { active: 75, passive: 0, hand: 4 },
    wangyi_jie: { active: 50, passive: -50, hand: 2 },
    zhangfei_jie: { active: 85, passive: 0, hand: 7 },
    taishici_jie: { active: 65, passive: 0, hand: 3 },
    guohuai_jie: { active: 60, passive: 0, hand: 5 },
    sunxiu: { active: 60, passive: 0, hand: 3 },
    zhuhuan: { active: 70, passive: 0, hand: 4 },
    huangzhong_jie: { active: 75, passive: 0, hand: 4 },
    zhuzhi: { active: 60, passive: -50, hand: 4 },
    zhugezhan: { active: 65, passive: -35, hand: 4 },
    zhangxiu: { active: 75, passive: 0, hand: 3 },
    liru: { active: 70, passive: 0, hand: 3 },
    lisu: { active: 45, passive: 0, hand: 3 },
    xujing: { active: 60, passive: 0, hand: 4 },
    quyi: { active: 70, passive: 0, hand: 3 },
    zhonghui_jie: { active: 70, passive: -50, hand: 6 },
    zhangchunhua_jie: { active: 70, passive: -40, hand: 5 },
    caozhang_jie: { active: 70, passive: 0, hand: 4 },
    zhangsong_jie: { active: 65, passive: 0, hand: 6 },
    fuhuanghou_jie: { active: 60, passive: -60, hand: 4 },
    zhuran_jie: { active: 70, passive: -40, hand: 5 },
    caochong_jie: { active: 45, passive: -75, hand: 3 },
    mizhu: { active: 60, passive: -40, hand: 6 },
    caorui: { active: 60, passive: -45, hand: 5 },
    liufeng: { active: 65, passive: 0, hand: 4 },
    zhanghe: { active: 75, passive: 0, hand: 7 },
    guanqiujian: { active: 65, passive: 0, hand: 4 },
    hanhaosihuan: { active: 65, passive: 0, hand: 4 },
    shenzhaoyun: { active: 75, passive: -85, hand: 6 },
    shanzhaoyun: { active: 70, passive: -75, hand: 6 },
    caoang: { active: 60, passive: -70, hand: 4 },
    qinmi: { active: 60, passive: -60, hand: 4 },
    kanze: { active: 60, passive: -40, hand: 5 },
    zhanghulelin: { active: 65, passive: 0, hand: 5 },
    chenlin: { active: 70, passive: 0, hand: 5 },
    hetaihou: { active: 60, passive: 0, hand: 4 },
    sunluyu: { active: 60, passive: -60, hand: 4 },
    shamoke: { active: 75, passive: 0, hand: 8 },
    caochun: { active: 75, passive: 0, hand: 3 },
    caiwenji_sp: { active: 50, passive: -70, hand: 4 },
    shenlusu: { active: 90, passive: 0, hand: 9 },
    sunchen: { active: 70, passive: 0, hand: 5 },
    peixiu: { active: 65, passive: 0, hand: 5 },
    panjun: { active: 60, passive: -45, hand: 4 },
    lingju: { active: 65, passive: 0, hand: 4 },
    baoxin: { active: 60, passive: -50, hand: 4 },
    chengyu: { active: 55, passive: -70, hand: 4 },
    xizhicai: { active: 55, passive: -80, hand: 4 },
    liuxie: { active: 50, passive: -50, hand: 4 },
    lifeng: { active: 50, passive: 0, hand: 4 },
}

const FALLBACK_PRESET: TauntPreset = { active: 60, passive: 0, hand: 3 }

export function tauntPresetOf(generalId: string): TauntPreset {
    return GENERAL_TAUNT[generalId] ?? FALLBACK_PRESET
}

function skillsOf(g: GeneralView) {
    return getGeneralById(g.generalId)?.skills ?? []
}

/** 存活队友带来的技能连携增幅，封顶 25 */
function allySynergy(state: GameState, g: GeneralView): number {
    let sum = 0
    for (const ally of state.generals) {
        if (ally === g || !ally.alive || ally.faction !== g.faction) continue
        sum += synergyWeight(g.generalId, ally.generalId)
    }
    return Math.min(25, sum * 1.2)
}

/** 觉醒条件是否已经接近完成；不同武将的触发条件不同，不能用统一的血线代替 */
function awakeningReady(state: GameState, g: GeneralView): boolean {
    const skills = skillsOf(g)
    if (!skills.some((s) => s.type === SkillType.AWAKENED)) return false
    const has = (id: string) => skills.some((s) => s.id === id)
    if (has('jiangwei_zhiji')) return g.hand.length === 0
    if (has('sunce_hunzi') || has('sunce_jie_hunzi')) return g.hp === 1
    if (has('dengai_zaoxian')) return (g.generalPile?.length ?? 0) >= 2
    if (has('sp_sunshangxiang_fanxiang')) {
        return state.generals.some((a) => a.alive && a.hp < a.maxHp &&
            (g.liangzhuHelped ?? []).includes(a.generalId))
    }
    if (has('lvbu_jing_zhanshen')) {
        return g.hp < g.maxHp && state.generals.some((a) => !a.alive && a.faction === g.faction)
    }
    if (has('guanyinping_wuji')) return (g.damageDealtThisTurn ?? 0) >= 2
    if (has('zhonghui_zili')) return (g.generalPile?.length ?? 0) >= 2
    if (has('guanqiujian_hongju')) return (g.generalPile?.length ?? 0) >= 2
    return g.hp <= 2
}

/** 主动能力：放任不管时能持续制造的收益 */
export function activeAbility(state: GameState, g: GeneralView): number {
    const preset = tauntPresetOf(g.generalId)
    let active = preset.active

    // 用牌能力强的武将，手牌越多越能发挥；1 张是基准，不奖励空手
    active += Math.min(35, preset.hand * Math.max(0, g.hand.length - 2))

    // 乐不思蜀直接废掉出牌阶段，兵粮寸断只削摸牌
    if (g.judgeZone.some((c) => c.name === TrickCardName.OVERINDULGENCE)) active -= 25
    if (g.judgeZone.some((c) => c.name === TrickCardName.SUPPLY_SHORTAGE)) active -= 15
    if (g.flipped) active -= 35

    // 限定技用掉后，持续收益下降；按剩余限定技比例折算
    const limited = skillsOf(g).filter((s) => s.type === SkillType.LIMITED)
    if (limited.length > 0) {
        const used = limited.filter((s) => g.usedLimitedSkills.includes(s.id)).length
        active -= 20 * (used / limited.length)
    }

    // 觉醒后能力提升；尚未觉醒但条件已经接近时，对手会更急着处理
    const awakening = skillsOf(g).find((s) => s.type === SkillType.AWAKENED)
    if (awakening) {
        if (g.awakened) active += preset.awaken ?? DEFAULT_AWAKEN
        else if (awakeningReady(state, g)) active += 10
    }

    active += allySynergy(state, g)
    return Math.round(clamp(active, 0, 100))
}

/** 被动能力：攻击他时，他会反过来带来的收益；越负越不该先碰 */
export function passiveAbility(state: GameState, g: GeneralView): number {
    const preset = tauntPresetOf(g.generalId)
    // 连携让小乔+郭嘉这类组合更难啃，因此继续向负方向叠加
    return Math.round(clamp(preset.passive - allySynergy(state, g) * 0.7, -100, 0))
}

/** 健康状态：体力、手牌 + 装备、距离、防具；越高越难啃 */
export function healthState(state: GameState, g: GeneralView): number {
    const commander = g.seatRole === SeatRole.COMMANDER
    const hpPart = (commander ? 60 : 45) * (g.hp / Math.max(1, g.maxHp))
    const cards = g.hand.length + Object.values(g.equip).filter(Boolean).length
    const cardPart = Math.min(25, cards * 3.5)

    const armor = g.equip.armor?.name
    const armorPart = armor === EquipmentCardName.EIGHT_TRIGRAMS ? 18
        : armor === EquipmentCardName.NIOH_SHIELD ? 15
            : armor === EquipmentCardName.VINE ? 14
                : armor ? 12 : 0
    const horsePart = (g.equip.plus_horse ? 6 : 0) + (g.equip.minus_horse ? 3 : 0)

    let distPart = 0
    let reachPart = 0
    const enemies = state.generals.filter((e) => e.alive && e.faction !== g.faction)
    if (enemies.length > 0) {
        const ranges = enemies.map((e) => getAttackRange(e, g, state.generals))
        const minDistance = Math.min(...ranges.map((r) => r.distance))
        distPart = Math.min(20, Math.max(0, minDistance - 1) * 7)
        if (ranges.every((r) => !r.inRange)) reachPart = 15
    }

    return Math.round(clamp(hpPart + cardPart + armorPart + horsePart + distPart + reachPart, 0, 100))
}

/** 身份：主帅/地主直接决定胜负，单独视为最高一档 */
export function identityValue(g: GeneralView): number {
    return g.seatRole === SeatRole.COMMANDER ? 100 : 0
}

export function tauntVector(state: GameState, g: GeneralView): TauntVector {
    return {
        active: activeAbility(state, g),
        passive: passiveAbility(state, g),
        health: healthState(state, g),
        identity: identityValue(g),
    }
}

/**
 * 把前三维压成目标排序用的标量：
 * 主动能力越高越该先压；被动惩罚越重、健康状态越好越该绕开。
 * identity 由调用方单独按主帅价值计价，避免重复。
 */
export function tauntScore(v: TauntVector): number {
    return Math.round(v.active + v.passive * 0.65 - v.health * 0.45)
}

export function tauntOf(state: GameState, g: GeneralView): number {
    return tauntScore(tauntVector(state, g))
}

/** 威胁度 0..3，供 targetScore 使用；主动能力和身份拉高，健康状态压低 */
export function threatLevel(state: GameState, g: GeneralView): number {
    const v = tauntVector(state, g)
    return Math.round(clamp(1 + v.active * 0.018 - v.health * 0.008 + v.identity * 0.012, 0, 3))
}