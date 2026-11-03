import {
    ActionUnitType,
    BasicCardName,
    Card,
    CardCategory,
    CardSuit,
    EquipmentCardName,
    EquipSlot,
    Faction,
    GamePhase,
    GameMode,
    GameState,
    GeneralDefinition,
    ResponseType,
    SeatRole,
    SkillType,
    TrickCardName,
    TurnPhase,
} from 'sgs3v3-shared'
import { getActiveGeneral, getAttackRange, getHandLimit } from './game-state'
import { getGeneralById } from './generals'
import { canPlayAsNegate } from './card-utils'
import { chooseActionUnit, handleDiscard, handleEndTurn, handleYieldChoice } from './turn-manager'
import { handleNegateRespond, handleRespond, handleUseCard, handleUseSkill, negateWindowTimeout } from './game-actions'
import { AI_PLAYER_ID, currentPickFaction, handlePickYield, localDeployGenerals, localPickGeneral } from './local-match'
import { randomInt } from './rng'
import { hasRole, rolesOf, synergyWeight } from './general-meta'
import { expectedSlashes } from './deck-meta'
import {
    BASE_SCORE, PASS_SCORE, PLAN_BONUS, choosePlan, deckInfo, equipmentScore,
    holdPenalty, isWeak, matchTempo, negateScore, targetScore, tauntOf, threatLevel, type PlanKind,
} from './ai-policy'
import { bestGiftTarget, cardFit, damageBackfire, lossBenefit, suitAffinity } from './ai-synergy'
import { analyzeStrategy } from './ai-strategy'
import { dodgeHoldValue, delayedSuccessChance, negateRisk, predictAoe, predictDuel, predictSlash, teamView } from './ai-forecast'
import { enemyPlans, guessHand, handDodgeChance, incomingDamage, knownSuits } from './ai-memory'
import { beginDecision, endDecision } from './ai-audit'
import { applyChoicePatches, applyPatchToOptions, experimentOn, forcedPlayRule, hasHookRules, noteExperiment, pickBestChoice, thresholdFor, type Choice } from './ai-variant'
import { bestStealSlot, pickQingnangPlan, pickYijiReceiver, rendeOpportunity, stealableEquipSlots } from './general-playbook'

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

function isEnemy(state: GameState, g: { faction: Faction }, playerId: string): boolean {
    const ownFaction = state.players[playerId]?.faction
    return !!ownFaction && g.faction !== ownFaction
}

function aliveEnemies(state: GameState, playerId: string) {
    return state.generals
        .map((g, index) => ({ g, index }))
        .filter(({ g }) => g.alive && isEnemy(state, g, playerId))
}

function myGenerals(state: GameState, playerId: string) {
    return state.generals
        .map((g, index) => ({ g, index }))
        .filter(({ g }) => g.playerId === playerId)
}

/** 该 pending 是否轮到指定玩家操作 */
export function aiOwnsPending(state: GameState, playerId: string = AI_PLAYER_ID): boolean {
    const pending = state.pendingResponseQueue[0]
    if (!pending) return false
    const target = state.generals[pending.targetGeneralIndex]
    if (!target) return true
    return target.playerId === playerId
}

// ─────────────────────────────────────────────────────────────
// 牌与武将评分（AI 决策共用，全部为确定性规则）
// ─────────────────────────────────────────────────────────────

function isBlackCard(card: Card): boolean {
    return card.suit === CardSuit.SPADE || card.suit === CardSuit.CLUB
}

function isRedCard(card: Card): boolean {
    return card.suit === CardSuit.HEART || card.suit === CardSuit.DIAMOND
}

function isDelayedTrickInJudgeZone(card: Card): boolean {
    return card.name === TrickCardName.OVERINDULGENCE || card.name === TrickCardName.SUPPLY_SHORTAGE
        || card.name === TrickCardName.LIGHTNING
}

/** 装备牌价值：武器看攻击范围，防具按强度，坐骑按类型 */
function equipCardValue(card: Card): number {
    if (card.category !== CardCategory.EQUIPMENT) return 0
    if (card.equipSlot === EquipSlot.WEAPON) return 40 + (card.attackRange ?? 1) * 8
    switch (card.name) {
        case EquipmentCardName.EIGHT_TRIGRAMS:
            return 95
        case EquipmentCardName.NIOH_SHIELD:
            return 90
        case EquipmentCardName.VINE:
            return 72
        case EquipmentCardName.SILVER_LION:
            return 66
        default:
            break
    }
    if (card.equipSlot === EquipSlot.MINUS_HORSE) return 70
    if (card.equipSlot === EquipSlot.PLUS_HORSE) return 68
    return 60
}

/** 锦囊保留价值：能直接换来节奏的牌留得更紧，需要配合的牌相对可弃 */
function trickValue(card: Card): number {
    switch (card.name) {
        case TrickCardName.NEGATE: return 92
        case TrickCardName.DRAW_TWO: return 90
        case TrickCardName.STEAL: return 78
        case TrickCardName.DISMANTLE: return 76
        case TrickCardName.OVERINDULGENCE: return 76
        case TrickCardName.SUPPLY_SHORTAGE: return 74
        case TrickCardName.DUEL: return 72
        case TrickCardName.BARBARIANS:
        case TrickCardName.ARROWS: return 70
        case TrickCardName.HARVEST:
        case TrickCardName.PEACH_GARDEN: return 66
        case TrickCardName.FIRE_ATTACK: return 64
        case TrickCardName.BORROW_SWORD: return 58
        case TrickCardName.IRON_CHAIN: return 64
        case TrickCardName.LIGHTNING: return 56
        default: return 70
    }
}

/** 保留价值：越高越不想弃掉 */
function keepValue(card: Card): number {
    if (isPeach(card)) return 100
    if (isDodge(card)) return 90
    if (isSlash(card)) return 80
    if (card.name === BasicCardName.WINE) return 55
    if (card.category === CardCategory.EQUIPMENT) return equipCardValue(card)
    if (card.category === CardCategory.TRICK) return trickValue(card)
    return 70
}

/** 弃牌阶段：优先弃价值最低的牌 */
function lowestValueCards(hand: Card[], count: number): string[] {
    return [...hand]
        .sort((a, b) => keepValue(a) - keepValue(b))
        .slice(0, count)
        .map((c) => c.id)
}

/** 手牌 + 已装备牌里价值最低的若干张（救主 / 贯石斧 / 流离等的代价） */
function lowestValueCardsWithEquip(g: GeneralView | undefined, count: number, excludeIds: string[] = []): string[] {
    if (!g) return []
    const pool: Card[] = [...g.hand, ...equippedCards(g)].filter((c) => !excludeIds.includes(c.id))
    return pool
        .sort((a, b) => keepValue(a) - keepValue(b))
        .slice(0, count)
        .map((c) => c.id)
}

/** 已装备的牌 */
function equippedCards(g: GeneralView | undefined): Card[] {
    if (!g) return []
    return Object.values(g.equip).filter((c): c is Card => !!c)
}

/** 超出安全数量的重复牌（第 4 张闪、第 4 张杀等），可用于制衡换牌 */
function surplusCardIds(hand: Card[]): string[] {
    const counts = new Map<string, number>()
    const out: string[] = []
    for (const c of [...hand].sort((a, b) => keepValue(a) - keepValue(b))) {
        const key = isPeach(c) ? 'peach' : isDodge(c) ? 'dodge' : isSlash(c) ? 'slash' : ''
        if (!key) continue
        const limit = key === 'peach' ? 2 : 3
        const seen = counts.get(key) ?? 0
        if (seen >= limit) out.push(c.id)
        counts.set(key, seen + 1)
    }
    return out
}

/** 可安全弃置的“废牌”（价值低，不影响桃/闪/杀等核心；传入武将时按其花色偏好排序） */
function junkCardIds(hand: Card[], max: number, g?: GeneralView): string[] {
    return [...hand]
        .filter((c) => keepValue(c) < 60)
        .sort((a, b) => (keepValue(a) + suitAffinity(g, a)) - (keepValue(b) + suitAffinity(g, b)))
        .slice(0, max)
        .map((c) => c.id)
}

/** 强技能权重表（覆盖现有 32 名武将的核心技能） */
const SKILL_SCORE: Record<string, number> = {
    // 魏
    caocao_jianxiong: 14, simayi_fankui: 22, simayi_guicai: 12, zhangliao_tuxi: 18,
    guojia_tiandu: 8, guojia_yiji: 24, guojia_jie_yiji: 24, zhenji_luoshen: 20, zhenji_qingguo: 12,
    xiahoyuan_shensu: 10, xuhuang_duanliang: 10, xiahoudun_ganglie: 16, wenpin_zhenwei: 12,
    // 蜀
    liubei_rende: 18, guanyu_wusheng: 16, guanyu_zhongyi: 8, zhangfei_paoxiao: 20,
    zhugeliang_guanxing: 18, zhugeliang_kongcheng: 16, zhaoyun_longdan: 16, zhaoyun_jiuzhu: 8,
    machao_mashu: 10, machao_tieqi: 14, huangyueying_jizhi: 12, huangyueying_qicai: 12,
    jiangwei_tiaoxin: 12, jiangwei_zhiji: 8,
    // 吴
    sunquan_zhiheng: 22, ganning_qixi: 14, huanggai_kurou: 18, zhouyu_yingzi: 14,
    zhouyu_fanjian: 14, daqiao_guose: 14, daqiao_liuli: 16, sunshangxiang_jieyin: 10,
    sunshangxiang_xiaoji: 10, sunjian_yinghun: 12, xiaoqiao_tianxiang: 16, xiaoqiao_hongyan: 6,
    sunce_jiang: 10, sunce_hunzi: 6, zhugejin_mingzhe: 8, zhugejin_huanshi: 8, zhugejin_hongyuan: 8,
    // 群
    huatuo_jijiu: 12, huatuo_qingnang: 14, lvbu_wushuang: 20, diaochan_lijian: 14,
    diaochan_biyue: 8, pangde_mashu: 10, pangde_mengjin: 10, pangde_jianchu: 14, jiaxu_wansha: 8,
    jiaxu_luanwu: 10, jiaxu_weimu: 10,
    // 平衡版扩展
    chengong_mingce: 14, chengong_zhichi: 12, jushou_jianying: 16, jushou_shibei: 10,
    fuwan_moukui: 12, zhangjiao_leiji: 14, zhangjiao_guidao: 12,
    lidian_xunxun: 16, lidian_wangxi: 10, simayi_jie_fankui: 22, simayi_jie_guicai: 14,
    xuchu_luoyi: 16, dengai_tuntian: 18, dengai_zaoxian: 12, dengai_jixi: 12,
    xunyou_qice: 20, xunyou_zhiyu: 10, wangyi_zhenlie: 12, wangyi_miji: 10,
    wangji_qizhi: 14, wangji_jinqu: 8, yuejin_xiaoguo: 12, simalang_junbing: 10,
    simalang_quji: 12, litong_tuifeng: 14, caocao_jie_jianxiong: 16, dianwei_jie_qiangxi: 16,
    machao_jie_tieqi: 16, madai_qianxi: 14, sp_sunshangxiang_liangzhu: 12,
    sp_sunshangxiang_fanxiang: 8, zhoucang_zhongyong: 14, yanyan_juzhan: 14,
    wangping_feijun: 14, wangping_binglue: 8, huangquan_dianhu: 14, huangquan_jianji: 12,
    sunqian_qianya: 10, sunqian_shuomeng: 8, lingtong_xuanfeng: 14, ganning_jie_fenwei: 10,
    zhouyu_jie_yingzi: 12, zhouyu_jie_fanjian: 14, luxun_jie_qianxun: 12, luxun_jie_lianying: 12,
    guyong_shenxing: 8, guyong_bingyi: 10, dingfeng_duanbing: 14, dingfeng_fenxun: 8,
    yufan_zongxuan: 8, yufan_zhiyan: 10, zumao_yinbing: 10, zumao_juedi: 10,
    zhugeke_aocai: 10, zhugeke_duwu: 16, lingcao_dufeng: 14, caifuren_qieting: 8,
    caifuren_xianzhou: 10, lvbu_jing_zhanshen: 16, dianwei_jie_ninge: 14,
    xiahoudun_jing_ganglie: 16, lvbu_jing_mashu: 10, lvbu_jing_shenji: 16,
    // 洛书版扩展（三）：界将升级
    sunshangxiang_jieyuan: 14, sunshangxiang_jie_xiaoji: 14, daqiao_jie_guose: 16,
    chengpu_jie_lihuo: 16, chengpu_chunlao: 10, caifuren_jie_qieting: 12,
    simayi_jie_jiaozhao: 16, guohuanghou_danxin: 10, caoxiu_jie_qingxi: 16,
    caoxiu_qianju: 10, wangyi_jie_zhenlie: 16, taishici_hanzhan: 12,
    // 洛书版扩展（四）：新增武将
    guohuai_jingce: 16, sunxiu_yanzhu: 12, sunxiu_xingxue: 14,
    zhuhuan_fenli: 10, zhuhuan_pingkou: 14, huangzhong_liegong: 20,
    zhuzhi_anguo: 14, zhugezhan_zuilun: 12, zhugezhan_fuyin: 14,
    zhangxiu_xiongluan: 18, zhangxiu_congjian: 8, liru_juece: 10,
    liru_mieji: 12, liru_fencheng: 18, lisu_qiaoyan: 12, lisu_xianzhu: 10,
    xujing_yuxu: 14, xujing_shijian: 8, quyi_fuqi: 14, quyi_jiaozi: 16,
    // 洛书版扩展（五）：新增武将
    zhonghui_quanji: 14, zhonghui_zili: 16, zhonghui_paiyi: 16,
    zhangchunhua_jueqing: 16, zhangchunhua_shangshi: 14, zhangchunhua_jianmie: 14,
    caozhang_jiangchi: 14, zhangsong_qiangshi: 12, zhangsong_xiantu: 12,
    fuhuanghou_chuikong: 14, fuhuanghou_xuanqiu: 12, zhuran_danshou: 16,
    caochong_chengxiang: 18, caochong_renxin: 14, mizhu_ziyuan: 14, mizhu_jujia: 16,
    caorui_huituo: 18, caorui_mingjian: 14, liufeng_xiansi: 14, zhanghe_qiaobian: 16,
}

/** 前锋位额外权重：偏向输出与压制能力 */
const FLANK_SKILL_SCORE: Record<string, number> = {
    zhangfei_paoxiao: 14, lvbu_wushuang: 14, machao_tieqi: 10, pangde_mengjin: 8, pangde_jianchu: 10,
    guanyu_wusheng: 10, zhaoyun_longdan: 10, huanggai_kurou: 10, sunquan_zhiheng: 10,
    zhouyu_fanjian: 10, diaochan_lijian: 10, jiangwei_tiaoxin: 8, ganning_qixi: 8,
    daqiao_guose: 8, jiaxu_luanwu: 8, xuhuang_duanliang: 6, guojia_yiji: 6, guojia_jie_yiji: 6,
    huatuo_qingnang: 6, sunshangxiang_jieyin: 6,
    dianwei_jie_qiangxi: 8, zhugeke_duwu: 8, lingcao_dufeng: 8, madai_qianxi: 6,
    xunyou_qice: 6, wangping_feijun: 6, dingfeng_duanbing: 8, xuchu_luoyi: 8,
    machao_jie_tieqi: 8,
    // 洛书版扩展（三）：界将升级（前锋位加成）
    zhangfei_tishen: 8, caoxiu_jie_qingxi: 8, chengpu_jie_lihuo: 8,
    taishici_hanzhan: 6, sunshangxiang_jieyuan: 6,
}

/**
 * 2013 统率三军抓将梯度（社区经验，非官方数值）
 * 首抓：郭嘉 > 刘备 ≈ 张辽 > 华佗 > 黄月英 > 黄盖 > 诸葛亮 ≈ 司马懿 > 孙权
 */
const GENERAL_TIER_SCORE: Record<string, number> = {
    guojia: 26, liubei: 22, zhangliao: 21, huatuo: 20,
    huangyueying: 16, huanggai: 14, zhugeliang: 8, simayi: 8, sunquan: 5,
    zhangfei: 6, lvbu: 5, machao: 4, zhaoyun: 4, guanyu: 4, zhouyu: 4,
    daqiao: 4, ganning: 4, diaochan: 3, pangde: 3, xiahoudun: 3, caocao: 3,
    xiaoqiao: 2, sunshangxiang: 2, zhenji: 2, sunjian: 2, xuhuang: 2,
    zhugejin: 1, jiaxu: 1, jiangwei: 1, wenpin: 0, xiahoyuan: 0, sunce: 0,
    // 平衡版扩展（自用，权重为体验向估计）
    simayi_jie: 6, xuchu_jie: 4, lidian_jie: 5, dengai: 6, xunyou: 6, wangyi: 3,
    wangji: 4, yuejin: 2, simalang: 4, litong: 3, caocao_jie: 3, dianwei_jie: 4,
    machao_jie: 4, madai: 4, sunshangxiang_sp: 3, zhoucang: 3, yanyan: 3,
    wangping: 4, huangquan_jing: 3, sunqian: 3, lingtong: 4, ganning_jie: 3,
    zhouyu_jie: 5, luxun_jie: 5, guyong: 4, dingfeng: 5, yufan: 3, zumao: 3,
    zhugeke: 5, lingcao: 4, caifuren: 3, lvbu_jing: 4, chengong: 5, jushou: 4,
    fuwan: 3, zhangjiao: 4, xiahoudun_jing: 4,
    // 洛书版扩展（权重为体验向估计）
    liuchen: 5, huaxiong_jie: 4, weiyan: 4,
    luji: 6, haozhao: 5, xuyou: 7, handang: 5, fazheng: 6, masu: 4, zhongyao: 5,
    chengpu: 5, cenhun: 3, sundeng: 4, guotu: 5, caoxiu: 4, guohuanghou: 4,
    xiahoushi: 3, gongsunyuan: 4, quancong: 4,
    // 洛书版扩展（二）
    xiahouyuan_jie: 5, caoren: 6, guanyinping: 5, chenqun: 5, xunyu: 7,
    zhurong_jie: 5, liushan: 5, zhangzhaozhanghong_jie: 5, dongzhuo: 5, pangtong: 5,
    yanliangwenchou_jie: 5, wolong: 7, taishici: 6, zhoufei: 4, lusu: 6,
    bulianshi_jie: 4, kuailiangkuaiyue: 5, gaoshun_jie: 5, zhoufang: 4,
    zhugeliang_jie: 8, sunjian_jie: 7, sunce_jie: 7, guojia_jie: 8, huanggai_jie: 6,
    pangde_jie: 5, jiaxu_jie: 6, chengong_jie: 6,
    // 洛书版扩展（三）：界将升级
    sunshangxiang_jie: 4, daqiao_jie: 5, chengpu_jie: 6, caifuren_jie: 4,
    caoxiu_jie: 5, wangyi_jie: 5, zhangfei_jie: 7, taishici_jie: 7,
    // 洛书版扩展（四）：新增武将
    guohuai_jie: 5, sunxiu: 5, zhuhuan: 5, huangzhong_jie: 6, zhuzhi: 5, zhugezhan: 5,
    zhangxiu: 5, liru: 6, lisu: 3, xujing: 6, quyi: 5,
    // 洛书版扩展（五）：新增武将
    zhonghui_jie: 6, zhangchunhua_jie: 5, caozhang_jie: 5, zhangsong_jie: 5,
    fuhuanghou_jie: 5, zhuran_jie: 6, caochong_jie: 6, mizhu: 5, caorui: 6,
    liufeng: 5, zhanghe: 6,
}

/** 主帅位适配度：支援型（郭嘉/华佗/刘备）与压制型（甘宁/大乔/周瑜/孙权/黄盖）优先，张辽/文聘不适合主帅 */
const COMMANDER_FIT: Record<string, number> = {
    guojia: 24, huatuo: 22, liubei: 20,
    ganning: 16, sunquan: 16, daqiao: 14, zhouyu: 14, huanggai: 12,
    simayi: 10, zhugeliang: 8, caocao: 8, xiahoudun: 8, xiaoqiao: 6, sunjian: 6,
    zhangfei: 4, lvbu: 4, machao: 4, guanyu: 4, zhaoyun: 4,
    pangde: 2, zhenji: 2, diaochan: 2, xuhuang: 2, jiaxu: 2,
    zhangliao: -30, wenpin: -14, xiahoyuan: -6, sunce: -4,
    guyong: 10, simalang: 6, sunqian: 4, dengai: 6, jushou: 4, huangquan_jing: 4,
    wangping: 4, zhouyu_jie: 8, zhugeke: 6, caifuren: 2, lingtong: 4, yanyan: 4,
    zhoucang: 4, dingfeng: 4, xunyou: 6, lidian_jie: 4, simayi_jie: 6, wangji: 6,
    xiahoudun_jing: 8,
    guojia_jie: 22, wolong: 14, lusu: 12, xunyu: 12, chenqun: 8, kuailiangkuaiyue: 8,
    sunjian_jie: 8, zhoufei: 6, bulianshi_jie: 6, caoren: 6, zhangzhaozhanghong_jie: 6,
    zhugeliang_jie: 8, sunce_jie: 2, xiahouyuan_jie: 0, guanyinping: 2, taishici: 4,
    gaoshun_jie: 2, dongzhuo: -4, pangtong: 6, liushan: 10, zhoufang: 4,
}

/** 冷色偏压制型主帅，暖色偏支援型主帅 */
const SUPPORT_COMMANDERS = ['guojia', 'huatuo', 'liubei']
const PRESSURE_COMMANDERS = ['ganning', 'daqiao', 'zhouyu', 'sunquan', 'huanggai', 'xiahoudun', 'zhangfei', 'lvbu']

/** 与已选武将的组合协同加成（按真实联动权重累加，封顶 12） */
function synergyBonus(generalId: string, picked: GeneralDefinition[]): number {
    let bonus = 0
    for (const g of picked) bonus += synergyWeight(generalId, g.id)
    return Math.min(bonus, 12)
}

/** 拆对方组合：对手已有搭档时，抢走其缺的那一半 */
function denialBonus(generalId: string, rivalPicked: GeneralDefinition[]): number {
    let best = 0
    for (const g of rivalPicked) best = Math.max(best, synergyWeight(generalId, g.id))
    return Math.round(best * 0.8)
}

/** 阵容缺口：首抓只看强度，之后先补输出、再补辅助/盾将；同定位堆叠边际收益递减 */
function compositionBonus(generalId: string, myPicked: GeneralDefinition[]): number {
    if (myPicked.length === 0) return 0
    const owned = new Set(myPicked.flatMap((g) => rolesOf(g.id)))
    const needDamage = !owned.has('damage') && !owned.has('core')
    const needSupport = !owned.has('support') && !owned.has('tank')
    const canDamage = hasRole(generalId, 'damage') || hasRole(generalId, 'core')
    const canSupport = hasRole(generalId, 'support') || hasRole(generalId, 'tank')
    const bonus = Math.max(needDamage && canDamage ? 14 : 0, needSupport && canSupport ? 14 : 0)
    const overlap = rolesOf(generalId).filter((role) => owned.has(role)).length
    return bonus - overlap * 3
}

export type DraftScore = { base: number; synergy: number; denial: number; composition: number; total: number }

/** 抓将评分拆解：base 看武将本身，其余三项看局势 */
export function draftScore(def: GeneralDefinition, myPicked: GeneralDefinition[], rivalPicked: GeneralDefinition[]): DraftScore {
    const base = scoreGeneral(def)
    const synergy = synergyBonus(def.id, myPicked)
    const denial = denialBonus(def.id, rivalPicked)
    const composition = compositionBonus(def.id, myPicked)
    return { base, synergy, denial, composition, total: base + synergy + denial + composition }
}

/** 武将综合评分：抓将梯度 + 体力 + 技能数量/类型 + 强技能权重 */
function scoreGeneral(def: GeneralDefinition): number {
    if (!def) return 0
    let score = def.maxHp * 10 + (GENERAL_TIER_SCORE[def.id] ?? 0)
    for (const skill of def.skills ?? []) {
        score += SKILL_SCORE[skill.id] ?? 6
        if (skill.type === SkillType.ACTIVE) score += 5
        else if (skill.type === SkillType.LOCKED) score += 4
        else if (skill.type === SkillType.LIMITED) score += 2
        else if (skill.type === SkillType.AWAKENED) score += 1
        else score += 3
    }
    // 3 血武将容错更低，适当扣分
    if (def.maxHp <= 3) score -= 6
    return score
}

/** 按座位职责评分：主帅看体力与主帅适配度，前锋看输出/控制 */
function scoreGeneralForRole(def: GeneralDefinition, role: 'commander' | 'flank', faction: Faction): number {
    const base = scoreGeneral(def)
    const roles = rolesOf(def.id)
    if (role === 'commander') {
        let fit = COMMANDER_FIT[def.id] ?? 0
        if (faction === Faction.COOL && PRESSURE_COMMANDERS.includes(def.id)) fit += 6
        if (faction === Faction.WARM && SUPPORT_COMMANDERS.includes(def.id)) fit += 6
        // 主帅要活到中后期：辅助/盾将适配，纯输出往后站
        if (roles.includes('support')) fit += 8
        if (roles.includes('tank')) fit += 6
        if (roles.includes('damage')) fit -= 6
        return base + def.maxHp * 4 + fit
    }
    let flankFit = 0
    if (roles.includes('damage')) flankFit += 6
    if (roles.includes('control')) flankFit += 3
    if (roles.includes('support')) flankFit -= 3
    return base + flankFit + (def.skills ?? []).reduce((sum, skill) => sum + (FLANK_SKILL_SCORE[skill.id] ?? 0), 0)
}

/**
 * 敌方威胁评分：主帅最高，其次低血、少手牌；
 * 再按嘲讽值加权——治疗/摸牌引擎（辅助）比盾将更该先压（QSanguosha 的 ai_chaofeng）。
 */
function enemyTargetScore(g: GeneralView): number {
    let score = 0
    if (g.seatRole === SeatRole.COMMANDER) score += 55
    score -= g.hp * 6
    score += (g.maxHp - g.hp) * 3
    score -= g.hand.length * 2
    if (g.hand.length === 0) score += 4
    score += tauntOf(g) * 5
    return score
}

/**
 * 出【杀】的目标价值：无手牌几乎必中、可斩杀优先，再叠加威胁分。
 * 黑色【杀】对仁王盾无效，直接压到最低。
 */
function slashTargetValue(g: GeneralView, slash?: Card, damage = 1): number {
    if (slash && g.equip.armor?.name === EquipmentCardName.NIOH_SHIELD && isBlackCard(slash)) return -100
    let score = enemyTargetScore(g)
    if (g.hand.length === 0) score += 35
    else if (g.hand.length === 1) score += 8
    // 一击必杀优先：主帅倒地直接赢，边锋倒地有击杀奖励（摸2张），
    // 价值高于继续压一个血还厚的目标
    if (g.hp <= damage) score += g.seatRole === SeatRole.COMMANDER ? 70 : 50
    else if (g.hp === 2) score += 10
    if (g.equip.armor?.name === EquipmentCardName.EIGHT_TRIGRAMS) score -= 5
    // 打郭嘉/曹操/司马懿/夏侯惇这类卖血反击将，非致死时收益要打折
    score -= g.hp <= 1 ? 0 : damageBackfire(g)
    return score
}

/** 敌方按威胁降序；传入集火目标时给它加权，避免伤害摊薄 */
function rankEnemies(state: GameState, playerId: string, focusIndex = -1) {
    const value = (e: { g: GeneralView; index: number }) =>
        enemyTargetScore(e.g) + (e.index === focusIndex ? 10 : 0)
    return aliveEnemies(state, playerId).sort(
        (a, b) => value(b) - value(a) || a.index - b.index
    )
}

/** 敌方“可拆价值”：装备与判定区延时锦囊越多越值得拆 */
function cardRiches(g: GeneralView): number {
    const equipCount = equippedCards(g).length
    const delayed = g.judgeZone.filter(isDelayedTrickInJudgeZone).length
    return equipCount * 2 + delayed * 3
}

/** 帷幕：黑色锦囊不能指定贾诩 */
function blockedByWeimu(g: GeneralView, card: Card): boolean {
    return isBlackCard(card) && knowsSkill(g, 'jiaxu_weimu')
}

/** 空城：诸葛亮无手牌时不能被【杀】/【决斗】指定 */
function blockedByKongcheng(g: GeneralView): boolean {
    return knowsSkill(g, 'zhugeliang_kongcheng') && g.hand.length === 0
}

/** 潜袭：该角色本回合不能使用/打出指定颜色的手牌 */
function blockedByQianxiView(g: GeneralView, c: Card): boolean {
    if (!g.qianxiColor) return false
    const isRed = c.suit === CardSuit.HEART || c.suit === CardSuit.DIAMOND
    return (g.qianxiColor === 'red') === isRed
}

/** 找一张可当【闪】用的牌（含倾国 / 龙胆转换） */
function pickDodge(state: GameState, index: number): string | undefined {
    const g = state.generals[index]
    if (!g) return undefined
    const dodge = g.hand.find((c) => isDodge(c) && !blockedByQianxiView(g, c))
    if (dodge) return dodge.id
    // 倾国：黑色手牌当闪
    if (knowsSkill(g, 'zhenji_qingguo')) {
        const black = [...g.hand].filter((c) => isBlackCard(c) && !blockedByQianxiView(g, c)).sort((a, b) => keepValue(a) - keepValue(b))[0]
        if (black) return black.id
    }
    // 龙胆：普通【杀】当闪（火杀/雷杀不可）
    if (knowsSkill(g, 'zhaoyun_longdan')) {
        const slash = [...g.hand]
            .filter((c) => c.name === BasicCardName.ATTACK && !blockedByQianxiView(g, c))
            .sort((a, b) => keepValue(a) - keepValue(b))[0]
        if (slash) return slash.id
    }
    // 龙魂（神赵云）：♣牌当【闪】
    if (knowsSkill(g, 'shenzhaoyun_longhun')) {
        const club = [...g.hand]
            .filter((c) => c.suit === CardSuit.CLUB && !blockedByQianxiView(g, c))
            .sort((a, b) => keepValue(a) - keepValue(b))[0]
        if (club) return club.id
    }
    return undefined
}

/** 找一张可当【杀】用的牌（含龙胆 / 武圣转换） */
function pickSlash(state: GameState, index: number): string | undefined {
    const g = state.generals[index]
    if (!g) return undefined
    const slash = g.hand.find((c) => isSlash(c) && !blockedByQianxiView(g, c))
    if (slash) return slash.id
    if (knowsSkill(g, 'zhaoyun_longdan')) {
        const dodge = [...g.hand].filter((c) => isDodge(c) && !blockedByQianxiView(g, c)).sort((a, b) => keepValue(a) - keepValue(b))[0]
        if (dodge) return dodge.id
    }
    if (knowsSkill(g, 'guanyu_wusheng')) {
        const red = [...g.hand]
            .filter((c) => isRedCard(c) && keepValue(c) <= 70 && !blockedByQianxiView(g, c))
            .sort((a, b) => keepValue(a) - keepValue(b))[0]
        if (red) return red.id
    }
    return undefined
}

/** 赈赡（界全琮）：可交换手牌的最优对象（己方手牌最少者优先，其次敌方手牌最少者） */
function pickZhenshanPartner(state: GameState, selfIdx: number, playerId: string): number | undefined {
    const self = state.generals[selfIdx]
    if (!self || !knowsSkill(self, 'quancong_zhenshan')) return undefined
    if (self.zhenshanFreeSeat !== state.activeGeneralIndex && self.zhenshanUseTurn === state.turnSerial) return undefined
    const candidates = state.generals
        .map((g, i) => ({ g, i }))
        .filter(({ g, i }) => g.alive && i !== selfIdx && g.hand.length < self.hand.length)
        .sort((a, b) => {
            const ea = isEnemy(state, a.g, playerId) ? 1 : 0
            const eb = isEnemy(state, b.g, playerId) ? 1 : 0
            return ea - eb || a.g.hand.length - b.g.hand.length
        })
    return candidates[0]?.i
}

const EQUIP_SLOTS = [EquipSlot.WEAPON, EquipSlot.ARMOR, EquipSlot.PLUS_HORSE, EquipSlot.MINUS_HORSE] as const

type GeneralView = GameState['generals'][number]

function firstFilledSlot(g: GeneralView | undefined): string | undefined {
    if (!g) return undefined
    return EQUIP_SLOTS.find((slot) => !!g.equip[slot])
}

function firstHandEquipCard(g: GeneralView | undefined): string | undefined {
    return g?.hand.find((c) => c.category === CardCategory.EQUIPMENT)?.id
}

/** 优先选敌方，其次任意其他存活角色 */
function otherAliveIndex(state: GameState, excludeIndex: number, playerId: string): number | undefined {
    const others = state.generals
        .map((g, index) => ({ g, index }))
        .filter(({ g, index }) => g.alive && index !== excludeIndex)
    const enemy = others.find(({ g }) => isEnemy(state, g, playerId))
    return (enemy ?? others[0])?.index
}

/** 处理当前 pending（调用方需保证该项属于该玩家） */
export function aiRespond(state: GameState, playerId: string = AI_PLAYER_ID): boolean {
    const pending = state.pendingResponseQueue[0]
    if (!pending) return false
    const ctx = (pending.context ?? {}) as any
    const targetIndex = pending.targetGeneralIndex
    const payload: any = {}

    switch (pending.type) {
        case ResponseType.DODGE:
        case ResponseType.AOE_DODGE: {
            // 不可被响应的【杀】（伏骑/烈弓/诈降等）：直接放弃
            if (pending.type === ResponseType.DODGE && (ctx as any).unavoidable) break
            const armor = state.generals[targetIndex]?.equip.armor
            const attacker = ctx.attackerGeneralIndex >= 0 ? state.generals[ctx.attackerGeneralIndex] : undefined
            const qinggang = attacker?.equip.weapon?.name === EquipmentCardName.QINGGANG_SWORD
            // 八卦阵不消耗手牌：先判定，失败后仍可再出【闪】，没有理由先用闪
            const hasBagua = armor
                ? armor.name === EquipmentCardName.EIGHT_TRIGRAMS
                : knowsSkill(state.generals[targetIndex], 'wolong_bazhen')
            if (hasBagua && !qinggang && state.deck.length > 0
                && !(ctx as any).eightTrigramsUsed) {
                payload.action = 'eight_trigrams'
                break
            }
            const cardId = pickDodge(state, targetIndex)
            if (cardId) {
                // 留闪：之后大概率吃到酒杀等更痛的一刀时，宁可硬吃这一下
                const hold = pending.type === ResponseType.DODGE
                    ? dodgeHoldValue(state, playerId, targetIndex, ctx.attackerGeneralIndex)
                    : null
                if (!hold?.hold) {
                    payload.cardId = cardId
                    break
                }
            }
            // 活墨（钟繇）：无【闪】时可将黑色非基本牌置于牌堆顶顶替
            const huomoGeneral = state.generals[targetIndex]
            const huomoCard = huomoGeneral?.hand.find((c) =>
                c.category !== CardCategory.BASIC
                && (c.suit === CardSuit.SPADE || c.suit === CardSuit.CLUB))
            if (knowsSkill(huomoGeneral, 'zhongyao_huomo') && huomoCard) {
                payload.action = 'huomo'
                payload.cardId = huomoCard.id
                break
            }
            // 饰非（郭图逢纪）：无【闪】时视为使用一张【闪】
            if (knowsSkill(huomoGeneral, 'guotu_shifei') && !(ctx as any).shifeiTried) {
                payload.action = 'shifei'
                break
            }
            // 傲才（诸葛恪）：回合外无【闪】时尝试牌堆顶两张
            const dodgeGeneral = state.generals[targetIndex]
            if (knowsSkill(dodgeGeneral, 'zhugeke_aocai')
                && state.activeGeneralIndex !== targetIndex
                && state.deck.length > 0
                && !(ctx as any).aocaiTried) {
                payload.action = 'aocai'
            }
            // 赈赡（界全琮）：无【闪】时交换手牌视为使用【闪】
            const zsDodgePartner = pickZhenshanPartner(state, targetIndex, playerId)
            if (zsDodgePartner !== undefined) {
                payload.action = 'zhenshan'
                payload.targetIndex = zsDodgePartner
            }
            break
        }
        case ResponseType.ATTACK_DUEL:
        case ResponseType.AOE_ATTACK:
        case ResponseType.BARBARIANS_RESPONSE:
        case ResponseType.ARROWS_RESPONSE: {
            const cardId = pickSlash(state, targetIndex)
            if (cardId) payload.cardId = cardId
            else {
                const zsSlashPartner = pickZhenshanPartner(state, targetIndex, playerId)
                if (zsSlashPartner !== undefined) {
                    payload.action = 'zhenshan'
                    payload.targetIndex = zsSlashPartner
                }
            }
            break
        }
        case ResponseType.PEACH_SAVE_ASK: {
            const dying = state.generals[ctx.dyingGeneralIndex]
            const asker = state.generals[targetIndex]
            const myFaction = state.players[playerId]?.faction
            if (dying && asker && myFaction && dying.faction === myFaction && asker.faction === myFaction) {
                // 桃优先（不必额外付出体力或牌）
                const peach = asker.hand.find(isPeach)
                if (peach) {
                    payload.action = 'peach'
                    payload.cardId = peach.id
                    break
                }
                // 酒只能自救
                const wine = asker === dying ? asker.hand.find((c) => c.name === BasicCardName.WINE) : undefined
                if (wine) {
                    payload.action = 'peach'
                    payload.cardId = wine.id
                    break
                }
                // 醇醪：移去 X 张“醇”，不消耗手牌（界程普的 X 随本轮次数递增，数量不够就别发动）
                if (knowsSkill(asker, 'chengpu_chunlao')) {
                    const chunPile = asker.generalPile?.length ?? 0
                    const chunCost = knowsSkill(asker, 'chengpu_jie_lihuo')
                        ? Math.max(1, asker.chunlaoWineRound === (state.roundState?.roundNumber ?? 0)
                            ? (asker.chunlaoWineCount ?? 0) : 0)
                        : 1
                    if (chunPile >= chunCost) {
                        payload.action = 'chunlao'
                        break
                    }
                }
                // 活墨：黑色非基本牌置于牌堆顶，视为使用桃（自救也可用酒）
                if (knowsSkill(asker, 'zhongyao_huomo')) {
                    const hmCandidates = asker === dying
                        ? [BasicCardName.PEACH, BasicCardName.WINE]
                        : [BasicCardName.PEACH]
                    const hmName = hmCandidates.find((n) => !(asker.basicUsedThisTurn ?? []).includes(n))
                    const black = asker.hand
                        .filter((c) => c.category !== CardCategory.BASIC &&
                            (c.suit === CardSuit.SPADE || c.suit === CardSuit.CLUB))
                        .sort((a, b) => keepValue(a) - keepValue(b))[0]
                    if (hmName && black) {
                        payload.action = 'huomo'
                        payload.cardId = black.id
                        break
                    }
                }
                // 救主：失去1体力弃1牌（不能救自己，体力需 > 1）
                if (knowsSkill(asker, 'zhaoyun_jiuzhu') && asker !== dying && asker.hp > 1) {
                    const cardId = lowestValueCardsWithEquip(asker, 1)[0]
                    if (cardId) {
                        payload.action = 'jiuzhu'
                        payload.cardId = cardId
                        break
                    }
                }
                // 急救：红色牌（手牌或装备）当桃
                if (knowsSkill(asker, 'huatuo_jijiu')) {
                    const red = [...asker.hand, ...equippedCards(asker)]
                        .filter(isRedCard)
                        .sort((a, b) => keepValue(a) - keepValue(b))[0]
                    if (red) {
                        payload.action = 'jijiu'
                        payload.cardId = red.id
                        break
                    }
                }
                // 赈赡（界全琮）：没有桃时交换手牌视为使用【桃】
                const zsPeachPartner = pickZhenshanPartner(state, targetIndex, playerId)
                if (zsPeachPartner !== undefined) {
                    payload.action = 'zhenshan'
                    payload.targetIndex = zsPeachPartner
                }
            }
            break
        }
        case ResponseType.SKILL_ACTIVATE_CONFIRM: {
            const self = state.generals[targetIndex]
            const skillId = (ctx.skillId as string) ?? ''
            // 默认放弃；下列分支只在确有收益时改为 confirm
            payload.action = 'decline'

            // 带选项的技能：直接选择收益最高的选项
            const aiOptions = ctx.options as { action: string; label: string }[] | undefined
            if (aiOptions && aiOptions.length > 0) {
                payload.action = pickSkillOption(state, self, playerId, skillId, aiOptions, ctx)
                break
            }

            // 洛书版扩展（二）：无额外代价、只有收益的时机技直接确认
            const aiAutoConfirm = new Set([
                'xunyu_jieming', 'chenqun_faen', 'caoren_jiewei_front', 'xiahouyuan_shebian',
                'xunyu_quhu', 'taishici_tianyi', 'gaoshun_xianzhen', 'zhurong_lierend',
                'sunjian_wulie', 'bulianshi_zhuiyi', 'zhoufang_youdi', 'yanliang_shuangxiong',
                'lusu_haoshi', 'zhoufei_kongsheng', 'caoren_jushou', 'guanyinping_wuji',
                'xiahoudun_qingjian', 'kuailiang_jiandjiang', 'zhangzhao_guzheng',
                'zhoufei_liangyin_out', 'zhoufei_liangyin_in',
                'sunshangxiang_jie_xiaoji', 'taishici_hanzhan_gain',
                'guanqiujian_hongju',
                // 洛书版扩展（九）：纯收益时机技
                'hetaihou_qiluan', 'sunluyu_mumu', 'caochun_shanjia', 'caiwenji_sp_moshi',
                'chengyu_benyu_draw', 'lifeng_tunchu', 'panjun_guanwei', 'xizhicai_chouce',
                'liuxie_tianming', 'liuxie_tianming_other', 'shamoke_jili', 'chenlin_bifa',
            ])
            if (aiAutoConfirm.has(skillId)) {
                payload.action = 'confirm'
                break
            }
            if (skillId === 'doudizhu_feiyang') {
                // 飞扬：判定区有牌且手牌足够时清判定
                if ((self?.judgeZone.length ?? 0) > 0 && (self?.hand.length ?? 0) >= 2) {
                    payload.action = 'confirm'
                }
                break
            }
            // 洛书版扩展（七）：新增武将的发动决策
            if (skillId === 'hanhaosihuan_shenduan' || skillId === 'shanzhaoyun_zhendan_draw'
                || skillId === 'caoang_kangkai' || skillId === 'caoang_kangkai_use'
                || skillId === 'simayi_jie_upgrade') {
                payload.action = 'confirm'
                break
            }
            if (skillId === 'hanhaosihuan_yonglue') {
                // 勇略：弃置敌方判定区的牌并视为使用【杀】
                const ylJudging = state.generals[ctx.yonglueTargetIndex as number]
                if (ylJudging?.alive && isEnemy(state, ylJudging, playerId)) payload.action = 'confirm'
                break
            }
            if (skillId === 'shanzhaoyun_longlin') {
                // 龙临：只有对手杀自己（或队友）时才值得弃牌
                const llAttacker = state.generals[ctx.longlinUserIndex as number]
                if (llAttacker?.alive && isEnemy(state, llAttacker, playerId)
                    && (self?.hand.length ?? 0) > 1) payload.action = 'confirm'
                break
            }
            if (skillId === 'shanzhaoyun_longlin_duel') {
                // 龙临：对方主动拼决斗多半亏，手牌多时再上
                if ((self?.hand.length ?? 0) >= 3) payload.action = 'confirm'
                break
            }
            if (skillId === 'qinmi_jianzheng') {
                const jzAtk = state.generals[ctx.jianzhengAttackerIndex as number]
                if (jzAtk && isEnemy(state, jzAtk, playerId)) payload.action = 'confirm'
                break
            }
            if (skillId === 'qinmi_zhuandui_atk' || skillId === 'qinmi_zhuandui_def') {
                if ((self?.hand.length ?? 0) >= 2) payload.action = 'confirm'
                break
            }
            if (skillId === 'kanze_xiashu') {
                // 下书：手牌少时才值得交出去换牌
                if ((self?.hand.length ?? 0) <= 2) payload.action = 'confirm'
                break
            }
            // 洛书版扩展（四）：新增武将的发动决策
            if (skillId === 'guohuai_jingce' || skillId === 'zhuhuan_fenli_discard'
                || skillId === 'xujing_yuxu') {
                payload.action = 'confirm'
                break
            }
            if (skillId === 'zhugezhan_zuilun') {
                // 罪论：有满足的选项才发动（否则要与一名角色各失去1点体力）
                if (((ctx.zuilunMet as string[]) ?? []).length > 0) payload.action = 'confirm'
                break
            }
            if (skillId === 'xujing_shijian') {
                // 实荐：给队友补【誉虚】才有意义
                const sjTarget = state.generals[ctx.shijianTargetIndex as number]
                if (sjTarget && !isEnemy(state, sjTarget, playerId) && (self?.hand.length ?? 0) > 1) {
                    payload.action = 'confirm'
                }
                break
            }
            if (skillId === 'zhangxiu_congjian') {
                if ((self?.hand.length ?? 0) > 1) payload.action = 'confirm'
                break
            }
            switch (skillId) {
                case 'caocao_jianxiong': {
                    // 奸雄：收回造成伤害的牌，无额外代价
                    if (typeof ctx.damageCardId === 'string') payload.action = 'confirm'
                    break
                }
                case 'simayi_fankui': {
                    // 反馈：获取伤害来源一张牌，需要对方有牌
                    const source = state.generals[ctx.sourceGeneralIndex]
                    if (source && (source.hand.length > 0 || equippedCards(source).length > 0)) {
                        payload.action = 'confirm'
                    }
                    break
                }
                case 'guojia_yiji':
                case 'guojia_jie_yiji': {
                    // 遗计：摸2张并分配给任意角色（含自己）
                    if (state.deck.length > 0) payload.action = 'confirm'
                    break
                }
                case 'xiahoudun_ganglie': {
                    // 刚烈：判定非♥则伤害来源弃2牌或受1伤
                    const attacker = state.generals[ctx.attackerGeneralIndex]
                    if (state.deck.length > 0 && attacker?.alive) payload.action = 'confirm'
                    break
                }
                case 'machao_tieqi':
                case 'machao_jie_tieqi': {
                    // 铁骑：判定成功则目标不能出闪，只对敌方有利；被借刀杀人逼着砍队友时不应发动
                    const tieqiTarget = state.generals[ctx.tieqiTargetIndex]
                    if (state.deck.length > 0 && tieqiTarget?.alive && isEnemy(state, tieqiTarget, playerId)) {
                        payload.action = 'confirm'
                    }
                    break
                }
                case 'huangquan_jianji': {
                    // 谏计：目标自己决定是否用掉刚摸到的牌
                    payload.action = 'confirm'
                    break
                }
                case 'xiahoyuan_shensu_1':
                case 'xiahoyuan_shensu_2': {
                    // 神速：判定成功即可视为出杀/弃牌，牌堆还有牌就发动
                    if (state.deck.length > 0) payload.action = 'confirm'
                    break
                }
                case 'huanggai_kurou_draw': {
                    payload.action = 'confirm'
                    break
                }
                case 'zhenji_luoshen_continue': {
                    if (state.deck.length > 0) payload.action = 'confirm'
                    break
                }
                case 'jiangwei_zhiji_choice': {
                    payload.action = 'confirm'
                    break
                }
                case 'zhugejin_hongyuan': {
                    const hyCandidates = (ctx.candidateIndices as number[]) ?? []
                    if (hyCandidates.some((idx) => state.generals[idx]?.alive)) payload.action = 'confirm'
                    break
                }
                case 'pangde_mengjin': {
                    // 猛进：弃目标一张牌
                    const mengjinTarget = state.generals[ctx.mengjinTargetIndex]
                    if (mengjinTarget && (mengjinTarget.hand.length > 0 || equippedCards(mengjinTarget).length > 0)) {
                        payload.action = 'confirm'
                    }
                    break
                }
                case 'zhangliao_tuxi': {
                    // 突袭：改成摸敌方手牌，敌方有手牌才划算
                    if (aliveEnemies(state, playerId).some(({ g }) => g.hand.length > 0)) {
                        payload.action = 'confirm'
                    }
                    break
                }
                case 'sp_sunshangxiang_liangzhu': {
                    const healer = state.generals[ctx.healerIndex as number]
                    payload.action = healer && !isEnemy(state, healer, playerId) ? 'target' : 'confirm'
                    break
                }
                case 'luxun_jie_qianxun': {
                    if (self && self.hand.length > 0) payload.action = 'confirm'
                    break
                }
                case 'sunqian_qianya': {
                    const candidates = (ctx.candidateIndices as number[]) ?? []
                    if (self && self.hand.length > 0 && candidates.length > 0) payload.action = 'confirm'
                    break
                }
                case 'lidian_wangxi': {
                    if (state.deck.length > 0) payload.action = 'confirm'
                    break
                }
                case 'xunyou_zhiyu': {
                    if (state.deck.length > 0) payload.action = 'confirm'
                    break
                }
                case 'litong_tuifeng': {
                    if (self && self.hand.length > 1) payload.action = 'confirm'
                    break
                }
                case 'yanyan_juzhan': {
                    payload.action = 'confirm'
                    break
                }
                case 'ganning_jie_fenwei': {
                    const protectedIdx = (ctx.fenweiProtected as number[]) ?? []
                    if (protectedIdx.length >= 2) payload.action = 'confirm'
                    break
                }
                case 'madai_qianxi': {
                    const qianxiTargets = (ctx.qianxiCandidates as number[]) ?? []
                    if (state.deck.length > 0 && qianxiTargets.length > 0) payload.action = 'confirm'
                    break
                }
                case 'lidian_xunxun': {
                    if (state.deck.length >= 2) payload.action = 'confirm'
                    break
                }
                case 'lingtong_xuanfeng': {
                    const xfTargets = (ctx.xuanfengCandidates as number[]) ?? []
                    if (xfTargets.length > 0) payload.action = 'confirm'
                    break
                }
                case 'caifuren_qieting': {
                    if (state.deck.length > 0) payload.action = 'confirm'
                    break
                }
                case 'taishici_hanzhan': {
                    // 酣战①：对手改为随机出牌，只有在对手是敌方时才划算
                    const pinOpp = state.pindian
                        ? state.generals[state.pindian.opponentIndex]
                        : undefined
                    if (pinOpp && isEnemy(state, pinOpp, playerId)) payload.action = 'confirm'
                    break
                }
                case 'zhangfei_tishen': {
                    // 替身：限定技，损失2点体力以上或濒死时才用
                    if (self && (self.maxHp - self.hp >= 2 || self.hp <= 1)) payload.action = 'confirm'
                    break
                }
                case 'wangyi_zhenlie':
                case 'wangyi_jie_zhenlie': {
                    // 贞烈：失去1点体力令对方使用的牌无效，只对敌方的牌发动
                    const zlSourceIdx = ctx.attackerIndex
                    const zlSource = typeof zlSourceIdx === 'number' ? state.generals[zlSourceIdx] : undefined
                    if (self && self.hp > 1 && zlSource && isEnemy(state, zlSource, playerId)) {
                        payload.action = 'confirm'
                    }
                    break
                }
                case 'jushou_jianying': {
                    if (state.deck.length > 0) payload.action = 'confirm'
                    break
                }
                case 'yuejin_xiaoguo': {
                    if (self && self.hand.length > 0) payload.action = 'confirm'
                    break
                }
                case 'diaochan_biyue': {
                    if (state.deck.length > 0) payload.action = 'confirm'
                    break
                }
                case 'zumao_yinbing': {
                    if (self && self.hand.some((c) => c.category !== CardCategory.BASIC)) payload.action = 'confirm'
                    break
                }
                case 'daqiao_liuli': {
                    // 流离：手里有闪就直接闪，没必要弃牌
                    const attacker = state.generals[ctx.attackerIndex]
                    if (!self || self.hand.some(isDodge)) break
                    // 弃掉武器后攻击范围会变为 1，需按弃牌后的范围判断能否转移
                    const canTransfer = (card: Card) => {
                        const range = self.equip.weapon?.id === card.id ? 1 : (self.equip.weapon?.attackRange ?? 1)
                        return state.generals.some(
                            (g) => g.alive && g !== self && g !== attacker &&
                                getAttackRange(self, g, state.generals).distance <= range
                        )
                    }
                    const liuliCard = [...self.hand, ...equippedCards(self)]
                        .sort((a, b) => keepValue(a) - keepValue(b))
                        .find(canTransfer)
                    if (liuliCard) {
                        payload.action = 'confirm'
                        payload.cardId = liuliCard.id
                    }
                    break
                }
                case 'xiaoqiao_tianxiang':
                case 'xiaoqiao_tianxiang_luoshu': {
                    // 天香：弃♥牌把伤害转给敌方（红颜使♠也可弃）
                    if (!self) break
                    const isHeartLike = (c: Card) =>
                        c.suit === CardSuit.HEART ||
                        (c.suit === CardSuit.SPADE && knowsSkill(self, 'xiaoqiao_hongyan'))
                    const heart = [...self.hand].filter(isHeartLike).sort((a, b) => keepValue(a) - keepValue(b))[0]
                    const hasEnemy = aliveEnemies(state, playerId).some(({ index }) => index !== targetIndex)
                    if (heart && hasEnemy) {
                        payload.action = 'confirm'
                        payload.cardId = heart.id
                    }
                    break
                }
                case 'equip_stone_axe': {
                    // 贯石斧：弃2张牌让杀命中，只在能斩杀或打主帅时值得
                    const axeTarget = state.generals[ctx.targetIndex]
                    if (!self || !axeTarget?.alive) break
                    const worthIt = axeTarget.hp <= 2 || axeTarget.seatRole === SeatRole.COMMANDER
                    if (!worthIt) break
                    const axeId = self.equip.weapon?.id
                    const cardIds = lowestValueCardsWithEquip(self, 2, axeId ? [axeId] : [])
                    if (cardIds.length === 2) {
                        payload.action = 'confirm'
                        payload.cardIds = cardIds
                    }
                    break
                }
                case 'equip_green_dragon': {
                    // 青龙偃月刀：再出一张杀追杀
                    const slash = self?.hand.find(isSlash)
                    if (slash) {
                        payload.action = 'confirm'
                        payload.cardId = slash.id
                    }
                    break
                }
                case 'equip_ice_sword': {
                    // 寒冰剑：弃目标2张牌代替伤害
                    const iceTarget = state.generals[ctx.targetIndex]
                    if (iceTarget?.alive && (iceTarget.hand.length > 0 || equippedCards(iceTarget).length > 0)) {
                        payload.action = 'confirm'
                    }
                    break
                }
                case 'equip_kylin_bow': {
                    // 麒麟弓：目标有马才发动（放弃同样造成伤害）。
                    // 注意：confirm 后的 EQUIP_KYLIN_BOW_CHOICE 会先造伤再弹出自身 pending，
                    // 若本次伤害直接打死目标，濒死询问会被误弹出导致卡死，因此致死的伤害一律放弃。
                    const bowTarget = state.generals[ctx.targetIndex]
                    const bowDamage = (ctx.killDamage as number) ?? 1
                    const bowNature = (ctx.attackCard as Card | undefined)?.nature
                    const chainRisk = !!bowTarget?.chained && (bowNature === 'fire' || bowNature === 'thunder')
                    if (bowTarget?.alive &&
                        (bowTarget.equip.plus_horse || bowTarget.equip.minus_horse) &&
                        bowTarget.hp > bowDamage &&
                        !chainRisk) {
                        payload.action = 'confirm'
                    }
                    break
                }
                case 'equip_kylin_bow_auto': {
                    // 只有一匹马：auto 分支会先移除自身再结算，安全；同样避开致死与铁索传导
                    const bowTarget = state.generals[ctx.targetIndex]
                    const bowDamage = (ctx.killDamage as number) ?? 1
                    const bowNature = (ctx.attackCard as Card | undefined)?.nature
                    const chainRisk = !!bowTarget?.chained && (bowNature === 'fire' || bowNature === 'thunder')
                    if (bowTarget?.alive && bowTarget.hp > bowDamage && !chainRisk) payload.action = 'confirm'
                    break
                }
                case 'equip_double_swords': {
                    // 雌雄双股剑：有手牌才能逼对方弃牌，否则等于白送对方一张牌
                    if ((self?.hand.length ?? 0) > 0) payload.action = 'confirm'
                    break
                }
                case 'chengong_mingce': {
                    // 明策：受牌者的选择 —— 能对敌方出杀就出杀，否则摸一张牌
                    const mingceIdx = ctx.mingceSlashTargetIndex as number
                    const mingceTarget = typeof mingceIdx === 'number' && mingceIdx >= 0
                        ? state.generals[mingceIdx] : undefined
                    payload.action = mingceTarget?.alive && isEnemy(state, mingceTarget, playerId)
                        ? 'mingce_slash'
                        : 'mingce_draw'
                    break
                }
                case 'fuwan_moukui': {
                    // 谋溃：摸一 / 弃一 / 两项都选（都选才会在杀被抵消时被反弃一张）
                    const moukuiTarget = state.generals[ctx.moukuiTargetIndex]
                    const moukuiHasCard = !!moukuiTarget && moukuiTarget.alive &&
                        (moukuiTarget.hand.length > 0 || equippedCards(moukuiTarget).length > 0)
                    const moukuiOptions = (ctx.options as { action: string }[] | undefined) ?? []
                    const has = (action: string) => moukuiOptions.some((o) => o.action === action)
                    if (moukuiHasCard && isEnemy(state, moukuiTarget, playerId)) {
                        // 目标手牌多时拆牌更值；自己手牌少时两项都要（反正被杀抵消要还一张）
                        const self = state.generals[targetIndex]
                        const both = has('moukui_both') && (self?.hand.length ?? 0) <= 2
                            && moukuiTarget.hand.length >= 2
                        payload.action = both ? 'moukui_both' : 'moukui_discard'
                    } else {
                        payload.action = 'moukui_draw'
                    }
                    break
                }
                case 'xuchu_luoyi': {
                    // 裸衣：亮三张换基本牌/武器/【决斗】，手里有杀或牌太少时都值得
                    const luoyiSelf = state.generals[targetIndex]
                    if (luoyiSelf && (luoyiSelf.hand.some(c => isSlash(c) || c.name === TrickCardName.DUEL) ||
                        luoyiSelf.hand.length <= 2)) {
                        payload.action = 'confirm'
                    }
                    break
                }
                case 'huangquan_quanjian': {
                    // 劝谏：己方黄权则交牌，敌方则拒绝（令其摸牌且本回合不能用手牌）
                    const quanjianUser = state.generals[ctx.quanjianUserIndex]
                    if (quanjianUser && !isEnemy(state, quanjianUser, playerId)) payload.action = 'confirm'
                    break
                }
                case 'caifuren_xianzhou': {
                    // 献州：己方蔡夫人则回血，敌方则令其造成伤害
                    const xianzhouUser = state.generals[ctx.xianzhouUserIndex]
                    if (xianzhouUser && !isEnemy(state, xianzhouUser, playerId)) payload.action = 'confirm'
                    break
                }
                case 'wangping_feijun': {
                    // 飞军：敌方王平且自己有装备时交装备，避免其摸两张
                    const feijunUser = state.generals[ctx.feijunUserIndex]
                    const feijunSelf = state.generals[targetIndex]
                    if (feijunUser && feijunSelf && isEnemy(state, feijunUser, playerId)
                        && equippedCards(feijunSelf).length > 0) {
                        payload.action = 'confirm'
                    }
                    break
                }
                case 'xiahoudun_jing_ganglie': {
                    // 刚烈（竞）：有敌方角色且牌堆非空时发动
                    if (state.deck.length > 0
                        && state.generals.some(g => g.alive && isEnemy(state, g, playerId))) {
                        payload.action = 'confirm'
                    }
                    break
                }
                case 'wangyi_miji': {
                    // 秘计：已受伤时摸 X 张，总是发动
                    const mijiSelf = state.generals[targetIndex]
                    if (mijiSelf && mijiSelf.hp < mijiSelf.maxHp) payload.action = 'confirm'
                    break
                }
                case 'wangyi_miji_give': {
                    // 秘计交牌：有队友就交
                    const giver = state.generals[targetIndex]
                    if (giver && myGenerals(state, playerId).some(({ g }) => g.alive && g !== giver)) {
                        payload.action = 'confirm'
                    }
                    break
                }
                case 'sunqian_shuomeng': {
                    const speaker = state.generals[targetIndex]
                    if (speaker && speaker.hand.length > 0) payload.action = 'confirm'
                    break
                }
                case 'wangji_qizhi': {
                    const candidates = (ctx.qizhiCandidates as number[]) ?? []
                    if (candidates.length > 0) payload.action = 'confirm'
                    break
                }
                case 'wangji_jinqu': {
                    payload.action = 'confirm'
                    break
                }
                case 'luxun_jie_lianying': {
                    if (state.deck.length > 0) payload.action = 'confirm'
                    break
                }
                case 'sunshangxiang_xiaoji': {
                    if (state.deck.length > 0) payload.action = 'confirm'
                    break
                }
                case 'dengai_tuntian': {
                    if (state.deck.length > 0) payload.action = 'confirm'
                    break
                }
                case 'pangde_jianchu': {
                    const jcTarget = state.generals[ctx.jianchuTargetIndex as number]
                    if (jcTarget && (jcTarget.hand.length > 0 || equippedCards(jcTarget).length > 0)) {
                        payload.action = 'confirm'
                    }
                    break
                }
                case 'wangping_feijun_option': {
                    const fjTarget = state.generals[ctx.feijunTargetIndex as number]
                    if (fjTarget) payload.action = fjTarget.hand.length > 0 ? 'give' : 'equip'
                    break
                }
                case 'xuyou_shicai': {
                    if (state.deck.length > 0 || state.discard.length > 0) payload.action = 'confirm'
                    break
                }
                case 'guotu_jigong': {
                    if (self && self.hand.length <= 2) payload.action = 'confirm'
                    break
                }
                case 'luji_zhenglun': {
                    if (self && self.hand.length >= 2) payload.action = 'confirm'
                    break
                }
                case 'fazheng_xuanhuo': {
                    if (self && self.hand.length <= 2) payload.action = 'confirm'
                    break
                }
                case 'xiahoushi_qiaoshi': {
                    payload.action = 'confirm'
                    break
                }
                case 'masu_zhiman': {
                    const zhimanVictim = state.generals[ctx.zhimanTargetIndex as number]
                    if (zhimanVictim && isEnemy(state, zhimanVictim, playerId)
                        && (zhimanVictim.hand.length > 0 || equippedCards(zhimanVictim).length > 0)) {
                        payload.action = 'confirm'
                    }
                    break
                }
                // ══ 洛书版扩展（五）：新增武将（确认类） ══
                case 'zhonghui_quanji': {
                    // 权计：摸一张牌并把一张手牌变成“权”，只有收益
                    if (state.deck.length > 0) payload.action = 'confirm'
                    break
                }
                case 'zhangchunhua_shangshi': {
                    // 伤逝：手牌补至已损体力，无代价
                    if (state.deck.length > 0) payload.action = 'confirm'
                    break
                }
                case 'zhangsong_qiangshi': {
                    // 强识：有人有手牌就观看
                    if (state.generals.some((g) => g.alive && g.hand.length > 0 && g !== self)) {
                        payload.action = 'confirm'
                    }
                    break
                }
                case 'fuhuanghou_chuikong': {
                    // 惴恐：赢则封锁对方本回合的目标；输则给一张牌并挨一刀
                    const ckFoe = state.generals[ctx.chuikongOpponentIndex as number]
                    const ckCards = self?.hand ?? []
                    const ckFoeCards = ckFoe?.hand ?? []
                    if (ckFoe && ckCards.length > 0 && ckFoeCards.length > 0) {
                        const myBig = Math.max(...ckCards.map((c) => c.value))
                        const foeBig = Math.max(...ckFoeCards.map((c) => c.value))
                        // 己方血少时更值得赌；对方可能有大牌时收敛
                        if (myBig >= foeBig - 2 || (self?.hp ?? 3) <= 1) payload.action = 'confirm'
                    }
                    break
                }
                case 'caochong_renxin': {
                    // 仁心：翻面+弃装备牌救濒死队友
                    const rxTarget = state.generals[ctx.renxinTargetIndex as number]
                    const rxSelf = state.generals[targetIndex]
                    const rxHasEquip = !!rxSelf && (equippedCards(rxSelf).length > 0
                        || rxSelf.hand.some((c) => c.category === CardCategory.EQUIPMENT))
                    if (rxTarget && rxHasEquip && !isEnemy(state, rxTarget, playerId)) {
                        payload.action = 'confirm'
                    }
                    break
                }
                case 'caochong_chengxiang': {
                    // 称象：亮牌后获得点数之和≤13的任意张，纯收益
                    if (state.deck.length > 0) payload.action = 'confirm'
                    break
                }
                case 'caorui_huituo': {
                    // 恢拓：令一名角色判定（红回血/黑摸牌），总有收益
                    if (state.deck.length > 0) payload.action = 'confirm'
                    break
                }
                case 'liufeng_xiansi': {
                    // 陷嗣①：取其他角色各一张牌变成“逆”
                    if (state.generals.some((g) => g.alive && g !== self
                        && (g.hand.length > 0 || equippedCards(g).length > 0))) {
                        payload.action = 'confirm'
                    }
                    break
                }
                case 'liufeng_xiansi_use': {
                    // 陷嗣②：移去两张“逆”，视为对刘封使用【杀】
                    const xsOwner = state.generals[ctx.xiansiOwnerIndex as number]
                    if (xsOwner && xsOwner.alive && isEnemy(state, xsOwner, playerId)) {
                        payload.action = 'confirm'
                    }
                    break
                }
                case 'zhanghe_qiaobian': {
                    // 巧变：弃一张手牌跳过本阶段，按阶段判断收益
                    if (!self || self.hand.length === 0) break
                    const zbPhase = (ctx.qiaobianPhase as string) ?? ''
                    const zbJunk = self.hand.filter((c) => !isSlash(c) && !isDodge(c) && !isPeach(c)).length
                    if (zbPhase === 'judge') {
                        // 判定阶段：判定区有自己的延时锦囊时跳过等于躲开
                        if (self.judgeZone.length > 0) payload.action = 'confirm'
                        break
                    }
                    if (zbPhase === 'draw') {
                        // 摸牌阶段：换成两次偷手牌，手牌够付代价才做
                        const zbVictims = state.generals.filter((g) => g.alive
                            && isEnemy(state, g, playerId) && g.hand.length > 0).length
                        if (zbVictims > 0 && self.hand.length >= 2) payload.action = 'confirm'
                        break
                    }
                    if (zbPhase === 'action') {
                        // 出牌阶段：只在敌方有关键装备牌时跳过
                        const zbFoeEquip = state.generals.some((g) => g.alive
                            && isEnemy(state, g, playerId) && equippedCards(g).length > 0)
                        if (zbFoeEquip && zbJunk > 0) payload.action = 'confirm'
                        break
                    }
                    if (zbPhase === 'discard') {
                        // 弃牌阶段：反正要弃，不如弃一张直接跳过整个弃牌阶段
                        if (self.hand.length > self.hp) payload.action = 'confirm'
                        break
                    }
                    break
                }
                default:
                    break
            }
            break
        }
        case ResponseType.SKILL_GANGLIE_CHOICE: {
            // 刚烈：手牌够2张就弃最没用的两张，否则宁可受1点伤害
            const hand = state.generals[targetIndex]?.hand ?? []
            if (hand.length >= 2) {
                payload.cardId = 'discard'
                payload.cardIds = lowestValueCards(hand, 2)
            }
            break
        }
        case ResponseType.SKILL_FANJIAN_CHOICE: {
            // 反间：同花色牌少就弃牌，牌多且体力吃紧时宁可失去1点体力
            const self = state.generals[targetIndex]
            const suit = ctx.fanjianSuit as CardSuit
            const sameSuit = self?.hand.filter(c => c.suit === suit).length ?? 0
            if (!self) break
            payload.action = sameSuit <= 2 || self.hp <= 2 ? 'discard' : 'loseHp'
            break
        }
        case ResponseType.SKILL_QIANXI_PICK: {
            // 潜袭：弃最没用的牌，指定最近的敌方角色
            const self = state.generals[targetIndex]
            const candidates = (ctx.candidateIndices as number[]) ?? []
            const enemyIdx = candidates.find(i => state.generals[i] && isEnemy(state, state.generals[i], playerId))
            if (!self || !self.hand.length || enemyIdx === undefined) {
                payload.cardId = 'decline'
                break
            }
            const cardId = lowestValueCards(self.hand, 1)[0]
            payload.cardId = cardId
            payload.cardIds = [cardId]
            payload.targetIndex = enemyIdx
            break
        }
        case ResponseType.SKILL_GANGLIE_TARGET: {
            // 刚烈：优先让手牌最少的敌方角色判定
            const candidates = (ctx.candidateIndices as number[]) ?? []
            const pick = candidates
                .map(i => ({ i, g: state.generals[i] }))
                .filter(({ g }) => g && isEnemy(state, g, playerId))
                .sort((a, b) => a.g.hand.length - b.g.hand.length)[0]
            payload.targetIndex = pick?.i
            break
        }
        case ResponseType.SKILL_DIANHU_TARGET: {
            // 点虎：优先指定敌方角色
            const candidates = (ctx.candidateIndices as number[]) ?? []
            const enemy = candidates.find(i => state.generals[i] && isEnemy(state, state.generals[i], playerId))
            payload.targetIndex = enemy ?? candidates[0]
            break
        }
        case ResponseType.SKILL_SHUOMENG_TARGET: {
            // 说盟：优先与敌方手牌多的角色拼点
            const candidates = (ctx.candidateIndices as number[]) ?? []
            const pick = candidates
                .map(i => ({ i, g: state.generals[i] }))
                .filter(({ g }) => g && g.alive && g.hand.length > 0)
                .sort((a, b) => Number(isEnemy(state, b.g, playerId)) - Number(isEnemy(state, a.g, playerId))
                    || b.g.hand.length - a.g.hand.length)[0]
            if (pick) payload.targetIndex = pick.i
            else payload.action = 'decline'
            break
        }
        case ResponseType.SKILL_SHUOMENG_CARD: {
            // 说盟拼点：出点数最大的手牌
            const hand = state.generals[targetIndex]?.hand ?? []
            const best = [...hand].sort((a, b) => b.value - a.value)[0]
            if (best) payload.cardId = best.id
            break
        }
        case ResponseType.SKILL_MIJI_GIVE: {
            if (ctx.phase === 'target') {
                // 秘计：优先交给手牌最少的队友
                const giver = state.generals[targetIndex]
                const candidates = ((ctx.candidateIndices as number[]) ?? [])
                    .map(i => ({ i, g: state.generals[i] }))
                    .filter(({ g }) => g && g.alive && g !== giver)
                const ally = candidates
                    .filter(({ g }) => !isEnemy(state, g, playerId))
                    .sort((a, b) => a.g.hand.length - b.g.hand.length)[0]
                const pick = ally ?? [...candidates].sort((a, b) => a.g.hand.length - b.g.hand.length)[0]
                if (pick) payload.targetIndex = pick.i
                else payload.action = 'decline'
                break
            }
            const count = Math.max(0, (ctx.count as number) ?? 0)
            const hand = state.generals[targetIndex]?.hand ?? []
            if (count > 0 && hand.length >= count) {
                payload.cardIds = [...hand]
                    .sort((a, b) => keepValue(a) - keepValue(b))
                    .slice(0, count)
                    .map(c => c.id)
            } else {
                payload.action = 'decline'
            }
            break
        }
        case ResponseType.SKILL_QIZHI_TARGET: {
            // 奇制：敌方有装备/判定牌时拆敌；否则弃“失去牌能触发技能”的队友
            // （旋风 / 枭姬 / 连营 / 屯田），这类联动比对敌人随机弃一张更值
            const candidates = (ctx.candidateIndices as number[]) ?? []
            const enemy = rankEnemies(state, playerId)
                .find(({ index, g }) => candidates.includes(index) &&
                    (equippedCards(g).length > 0 || g.judgeZone.length > 0))
            if (enemy) {
                payload.targetIndex = enemy.index
                break
            }
            const combo = candidates
                .map((index) => ({ index, g: state.generals[index] }))
                .filter(({ g }) => g && !isEnemy(state, g, playerId) &&
                    (g.hand.length > 0 || equippedCards(g).length > 0))
                .sort((a, b) => lossBenefit(b.g) - lossBenefit(a.g))[0]
            const fallback = rankEnemies(state, playerId).find(({ index }) => candidates.includes(index))
            payload.targetIndex = combo && lossBenefit(combo.g) > 0
                ? combo.index
                : fallback?.index ?? candidates[0]
            if (payload.targetIndex === undefined) payload.action = 'decline'
            break
        }
        case ResponseType.SKILL_CHOOSE_TARGET: {
            const skillId = ctx.skillId as string
            const candidates = (ctx.candidateIndices as number[]) ?? []
            if (skillId === 'dongyun_sheyan') {
                // 舍宴：让使用者的同阵营角色也吃到这张锦囊（若是自己人则放弃）
                const casterIdx = ctx.sheyanCasterIndex as number | undefined
                const caster = casterIdx === undefined ? undefined : state.generals[casterIdx]
                const casterSide = caster
                    ? candidates.filter((idx) => {
                        const g = state.generals[idx]
                        return g?.alive && g.faction === caster.faction
                    })
                    : []
                if (casterSide.length > 0) payload.targetIndex = casterSide[0]
                else payload.action = 'decline'
                break
            }
            // 洛书版扩展（九）
            if (skillId === 'chenlin_bifa') {
                const foes = candidates
                    .map((i) => ({ i, g: state.generals[i] }))
                    .filter(({ g }) => g?.alive && isEnemy(state, g, playerId))
                    .sort((a, b) => b.g.hand.length - a.g.hand.length)
                if (foes.length > 0) payload.targetIndex = foes[0].i
                else payload.action = 'decline'
                break
            }
            if (skillId === 'shenlusu_tamo') {
                payload.action = 'decline'
                break
            }
            if (skillId === 'xizhicai_xianfu') {
                const allies = candidates.filter((i) => state.generals[i]?.alive
                    && !isEnemy(state, state.generals[i], playerId) && i !== targetIndex)
                const pickAlly = allies[0] ?? candidates[0]
                if (pickAlly !== undefined) payload.targetIndex = pickAlly
                else payload.action = 'decline'
                break
            }
            if (skillId === 'caochun_shanjia_slash') {
                const foes = candidates.filter((i) => state.generals[i]?.alive
                    && isEnemy(state, state.generals[i], playerId))
                if (foes.length > 0) payload.targetIndex = foes[0]
                else payload.action = 'decline'
                break
            }
            if (skillId === 'caiwenji_sp_chenqing') {
                const allies = candidates
                    .map((i) => ({ i, g: state.generals[i] }))
                    .filter(({ g }) => g?.alive && !isEnemy(state, g, playerId))
                    .sort((a, b) => b.g.hand.length - a.g.hand.length)
                if (allies.length > 0) payload.targetIndex = allies[0].i
                else payload.action = 'decline'
                break
            }
            if (skillId === 'baoxin_yimou_give') {
                const allies = candidates.filter((i) => state.generals[i]?.alive
                    && !isEnemy(state, state.generals[i], playerId))
                if (allies.length > 0) payload.targetIndex = allies[0]
                else payload.action = 'decline'
                break
            }
            if (skillId === 'xizhicai_chouce_red') {
                const pickRed = candidates.includes(targetIndex) ? targetIndex : candidates[0]
                if (pickRed !== undefined) payload.targetIndex = pickRed
                break
            }
            if (skillId === 'xizhicai_chouce_black') {
                const foes = candidates.filter((i) => state.generals[i]?.alive
                    && isEnemy(state, state.generals[i], playerId))
                if (foes.length > 0) payload.targetIndex = foes[0]
                else payload.action = 'decline'
                break
            }
            if (skillId === 'caiwenji_sp_moshi_use') {
                const foes = candidates.filter((i) => state.generals[i]?.alive
                    && isEnemy(state, state.generals[i], playerId))
                if (foes.length > 0) payload.targetIndex = foes[0]
                else payload.action = 'decline'
                break
            }
            if (skillId === 'guanqiujian_zhengrong') {
                const enemies = candidates
                    .filter((idx) => {
                        const g = state.generals[idx]
                        return g?.alive && isEnemy(state, g, playerId)
                    })
                    .sort((a, b) => state.generals[b].hand.length - state.generals[a].hand.length)
                if (enemies.length > 0) payload.targetIndex = enemies[0]
                break
            }
            if (skillId === 'guanqiujian_qingce') {
                const enemies = candidates
                    .filter((idx) => {
                        const g = state.generals[idx]
                        return g?.alive && isEnemy(state, g, playerId)
                    })
                if (enemies.length > 0) payload.targetIndex = enemies[0]
                break
            }
            // 洛书版扩展（七）
            if (skillId === 'hanhaosihuan_shenduan') {
                const foes = candidates
                    .filter(idx => { const g = state.generals[idx]; return g?.alive && isEnemy(state, g, playerId) })
                    .sort((a, b) => state.generals[b].hand.length - state.generals[a].hand.length)
                if (foes.length > 0) payload.targetIndex = foes[0]
                break
            }
            if (skillId === 'kanze_kuanshi') {
                const friend = candidates
                    .filter(idx => { const g = state.generals[idx]; return g?.alive && !isEnemy(state, g, playerId) })
                    .sort((a, b) => state.generals[a].hp - state.generals[b].hp)[0]
                if (friend !== undefined) payload.targetIndex = friend
                break
            }
            if (skillId === 'caocao_jie_qingzheng') {
                const foes = candidates
                    .filter(idx => { const g = state.generals[idx]; return g?.alive && isEnemy(state, g, playerId) })
                    .sort((a, b) => state.generals[b].hand.length - state.generals[a].hand.length)[0]
                // 只有队友可选时宁可不发动，避免弃掉己方手牌（空负载会让这一步无法推进）
                if (foes !== undefined) payload.targetIndex = foes
                else payload.action = 'decline'
                break
            }
            if (skillId === 'kanze_xiashu') {
                const foe = candidates.find(idx => isEnemy(state, state.generals[idx], playerId))
                if (foe !== undefined) payload.targetIndex = foe
                else if (candidates.length > 0) payload.targetIndex = candidates[0]
                break
            }
            if (skillId === 'caoren_lizhan') {
                payload.targetIndices = candidates.filter(idx => {
                    const g = state.generals[idx]
                    return g?.alive && g.hp < g.maxHp
                })
                break
            }
            if (skillId === 'lusu_haoshi') {
                // 好施：候选都是手牌最少者，优先交给队友
                const ally = candidates
                    .filter(idx => state.generals[idx] && !isEnemy(state, state.generals[idx], playerId))[0]
                const pickIdx = ally ?? candidates[0]
                if (pickIdx !== undefined) payload.targetIndex = pickIdx
                break
            }
            if (skillId === 'xunyu_jieming') {
                // 节命：让自己或手牌最少的队友补牌；摸X再弃至X，牌少的收益最大
                const owner = state.generals[targetIndex]
                const best = candidates
                    .filter(idx => {
                        const g = state.generals[idx]
                        return g?.alive && (idx === targetIndex || !isEnemy(state, g, playerId))
                    })
                    .sort((a, b) => state.generals[a].hand.length - state.generals[b].hand.length)[0]
                if (best !== undefined) payload.targetIndex = best
                else if (owner && candidates.length > 0) payload.targetIndex = candidates[0]
                break
            }
            if (skillId === 'quancong_yaoming') {
                const owner = state.generals[targetIndex]
                if (!owner) break
                let best = -1
                let bestScore = -1e9
                for (const idx of candidates) {
                    const g = state.generals[idx]
                    if (!g?.alive) continue
                    const enemy = isEnemy(state, g, playerId)
                    const diff = g.hand.length - owner.hand.length
                    const score = diff > 0 ? (enemy ? 30 + diff : -20)
                        : diff < 0 ? (enemy ? -10 : 20 - g.hand.length)
                            : (enemy ? 15 : 5)
                    if (score > bestScore) {
                        bestScore = score
                        best = idx
                    }
                }
                if (best >= 0) payload.targetIndex = best
                break
            }
            if (skillId === 'zhugejin_hongyuan') {
                const allies = candidates.filter((idx) => {
                    const g = state.generals[idx]
                    return g?.alive && !isEnemy(state, g, playerId)
                })
                if (allies.length > 0) payload.targetIndices = allies.slice(0, 2)
                break
            }
            if (skillId === 'guyong_bingyi') {
                const max = Math.max(1, (ctx.maxPicks as number) ?? 1)
                const friends = candidates.filter((idx) => {
                    const g = state.generals[idx]
                    return g?.alive && !isEnemy(state, g, playerId)
                })
                payload.targetIndices = friends.slice(0, max)
                break
            }
            if (skillId === 'yufan_zhiyan') {
                const friends = candidates
                    .map((idx) => state.generals[idx])
                    .filter((g) => g?.alive && !isEnemy(state, g, playerId))
                const pick = friends.sort((a, b) => (a.hp - a.maxHp) - (b.hp - b.maxHp))[0]
                if (pick) payload.targetIndex = state.generals.indexOf(pick)
                break
            }
            if (skillId === 'liushan_fangquan') {
                // 放权：把额外回合交给最适合爆发/最缺牌的队友
                const friend = candidates
                    .map((idx) => state.generals[idx])
                    .filter((g) => g?.alive && !isEnemy(state, g, playerId))
                    .sort((a, b) => (b.hand.length - b.hp) - (a.hand.length - a.hp))[0]
                if (friend) payload.targetIndex = state.generals.indexOf(friend)
                break
            }
            if (skillId === 'sunchen_lulian') {
                // 戮连：优先烧血最少的敌人，没有敌人时只能打自己人
                const foe = candidates
                    .map((i) => ({ i, g: state.generals[i] }))
                    .filter(({ g }) => g?.alive && isEnemy(state, g, playerId))
                    .sort((a, b) => a.g.hp - b.g.hp)[0]
                payload.targetIndex = foe ? foe.i : candidates[0]
                break
            }
            if (skillId === 'zhongyao_zuoding') {
                const ally = candidates.find((idx) => state.generals[idx] && !isEnemy(state, state.generals[idx], playerId))
                if (ally !== undefined) payload.targetIndex = ally
                break
            }
            if (skillId === 'luji_yili') {
                const ally = candidates.find((idx) => state.generals[idx] && !isEnemy(state, state.generals[idx], playerId))
                if (ally !== undefined) payload.targetIndex = ally
                break
            }
            if (skillId === 'haozhao_zhengu') {
                const richest = candidates
                    .map((i) => ({ i, g: state.generals[i] }))
                    .filter(({ g }) => g?.alive && isEnemy(state, g, playerId))
                    .sort((a, b) => b.g.hand.length - a.g.hand.length)[0]
                if (richest) payload.targetIndex = richest.i
                else payload.action = 'decline'
                break
            }
            if (skillId === 'xiahoushi_yanyu_end') {
                const ally = candidates.find((idx) => state.generals[idx] && !isEnemy(state, state.generals[idx], playerId))
                const target = ally !== undefined ? ally : candidates[0]
                if (target !== undefined) payload.targetIndex = target
                break
            }
            if (skillId === 'gongsunyuan_huaiyi') {
                const max = Math.max(1, (ctx.maxPicks as number) ?? 1)
                const self = state.generals[targetIndex]
                // 获得多于一张要失去 1 点体力，换牌净收益为负，始终只取一张
                const want = 1
                const richest = candidates
                    .map((i) => ({ i, g: state.generals[i] }))
                    .filter(({ g }) => g?.alive && isEnemy(state, g, playerId)
                        && (g.hand.length > 0 || equippedCards(g).length > 0))
                    .sort((a, b) => b.g.hand.length - a.g.hand.length)
                payload.targetIndices = richest.slice(0, want).map((e) => e.i)
                if (payload.targetIndices.length === 0) payload.action = 'decline'
                break
            }
            if (skillId === 'guohuanghou_jiaozhao' || skillId === 'handang_jiefan') {
                const enemy = candidates.find((idx) => state.generals[idx] && isEnemy(state, state.generals[idx], playerId))
                const target = enemy !== undefined ? enemy : candidates[0]
                if (target !== undefined) payload.targetIndex = target
                else payload.action = 'decline'
                break
            }
            if (skillId === 'caifuren_xianzhou_damage') {
                const max = Math.max(1, (ctx.maxPicks as number) ?? 1)
                const victims = candidates
                    .filter((idx) => state.generals[idx] && isEnemy(state, state.generals[idx], playerId))
                payload.targetIndices = victims.slice(0, max)
                if (payload.targetIndices.length === 0) payload.action = 'decline'
                break
            }
            if (skillId === 'cenhun_jishe_end') {
                const max = Math.max(1, (ctx.maxPicks as number) ?? 1)
                const unchained = candidates
                    .map((i) => ({ i, g: state.generals[i] }))
                    .filter(({ g }) => g?.alive && isEnemy(state, g, playerId) && !g.chained)
                payload.targetIndices = unchained.slice(0, max).map((e) => e.i)
                break
            }
            if (skillId === 'fazheng_xuanhuo_drawer') {
                const enemy = candidates.find((idx) => state.generals[idx] && isEnemy(state, state.generals[idx], playerId))
                if (enemy !== undefined) payload.targetIndex = enemy
                break
            }
            if (skillId === 'fazheng_xuanhuo_target') {
                if (candidates[0] !== undefined) payload.targetIndex = candidates[0]
                break
            }
            if (skillId === 'guohuanghou_jiaozhao_virtual') {
                const vName = ctx.jiaozhaoVirtualName as string
                const foes = candidates
                    .map((i) => ({ i, g: state.generals[i] }))
                    .filter(({ g }) => g?.alive && isEnemy(state, g, playerId))
                if (vName === 'attack') {
                    const best = foes.sort((a, b) => a.g.hp - b.g.hp)[0]
                    if (best) payload.targetIndex = best.i
                } else if (vName === 'steal') {
                    const richest = foes.sort((a, b) =>
                        (b.g.hand.length + equippedCards(b.g).length)
                        - (a.g.hand.length + equippedCards(a.g).length))[0]
                    if (richest) payload.targetIndex = richest.i
                } else {
                    const foe = foes[0]
                    if (foe) payload.targetIndex = foe.i
                }
                if (payload.targetIndex === undefined && candidates[0] !== undefined) {
                    payload.targetIndex = candidates[0]
                }
                break
            }
            // 洛书版扩展（四）：新增武将选目标
            if (skillId === 'zhuhuan_pingkou') {
                const max = Math.max(1, (ctx.maxPicks as number) ?? 1)
                const victims = candidates
                    .map((i) => ({ i, g: state.generals[i] }))
                    .filter(({ g }) => g?.alive && isEnemy(state, g, playerId))
                    .sort((a, b) => a.g.hp - b.g.hp)
                payload.targetIndices = victims.slice(0, max).map((e) => e.i)
                if (payload.targetIndices.length === 0) payload.action = 'decline'
                break
            }
            if (skillId === 'sunxiu_xingxue') {
                const max = Math.max(1, (ctx.maxPicks as number) ?? 1)
                const friends = candidates
                    .map((i) => ({ i, g: state.generals[i] }))
                    .filter(({ g }) => g?.alive && !isEnemy(state, g, playerId))
                    .sort((a, b) => (a.g.hp - a.g.maxHp) - (b.g.hp - b.g.maxHp))
                payload.targetIndices = friends.slice(0, max).map((e) => e.i)
                if (payload.targetIndices.length === 0) payload.action = 'decline'
                break
            }
            if (skillId === 'liru_juece') {
                const victim = candidates
                    .map((i) => ({ i, g: state.generals[i] }))
                    .filter(({ g }) => g?.alive && isEnemy(state, g, playerId))
                    .sort((a, b) => a.g.hp - b.g.hp)[0]
                if (victim) payload.targetIndex = victim.i
                else payload.action = 'decline'
                break
            }
            if (skillId === 'zhugezhan_zuilun_hp') {
                const victim = candidates
                    .map((i) => ({ i, g: state.generals[i] }))
                    .filter(({ g }) => g?.alive && isEnemy(state, g, playerId))
                    .sort((a, b) => a.g.hp - b.g.hp)[0]
                const target = victim?.i ?? candidates[0]
                if (target !== undefined) payload.targetIndex = target
                break
            }
            if (skillId === 'lisu_xianzhu') {
                // 献珠：锁定技，优先给自己（避免被强制视为出【杀】）
                const selfIdx = candidates.find((i) => i === targetIndex)
                if (selfIdx !== undefined) payload.targetIndex = selfIdx
                else if (candidates[0] !== undefined) payload.targetIndex = candidates[0]
                break
            }
            if (skillId === 'lisu_xianzhu_slash') {
                const victim = candidates
                    .map((i) => ({ i, g: state.generals[i] }))
                    .filter(({ g }) => g?.alive && isEnemy(state, g, playerId))
                    .sort((a, b) => a.g.hp - b.g.hp)[0]
                if (victim) payload.targetIndex = victim.i
                else payload.action = 'decline'
                break
            }
            if (skillId === 'zhangxiu_congjian') {
                const ally = candidates
                    .map((i) => ({ i, g: state.generals[i] }))
                    .filter(({ g }) => g?.alive && !isEnemy(state, g, playerId))
                    .sort((a, b) => a.g.hand.length - b.g.hand.length)[0]
                const pick = ally ?? candidates.map((i) => ({ i }))[0]
                if (pick) payload.targetIndex = pick.i
                else payload.action = 'decline'
                break
            }
            // ══ 洛书版扩展（五）：新增武将选目标 ══
            if (skillId === 'zhangsong_qiangshi') {
                // 强识：优先观看敌方手牌最多者
                const victim = candidates
                    .map((i) => ({ i, g: state.generals[i] }))
                    .filter(({ g }) => g?.alive)
                    .sort((a, b) => (Number(isEnemy(state, b.g, playerId)) - Number(isEnemy(state, a.g, playerId)))
                        || b.g.hand.length - a.g.hand.length)[0]
                if (victim) payload.targetIndex = victim.i
                else payload.action = 'decline'
                break
            }
            if (skillId === 'fuhuanghou_xuanqiu') {
                // 求援：优先把敌方角色拖成额外目标。
                // 排除超出使用者攻击范围的人：选了也只会被判“距离太远”，结算会反复回到这一步。
                const xqUserIdx = (ctx as any).xuanqiuUserIndex as number | undefined
                const xqUser = xqUserIdx === undefined ? undefined : state.generals[xqUserIdx]
                const victim = candidates
                    .map((i) => ({ i, g: state.generals[i] }))
                    .filter(({ g }) => g?.alive && isEnemy(state, g, playerId)
                        && (!xqUser || getAttackRange(xqUser, g, state.generals).inRange))
                    .sort((a, b) => a.g.hp - b.g.hp)[0]
                if (victim) payload.targetIndex = victim.i
                else payload.action = 'decline'
                break
            }
            if (skillId === 'caorui_huituo') {
                // 恢拓：判定给自己或伤最重的队友（红色回复体力）
                const ally = candidates
                    .map((i) => ({ i, g: state.generals[i] }))
                    .filter(({ g }) => g?.alive && !isEnemy(state, g, playerId))
                    .sort((a, b) => (a.g.hp - a.g.maxHp) - (b.g.hp - b.g.maxHp))[0]
                const htIdx = ally?.i ?? (candidates.includes(targetIndex) ? targetIndex : candidates[0])
                if (htIdx !== undefined) payload.targetIndex = htIdx
                else payload.action = 'decline'
                break
            }
            if (skillId === 'liufeng_xiansi') {
                // 陷嗣：取至多两名敌方角色的各一张牌
                const max = Math.max(1, (ctx.maxPicks as number) ?? 2)
                const victims = candidates
                    .map((i) => ({ i, g: state.generals[i] }))
                    .filter(({ g }) => g?.alive && isEnemy(state, g, playerId))
                    .sort((a, b) => b.g.hand.length - a.g.hand.length)
                payload.targetIndices = victims.slice(0, max).map((v) => v.i)
                if (payload.targetIndices.length === 0) payload.action = 'decline'
                break
            }
            if (skillId === 'zhanghe_qiaobian_draw') {
                // 巧变（跳过摸牌阶段）：获得至多两名敌方角色的各一张手牌
                const max = Math.max(1, (ctx.maxPicks as number) ?? 2)
                const victims = candidates
                    .map((i) => ({ i, g: state.generals[i] }))
                    .filter(({ g }) => g?.alive && isEnemy(state, g, playerId) && g.hand.length > 0)
                    .sort((a, b) => b.g.hand.length - a.g.hand.length)
                payload.targetIndices = victims.slice(0, max).map((v) => v.i)
                if (payload.targetIndices.length === 0) payload.action = 'decline'
                break
            }
            if (skillId === 'zhanghe_qiaobian_move') {
                // 巧变（跳过出牌阶段）：先选敌方装备牌最多的来源
                const src = candidates
                    .map((i) => ({ i, g: state.generals[i] }))
                    .filter(({ g }) => g?.alive && isEnemy(state, g, playerId))
                    .sort((a, b) => equippedCards(b.g).length - equippedCards(a.g).length)[0]
                if (src) payload.targetIndex = src.i
                else payload.action = 'decline'
                break
            }
            if (skillId === 'zhanghe_qiaobian_move_to') {
                // 巧变：装备牌给自己或队友
                const dest = candidates
                    .map((i) => ({ i, g: state.generals[i] }))
                    .filter(({ g }) => g?.alive && !isEnemy(state, g, playerId))
                    .sort((a, b) => Number(b.i === targetIndex) - Number(a.i === targetIndex))[0]
                if (dest) payload.targetIndex = dest.i
                else payload.action = 'decline'
                break
            }
            const enemies = candidates.filter((idx) => isEnemy(state, state.generals[idx], playerId))
            const pick = (enemies.length > 0 ? enemies : candidates)[0]
            if (pick !== undefined) payload.targetIndex = pick
            else payload.action = 'decline'
            break
        }
        case ResponseType.SKILL_GIVE_CARDS: {
            const self = state.generals[targetIndex]
            const need = Math.max(1, (ctx.count as number) ?? 0)
            // 逆固（孙綝）：手牌紧张时不交，让对手伤害+1
            if ((ctx.skillId as string) === 'sunchen_nigu_give' && (self?.hand.length ?? 0) <= 2) {
                payload.action = 'decline'
                break
            }
            if (self && self.hand.length > 0) {
                payload.cardIds = lowestValueCards(self.hand, Math.min(need, self.hand.length))
            }
            break
        }
        case ResponseType.LANDLORD_REWARD: {
            const rewardSelf = state.generals[targetIndex]
            if (rewardSelf) {
                // 残血回体力更赚，否则摸两张
                payload.action = rewardSelf.hp < rewardSelf.maxHp ? 'recover' : 'draw'
            }
            break
        }
        case ResponseType.SKILL_PICK_CARD: {
            const self = state.generals[targetIndex]
            const skillId_pick = (ctx.skillId as string) ?? ''
            if (!self) break
            const candidates = (ctx.candidateCardIds as string[]) ?? []
            const pool = candidates.length > 0
                ? self.hand.filter((c) => candidates.includes(c.id))
                : self.hand
            const pickCount = (ctx.count as number) ?? 1
            if (skillId_pick === 'doudizhu_feiyang') {
                // 飞扬：弃两张最没用的手牌
                payload.cardIds = lowestValueCards(pool, Math.min(2, pool.length))
                break
            }
            if (skillId_pick === 'machao_jie_tieqi_keep') {
                // 铁骑：同花色牌都已由 candidateCardIds 过滤，弃价值最低的一张保住出闪机会
                payload.cardIds = lowestValueCards(pool, 1)
                break
            }
            if (skillId_pick === 'lusu_haoshi_give') {
                // 好施：须交出固定张数的牌，挑最没用的给
                payload.cardIds = lowestValueCards(pool, Math.min(pool.length, Math.max(1, pickCount)))
                break
            }
            if (skillId_pick === 'xunyu_jieming') {
                // 节命：手牌弃置至 X 张，挑最没用的弃
                payload.cardIds = lowestValueCards(pool, Math.min(pickCount, pool.length))
                break
            }
            if (skillId_pick === 'guanqiujian_hongju') {
                // 鸿举：用最没用的手牌换“荣”，觉醒优先
                payload.cardIds = lowestValueCards(pool, Math.min(pickCount, pool.length))
                break
            }
            if (skillId_pick === 'guanqiujian_qingce') {
                payload.cardIds = lowestValueCards(pool, 1)
                break
            }
            if (skillId_pick === 'fazheng_xuanhuo_gain') {
                // 眩惑：同阵营明牌，直接取其中价值最高的牌
                payload.cardIds = [...pool]
                    .sort((a, b) => keepValue(b) - keepValue(a))
                    .slice(0, Math.max(1, pickCount))
                    .map((c) => c.id)
                break
            }
            if (skillId_pick === 'bulianshi_anxu_give') {
                // 安恤：展示获得的牌交给手牌较少者——给队友留好牌，给对手丢废牌
                const receiver = state.generals[(ctx.anxuReceiverIndex as number) ?? -1]
                const sorted = [...pool].sort((a, b) => keepValue(a) - keepValue(b))
                const chosen = receiver && !isEnemy(state, receiver, playerId)
                    ? sorted[sorted.length - 1]
                    : sorted[0]
                if (chosen) payload.cardIds = [chosen.id]
                else payload.action = 'decline'
                break
            }
            if (skillId_pick === 'sundeng_kuangbi') {
                payload.cardIds = lowestValueCards(pool, Math.min(3, Math.max(1, pickCount)))
                break
            }
            if (skillId_pick === 'chengpu_chunlao') {
                const slashes = pool.filter((c) => isSlash(c))
                if (slashes.length > 0) payload.cardIds = lowestValueCards(slashes, Math.min(2, slashes.length))
                break
            }
            if (skillId_pick === 'caoxiu_jie_qingxi') {
                payload.cardIds = lowestValueCards(pool, Math.max(1, pickCount))
                break
            }
            // 洛书版扩展（四）：新增武将选牌
            if (skillId_pick === 'liru_fencheng_discard') {
                // 焚城：弃最少但要满足下限
                const need = Math.max(1, (ctx.fenchengNeed as number) ?? 1)
                payload.cardIds = lowestValueCards(pool, Math.min(pool.length, need))
                break
            }
            if (skillId_pick === 'sunxiu_xingxue') {
                // 兴学：把最没用的手牌置于牌堆顶
                payload.cardIds = lowestValueCards(pool, 1)
                break
            }
            if (skillId_pick === 'zhangxiu_congjian_give') {
                const giveIds = lowestValueCards(pool, 1)
                payload.cardIds = giveIds
                break
            }
            if (skillId_pick === 'liru_mieji_give') {
                payload.cardIds = lowestValueCards(pool, 1)
                break
            }
            if (skillId_pick === 'liru_mieji_extra') {
                payload.cardIds = lowestValueCards(pool, Math.min(pool.length, Math.max(1, pickCount)))
                break
            }
            if (skillId_pick === 'liru_mieji' || skillId_pick === 'sunxiu_yanzhu'
                || skillId_pick === 'xujing_shijian' || skillId_pick === 'xujing_yuxu_penalty') {
                payload.cardIds = lowestValueCards(pool, Math.min(pool.length, Math.max(1, pickCount)))
                break
            }
            // ══ 洛书版扩展（五）：新增武将选牌 ══
            if (skillId_pick === 'zhangsong_xiantu_give') {
                // 献图：按数交出等量牌（优先废牌）
                payload.cardIds = lowestValueCards(pool, Math.min(pool.length, Math.max(1, pickCount)))
                break
            }
            if (skillId_pick === 'zhuran_danshou_cost') {
                // 胆守：按本次项号弃牌（不足则全弃）
                payload.cardIds = lowestValueCards(pool, Math.min(pool.length, Math.max(1, pickCount)))
                break
            }
            if (skillId_pick === 'caozhang_jiangchi_recast') {
                // 将驰：重铸最没用的牌
                payload.cardIds = lowestValueCards(pool, 1)
                break
            }
            if (skillId_pick === 'zhonghui_quanji') {
                // 权计：把最没用的手牌置于钟会的武将牌上
                payload.cardIds = lowestValueCards(pool, 1)
                break
            }
            if (skillId_pick === 'fuhuanghou_xuanqiu_give') {
                // 求援：交出一张同类别不同名的牌（挑最便宜的）
                payload.cardIds = lowestValueCards(pool, 1)
                break
            }
            if (skillId_pick === 'caochong_renxin') {
                // 仁心：优先弃置手牌里的装备牌，其次装备区最不值钱的那张
                const rxHandEquip = pool.filter((c) => c.category === CardCategory.EQUIPMENT)
                if (rxHandEquip.length > 0) {
                    payload.cardIds = lowestValueCards(rxHandEquip, 1)
                    break
                }
                const rxEquipped = [...equippedCards(self)].sort((a, b) => keepValue(a) - keepValue(b))[0]
                if (rxEquipped) payload.cardIds = [rxEquipped.id]
                break
            }
            if (skillId_pick === 'mizhu_ziyuan') {
                // 资援：找出一组点数之和恰为 13 的牌（保留大牌，优先丢小点）
                const zySorted = [...pool].sort((a, b) => a.value - b.value)
                const zyTargetSum = 13
                let bestPick: Card[] = []
                let bestScore = Number.POSITIVE_INFINITY
                const walk = (start: number, sum: number, acc: Card[]) => {
                    if (sum === zyTargetSum) {
                        const score = acc.reduce((s, c) => s + keepValue(c), 0)
                        if (score < bestScore) {
                            bestScore = score
                            bestPick = [...acc]
                        }
                        return
                    }
                    for (let i = start; i < zySorted.length; i++) {
                        if (sum + zySorted[i].value > zyTargetSum) break
                        acc.push(zySorted[i])
                        walk(i + 1, sum + zySorted[i].value, acc)
                        acc.pop()
                    }
                }
                walk(0, 0, [])
                if (bestPick.length > 0) payload.cardIds = bestPick.map((c) => c.id)
                else payload.action = 'decline'
                break
            }
            if (skillId_pick === 'yufan_zongxuan') {
                // 纵玄：置回牌堆顶的牌随后由自己摸到，优先放回价值最高的
                const zxCards = state.discard.filter((c) => candidates.includes(c.id))
                payload.cardIds = [...zxCards]
                    .sort((a, b) => keepValue(b) - keepValue(a))
                    .map((c) => c.id)
                if (payload.cardIds.length === 0) payload.action = 'decline'
                break
            }
            const ids = lowestValueCards(pool, 1)
            if (ids.length > 0) {
                payload.cardIds = ids
            } else {
                const equip = equippedCards(self)[0]
                if (equip) payload.cardIds = [equip.id]
                else payload.action = 'decline'
            }
            break
        }
        case ResponseType.SKILL_JINQU_DISCARD: {
            const count = Math.max(0, (ctx.discardCount as number) ?? 0)
            const hand = state.generals[targetIndex]?.hand ?? []
            if (count > 0 && hand.length >= count) payload.cardIds = lowestValueCards(hand, count)
            break
        }
        case ResponseType.SKILL_DUFENG_CHOICE: {
            // 独锋：体力充裕时失去体力，否则废除最不重要的装备栏
            const self = state.generals[targetIndex]
            const slots = (ctx.candidateSlots as EquipSlot[]) ?? []
            if (self && self.hp > 2) {
                payload.action = 'loseHp'
            } else if (slots.length > 0) {
                payload.action = 'abolish'
                payload.slot = slots[slots.length - 1]
            } else {
                payload.action = 'loseHp'
            }
            break
        }
        case ResponseType.SKILL_ZHONGYONG_GIVE: {
            // 忠勇：把牌交给手牌最少的队友，优先给红色牌（可触发追杀）
            const self = state.generals[targetIndex]
            const recipient = myGenerals(state, playerId)
                .filter(({ g }) => g.alive && g !== self)
                .sort((a, b) => a.g.hand.length - b.g.hand.length)[0]
            if (!recipient) {
                payload.action = 'decline'
                break
            }
            const attackCard = ctx.attackCardId
                ? state.discard.find(c => c.id === ctx.attackCardId)
                : undefined
            const dodgeCardId = (ctx.dodgeCardIds as string[] | undefined)?.[0]
            const dodgeCard = dodgeCardId ? state.discard.find(c => c.id === dodgeCardId) : undefined
            const chosen = dodgeCard && isRedCard(dodgeCard)
                ? 'give_dodge'
                : attackCard
                    ? 'give_slash'
                    : 'give_dodge'
            payload.action = chosen
            payload.targetIndex = recipient.index
            break
        }
        case ResponseType.SKILL_ZHONGYONG_SLASH: {
            // 忠勇：有杀且攻击范围内有敌人时出杀
            const self = state.generals[targetIndex]
            const candidates = (ctx.candidateIndices as number[]) ?? []
            const slash = self?.hand.find(c => isSlash(c))
            const target = candidates.find(i => state.generals[i] && isEnemy(state, state.generals[i], playerId))
            if (slash && target !== undefined) {
                payload.action = 'slash'
                payload.cardId = slash.id
                payload.targetIndex = target
            } else {
                payload.action = 'decline'
            }
            break
        }
        case ResponseType.SKILL_GUANXING_ARRANGE: {
            const cards: Card[] = ctx.guanxingCards ?? []
            const keep = cards.filter((c) => isPeach(c) || isDodge(c) || isSlash(c))
            if (ctx.mode === 'xunxun') {
                // 恂恂：必须恰好两张置顶，牌堆不足时才减少
                const ranked = [...cards].sort((a, b) => keepValue(b) - keepValue(a))
                const xunTop = ranked.slice(0, Math.min(2, ranked.length))
                payload.topCardIds = xunTop.map((c) => c.id)
                payload.bottomCardIds = cards.filter((c) => !xunTop.includes(c)).map((c) => c.id)
                break
            }
            if (ctx.mode === 'zuilun') {
                // 罪论：左栏为获得的牌（数量必须为 X），右栏为放回牌堆顶的牌
                const gainLimit = Math.min((ctx.zuilunGainCount as number) ?? 0, cards.length)
                const ranked = [...cards].sort((a, b) => keepValue(b) - keepValue(a))
                const gained = ranked.slice(0, gainLimit).map((c) => c.id)
                payload.topCardIds = gained
                payload.bottomCardIds = cards.filter((c) => !gained.includes(c.id)).map((c) => c.id)
                break
            }
            if (ctx.mode === 'chengxiang') {
                // 称象：左栏为获得的牌（点数之和≤13，刚好 13 下次多亮一张），右栏进弃牌堆
                const sumLimit = (ctx.chengxiangSumLimit as number) ?? 13
                let bestIds: string[] = []
                let bestScore = -1
                const total = cards.length
                for (let mask = 0; mask < (1 << total); mask++) {
                    const picked = cards.filter((_, i) => (mask & (1 << i)) !== 0)
                    const sum = picked.reduce((s, c) => s + c.value, 0)
                    if (sum > sumLimit) continue
                    const score = picked.reduce((s, c) => s + keepValue(c), 0)
                        + (sum === sumLimit ? 400 : 0)
                    if (score > bestScore) {
                        bestScore = score
                        bestIds = picked.map((c) => c.id)
                    }
                }
                payload.topCardIds = bestIds
                payload.bottomCardIds = cards.filter((c) => !bestIds.includes(c.id)).map((c) => c.id)
                break
            }
            payload.topCardIds = keep.map((c) => c.id)
            payload.bottomCardIds = cards.filter((c) => !keep.includes(c)).map((c) => c.id)
            break
        }
        case ResponseType.SKILL_TUXI_CHOOSE: {
            // 该 pending 会多次询问，必须排除已选过的角色；无新目标时传空数组结束选择
            const max = ctx.remainingPicks ?? 2
            const picked: number[] = ctx.pickedIndices ?? []
            payload.targetIndices = aliveEnemies(state, playerId)
                .filter(({ g, index }) => g.hand.length > 0 && index !== targetIndex && !picked.includes(index))
                .slice(0, max)
                .map(({ index }) => index)
            break
        }
        case ResponseType.SKILL_FANKUI_PICK: {
            const source = state.generals[ctx.sourceGeneralIndex]
            if (source && source.hand.length > 0) {
                payload.cardId = '__random_hand__'
            } else {
                const equipCard = source ? Object.values(source.equip).find((c) => !!c) : undefined
                if (equipCard) payload.cardId = equipCard.id
            }
            break
        }
        case ResponseType.SKILL_QICE_PICK: {
            // 奇策：默认视为【决斗】，目标已在发动时选定
            payload.action = 'duel'
            break
        }
        case ResponseType.SKILL_FANJIAN_SUIT:
            payload.suit = [CardSuit.HEART, CardSuit.DIAMOND, CardSuit.SPADE, CardSuit.CLUB][randomInt(4)]
            break
        case ResponseType.SKILL_YIJI_DISTRIBUTE: {
            const cards: string[] = ctx.yijiCardIds ?? []
            const myFaction = state.players[playerId]?.faction
            const receiver = pickYijiReceiver(state.generals, targetIndex, myFaction)
            if (cards.length > 0 && receiver >= 0) {
                payload.targetIndex = receiver
                payload.cardIds = cards
            }
            break
        }
        case ResponseType.SKILL_YINGHUN_CHOOSE: {
            // 英魂：给己方（非自己）一张牌多的队友用模式A（摸X弃1），否则放弃
            const self = state.generals[targetIndex]
            const ally = myGenerals(state, playerId)
                .filter(({ g }) => g.alive && g !== self)
                .sort((a, b) => a.g.hand.length - b.g.hand.length || a.index - b.index)[0]
            const lostHp = (ctx.lostHp as number) ?? 0
            if (ally && lostHp >= 1) {
                payload.action = 'modeA'
                payload.targetIndex = ally.index
            } else {
                payload.action = 'skip'
            }
            break
        }
        case ResponseType.SKILL_YINGHUN_DISCARD: {
            const g = state.generals[targetIndex]
            const need = ctx.discardCount ?? 0
            const hand = g?.hand ?? []
            const cardIds = lowestValueCards(hand, Math.min(need, hand.length))
            payload.cardIds = cardIds
            let remain = need - cardIds.length
            const equipSlots: string[] = []
            for (const slot of EQUIP_SLOTS) {
                if (remain <= 0) break
                if (g?.equip[slot]) {
                    equipSlots.push(slot)
                    remain--
                }
            }
            if (equipSlots.length > 0) payload.equipSlots = equipSlots
            break
        }
        case ResponseType.SKILL_TIAOXIN_RESPONSE:
        case ResponseType.BORROW_SWORD_RESPONSE: {
            const cardId = pickSlash(state, targetIndex)
            if (cardId) payload.cardId = cardId
            break
        }
        case ResponseType.SKILL_LUANWU_RESPONSE: {
            const cardId = pickSlash(state, targetIndex)
            if (cardId) payload.cardId = cardId
            break
        }
        case ResponseType.SKILL_LUANWU_PICK_TARGET:
        case ResponseType.SKILL_LUANWU_EXTRA_SLASH:
        case ResponseType.SKILL_LIULI_REDIRECT: {
            // 优先把杀/伤害导向敌方，其次低血、少牌
            const candidates: number[] = ctx.candidateIndices ?? []
            const scored = candidates
                .map((index) => ({ index, g: state.generals[index] }))
                .filter(({ g }) => !!g?.alive)
                .sort((a, b) => {
                    const enemyA = isEnemy(state, a.g, playerId) ? 0 : 1
                    const enemyB = isEnemy(state, b.g, playerId) ? 0 : 1
                    return enemyA - enemyB || a.g.hp - b.g.hp || a.g.hand.length - b.g.hand.length || a.index - b.index
                })
            if (scored.length > 0) payload.targetIndex = scored[0].index
            break
        }
        case ResponseType.SKILL_TIANXIANG_CHOOSE: {
            // 洛书版天香：优先把伤害/失血转给敌方
            const luoshuCtx = pending.context as any
            if (luoshuCtx?.variant === 'luoshu') {
                const enemyPick = rankEnemies(state, playerId).filter(({ index }) => index !== targetIndex)[0]
                if (enemyPick) {
                    payload.targetIndex = enemyPick.index
                    break
                }
            }
            const target = otherAliveIndex(state, targetIndex, playerId)
            if (target !== undefined) payload.targetIndex = target
            break
        }
        case ResponseType.SKILL_SHENSU_TARGET: {
            const target = otherAliveIndex(state, targetIndex, playerId)
            if (target !== undefined) payload.targetIndex = target
            break
        }
        case ResponseType.SKILL_TIANXIANG_LUOSHU_OPTION: {
            // 天香（洛书版）：目标是敌方走伤害选项，否则让其失去体力换回弃牌
            const chosen = state.generals[(ctx as any).chosenIndex as number]
            payload.action = chosen && isEnemy(state, chosen, playerId) ? 'damage' : 'lose'
            break
        }
        case ResponseType.SKILL_KUANGGU_CHOICE: {
            const self = state.generals[targetIndex]
            payload.action = self && self.hp < self.maxHp ? 'heal' : 'draw'
            break
        }
        case ResponseType.SKILL_QIMOU_HP: {
            const maxLoss = (ctx as any).maxHpLoss as number
            const self = state.generals[targetIndex]
            const want = self && self.hp >= 3 ? Math.min(2, maxLoss) : 1
            ;(payload as any).amount = Math.max(1, want)
            break
        }
        case ResponseType.SKILL_SHENSU_EQUIP: {
            const g = state.generals[targetIndex]
            const handEquip = firstHandEquipCard(g)
            const slot = firstFilledSlot(g)
            if (handEquip) payload.cardId = handEquip
            else if (slot) payload.action = slot
            break
        }
        case ResponseType.TRICK_TARGET_CARD_PICK: {
            const victim = state.generals[ctx.targetIndex]
            if (victim) {
                const isAllyVictim = !isEnemy(state, victim, playerId)
                const delayed = victim.judgeZone.filter(isDelayedTrickInJudgeZone)
                // 队友：先处理判定区的乐/兵粮（拆掉、顺走都是在帮他）
                if (isAllyVictim) {
                    if (delayed.length > 0) {
                        payload.action = 'judge'
                        payload.cardId = delayed[0].id
                        break
                    }
                    // 队友丢牌要付代价，只有能触发枭姬/连营这类技能时才拿走装备
                    if (lossBenefit(victim) > 0) {
                        const slot = stealableEquipSlots(victim)[0]
                        if (slot) {
                            payload.action = slot
                            break
                        }
                    }
                    // 兜底：必须给出一个合法选择，否则响应会被判无效
                    payload.action = 'hand'
                    break
                }
                // 敌方：判定区的乐/兵粮通常是己方放的，不应主动拆掉；无其他牌时才处理。
                // 装备位只取技能取消不了的那些：奇才②（界黄月英）会取消对手拆其防具，
                // 选它会被引擎判为无效，整张锦囊白费（自对弈 300 局命中 12 次）。
                // 牌位按价值挑最高的：八卦阵比 1 点攻击范围的武器更值得拆。
                const slots = stealableEquipSlots(victim)
                const slot = stealSlotOf(state, playerId, victim)
                const hasOtherCards = victim.hand.length > 0 || slots.length > 0
                if (!hasOtherCards && delayed.length > 0) {
                    payload.action = 'judge'
                    payload.cardId = delayed[0].id
                } else if (slot) {
                    payload.action = slot
                } else if (victim.hand.length > 0) {
                    // 只能拿手牌（敌方手牌本就是随机，交给服务端处理）
                    payload.action = 'hand'
                } else if (delayed.length > 0) {
                    // 只有被技能保护的防具：退而处理判定区，避免给出非法选择
                    payload.action = 'judge'
                    payload.cardId = delayed[0].id
                }
            }
            break
        }
        case ResponseType.EQUIP_ICE_SWORD_PICK: {
            const victim = state.generals[ctx.iceTargetIndex]
            if (victim) {
                // 先拆关键装备，再拆手牌；奇才②保护的防具不可选
                const slot = stealSlotOf(state, playerId, victim)
                if (slot) payload.action = slot
                else if (victim.hand.length > 0) payload.action = 'hand'
            }
            break
        }
        case ResponseType.FIRE_ATTACK_SHOW: {
            const hand = state.generals[targetIndex]?.hand ?? []
            if (ctx.stage === 'show') {
                // 被火攻：展示最没用的手牌
                const showCard = [...hand].sort((a, b) => keepValue(a) - keepValue(b))[0]
                if (showCard) payload.cardId = showCard.id
                break
            }
            // 自己发动火攻：弃同花色牌造成1点火焰伤害
            const victim = ctx.victimIndex !== undefined ? state.generals[ctx.victimIndex] : undefined
            const shownSuit = ctx.shownCard?.suit
            if (!victim?.alive) break
            const sameSuit = [...hand]
                .filter((c) => c.suit === shownSuit)
                .sort((a, b) => keepValue(a) - keepValue(b))[0]
            if (!sameSuit) break
            // 弃桃/闪去换1点伤害并不划算，除非能直接斩杀
            if (keepValue(sameSuit) <= 70 || victim.hp <= 1) payload.cardId = sameSuit.id
            break
        }
        case ResponseType.EQUIP_DOUBLE_SWORDS_CHOICE: {
            // 雌雄双股剑：有手牌就弃一张最没用的，否则让攻击者摸牌
            const hand = state.generals[targetIndex]?.hand ?? []
            if (hand.length > 0) {
                payload.action = 'discard'
                payload.cardId = lowestValueCards(hand, 1)[0]
            } else {
                payload.action = 'draw'
            }
            break
        }
        case ResponseType.EQUIP_KYLIN_BOW_CHOICE: {
            // 麒麟弓：优先弃对方的 -1 马（影响其进攻），其次 +1 马
            const victim = state.generals[ctx.targetIndex]
            if (victim?.equip.minus_horse) payload.action = 'minus'
            else if (victim?.equip.plus_horse) payload.action = 'plus'
            break
        }
        case ResponseType.HARVEST_PICK: {
            // 五谷丰登：拿走池中最有价值的一张
            const pool = state.harvestPool ?? []
            const best = [...pool].sort((a, b) => keepValue(b) - keepValue(a))[0]
            if (best) payload.cardId = best.id
            break
        }
        case ResponseType.SKILL_LEIJI_TARGET: {
            // 雷击（张角）：优先敌方主帅/低血；无合适敌方且自己已受伤时可选自己
            const zhangjiao = state.generals[targetIndex]
            const candidates: number[] = Array.isArray(ctx.candidateIndices) ? ctx.candidateIndices : []
            const enemy = rankEnemies(state, playerId)
                .find(({ index }) => candidates.length === 0 || candidates.includes(index))
            if (enemy) {
                payload.targetIndex = enemy.index
                break
            }
            if (zhangjiao?.alive && zhangjiao.hp < zhangjiao.maxHp) {
                payload.targetIndex = targetIndex
                break
            }
            payload.action = 'decline'
            break
        }
        case ResponseType.JUDGE_INTERVENE: {
            // 鬼才 / 缓释 / 鬼道：只在改判对己方有利时出手
            const judging = state.generals[ctx.judgingGeneralIndex]
            const asker = state.generals[targetIndex]
            if (!judging || !asker) break
            const judgeType = ctx.judgeType as string | undefined
            const leijiTarget = judgeType === 'leiji'
                ? state.generals[typeof ctx.leijiTargetIndex === 'number' ? ctx.leijiTargetIndex : ctx.judgingGeneralIndex]
                : undefined
            // 延时锦囊可能有多张，优先用结算上下文里正在判的那张
            const delayedName = (ctx.delayedTrickName as string | undefined)
                ?? judging.judgeZone.find(isDelayedTrickInJudgeZone)?.name
            /** 判到这个花色（点数）是否就对己方有利 */
            const wantSuit = (suit: CardSuit, value?: number): boolean => {
                if (!judgeType) {
                    // 延时锦囊判定：乐不思蜀判♥解除、兵粮寸断判♣解除、闪电只有♠2~9 中雷
                    if (delayedName === TrickCardName.SUPPLY_SHORTAGE) return suit === CardSuit.CLUB
                    if (delayedName === TrickCardName.LIGHTNING) {
                        return !(suit === CardSuit.SPADE && (value ?? 0) >= 2 && (value ?? 0) <= 9)
                    }
                    return suit === CardSuit.HEART
                }
                switch (judgeType) {
                    case 'ganglie':
                        return suit !== CardSuit.HEART
                    case 'tieqi':
                    case 'eight_trigrams':
                        return suit === CardSuit.HEART || suit === CardSuit.DIAMOND
                    case 'luoshen':
                        return suit === CardSuit.SPADE || suit === CardSuit.CLUB
                    case 'leiji': {
                        // 黑色：张角对判定目标造成1点雷电伤害（并回复1点体力）
                        if (!leijiTarget) return false
                        const isBlackSuit = suit === CardSuit.SPADE || suit === CardSuit.CLUB
                        return isEnemy(state, leijiTarget, playerId) ? isBlackSuit : !isBlackSuit
                    }
                    default:
                        return false
                }
            }

            // 判定牌已经对己方有利就不再改判，免得白赔一张牌（QSanguosha 的 needRetrial）
            const currentJudge = ctx.judgeCard as Card | undefined
            if (currentJudge && wantSuit(currentJudge.suit, currentJudge.value)) break

            const isHuanshi = knowsSkill(asker, 'zhugejin_huanshi')
            const isGuicai = knowsSkill(asker, 'simayi_guicai') || knowsSkill(asker, 'simayi_jie_guicai')
            const isGuidao = knowsSkill(asker, 'zhangjiao_guidao')
            // 鬼才 / 缓释只改己方判定；鬼道可改任意角色的判定。
            // 按“发问者”所在阵营判断，而不是 AI 自己的阵营——本地对战时两者可能不同。
            if (!isGuidao && judging.faction !== asker.faction) break

            // 延时锦囊、或判定角色濒死时，值得付出的牌更贵一档（但仍不动【桃】）
            const critical = !judgeType && (!!delayedName || judging.hp <= 1)
            const maxKeep = critical ? 90 : 80
            if (isHuanshi || isGuicai) {
                const pool: Card[] = isHuanshi ? [...asker.hand, ...equippedCards(asker)] : [...asker.hand]
                const substitute = pool
                    .filter((c) => wantSuit(c.suit, c.value) && keepValue(c) <= maxKeep)
                    .sort((a, b) => keepValue(a) - keepValue(b))[0]
                if (substitute) payload.cardId = substitute.id
                break
            }
            if (isGuidao) {
                // 鬼道：只能打出黑色牌（手牌或装备区）
                const substitute = [...asker.hand, ...equippedCards(asker)]
                    .filter((c) => isBlackCard(c) && keepValue(c) <= maxKeep && wantSuit(c.suit, c.value))
                    .sort((a, b) => keepValue(a) - keepValue(b))[0]
                if (substitute) payload.cardId = substitute.id
            }
            break
        }
        default:
            break
    }

    const dc = beginDecision(state, playerId, 'respond', {
        my_hp: state.generals[targetIndex]?.hp ?? 0,
    })
    // 响应阶段的补丁层：把「这一步可以怎么响应」摊成候选，交给 veto/guard/priority 处理。
    // 只覆盖有明确备选的场景；其余 pending 的 payload 由上面各分支自行决定。
    applyRespondPatches(dc, pending.type, payload, state, targetIndex)
    const respondKey = respondKeyOf(pending.type, payload)
    endDecision(dc, 'respond', respondKey, [], {
        pendingType: pending.type,
        action: payload.action ?? null,
        hasCard: typeof payload.cardId === 'string',
    })
    return finishRespond(state, playerId, payload)
}

/**
 * 响应决策的规则标签。除 cardId/skillId/action 外，还有只带排列或目标数组的 pending
 * （观星/恂恂/称象的 topCardIds、突袭的 targetIndices 等）：这些同样是“执行了技能”，
 * 不能落进 decline，否则筛选与 A/B 统计会把真实技能使用算成放弃。
 */
function respondKeyOf(pendingType: string, payload: Record<string, unknown>): string {
    if (typeof payload.cardId === 'string') return `${pendingType}:card`
    if (typeof payload.skillId === 'string') return `${pendingType}:skill:${payload.skillId}`
    if (typeof payload.action === 'string') return `${pendingType}:${payload.action}`
    const ranks = payload.topCardIds as unknown
    if (Array.isArray(ranks) && ranks.length > 0) return `${pendingType}:arrange`
    const multi = payload.targetIndices as unknown
    if (Array.isArray(multi) && multi.length > 0) return `${pendingType}:targets`
    if (payload.targetIndex !== undefined) return `${pendingType}:target`
    const picked = payload.cardIds as unknown
    if (Array.isArray(picked) && picked.length > 0) return `${pendingType}:card`
    return `${pendingType}:decline`
}

/**
 * 响应阶段的补丁接入点。
 *
 * 只有「规则 AI 已经选定一个动作，还允许改掉」的场景才暴露成候选：
 * 出闪 / 用杀响应 / 救人。每个场景给出当前选择与放弃两个候选，
 * 补丁可以否决或改分。
 *
 * 没有响应的补丁时原样返回，payload 一字不动 —— 这是等价性要求：
 * 不带补丁跑出来的对局必须与扩展前逐局一致。
 */
function applyRespondPatches(
    dc: ReturnType<typeof beginDecision>,
    pendingType: string,
    payload: Record<string, unknown>,
    state: GameState,
    targetIndex: number,
): void {
    if (!dc) return
    if (!hasHookRules(dc, 'respond')) return
    const current = respondKeyOf(pendingType, payload)
    const declineKey = `${pendingType}:decline`
    const choices: Choice[] = [
        { ruleId: current, score: 60 },
        { ruleId: declineKey, score: 50 },
    ]
    const g = state.generals[targetIndex]
    const patched = applyChoicePatches(dc, 'respond', choices)
    const best = pickBestChoice(patched)
    if (!best || best.ruleId === current) return
    // 补丁把结论改成放弃：清掉当前动作
    if (best.ruleId === declineKey) {
        for (const key of ['cardId', 'skillId', 'action', 'topCardIds', 'targetIndices', 'targetIndex', 'cardIds']) {
            delete payload[key]
        }
        if (g && (pendingType === ResponseType.DODGE || pendingType === ResponseType.AOE_DODGE
            || pendingType === ResponseType.PEACH_SAVE_ASK)) {
            payload.action = 'decline'
        }
        return
    }
    // 补丁把结论改成另一个具名动作（例如放弃 → 出闪），只处理能直接映射到 cardId 的情形
    if (current.endsWith(':decline') && !best.ruleId.endsWith(':decline')) {
        const cardId = best.ruleId.endsWith(':card')
            ? pickDodge(state, targetIndex) ?? g?.hand[0]?.id
            : undefined
        if (cardId) {
            delete payload.action
            payload.cardId = cardId
        }
    }
}

/**
 * 拆/顺/寒冰剑该拿走哪个牌位。
 *
 * 旧行为固定取「武器→防具→坐骑」里第一个存在的牌位；开实验后改按保留价值挑最高的一张。
 * 两套实现都保持在这里，A/B 期间才能让同一个种子只在一方改变决策。
 */
function stealSlotOf(
    state: GameState,
    playerId: string,
    victim: GeneralView,
): EquipSlot | undefined {
    const legacy = stealableEquipSlots(victim)[0]
    if (!experimentOn(state.players[playerId]?.faction, 'steal_slot_by_value')) return legacy
    const byValue = bestStealSlot(victim, keepValue)
    if (byValue !== legacy) noteExperiment('steal_slot_by_value')
    return byValue
}

function finishRespond(state: GameState, playerId: string, payload: Record<string, unknown>): boolean {
    const pending = state.pendingResponseQueue[0]
    const before = stateDigest(state)
    let result = handleRespond(state, playerId, payload as any)
    if (result && 'error' in result) {
        console.warn('[local-ai] 首个负载被拒绝，改发放弃', { type: pending?.type, error: result.error, payload })
        result = handleRespond(state, playerId, { action: 'decline' } as any)
        if (result && 'error' in result) {
            console.warn('[local-ai] 放弃也被拒绝，强制跳过以避免卡死', { type: pending?.type, error: result.error })
            if (state.pendingResponseQueue[0] === pending) state.pendingResponseQueue.shift()
            return true
        }
    }
    // 兜底：响应未推进任何状态（引擎侧异常分支）时强制跳过该 pending，避免单机卡死
    if (pending && state.pendingResponseQueue[0] === pending && stateDigest(state) === before) {
        console.warn('[local-ai] 响应未推进状态，强制跳过以避免卡死', { type: pending.type })
        state.pendingResponseQueue.shift()
    }
    return true
}

/** 状态摘要：用于判断一次响应是否真的推进了对局（不参与决策，仅兜底） */
function stateDigest(state: GameState): string {
    const pending = state.pendingResponseQueue[0]
    return [
        state.turnPhase,
        state.activeGeneralIndex,
        state.pendingResponseQueue.length,
        pending ? `${pending.type}:${pending.targetGeneralIndex}` : '-',
        state.deck.length,
        state.discard.length,
        state.log.length,
        state.generals
            .map((g) => `${g.hp}/${g.hand.length}/${g.alive ? 1 : 0}/${equippedCards(g).length}/${g.judgeZone.length}`)
            .join(','),
    ].join('|')
}

/** 行动单元选择 */
function aiChooseUnitRaw(state: GameState, playerId: string): boolean {
    const rs = state.roundState
    const aiFaction = state.players[playerId]?.faction
    if (!aiFaction) return false
    const secondMover = rs.firstMover === Faction.WARM ? Faction.COOL : Faction.WARM

    const flanksAlive = state.generals.some(
        (g) => g.faction === aiFaction && g.seatRole !== SeatRole.COMMANDER && g.alive
    )
    // 自对弈统计：边锋先行动（第 1 大回合先手方只能选主帅）胜率高出约 8%
    if (rs.currentActionStep === 0 && aiFaction === rs.firstMover) {
        const unit = flanksAlive && rs.roundNumber > 1 ? ActionUnitType.FLANKS : ActionUnitType.COMMANDER
        return chooseActionUnit(state, playerId, unit, flankOrder(state, aiFaction)) === undefined
    }
    if (rs.currentActionStep === 2 && aiFaction === secondMover) {
        const unit = flanksAlive ? ActionUnitType.FLANKS : ActionUnitType.COMMANDER
        return chooseActionUnit(state, playerId, unit, flankOrder(state, aiFaction)) === undefined
    }
    if ((rs.currentActionStep === 4 || rs.currentActionStep === 5) && state.activeGeneralIndex < 0) {
        const expected = rs.currentActionStep === 4 ? rs.firstMover : secondMover
        if (aiFaction !== expected) return false
        // 第一个单元选过边锋后，剩下的是主帅
        const usedFlanks = rs.currentActionStep === 4 ? rs.firstMoverChoice : rs.secondMoverChoice
        const unit = usedFlanks === ActionUnitType.FLANKS ? ActionUnitType.COMMANDER : ActionUnitType.FLANKS
        return chooseActionUnit(state, playerId, unit, flankOrder(state, aiFaction)) === undefined
    }
    return false
}

function aiChooseUnit(state: GameState, playerId: string): boolean {
    const dc = beginDecision(state, playerId, 'unit')
    const progressed = aiChooseUnitRaw(state, playerId)
    if (progressed) {
        endDecision(dc, 'unit', `unit:${state.currentActionUnit ?? 'unknown'}`, [], {
            round: state.roundState?.roundNumber ?? 0,
            actionStep: state.roundState?.currentActionStep ?? 0,
            firstMover: state.roundState?.firstMover ?? null,
        })
    }
    return progressed
}

function flankOrder(state: GameState, faction: Faction): number[] {
    return state.generals
        .map((g, index) => ({ g, index }))
        .filter(({ g }) => g.faction === faction && g.alive && g.seatRole !== SeatRole.COMMANDER)
        .map(({ index }) => index)
}

function knowsSkill(g: GeneralView | undefined, skillId: string): boolean {
    if (!g) return false
    if (g.acquiredSkills?.includes(skillId)) return true
    return !!getGeneralById(g.generalId)?.skills.some((s) => s.id === skillId)
}

function distanceTo(state: GameState, from: GeneralView, to: GeneralView): number {
    return getAttackRange(from, to, state.generals).distance
}

function enemyIndices(state: GameState, playerId: string): number[] {
    return state.generals
        .map((g, index) => ({ g, index }))
        .filter(({ g }) => g.alive && isEnemy(state, g, playerId))
        .map(({ index }) => index)
}

/** 结算方向：从施放者出发，让指定一方紧接其后先结算 */
function pickDirection(state: GameState, casterIndex: number, allyFirst: boolean): 'clockwise' | 'counterclockwise' {
    const alive = state.generals.filter((g) => g.alive)
    const caster = state.generals[casterIndex]
    const i = alive.indexOf(caster)
    if (!caster || i < 0 || alive.length < 2) return 'clockwise'
    const nextIsAlly = alive[(i + 1) % alive.length].faction === caster.faction
    return nextIsAlly === allyFirst ? 'clockwise' : 'counterclockwise'
}

/** 出牌阶段执行一个动作；返回 false 表示无牌可出 */
function aiPlayOne(state: GameState, playerId: string, collectOnly = false): boolean {
    const active = getActiveGeneral(state)
    if (!active || active.playerId !== playerId) return false
    if (state.turnPhase !== TurnPhase.ACTION) return false
    const hand = active.hand ?? []
    const self = state.activeGeneralIndex

    const use = (card: Card, targetIndices: number[], extra?: Record<string, unknown>): boolean =>
        handleUseCard(state, playerId, { cardId: card.id, targetIndices, extra } as any) === undefined

    const useSkill = (skillId: string, targetIndices: number[] = [], cardIds: string[] = []): boolean =>
        handleUseSkill(state, playerId, { skillId, targetIndices, cardIds }) === undefined

    // 战略层：本回合的集火目标与对手意图（只用公开信息）
    const strategy = analyzeStrategy(state, playerId)
    // 记忆层：对手手里的明牌，以及他们下一回合大概能打出什么
    const plans = enemyPlans(state, playerId)
    const planOf = (index: number) => plans.find((p) => p.index === index)
    // 敌方按威胁排序：主帅 > 低血 > 少手牌，集火目标再额外加权
    const enemies = rankEnemies(state, playerId, strategy.focusIndex)
    const allies = myGenerals(state, playerId).filter(({ g }) => g.alive)
    const allyIndices = allies.map(({ index }) => index)
    const otherAllies = allyIndices.filter((i) => i !== self)
    const hasCard = (g: GeneralView) => g.hand.length > 0 || equippedCards(g).length > 0
    // 明牌让“谁的牌更值钱”有了实据：知道对方握着桃/无懈时优先拆他
    const knownRich = (index: number) =>
        guessHand(state, playerId, index).known.reduce((sum, c) => sum + keepValue(c), 0)
    const onceUsed = (skillId: string) => active.skillsUsedThisTurn.includes(skillId)
    const limitedUsed = (skillId: string) => active.usedLimitedSkills.includes(skillId)
    const unlimitedSlashes = knowsSkill(active, 'zhangfei_paoxiao') || active.equip.weapon?.name === EquipmentCardName.CROSSBOW

    // 出牌决策表：基础分 + 动态修正分（数值见 ai-policy.ts）。
    // 每个候选标注它属于哪条计划，由计划总分决定先走哪条线；
    // 执行成功后 aiAct 会重新进入本函数，用最新状态重新评分。
    type PlayOption = { key: string; score: number; plans: PlanKind[]; run: () => unknown }
    const options: PlayOption[] = []
    // 全部候选都收集，分数只决定规则 AI 自己挑哪个；本地模型也能看到分数<=0 的选项
    const offer = (key: string, score: number, plans: PlanKind[], run: () => unknown): void => {
        options.push({ key, score, plans, run })
    }

    const slashesInHand = hand.filter(isSlash)
    const wineCard = hand.find((c) => c.name === BasicCardName.WINE)
    const canAttack = unlimitedSlashes || state.attackUsedThisTurn === 0
    const inRangeFoes = enemies.filter(
        ({ g }) => !blockedByKongcheng(g) && getAttackRange(active, g, state.generals).inRange
    )
    // 本回合最大可造成伤害（杀 + 酒），用于判断斩杀窗口
    const damagePotential = (slashesInHand.length > 0 ? 1 : 0) + (wineCard && !active.wineDrunk ? 1 : 0)
    const killTarget = canAttack && slashesInHand.length > 0
        ? inRangeFoes.find(({ g }) => g.hp <= damagePotential)
        : undefined
    const killWindow = !!killTarget
    // 先手方拿二连，资源前置更激进；后手方四连，前期收敛保留
    const aiFaction = state.players[playerId]?.faction
    const aggressive = state.roundState?.firstMover === aiFaction
    // 受威胁程度：主帅血线优先，其次残血边锋与人数差
    const commander = myGenerals(state, playerId).find(({ g }) => g.seatRole === SeatRole.COMMANDER)?.g
    const underThreat = (commander?.hp ?? 9) <= 2 || allies.some(({ g }) => g.hp <= 1) || enemies.length > allies.length
    const enemyCommander = enemies.find(({ g }) => g.seatRole === SeatRole.COMMANDER)
    const commanderKill = !!enemyCommander && enemyCommander.g.hp <= damagePotential &&
        getAttackRange(active, enemyCommander.g, state.generals).inRange
    const tempo = matchTempo(state, playerId, { killWindow, commanderKill })
    // 对手正在针对谁：主帅被压就转防守，自己被压就提前穿防具
    if (strategy.pressureIndex >= 0) {
        const pressed = state.generals[strategy.pressureIndex]
        if (pressed?.seatRole === SeatRole.COMMANDER) tempo.defense += 10
        if (strategy.pressureIndex === self) tempo.defense += 8
    }
    // 对手在攒牌：他们大概率握着杀/无懈，决斗与关键锦囊都要打折
    if (strategy.enemySaving) tempo.hold += 8
    const deck = deckInfo(state, active)
    const peaches = hand.filter(isPeach).length
    const dodges = hand.filter(isDodge).length
    const danger = underThreat || active.hp <= 1
    const edgeGain = enemies.length > allies.length ? 1 : 0
    // 目标评分统一入口：防御期望与斩杀概率按动作类型给出，其余项共用
    const terms = (target: GeneralView, extra: { defense?: number; killChance?: number; armorMatch?: boolean; ally?: boolean; allyRisk?: number }) =>
        targetScore(target, { threat: threatLevel(target), edgeGain, chained: target.chained, ...extra })
    // 闪的风险：明牌里有闪就是 1，其余按剩余牌池里闪的密度折算
    const dodgeRisk = (target: GeneralView) =>
        handDodgeChance(state, playerId, state.generals.indexOf(target))
    // 集火加权：所有伤害动作优先压同一个目标
    const focusBias = (index: number) => (index === strategy.focusIndex ? 12 : 0)
    // 预想之后的几个回合：本大回合还剩多少角色没动，决定是提前布置还是先保命
    const team = teamView(state, playerId)
    if (team.ourRemainingTurns > team.enemyRemainingTurns) tempo.burst += 6
    else if (team.ourRemainingTurns < team.enemyRemainingTurns) tempo.defense += 8
    // 预测对手后几个回合：主帅这一轮预计要吃的伤害，决定先布防还是继续输出
    const incoming = incomingDamage(state, playerId)
    if (incoming >= 0.8) tempo.defense += Math.min(18, Math.round(incoming * 8))

    // 桃：出牌阶段只能对自己用，留一张应对濒死，确实溢出时才吃
    if (active.hp < active.maxHp) {
        const peach = hand.find(isPeach)
        const surplusPeach = peaches >= 2
        if (peach && (surplusPeach || active.hp <= 1)) {
            offer('peach', BASE_SCORE.peach + (surplusPeach ? 20 : 0) + (active.hp <= 1 ? 15 : 0),
                ['defense'], () => use(peach, [self]))
        }
    }
    // 活墨（钟繇）：手里没有桃时，黑色非基本牌当桃救急
    if (active.hp < active.maxHp && knowsSkill(active, 'zhongyao_huomo')
        && !(active.basicUsedThisTurn ?? []).includes(BasicCardName.PEACH)) {
        const blackForPeach = hand
            .filter((c) => c.category !== CardCategory.BASIC &&
                (c.suit === CardSuit.SPADE || c.suit === CardSuit.CLUB))
            .sort((a, b) => keepValue(a) - keepValue(b))[0]
        if (blackForPeach && active.hp <= 1 && !peaches) {
            offer('huomo_peach', BASE_SCORE.peach - 12, ['defense'],
                () => use(blackForPeach, [self], { huomo: 'peach' }))
        }
    }
    const drawTwo = hand.find((c) => c.name === TrickCardName.DRAW_TWO)
    if (drawTwo) offer('draw_two', BASE_SCORE.draw_two, ['value'], () => use(drawTwo, [self]))

    // 铁索：先确认过属性伤害才连；没有属性伤害时重铸本身就是过一张未知牌
    const ironChain = hand.find((c) => c.name === TrickCardName.IRON_CHAIN)
    const hasElemental = hand.some((c) => c.name === BasicCardName.FIRE_SLASH) ||
        hand.some((c) => c.name === BasicCardName.THUNDER_SLASH) ||
        hand.some((c) => c.name === TrickCardName.FIRE_ATTACK)
    const unchainedFoes = ironChain
        ? enemies
            .filter(({ g }) => !g.chained && !blockedByWeimu(g, ironChain))
            .sort((a, b) => enemyTargetScore(b.g) - enemyTargetScore(a.g) || a.index - b.index)
        : []
    // 手里有属性伤害且能连两人时，杀要等铁索结算完再出
    const wantsChainFirst = !!ironChain && hasElemental && unchainedFoes.length >= 2
    if (ironChain) {
        if (wantsChainFirst) {
            // 铁索在属性伤害前：两人传导的溢出才是主要的 +40
            offer('iron_chain', BASE_SCORE.iron_chain_ready + 40 + tempo.burst, ['burst'],
                () => use(ironChain, unchainedFoes.slice(0, 2).map(({ index }) => index)))
        } else {
            // 没有属性伤害（或连不到两人）时重铸本身就是过一张未知牌，
            // 重铸不消耗出杀次数，所以在出杀之前先过掉
            offer('iron_chain_recast', BASE_SCORE.iron_chain_recast +
                (slashesInHand.length > 0 ? 10 : 0), ['value'],
                () => use(ironChain, [], { recast: true }))
        }
    }

    const allyDeficit = allyIndices.reduce(
        (sum, i) => sum + Math.max(0, state.generals[i].maxHp - state.generals[i].hp), 0
    )
    const enemyDeficit = enemies.reduce((sum, { g }) => sum + Math.max(0, g.maxHp - g.hp), 0)
    const garden = hand.find((c) => c.name === TrickCardName.PEACH_GARDEN)
    if (garden && allyDeficit > enemyDeficit) {
        offer('peach_garden', BASE_SCORE.peach_garden + (allyDeficit - enemyDeficit) * 6, ['value'],
            () => use(garden, [], { direction: pickDirection(state, self, true) }))
    }
    const harvest = hand.find((c) => c.name === TrickCardName.HARVEST)
    if (harvest && allies.length >= enemies.length) {
        const net = (allies.length - enemies.length) * 8 + (allyDeficit > enemyDeficit ? 6 : -6)
        offer('harvest', BASE_SCORE.harvest + net, ['value'],
            () => use(harvest, [], { direction: pickDirection(state, self, true) }))
    }

    // ── 技能：每个技能单独进候选池，按“收益 − 代价 − 目标质量”评分 ──
    // 给牌类按 cardFit（这名队友能拿这张牌做什么）与两人配合权重选人。
    const alliesButSelf = allies.filter(({ index }) => index !== self)
    const giftReceiver = (card: Card | undefined) => bestGiftTarget(alliesButSelf, card, active.generalId)
    // 卖血/反击将：非致死的伤害收益要打折
    const backfire = (g: GeneralView) => (g.hp <= 1 ? 0 : damageBackfire(g))

    // 苦肉：体力充裕、手里没桃且缺牌时用 1 点体力换 2 张牌
    if (knowsSkill(active, 'huanggai_kurou')) {
        if (knowsSkill(active, 'huanggai_zhaxiang')) {
            // 界黄盖：限一次，弃 1 张最没用的牌换 3 张，还能让本阶段红杀不可闪
            if (!onceUsed('huanggai_kurou') && active.hp >= 2) {
                const fodder = [...hand].filter((c) => !isPeach(c))
                    .sort((a, b) => keepValue(a) - keepValue(b))[0]
                if (fodder) {
                    const safe = active.hp > 2 || hand.some(isPeach)
                    offer('skill:kurou', safe ? 58 : 42, ['value'],
                        () => useSkill('huanggai_kurou', [], [fodder.id]))
                }
            }
        } else if (active.hp > 2 && hand.length <= 2 && !hand.some(isPeach)) {
            offer('skill:kurou', 60 + (hand.length === 0 ? 8 : 0), ['value'],
                () => useSkill('huanggai_kurou'))
        }
    }
    // 青囊（华佗）：弃一张手牌给已受伤的角色回复 1 点，敌方只在濒死边缘才救
    const qingnangPlan = pickQingnangPlan(active, self, state.generals, aiFaction)
    if (qingnangPlan) {
        const qnTarget = state.generals[qingnangPlan.targetIndex]
        const qnHeal = (qnTarget.faction === aiFaction ? 30 : 0) +
            (qnTarget.seatRole === SeatRole.COMMANDER ? 16 : 0) +
            (qnTarget.maxHp - qnTarget.hp) * 4 + tempo.defense
        offer('skill:qingnang', qnHeal, ['defense', 'value'],
            () => useSkill('huatuo_qingnang', [qingnangPlan.targetIndex], [qingnangPlan.cardId]))
    }

    // 制衡：每换掉一张废牌都是净收益，桃/闪不参与
    if (knowsSkill(active, 'sunquan_zhiheng') && !onceUsed('sunquan_zhiheng')) {
        const paid = [...new Set([...junkCardIds(hand, 3, active), ...surplusCardIds(hand)])].slice(0, 3)
        if (paid.length > 0) {
            offer('skill:zhiheng', 52 + paid.length * 8, ['value'],
                () => useSkill('sunquan_zhiheng', [], paid))
        }
    }
    // 仁德：攒够 2 张换回血/牌差，优先给能吃下这类牌的队友
    if (knowsSkill(active, 'liubei_rende') && hand.length >= 2) {
        const rende = rendeOpportunity(active, alliesButSelf.map(({ g }) => g), active.rendeHealedThisTurn)
        if (rende.trigger) {
            const giftIds = [...hand].filter((c) => !isPeach(c))
                .sort((a, b) => keepValue(a) - keepValue(b)).slice(0, 2)
            // 按两张牌里更值钱的那张挑接收者
            const receiver = giftIds.length === 2 ? giftReceiver(giftIds[1]) : undefined
            if (receiver) {
                offer('skill:rende', (rende.wantHeal ? 66 : 50) + cardFit(receiver.g, giftIds[1]) * 4, ['value'],
                    () => useSkill('liubei_rende', [receiver.index], giftIds.map((c) => c.id)))
            }
        }
    }
    // 挑衅：目标空手时几乎无风险（只能弃牌）
    if (knowsSkill(active, 'jiangwei_tiaoxin') && !onceUsed('jiangwei_tiaoxin')) {
        const tiaoxinTarget = enemies.find(
            ({ g }) => g.hand.length === 0 && hasCard(g) && getAttackRange(g, active, state.generals).inRange
        )
        if (tiaoxinTarget) {
            offer('skill:tiaoxin', 58 - backfire(tiaoxinTarget.g) * 0.5, ['control'],
                () => useSkill('jiangwei_tiaoxin', [tiaoxinTarget.index]))
        }
    }
    // 离间：弃一张废牌，令两名男性敌人决斗
    if (knowsSkill(active, 'diaochan_lijian') && !onceUsed('diaochan_lijian')) {
        const males = enemies.filter(({ g }) => getGeneralById(g.generalId)?.gender === 'male')
        const junkCard = [...hand].filter((c) => keepValue(c) <= 70).sort((a, b) => keepValue(a) - keepValue(b))[0]
        if (males.length >= 2 && junkCard) {
            offer('skill:lijian', 60, ['control'],
                () => useSkill('diaochan_lijian', [males[0].index, males[1].index], [junkCard.id]))
        }
    }
    // 明策：给队友一张“他能用出去”的牌，令其视为对敌方出杀
    if (knowsSkill(active, 'chengong_mingce') && !onceUsed('chengong_mingce')) {
        const gift = [...hand]
            .filter((c) => (c.category === CardCategory.EQUIPMENT ? keepValue(c) <= 60 : isSlash(c)))
            .sort((a, b) => keepValue(a) - keepValue(b))[0]
        const receiver = gift ? giftReceiver(gift) : undefined
        if (gift && receiver) {
            const slashTarget = enemies.find(({ g }) =>
                g.alive && !blockedByKongcheng(g) && getAttackRange(receiver.g, g, state.generals).inRange
            )
            const targetIndices = slashTarget ? [receiver.index, slashTarget.index] : [receiver.index]
            offer('skill:mingce', 54 + cardFit(receiver.g, gift) * 4 + (slashTarget ? 6 : 0), ['value'],
                () => useSkill('chengong_mingce', targetIndices, [gift.id]))
        }
    }
    // 乱武：敌方普遍没牌且我方总血量占优才发动
    if (knowsSkill(active, 'jiaxu_luanwu') && !limitedUsed('jiaxu_luanwu')) {
        const enemyCards = enemies.reduce((sum, { g }) => sum + g.hand.length, 0)
        const myHp = allies.reduce((sum, { g }) => sum + g.hp, 0)
        const enemyHp = enemies.reduce((sum, { g }) => sum + g.hp, 0)
        if (enemies.length > 0 && enemyCards <= enemies.length && myHp >= enemyHp) {
            offer('skill:luanwu', 62, ['control'], () => useSkill('jiaxu_luanwu'))
        }
    }
    // 奇袭 / 国色 / 断粮：把废牌转化为控制，目标按判定区与手牌缺口挑
    const blackJunk = [...hand]
        .filter((c) => isBlackCard(c) && keepValue(c) <= 70)
        .sort((a, b) => keepValue(a) - keepValue(b))[0]
    if (knowsSkill(active, 'ganning_qixi') && blackJunk) {
        const target = enemies
            .filter(({ g }) => !blockedByWeimu(g, blackJunk) && (hasCard(g) || g.judgeZone.length > 0))
            .sort((a, b) => cardRiches(b.g) - cardRiches(a.g))[0]
        if (target) {
            offer('skill:qixi', 56 + (target.g.judgeZone.length > 0 ? 6 : 0), ['control'],
                () => useSkill('ganning_qixi', [target.index], [blackJunk.id]))
        }
    }
    const diamondJunk = [...hand]
        .filter((c) => c.suit === CardSuit.DIAMOND && keepValue(c) <= 70)
        .sort((a, b) => keepValue(a) - keepValue(b))[0]
    if (knowsSkill(active, 'daqiao_guose') && diamondJunk) {
        const target = enemies.find(({ g }) => !g.judgeZone.some((c) => c.name === TrickCardName.OVERINDULGENCE))
        if (target) {
            offer('skill:guose', 60 + terms(target.g, { defense: 0.3 }), ['control'],
                () => useSkill('daqiao_guose', [target.index], [diamondJunk.id]))
        }
    }
    // 国色（界大乔）：♦牌当【乐不思蜀】，或弃♦牌拆场上的【乐不思蜀】；结算后摸一张
    if (knowsSkill(active, 'daqiao_jie_guose') && !onceUsed('daqiao_jie_guose') && diamondJunk) {
        const ourLe = state.generals
            .map((g, index) => ({ g, index }))
            .filter(({ g }) => g.alive && g.faction === active.faction
                && g.judgeZone.some((c) => c.name === TrickCardName.OVERINDULGENCE))
        const jieGuoseTarget = enemies
            .find(({ g }) => !g.judgeZone.some((c) => c.name === TrickCardName.OVERINDULGENCE))
        if (ourLe.length > 0) {
            offer('skill:guose_jie_discard', 70, ['control'],
                () => useSkill('daqiao_jie_guose_discard', [ourLe[0].index], [diamondJunk.id]))
        } else if (jieGuoseTarget) {
            offer('skill:guose_jie', 58 + terms(jieGuoseTarget.g, { defense: 0.3 }), ['control'],
                () => useSkill('daqiao_jie_guose', [jieGuoseTarget.index], [diamondJunk.id]))
        }
    }
    // 结姻（界孙尚香）：弃一张牌换成“体力高者摸牌、体力低者回血”
    if (knowsSkill(active, 'sunshangxiang_jieyuan') && !onceUsed('sunshangxiang_jieyuan') && hand.length > 0) {
        const jyMale = alliesButSelf
            .filter(({ g }) => getGeneralById(g.generalId)?.gender === 'male')
            .sort((a, b) => (b.g.maxHp - b.g.hp) - (a.g.maxHp - a.g.hp))[0]
        const jyCard = [...hand].sort((a, b) => keepValue(a) - keepValue(b))[0]
        if (jyMale && jyCard && (active.hp !== jyMale.g.hp
            || active.hp < active.maxHp || jyMale.g.hp < jyMale.g.maxHp)) {
            const jyValue = (active.hp < active.maxHp ? 12 : 0) + (jyMale.g.maxHp - jyMale.g.hp) * 8 + 10
            offer('skill:jieyuan', jyValue, ['value'],
                () => useSkill('sunshangxiang_jieyuan', [jyMale.index], [jyCard.id]))
        }
    }
    // 矫诏：已声明的牌要打出去，否则这次发动就白费了
    if (active.jiaozhaoAs && active.jiaozhaoCardId) {
        const jzShown = hand.find((c) => c.id === active.jiaozhaoCardId)
        const jzFoe = inRangeFoes[0]
        if (jzShown) {
            const jzName = active.jiaozhaoAs
            if (jzName === 'peach' && active.hp < active.maxHp && active.hp <= 2) {
                offer('jiaozhao:peach', 58, ['value'], () => use(jzShown, []))
            } else if (jzName === 'wine' && !active.wineDrunk && jzFoe && slashesInHand.length > 0) {
                offer('jiaozhao:wine', 60, ['burst'], () => use(jzShown, []))
            } else if (jzName === 'attack' && jzFoe && canAttack) {
                offer('jiaozhao:attack', 56 + terms(jzFoe.g, { defense: 0.4 }), ['burst'],
                    () => use(jzShown, [jzFoe.index]))
            } else if (jzName === 'draw_two') {
                offer('jiaozhao:draw_two', 50, ['value'], () => use(jzShown, []))
            } else if (jzName === 'dismantle' || jzName === 'steal' || jzName === 'duel') {
                const jzTarget = enemies.filter(({ g }) => hasCard(g) || g.judgeZone.length > 0)
                    .sort((a, b) => cardRiches(b.g) - cardRiches(a.g))[0]
                if (jzTarget) {
                    offer('jiaozhao:trick', 54, ['control'], () => use(jzShown, [jzTarget.index]))
                }
            }
        }
    }
    // 矫诏（界郭皇后）：本阶段限一次当基本牌；修改一/二为每轮限一次的额外用法
    if (knowsSkill(active, 'simayi_jie_jiaozhao')) {
        const jzRound = state.roundState?.roundNumber ?? 0
        const jzJunk = [...hand].sort((a, b) => keepValue(a) - keepValue(b))[0]
        const jzUpgrade = active.jiaozhaoUpgrade ?? 0
        if (!onceUsed('simayi_jie_jiaozhao') && jzJunk) {
            offer('skill:jiaozhao_jie', 42, ['value'],
                () => useSkill('simayi_jie_jiaozhao', [], [jzJunk.id]))
        }
        if (jzUpgrade >= 1 && active.jiaozhaoMod1Round !== jzRound && jzJunk) {
            offer('skill:jiaozhao_jie_mod1', 38, ['value'],
                () => useSkill('simayi_jie_jiaozhao_mod1', [], [jzJunk.id]))
        }
        if (jzUpgrade >= 2 && active.jiaozhaoMod2Round !== jzRound && inRangeFoes.length > 0) {
            offer('skill:jiaozhao_jie_mod2', 52 + tempo.output, ['burst'],
                () => useSkill('simayi_jie_jiaozhao_mod2'))
        }
    }
    if (knowsSkill(active, 'xuhuang_duanliang')) {
        const blackBasic = [...hand]
            .filter((c) => isBlackCard(c) && keepValue(c) <= 70 &&
                (c.category === CardCategory.BASIC || c.category === CardCategory.EQUIPMENT))
            .sort((a, b) => keepValue(a) - keepValue(b))[0]
        const target = enemies.find(
            ({ g }) => distanceTo(state, active, g) <= 2 && !g.judgeZone.some((c) => c.name === TrickCardName.SUPPLY_SHORTAGE)
        )
        if (blackBasic && target) {
            offer('skill:duanliang', 56 + (target.g.hand.length <= 2 ? 8 : 0), ['control'],
                () => useSkill('xuhuang_duanliang', [target.index], [blackBasic.id]))
        }
    }
    // 强袭（界典韦）：弃武器几乎无代价，掉血只在能斩杀时做
    if (knowsSkill(active, 'dianwei_jie_qiangxi') && (active.qiangxiUsesPhase ?? 0) < 2
        && active.hp > 1 && enemies.length > 0) {
        const usedTargets = active.qiangxiTargetsPhase ?? []
        const qiangxiTarget = enemies
            .filter(({ index }) => !usedTargets.includes(index))
            .sort((a, b) => (enemyTargetScore(b.g) - backfire(b.g)) - (enemyTargetScore(a.g) - backfire(a.g)))[0]
        if (qiangxiTarget) {
            const junkWeapon = equippedCards(active).find(c => c.equipSlot === EquipSlot.WEAPON && keepValue(c) <= 70)
            const paidIds = junkWeapon ? [junkWeapon.id] : []
            const score = junkWeapon ? 62 : (qiangxiTarget.g.hp <= 1 ? 58 : 42)
            offer('skill:qiangxi', score - backfire(qiangxiTarget.g) * 0.5, ['burst', 'control'],
                () => useSkill('dianwei_jie_qiangxi', [qiangxiTarget.index], paidIds))
        }
    }
    // 强易（斗地主地主技）：整局一次，换走敌方一张手牌再还一张废牌
    if (knowsSkill(active, 'doudizhu_qiangyi') && state.mode === GameMode.DOUDIZHU
        && !(active.usedLimitedSkills ?? []).includes('doudizhu_qiangyi')) {
        const qyVictim = enemies
            .filter(({ g }) => g.hand.length > 0)
            .sort((a, b) => b.g.hand.length - a.g.hand.length)[0]
        const qyGive = [...hand].filter(c => keepValue(c) <= 70)
            .sort((a, b) => keepValue(a) - keepValue(b))[0]
        // 整局限一次，早用早收益：换牌不消耗出【杀】次数，手牌越多的敌人越值得换
        if (qyVictim && qyGive) {
            offer('skill:doudizhu_qiangyi', 64 + (qyVictim.g.hand.length >= 4 ? 4 : 0), ['control', 'value'],
                () => useSkill('doudizhu_qiangyi', [qyVictim.index]))
        }
    }
    // 慎行（顾雍）：手牌溢出时弃两张废牌摸一张
    if (knowsSkill(active, 'guyong_shenxing') && hand.length >= 5) {
        const shenxingCards = [...hand].sort((a, b) => keepValue(a) - keepValue(b)).slice(0, 2)
        if (shenxingCards.length === 2) {
            offer('skill:shenxing', 38, ['value'],
                () => useSkill('guyong_shenxing', [], shenxingCards.map(c => c.id)))
        }
    }
    // 去疾（司马朗）：按已损失体力回血，先救最危险的队友
    if (knowsSkill(active, 'simalang_quji') && !onceUsed('simalang_quji')) {
        const lostHp = active.maxHp - active.hp
        if (lostHp > 0 && hand.length >= lostHp) {
            const hurtAllies = otherAllies
                .map(i => ({ index: i, g: state.generals[i] }))
                .filter(a => a.g.hp < a.g.maxHp)
                .sort((a, b) => (a.g.hp - a.g.maxHp) - (b.g.hp - b.g.maxHp))
            const healTargets = [self, ...hurtAllies.map(a => a.index)].slice(0, lostHp)
            const qujiCards = [...hand].sort((a, b) => keepValue(a) - keepValue(b)).slice(0, lostHp).map(c => c.id)
            if (qujiCards.length === lostHp) {
                offer('skill:quji', 50 + lostHp * 6, ['defense'],
                    () => useSkill('simalang_quji', healTargets, qujiCards))
            }
        }
    }
    // 战绝（刘谌）：手牌不多时把全部手牌当【决斗】，本阶段最多换两次摸牌
    if (knowsSkill(active, 'liuchen_zhanjue') && (active.zhanjueDrawnThisPhase ?? 0) < 2
        && hand.length >= 1 && hand.length <= 2 && enemies.length > 0) {
        const zhanjueTarget = enemies
            .filter(({ g }) => g.hand.length > 0 || !knowsSkill(g, 'zhugeliang_kongcheng'))
            .sort((a, b) => enemyTargetScore(b.g) - enemyTargetScore(a.g))[0]
        if (zhanjueTarget && zhanjueTarget.g.hand.length <= 2) {
            offer('skill:zhanjue', 46 + (hand.length <= 1 ? 8 : 0), ['burst'],
                () => useSkill('liuchen_zhanjue', [zhanjueTarget.index]))
        }
    }
    // 势斩（界华雄）：让缺杀的敌人对自己发起决斗，每阶段至多两次
    if (knowsSkill(active, 'huaxiong_shizhan')
        && active.skillsUsedThisTurn.filter(id => id === 'huaxiong_shizhan').length < 2
        && active.hp >= 2 && enemies.length > 0) {
        const shizhanTarget = enemies
            .filter(({ g }) => g.hand.length <= 1)
            .sort((a, b) => (a.g.hp - a.g.maxHp) - (b.g.hp - b.g.maxHp))[0]
        if (shizhanTarget) {
            offer('skill:shizhan', 44, ['burst'],
                () => useSkill('huaxiong_shizhan', [shizhanTarget.index]))
        }
    }
    // 奇谋（魏延限定技）：血量充足时用体力换距离与杀次数
    if (knowsSkill(active, 'weiyan_qimou') && !limitedUsed('weiyan_qimou')
        && active.hp >= 3 && enemies.length > 0) {
        offer('skill:qimou', 52, ['burst'], () => useSkill('weiyan_qimou', []))
    }
    // 飞军（王平）：弃废牌，令敌方交牌或弃其装备
    if (knowsSkill(active, 'wangping_feijun') && !onceUsed('wangping_feijun') && hand.length >= 2) {
        const feijunCard = [...hand].sort((a, b) => keepValue(a) - keepValue(b))[0]
        const feijunTarget = enemies.find(({ g }) =>
            g.alive && (g.hand.length > active.hand.length
                || equippedCards(g).length > equippedCards(active).length))
        if (feijunTarget) {
            const score = equippedCards(feijunTarget.g).length > 0 ? 60 : 48
            offer('skill:feijun', score, ['control'],
                () => useSkill('wangping_feijun', [feijunTarget.index], [feijunCard.id]))
        }
    }
    // 谏计（黄权）：让最缺牌的队友摸一张并尝试使用
    if (knowsSkill(active, 'huangquan_jianji') && !onceUsed('huangquan_jianji')) {
        const jianjiTarget = [...alliesButSelf].sort(
            (a, b) => a.g.hand.length - b.g.hand.length || a.index - b.index)[0]
        if (jianjiTarget) {
            offer('skill:jianji', 52, ['value'],
                () => useSkill('huangquan_jianji', [jianjiTarget.index]))
        }
    }
    // 反间（界周瑜）：把最没用的牌塞给敌方，逼迫其弃牌或失血
    if (knowsSkill(active, 'zhouyu_jie_fanjian') && !onceUsed('zhouyu_jie_fanjian')
        && hand.length >= 1 && enemies.length > 0) {
        const fanjianCard = [...hand].sort((a, b) => keepValue(a) - keepValue(b))[0]
        offer('skill:fanjian', 58, ['control'],
            () => useSkill('zhouyu_jie_fanjian', [enemies[0].index], [fanjianCard.id]))
    }
    // 奋迅（丁奉）：弃废牌拉近与远处敌人的距离
    // 奋迅：只有手上还有【杀】、本回合还能杀时才值得弃牌拉近距离
    if (knowsSkill(active, 'dingfeng_fenxun') && !onceUsed('dingfeng_fenxun') && hand.length >= 2
        && hand.some(isSlash) && state.attackUsedThisTurn === 0) {
        const fenxunCard = [...hand].sort((a, b) => keepValue(a) - keepValue(b))[0]
        const fenxunTarget = enemies.find(({ g }) => g.alive && distanceTo(state, active, g) > 1)
        if (fenxunTarget) {
            offer('skill:fenxun', 44, ['control'],
                () => useSkill('dingfeng_fenxun', [fenxunTarget.index], [fenxunCard.id]))
        }
    }
    // 黩武（诸葛恪）：按目标体力付牌换 1 点伤害，只在能斩杀或目标极残时划算
    if (knowsSkill(active, 'zhugeke_duwu') && !active.duwuLockedThisPhase && hand.length >= 2) {
        const duwuTarget = enemies
            .filter(({ g }) => g.alive && g.hp >= 1 && g.hp <= hand.length &&
                getAttackRange(active, g, state.generals).inRange)
            .sort((a, b) => a.g.hp - b.g.hp || enemyTargetScore(b.g) - enemyTargetScore(a.g))[0]
        if (duwuTarget) {
            const duwuCards = [...hand].sort((a, b) => keepValue(a) - keepValue(b))
                .slice(0, duwuTarget.g.hp).map(c => c.id)
            const lethal = duwuTarget.g.hp <= 1
            offer('skill:duwu', lethal ? 62 : 34 - duwuTarget.g.hp * 3, ['burst'],
                () => useSkill('zhugeke_duwu', [duwuTarget.index], duwuCards))
        }
    }
    // 献州（蔡夫人限定技）：把装备区交给最需要牌的队友
    if (knowsSkill(active, 'caifuren_xianzhou') && !limitedUsed('caifuren_xianzhou')
        && equippedCards(active).length > 0) {
        const xianzhouAlly = bestGiftTarget(alliesButSelf, equippedCards(active)[0], active.generalId)
        if (xianzhouAlly) {
            offer('skill:xianzhou', 42, ['value'],
                () => useSkill('caifuren_xianzhou', [xianzhouAlly.index]))
        }
    }
    // 急袭（邓艾）：用“田”当顺手牵羊，优先顺有装备/判定区牌的敌人
    if (knowsSkill(active, 'dengai_jixi') && ((active as any).generalPile?.length ?? 0) > 0) {
        const jixiTarget = enemies
            .filter(({ g }) => g.alive && distanceTo(state, active, g) <= 1 &&
                (g.hand.length > 0 || equippedCards(g).length > 0))
            .sort((a, b) => cardRiches(b.g) - cardRiches(a.g))[0]
        if (jixiTarget) {
            offer('skill:jixi', 56, ['control'], () => useSkill('dengai_jixi', [jixiTarget.index]))
        }
    }
    // 奇策（荀攸）：视为【决斗】，拼点资源够才用
    if (knowsSkill(active, 'xunyou_qice') && !onceUsed('xunyou_qice')
        && hand.length >= 2 && enemies.length > 0) {
        const qiceTarget = enemies
            .find(({ g }) => g.alive && !blockedByKongcheng(g) &&
                hand.filter(isSlash).length >= Math.ceil(expectedSlashes(g.hand.length) + 1))
        if (qiceTarget) {
            offer('skill:qice', 60, ['burst'], () => useSkill('xunyou_qice', [qiceTarget.index]))
        }
    }

    // ── 洛书版新增主动技能 ──
    if (knowsSkill(active, 'xuyou_chenglue') && !onceUsed('xuyou_chenglue') && hand.length >= 2
        && junkCardIds(hand, 1).length > 0) {
        offer('skill:chenglue', 50, ['value'], () => useSkill('xuyou_chenglue', []))
    }
    if (knowsSkill(active, 'handang_gongqi') && !onceUsed('handang_gongqi')) {
        const gongqiJunk = junkCardIds(hand, 1)
        const hasDistantTarget = enemies.some(({ g }) => g.alive && !getAttackRange(active, g, state.generals).inRange)
        if (gongqiJunk.length > 0 && hand.some(isSlash) && hasDistantTarget) {
            offer('skill:gongqi', 62, ['burst'], () => useSkill('handang_gongqi', [], gongqiJunk))
        }
    }
    if (knowsSkill(active, 'handang_jiefan') && !limitedUsed('handang_jiefan')) {
        const jiefanPlan = state.generals
            .map((g, idx) => ({ g, idx }))
            .filter(({ g, idx }) => g.alive && idx !== state.activeGeneralIndex)
            .map(({ g, idx }) => ({
                idx,
                count: state.generals.filter((e) => e.alive && isEnemy(state, e, playerId)
                    && getAttackRange(e, g, state.generals).inRange).length,
            }))
            .sort((a, b) => b.count - a.count)[0]
        if (jiefanPlan && jiefanPlan.count >= 2) {
            offer('skill:jiefan', 54 + jiefanPlan.count * 4, ['control'],
                () => useSkill('handang_jiefan', [jiefanPlan.idx]))
        }
    }
    if (knowsSkill(active, 'masu_sanyao') && enemies.length > 0) {
        const sanyaoJunk = junkCardIds(hand, 1)
        const aliveGenerals = state.generals.filter((g) => g.alive)
        const topHp = Math.max(...aliveGenerals.map((g) => g.hp))
        const topHand = Math.max(...aliveGenerals.map((g) => g.hand.length))
        if (sanyaoJunk.length > 0) {
            const hpVictim = enemies.find(({ g }) => g.alive && g.hp === topHp)
            if (hpVictim && !active.skillsUsedThisTurn.includes('masu_sanyao_hp')) {
                offer('skill:sanyao_hp', 56, ['burst'],
                    () => useSkill('masu_sanyao', [hpVictim.index], sanyaoJunk))
            }
            const handVictim = enemies.find(({ g }) => g.alive && g.hand.length === topHand)
            if (handVictim && !active.skillsUsedThisTurn.includes('masu_sanyao_hand')) {
                offer('skill:sanyao_hand', 52, ['burst'],
                    () => useSkill('masu_sanyao', [handVictim.index], sanyaoJunk))
            }
        }
    }
    if (knowsSkill(active, 'cenhun_jishe') && active.hp > 1 && hand.length <= active.hp) {
        offer('skill:jishe', 30, ['value'], () => useSkill('cenhun_jishe', []))
    }
    if (knowsSkill(active, 'sundeng_kuangbi') && !onceUsed('sundeng_kuangbi')) {
        const kuangbiAlly = myGenerals(state, playerId)
            .filter(({ g }) => g.alive && g !== active && (g.hand.length > 0 || equippedCards(g).length > 0))
            .sort((a, b) => b.g.hand.length - a.g.hand.length)[0]
        if (kuangbiAlly) {
            offer('skill:kuangbi', 38, ['value'], () => useSkill('sundeng_kuangbi', [kuangbiAlly.index]))
        }
    }
    if (knowsSkill(active, 'guohuanghou_jiaozhao') && !onceUsed('guohuanghou_jiaozhao')) {
        const jiaozhaoJunk = junkCardIds(hand, 1)
        if (jiaozhaoJunk.length > 0) {
            offer('skill:jiaozhao', 42, ['value'], () => useSkill('guohuanghou_jiaozhao', [], jiaozhaoJunk))
        }
    }
    if (knowsSkill(active, 'xiahoushi_yanyu') && (active.yanyuRecast ?? 0) < 2
        && hand.filter(isSlash).length >= 2) {
        const spareSlash = [...hand].filter(isSlash).sort((a, b) => keepValue(a) - keepValue(b))[0]
        if (spareSlash) {
            offer('skill:yanyu', 44, ['value'], () => useSkill('xiahoushi_yanyu', [], [spareSlash.id]))
        }
    }
    if (knowsSkill(active, 'gongsunyuan_huaiyi') && !onceUsed('gongsunyuan_huaiyi') && hand.length >= 2) {
        const huaiyiRed = hand.filter((c) => c.suit === CardSuit.HEART || c.suit === CardSuit.DIAMOND).length
        if (huaiyiRed > 0 && huaiyiRed < hand.length) {
            offer('skill:huaiyi', 47, ['value'], () => useSkill('gongsunyuan_huaiyi', []))
        }
    }

    // ── 洛书版扩展（五）：新增武将主动技 ──
    // 排异（界钟会）：移去一张“权”，敌方受1点伤害（手牌多则再执行另一项）
    if (knowsSkill(active, 'zhonghui_paiyi')
        && (active.generalPile?.length ?? 0) > 0
        && (active.paiyiUsesPhase ?? 0) < (active.paiyiLimitPhase ?? 1)) {
        const pyTarget = enemies[0]
        if (pyTarget) {
            const pyLethal = pyTarget.g.hp <= 1
            offer('skill:paiyi', 56 + (pyLethal ? 30 : 0) + focusBias(pyTarget.index), ['burst', 'control'],
                () => useSkill('zhonghui_paiyi', [pyTarget.index]))
        }
    }
    // 翦灭（界张春华）：与敌方各弃一种颜色的手牌
    if (knowsSkill(active, 'zhangchunhua_jianmie') && !onceUsed('zhangchunhua_jianmie')) {
        const jmTarget = enemies
            .filter(({ g }) => g.hand.length >= 2)
            .sort((a, b) => b.g.hand.length - a.g.hand.length)[0]
        if (jmTarget) {
            offer('skill:zhangchunhua_jianmie', 46 + Math.min(12, jmTarget.g.hand.length * 2), ['control'],
                () => useSkill('zhangchunhua_jianmie', [jmTarget.index]))
        }
    }
    // 胆守（界朱然）：每项限一次，按场面挑一个目标执行
    if (knowsSkill(active, 'zhuran_danshou')
        && hand.length > 0 && (active.danshouItems?.length ?? 0) < 4) {
        const dsItems = active.danshouItems ?? []
        const dsFoe = enemies.find(({ g }) => g.alive)
        const dsLethal = !!dsFoe && dsFoe.g.hp <= 1 && !dsItems.includes(3)
        if (dsFoe) {
            offer('skill:danshou', 50 + (dsLethal ? 30 : 0) + focusBias(dsFoe.index), ['burst', 'control'],
                () => useSkill('zhuran_danshou', [dsFoe.index]))
        } else {
            offer('skill:danshou', 34, ['value'], () => useSkill('zhuran_danshou', [self]))
        }
    }
    // 资援（糜竺）：把手牌凑成13点交给受伤的队友
    if (knowsSkill(active, 'mizhu_ziyuan') && !onceUsed('mizhu_ziyuan')) {
        const zyReach: boolean[] = new Array(14).fill(false)
        zyReach[0] = true
        for (const c of hand) {
            for (let v = 13; v >= c.value; v--) {
                if (zyReach[v - c.value]) zyReach[v] = true
            }
        }
        const zyAlly = otherAllies
            .map((index) => ({ index, g: state.generals[index] }))
            .filter(({ g }) => g.alive && g.hp < g.maxHp)
            .sort((a, b) => (a.g.hp - a.g.maxHp) - (b.g.hp - b.g.maxHp))[0]
        if (zyReach[13] && zyAlly) {
            offer('skill:ziyuan', 50 + (zyAlly.g.hp <= 1 ? 20 : 0), ['value', 'defense'],
                () => useSkill('mizhu_ziyuan', [zyAlly.index]))
        }
    }
    // 明鉴（曹叡）：把所有手牌交给队友，为其下回合加成
    if (knowsSkill(active, 'caorui_mingjian') && !onceUsed('caorui_mingjian') && hand.length >= 2) {
        const mjAlly = otherAllies
            .map((index) => ({ index, g: state.generals[index] }))
            .filter(({ g }) => g.alive)
            .sort((a, b) => b.g.hand.length - a.g.hand.length)[0]
        if (mjAlly) {
            offer('skill:mingjian', 40 + hand.length * 3, ['value'],
                () => useSkill('caorui_mingjian', [mjAlly.index]))
        }
    }

    // 装备按收益窗口穿：防御装在集火窗口前，武器只在扩到新目标或进入爆发时提前。
    // 顶替规则：新装备比旧装备高 20 分以上才换，不因为“新装备更好”就换。
    const equipCards = hand.filter((c) => c.category === CardCategory.EQUIPMENT && c.equipSlot)
    const needFire = hand.some((c) => c.name === BasicCardName.FIRE_SLASH || c.name === TrickCardName.FIRE_ATTACK)
    const enemyFire = state.discard.some((c) =>
        c.name === BasicCardName.FIRE_SLASH || c.name === TrickCardName.FIRE_ATTACK)
    const aoeHeavy = enemies.filter(({ g }) => g.hand.length >= 3).length >= 2
    const equipCtx = (card: Card) => ({
        active,
        tempo,
        slashes: slashesInHand.length,
        reachGain: enemies.some(({ g }) => {
            const before = getAttackRange(active, g, state.generals).inRange
            const after = getAttackRange(
                { ...active, equip: { ...active.equip, [card.equipSlot!]: card } } as typeof active,
                g, state.generals,
            ).inRange
            return !before && after
        }),
        burst: killWindow || wantsChainFirst,
        enemyFire,
        aoeHeavy,
        needFire,
        targetArmor: enemies.some(({ g }) => !!g.equip.armor),
        targetHorse: enemies.some(({ g }) => !!(g.equip.plus_horse || g.equip.minus_horse)),
        targetBare: enemies.some(({ g }) => g.hand.length === 0),
        targetOppositeGender: enemies.some(({ g }) =>
            getGeneralById(g.generalId)?.gender !== getGeneralById(active.generalId)?.gender),
    })
    for (const card of equipCards) {
        const slot = card.equipSlot!
        const score = equipmentScore(card, equipCtx(card))
        const current = active.equip[slot]
        if (current && score - equipmentScore(current, equipCtx(current)) <= 20) continue
        const plans: PlanKind[] = slot === EquipSlot.WEAPON ? ['burst'] : ['defense']
        const key = slot === EquipSlot.WEAPON ? 'equip_weapon'
            : slot === EquipSlot.ARMOR ? 'equip_armor'
                : slot === EquipSlot.PLUS_HORSE ? 'equip_plus_horse' : 'equip_minus_horse'
        offer(key, score, plans, () => use(card, [self]))
    }

    // 层 1：即时的拆顺手跟在延时控制之后——拆桥不受距离限制，通常先打
    const dismantle = hand.find((c) => c.name === TrickCardName.DISMANTLE)
    if (dismantle) {
        const allyTrouble = otherAllies
            .map((index) => ({ index, g: state.generals[index] }))
            .find(({ g }) => g.judgeZone.some(isDelayedTrickInJudgeZone) && !blockedByWeimu(g, dismantle))
        if (allyTrouble) {
            offer('dismantle_ally', BASE_SCORE.dismantle + 30, ['control'],
                () => use(dismantle, [allyTrouble.index]))
        }
        // 不选只剩判定区牌的敌人：拆掉敌方判定区的乐/兵粮等于帮了对手
        const dismantleTargets = enemies
            .filter(({ g }) => hasCard(g) && !blockedByWeimu(g, dismantle))
            .sort((a, b) => (cardRiches(b.g) + knownRich(b.index)) - (cardRiches(a.g) + knownRich(a.index)) ||
                a.index - b.index)
        const dismantlePick = dismantleTargets[0]
        if (dismantlePick) {
            const keyCard = !!dismantlePick.g.equip.armor ||
                dismantlePick.g.judgeZone.some(isDelayedTrickInJudgeZone)
            offer('dismantle', BASE_SCORE.dismantle + (keyCard ? 12 : 0) +
                (hand.some((c) => c.name === TrickCardName.STEAL) ? 8 : 0) +
                (slashesInHand.length > 0 ? 6 : 0) +
                terms(dismantlePick.g, { defense: dodgeRisk(dismantlePick.g) * 0.4 }),
                ['control'], () => use(dismantle, [dismantlePick.index]))
        }
    }
    const steal = hand.find((c) => c.name === TrickCardName.STEAL)
    if (steal) {
        const stealTargets = enemies
            .filter(({ g }) => hasCard(g) && !blockedByWeimu(g, steal) &&
                (knowsSkill(active, 'huangyueying_qicai') || distanceTo(state, active, g) <= 1))
            .sort((a, b) => (cardRiches(b.g) + knownRich(b.index)) - (cardRiches(a.g) + knownRich(a.index)) ||
                a.index - b.index)
        const stealPick = stealTargets[0]
        if (stealPick) {
            offer('steal', BASE_SCORE.steal + (slashesInHand.length > 0 ? 6 : 0) +
                terms(stealPick.g, { defense: dodgeRisk(stealPick.g) * 0.4 }),
                ['control'], () => use(steal, [stealPick.index]))
        }
        // 顺队友只用来替他拆判定区的乐/兵粮：拿队友手牌是零和交换，还会暴露他的牌
        const allyTrouble = otherAllies
            .map((index) => ({ index, g: state.generals[index] }))
            .filter(({ g }) => knowsSkill(active, 'huangyueying_qicai') || distanceTo(state, active, g) <= 1)
            .find(({ g }) => !blockedByWeimu(g, steal) &&
                g.judgeZone.some(isDelayedTrickInJudgeZone))
        if (allyTrouble) {
            offer('steal_ally', BASE_SCORE.steal + 30, ['control'], () => use(steal, [allyTrouble.index]))
        }
    }

    // 层 3：不消耗杀次数的输出先打，杀留到最后
    const mySlashes = slashesInHand.length
    const duel = hand.find((c) => c.name === TrickCardName.DUEL)
    if (duel && mySlashes >= 1) {
        // 对手手里已知的杀直接算数：明牌没杀时这一决斗几乎白拿
        const duelTarget = enemies
            .filter(({ g }) => !blockedByKongcheng(g) && !blockedByWeimu(g, duel) &&
                predictDuel(state, playerId, mySlashes, g).winChance >= 0.6)
            // 能靠决斗直接收人时优先收人，其次看期望伤害
            .sort((a, b) => {
                const va = (a.g.hp <= 1 ? 20 : 0) + predictDuel(state, playerId, mySlashes, a.g).expectedDamage
                const vb = (b.g.hp <= 1 ? 20 : 0) + predictDuel(state, playerId, mySlashes, b.g).expectedDamage
                return vb - va || a.index - b.index
            })[0]
        if (duelTarget) {
            const outlook = predictDuel(state, playerId, mySlashes, duelTarget.g)
            const killChance = duelTarget.g.hp <= 1 ? outlook.winChance : 0
            offer('duel', BASE_SCORE.duel + tempo.output - (strategy.enemySaving ? 8 : 0) +
                Math.round(outlook.expectedDamage * 6) +
                terms(duelTarget.g, { defense: (1 - outlook.winChance) * 0.5, killChance }),
                ['burst', 'value'], () => use(duel, [duelTarget.index]))
        }
    }
    // 群体锦囊：按双方期望掉血估算净收益，只有净赚（或持平但有后续）才开
    const aoeScore = (kind: 'barbarians' | 'arrows'): number => {
        const aoe = predictAoe(state, playerId, kind)
        if (aoe.net < 0) return 0
        if (aoe.net === 0 && !(enemies.length > otherAllies.length && hand.length >= 3)) return 0
        return BASE_SCORE[kind] + Math.round(aoe.net * 14) + (aggressive ? 3 : 0) -
            Math.round(negateRisk(state, playerId) * 6)
    }
    const barbarians = hand.find((c) => c.name === TrickCardName.BARBARIANS)
    if (barbarians) {
        const score = aoeScore('barbarians')
        if (score > 0) {
            offer('barbarians', score, ['value'],
                () => use(barbarians, [], { direction: pickDirection(state, self, false) }))
        }
    }
    const arrows = hand.find((c) => c.name === TrickCardName.ARROWS)
    if (arrows) {
        const score = aoeScore('arrows')
        if (score > 0) {
            offer('arrows', score, ['value'],
                () => use(arrows, [], { direction: pickDirection(state, self, false) }))
        }
    }
    const fireAttack = hand.find((c) => c.name === TrickCardName.FIRE_ATTACK)
    if (fireAttack) {
        // 火攻要先看对方展示的牌，再弃一张同花色手牌：
        // 已知明牌的花色是确定命中，未知部分按手牌数与花色覆盖估
        const mySuits = new Set(hand.map((c) => c.suit))
        const suitCover = mySuits.size / 4
        const fireTargets = enemies
            .filter(({ g }) => g.hand.length > 0 && !blockedByWeimu(g, fireAttack))
            .map((entry) => {
                const guess = guessHand(state, playerId, entry.index)
                const guaranteed = [...knownSuits(state, entry.index)].some((suit) => mySuits.has(suit))
                const chance = guaranteed ? 1 : guess.unknown === 0 ? 0 :
                    1 - Math.pow(1 - suitCover, guess.unknown)
                return { ...entry, chance }
            })
            .sort((a, b) => (b.chance + (b.g.hp <= 1 ? 0.3 : 0)) - (a.chance + (a.g.hp <= 1 ? 0.3 : 0)) ||
                a.index - b.index)
        const fireTarget = fireTargets[0]
        // 火攻要弃一张同花色牌才命中：命中率不足一半、或手牌太少（付完就没防御）时不赌
        if (fireTarget && fireTarget.chance >= 0.5 && hand.length >= 3) {
            offer('fire_attack', BASE_SCORE.fire_attack + tempo.output + Math.round(fireTarget.chance * 24) +
                terms(fireTarget.g, { defense: (1 - fireTarget.chance) * 0.4 }),
                ['burst', 'value'], () => use(fireAttack, [fireTarget.index]))
        }
    }

    // 层 2：斩杀准备——酒只在下一张杀值得加伤时喝，分数高于杀以保证先喝。
    // 除了酒杀致死，空手且无防具的目标这一刀基本必中，两点伤害同样值得先喝。
    const wineWorthTarget = (g: GeneralView): boolean => {
        if (g.hp <= 2) return true
        return g.hp <= 3 && g.hand.length === 0 && !g.equip.armor
            && handDodgeChance(state, playerId, state.generals.indexOf(g)) === 0
    }
    if (wineCard && !active.wineDrunk && canAttack && slashesInHand.length > 0) {
        const worthWine = inRangeFoes.some(({ g }) => wineWorthTarget(g))
        if (worthWine) {
            offer('wine', BASE_SCORE.wine + 60 + tempo.burst, ['burst'], () => use(wineCard, [self]))
        }
    }

    // 杀最后出：此时对手的防御结构已被前面的牌改变
    // 疠火②（界程普）：把普通【杀】改成火【杀】，对藤甲/连环目标收益明显
    if (canAttack && knowsSkill(active, 'chengpu_jie_lihuo') && active.hp > 1) {
        const plainSlash = slashesInHand.find((c) => c.name === BasicCardName.ATTACK)
        const lihuoFoe = inRangeFoes.find(({ g }) => g.equip.armor?.name === EquipmentCardName.VINE)
            ?? inRangeFoes.find(({ g }) => g.chained)
        if (plainSlash && lihuoFoe) {
            offer('lihuo', BASE_SCORE.slash + 10 + tempo.output, ['burst'],
                () => use(plainSlash, [lihuoFoe.index], { lihuo: true }))
        }
    }
    if (canAttack) {
        const slash = slashesInHand[0]
        const slashTarget = inRangeFoes
            .slice()
            .sort((a, b) => (slashTargetValue(b.g, slash, active.wineDrunk ? 2 : 1) + focusBias(b.index)) -
                (slashTargetValue(a.g, slash, active.wineDrunk ? 2 : 1) + focusBias(a.index)) || a.index - b.index)[0]
        // 这一杀实际被闪开的概率：手牌里的闪 + 防具（青釭剑无视防具）
        const slashOdds = (target: GeneralView, source: Card | undefined) => predictSlash(
            target,
            source ?? ({ name: BasicCardName.ATTACK } as Card),
            {
                damage: active.wineDrunk ? 2 : 1,
                ignoresArmor: active.equip.weapon?.name === EquipmentCardName.QINGGANG_SWORD,
                // 明牌里已经看到闪，这一杀就是必被闪；反过来没看到闪就近乎必中
                dodgeChance: handDodgeChance(state, playerId, state.generals.indexOf(target)),
            },
        )
        if (slash && slashTarget) {
            const odds = slashOdds(slashTarget.g, slash)
            // 斩杀概率按“不被闪”折算；主帅被杀直接获胜，边锋被杀顺带摸牌
            const lethalChance = slashTarget.g.hp <= (active.wineDrunk ? 2 : 1) ? odds.hitChance : 0
            // 下一回合就要出手的敌人：现在打不死，回头就是他打我们
            const slashPlan = planOf(slashTarget.index)
            const urgency = slashPlan?.actsThisRound
                ? Math.min(8, Math.round(slashPlan.threat * 0.8))
                : 0
            const killBonus = lethalChance *
                (slashTarget.g.seatRole === SeatRole.COMMANDER ? 40 : 12) + urgency * lethalChance
            // 酒与铁索是杀的前置动作，未完成时压后出杀
            const needsWineFirst = !!wineCard && !active.wineDrunk && wineWorthTarget(slashTarget.g)
            const armorMatch = slashTarget.g.equip.armor?.name === EquipmentCardName.VINE &&
                (slash.name === BasicCardName.FIRE_SLASH || slash.name === BasicCardName.THUNDER_SLASH ||
                    active.equip.weapon?.name === EquipmentCardName.ZHUQUE_FAN)
            // 藤甲免疫普通杀：没有火杀/雷杀/朱雀扇、也没青釭剑时这一杀完全浪费
            const vineBlocked = slashTarget.g.equip.armor?.name === EquipmentCardName.VINE && !armorMatch &&
                active.equip.weapon?.name !== EquipmentCardName.QINGGANG_SWORD
            const score = BASE_SCORE.slash + tempo.output +
                terms(slashTarget.g, { defense: odds.dodgeChance, killChance: lethalChance, armorMatch }) +
                Math.round((odds.expectedDamage - 0.5) * 8) + killBonus +
                (slashTarget.g.hand.length === 0 ? 10 : 0) -
                (vineBlocked ? 32 : 0) -
                (wantsChainFirst ? 14 : 0) - (needsWineFirst ? 22 : 0)
            offer('slash', score, ['burst', 'value'], () => use(slash, [slashTarget.index]))
        }
        // 龙胆（闪当杀）/ 武圣（红牌当杀）补刀
        if (!slash && slashTarget && knowsSkill(active, 'zhaoyun_longdan')) {
            const dodge = [...hand].filter(isDodge).sort((a, b) => keepValue(a) - keepValue(b))[0]
            if (dodge) {
                const odds = slashOdds(slashTarget.g, dodge)
                const score = BASE_SCORE.slash - 6 + tempo.output +
                    terms(slashTarget.g, {
                        defense: odds.dodgeChance,
                        killChance: slashTarget.g.hp <= 1 ? odds.hitChance : 0,
                    }) - holdPenalty(dodge, { peaches, dodges, danger })
                offer('longdan', score, ['burst', 'value'], () => use(dodge, [slashTarget.index]))
            }
        }
        if (!slash && slashTarget && knowsSkill(active, 'zhongyao_huomo')
            && !(active.basicUsedThisTurn ?? []).includes(BasicCardName.ATTACK)) {
            const blackForSlash = [...hand]
                .filter((c) => c.category !== CardCategory.BASIC &&
                    (c.suit === CardSuit.SPADE || c.suit === CardSuit.CLUB))
                .sort((a, b) => keepValue(a) - keepValue(b))[0]
            if (blackForSlash) {
                const odds = slashOdds(slashTarget.g, blackForSlash)
                const score = BASE_SCORE.slash - 10 + tempo.output +
                    terms(slashTarget.g, {
                        defense: odds.dodgeChance,
                        killChance: slashTarget.g.hp <= 1 ? odds.hitChance : 0,
                    }) - holdPenalty(blackForSlash, { peaches, dodges, danger })
                offer('huomo_slash', score, ['burst', 'value'],
                    () => use(blackForSlash, [slashTarget.index], { huomo: 'attack' }))
            }
        }
        if (!slash && slashTarget && knowsSkill(active, 'guanyu_wusheng')) {
            const red = [...hand]
                .filter((c) => isRedCard(c) && keepValue(c) <= 70)
                .sort((a, b) => keepValue(a) - keepValue(b))[0]
            if (red) {
                const odds = slashOdds(slashTarget.g, red)
                const score = BASE_SCORE.slash - 8 + tempo.output +
                    terms(slashTarget.g, {
                        defense: odds.dodgeChance,
                        killChance: slashTarget.g.hp <= 1 ? odds.hitChance : 0,
                    }) - holdPenalty(red, { peaches, dodges, danger })
                offer('wusheng', score, ['burst', 'value'], () => use(red, [slashTarget.index], { wusheng: true }))
            }
        }
    }

    // 借刀杀人：令持械敌人攻击其同伴，多半会被拒绝而交出武器
    const borrowSword = hand.find((c) => c.name === TrickCardName.BORROW_SWORD)
    if (borrowSword) {
        const pair = enemies
            .filter((holder) => !!holder.g.equip.weapon && !blockedByWeimu(holder.g, borrowSword))
            .map((holder) => ({
                holder,
                killTarget: enemies.find(({ g, index }) =>
                    index !== holder.index && getAttackRange(holder.g, g, state.generals).inRange)
            }))
            .find((p) => !!p.killTarget)
        if (pair?.killTarget) {
            offer('borrow_sword', BASE_SCORE.borrow_sword + 8, ['control'],
                () => use(borrowSword, [pair.holder.index, pair.killTarget!.index]))
        }
    }

    // 层 1：延时控制。判定区"后到先判"——本次贴上的那张最先判定，
    // 所以要乐先判就直接贴乐；要兵粮先判（对手手牌已见底时更痛）就贴兵粮。
    // 能斩杀的目标不贴，避免刚贴上就被打死。
    const hasJudge = (g: GeneralView, name: string) => g.judgeZone.some((c) => c.name === name)
    // 能斩杀的目标不贴，避免刚贴上就被打死；空手残血的目标也大概率被后续伤害带走
    const likelyDeadThisTurn = (g: GeneralView) => canAttack && slashesInHand.length > 0
        && getAttackRange(active, g, state.generals).inRange
        && ((killWindow && g.hp <= damagePotential) || (g.hp <= 2 && g.hand.length === 0))
    const delayedFoes = enemies.filter(({ g }) => !likelyDeadThisTurn(g))
    const over = hand.find((c) => c.name === TrickCardName.OVERINDULGENCE)
    if (over) {
        // 贴给下一回合最危险的那个人：手里的杀、连弩、能否够到主帅都算在内
        const overTarget = delayedFoes
            .filter(({ g }) => !hasJudge(g, TrickCardName.OVERINDULGENCE) && !blockedByWeimu(g, over))
            .sort((a, b) => (planOf(b.index)?.threat ?? 0) - (planOf(a.index)?.threat ?? 0) ||
                a.index - b.index)[0]
        if (overTarget) {
            const starved = overTarget.g.hand.length <= 2
            const plan = planOf(overTarget.index)
            // 判红心即解除；对方有改判将时收益打折，敌方还留着无懈也要扣
            const success = delayedSuccessChance(state, overTarget.g)
            offer('overindulgence', BASE_SCORE.overindulgence + tempo.control -
                (starved ? 6 : 0) - (strategy.enemySaving ? 6 : 0) +
                Math.round((success - 0.75) * 24) - Math.round(negateRisk(state, playerId) * 8) +
                Math.min(12, Math.round((plan?.threat ?? 0) * (plan?.actsThisRound ? 1 : 0.5))) +
                terms(overTarget.g, { defense: 0.3 }),
                ['control'], () => use(over, [overTarget.index]))
        }
    }
    const supply = hand.find((c) => c.name === TrickCardName.SUPPLY_SHORTAGE)
    if (supply) {
        // 兵粮寸断断的是摸牌：手牌见底、又马上要行动的目标最疼
        const supplyTarget = delayedFoes
            .filter(({ g }) => !hasJudge(g, TrickCardName.SUPPLY_SHORTAGE) && distanceTo(state, active, g) <= 1)
            .sort((a, b) => (planOf(b.index)?.threat ?? 0) - (planOf(a.index)?.threat ?? 0) ||
                a.index - b.index)[0]
        if (supplyTarget) {
            const starved = supplyTarget.g.hand.length <= 2
            const plan = planOf(supplyTarget.index)
            const success = delayedSuccessChance(state, supplyTarget.g)
            offer('supply_shortage', BASE_SCORE.supply_shortage + tempo.control +
                (starved ? 10 : 0) + Math.round((success - 0.75) * 24) -
                Math.round(negateRisk(state, playerId) * 8) +
                Math.min(12, Math.round(plan?.threat ?? 0)) +
                terms(supplyTarget.g, { defense: 0.3 }),
                ['control'], () => use(supply, [supplyTarget.index]))
        }
    }

    // 闪电：只能贴给自己，判定区干净时直接放上去博概率
    const lightning = hand.find((c) => c.name === TrickCardName.LIGHTNING)
    if (lightning) {
        const selfIdx = state.generals.indexOf(active)
        const selfHasLightning = active.judgeZone.some((c) => c.name === TrickCardName.LIGHTNING)
        if (selfIdx >= 0 && !selfHasLightning) {
            offer('lightning', 54, ['control'], () => use(lightning, [selfIdx]))
        }
    }

    // ── 洛书版扩展（二）：主动技按“牌换收益”的顺序进入候选表
    // 雪恨：弃一张红牌，横置至多X名敌人并造成1点火焰伤害
    if (knowsSkill(active, 'guanyinping_xuehen') && !onceUsed('guanyinping_xuehen')) {
        const xhRed = [...hand]
            .filter((c) => (c.suit === CardSuit.HEART || c.suit === CardSuit.DIAMOND) && keepValue(c) <= 4)
            .sort((a, b) => keepValue(a) - keepValue(b))[0]
        const xhPool = enemies.filter(({ g }) => !g.chained).slice(0, Math.max(1, active.maxHp - active.hp))
        if (xhRed && xhPool.length > 0) {
            offer('guanyinping_xuehen', 62, ['burst'], () =>
                useSkill('guanyinping_xuehen', xhPool.map(({ index }) => index), [xhRed.id]))
        }
    }
    // 长标：把手里的废牌整体当一张杀
    if (knowsSkill(active, 'zhurong_changbiao') && !onceUsed('zhurong_changbiao') && canAttack) {
        const cbJunk = hand.filter((c) => !isSlash(c) && !isDodge(c) && !isPeach(c) && keepValue(c) <= 3)
            .sort((a, b) => keepValue(a) - keepValue(b))[0]
        const cbFoe = inRangeFoes[0]
        if (cbJunk && cbFoe) {
            offer('zhurong_changbiao', 58, ['burst'], () =>
                useSkill('zhurong_changbiao', [cbFoe.index], [cbJunk.id]))
        }
    }
    // 品第：对敌人弃牌，或给缺牌的队友补牌
    if (knowsSkill(active, 'chenqun_pindi') && hand.length >= 2) {
        const pdCard = [...hand].sort((a, b) => keepValue(a) - keepValue(b))[0]
        const pdCount = ((active as any).pindiCount ?? 0) + 1
        const pdFoe = enemies.filter(({ g }) => g.hand.length >= pdCount).sort((a, b) => b.g.hand.length - a.g.hand.length)[0]
        const pdAlly = allies.filter(({ g, index }) => index !== self && g.hand.length < pdCount && g.hp < g.maxHp)[0]
        if (pdCard && pdFoe) {
            offer('chenqun_pindi_foe', 44, ['control'], () =>
                useSkill('chenqun_pindi', [pdFoe.index], [pdCard.id]))
        } else if (pdCard && pdAlly) {
            offer('chenqun_pindi_ally', 38, ['burst'], () =>
                useSkill('chenqun_pindi', [pdAlly.index], [pdCard.id]))
        }
    }
    // 拼点系列：手上有牌就值得一试
    if (hand.length > 0) {
        const pindianFoe = enemies.filter(({ g }) => g.hand.length > 0)[0]
        if (pindianFoe) {
            if (knowsSkill(active, 'taishici_tianyi') && !onceUsed('taishici_tianyi')) {
                offer('taishici_tianyi', 56, ['burst'], () => useSkill('taishici_tianyi', [pindianFoe.index]))
            }
            if (knowsSkill(active, 'gaoshun_xianzhen') && !onceUsed('gaoshun_xianzhen')) {
                offer('gaoshun_xianzhen', 54, ['burst'], () => useSkill('gaoshun_xianzhen', [pindianFoe.index]))
            }
            const quhuFoe = enemies.filter(({ g }) => g.hp > active.hp && g.hand.length > 0)[0]
            if (knowsSkill(active, 'xunyu_quhu') && !onceUsed('xunyu_quhu') && quhuFoe) {
                offer('xunyu_quhu', 52, ['burst'], () => useSkill('xunyu_quhu', [quhuFoe.index]))
            }
        }
    }
    // 缔盟：把队友的牌换成敌人的牌
    if (knowsSkill(active, 'lusu_dimeng') && !onceUsed('lusu_dimeng') && hand.length >= 2) {
        const dmAlly = allies.filter(({ g, index }) => index !== self && g.hand.length <= 1)[0]
        const dmFoe = enemies.filter(({ g }) => g.hand.length >= 3)[0]
        if (dmAlly && dmFoe) {
            offer('lusu_dimeng', 48, ['control'], () => useSkill('lusu_dimeng', [dmAlly.index, dmFoe.index]))
        }
    }
    // 安恤：从两名有牌的角色各拿一张，再转手给手牌少的
    if (knowsSkill(active, 'bulianshi_anxu') && !onceUsed('bulianshi_anxu')) {
        const axPool = [...enemies, ...allies].filter(({ g, index }) => index !== self && hasCard(g)).slice(0, 2)
        if (axPool.length >= 2) {
            offer('bulianshi_anxu', 50, ['value'], () => useSkill('bulianshi_anxu', axPool.map(({ index }) => index)))
        }
    }
    // 直谏：多余的装备换一张手牌
    if (knowsSkill(active, 'zhangzhao_zhijian')) {
        const zjEquip = hand.filter((c) => c.category === CardCategory.EQUIPMENT)
            .sort((a, b) => keepValue(a) - keepValue(b))[0]
        const zjReceiver = allies.filter(({ index }) => index !== self)[0]
        if (zjEquip && zjReceiver) {
            offer('zhangzhao_zhijian', 34, ['value'], () => useSkill('zhangzhao_zhijian', [zjReceiver.index], [zjEquip.id]))
        }
    }
    // 审时（阳）：给最富的敌人一张废牌，顺手打1点
    if (knowsSkill(active, 'kuailiang_shenshi') && !onceUsed('kuailiang_shenshi')
        && !(active as any).shenshiYin && hand.length > 0) {
        const ssVictim = enemies.filter(({ g }) => !g.chained).sort((a, b) => b.g.hand.length - a.g.hand.length)[0]
        const ssCard = [...hand].sort((a, b) => keepValue(a) - keepValue(b))[0]
        if (ssVictim && ssCard) {
            offer('kuailiang_shenshi', 45, ['burst'], () => useSkill('kuailiang_shenshi', [ssVictim.index], [ssCard.id]))
        }
    }
    // 断发：黑色废牌过牌
    if (knowsSkill(active, 'zhoufang_duanfa')) {
        const dfBlack = hand.filter((c) => (c.suit === CardSuit.SPADE || c.suit === CardSuit.CLUB) && keepValue(c) <= 3)
            .sort((a, b) => keepValue(a) - keepValue(b))[0]
        const dfLeft = Math.max(0, active.hp - ((active as any).duanfaCount ?? 0))
        if (dfBlack && dfLeft > 0) {
            offer('zhoufang_duanfa', 40, ['value'], () => useSkill('zhoufang_duanfa', [], [dfBlack.id]))
        }
    }
    // 火计：红牌当火攻
    if (knowsSkill(active, 'wolong_huoji') && inRangeFoes.length > 0) {
        const hjRed = hand.filter((c) => (c.suit === CardSuit.HEART || c.suit === CardSuit.DIAMOND) && keepValue(c) <= 3)[0]
        if (hjRed) {
            offer('wolong_huoji', 42, ['burst'], () => useSkill('wolong_huoji', [inRangeFoes[0].index], [hjRed.id]))
        }
    }

    // 计划评分：同一条线的前三步按 1 / 0.85 / 0.7 折算，胜出的计划拿到少量加成，
    // 只用来打破跨计划的同分；执行成功后重新评分。低于门槛就留牌结束阶段。
    if (collectOnly) {
        collectedPlayOptions = options
        return false
    }
    // 审计/补丁层：记录局面特征，并允许补丁在排序前改分或淘汰规则
    const dc = beginDecision(state, playerId, 'play', {
        kill_window: killWindow,
        commander_kill: commanderKill,
        under_threat: underThreat,
        enemy_saving: strategy.enemySaving,
        is_aggressive: aggressive,
    })
    const candidates = dc ? applyPatchToOptions(dc, options) : options
    const viable = candidates.filter((option) => option.score > 0)
    if (viable.length === 0) {
        endDecision(dc, 'play', 'PASS', [], { reason: 'no-viable', plan: null })
        return false
    }
    const plan = choosePlan(viable)
    const ranked = viable
        .map((option) => ({ option, final: option.score + (option.plans.includes(plan) ? PLAN_BONUS : 0) }))
        .sort((a, b) => b.final - a.final)
    // 反事实干预：命中谓词时把指定规则提到最前，并允许它绕过 PASS_SCORE 门槛
    const forced = dc ? forcedPlayRule(dc) : null
    const forcedOption = forced ? candidates.find((option) => option.key === forced) : undefined
    const appliedForce = forcedOption ? forced : null
    if (forcedOption) {
        const at = ranked.findIndex((entry) => entry.option.key === forcedOption.key)
        if (at >= 0) ranked.unshift(...ranked.splice(at, 1))
        else ranked.unshift({ option: forcedOption, final: forcedOption.score })
    }
    const passScore = thresholdFor(dc, 'PASS_SCORE', PASS_SCORE)
    const candidateRecords = candidates.map((candidate) => ({
        ruleId: candidate.key,
        score: Math.round(candidate.score),
        plan: candidate.plans.join(','),
    }))
    for (const { option, final } of ranked) {
        if (final < passScore && option.key !== appliedForce) break
        if (option.run()) {
            // 只有强制规则真的被执行才算「干预生效」，run() 失败后落到别的动作不能计入
            const forceApplied = appliedForce === option.key ? appliedForce : null
            endDecision(dc, 'play', option.key, candidateRecords.map((record) => ({
                ...record,
                chosen: record.ruleId === option.key,
                final: record.ruleId === option.key ? Math.round(final) : undefined,
            })), { plan, forced: forceApplied })
            lastPlayTrace = {
                plan,
                candidates: options.map((candidate) => ({
                    key: candidate.key,
                    score: Math.round(candidate.score),
                    final: candidate === option ? Math.round(final) : undefined,
                    chosen: candidate === option,
                })),
            }
            return true
        }
    }
    endDecision(dc, 'play', 'PASS', candidateRecords, { plan, forced: null })
    return false
}

export interface PlayTrace {
    plan: string
    candidates: Array<{ key: string; score: number; final?: number; chosen?: boolean }>
}

export interface SkillTrace {
    skillId: string
    options: string[]
    chosen: string
}

export interface DraftTrace {
    phase: 'pick' | 'deploy'
    candidates: Array<{ id: string; score: number; chosen?: boolean }>
    chosenId: string
}

let lastPlayTrace: PlayTrace | null = null
let lastSkillTrace: SkillTrace | null = null
let draftTraces: DraftTrace[] = []

/** 取走最近一次出牌决策的候选与选择（供对局日志记录） */
export function takePlayTrace(): PlayTrace | null {
    const trace = lastPlayTrace
    lastPlayTrace = null
    return trace
}

/** 取走最近一次技能选项决策 */
export function takeSkillTrace(): SkillTrace | null {
    const trace = lastSkillTrace
    lastSkillTrace = null
    return trace
}

/** 记录一次选将/布阵决策（斗地主与 3v3 共用） */
export function setDraftTrace(trace: DraftTrace): void {
    draftTraces.push(trace)
}

/** 取走最近一轮的选将/布阵决策（一次可能补多个座位） */
export function takeDraftTraces(): DraftTrace[] {
    const traces = draftTraces
    draftTraces = []
    return traces
}

interface CollectedPlayOption {
    key: string
    score: number
    plans: PlanKind[]
    run: () => unknown
}

let collectedPlayOptions: CollectedPlayOption[] | null = null

export interface AiPlayOptionView {
    id: string
    key: string
    score: number
}

/** 枚举当前出牌阶段可执行的全部动作（与规则 AI 共用同一张决策表） */
export function listPlayOptions(state: GameState, playerId: string): AiPlayOptionView[] {
    collectedPlayOptions = null
    try {
        aiPlayOne(state, playerId, true)
    } catch (err) {
        console.warn('[local-ai] 枚举动作选项失败', err)
    }
    const all = (collectedPlayOptions as CollectedPlayOption[] | null) ?? []
    collectedPlayOptions = null
    return all.map((option, index) => ({ id: `o${index + 1}`, key: option.key, score: Math.round(option.score) }))
}

/** 执行 listPlayOptions 里的某个选项；返回是否真的推进了局面 */
export function runPlayOption(state: GameState, playerId: string, id: string): boolean {
    collectedPlayOptions = null
    try {
        aiPlayOne(state, playerId, true)
    } catch (err) {
        console.warn('[local-ai] 执行动作选项时枚举失败', err)
        return false
    }
    const all = (collectedPlayOptions as CollectedPlayOption[] | null) ?? []
    collectedPlayOptions = null
    const index = Number(id.replace(/^o/, '')) - 1
    const option = Number.isInteger(index) ? all[index] : undefined
    if (!option) return false
    try {
        return !!option.run()
    } catch (err) {
        console.warn('[local-ai] 执行动作选项抛出异常', err)
        return false
    }
}

function aiDiscard(state: GameState, playerId: string): boolean {
    const active = getActiveGeneral(state)
    if (!active || active.playerId !== playerId) return false
    if (state.turnPhase !== TurnPhase.DISCARD) return false
    const handLimit = getHandLimit(active)
    const excess = (active.hand?.length ?? 0) - handLimit
    // 没超出上限也要把弃牌阶段走完，否则回合会停在这里
    if (excess <= 0) return handleDiscard(state, playerId, []) === undefined
    // 花色偏好（急救的红牌、倾国的黑牌等）计入保留价值，先弃自己用不上的牌
    const scored = (c: Card) => keepValue(c) + suitAffinity(active, c)
    // 弃牌阶段的补丁层：每张手牌是一个候选，分数沿用保留价值（越低越先弃）。
    // 补丁可以按牌名 veto 某类牌（例如「保留全部【闪】」），或用 priority 改写价值。
    const dc = beginDecision(state, playerId, 'discard')
    const usePatch = dc ? hasHookRules(dc, 'discard') : false
    const ordered = [...active.hand].sort((a, b) => scored(a) - scored(b))
    const picked = usePatch && dc
        ? pickDiscardWithPatch(dc, ordered, excess, scored)
        : ordered.slice(0, excess)
    const ids = picked.map((c) => c.id)
    endDecision(dc, 'discard', 'discard', [], {
        excess,
        handBefore: active.hand.length,
        handLimit,
    })
    return handleDiscard(state, playerId, ids) === undefined
}

/**
 * 按补丁调整后的保留价值选要弃的牌。
 *
 * 候选分直接沿用 keepValue（越高越想留），选分最低的若干张弃掉，
 * 与未启用补丁时的 `sort(scored) .slice(0, excess)` 完全等价。
 * 补丁加分 = 更想保留；补丁否决 = 这张牌退出弃牌池（不足时按原顺序补齐）。
 */
function pickDiscardWithPatch(
    dc: NonNullable<ReturnType<typeof beginDecision>>,
    pool: Card[],
    excess: number,
    scored: (c: Card) => number,
): Card[] {
    const choices: Choice[] = pool.map((c) => ({ ruleId: c.id, score: scored(c) }))
    const patched = applyChoicePatches(dc, 'discard', choices)
    const byId = new Map(patched.map((choice) => [choice.ruleId, choice.score]))
    const allowed = new Set(byId.keys())
    // 稳定排序：先按调整后的价值，再把被 veto 的排到最后（弃牌数不够时才用到）
    const ordered = [...pool]
        .map((card, order) => ({ card, order }))
        .sort((a, b) => {
            const av = allowed.has(a.card.id) ? 0 : 1
            const bv = allowed.has(b.card.id) ? 0 : 1
            if (av !== bv) return av - bv
            const byScore = (byId.get(a.card.id) ?? scored(a.card)) - (byId.get(b.card.id) ?? scored(b.card))
            return byScore !== 0 ? byScore : a.order - b.order
        })
    return ordered.slice(0, excess).map((entry) => entry.card)
}

/** 选将/部署阶段的 AI 行为 */
function aiDraftRaw(state: GameState, playerId: string = AI_PLAYER_ID): boolean {
    const aiFaction = state.players[playerId]?.faction
    if (!aiFaction) return false

    if (state.phase === GamePhase.GENERAL_PICK) {
        if (state.pickState?.waitingForPickYield) {
            // 暖色方决定选将顺序：AI 总是选择先选
            if (aiFaction === Faction.WARM) {
                handlePickYield(state, Faction.WARM, false)
                return true
            }
            return false
        }
        if (currentPickFaction(state) !== aiFaction) return false
        const pick = state.pickState
        if (!pick) return false
        const taken = new Set([...pick.warmPicked, ...pick.coolPicked].map((g) => g.id))
        const candidates = pick.pool.filter((g) => !taken.has(g.id))
        if (candidates.length === 0) return false

        // 我方已选（用于补齐组合）与对手已选（用于抢人）
        const myPicked = aiFaction === Faction.WARM ? pick.warmPicked : pick.coolPicked
        const rivalPicked = aiFaction === Faction.WARM ? pick.coolPicked : pick.warmPicked

        let best = candidates[0]
        let bestScore = -Infinity
        const graded: Array<{ id: string; score: number }> = []
        for (const def of candidates) {
            // 武将本身强度 + 己方配合 + 拆对方配合 + 阵容缺口
            const score = draftScore(def, myPicked, rivalPicked).total
            graded.push({ id: def.id, score: Math.round(score) })
            if (score > bestScore) {
                bestScore = score
                best = def
            }
        }
        setDraftTrace({
            phase: 'pick',
            candidates: graded.map((g) => ({ ...g, chosen: g.id === best.id })),
            chosenId: best.id,
        })
        return !('error' in localPickGeneral(state, aiFaction, best.id))
    }

    if (state.phase === GamePhase.DEPLOY) {
        const deployed = state.generals.some((g) => g.playerId === playerId)
        if (deployed) return false
        const pick = state.pickState
        if (!pick) return false
        const picked = aiFaction === Faction.WARM ? pick.warmPicked : pick.coolPicked
        if (picked.length < 3) return false

        // 主帅：综合评分 + 体力 + 主帅适配度（支援型/压制型，张辽文聘不适合主帅）
        const commander = [...picked].sort(
            (a, b) => scoreGeneralForRole(b, 'commander', aiFaction) - scoreGeneralForRole(a, 'commander', aiFaction) ||
                b.maxHp - a.maxHp ||
                scoreGeneral(b) - scoreGeneral(a)
        )[0]
        // 前锋：偏输出/控制，先行动的前锋放更强的一个
        const flanks = picked
            .filter((g) => g.id !== commander.id)
            .sort(
                (a, b) => scoreGeneralForRole(b, 'flank', aiFaction) - scoreGeneralForRole(a, 'flank', aiFaction) ||
                    scoreGeneral(b) - scoreGeneral(a)
            )
        if (flanks.length < 2) return false
        setDraftTrace({
            phase: 'deploy',
            candidates: picked.map((g) => ({
                id: g.id,
                score: Math.round(scoreGeneralForRole(g, 'commander', aiFaction)),
                chosen: g.id === commander.id,
            })),
            chosenId: commander.id,
        })
        return !('error' in localDeployGenerals(state, aiFaction, commander.id, flanks[0].id, flanks[1].id))
    }

    return false
}

/**
 * AI 推进一步。返回是否真的执行了动作，供本地驱动循环判断是否继续。
 */

/** 选将/部署阶段的 AI 行为 */
export function aiDraft(state: GameState, playerId: string = AI_PLAYER_ID): boolean {
    const dc = beginDecision(state, playerId, 'draft')
    const progressed = aiDraftRaw(state, playerId)
    if (progressed && dc) {
        const pick = state.pickState
        endDecision(dc, 'draft', 'draft', [], {
            phase: String(state.phase),
            picked: pick ? [...pick.warmPicked, ...pick.coolPicked].map((g) => g.id) : [],
        })
    }
    return progressed
}

/** 带选项的技能提示：按收益挑选选项 action */
function pickSkillOption(
    state: GameState,
    self: GeneralView | undefined,
    playerId: string,
    skillId: string,
    options: { action: string; label: string }[],
    ctx: Record<string, any>,
): string {
    const chosen = pickSkillOptionRaw(state, self, playerId, skillId, options, ctx)
    lastSkillTrace = { skillId, options: options.map((o) => o.action), chosen }
    const dc = beginDecision(state, playerId, 'skill')
    endDecision(dc, 'skill', `skill:${skillId}:${chosen}`,
        options.map((option) => ({ ruleId: option.action })),
        { skillId })
    return chosen
}

function pickSkillOptionRaw(
    state: GameState,
    self: GeneralView | undefined,
    playerId: string,
    skillId: string,
    options: { action: string; label: string }[],
    ctx: Record<string, any>,
): string {
    const has = (a: string) => options.some((o) => o.action === a)
    const slack = options.length > 0 && options[options.length - 1].action === 'draw'
    // 洛书版扩展（九）：新增武将的选项决策
    if (skillId === 'sunluyu_mumu') {
        if (has('discard') && self
            && state.generals.some(g => g.alive && g !== self && isEnemy(state, g, playerId) && equippedCards(g).length > 0)) {
            return 'discard'
        }
        if (has('gainArmor') && self && self.hand.filter(c => isSlash(c)).length <= 1) return 'gainArmor'
        return 'decline'
    }
    if (skillId === 'baoxin_yimou') {
        if (has('gainSlash')) return 'gainSlash'
        return 'decline'
    }
    if (skillId === 'chengyu_shefu') {
        const order = ['attack', 'dodge', 'peach', 'negate', 'duel', 'draw_two', 'steal', 'dismantle']
        for (const nm of order) {
            if (has(nm)) return nm
        }
        return options[0]?.action ?? 'decline'
    }
    if (skillId === 'shenlusu_tamo') {
        if (has('decline')) return 'decline'
        return options[0]?.action ?? 'decline'
    }
    if (skillId === 'sunchen_nigu_give') {
        if ((self?.hand.length ?? 0) <= 2 && has('decline')) return 'decline'
        return has('give') ? 'give' : 'decline'
    }
    if (skillId === 'chengyu_shefu_negate') {
        if ((self?.hand.length ?? 0) >= 1) return 'confirm'
        return 'decline'
    }
    switch (skillId) {
        // 灭计��李儒）：能交锦囊牌就交锦囊牌，否则弃两张
        case 'liru_mieji': {
            if (has('give_trick') && self) {
                const cheapTrick = self.hand.find((c) => c.category === CardCategory.TRICK
                    && c.name !== TrickCardName.NEGATE)
                if (cheapTrick) return 'give_trick'
            }
            if (has('discard_two')) return 'discard_two'
            return options[0]?.action ?? 'decline'
        }
        // 镇胆（闪赵云）：优先当【杀】，其次【桃】、【酒】
        case 'shanzhaoyun_zhendan_declare': {
            if (has('attack')) {
                const foeInRange = state.generals.some((g) =>
                    g.alive && g !== self && isEnemy(state, g, playerId)
                    && self && getAttackRange(self as any, g as any, state.generals).inRange)
                if (foeInRange) return 'attack'
            }
            if (has('peach') && self && self.hp < self.maxHp) return 'peach'
            return options[0]?.action ?? 'attack'
        }
        // 述志（界曹操）：手牌够多且场上有可观看的目标时改【清正】，否则保留【奸雄】
        case 'caocao_jie_shuzhi': {
            const qzReady = !!self && self.hand.length >= 2
                && state.generals.some(g => g.alive && g !== self && g.hand.length > 0)
            if (has('qingzheng') && qzReady) return 'qingzheng'
            return has('jianxiong') ? 'jianxiong' : (options[0]?.action ?? 'jianxiong')
        }
        // 清正（界曹操）：弃自己最多的花色
        case 'caocao_jie_qingzheng': {
            if (!self) return options[0]?.action ?? 'decline'
            let best = options[0]?.action ?? 'decline'
            let bestCount = -1
            for (const o of options) {
                const count = self.hand.filter(c => c.suit === o.action).length
                if (count > bestCount) { bestCount = count; best = o.action }
            }
            return best
        }
        // 清正：弃对手最多的花色
        case 'caocao_jie_qingzheng_pick': {
            const qzOther = state.generals[(ctx.qingzhengTargetIndex as number) ?? -1]
            if (!qzOther) return options[0]?.action ?? 'decline'
            let best = options[0]?.action ?? 'decline'
            let bestCount = -1
            for (const o of options) {
                const count = qzOther.hand.filter(c => c.suit === o.action).length
                if (count > bestCount) { bestCount = count; best = o.action }
            }
            return best
        }
        // 下书（阚泽）：拿更多的一张
        case 'kanze_xiashu_gain': {
            const xsTarget = state.generals[(ctx.xiashuTargetIndex as number) ?? -1]
            if (!xsTarget) return options[0]?.action ?? 'decline'
            const shown = new Set((ctx.xiashuShownIds as string[]) ?? [])
            const shownCount = xsTarget.hand.filter(c => shown.has(c.id)).length
            const hiddenCount = xsTarget.hand.length - shownCount
            if (has('hidden') && hiddenCount > shownCount) return 'hidden'
            return has('shown') ? 'shown' : (options[0]?.action ?? 'decline')
        }
        case 'caoxiu_qingxi': {
            const need = Math.max(1, (ctx.qingxiCount as number) ?? 1)
            const junk = self ? self.hand.filter((c) => !isSlash(c) && !isDodge(c) && !isPeach(c)).length : 0
            if (has('discard') && junk >= need) return 'discard'
            return has('damage') ? 'damage' : 'discard'
        }
        case 'fazheng_enyuan': {
            if (has('give') && self && self.hand.length > 0) return 'give'
            return has('loseHp') ? 'loseHp' : 'give'
        }
        case 'quancong_yaoming_equal': {
            const equalTarget = state.generals[(ctx.yaomingTargetIndex as number) ?? -1]
            if (has('discard') && equalTarget && isEnemy(state, equalTarget, playerId)) return 'discard'
            return has('draw') ? 'draw' : 'discard'
        }
        case 'quancong_yaoming_free':
            return has('yaoming') ? 'yaoming' : (options[0]?.action ?? 'decline')
        case 'luji_yili': {
            if (has('orange')) return 'orange'
            return has('loseHp') ? 'loseHp' : 'orange'
        }
        case 'handang_jiefan': {
            const target = state.generals[(ctx.jiefanTargetIndex as number) ?? -1]
            const enemy = !!target && isEnemy(state, target, playerId)
            if (has('discard') && enemy && target?.equip?.weapon) return 'discard'
            return has('draw') ? 'draw' : 'discard'
        }
        case 'haozhao_zhengu': {
            const owner = state.generals[(ctx.zhenguOwnerIndex as number) ?? -1]
            if (!self || !owner) return has('draw') ? 'draw' : 'discard'
            return self.hand.length <= owner.hand.length ? 'draw' : 'discard'
        }
        case 'guohuanghou_jiaozhao_declare': {
            const owner = state.generals[(ctx.jiaozhaoOwnerIndex as number) ?? -1]
            const friendly = !!owner && !isEnemy(state, owner, playerId)
            // 界郭皇后：由自己声明，按手牌与场面挑最合用的牌名
            if (owner && owner === self) {
                const lostHp = owner.maxHp - owner.hp
                const foeInRange = state.generals.some((g) =>
                    g.alive && isEnemy(state, g, playerId)
                    && getAttackRange(owner, g, state.generals).inRange)
                if (lostHp > 0 && has('peach') && !owner.hand.some(isPeach)) return 'peach'
                if (foeInRange && has('attack')) return 'attack'
                if (has('draw_two')) return 'draw_two'
                if (foeInRange && has('dismantle')) return 'dismantle'
                if (has('wine')) return 'wine'
                return options[0]?.action ?? 'attack'
            }
            if (friendly) {
                if (has('dodge')) return 'dodge'
                if (has('peach')) return 'peach'
            }
            if (has('wine')) return 'wine'
            return options[0]?.action ?? 'dodge'
        }
        case 'guohuanghou_danxin': {
            if (has('danxin')) return 'danxin'
            const upgrade = (self as any)?.jiaozhaoUpgrade ?? 0
            if (has('upgrade') && upgrade < 2) return 'upgrade'
            return has('draw') ? 'draw' : options[0]?.action ?? 'decline'
        }
        case 'chengpu_jie_lihuo_cost': {
            const junk = self ? self.hand.filter((c) => !isSlash(c) && !isDodge(c) && !isPeach(c)).length : 0
            if (has('discard') && junk > 0) return 'discard'
            if (has('loseHp') && (self?.hp ?? 1) > 1) return 'loseHp'
            return has('discard') ? 'discard' : 'loseHp'
        }
        case 'caoxiu_jie_qingxi': {
            const qxTarget = state.generals[(ctx.qingxiJieTargetIndex as number) ?? -1]
            if (has('both')) {
                // 有武器：两项都执行但会弃置武器，武器不值钱或能斩杀时才发动
                const weapon = self?.equip?.weapon
                const weakWeapon = !weapon || keepValue(weapon) <= 60
                const lethal = !!qxTarget && qxTarget.hp <= ((ctx.qingxiAmount as number) ?? 1) + 1
                return weakWeapon || lethal ? 'both' : 'decline'
            }
            const need = Math.max(1, (ctx.qingxiCount as number) ?? 1)
            const canDiscard = !!qxTarget && qxTarget.hand.length >= need
            const lethal = !!qxTarget && qxTarget.hp <= ((ctx.qingxiAmount as number) ?? 1) + 1
            if (has('damage') && (lethal || !canDiscard)) return 'damage'
            return has('discard') ? 'discard' : 'damage'
        }
        case 'caifuren_jie_qieting': {
            const jqEnding = state.generals[(ctx.endingIndex as number) ?? -1]
            if (has('both')) return 'both'
            if (has('equip') && jqEnding && equippedCards(jqEnding).length > 0
                && isEnemy(state, jqEnding, playerId)) return 'equip'
            return has('draw') ? 'draw' : 'equip'
        }
        case 'wangyi_jie_zhenlie_choice': {
            const zlSrc = state.generals[(ctx.zhenlieSourceIndex as number) ?? -1]
            const canGain = !!zlSrc && isEnemy(state, zlSrc, playerId)
                && (zlSrc.hand.length > 0 || equippedCards(zlSrc).length > 0)
            if (has('gain') && canGain) return 'gain'
            return has('miji') ? 'miji' : 'gain'
        }
        case 'gongsunyuan_huaiyi': {
            const red = (ctx.hyRed as number) ?? 0
            const black = (ctx.hyBlack as number) ?? 0
            if (red === 0 && has('black')) return 'black'
            if (black === 0 && has('red')) return 'red'
            if (red === 1 && has('red')) return 'red'
            if (black === 1 && has('black')) return 'black'
            return red <= black ? 'red' : 'black'
        }
        case 'caifuren_qieting': {
            const ending = state.generals[(ctx.endingIndex as number) ?? -1]
            if (has('equip') && ending && equippedCards(ending).length > 0) return 'equip'
            return has('draw') ? 'draw' : 'equip'
        }
        case 'caifuren_xianzhou': {
            const chooser = state.generals[(ctx.xianzhouChooserIndex as number) ?? -1]
            const hasEnemyInRange = !!chooser && state.generals.some((g) =>
                g.alive && isEnemy(state, g, playerId) && getAttackRange(chooser, g, state.generals).inRange)
            if (has('damage') && hasEnemyInRange) return 'damage'
            return has('heal') ? 'heal' : 'damage'
        }
        case 'fazheng_xuanhuo': {
            if (slack && has('gain')) return 'gain'
            if (has('slash') && self && self.hand.some((c) => isSlash(c))) return 'slash'
            return has('gain') ? 'gain' : 'slash'
        }
        case 'xiahouyuan_shensu_jie': {
            if (has('all') && !self?.equip?.armor) return 'one_two'
            if (has('one')) return 'one'
            return options[0]?.action ?? 'decline'
        }
        case 'dongzhuo_banghuai': {
            if (has('reduceMaxHp') && (self?.hp ?? 3) <= 2) return 'reduceMaxHp'
            return has('loseHp') ? 'loseHp' : options[0]?.action ?? 'decline'
        }
        case 'sunxiu_yanzhu': {
            // 宴诛：优先弃一张手牌，没有手牌时才交出装备区
            if (has('discard') && (self?.hand.length ?? 0) > 0) return 'discard'
            return has('equip') ? 'equip' : options[0]?.action ?? 'decline'
        }
        case 'huangzhong_liegong': {
            return has('liegong') ? 'liegong' : options[0]?.action ?? 'decline'
        }
        case 'sp_sunshangxiang_liangzhu': {
            // 良助：回复者是己方就让它摸两张，否则自己摸一张
            const lzHealer = state.generals[(ctx.healerIndex as number) ?? -1]
            return lzHealer && !isEnemy(state, lzHealer, playerId)
                ? (has('target') ? 'target' : 'self')
                : (has('self') ? 'self' : 'target')
        }
        case 'liru_fencheng': {
            const need = Math.max(1, (ctx.fenchengNeed as number) ?? 1)
            const hand = self?.hand.length ?? 0
            if (has('discard') && hand > need) return 'discard'
            return has('damage') ? 'damage' : options[0]?.action ?? 'decline'
        }
        case 'xiahouyuan_shensu_jie_placeholder': return 'decline'
        // ══ 洛书版扩展（五）：新增武将选项 ══
        case 'zhonghui_zili': {
            // 自立（觉醒技）：血有缺就回复，否则摸两张牌
            if (has('heal') && self && self.hp < self.maxHp) return 'heal'
            return has('draw') ? 'draw' : (has('heal') ? 'heal' : 'decline')
        }
        case 'caozhang_jiangchi': {
            // 将驰：有废牌可重铸时选②（杀无距离且次数+1），否则选①
            const jcJunk = self ? self.hand.filter((c) => !isSlash(c) && !isDodge(c) && !isPeach(c)).length : 0
            if (has('recast') && jcJunk > 0 && (self?.hand.length ?? 0) >= 2) return 'recast'
            return has('draw') ? 'draw' : 'recast'
        }
        case 'zhangsong_xiantu': {
            // 献图：只给己方；血够厚就给两张
            const xtTo = state.generals[(ctx.xiantuTargetIndex as number) ?? -1]
            if (!xtTo || !xtTo.alive || isEnemy(state, xtTo, playerId)) return 'decline'
            if (has('two') && (self?.hp ?? 3) >= 2) return 'two'
            return has('one') ? 'one' : 'decline'
        }
        case 'zhuran_danshou': {
            // 胆守：敌方优先斩杀/获牌，己方只在手牌充裕时各摸两张
            const dsT = state.generals[(ctx.danshouTargetIndex as number) ?? -1]
            const dsHand = self?.hand.length ?? 0
            if (dsT && isEnemy(state, dsT, playerId)) {
                if (dsT.hp <= 1 && has('3')) return '3'
                if (has('2') && dsHand >= 2) return '2'
                if (has('3') && dsHand >= 3) return '3'
                if (has('1') && dsHand >= 1) return '1'
                if (has('3')) return '3'
                if (has('4')) return '4'
                return options[0]?.action ?? 'decline'
            }
            if (has('4') && dsHand >= 5) return '4'
            return 'decline'
        }
        case 'zhangchunhua_jianmie': {
            const jmRed = self ? self.hand.filter(isRedCard).length : 0
            const jmBlack = self ? self.hand.filter(isBlackCard).length : 0
            const jmHasSlash = (self?.hand ?? []).some(isSlash)
            const jmMore = jmRed >= jmBlack ? 'red' : 'black'
            const jmFewer = jmRed <= jmBlack ? 'red' : 'black'
            // 手里有【杀】时尽量弃得多（弃牌多的一方发起【决斗】）
            return jmHasSlash ? jmMore : jmFewer
        }
        case 'zhangchunhua_jianmie_opp': {
            // 同时选色：看不到张春华选了什么，只按自己手牌决定弃多还是弃少
            const jmMyRed = self ? self.hand.filter(isRedCard).length : 0
            const jmMyBlack = self ? self.hand.filter(isBlackCard).length : 0
            const jmMySlash = (self?.hand ?? []).some(isSlash)
            if (jmMySlash) return jmMyRed >= jmMyBlack ? 'red' : 'black'
            return jmMyRed <= jmMyBlack ? 'red' : 'black'
        }
        case 'zhonghui_paiyi': {
            const pyT = state.generals[(ctx.paiyiTargetIndex as number) ?? -1]
            if (pyT && isEnemy(state, pyT, playerId)) return has('damage') ? 'damage' : 'draw'
            return has('draw') ? 'draw' : 'damage'
        }
        case 'zhangzhao_guzheng': {
            // 固政：交还点数最低的一张给对方，自己留下更好的牌
            const gzOrder = (ctx.guzhengOrderedIds as string[]) ?? []
            for (const id of gzOrder) {
                const gzHit = options.find((o) => o.action === `return:${id}`)
                if (gzHit) return gzHit.action
            }
            return options[0]?.action ?? 'decline'
        }
        default:
            return options[0]?.action ?? 'decline'
    }
}

export function aiAct(state: GameState, playerId: string = AI_PLAYER_ID): boolean {
    const aiFaction = state.players[playerId]?.faction
    if (!aiFaction) return false

    if (aiDraft(state, playerId)) return true

    if (state.phase !== GamePhase.PLAYING) return false

    if (state.roundState.waitingForYield) {
        if (aiFaction === Faction.COOL) {
            return handleYieldChoice(state, playerId, false) === undefined
        }
        return false
    }

    if (state.negateWindow) {
        const nw = state.negateWindow
        if (nw.passedPlayerIds?.includes(playerId)) return false
        const ownIndex = state.generals.findIndex((g) => g.playerId === playerId && g.alive)
        const negateOwner = state.generals
            .map((g, index) => ({ g, index }))
            .find(({ g }) => g.playerId === playerId && g.alive
                && g.hand.some((c) => canPlayAsNegate(g, c) && !blockedByQianxiView(g, c)))
        const target = state.generals[nw.trickTargetIndex]
        const trickUser = state.generals[nw.trickUserIndex]
        const ownTrick = !!trickUser && trickUser.faction === aiFaction
        const allyTarget = !!target && !!aiFaction && target.faction === aiFaction
        const name = nw.trickCardName
        // 无懈按威胁分级，而不是"有锦囊就无懈"
        // 高：己方被判定的乐/兵粮、拆顺己方判定区与关键装备、会致死的一击
        const allyHand = target?.hand ?? []
        const lethalOnAlly = allyTarget && (
            (name === TrickCardName.ARROWS && target!.hp <= 1 && !allyHand.some(isDodge)) ||
            (name === TrickCardName.BARBARIANS && target!.hp <= 1 && !allyHand.some(isSlash)) ||
            (name === TrickCardName.DUEL && target!.hp <= 1 && !allyHand.some(isSlash)) ||
            (name === TrickCardName.FIRE_ATTACK && target!.hp <= 1)
        )
        const enemyTrick = !!trickUser && trickUser.faction !== aiFaction
        const myNegates = negateOwner?.g.hand.filter((c) => canPlayAsNegate(negateOwner.g, c)).length ?? 0
        const commanderLow = myGenerals(state, playerId).some(
            ({ g }) => g.seatRole === SeatRole.COMMANDER && g.alive && g.hp <= 2)
        // 分级响应：保护关键控制 > 挡致死一击 > 保关键牌 > 保主帅 > 抢节奏。
        // 己方使用的锦囊不主动无懈，只有被敌方无懈后才反制。
        const negateValue = negateScore({
            ownTrick,
            allyTarget,
            isCurrentlyNegated: !!nw.isCurrentlyNegated,
            allyKeyDelayed: allyTarget &&
                (name === TrickCardName.OVERINDULGENCE || name === TrickCardName.SUPPLY_SHORTAGE),
            lethalOnAlly: !!lethalOnAlly,
            // 拆/顺只掉一张牌，无懈是保命资源：只有可能掉到关键牌（延时、牌见底、
            // 装备成堆、本人已经残血）才值得拦
            allyLosingKeyCard: allyTarget &&
                (name === TrickCardName.DISMANTLE || name === TrickCardName.STEAL) &&
                (target!.judgeZone.some(isDelayedTrickInJudgeZone) || target!.hand.length <= 2 ||
                    equippedCards(target!).length >= 2 || target!.hp <= 2),
            mediumOnAlly: allyTarget &&
                (name === TrickCardName.DUEL || name === TrickCardName.FIRE_ATTACK) &&
                (target!.hp <= 2 || target!.seatRole === SeatRole.COMMANDER),
            enemyLowHandDraw: !ownTrick && !allyTarget && name === TrickCardName.DRAW_TWO &&
                enemyTrick && (trickUser?.hand.length ?? 9) <= 1,
            enemyGreedyValue: !ownTrick && !allyTarget && name === TrickCardName.DRAW_TWO && enemyTrick,
            aoeNonLethal: allyTarget &&
                (name === TrickCardName.BARBARIANS || name === TrickCardName.ARROWS),
            myNegates,
            savingNegate: commanderLow || myNegates <= 1,
        })
        const dc = beginDecision(state, playerId, 'negate', { under_threat: commanderLow })
        const negateThreshold = thresholdFor(dc, 'NEGATE_THRESHOLD', 55)
        const shouldNegate = !!negateOwner && negateValue >= negateThreshold
        if (negateOwner && shouldNegate) {
            const card = negateOwner.g.hand.find(
                (c) => canPlayAsNegate(negateOwner.g, c) && !blockedByQianxiView(negateOwner.g, c),
            )!
            const negateResult = handleNegateRespond(state, playerId, { cardId: card.id, generalIndex: negateOwner.index })
            if (!negateResult || !('error' in negateResult)) {
                endDecision(dc, 'negate', 'negate:play', [], {
                    negateValue, threshold: negateThreshold, trick: name,
                })
                return true
            }
        }
        endDecision(dc, 'negate', 'negate:pass', [], {
            negateValue, threshold: negateThreshold, trick: name,
        })
        const passResult = handleNegateRespond(state, playerId, { generalIndex: Math.max(ownIndex, 0) })
        if (passResult && 'error' in passResult) negateWindowTimeout(state)
        return true
    }

    if (state.pendingResponseQueue.length > 0) {
        if (!aiOwnsPending(state, playerId)) return false
        return aiRespond(state, playerId)
    }

    // 斗地主/欢乐成双没有行动单元的概念，直接由座次轮转
    if (state.mode !== GameMode.DOUDIZHU && state.mode !== GameMode.HUANLE_SHUANG
        && aiChooseUnit(state, playerId)) return true

    if (aiPlayOne(state, playerId)) return true
    if (aiDiscard(state, playerId)) return true

    const active = getActiveGeneral(state)
    if (active?.playerId === playerId && state.turnPhase === TurnPhase.ACTION) {
        return handleEndTurn(state, playerId) === undefined
    }
    return false
}
