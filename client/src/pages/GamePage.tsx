import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'
import {
    Faction,
    TurnPhase,
    ActionUnitType,
    SeatRole,
    GeneralClientView,
    Card,
    CardSuit,
    CardCategory,
    BasicCardName,
    TrickCardName,
    ResponseType,
    GameStateClientView,
    EquipmentCardName,
    SkillType,
    LogEntry,
} from 'sgs3v3-shared'
import { emit } from '../actions'
import { GENERAL_IMAGE } from '../data/generalImages'
import { useTooltip, generalTooltipById, cardTooltipContent, TooltipBubble } from '../components/Tooltip'
import { getAttackRange } from '../engine/game-state'
import { logReviewId } from '../engine/match-log'
import { clearReviewQueue, copyText, getReviewQueue, pruneReviewQueue, pushReviewId } from '../engine/review'
import { cardNameOf } from '../engine/card-utils'
import { CARD_TOOLTIP } from '../data/tooltipData'
import { GENERALS, getGeneralById, getSkillDefById } from '../engine/generals'
import { exitLocalMatch, getCoachSuggestions, getLocalPace, getPoolStats, isLocalMatchActive, setLocalPace, type CoachSuggestion, type PoolStats } from '../engine/local-dispatch'
import { pairBoardSeats } from '../modes/HappyPair/pair-match'
import './GamePage.css'
import './GamePagePair.css'
import '../fx/fx.css'
import { FxLayer, type FxHandle, type LineTone } from '../fx/FxLayer'
import { playSfx, type SfxKind } from '../audio/sfx'
import { centerIn } from '../fx/measure'
import { DUR } from '../fx/ease'
import { wait } from '../fx/track'

const GENERAL_NAMES: Record<string, string> = {
    // 蜀
    liubei: '刘备', liubei_jie: '界刘备', guanyu: '关羽', zhangfei: '张飞',
    zhugeliang: '诸葛亮', zhaoyun_jing: '赵云-竞', huangyueying: '界黄月英',
    machao: '马超', jiangwei: '姜维',
    // 魏
    caocao: '曹操', simayi: '司马懿', xiahoudun: '夏侯惇',
    zhangliao: '界张辽', guojia: '郭嘉', zhenji: '界甄姬',
    xiahouyuan: '夏侯渊', xuhuang: '徐晃', xuhuang_jie: '界徐晃', wenpin: '文聘',
    // 吴
    sunquan: '孙权', ganning: '甘宁', huanggai: '黄盖',
    zhouyu: '周瑜', daqiao: '大乔', sunshangxiang: '孙尚香',
    sunjian: '孙坚', xiaoqiao: '小乔', sunce: '孙策', zhugejin: '诸葛瑾',
    // 群
    huatuo: '界华佗', lvbu: '吕布', diaochan: '界貂蝉', pangde: '庞德', jiaxu: '贾诩',
    chengong: '陈宫', jushou: '沮授', fuwan: '伏完', zhangjiao: '张角',
    // 平衡版扩展
    lidian_jie: '界李典', simayi_jing: '司马懿-竞', xuchu_jie: '界许褚',
    dengai: '邓艾', xunyou: '界荀攸', wangyi: '王异', wangji: '王基',
    yuejin: '乐进', simalang: '司马朗', litong: '李通',
    caocao_jie: '界曹操', dianwei_jie: '界典韦',
    machao_jie: '界马超', madai: '界马岱', sunshangxiang_sp: 'SP孙尚香',
    zhoucang: '周仓', yanyan: '严颜', wangping: '王平',
    huangquan_jing: '黄权', sunqian: '孙乾',
    lingtong: '凌统', ganning_jie: '界甘宁', zhouyu_jie: '界周瑜',
    luxun_jie: '界陆逊', guyong: '界顾雍', dingfeng: '丁奉',
    yufan: '虞翻', zumao: '祖茂', zhugeke: '诸葛恪',
    lingcao: '凌操', caifuren: '蔡夫人', lvbu_jing: '吕布-竞',
    xiahoudun_jing: '夏侯惇-竞',
    // 洛书版
    liuchen: '刘谌', huaxiong_jie: '界华雄', weiyan: '魏延',
    luji: '陆绩', haozhao: '郝昭', xuyou: '许攸', handang: '韩当', fazheng: '法正',
    masu: '马谡', zhongyao: '钟繇', chengpu: '程普', cenhun: '岑昏', sundeng: '孙登',
    guotu: '郭图逢纪', caoxiu: '曹休', guohuanghou: '郭皇后', xiahoushi: '夏侯氏',
    gongsunyuan: '公孙渊', quancong: '界全琮',
    // 洛书版扩展（五）
    zhonghui_jie: '界钟会', zhangchunhua_jie: '界张春华', caozhang_jie: '界曹彰',
    zhangsong_jie: '界张松', fuhuanghou_jie: '界伏皇后', zhuran_jie: '界朱然',
    caochong_jie: '界曹冲', mizhu: '糜竺', caorui: '曹叡', liufeng: '刘封', zhanghe: '张郃', xuezong: '薛综',
}

// 未手写过的武将（含各批扩展）统一取定义里的名字，避免面板上直接显示 id
for (const def of GENERALS) {
    if (!(def.id in GENERAL_NAMES)) GENERAL_NAMES[def.id] = def.name
}
const GENERAL_NAME_SET = new Set(Object.values(GENERAL_NAMES))

function getSuitSymbol(suit: string) {
    return { spade: '♠', heart: '♥', club: '♣', diamond: '♦' }[suit] ?? ''
}

function isRedSuit(suit: string) {
    return suit === CardSuit.HEART || suit === CardSuit.DIAMOND
}

function getValueStr(v: number) {
    return { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' }[v] ?? String(v)
}

/** 装备区只露类型图标 + 双字简称（青龙偃月刀 → 青龙），其余信息走悬停 */
function equipShortName(name: string): string {
    if (name === EquipmentCardName.PLUS_HORSE) return '+1'
    if (name === EquipmentCardName.MINUS_HORSE) return '-1'
    return cardNameOf(name).slice(0, 2)
}

/** 装备悬停气泡：花色点数 + 效果说明（武器说明里已含攻击范围） */
function equipTooltipContent(card: Card) {
    const full = cardNameOf(card.name)
    const detail = CARD_TOOLTIP[card.name]?.desc ?? ''
    const range = card.attackRange && !detail.startsWith('攻击范围') ? `攻击范围${card.attackRange}。` : ''
    return {
        title: full,
        items: [{ name: `${getSuitSymbol(card.suit as string)}${getValueStr(card.value as number)}`, desc: `${range}${detail}` }],
    }
}

/** 只需要一名目标、且目标唯一时可以自动选中的牌（借刀杀人是两段目标，不在此列） */
const SINGLE_TARGET_CARD_NAMES: string[] = [
    BasicCardName.ATTACK, BasicCardName.FIRE_SLASH, BasicCardName.THUNDER_SLASH,
    TrickCardName.DISMANTLE, TrickCardName.STEAL, TrickCardName.DUEL,
    TrickCardName.FIRE_ATTACK, TrickCardName.OVERINDULGENCE, TrickCardName.SUPPLY_SHORTAGE,
]

interface SkillDef {
    id: string
    name: string
    desc: string
    /** 与当前技能共用“本阶段已发动”判定的其它技能 id（例如界国色的两种用法） */
    usedWith?: string[]
    /** 需要“矫诏”修改等级达到该层级才可用（界郭皇后） */
    jzLevel?: number
    /** 每轮限一次的记录字段（界郭皇后矫诏修改） */
    roundField?: 'jiaozhaoMod1Round' | 'jiaozhaoMod2Round'
    /** 需要觉醒等方式获得该技能后才可用（界钟会排异） */
    requireAcquired?: boolean
}

/** 各武将在出牌阶段可主动发动的技能 */
function ACTIVE_SKILLS_FOR(generalId: string): SkillDef[] {
    const map: Record<string, SkillDef[]> = {
        sunquan: [{ id: 'sunquan_zhiheng', name: '制衡', desc: '限一次：弃任意张手牌，摸等量牌' }],
        sunquan_jie: [{ id: 'sunquan_jie_zhiheng', name: '制衡', desc: '限一次：弃任意张牌，摸等量牌；若弃置了所有手牌，多摸一张' }],
        sunquan_jing: [{ id: 'sunquan_jing_zhiheng', name: '制衡', desc: '限一次：弃任意张牌，摸等量牌；己方有角色阵亡且弃置全部手牌时，额外摸X张（X为己方阵亡数）' }],
        huanggai: [{ id: 'huanggai_kurou', name: '苦肉', desc: '失去1体力，摸2张牌' }],
        sunshangxiang: [{ id: 'sunshangxiang_jieyin', name: '结姻', desc: '限一次：弃2牌，与已受伤男性各回1血' }],
        huatuo: [{ id: 'huatuo_qingnang', name: '青囊', desc: '限一次：弃1张手牌，令一名已受伤的角色回复1点体力' }],
        dongyun: [{ id: 'dongyun_bingzheng', name: '秉正', desc: '限一次：令手牌数≠体力值的角色弃1张或摸1张；若之后相等你摸1张并可将1张交给其' }],
        caoren_sp: [{ id: 'caoren_weikui', name: '伪溃', desc: '限一次：失去1体力，观看一名角色手牌：有【闪】视为对其使用【杀】，否则弃其一张牌' }],
        jiangwei: [{ id: 'jiangwei_tiaoxin', name: '挑衅', desc: '限一次：对方角色出杀否则弃其一牌' }],
        jiangwei_jie: [{ id: 'jiangwei_tiaoxin', name: '挑衅', desc: '限一次：令一名其他角色选择对你出杀（若你在其攻击范围内）或令你弃其一牌' }],
        diaochan: [{ id: 'diaochan_lijian', name: '离间', desc: '限一次：弃1牌，令两名男性决斗' }],
        zhouyu: [{ id: 'zhouyu_fanjian', name: '反间', desc: '限一次：目标选花色→获你一牌→不同受1伤' }],
        liubei: [{ id: 'liubei_rende', name: '仁德', desc: '将手牌给其他角色，每给2张回1血' }],
        liubei_jie: [{ id: 'liubei_rende', name: '仁德', desc: '将手牌给其他角色，每给2张回1血' }],
        guanyu: [
            { id: 'guanyu_wusheng', name: '武圣', desc: '红色手牌当杀使用（切换模式）' },
            { id: 'guanyu_zhongyi', name: '忠义', desc: '限定：置红牌，己方杀+1伤' },
        ],
        jiaxu: [{ id: 'jiaxu_luanwu', name: '乱武', desc: '限定：所有其他角色出杀或失1血' }],
        guanyu_jie: [{ id: 'guanyu_jie_yijue', name: '义绝', desc: '限一次：弃一张牌，令一名其他角色展示一张手牌' }],
        zhangmancheng: [{ id: 'zhangmancheng_luecheng', name: '掠城', desc: '限一次：标记手牌中的【杀】，本回合对其使用无次数限制' }],
        menghuo_sp: [{ id: 'menghuo_sp_manwang', name: '蛮王', desc: '弃任意张牌，依次执行等量项' }],
        caimao: [{ id: 'caimao_zuolian', name: '佐练', desc: '限一次：令至多体力值名角色展示手牌，随机交换火/雷【杀】' }],
        chengong: [{
            id: 'chengong_mingce', name: '明策',
            desc: '限一次：选1张装备牌或【杀】，再选受牌者（可再选其攻击范围内的杀目标）；其视为出杀或摸一张牌',
        }],
        ganning: [{ id: 'ganning_qixi', name: '奇袭', desc: '黑色牌当过河拆桥' }],
        ganning_jing: [{ id: 'ganning_qixi', name: '奇袭', desc: '黑色牌当过河拆桥' }],
        xuhuang_jing: [{ id: 'xuhuang_jing_duanliang', name: '断粮', desc: '黑色非锦囊牌当兵粮寸断；对距离为2的其他角色无距离限制' }],
        daqiao: [{ id: 'daqiao_guose', name: '国色', desc: '♦牌当乐不思蜀' }],
        simalang: [{ id: 'simalang_quji', name: '去疾', desc: '限一次：弃X张牌（X为已损体力），令至多X名角色各回1血；含黑色牌则失去1血' }],
        dianwei_jie: [{ id: 'dianwei_jie_qiangxi', name: '强袭', desc: '限两次：受到1点伤害或弃1张武器牌，对一名其他角色造成1点伤害（每名角色每阶段限一次）' }],
        wangping: [{ id: 'wangping_feijun', name: '飞军', desc: '限一次：弃1张牌，令一名角色交你一张牌或令你摸两张' }],
        huangquan_jing: [{ id: 'huangquan_jianji', name: '谏计', desc: '限一次：令一名其他角色摸一张牌，然后其可以使用该牌' }],
        zhouyu_jie: [{ id: 'zhouyu_jie_fanjian', name: '反间', desc: '限一次：展示一张手牌交给一名敌方角色，令其本回合非锁定技失效，然后其弃同花色所有牌（至少两张）或失去1点体力' }],
        guyong: [{ id: 'guyong_shenxing', name: '慎行', desc: '限体力值次：弃2张牌，颜色不同摸2张，否则摸1张' }],
        dingfeng: [{ id: 'dingfeng_fenxun', name: '奋迅', desc: '限一次：本回合与一名角色距离视为1；若本回合未对其造成伤害，回合结束时弃一张牌' }],
        zhugeke: [{ id: 'zhugeke_duwu', name: '黩武', desc: '弃X张牌（X为目标体力），对攻击范围内一名角色造成1点伤害' }],
        caifuren: [{ id: 'caifuren_xianzhou', name: '献州', desc: '限定：将装备区所有牌交给一名角色，令其回复等量体力或造成伤害' }],
        dengai: [{ id: 'dengai_jixi', name: '急袭', desc: '将一张“田”当【顺手牵羊】使用' }],
        xunyou: [{ id: 'xunyou_qice', name: '奇策', desc: '限一次：将所有手牌当普通锦囊使用（先选目标，再选锦囊）' }],
        zumao: [{ id: 'zumao_yinbing', name: '引兵', desc: '限一次：将任意张非基本牌置于武将牌上' }],
        liuchen: [{ id: 'liuchen_zhanjue', name: '战绝', desc: '将所有手牌当【决斗】使用，结算后你与受伤角色各摸一张' }],
        huaxiong_jie: [{ id: 'huaxiong_shizhan', name: '势斩', desc: '限两次：令一名其他角色视为对你使用【决斗】' }],
        weiyan: [{ id: 'weiyan_qimou', name: '奇谋', desc: '限定：失去任意点体力，本回合距离-X、【杀】次数上限+X' }],
        xuyou: [{ id: 'xuyou_chenglue', name: '成略', desc: '限一次：阳摸1弃2 / 阴摸2弃1，本回合该花色无距离与次数限制' }],
        handang: [
            { id: 'handang_gongqi', name: '弓骑', desc: '限一次：弃1张牌，本阶段攻击范围无限；弃装备可再拆一张牌' },
            { id: 'handang_jiefan', name: '解烦', desc: '限定：令攻击范围内含目标者弃武器或让目标摸一张牌' },
        ],
        masu: [{ id: 'masu_sanyao', name: '散谣', desc: '每项限一次：弃1张牌，对体力最多/手牌最多者造成1点伤害' }],
        cenhun: [{ id: 'cenhun_jishe', name: '极奢', desc: '摸一张牌，本回合手牌上限-1（手牌上限需大于0）' }],
        sundeng: [{ id: 'sundeng_kuangbi', name: '匡弼', desc: '限一次：令一名其他角色将至多三张牌置于你武将牌上，下回合获得' }],
        guohuanghou: [{ id: 'guohuanghou_jiaozhao', name: '矫诏', desc: '限一次：展示一张手牌，令最近的其他角色声明基本牌，本回合当该牌使用' }],
        xiahoushi: [{ id: 'xiahoushi_yanyu', name: '燕语', desc: '重铸一张【杀】；本阶段重铸两张后可为一名男性角色摸两张牌' }],
        gongsunyuan: [{ id: 'gongsunyuan_huaiyi', name: '怀异', desc: '限一次：展示手牌，弃一种颜色的所有牌，获得等量其他角色各一张牌' }],
        xiahouyuan_jie: [],
        caoren: [],
        guanyinping: [{ id: 'guanyinping_xuehen', name: '雪恨', desc: '限一次：弃1张红牌，横置至多X名角色并对其中一名造成1点火焰伤害' }],
        chenqun: [{ id: 'chenqun_pindi', name: '品第', desc: '弃1张牌，令一名角色摸X张或弃X张牌（X为本回合发动次数）' }],
        xunyu: [{ id: 'xunyu_quhu', name: '驱虎', desc: '限一次：与体力值大于你的角色拼点，赢则令其造成1点伤害' }],
        zhurong_jie: [{ id: 'zhurong_changbiao', name: '长标', desc: '限一次：任意张手牌当一张无距离限制的【杀】' }],
        liushan: [{ id: 'liushan_fangquan', name: '放权', desc: '跳过出牌阶段，本回合结束时可令一名其他角色获得额外回合' }],
        zhangzhaozhanghong_jie: [{ id: 'zhangzhao_zhijian', name: '直谏', desc: '将一张装备牌置入其他角色装备区，然后摸一张牌' }],
        dongzhuo: [{ id: 'dongzhuo_jiuchi', name: '酒池', desc: '将一张黑桃手牌当【酒】使用' }],
        pangtong: [{ id: 'pangtong_lianhuan', name: '连环', desc: '将一张手牌当【铁索连环】使用' }],
        yanliangwenchou_jie: [{ id: 'yanliang_shuangxiong', name: '双雄', desc: '本回合可将与弃置牌颜色不同的牌当【决斗】使用' }],
        wolong: [{ id: 'wolong_huoji', name: '火计', desc: '将一张红色手牌当【火攻】使用' }],
        taishici: [{ id: 'taishici_tianyi', name: '天义', desc: '限一次：与一名角色拼点，赢则本回合【杀】次数与目标+1、无距离限制' }],
        zhoufei: [],
        lusu: [{ id: 'lusu_dimeng', name: '缔盟', desc: '限一次：弃X张牌，令两名其他角色交换手牌' }],
        bulianshi_jie: [{ id: 'bulianshi_anxu', name: '安恤', desc: '限一次：获得两名角色各一张牌，再交给其中手牌较少者' }],
        kuailiangkuaiyue: [{ id: 'kuailiang_shenshi', name: '审时', desc: '阳：交给手牌最多的其他角色一张牌，对其造成1点伤害' }],
        gaoshun_jie: [{ id: 'gaoshun_xianzhen', name: '陷阵', desc: '限一次：与一名角色拼点，赢则本回合无视其防具与距离次数限制' }],
        zhoufang: [{ id: 'zhoufang_duanfa', name: '断发', desc: '弃任意张黑色牌，摸等量的牌（本阶段至多弃置体力上限张）' }],
        // 洛书版扩展（三）：界将升级
        huanggai_jie: [{ id: 'huanggai_kurou', name: '苦肉', desc: '限一次：弃1张牌，失去1体力（【诈降】摸3张）' }],
        chengong_jie: [{
            id: 'chengong_mingce', name: '明策',
            desc: '限一次：选1张装备牌或【杀】，再选受牌者（可再选其攻击范围内的杀目标）；其视为出杀或摸一张牌，造成伤害或选择摸牌时你与其各摸一张',
        }],
        huatuo_jie: [{ id: 'huatuo_qingnang', name: '青囊', desc: '限一次：弃1张手牌，令一名已受伤的角色回复1点体力；弃置红色牌则本阶段可再次发动（每名角色每阶段限一次）' }],
        jiaxu_jie: [{ id: 'jiaxu_luanwu', name: '乱武', desc: '限定：所有其他角色出杀或失1血；结算结束后可视为使用一张无距离限制的【杀】' }],
        diaochan_jie: [{ id: 'diaochan_lijian', name: '离间', desc: '限一次：弃1牌，令两名男性决斗' }],
        xuhuang_jie: [{ id: 'xuhuang_jie_duanliang', name: '断粮', desc: '黑色非锦囊牌当兵粮寸断；对手牌数不少于你的角色无距离限制' }],
        sunshangxiang_jie: [{
            id: 'sunshangxiang_jie_jieyin', name: '结姻',
            desc: '限一次：选一名男性角色，弃一张手牌或将一张装备牌置入其装备区；体力高者摸一张，体力低者回复1点',
        }],
        xuezong: [{ id: 'xuezong_jiexun', name: '诫训', desc: '结束阶段：令一名其他角色摸场上♦牌数张，再弃此前发动次数张' }],
        jiangqin: [{ id: 'jiangqin_shangyi', name: '尚义', desc: '限一次：弃1张牌，令一名有手牌的其他角色观看你的手牌，然后你观看其手牌并获得其中1张' }],
        daqiao_jie: [
            { id: 'daqiao_jie_guose', name: '国色', desc: '限一次：♦牌当【乐不思蜀】使用，然后摸一张' },
            {
                id: 'daqiao_jie_guose_discard', name: '国色·拆乐',
                desc: '限一次：弃一张♦牌，并弃置场上的一张【乐不思蜀】，然后摸一张（需选择目标）',
                usedWith: ['daqiao_jie_guose'],
            },
        ],
        caifuren_jie: [{ id: 'caifuren_xianzhou', name: '献州', desc: '限定：将装备区所有牌交给一名角色，令其回复等量体力或造成伤害' }],
        simayi_jing: [
            { id: 'simayi_jing_jiaozhao', name: '矫诏', desc: '限一次：将一张牌当任意基本牌使用' },
            {
                id: 'simayi_jing_jiaozhao_mod1', name: '矫诏·修改一',
                desc: '每轮限一次：将一张牌当任意基本牌或普通锦囊牌使用',
                jzLevel: 1, roundField: 'jiaozhaoMod1Round',
            },
            {
                id: 'simayi_jing_jiaozhao_mod2', name: '矫诏·修改二',
                desc: '每轮限一次：视为使用一张基本牌或普通锦囊牌',
                jzLevel: 2, roundField: 'jiaozhaoMod2Round',
            },
        ],
        taishici_jie: [{ id: 'taishici_tianyi', name: '天义', desc: '限一次：与一名角色拼点，赢则本回合【杀】次数与目标+1、无距离限制' }],
        chengpu_jie: [{
            id: 'chengpu_jie_lihuo', name: '疠火',
            desc: '将一张不为火【杀】的【杀】改为火【杀】使用（切换模式；火【杀】可多选一个目标）',
        }],
        // 洛书版扩展（四）：新增武将
        sunxiu: [{
            id: 'sunxiu_yanzhu', name: '宴诛',
            desc: '限一次：令一名有牌的其他角色选择弃一张牌，或令你获得其装备区里的所有牌（你失去【宴诛】）',
        }],
        zhuzhi: [{
            id: 'zhuzhi_anguo', name: '安国',
            desc: '限一次：令一名其他角色在其手牌数/体力值/装备数最少的一项上摸一张/回复1点/随机使用装备牌',
        }],
        zhangxiu: [{
            id: 'zhangxiu_xiongluan', name: '雄乱',
            desc: '限定：废除判定区与装备区，本回合对其用牌无距离与次数限制且其不能使用或打出手牌',
        }],
        liru: [
            { id: 'liru_mieji', name: '灭计', desc: '限一次：将一张黑色锦囊牌置于牌堆顶，令一名有手牌的其他角色弃置一张牌' },
            { id: 'liru_fencheng', name: '焚城', desc: '限定：从一名角色开始依次弃置至少X张牌或受到2点火焰伤害' },
        ],
        // 洛书版扩展（五）：新增武将
        zhonghui_jie: [{
            id: 'zhonghui_paiyi', name: '排异',
            desc: '限一次：移去一张“权”，令一名角色摸两张牌或受到1点伤害；若其手牌数大于你，你执行另一项且本阶段改为限两次',
            requireAcquired: true,
        }],
        zhangchunhua_jie: [{
            id: 'zhangchunhua_jianmie', name: '翦灭',
            desc: '限一次：与一名其他角色各选一种颜色并弃置该颜色的所有手牌，弃牌多者视为对弃牌少者使用【决斗】',
        }],
        zhuran_jie: [{
            id: 'zhuran_danshou', name: '胆守',
            desc: '每项限一次：选一名角色弃其一张牌/获得其一张牌/对其造成1点伤害/你与其各摸两张牌，然后弃置本次序号数张牌',
        }],
        mizhu: [{
            id: 'mizhu_ziyuan', name: '资援',
            desc: '限一次：交给一名其他角色任意张点数之和为13的牌，然后其回复1点体力',
        }],
        caorui: [{
            id: 'caorui_mingjian', name: '明鉴',
            desc: '限一次：将所有手牌交给一名其他角色，其下个回合手牌上限+1且使用【杀】次数上限+1',
        }],
        guanqiujian: [{
            id: 'guanqiujian_qingce', name: '清侧',
            desc: '获得一张“荣”并弃置一张手牌，然后弃置场上的一张牌',
            requireAcquired: true,
        }],
        chenlin: [{
            id: 'chenlin_songci', name: '颂词',
            desc: '每名角色限一次：选择一名手牌数≠体力值的角色，其摸两张或弃两张牌',
        }],
        liuyan: [{
            id: 'liuyan_limu', name: '立牧',
            desc: '限一次：将一张牌当【乐不思蜀】置于自己的判定区，并回复1点体力；判定区有牌时，对攻击范围内的其他角色用牌无距离和次数限制',
        }],
        shenlusu: [{
            id: 'shenlusu_tamo', name: '榻谟',
            desc: '限定技：失去1点体力，然后重新排列所有角色的座次（不影响行动顺序）',
        }, {
            id: 'shenlusu_dingzhou', name: '定州',
            desc: '限一次：交给一名场上有牌的其他角色X张牌（X为其场上牌数），然后获得其场上的所有牌',
        }],
        sunchen: [{
            id: 'sunchen_zigu', name: '自固',
            desc: '限一次：弃一张牌，获得自己或一名有装备角色装备区里的一张牌',
        }],
        peixiu: [{
            id: 'peixiu_juezhi', name: '爵制',
            desc: '弃置至少两张牌，随机获得牌堆中一张点数为X的牌（X为弃牌点数之和除以13的余数）',
        }],
        baoxin: [{
            id: 'baoxin_taotao', name: '募讨',
            desc: '限一次：令一名角色将其所有【杀】依次随机交给其下家起的每名角色，然后其对最后一名角色造成X点伤害',
        }],
        liuxie: [{
            id: 'liuxie_mizhao', name: '密诏',
            desc: '限一次：将所有手牌交给一名其他角色，令其与你选择的另一名其他角色拼点，赢的角色视为对没赢的角色使用【杀】',
        }],
        shenzhaoyun: [{
            id: 'shenzhaoyun_longhun', name: '龙魂',
            desc: '一至两张同花色的牌：♥当【桃】/ ♦当火【杀】/ ♣当【闪】/ ♠当【无懈可击】；两张红色则回复或伤害+1',
        }],
        shanzhaoyun: [{
            id: 'shanzhaoyun_zhendan', name: '镇胆',
            desc: '将一张非基本手牌当本轮未使用过的基本牌使用（【杀】需选目标）',
        }],
        manchong: [{
            id: 'manchong_junxing', name: '峻刑',
            desc: '限一次：弃任意张手牌，令一名其他角色弃等量牌并失1血，或翻面摸等量牌',
        }],
        mazhong: [{
            id: 'mazhong_fuman', name: '抚蛮',
            desc: '每名角色限一次：交给一名其他角色一张手牌，其视为使用【杀】',
        }],
        zhanghua: [{
            id: 'zhanghua_jianhe', name: '剑合',
            desc: '每名角色限一次：重铸至少两张同名牌或装备牌，令其重铸等量牌或受1点雷电伤害',
        }],
        sunchen_shi: [{
            id: 'sunchen_shi_nigu', name: '逆固',
            desc: '限一次：弃置任意张花色不同的牌，令攻击范围内的角色选择是否交给你一张牌，本回合下X次伤害+1',
        }],
        zhenghun: [{
            id: 'zhenghun_qiangzhi', name: '强峙',
            desc: '限一次：弃置你与一名其他角色的共计三张牌，令失去三张牌者对另一方造成1点伤害',
        }],
        qianzhao: [{
            id: 'qianzhao_weifu', name: '威抚',
            desc: '弃一张牌并判定：本回合下一张同类别牌无距离限制且可多指定一个目标；类别相同则摸一张',
        }],
        wuxian_zu: [{
            id: 'wuxian_zu_yirong', name: '移荣',
            desc: '限两次：摸至/弃至手牌上限，然后手牌上限-1/+1',
        }],
    }
    return map[generalId] ?? []
}

/** 被授予但不进按钮栏的技能：飞扬、跋扈是地主的地主技，由引擎自动询问/结算 */
const HIDDEN_ACQUIRED_SKILLS = new Set(['doudizhu_feiyang', 'doudizhu_bahu'])

/** 日志面板默认渲染的最近条数；更早的日志展开后仍可查看，避免长局丢失前半段 */
const LOG_RECENT_LIMIT = 200

/** 因其他武将（灵鹎焚心等）获得的技能：锁定技不占按钮，其余按技能定义展示 */
function acquiredSkillDefs(general: GeneralClientView): SkillDef[] {
    const own = new Set(ACTIVE_SKILLS_FOR(general.generalId).map((s) => s.id))
    const out: SkillDef[] = []
    for (const id of general.acquiredSkills ?? []) {
        if (own.has(id) || HIDDEN_ACQUIRED_SKILLS.has(id)) continue
        const def = getSkillDefById(id)
        if (!def || def.type === SkillType.LOCKED) continue
        out.push({ id: def.id, name: def.name, desc: def.description })
    }
    return out
}

/** 按牌名判断引导线配色：杀/决斗红，装备蓝，其余锦囊紫 */
function lineToneOf(cardName: string): LineTone {
    const t = cardName.replace(/[【】\s]/g, '')
    if (t.includes('杀') || t.includes('决斗')) return 'slash'
    if (/[刀剑弓斧矛扇甲马]/.test(t)) return 'equip'
    return 'trick'
}

/** 键盘操作上下文：渲染期刷新，监听器只注册一次 */
type KeyCtx = {
    canPlay: boolean
    canEnd: boolean
    cards: string[]
    select: (id: string) => void
    play: () => void
    end: () => void
    cancel: () => void
}

function HpGems({ hp, maxHp }: { hp: number; maxHp: number }) {
    // 首帧不播动画：只在体力变化时让变动的那颗血珠闪一下
    const mounted = useRef(false)
    useEffect(() => { mounted.current = true }, [])
    return (
        <div className="hp-gems" title={`${hp}/${maxHp}`}>
            {Array.from({ length: Math.max(0, maxHp) }, (_, i) => {
                const on = i < hp
                const anim = mounted.current ? (on ? ' charging' : ' breaking') : ''
                return (
                    <span key={`${i}-${on ? 'on' : 'off'}`}
                        className={`hp-gem ${on ? 'on' : 'off'}${anim}`} />
                )
            })}
        </div>
    )
}

function GeneralPanel({
    general, index, isActive, isTarget, onSelect, isViewing, fx, showSeatRole = true,
    onTooltipEnter, onTooltipMove, onTooltipLeave, onEquipTooltip,
}: {
    general: GeneralClientView
    index: number
    isActive: boolean
    isTarget: boolean
    onSelect?: (i: number) => void
    isViewing?: boolean
    fx?: 'hit' | 'pointer' | 'cast' | null
    /** 是否显示主帅/前锋标记（欢乐成双没有这两种身份） */
    showSeatRole?: boolean
    onTooltipEnter?: (e: React.MouseEvent) => void
    onTooltipMove?: (e: React.MouseEvent) => void
    onTooltipLeave?: () => void
    /** 悬停装备牌：花色、点数、攻击范围等细节 */
    onEquipTooltip?: (e: React.MouseEvent, card: Card) => void
}) {
    const factionCls = general.faction === Faction.WARM ? 'warm' : 'cool'
    const imgSrc = GENERAL_IMAGE[general.generalId]
    const name = GENERAL_NAMES[general.generalId] ?? general.generalId
    return (
        <div
            data-general-index={index}
            className={`general-panel faction-${factionCls} ${isActive ? 'active' : ''} ${isTarget ? 'target' : ''} ${!general.alive ? 'dead' : ''} ${isViewing ? 'viewing' : ''} ${general.chained ? 'chained' : ''} ${fx ? `fx-${fx}` : ''}`}
            onClick={() => onSelect?.(index)}
            onMouseEnter={onTooltipEnter}
            onMouseMove={onTooltipMove}
            onMouseLeave={onTooltipLeave}
        >
            <div className="general-card-img">
                <span className="general-portrait-placeholder">{name[0]}</span>
                {imgSrc && (
                    <img src={imgSrc} alt={name} className="general-portrait" decoding="async"
                        onError={(e) => { e.currentTarget.style.display = 'none' }} />
                )}
                <span className="hp-badge" title={`体力 ${general.hp}/${general.maxHp}${(general.armorPoints ?? 0) > 0 ? `，护甲 ${general.armorPoints}` : ''}`}>
                    {general.hp}/{general.maxHp}
                    {(general.armorPoints ?? 0) > 0 && <em className="armor-tag">+{general.armorPoints}</em>}
                </span>
                {showSeatRole && general.seatRole === SeatRole.COMMANDER && <span className="commander-badge">帅</span>}
                {showSeatRole && general.seatRole !== SeatRole.COMMANDER && <span className="flank-badge">锋</span>}
            </div>
            {general.chained && <div className="chain-overlay" title="横置：受到火焰或雷电伤害时会传导" />}
            {general.flipped && (
                <span className="chain-badge"
                    style={{ left: '-4px', right: 'auto', color: '#c9b3ff', borderColor: '#7a63b8', boxShadow: '0 0 8px rgba(150,120,220,0.45)' }}
                    title="翻面：下次回合开始时翻回正面并跳过该回合">
                    背
                </span>
            )}
            {(general.lieMarks ?? 0) > 0 && (
                <span className="chain-badge"
                    style={{ left: 'auto', right: '-4px', top: '36px', color: '#ff9c6b', borderColor: '#b85c2c', boxShadow: '0 0 8px rgba(220,110,50,0.45)' }}
                    title={`烈：受到伤害时防止此伤害并移去1个“烈”（剩余 ${general.lieMarks}）`}>
                    烈{general.lieMarks}
                </span>
            )}
            {general.generalId === 'yanyan' && (
                <span className="chain-badge"
                    style={{ left: 'auto', right: '-4px', color: '#cfd8e3', borderColor: '#8b9bb0', boxShadow: '0 0 8px rgba(140,170,200,0.35)' }}
                    title={`拒战当前状态：${general.juzhanYang === false ? '阴（使用杀可获得目标一张牌）' : '阳（成为杀的目标可各摸一张）'}`}>
                    {general.juzhanYang === false ? '阴' : '阳'}
                </span>
            )}
            {(general.orangeMarks ?? 0) > 0 && (
                <span className="chain-badge"
                    style={{ left: 'auto', right: '-4px', top: '18px', color: '#ffcf6b', borderColor: '#c99a3c', boxShadow: '0 0 8px rgba(220,170,60,0.4)' }}
                    title={`怀橘：持有 ${general.orangeMarks} 个“橘”，受伤时防止伤害并移去1个`}>
                    橘{general.orangeMarks}
                </span>
            )}
            {(general.jueMarks ?? 0) > 0 && (
                <span className="chain-badge"
                    style={{ left: '-4px', right: 'auto', top: '54px', color: '#ffd9a0', borderColor: '#b0822f', boxShadow: '0 0 8px rgba(200,150,60,0.45)' }}
                    title={`袭爵：持有 ${general.jueMarks} 个“爵”，可移去1个发动【突袭】或【骁果】`}>
                    爵{general.jueMarks}
                </span>
            )}
            {general.jiaozhaoAs && (
                <span className="chain-badge"
                    style={{ left: '-4px', right: 'auto', top: '18px', color: '#ffe9a8', borderColor: '#b08a3a', fontSize: '10px' }}
                    title={`矫诏：本回合可将展示的牌当【${cardNameOf(general.jiaozhaoAs)}】使用`}>
                    诏
                </span>
            )}
            {general.zhichiImmune && (
                <span className="chain-badge" style={{ left: 'auto', right: '-4px', color: '#ffd27f', borderColor: '#d0a057', boxShadow: '0 0 8px rgba(220,170,80,0.45)' }}
                    title="智迟：本回合【杀】和普通锦囊牌对此武将无效">免</span>
            )}
            {general.abolishedJudgeZone && (
                <span className="chain-badge"
                    style={{ left: '-4px', right: 'auto', top: '36px', color: '#d0b8ff', borderColor: '#7a63b8' }}
                    title="雄乱：判定区已废除">
                    废判
                </span>
            )}
            {(general.generalPile?.length ?? 0) > 0 && (() => {
                const pileCards = general.generalPile!
                const pileNames = pileCards.map((c) => `${getSuitSymbol(c.suit)}${getValueStr(c.value)}${cardNameOf(c.name)}`).join('、')
                const kongsheng = !!general.kongshengActive
                const pileLabel = kongsheng ? '箜'
                    : general.generalId === 'liufeng' ? '逆'
                        : (general.generalId === 'chengpu' || general.generalId === 'chengpu_jie') ? '醇'
                            : general.generalId === 'lisu' ? '珠'
                                : general.generalId === 'guanqiujian' ? '荣'
                                    : general.generalId === 'dengai' ? '田'
                                        : general.generalId === 'zhonghui_jie' ? '权'
                                            : '牌'
                const pileTip = kongsheng
                    ? `箜声：武将牌上有 ${pileCards.length} 张牌——${pileNames}（本回合结束阶段使用其中的装备牌，并获得其余的牌）`
                    : pileLabel === '逆'
                        ? `陷嗣：武将牌上有 ${pileCards.length} 张“逆”——${pileNames}（其他角色可移去两张视为对你使用【杀】）`
                        : pileLabel === '醇'
                            ? `醇醪：武将牌上有 ${pileCards.length} 张“醇”——${pileNames}（濒死时当【酒】使用）`
                            : pileLabel === '珠'
                                ? `巧言：武将牌上有 ${pileCards.length} 张“珠”——${pileNames}（受到伤害时，若你有“珠”，来源获得“珠”；否则防止此伤害）`
                                : pileLabel === '荣'
                                    ? `征荣：武将牌上有 ${pileCards.length} 张“荣”——${pileNames}（鸿举觉醒用）`
                                    : pileLabel === '田'
                                        ? `屯田：武将牌上有 ${pileCards.length} 张“田”——${pileNames}（可当【顺手牵羊】使用）`
                                        : pileLabel === '权'
                                            ? `权计：武将牌上有 ${pileCards.length} 个“权”——${pileNames}（手牌上限+${pileCards.length}）`
                                            : `武将牌上有 ${pileCards.length} 张牌——${pileNames}`
                return (
                    <span className="chain-badge"
                        style={{ left: '-4px', right: 'auto', top: '54px', color: '#ffe6b0', borderColor: '#a8802f', boxShadow: '0 0 8px rgba(210,170,80,0.45)' }}
                        title={pileTip}>
                        {pileLabel}{pileCards.length}
                    </span>
                )
            })()}
            {(general.liangCards ?? 0) > 0 && (
                <span className="chain-badge"
                    style={{ left: 'auto', right: '-4px', top: '72px', color: '#d8f0b0', borderColor: '#6f9a3c', boxShadow: '0 0 8px rgba(140,190,80,0.4)' }}
                    title={`屯储：武将牌上有 ${general.liangCards} 张“粮”（有“粮”时不能使用【杀】，可用于发动【输粮】）`}>
                    粮{general.liangCards}
                </span>
            )}
            <div className="general-info">
                <div className="general-name">
                    <span>{name}</span>
                </div>
                <HpGems hp={general.hp} maxHp={general.maxHp} />
                <div className="general-hand-count">手牌 {general.handCount}</div>
                {(general.revealedCards?.length ?? 0) > 0 && (
                    <div className="general-known-hand" title="已公开亮出的手牌（火攻等）">
                        {general.revealedCards!.map((c) => (
                            <span key={c.id} className="known-hand-chip">
                                {getSuitSymbol(c.suit)}{getValueStr(c.value)}{cardNameOf(c.name)}
                            </span>
                        ))}
                    </div>
                )}
                {/* 装备区：只露类型图标 + 双字简称，细节走悬停 */}
                {(general.equip.weapon || general.equip.armor || general.equip.plus_horse || general.equip.minus_horse) && (
                    <div className="general-equip-zone">
                        {([
                            [general.equip.weapon, '⚔', 'equip-weapon'],
                            [general.equip.armor, '🛡', 'equip-armor'],
                            [general.equip.minus_horse, '🐎', 'equip-horse'],
                            [general.equip.plus_horse, '🐎', 'equip-horse'],
                        ] as [Card | undefined, string, string][]).map(([card, icon, cls]) => card && (
                            <div
                                key={cls + card.id}
                                className={`equip-item ${cls}`}
                                title={equipTooltipContent(card).title}
                                onMouseEnter={onEquipTooltip ? (e) => onEquipTooltip(e, card) : undefined}
                                onMouseMove={onEquipTooltip ? onTooltipMove : undefined}
                                onMouseLeave={onEquipTooltip ? onTooltipLeave : undefined}
                            >
                                {icon}{equipShortName(card.name)}
                            </div>
                        ))}
                    </div>
                )}
                {/* 判定区 */}
                {general.judgeZone && general.judgeZone.length > 0 && (
                    <div className="general-judge-zone">
                        {general.judgeZone.map((card) => {
                            const meta = card.name === 'overindulgence'
                                ? { cls: 'judge-le', icon: '乐', label: '乐不思蜀' }
                                : card.name === 'lightning'
                                    ? { cls: 'judge-lei', icon: '雷', label: '闪电' }
                                    : { cls: 'judge-bing', icon: '兵', label: '兵粮寸断' }
                            return (
                                <div key={card.id}
                                    className={`judge-item ${meta.cls}`}
                                    title={`${meta.label} ${getSuitSymbol(card.suit)}${getValueStr(card.value)}`}>
                                    <span className="judge-icon">{meta.icon}</span>
                                    <span className="judge-meta">{getSuitSymbol(card.suit)}{getValueStr(card.value)}</span>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
            {!general.alive && <div className="general-dead-overlay">阵亡</div>}
            {general.alive && general.hasActed && <div className="general-acted-badge">已行动</div>}
        </div>
    )
}

function PlayingCard({ card, selected, onClick, dimmed, onTooltipEnter, onTooltipMove, onTooltipLeave, onPointerDown }: {
    card: Card; selected: boolean; onClick?: () => void; dimmed?: boolean;
    onTooltipEnter?: (e: React.MouseEvent) => void;
    onTooltipMove?: (e: React.MouseEvent) => void;
    onTooltipLeave?: () => void;
    onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
}) {
    const red = isRedSuit(card.suit)
    const categoryCls = card.category === CardCategory.BASIC ? 'card-basic'
        : card.category === CardCategory.TRICK ? 'card-trick' : 'card-equip'
    return (
        <div data-card-id={card.id}
            className={`playing-card ${categoryCls} ${selected ? 'selected' : ''} ${red ? 'red' : 'black'} ${dimmed ? 'dimmed' : ''}`}
            onClick={onClick}
            onPointerDown={onPointerDown}
            onMouseEnter={onTooltipEnter}
            onMouseMove={onTooltipMove}
            onMouseLeave={onTooltipLeave}
        >
            <div className="card-corner top">
                <div className={`card-suit ${red ? 'suit-red' : ''}`}>{getSuitSymbol(card.suit)}</div>
                <div className="card-value">{getValueStr(card.value)}</div>
            </div>
            <div className="card-seal" />
            <div className="card-name">{cardNameOf(card.name)}</div>
            <div className="card-corner bottom">
                <div className="card-value">{getValueStr(card.value)}</div>
            </div>
        </div>
    )
}

/** 日志文本高亮：武将名加粗去括号，技能名紫色，伤害红色 */
function highlightLogText(text: string) {
    // 匹配【xxx】
    const parts = text.split(/(【[^】]+】)/g)
    return parts.map((part, i) => {
        if (part.startsWith('【') && part.endsWith('】')) {
            const inner = part.slice(1, -1)
            // 武将名不套括号，改用加粗，一行里不再堆满【】
            if (GENERAL_NAME_SET.has(inner)) {
                return <b key={i} className="log-general">{inner}</b>
            }
            // 伤害相关
            if (part.includes('伤害') || part.includes('濒死') || part.includes('阵亡')) {
                return <span key={i} className="log-damage">{part}</span>
            }
            return <span key={i} className="log-skill">{part}</span>
        }
        // 高亮伤害数字
        if (part.includes('伤害')) {
            return <span key={i} className="log-damage">{part}</span>
        }
        return part
    })
}

type GamePageProps = {
    /** 左右手对弈时由外层传入本方视角 */
    view?: GameStateClientView
    faction?: Faction
}

export default function GamePage({ view, faction }: GamePageProps = {}) {
    const {
        gameState: storeGameState, myFaction: storeFaction, isSpectator,
        selectedCardIds, selectedTargets,
        toggleCardSelection, toggleTargetSelection, clearSelection,
        error, setError,
    } = useGameStore()
    const gameState = view ?? storeGameState
    const myFaction = faction ?? storeFaction
    const navigate = useNavigate()
    const [guanxingTop, setGuanxingTop] = useState<string[]>([])
    const [guanxingBottom, setGuanxingBottom] = useState<string[]>([])
    // 技能激活状态：点击技能按钮后进入激活模式，选牌/选目标后点确认发送
    const [activeSkillId, setActiveSkillId] = useState<string | null>(null)
    // 观星/罪论排列时正在拖动的牌
    const [arrangeDragId, setArrangeDragId] = useState<string | null>(null)
    // 观星/罪论面板整体位置（按住标题可拖动，避免挡住场上信息）
    const [arrangeOffset, setArrangeOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
    // 英魂弃牌：用于选择装备区的装备一起弃
    const [selectedEquipSlots, setSelectedEquipSlots] = useState<string[]>([])
    // 气泡提示
    const { tooltip, onEnter: tooltipEnter, onMove: tooltipMove, onLeave: tooltipLeave } = useTooltip(1500)
    // AI 演算节奏：正常 / 快速 / 瞬时
    const [pace, setPace] = useState(getLocalPace())

    // 手牌区宽度：按张数算负间距，牌面尺寸保持不变
    const handRef = useRef<HTMLDivElement | null>(null)
    const [handWidth, setHandWidth] = useState(0)
    useLayoutEffect(() => {
        const el = handRef.current
        if (!el) return
        const update = () => setHandWidth(el.clientWidth)
        update()
        const ro = new ResizeObserver(update)
        ro.observe(el)
        return () => ro.disconnect()
    }, [])
    // 动效层：飞行牌 / 引导线 / 飘字
    const fxRef = useRef<FxHandle | null>(null)
    // 整理手牌：点一次只重排一次，牌序记在 handOrder 里，之后不再自动排序
    const [handSortMode, setHandSortMode] = useState<'default' | 'type' | 'suit'>('default')
    const [handOrder, setHandOrder] = useState<string[]>([])
    // 日志面板默认只渲染最近若干条，超长对局里前面的日志可手动展开
    const [showAllLog, setShowAllLog] = useState(false)

    // 复盘：点日志复制 ID，并攒成本机清单，之后一次性粘给分析脚本
    const [reviewNotice, setReviewNotice] = useState('')
    const [reviewCount, setReviewCount] = useState(() => getReviewQueue().length)
    const reviewNoticeTimer = useRef<number | null>(null)
    useEffect(() => () => {
        if (reviewNoticeTimer.current !== null) window.clearTimeout(reviewNoticeTimer.current)
    }, [])
    // 复盘清单只服务当前这局：换局后旧 ID 不能再带进来
    const reviewMatchId = gameState?.matchId
    useEffect(() => {
        if (!reviewMatchId) return
        setReviewCount(pruneReviewQueue(reviewMatchId).length)
    }, [reviewMatchId])

    function notifyReview(text: string) {
        setReviewNotice(text)
        if (reviewNoticeTimer.current !== null) window.clearTimeout(reviewNoticeTimer.current)
        reviewNoticeTimer.current = window.setTimeout(() => setReviewNotice(''), 2800)
    }

    async function handleLogClick(entry: LogEntry) {
        const id = logReviewId(entry)
        if (!id) {
            notifyReview('这条日志没有复盘 ID（在线对局不落在本机记录）')
            return
        }
        setReviewCount(pushReviewId(id).length)
        notifyReview(await copyText(id) ? `已复制 ${id}` : `剪贴板不可用，请手动记录 ${id}`)
    }

    async function handleCopyReviewQueue() {
        const ids = getReviewQueue().map((m) => m.id)
        if (ids.length === 0) {
            notifyReview('复盘清单为空：点击任意日志即可收集')
            return
        }
        notifyReview(await copyText(ids.join('\n')) ? `已复制 ${ids.length} 条复盘 ID` : '剪贴板不可用')
    }

    function handleClearReviewQueue() {
        if (getReviewQueue().length === 0) return
        if (!window.confirm('清空复盘清单？（不影响已导出的对局日志）')) return
        clearReviewQueue()
        setReviewCount(0)
        notifyReview('复盘清单已清空')
    }

    // 非法操作提示：对局中直接显示，几秒后自动消失
    useEffect(() => {
        if (!error) return
        const timer = setTimeout(() => setError(null), 3000)
        return () => clearTimeout(timer)
    }, [error, setError])

    // ── 背景音乐 ──
    const bgmRef = useRef<HTMLAudioElement | null>(null)
    useEffect(() => {
        // 左右手对弈同屏两个界面，只让左（暖方）那一侧播放背景音乐
        if (view && faction === Faction.COOL) return
        const audio = new Audio('/bgm.flac')
        audio.loop = true
        audio.volume = 0.3
        bgmRef.current = audio

        // 尝试自动播放
        const playPromise = audio.play()
        if (playPromise) {
            playPromise.catch(() => {
                // 浏览器阻止自动播放，等待用户首次点击后播放
                const resumeOnClick = () => {
                    audio.play().catch(() => {})
                    document.removeEventListener('click', resumeOnClick)
                }
                document.addEventListener('click', resumeOnClick)
            })
        }

        return () => {
            audio.pause()
            audio.src = ''
            bgmRef.current = null
        }
    }, [])

    if (!gameState) return null

    const { generals, turnPhase, activePlayerFaction, activeGeneralIndex, currentActionUnit, pendingResponse, log, roundState, attackUsedThisTurn } = gameState
    const isDdz = gameState.mode === 'doudizhu'
    const isPair = gameState.mode === 'huanle_shuang'

    // 暖色方在 generals 数组中是 暖B→暖主→暖A，需要反转为 暖A→暖主→暖B 以形成环形座次
    const myRaw = generals.filter((g) => g.faction === myFaction)
    const oppRaw = generals.filter((g) => g.faction !== myFaction)
    // 欢乐成双固定座次（逆时针）：1、4 号位在上排，2、3 号位在下排。
    // 己方是冷色（上排）时把己方行整体移到上方，保证 1 号位始终在左上角。
    const pairRows = isPair && myFaction ? pairBoardSeats(myFaction) : null
    const myGenerals = pairRows
        ? pairRows.mySeats.map((i) => generals[i]).filter((g): g is GeneralClientView => !!g)
        : myFaction === Faction.WARM ? [...myRaw].reverse() : myRaw
    const oppGenerals = pairRows
        ? pairRows.oppSeats.map((i) => generals[i]).filter((g): g is GeneralClientView => !!g)
        : myFaction === Faction.WARM ? oppRaw : [...oppRaw].reverse()
    const mineOnTop = !!pairRows?.mineOnTop

    const isMyTurn = !isSpectator && activePlayerFaction === myFaction
    const activeGeneral = generals[activeGeneralIndex]
    // 出牌阶段可点的技能：武将本身的技能 + 因其他武将获得的技能（地主强易、灵雎焚心所得等）
    const activeSkillDefs = activeGeneral
        ? [...ACTIVE_SKILLS_FOR(activeGeneral.generalId), ...acquiredSkillDefs(activeGeneral)]
        : []
    const isActionPhase = turnPhase === TurnPhase.ACTION
    const isDiscardPhase = turnPhase === TurnPhase.DISCARD
    const myPendingResponse =
        !isSpectator &&
        pendingResponse &&
        generals[pendingResponse.targetGeneralIndex]?.faction === myFaction

    const canInteractWithHand = !isSpectator && (isActionPhase || isDiscardPhase || myPendingResponse) &&
        (activeGeneral?.faction === myFaction || !!myPendingResponse)

    // AI 思考提示：本地对局轮到对方、且不是瞬时节奏时给个动静
    const aiThinking = !isSpectator && !isMyTurn && !myPendingResponse
        && (isActionPhase || isDiscardPhase) && getLocalPace() > 0 && isLocalMatchActive()

    // 是否需要选择行动单元：step=0（先手选）或 step=2（后手选）或 step=4/5（剩余边锋选顺序），且轮到我方
    // 让先选择期间不显示
    const needChooseUnit = !isPair && roundState &&
        !roundState.waitingForYield &&
        (roundState.currentActionStep === 0 || roundState.currentActionStep === 2 ||
            roundState.currentActionStep === 4 || roundState.currentActionStep === 5) &&
        isMyTurn && activeGeneralIndex === -1

    // 查看哪个武将的手牌（点击己方武将切换）
    // 优先级：手动选择 > 需要响应的武将 > 当前行动武将
    const [viewingGeneralIdx, setViewingGeneralIdx] = useState<number | null>(null)
    // 当 activeGeneralIndex 变化时，重置手动选择的查看目标
    const prevActiveIdx = useRef(activeGeneralIndex)
    useEffect(() => {
        if (prevActiveIdx.current !== activeGeneralIndex) {
            setViewingGeneralIdx(null)
            prevActiveIdx.current = activeGeneralIndex
        }
    }, [activeGeneralIndex])
    const respondingIdx = myPendingResponse ? pendingResponse!.targetGeneralIndex : null

    // 出现待响应时自动切换到响应武将，避免正在查看其它武将时看不到操作按钮
    useEffect(() => {
        if (respondingIdx !== null) setViewingGeneralIdx(respondingIdx)
    }, [pendingResponse, respondingIdx])

    // 换了一个待响应（类型/技能/响应者）就清掉上一轮选中的牌，避免残留他人手牌导致确认被引擎拒绝
    const prevPromptKey = useRef('')
    useEffect(() => {
        const prompt = pendingResponse
        const key = prompt
            ? `${prompt.type}:${(prompt.context as any)?.skillId ?? ''}:${prompt.targetGeneralIndex}`
            : ''
        if (key === prevPromptKey.current) return
        prevPromptKey.current = key
        if (useGameStore.getState().selectedCardIds.length > 0) {
            useGameStore.setState({ selectedCardIds: [] })
        }
    }, [pendingResponse])

    const displayGeneralIdx = viewingGeneralIdx ?? respondingIdx ?? activeGeneralIndex
    const visibleLog = showAllLog || log.length <= LOG_RECENT_LIMIT ? log : log.slice(-LOG_RECENT_LIMIT)
    const displayGeneral = displayGeneralIdx >= 0 ? generals[displayGeneralIdx] : null
    const isViewingActive = displayGeneralIdx === activeGeneralIndex
    const isViewingResponding = respondingIdx !== null && displayGeneralIdx === respondingIdx
    const isViewingMyGeneral = displayGeneral?.faction === myFaction

    // 手牌展示顺序：整理手牌时拍下的牌序快照，新摸到的牌排在已整理部分之后
    const sortedHandCards = (() => {
        const hand = displayGeneral?.hand ?? []
        if (handOrder.length === 0) return hand
        const rank = new Map(handOrder.map((id, i) => [id, i]))
        return [...hand].sort((a, b) => {
            const ra = rank.get(a.id)
            const rb = rank.get(b.id)
            if (ra === undefined && rb === undefined) return 0
            if (ra === undefined) return 1
            if (rb === undefined) return -1
            return ra - rb
        })
    })()
    // 可交互：正在查看活动武将或响应武将
    const canSelectCards = (isViewingActive || isViewingResponding) && canInteractWithHand

    // 手牌一多就压缩间距而不是缩牌面：牌面尺寸固定，逐步叠压直到放得下
    const handCardMetrics = (() => {
        const n = sortedHandCards.length
        const step = 82
        const available = Math.max(76, (handWidth || 900) - 24)
        const overlap = n > 1 && n * step > available
            ? Math.min(step - 14, (n * step - available) / (n - 1))
            : 8
        return {
            '--card-w': '76px',
            '--card-h': '108px',
            '--card-overlap': `${Math.round(overlap)}px`,
            minHeight: '118px',
        } as React.CSSProperties
    })()

    // 弃牌阶段还需弃置的张数（手牌数 - 体力上限即当前体力）
    const discardNeed = displayGeneral && isDiscardPhase && isMyTurn
        ? Math.max(0, (displayGeneral.hand?.length ?? 0) - displayGeneral.hp)
        : 0

    // 当前情境下手牌最多能选中几张：出牌阶段单选，弃牌阶段最多弃到阈值，技能/响应按需放宽
    const handSelectionLimit = (() => {
        // 响应优先：出牌阶段也可能弹出响应（如贯石斧需弃2张牌）
        if (myPendingResponse && pendingResponse) {
            const ctx = pendingResponse.context as any
            if (pendingResponse.type === ResponseType.SKILL_ACTIVATE_CONFIRM && ctx?.skillId === 'equip_stone_axe') return 2
            if (pendingResponse.type === ResponseType.SKILL_GANGLIE_CHOICE) return 2
            if (pendingResponse.type === ResponseType.SKILL_YIJI_DISTRIBUTE) return Math.max(1, ctx?.remaining ?? 1)
            if (pendingResponse.type === ResponseType.SKILL_YINGHUN_DISCARD) return Math.max(1, ctx?.discardCount ?? 1)
            if (pendingResponse.type === ResponseType.SKILL_MIJI_GIVE) {
                return ctx?.phase === 'cards' ? Math.max(1, ctx?.count ?? 1) : 0
            }
            if (pendingResponse.type === ResponseType.SKILL_JINQU_DISCARD) {
                return Math.max(1, ctx?.discardCount ?? 1)
            }
            // 技能发动时要求先选牌（巧变/箜声等）：按询问声明的上限放开
            if (pendingResponse.type === ResponseType.SKILL_ACTIVATE_CONFIRM && ctx?.cardSelectOnActivate) {
                return Math.max(1, Number(ctx.maxCards) || 1)
            }
            // 技能选牌/交牌：按上下文给的上限放开多选（下书展示、逆固弃牌、献图交牌等）
            if (pendingResponse.type === ResponseType.SKILL_PICK_CARD
                || pendingResponse.type === ResponseType.SKILL_GIVE_CARDS) {
                const limit = Number(ctx?.count ?? 1)
                return Number.isFinite(limit) && limit > 0 ? Math.max(1, limit) : Infinity
            }
            return 1
        }
        if (isDiscardPhase && isMyTurn) return Math.max(1, discardNeed)
        if (isActionPhase) {
            if (!activeSkillId) return 1
            if (activeSkillId === 'sunquan_zhiheng' || activeSkillId === 'liubei_rende') return Infinity
            if (activeSkillId === 'simalang_quji' || activeSkillId === 'zhugeke_duwu' || activeSkillId === 'zumao_yinbing') return Infinity
            if (activeSkillId === 'xunyou_qice') return 0
            if (activeSkillId === 'sunshangxiang_jieyin' || activeSkillId === 'equip_zhangba_spear'
                || activeSkillId === 'guyong_shenxing' || activeSkillId === 'guyong_jie_shenxing') return 2
            return 1
        }
        return 1
    })()

    // 明策：只能交给装备牌或【杀】
    const isMingceCard = (card: Card): boolean =>
        card.category === CardCategory.EQUIPMENT
        || card.name === BasicCardName.ATTACK
        || card.name === BasicCardName.FIRE_SLASH
        || card.name === BasicCardName.THUNDER_SLASH

    /**
     * 整理手牌：点一次只做一次顺序调换（快照），之后保持该顺序，不会持续重排。
     * 顺序循环：类别 → 花色 → 恢复原序
     */
    function arrangeHand() {
        const hand = displayGeneral?.hand ?? []
        const next: 'default' | 'type' | 'suit' =
            handSortMode === 'default' ? 'type' : handSortMode === 'type' ? 'suit' : 'default'
        setHandSortMode(next)
        if (next === 'default') {
            setHandOrder([])
            return
        }
        const catRank = (c: Card) => c.category === CardCategory.BASIC ? 0 : c.category === CardCategory.TRICK ? 1 : 2
        const suitRank = (s: CardSuit) => s === CardSuit.SPADE ? 0 : s === CardSuit.HEART ? 1 : s === CardSuit.CLUB ? 2 : 3
        const sorted = [...hand].sort((a, b) => next === 'suit'
            ? (suitRank(a.suit) - suitRank(b.suit)) || (a.value - b.value)
            : (catRank(a) - catRank(b)) || (suitRank(a.suit) - suitRank(b.suit)) || (a.value - b.value))
        setHandOrder(sorted.map(c => c.id))
    }

    function handleCardClick(cardId: string) {
        // 拖拽结束后的 click 不再当作“点选”
        if (dragMoved.current) {
            dragMoved.current = false
            return
        }
        if (!canSelectCards) return
        if (activeSkillId === 'chengong_mingce') {
            const card = displayGeneral?.hand?.find(c => c.id === cardId)
            if (!card || !isMingceCard(card)) return
        }
        // 逆固：花色不能重复，重复花色直接忽略，避免多选后引擎静默少弃
        {
            const pickCtx = pendingResponse?.context as any
            const hand = displayGeneral?.hand ?? []
            if (myPendingResponse && pendingResponse?.type === ResponseType.SKILL_PICK_CARD
                && pickCtx?.skillId === 'sunchen_shi_nigu' && !selectedCardIds.includes(cardId)) {
                const card = hand.find(c => c.id === cardId)
                const suits = selectedCardIds
                    .map(id => hand.find(c => c.id === id)?.suit)
                    .filter(Boolean)
                if (card && suits.includes(card.suit)) return
            }
        }
        if (selectedCardIds.includes(cardId)) {
            toggleCardSelection(cardId)
            return
        }
        if (selectedCardIds.length >= handSelectionLimit) {
            // 出牌阶段是单选：点另一张牌直接替换，避免残留上一张的选择
            if (handSelectionLimit === 1 && isActionPhase) {
                useGameStore.setState({ selectedCardIds: [cardId] })
            }
            return
        }
        toggleCardSelection(cardId)
    }

    function handleChooseUnit(unit: ActionUnitType) {
        emit.chooseActionUnit({ unit })
    }

    // ── AOE 方向选择 ──
    const [aoeDirection, setAoeDirection] = useState<'clockwise' | 'counterclockwise'>('clockwise')
    const [xuanhuoPicked, setXuanhuoPicked] = useState<string[]>([])
    const [zongxuanPicked, setZongxuanPicked] = useState<string[]>([])
    // 英魂：先选角色，再选“摸X弃1 / 摸1弃X”
    const [yinghunTarget, setYinghunTarget] = useState<number | null>(null)
    const [showDiscard, setShowDiscard] = useState(false)
    // 记牌器：只汇总公开信息，打开时才向引擎取一次
    const [showPool, setShowPool] = useState(false)
    const [poolStats, setPoolStats] = useState<PoolStats | null>(null)

    function openPoolStats(): void {
        setPoolStats(getPoolStats())
        setShowPool(true)
    }

    // 教练提示：拿规则 AI 的候选评分，只读不执行
    const [showCoach, setShowCoach] = useState(false)
    const [coachTips, setCoachTips] = useState<CoachSuggestion[]>([])

    function openCoach(): void {
        setCoachTips(getCoachSuggestions())
        setShowCoach(true)
    }
    const discardPile = gameState.discard ?? []

    // 音效：左右手对弈只让暖方播，瞬时节奏下静音
    const sfx = (kind: SfxKind) => {
        if (view && faction !== Faction.WARM) return
        if (getLocalPace() <= 0) return
        playSfx(kind)
    }

    // 中央提示：刚刚打出的牌名
    const [playBanner, setPlayBanner] = useState<{ name: string; key: number } | null>(null)
    // 键盘：Esc 取消、空格出牌/结束、数字选牌
    const keyCtx = useRef<KeyCtx | null>(null)
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const el = e.target as HTMLElement | null
            if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
            if (document.querySelector('.discard-modal-backdrop, .arrange-overlay')) return
            const c = keyCtx.current
            if (!c) return
            if (e.key === 'Escape') {
                e.preventDefault()
                c.cancel()
                return
            }
            if (e.key === ' ' || e.key === 'Enter') {
                // 焦点在按钮上时交给浏览器，避免双触发
                if (document.activeElement instanceof HTMLButtonElement) return
                if (!c.canPlay && !c.canEnd) return
                e.preventDefault()
                if (c.canPlay) c.play()
                else c.end()
                return
            }
            if (/^[0-9]$/.test(e.key)) {
                const idx = e.key === '0' ? 9 : Number(e.key) - 1
                const id = c.cards[idx]
                if (id) {
                    e.preventDefault()
                    c.select(id)
                }
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [])

    // 每次渲染刷新键盘上下文，避免监听器闭包拿到旧的选牌状态
    keyCtx.current = {
        canPlay: !myPendingResponse && selectedCardIds.length > 0
            && (isDiscardPhase || (isActionPhase && !activeSkillId && isMyTurn)),
        canEnd: isActionPhase && isMyTurn && !activeSkillId && !myPendingResponse && selectedCardIds.length === 0,
        cards: canSelectCards ? sortedHandCards.map((c) => c.id) : [],
        select: handleCardClick,
        play: isDiscardPhase ? handleDiscard : handleUseCard,
        end: handleEndTurn,
        cancel: () => {
            setActiveSkillId(null)
            clearSelection()
        },
    }

    // 表现层：从施法者面板画一条引导线到目标，并让一张牌飞过去
    const castVisual = (fromIdx: number, target: number, name: string, tone: LineTone) => {
        const fxRoot = fxRef.current?.root()
        if (!fxRoot || fromIdx < 0) return
        const scope = fxRoot.closest('.game-main')
        const panelAt = (i: number) => centerIn(scope?.querySelector(`[data-general-index="${i}"]`), fxRoot)
        const from = panelAt(fromIdx)
        if (!from) return
        const to = target >= 0 ? panelAt(target) : centerIn(fxRoot, fxRoot)
        if (!to) return
        void fxRef.current?.drawLine({ from, to, tone })
        void fxRef.current?.flyCard({ from, to, label: name })
    }

    // ── 出牌 / 受伤 特效：从日志里读出最近一次动作，给施法者与目标面板加指向/命中动画 ──
    const [fx, setFx] = useState<{ kind: 'hit' | 'pointer'; target: number; from?: number; card?: string; key: number } | null>(null)
    const lastLogKey = useRef('')
    // 结构化事件：引擎直接告知谁对谁做了什么，优先于日志解析
    const lastFxSeq = useRef(0)
    const fxHandled = useRef(false)
    // 连斩：同一回合内同一击杀者再次击杀时提示「连斩」，特效不再升级
    const killTurn = useRef<{ turn: number; actors: Set<number> } | null>(null)
    useEffect(() => {
        const list = gameState.fx ?? []
        const fresh = list.filter((e) => e.seq > lastFxSeq.current)
        if (fresh.length === 0) return
        lastFxSeq.current = list[list.length - 1].seq
        fxHandled.current = true
        const fxRoot = fxRef.current?.root()
        const scope = fxRoot?.closest('.game-main')
        const panelPoint = (i: number) => (fxRoot
            ? centerIn(scope?.querySelector(`[data-general-index="${i}"]`), fxRoot)
            : null)

        // 同一批事件中若目标已被 3 点以上伤害击毙，无双与击杀合并为一次特效
        const dyingTargets = new Set<number>()
        const heavyHits = new Set<number>()
        for (const e of fresh) {
            if (e.kind === 'damage' && (e.amount ?? 0) >= 3) {
                for (const t of e.targets ?? []) heavyHits.add(t)
            } else if (e.kind === 'death') {
                for (const t of e.targets ?? []) dyingTargets.add(t)
            }
        }

        for (const e of fresh) {
            const targets = (e.targets ?? []).filter((t) => t >= 0)
            const target = targets[0] ?? -1
            if (e.kind === 'damage' && (e.amount ?? 0) >= 3) {
                const at = target >= 0 ? panelPoint(target) : null
                if (!at || dyingTargets.has(target)) continue
                void fxRef.current?.killStrike({
                    from: e.actor !== undefined ? panelPoint(e.actor) : null,
                    at,
                    label: '无双',
                    tone: 'wushuang',
                })
                setFx({ kind: 'hit', target, from: e.actor, key: Date.now() })
                sfx('damage')
                continue
            }
            if (e.kind === 'death') {
                const at = target >= 0 ? panelPoint(target) : null
                if (!at) continue
                const killer = e.actor !== undefined ? generals[e.actor] : undefined
                const victim = target >= 0 ? generals[target] : undefined
                const enemyKill = !!killer && !!victim && killer.faction !== victim.faction
                const now = Date.now()
                let label = '阵亡'
                if (enemyKill) {
                    const actor = e.actor!
                    const turn = gameState.turnSerial ?? 0
                    if (!killTurn.current || killTurn.current.turn !== turn) {
                        killTurn.current = { turn, actors: new Set() }
                    }
                    const actors = killTurn.current.actors
                    label = actors.has(actor) ? '连斩' : '击杀'
                    actors.add(actor)
                }
                const wushuang = heavyHits.has(target)
                void fxRef.current?.killStrike({
                    from: enemyKill ? panelPoint(e.actor!) : null,
                    at,
                    label: wushuang ? `无双 · ${label}` : label,
                    tone: wushuang ? 'wushuang' : 'kill',
                })
                setFx({ kind: 'hit', target, from: e.actor, key: now })
                sfx('damage')
                continue
            }
            if (e.actor === undefined) continue
            if (e.kind === 'use' && e.cardName) {
                castVisual(e.actor, target, cardNameOf(e.cardName), lineToneOf(e.cardName))
                sfx('play')
                setPlayBanner({ name: cardNameOf(e.cardName), key: Date.now() })
            } else if (e.kind === 'skill' && e.skillName) {
                const name = getSkillDefById(e.skillName)?.name ?? e.skillName
                castVisual(e.actor, target, name, 'skill')
                sfx('skill')
            }
        }
    }, [gameState.fx])

    useEffect(() => {
        const latest = log[log.length - 1]
        // 日志只保留最近 50 条，用时间戳+文本判断是否有新条目
        const logKey = latest ? `${latest.timestamp}|${latest.text}` : ''
        if (!latest || logKey === lastLogKey.current) return
        lastLogKey.current = logKey
        // 同一动作已由结构化事件播放过，不再重复解析文本
        if (fxHandled.current) {
            fxHandled.current = false
            return
        }
        const text = latest.text
        const idxOf = (n: string) => generals.findIndex((g) => (GENERAL_NAMES[g.generalId] ?? g.generalId) === n)
        // 卡面文本：去掉书名号，只取第一段（花色点数 + 牌名）
        const cardOf = (raw: string) => raw.replace(/[【】]/g, '').split('，')[0].replace(/^发动【[^】]*】/, '').trim()
        const castAt = (caster: string, targetsText: string, cardText: string, tone: LineTone = lineToneOf(cardText)) => {
            const names = [...targetsText.matchAll(/【(.+?)】/g)].map((m) => m[1])
            const target = names.map(idxOf).find((i) => i >= 0) ?? -1
            const fromIdx = idxOf(caster)
            setFx({ kind: 'pointer', target, from: fromIdx, card: cardOf(cardText), key: Date.now() })
            const cardName = cardOf(cardText)
            castVisual(fromIdx, target, cardName, tone)
            sfx(tone === 'skill' ? 'skill' : 'play')
            if (tone !== 'skill') setPlayBanner({ name: cardName, key: Date.now() })
        }
        const used = /^【(.+?)】对(.+?)使用了?(.+)$/.exec(text)
        if (used) {
            castAt(used[1], used[2], used[3])
            return
        }
        // 转化技：发动【武圣】，将…当杀对【目标】使用
        const skillCast = /^【(.+?)】发动【(.+?)】，.*?对(.+?)使用/.exec(text)
        if (skillCast) {
            castAt(skillCast[1], skillCast[3], skillCast[2], 'skill')
            return
        }
        // 无目标的自用牌 / 装备
        const selfUse = /^【(.+?)】(使用|装备|饮)(?:了)?(.+)$/.exec(text)
        if (selfUse) {
            const name = cardOf(selfUse[3])
            setFx({ kind: 'pointer', target: -1, from: idxOf(selfUse[1]), card: name, key: Date.now() })
            castVisual(idxOf(selfUse[1]), -1, name, lineToneOf(name))
            sfx('play')
            setPlayBanner({ name, key: Date.now() })
            return
        }
        const hit = /^【(.+?)】受到 \d+ 点(.+?)伤害/.exec(text)
        if (hit) {
            const target = idxOf(hit[1])
            if (target >= 0) {
                setFx({ kind: 'hit', target, key: Date.now() })
                sfx('damage')
            }
        }
    }, [log])
    useEffect(() => {
        if (!fx) return
        const timer = setTimeout(() => setFx(null), 900)
        return () => clearTimeout(timer)
    }, [fx?.key])

    // 手牌位移：已在场上的牌 FLIP 收拢，新摸到的牌从牌堆飞入
    const prevHandRects = useRef<Map<string, DOMRect>>(new Map())
    useLayoutEffect(() => {
        const host = handRef.current
        const root = fxRef.current?.root()
        if (!host || !root) return
        const nodes = Array.from(host.querySelectorAll<HTMLElement>('.playing-card'))
        if (nodes.length === 0) {
            prevHandRects.current = new Map()
            return
        }
        const rootRect = root.getBoundingClientRect()
        const next = new Map<string, DOMRect>()
        for (const el of nodes) {
            const id = el.dataset.cardId
            if (id) next.set(id, el.getBoundingClientRect())
        }
        const prev = prevHandRects.current
        const known = prev.size > 0
        const deck = known && isViewingMyGeneral
            ? centerIn(root.closest('.game-main')?.querySelector('.table-chip-deck'), root)
            : null
        let fresh = 0
        next.forEach((rect, id) => {
            const el = nodes.find((n) => n.dataset.cardId === id)
            const before = prev.get(id)
            if (before) {
                const dx = before.left - rect.left
                const dy = before.top - rect.top
                if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
                    el?.animate(
                        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
                        { duration: 220, easing: 'cubic-bezier(0.33, 1, 0.68, 1)' },
                    )
                }
                return
            }
            if (!known || !deck) return
            const card = sortedHandCards.find((c) => c.id === id)
            const to = {
                x: rect.left - rootRect.left + rect.width / 2,
                y: rect.top - rootRect.top + rect.height / 2,
            }
            const delay = fresh * 60
            el?.animate(
                [{ opacity: 0 }, { opacity: 0 }, { opacity: 1 }],
                { duration: DUR.card + 80, delay, easing: 'linear' },
            )
            void fxRef.current?.flyCard({ from: deck, to, label: card ? cardNameOf(card.name) : '牌', delay })
            if (fresh === 0) sfx('draw')
            fresh += 1
        })
        prevHandRects.current = next
    }, [sortedHandCards, handWidth, displayGeneralIdx, isViewingMyGeneral])

    // 体力增减：在武将面板旁飘出 -1 / +1
    const prevHpKey = useRef('')
    useLayoutEffect(() => {
        const key = generals.map((g) => `${g.hp}/${g.armorPoints ?? 0}`).join(',')
        const prev = prevHpKey.current
        if (key === prev) return
        prevHpKey.current = key
        if (!prev) return
        const root = fxRef.current?.root()
        if (!root) return
        const scope = root.closest('.game-main')
        const before = prev.split(',')
        generals.forEach((g, i) => {
            const raw = before[i]
            if (!raw) return
            const [hpStr, armorStr] = raw.split('/')
            const hpBefore = Number(hpStr)
            const armorBefore = Number(armorStr)
            const at = centerIn(scope?.querySelector(`[data-general-index="${i}"]`), root)
            if (!at) return
            const point = { x: at.x + 86, y: at.y - 4 }
            if (g.hp < hpBefore) fxRef.current?.floatText(point, `-${hpBefore - g.hp}`, 'damage')
            else if (g.hp > hpBefore) {
                fxRef.current?.floatText(point, `+${g.hp - hpBefore}`, 'heal')
                sfx('heal')
            }
            const armorNow = g.armorPoints ?? 0
            if (armorNow < armorBefore) {
                fxRef.current?.floatText({ x: point.x + 26, y: point.y }, `-${armorBefore - armorNow}`, 'armor')
            }
        })
    }, [generals])

    // 检查当前选中的牌是否为AOE（斗地主/欢乐成双座次固定，不需要选结算方向）
    const selectedCard = displayGeneral?.hand?.find(c => c.id === selectedCardIds[0])
    // 技能发动中选中的牌（仁德要给出的牌、制衡要弃的牌等）不是“要使用”，不问 AOE 结算方向
    const isAoeCard = !isDdz && !activeSkillId && !!selectedCard
        && ['barbarians', 'arrows', 'peach_garden', 'harvest'].includes(selectedCard.name)

    // 顺手牵羊 / 兵粮寸断只能指定距离 1 以内的其他角色（奇才无视距离限制）
    const canTargetWithSelectedCard = (idx: number, card: Card | undefined = selectedCard): boolean => {
        const needsNear = card?.name === TrickCardName.STEAL
            || card?.name === TrickCardName.SUPPLY_SHORTAGE
        if (!needsNear || !activeGeneral) return true
        const target = generals[idx]
        if (!target || !target.alive || target === activeGeneral) return false
        const hasQicai = getGeneralById(activeGeneral.generalId)?.skills
            .some(s => s.id === 'huangyueying_qicai') ?? false
        if (hasQicai) return true
        // 客户端视图字段（alive/equip/generalId）足以计算距离
        return getAttackRange(activeGeneral as any, target as any, generals as any).distance <= 1
    }

    // 杀 / 顺手牵羊 / 兵粮寸断：自动选中的唯一目标。
    // 只有一名敌人时优先锁敌人（给自己人上杀几乎没有意义），否则只在只有一个合法目标时选中
    const autoTargetIndexFor = (card: Card | undefined): number | null => {
        if (!card || !activeGeneral) return null
        const isSlash = card.name === BasicCardName.ATTACK
            || card.name === BasicCardName.FIRE_SLASH
            || card.name === BasicCardName.THUNDER_SLASH
        const isNearTrick = card.name === TrickCardName.STEAL || card.name === TrickCardName.SUPPLY_SHORTAGE
        if (!isSlash && !isNearTrick) return null
        const candidates = generals
            .map((_, i) => i)
            .filter(i => !!generals[i]?.alive && i !== activeGeneralIndex && canTargetWithSelectedCard(i))
            .filter(i => !isSlash
                || getAttackRange(activeGeneral as any, generals[i] as any, generals as any).inRange)
        const foes = candidates.filter(i => generals[i].faction !== myFaction)
        if (foes.length === 1) return foes[0]
        return candidates.length === 1 ? candidates[0] : null
    }

    // 铁索连环必须指定 1-2 名角色，不能空目标使用
    const isIronChainSelected = selectedCard?.name === TrickCardName.IRON_CHAIN
    const ironChainTargetReady = !isIronChainSelected || selectedTargets.length > 0
    const cardOwnerHasSkill = (id: string) =>
        (getGeneralById(displayGeneral?.generalId ?? '')?.skills.some(s => s.id === id) ?? false)
        || (displayGeneral?.acquiredSkills?.includes(id) ?? false)
    // 【杀】在方天画戟/短兵/神击/疠火/天义等加成下可指定多个目标，其余单目标牌始终只有一个
    const selectedCardMaxTargets = (() => {
        if (!selectedCard) return Infinity
        const isSlash = selectedCard.name === BasicCardName.ATTACK
            || selectedCard.name === BasicCardName.FIRE_SLASH
            || selectedCard.name === BasicCardName.THUNDER_SLASH
        if (!isSlash) return SINGLE_TARGET_CARD_NAMES.includes(selectedCard.name as string) ? 1 : Infinity
        if (!displayGeneral) return 1
        let max = 1
        if (displayGeneral.equip.weapon?.name === EquipmentCardName.FANGTIAN_HALBERD
            && (displayGeneral.hand?.length ?? 0) === 1) max = 3
        if (cardOwnerHasSkill('dingfeng_duanbing')) max = Math.max(max, 2)
        if (cardOwnerHasSkill('lvbu_jing_shenji')) max = Math.max(max, 3)
        if ((cardOwnerHasSkill('chengpu_lihuo') || cardOwnerHasSkill('chengpu_jie_lihuo'))
            && selectedCard.nature === 'fire') max = Math.max(max, 2)
        return max + (displayGeneral.extraSlashTargets ?? 0)
    })()
    // 单目标牌再点一名角色时替换原目标，而不是追加
    const singleTargetCardSelected = !!selectedCard && SINGLE_TARGET_CARD_NAMES.includes(selectedCard.name as string)
        && selectedCardMaxTargets <= 1
    // 技能发动询问中先选目标（如突袭）：由引擎在询问上声明 targetSelectOnActivate
    const activationCtx = myPendingResponse && pendingResponse?.type === ResponseType.SKILL_ACTIVATE_CONFIRM
        ? pendingResponse.context as any : null
    const activationTargetSelect = !!activationCtx?.targetSelectOnActivate
    const activationMaxTargets = activationTargetSelect ? Math.max(1, Number(activationCtx.maxTargets) || 1) : Infinity
    const activationMinTargets = activationTargetSelect ? Math.max(0, Number(activationCtx.minTargets) || 0) : 0
    const activationTargetCandidates = activationTargetSelect
        ? (activationCtx?.targetCandidates as number[] | undefined) ?? null
        : null
    const activationCardSelect = !!activationCtx?.cardSelectOnActivate
    const activationMinCards = activationCardSelect ? Math.max(0, Number(activationCtx.minCards) || 0) : 0
    const activationMaxCards = activationCardSelect ? Math.max(1, Number(activationCtx.maxCards) || 1) : 1
    // 需要选两名角色的主动技能：目标数由技能自己定，不能套用“单目标牌再点就替换”的规则
    const activeSkillMaxTargets = activeSkillId === 'liuxie_mizhao' || activeSkillId === 'diaochan_lijian'
        ? 2 : undefined
    const toggleTarget = (i: number) => {
        if (activationTargetCandidates && !activationTargetCandidates.includes(i)) return
        if (!canTargetWithSelectedCard(i)) return
        // 自动选中的唯一合法目标不能单击取消（仍需点「确认」出牌）
        if (selectedTargets.includes(i) && autoTargetIndexFor(selectedCard) === i) return
        if (isIronChainSelected && !selectedTargets.includes(i) && selectedTargets.length >= 2) return
        // 密诏/离间：选满后点第三个角色时替换最早选中的那个，而不是悄悄清空已选目标
        if (activeSkillMaxTargets !== undefined && !selectedTargets.includes(i)) {
            if (selectedTargets.length >= activeSkillMaxTargets) {
                useGameStore.setState({ selectedTargets: [...selectedTargets.slice(1), i] })
                return
            }
            toggleTargetSelection(i)
            return
        }
        if (!selectedTargets.includes(i)) {
            if (singleTargetCardSelected) {
                useGameStore.setState({ selectedTargets: [i] })
                return
            }
            if (activationTargetSelect && selectedTargets.length >= activationMaxTargets) {
                if (activationMaxTargets === 1) {
                    useGameStore.setState({ selectedTargets: [i] })
                }
                return
            }
            if (selectedCardMaxTargets !== Infinity && selectedTargets.length >= selectedCardMaxTargets) return
        }
        toggleTargetSelection(i)
    }

    // 单目标牌：合法目标只剩一个（或只剩一个敌人）时直接选中，省掉一次点击
    useEffect(() => {
        if (!isActionPhase || !isMyTurn || activeSkillId || myPendingResponse) return
        if (selectedCardIds.length !== 1 || selectedTargets.length > 0) return
        if (!activeGeneral) return
        const card = displayGeneral?.hand?.find(c => c.id === selectedCardIds[0])
        const auto = autoTargetIndexFor(card)
        if (auto !== null) useGameStore.setState({ selectedTargets: [auto] })
    }, [selectedCardIds, selectedTargets.length, activeSkillId, isActionPhase, isMyTurn, myPendingResponse])

    // 忠勇（周仓）：点击角色选择交牌对象 / 出杀目标
    const handlePendingTargetPick = (i: number): boolean => {
        if (!myPendingResponse || !pendingResponse) return false
        const type = pendingResponse.type
        // 赈赡（界全琮）：在需要基本牌的响应中点击手牌更少的角色作为交换对象
        if (type === ResponseType.DODGE || type === ResponseType.AOE_DODGE
            || type === ResponseType.ATTACK_DUEL || type === ResponseType.AOE_ATTACK
            || type === ResponseType.PEACH_SAVE_ASK) {
            const responder = generals[pendingResponse.targetGeneralIndex]
            const hasZhenshan = getGeneralById(responder?.generalId ?? '')?.skills
                .some(s => s.id === 'quancong_zhenshan') ?? false
            if (!hasZhenshan) return false
            if (i === pendingResponse.targetGeneralIndex) return true
            const pick = generals[i]
            if (!pick?.alive) return true
            if ((pick.handCount ?? 0) >= (responder?.handCount ?? 0)) return true
            useGameStore.setState({ selectedTargets: [i] })
            return true
        }
        if (type !== ResponseType.SKILL_ZHONGYONG_GIVE && type !== ResponseType.SKILL_ZHONGYONG_SLASH) return false
        if (i === pendingResponse.targetGeneralIndex) return true
        if (!generals[i]?.alive) return true
        if (type === ResponseType.SKILL_ZHONGYONG_SLASH) {
            const candidates = (pendingResponse.context as any)?.candidateIndices as number[] | undefined
            if (candidates && !candidates.includes(i)) return true
        }
        useGameStore.setState({ selectedTargets: [i] })
        return true
    }

    // 计算AOE方向标签：使用相邻武将名称
    const aoeDirectionLabels = (() => {
        if (isPair || !isAoeCard || activeGeneralIndex < 0) return null
        const alive = generals.filter(g => g.alive)
        const caster = generals[activeGeneralIndex]
        if (!caster) return null
        const casterAliveIdx = alive.indexOf(caster)
        if (casterAliveIdx === -1 || alive.length <= 1) return null
        const n = alive.length
        const cwFirst = alive[(casterAliveIdx + 1) % n]
        const ccwFirst = alive[(casterAliveIdx - 1 + n) % n]
        return {
            clockwise: GENERAL_NAMES[cwFirst.generalId] ?? cwFirst.generalId,
            counterclockwise: GENERAL_NAMES[ccwFirst.generalId] ?? ccwFirst.generalId,
        }
    })()

    // 默认方向：增益牌（桃园/五谷）让己方先结算，伤害牌让敌方先结算
    useEffect(() => {
        if (isPair || !isAoeCard || !selectedCard || activeGeneralIndex < 0) return
        const allyFirst = selectedCard.name === 'peach_garden' || selectedCard.name === 'harvest'
        const alive = generals.filter(g => g.alive)
        const caster = generals[activeGeneralIndex]
        const casterAliveIdx = alive.indexOf(caster)
        if (casterAliveIdx === -1 || alive.length <= 1) return
        const nextIsAlly = alive[(casterAliveIdx + 1) % alive.length].faction === caster.faction
        setAoeDirection(nextIsAlly === allyFirst ? 'clockwise' : 'counterclockwise')
    }, [selectedCard?.id])

    function handleUseCard() {
        if (selectedCardIds.length === 0) return
        // 欢乐成双的群体锦囊固定逆时针结算，不询问方向
        let extra: any = isAoeCard ? { direction: isPair ? 'counterclockwise' : aoeDirection } : undefined
        // 武圣模式：通知服务端红色牌当杀
        if (activeSkillId === 'guanyu_wusheng') {
            extra = { ...extra, wusheng: true }
        }
        // 疠火模式（界程普）：通知服务端此【杀】改为火【杀】
        if (activeSkillId === 'chengpu_jie_lihuo') {
            extra = { ...extra, lihuo: true }
        }
        emit.useCard({ cardId: selectedCardIds[0], targetIndices: selectedTargets, extra })
        clearSelection()
        setActiveSkillId(null)
    }

    function handleRecast() {
        if (selectedCard?.name !== TrickCardName.IRON_CHAIN) return
        emit.useCard({ cardId: selectedCard.id, targetIndices: [], extra: { recast: true } })
        clearSelection()
    }

    // 活墨（钟繇）：黑色非基本牌置于牌堆顶，视为使用一张基本牌
    function handleHuomoUse(as: 'attack' | 'peach' | 'wine') {
        if (!selectedCard) return
        const targetIndices = as === 'attack' ? selectedTargets : [activeGeneralIndex]
        emit.useCard({ cardId: selectedCard.id, targetIndices, extra: { huomo: as } })
        clearSelection()
    }

    function handleConfirmSkill() {
        if (!activeSkillId) return
        emit.useSkill({
            skillId: activeSkillId,
            targetIndices: selectedTargets,
            cardIds: selectedCardIds.length > 0 ? selectedCardIds : undefined,
        })
        clearSelection()
        setActiveSkillId(null)
    }

    function handleCancelSkill() {
        setActiveSkillId(null)
        clearSelection()
    }

    // ── 拖拽出牌：按住手牌拖到武将面板上直接使用 ──
    const dragMoved = useRef(false)
    const dragState = useRef<{
        card: Card
        startX: number
        startY: number
        active: boolean
        ghost: HTMLDivElement | null
        source: HTMLElement
        hoverIdx: number | null
        cleanup: () => void
    } | null>(null)

    const isAoeCardName = (name: string) =>
        ['barbarians', 'arrows', 'peach_garden', 'harvest'].includes(name)

    /** 拖到某名角色身上能否直接结算 */
    function dragTargetAllowed(card: Card, idx: number): boolean {
        if (!isActionPhase || !isMyTurn || activeSkillId || myPendingResponse) return false
        if (!activeGeneral || displayGeneral !== activeGeneral) return false
        const target = generals[idx]
        if (!target?.alive) return false
        if (isAoeCardName(card.name)) return false
        if (card.category === CardCategory.EQUIPMENT) return idx === activeGeneralIndex
        switch (card.name) {
            case BasicCardName.PEACH:
                return idx === activeGeneralIndex && activeGeneral.hp < activeGeneral.maxHp
            case BasicCardName.WINE:
                return idx === activeGeneralIndex && !activeGeneral.wineDrunk
            case BasicCardName.ATTACK:
            case BasicCardName.FIRE_SLASH:
            case BasicCardName.THUNDER_SLASH:
                if (idx === activeGeneralIndex) return false
                return getAttackRange(activeGeneral as any, target as any, generals as any).inRange
            case TrickCardName.DISMANTLE:
            case TrickCardName.STEAL:
            case TrickCardName.DUEL:
            case TrickCardName.FIRE_ATTACK:
            case TrickCardName.OVERINDULGENCE:
            case TrickCardName.SUPPLY_SHORTAGE:
                if (idx === activeGeneralIndex) return false
                return canTargetWithSelectedCard(idx, card)
            default:
                return false
        }
    }

    function playCardOnTarget(card: Card, idx: number): void {
        if (!dragTargetAllowed(card, idx)) return
        const targetIndices = card.category === CardCategory.EQUIPMENT
            || card.name === BasicCardName.PEACH
            || card.name === BasicCardName.WINE
            ? []
            : [idx]
        emit.useCard({ cardId: card.id, targetIndices })
        clearSelection()
        setActiveSkillId(null)
    }

    function startCardDrag(e: React.PointerEvent<HTMLDivElement>, card: Card): void {
        if (e.button !== 0 || !canSelectCards) return
        const source = e.currentTarget
        const state = {
            card,
            startX: e.clientX,
            startY: e.clientY,
            active: false,
            ghost: null as HTMLDivElement | null,
            source,
            hoverIdx: null as number | null,
            cleanup: () => {},
        }

        const clearHover = () => {
            document.querySelectorAll('.general-panel.drag-target')
                .forEach((p) => p.classList.remove('drag-target'))
        }

        const onMove = (ev: PointerEvent) => {
            if (!state.active) {
                if (Math.hypot(ev.clientX - state.startX, ev.clientY - state.startY) < 8) return
                state.active = true
                dragMoved.current = true
                const ghost = source.cloneNode(true) as HTMLDivElement
                ghost.classList.add('card-drag-ghost')
                ghost.classList.remove('selected', 'dimmed', 'hover')
                ghost.style.left = `${ev.clientX}px`
                ghost.style.top = `${ev.clientY}px`
                document.body.appendChild(ghost)
                state.ghost = ghost
                source.classList.add('dragging-source')
                document.body.classList.add('card-dragging')
            }
            ev.preventDefault()
            if (state.ghost) {
                state.ghost.style.left = `${ev.clientX}px`
                state.ghost.style.top = `${ev.clientY}px`
            }
            const el = document.elementFromPoint(ev.clientX, ev.clientY)
            const panel = el?.closest<HTMLElement>('.general-panel')
            const idx = panel ? Number(panel.dataset.generalIndex) : NaN
            const valid = Number.isInteger(idx) && dragTargetAllowed(card, idx)
            if (state.hoverIdx !== null && state.hoverIdx !== idx) clearHover()
            if (valid && panel) panel.classList.add('drag-target')
            state.hoverIdx = valid ? idx : null
        }

        const finish = (ev: PointerEvent, cancelled: boolean) => {
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
            window.removeEventListener('pointercancel', onCancel)
            clearHover()
            source.classList.remove('dragging-source')
            document.body.classList.remove('card-dragging')
            state.ghost?.remove()
            const wasActive = state.active
            const hoverIdx = state.hoverIdx
            state.ghost = null
            state.active = false
            dragState.current = null
            if (!wasActive) return
            // 拖拽结束后浏览器仍会补发一次 click，交给 handleCardClick 吞掉
            setTimeout(() => { dragMoved.current = false }, 0)
            if (cancelled) return
            if (hoverIdx !== null) {
                playCardOnTarget(card, hoverIdx)
                return
            }
            const droppedOnHand = !!document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.hand-area')
            if (droppedOnHand) return
            if (isDiscardPhase && isMyTurn) {
                emit.discard({ cardIds: [card.id] })
                clearSelection()
                return
            }
            if (isActionPhase && isMyTurn && !activeSkillId && !myPendingResponse) {
                useGameStore.setState({ selectedCardIds: [card.id] })
            }
        }
        const onUp = (ev: PointerEvent) => finish(ev, false)
        const onCancel = (ev: PointerEvent) => finish(ev, true)

        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        window.addEventListener('pointercancel', onCancel)
        state.cleanup = () => {
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
            window.removeEventListener('pointercancel', onCancel)
        }
        dragState.current = state
    }

    useEffect(() => () => {
        dragState.current?.cleanup()
        dragState.current?.ghost?.remove()
        document.body.classList.remove('card-dragging')
    }, [])

    // 出牌阶段手上还有能主动使用的牌时，结束出牌先二次确认，避免误点直接跳过
    function hasUsableCardInAction(): boolean {
        if (!activeGeneral || !isActionPhase) return false
        const hand = activeGeneral.hand ?? []
        if (hand.length === 0) return false
        const skillIds = (getGeneralById(activeGeneral.generalId)?.skills ?? []).map(s => s.id)
        const has = (id: string) =>
            skillIds.includes(id) || (activeGeneral!.acquiredSkills ?? []).includes(id)
        const maxSlash = has('zhangfei_paoxiao')
            ? Infinity
            : activeGeneral.equip.weapon?.name === EquipmentCardName.CROSSBOW ? 4 : 1
        const slashReady = attackUsedThisTurn < maxSlash
        const slashTargetReady = generals.some((g, i) => i !== activeGeneralIndex && g.alive
            && getAttackRange(activeGeneral as any, g as any, generals as any).inRange)
        const othersAlive = generals.some((g, i) => i !== activeGeneralIndex && g.alive)
        const me = activeGeneral
        return hand.some((card) => {
            if (card.category === CardCategory.EQUIPMENT) return true
            switch (card.name) {
                case BasicCardName.ATTACK:
                case BasicCardName.FIRE_SLASH:
                case BasicCardName.THUNDER_SLASH:
                    return slashReady && slashTargetReady
                case BasicCardName.PEACH:
                    return me.hp < me.maxHp
                case BasicCardName.WINE:
                    return !me.wineDrunk
                case BasicCardName.DODGE:
                case TrickCardName.NEGATE:
                    return false
                case TrickCardName.IRON_CHAIN:
                case TrickCardName.DISMANTLE:
                case TrickCardName.STEAL:
                case TrickCardName.DUEL:
                case TrickCardName.FIRE_ATTACK:
                case TrickCardName.OVERINDULGENCE:
                case TrickCardName.SUPPLY_SHORTAGE:
                    return othersAlive
                default:
                    return card.category === CardCategory.TRICK
            }
        })
    }

    function handleEndTurn() {
        if (hasUsableCardInAction()
            && !window.confirm('手上还有可以使用的牌，确定结束出牌吗？')) return
        emit.endTurn()
    }

    function handleDiscard() {
        if (selectedCardIds.length === 0) return
        emit.discard({ cardIds: selectedCardIds })
        clearSelection()
    }

    function handleRespond(cardId?: string, extra?: Record<string, unknown>) {
        emit.respond({ cardId, ...extra })
        clearSelection()
    }

    // 翦灭：双方各选颜色是发动后必做的选择，不是“是否发动”，且不能把对方的选择写进提示
    const jianmiePromptOwner = (() => {
        const ctx = pendingResponse?.context as any
        if (!ctx || (ctx.skillId !== 'zhangchunhua_jianmie' && ctx.skillId !== 'zhangchunhua_jianmie_opp')) return null
        const idx = ctx.skillId === 'zhangchunhua_jianmie'
            ? pendingResponse!.targetGeneralIndex
            : (ctx.jianmieOwnerIndex as number)
        const owner = generals[idx]
        return GENERAL_NAMES[owner?.generalId ?? ''] ?? '界张春华'
    })()

    // 需要玩家从若干选项里挑一个的询问（翦灭选色等）：选项不跟随视角，切视角也要能点
    const pendingOptions = (pendingResponse?.context as any)?.options as { action: string; label: string }[] | undefined
    const hasPendingOptions = !!pendingOptions?.length

    const turnPhaseName: Record<string, string> = {
        [TurnPhase.TURN_START]: '回合开始',
        [TurnPhase.JUDGE]: '判定阶段',
        [TurnPhase.DRAW]: '摸牌阶段',
        [TurnPhase.ACTION]: '出牌阶段',
        [TurnPhase.DISCARD]: '弃牌阶段',
        [TurnPhase.TURN_END]: '回合结束',
    }

    return (
        <>
        <div className="game-page">
          <div className={`game-main${mineOnTop ? ' pair-mine-top' : ''}`}>
            {/* 牌堆 / 弃牌堆 / 当前阶段：牌桌右上角小框 */}
            <div className="table-chips">
                {!isDdz && !isPair && currentActionUnit && (
                    <div className="table-chip phase">
                        <span className={activePlayerFaction === Faction.WARM ? 'faction-warm' : 'faction-cool'}>
                            {activePlayerFaction === Faction.WARM ? '暖色方' : '冷色方'}
                        </span>
                        {' · '}
                        {currentActionUnit === ActionUnitType.COMMANDER ? '主帅' : '前锋'}
                        {' · '}
                        {turnPhaseName[turnPhase] ?? turnPhase}
                    </div>
                )}
                {isDdz && (
                    <div className="table-chip phase">
                        <span className={activePlayerFaction === Faction.WARM ? 'faction-warm' : 'faction-cool'}>
                            {activePlayerFaction === Faction.WARM ? '地主' : '农民'}
                        </span>
                        {' · '}
                        {turnPhaseName[turnPhase] ?? turnPhase}
                    </div>
                )}
                {isPair && (
                    <div className="table-chip phase">
                        <span className={activePlayerFaction === Faction.WARM ? 'faction-warm' : 'faction-cool'}>
                            {activePlayerFaction === Faction.WARM ? '暖色方' : '冷色方'}
                        </span>
                        {' · '}
                        {turnPhaseName[turnPhase] ?? turnPhase}
                    </div>
                )}
                <div className="table-chip table-chip-deck">牌堆<b>{gameState.deckCount}</b></div>
                <div className="table-chip click" role="button" tabIndex={0}
                    title="查看公开信息下的剩余关键牌"
                    onClick={openPoolStats}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openPoolStats() }}>
                    记牌
                </div>
                <div className="table-chip click" role="button" tabIndex={0}
                    title="点击查看弃牌堆"
                    onClick={() => setShowDiscard(true)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setShowDiscard(true) }}>
                    弃牌<b>{discardPile.length}</b>
                </div>
            </div>
            {/* 对手武将区 */}
            <div className="generals-row opp-row">
                {oppGenerals.map((g) => {
                    const idx = generals.indexOf(g)
                    const isYiji = myPendingResponse && pendingResponse?.type === ResponseType.SKILL_YIJI_DISTRIBUTE
                    const isLeijiPick = myPendingResponse && pendingResponse?.type === ResponseType.SKILL_LEIJI_TARGET
                    const isSingleSelectSkill = isYiji || isLeijiPick || activeSkillId === 'liubei_rende'
                    return (
                        <GeneralPanel
                            key={g.generalId} general={g} index={idx}
                            isActive={idx === activeGeneralIndex}
                            isTarget={selectedTargets.includes(idx)}
                            showSeatRole={!isPair}
                            fx={fx ? (fx.target === idx ? fx.kind : (fx.from === idx ? 'cast' : null)) : null}
                            onSelect={isSingleSelectSkill
                                ? (i) => { if (handlePendingTargetPick(i)) return; if (canTargetWithSelectedCard(i)) useGameStore.setState({ selectedTargets: [i] }) }
                                : (i) => { if (handlePendingTargetPick(i)) return; toggleTarget(i) }
                            }
                            onTooltipEnter={(e) => { const c = generalTooltipById(g.generalId, g.acquiredSkills); if (c) tooltipEnter(e, c) }}
                            onEquipTooltip={(e, card) => tooltipEnter(e, equipTooltipContent(card))}
                            onTooltipMove={tooltipMove}
                            onTooltipLeave={tooltipLeave}
                        />
                    )
                })}
            </div>

            {/* 中央区域 */}
            <div className="game-center ask-overlay">

                {/* 让先选择（仅冷色方、仅第1大回合前） */}
                {!isPair && roundState?.waitingForYield && myFaction === Faction.COOL && (
                    <div className="action-unit-choice">
                        <div className="action-choice-label" style={{ color: '#ffd700' }}>
                            请选择：先手 或 让先
                        </div>
                        <button className="btn btn-secondary" onClick={() => emit.yieldChoice({ yield: false })}>
                            先手（我方先行动）
                        </button>
                        <button className="btn btn-primary" onClick={() => emit.yieldChoice({ yield: true })}>
                            让先（对方先行动）
                        </button>
                    </div>
                )}
                {!isPair && roundState?.waitingForYield && myFaction === Faction.WARM && (
                    <div className="action-unit-choice">
                        <div className="action-choice-label">等待冷色方选择先手/让先...</div>
                    </div>
                )}

                {needChooseUnit && (() => {
                    const step = roundState?.currentActionStep ?? 0
                    const isFlankOrderOnly = step === 4 || step === 5
                    // 第1大回合先手方只能选主帅
                    const isFirstMover = roundState?.firstMover === myFaction
                    const isRound1 = roundState?.roundNumber === 1
                    const canChooseFlanks = !(isRound1 && isFirstMover) || isFlankOrderOnly
                    // 只有存活且本大回合尚未行动的单元才会真正开始回合；
                    // 按此过滤，避免点到已阵亡/已行动的武将后没有任何反应
                    const commanderReady = generals.some(
                        (g) => g.faction === myFaction && g.seatRole === SeatRole.COMMANDER && g.alive && !g.hasActed)
                    const myFlanks = generals
                        .map((g, i) => ({ g, i }))
                        .filter(({ g }) => g.faction === myFaction && g.seatRole !== SeatRole.COMMANDER && g.alive && !g.hasActed)
                    const canPickCommander = !isFlankOrderOnly && commanderReady
                    const canPickFlanks = canChooseFlanks && myFlanks.length > 0
                    return (
                        <div className="action-unit-choice">
                            <div className="action-choice-label">
                                第 {roundState?.roundNumber} 大回合 · {isFlankOrderOnly ? '选择边锋行动顺序' : '选择行动单元'}
                                {isRound1 && isFirstMover && !isFlankOrderOnly && <span style={{ color: '#ff6b6b', fontSize: '12px', marginLeft: '8px' }}>（先手方第1回合只能选主帅）</span>}
                            </div>
                            {canPickCommander && (
                                <button className="btn btn-primary" onClick={() => emit.chooseActionUnit({ unit: ActionUnitType.COMMANDER })}>主帅先动</button>
                            )}
                            {canPickFlanks && (
                                myFlanks.length === 1 ? (
                                    <button className="btn btn-secondary" onClick={() => emit.chooseActionUnit({ unit: ActionUnitType.FLANKS })}>边锋先动</button>
                                ) : (
                                    <>
                                        {!isFlankOrderOnly && <div className="action-choice-sub">边锋先动（选先手）：</div>}
                                        {myFlanks.map(({ g, i }) => (
                                            <button key={i} className="btn btn-secondary"
                                                onClick={() => {
                                                    const order = [i, ...myFlanks.filter(f => f.i !== i).map(f => f.i)]
                                                    emit.chooseActionUnit({ unit: ActionUnitType.FLANKS, flankOrder: order })
                                                }}>
                                                {GENERAL_NAMES[g.generalId] ?? g.generalId} 先动
                                            </button>
                                        ))}
                                    </>
                                )
                            )}
                            {!canPickCommander && !canPickFlanks && (
                                // 没有可选单元时也必须给一个能推进的按钮：缺人的那一侧交给引擎改选另一单元
                                <button className="btn btn-secondary"
                                    onClick={() => emit.chooseActionUnit({
                                        unit: commanderReady ? ActionUnitType.COMMANDER : ActionUnitType.FLANKS,
                                    })}>
                                    继续
                                </button>
                            )}
                        </div>
                    )
                })()}

                {/* ── 无懈可击面板 ── */}
                {gameState.negateWindow && (() => {
                    const nw = gameState.negateWindow!
                    const trickName = cardNameOf(nw.trickCardName)
                    // 找出己方有无懈可击的武将（看破黑牌 / 龙魂♠ 可转化）
                    const hasSkillOf = (g: typeof generals[number], id: string) =>
                        (getGeneralById(g.generalId)?.skills.some(s => s.id === id) ?? false)
                            || (g.acquiredSkills?.includes(id) ?? false)
                    const convertCardsOf = (g: typeof generals[number]) => {
                        const cards = g.hand ?? []
                        const out: { card: typeof cards[number]; label: string }[] = []
                        for (const c of cards) {
                            if (c.name === TrickCardName.NEGATE) continue
                            if (hasSkillOf(g, 'wolong_kanpo') && (c.suit === CardSuit.SPADE || c.suit === CardSuit.CLUB)) {
                                out.push({ card: c, label: '看破' })
                            } else if (hasSkillOf(g, 'shenzhaoyun_longhun') && c.suit === CardSuit.SPADE) {
                                out.push({ card: c, label: '龙魂' })
                            }
                        }
                        return out
                    }
                    const myNegateGenerals = generals
                        .map((g, idx) => ({ g, idx }))
                        .filter(({ g }) =>
                            g.faction === myFaction &&
                            g.alive &&
                            ((g.hand ?? []).some(c => c.name === TrickCardName.NEGATE) || convertCardsOf(g).length > 0)
                        )

                    return (
                        <div className={`negate-window-panel ${nw.isCurrentlyNegated ? 'negate-critical' : ''}`}>
                            <div className="negate-header">
                                {nw.isCurrentlyNegated
                                    ? `🛡 【${trickName}】→ ${nw.trickTargetName}（已被无懈）`
                                    : `⚡ 【${trickName}】→ ${nw.trickTargetName}`
                                }
                            </div>
                            {nw.isCurrentlyNegated && myNegateGenerals.length > 0 && (
                                <div className="negate-alert">对方打出【无懈可击】！现在可以用无懈可击反制</div>
                            )}
                            <div className="negate-sub">
                                {nw.isCurrentlyNegated ? '是否反制无懈？' : '是否使用无懈可击？'}
                            </div>
                            {!nw.anyoneHasNegate && (
                                <div className="negate-countdown">无人持有无懈可击，3秒后自动结算...</div>
                            )}
                            {myNegateGenerals.length > 0 && (
                                <div className="negate-actions">
                                    {myNegateGenerals.map(({ g, idx }) => {
                                        const name = GENERAL_NAMES[g.generalId] ?? g.generalId
                                        const negateCards = [
                                            ...(g.hand ?? []).filter(c => c.name === TrickCardName.NEGATE)
                                                .map(card => ({ card, label: '无懈' })),
                                            ...convertCardsOf(g),
                                        ]
                                        if (negateCards.length === 1) {
                                            return (
                                                <button key={idx} className="btn btn-skill"
                                                    onClick={() => emit.negateRespond({
                                                        cardId: negateCards[0].card.id,
                                                        generalIndex: idx,
                                                    })}>
                                                    {name} - 使用无懈可击
                                                </button>
                                            )
                                        }
                                        // 多张无懈可击：显示每张牌
                                        return negateCards.map(({ card, label }) => (
                                            <button key={card.id} className="btn btn-skill"
                                                onClick={() => emit.negateRespond({
                                                    cardId: card.id,
                                                    generalIndex: idx,
                                                })}>
                                                {name} - {getSuitSymbol(card.suit)}{getValueStr(card.value)}{label === '无懈' ? '无懈' : `无懈（${label}）`}
                                            </button>
                                        ))
                                    })}
                                    <button className="btn btn-secondary"
                                        onClick={() => emit.negateRespond({ generalIndex: myNegateGenerals[0].idx })}>
                                        全部放弃
                                    </button>
                                </div>
                            )}
                            {myNegateGenerals.length === 0 && nw.anyoneHasNegate && (
                                <div className="negate-countdown">等待对方决定...</div>
                            )}
                        </div>
                    )
                })()}

                {pendingResponse && (() => {
                    const who = generals[pendingResponse.targetGeneralIndex]
                    const isMe = who?.faction === myFaction
                    const whoName = isMe ? '你' : (GENERAL_NAMES[who?.generalId ?? ''] ?? '对方')
                    const ctx = pendingResponse.context as any

                    const descMap: Record<string, string> = {
                        [ResponseType.PEACH_SAVE_ASK]: `⚠️ 濒死！等待${whoName}救援`,
                        [ResponseType.DODGE]: `等待${whoName}出【闪】`,
                        [ResponseType.ATTACK_DUEL]: `等待${whoName}出【杀】（决斗）`,
                        [ResponseType.JUDGE_INTERVENE]: `等待${whoName}修改判定牌（鬼才/缓释/鬼道）`,
                        [ResponseType.SKILL_ACTIVATE_CONFIRM]: jianmiePromptOwner
                            ? `【${jianmiePromptOwner}】发动技能【翦灭】`
                            : `${whoName}：是否发动【${ctx?.skillName ?? '技能'}】`,
                        [ResponseType.SKILL_FANJIAN_SUIT]: `等待${whoName}猜花色（反间）`,
                        [ResponseType.SKILL_GANGLIE_CHOICE]: `等待${whoName}选择（刚烈）`,
                        [ResponseType.SKILL_GANGLIE_TARGET]: `等待${whoName}选择刚烈的判定对象`,
                        [ResponseType.SKILL_FANJIAN_CHOICE]: `等待${whoName}选择（反间）`,
                        [ResponseType.SKILL_QIANXI_PICK]: `等待${whoName}弃牌并选择目标（潜袭）`,
                        [ResponseType.SKILL_DIANHU_TARGET]: `等待${whoName}选择点虎目标`,
                        [ResponseType.SKILL_QICE_PICK]: `等待${whoName}选择奇策锦囊`,
                        [ResponseType.SKILL_YIJI_DISTRIBUTE]: `等待${whoName}分配遗计牌`,
                        [ResponseType.SKILL_TIAOXIN_RESPONSE]: `等待${whoName}出杀（挑衅）`,
                        [ResponseType.SKILL_LUANWU_RESPONSE]: `等待${whoName}出杀或放弃（乱武）`,
                        [ResponseType.SKILL_LUANWU_PICK_TARGET]: `等待${whoName}选择杀的目标（乱武）`,
                        [ResponseType.SKILL_LUANWU_EXTRA_SLASH]: `${whoName}：乱武 — 视为使用一张无距离限制的【杀】`,
                        [ResponseType.HARVEST_PICK]: `等待${whoName}从五谷丰登中选牌`,
                        [ResponseType.AOE_DODGE]: `等待${whoName}出闪（万箭齐发）`,
                        [ResponseType.AOE_ATTACK]: `等待${whoName}出杀（南蛮入侵）`,
                        [ResponseType.EQUIP_DOUBLE_SWORDS_CHOICE]: `${whoName}：弃1手牌或让对方摸1牌（雌雄双股剑）`,
                        [ResponseType.EQUIP_KYLIN_BOW_CHOICE]: `${whoName}：选择弃目标哪匹马（麒麟弓）`,
                        [ResponseType.EQUIP_ICE_SWORD_PICK]: `${whoName}：选择弃目标的牌（寒冰剑）`,

                        [ResponseType.TRICK_TARGET_CARD_PICK]: `${whoName}：选择${(pendingResponse.context as any)?.trickType === 'dismantle' ? '弃' : '拿'}目标的哪张牌`,
                        [ResponseType.BORROW_SWORD_RESPONSE]: `${whoName}：出杀或交出武器（借刀杀人）`,
                        [ResponseType.SKILL_TUXI_CHOOSE]: `${whoName}：选择至多2名角色获取手牌（突袭）`,
                        [ResponseType.SKILL_SHENSU_TARGET]: `${whoName}：选择神速杀的目标`,
                        [ResponseType.SKILL_SHENSU_EQUIP]: `${whoName}：选择弃哪件装备（神速二）`,
                        [ResponseType.SKILL_FANKUI_PICK]: `${whoName}：选择获取伤害来源的一张牌（反馈）`,
                        [ResponseType.SKILL_GUANXING_ARRANGE]: `${whoName}：观星 — 排列牌堆顶/底`,
                        [ResponseType.SKILL_YINGHUN_CHOOSE]: `${whoName}：英魂 — 选一名角色和模式`,
                        [ResponseType.SKILL_TIANXIANG_CHOOSE]: `${whoName}：天香 — 选择转移伤害的目标`,
                        [ResponseType.SKILL_TIANXIANG_LUOSHU_OPTION]: `${whoName}：天香 — 选择后续效果`,
                        [ResponseType.SKILL_KUANGGU_CHOICE]: `${whoName}：狂骨 — 回复体力或摸牌`,
                        [ResponseType.SKILL_QIMOU_HP]: `${whoName}：奇谋 — 选择失去的体力数`,
                        [ResponseType.SKILL_LIULI_REDIRECT]: `${whoName}：流离 — 选择杀的转移目标`,
                        [ResponseType.SKILL_YINGHUN_DISCARD]: `${whoName}：英魂 — 弃${(pendingResponse.context as any)?.discardCount ?? 1}张牌（手牌/装备）`,
                        [ResponseType.SKILL_LEIJI_TARGET]: `${whoName}：雷击 — 选择令哪名角色判定（可放弃）`,
                        [ResponseType.SKILL_ZHONGYONG_GIVE]: `${whoName}：忠勇 — 选择一名角色交出牌`,
                        [ResponseType.SKILL_ZHONGYONG_SLASH]: `${whoName}：忠勇 — 可选择一张【杀】指定目标`,
                        [ResponseType.SKILL_SHUOMENG_TARGET]: `${whoName}：说盟 — 选择拼点对象`,
                        [ResponseType.SKILL_SHUOMENG_CARD]: `${whoName}：说盟 — 选择拼点用的手牌`,
                        [ResponseType.SKILL_MIJI_GIVE]: `${whoName}：秘计 — 选择交牌对象与手牌`,
                        [ResponseType.SKILL_QIZHI_TARGET]: `${whoName}：奇制 — 选择弃置谁的一张牌`,
                        [ResponseType.SKILL_DUFENG_CHOICE]: `${whoName}：独锋 — 失去体力或废除装备栏`,
                        [ResponseType.SKILL_JINQU_DISCARD]: `${whoName}：进趋 — 选择弃置的手牌`,
                        [ResponseType.SKILL_CHOOSE_TARGET]: `${whoName}：选择技能目标`,
                        [ResponseType.SKILL_GIVE_CARDS]: `${whoName}：选择要交给对方的牌`,
                        [ResponseType.SKILL_PICK_CARD]: `${whoName}：选择一张牌`,
                        [ResponseType.LANDLORD_REWARD]: `${whoName}：${isPair ? '同阵营阵亡补偿' : '阵亡奖励'} — 摸两张牌或回复1点体力`,
                    }
                    const desc = descMap[pendingResponse.type] ?? `等待${whoName}响应`

                    return (
                        <div className={`pending-response-banner ${pendingResponse.type === ResponseType.PEACH_SAVE_ASK ? 'dying-alert' : ''}`}>
                            {desc}
                        </div>
                    )
                })()}

            </div>

            {/* 己方武将区 */}
            <div className="generals-row my-row">
                {myGenerals.map((g) => {
                    const idx = generals.indexOf(g)
                    const isViewing = idx === displayGeneralIdx
                    // 遗计/雷击等需要选目标的响应期间，点击己方武将也选为目标
                    const needTargetPick = myPendingResponse && (
                        pendingResponse?.type === ResponseType.SKILL_YIJI_DISTRIBUTE
                        || pendingResponse?.type === ResponseType.SKILL_LEIJI_TARGET
                        || pendingResponse?.type === ResponseType.SKILL_ZHONGYONG_GIVE
                        || pendingResponse?.type === ResponseType.SKILL_ZHONGYONG_SLASH
                    )
                    // 出牌阶段或技能发动前选目标时：己方武将也可被选为目标
                    const needMyTarget = (isActionPhase && isMyTurn) || activationTargetSelect
                    const peekNames = (g.hand ?? []).map((c) => cardNameOf(c.name))
                    return (
                        <div className="mine-unit" key={g.generalId}>
                            {peekNames.length > 0 && (
                                <div className="hand-peek" title={peekNames.join('、')}>
                                    {peekNames.slice(0, 4).map((n, ni) => <span key={ni}>{n}</span>)}
                                    {peekNames.length > 4 && <span className="more">…</span>}
                                </div>
                            )}
                            <GeneralPanel
                                key={g.generalId} general={g} index={idx}
                            isActive={idx === activeGeneralIndex}
                            isTarget={selectedTargets.includes(idx)}
                            showSeatRole={!isPair}
                            fx={fx ? (fx.target === idx ? fx.kind : (fx.from === idx ? 'cast' : null)) : null}
                            onSelect={(needTargetPick)
                                ? (i) => {
                                    if (handlePendingTargetPick(i)) return
                                    // 遗计：不能选自己（有"保留"按钮），且单选模式
                                    // 雷击：可选任意存活角色（含自己），单选模式
                                    if (pendingResponse!.type !== ResponseType.SKILL_LEIJI_TARGET
                                        && i === pendingResponse!.targetGeneralIndex) return
                                    useGameStore.setState({ selectedTargets: [i] })
                                }
                                : (i) => {
                                    if (needMyTarget) {
                                        // 已选牌、激活技能或技能询问前选目标时，点击己方武将 = 选为目标
                                        if (selectedCardIds.length > 0 || activeSkillId || activationTargetSelect) {
                                            if (!canTargetWithSelectedCard(i)) return
                                            // 仁德等单选技能：替换而非追加
                                            if (activeSkillId === 'liubei_rende') {
                                                useGameStore.setState({ selectedTargets: [i] })
                                            } else {
                                                toggleTarget(i)
                                            }
                                        } else {
                                            // 未选牌时，点击己方武将 = 切换查看手牌
                                            setViewingGeneralIdx(i === activeGeneralIndex ? null : i)
                                        }
                                    } else {
                                        setViewingGeneralIdx(i === viewingGeneralIdx ? null : i)
                                    }
                                }}
                            isViewing={isViewing}
                            onTooltipEnter={(e) => { const c = generalTooltipById(g.generalId, g.acquiredSkills); if (c) tooltipEnter(e, c) }}
                            onEquipTooltip={(e, card) => tooltipEnter(e, equipTooltipContent(card))}
                            onTooltipMove={tooltipMove}
                            onTooltipLeave={tooltipLeave}
                            />
                        </div>
                    )
                })}

            </div>

            {/* 底边带：视角武将 | 手牌 */}
            <div className="hand-area">
                <div className="view-card">
                    {displayGeneral ? (() => {
                        const roleLabel = isDdz
                            ? (displayGeneral.faction === Faction.WARM ? '地主' : '农民')
                            : isPair
                                ? (displayGeneral.faction === Faction.WARM ? '暖色方' : '冷色方')
                                : (displayGeneral.seatRole === SeatRole.COMMANDER ? '主将' : '前锋')
                        const vName = GENERAL_NAMES[displayGeneral.generalId] ?? displayGeneral.generalId
                        const vImg = GENERAL_IMAGE[displayGeneral.generalId]
                        const isActing = displayGeneral === activeGeneral
                        return (
                            <>
                                <div className="view-label">当前视角</div>
                                <div className="view-main">
                                    <div className={`view-face ${isActing ? 'acting' : ''}`}>
                                        {vImg
                                            ? <img src={vImg} alt={vName} onError={(e) => { e.currentTarget.style.display = 'none' }} />
                                            : <span>{vName[0]}</span>}
                                    </div>
                                    <div className="view-info">
                                        <div className="view-name">{vName}</div>
                                        <div className="view-sub">{roleLabel}{isActing ? ' · 行动中' : ''}</div>
                                        <div className="view-stats">体力 <b>{displayGeneral.hp}/{displayGeneral.maxHp}</b>
                                            {(displayGeneral.armorPoints ?? 0) > 0 && <> · 护甲 <b>{displayGeneral.armorPoints}</b></>}
                                        </div>
                                    </div>
                                </div>
                            </>
                        )
                    })() : <div className="view-label">当前视角</div>}

                    {/* 主动技能（视角武将下方） */}
                    {isActionPhase && isMyTurn && isViewingActive && !gameState.pendingResponse && !gameState.negateWindow && !activeSkillId && activeGeneral && (
                        <div className="view-skills">
                            {activeSkillDefs
                                .filter(skill => !skill.requireAcquired
                                    || (activeGeneral.acquiredSkills ?? []).includes(skill.id))
                                .map(skill => {
                                    const usedIds = skill.usedWith ? [skill.id, ...skill.usedWith] : [skill.id]
                                    const useCount = activeGeneral.skillsUsedThisTurn?.filter(id => usedIds.includes(id)).length ?? 0
                                    const maxUses = skill.id === 'dianwei_jie_qiangxi' ? 2
                                        : skill.id === 'zhuran_danshou' ? 4
                                            : skill.id === 'zhonghui_paiyi' ? 2
                                                : (skill.id === 'cenhun_jishe' || skill.id === 'xiahoushi_yanyu') ? 99 : 1
                                    const usedThisTurn = skill.id === 'zhonghui_paiyi'
                                        ? (activeGeneral.paiyiUsesPhase ?? 0) >= (activeGeneral.paiyiLimitPhase ?? 1)
                                        : useCount >= maxUses
                                    const usedLimited = activeGeneral.usedLimitedSkills?.includes(skill.id)
                                    const levelLocked = skill.jzLevel !== undefined
                                        && (activeGeneral.jiaozhaoUpgrade ?? 0) < skill.jzLevel
                                    const usedThisRound = skill.roundField !== undefined
                                        && activeGeneral[skill.roundField] !== undefined
                                        && activeGeneral[skill.roundField] === gameState.roundState?.roundNumber
                                    const isDisabled = !!(usedThisTurn || usedLimited || levelLocked || usedThisRound)
                                    return (
                                        <button
                                            key={skill.id}
                                            className={`btn btn-skill ${isDisabled ? 'btn-disabled' : ''}`}
                                            disabled={isDisabled}
                                            onClick={() => {
                                                clearSelection()
                                                setActiveSkillId(skill.id)
                                            }}
                                            title={isDisabled
                                                ? (usedLimited ? '限定技已使用'
                                                    : levelLocked ? `需“矫诏”修改至第${skill.jzLevel}层`
                                                        : usedThisRound ? '本大回合已使用'
                                                            : '本回合已使用')
                                                : skill.desc}
                                        >
                                            {skill.name}{usedThisTurn || usedThisRound ? '·已用' : (useCount > 0 ? `·${useCount}/${maxUses}` : '')}
                                        </button>
                                    )
                                })}
                            {activeGeneral.equip.weapon?.name === 'zhangba_spear' && (
                                <button
                                    className="btn btn-skill"
                                    onClick={() => {
                                        clearSelection()
                                        setActiveSkillId('equip_zhangba_spear')
                                    }}
                                    title="选2张手牌+1个目标，弃牌当杀使用"
                                >
                                    丈八蛇矛
                                </button>
                            )}
                        </div>
                    )}

                    {/* 响应期技能（视角武将下方）：赈赡这类只在“需要使用基本牌”时可发的技能 */}
                    {myPendingResponse && isViewingResponding && !gameState.negateWindow && displayGeneral && (() => {
                        const hasZhenshan = (getGeneralById(displayGeneral.generalId)?.skills
                            .some(s => s.id === 'quancong_zhenshan') ?? false)
                            || (displayGeneral.acquiredSkills ?? []).includes('quancong_zhenshan')
                        const needsBasic = pendingResponse?.type === ResponseType.DODGE
                            || pendingResponse?.type === ResponseType.AOE_DODGE
                            || pendingResponse?.type === ResponseType.ATTACK_DUEL
                            || pendingResponse?.type === ResponseType.AOE_ATTACK
                            || pendingResponse?.type === ResponseType.PEACH_SAVE_ASK
                        if (!hasZhenshan || !needsBasic) return null
                        const zsTarget = selectedTargets[0]
                        const zsReady = typeof zsTarget === 'number'
                        return (
                            <div className="view-skills">
                                <button className="btn btn-skill" disabled={!zsReady}
                                    title="与一名手牌数少于你的角色交换手牌，视为使用或打出所需的基本牌"
                                    onClick={() => handleRespond(undefined, { action: 'zhenshan', targetIndex: zsTarget } as any)}>
                                    赈赡{zsReady ? '' : '（先点选一名手牌少于你的角色）'}
                                </button>
                            </div>
                        )
                    })()}
                </div>

                <div className="hand-main">
                    <div className="hand-tools">
                        <button className="btn btn-tool"
                            title="点一次整理一次：按类别 → 按花色 → 恢复原序（之后保持这个顺序，不会自动重排）"
                            onClick={arrangeHand}>
                            整理手牌{handSortMode === 'type' ? '·类别' : handSortMode === 'suit' ? '·花色' : ''}
                        </button>
                        {displayGeneral && (
                            <span className="hand-owner-label">
                                {GENERAL_NAMES[displayGeneral.generalId] ?? displayGeneral.generalId} 的手牌 · {(displayGeneral.hand ?? []).length} 张
                            </span>
                        )}
                    </div>
                <div className="hand-cards" ref={handRef} style={handCardMetrics}>
                    {displayGeneral && isViewingMyGeneral ? (
                        <>
                            {(sortedHandCards).map((card) => (
                                <PlayingCard
                                    key={card.id} card={card}
                                    selected={selectedCardIds.includes(card.id)}
                                    onClick={() => handleCardClick(card.id)}
                                    onPointerDown={(e) => startCardDrag(e, card)}
                                    dimmed={!canSelectCards || (activeSkillId === 'chengong_mingce' && !isMingceCard(card))}
                                    onTooltipEnter={(e) => { const c = cardTooltipContent(card.name); if (c) tooltipEnter(e, c) }}
                                    onTooltipMove={tooltipMove}
                                    onTooltipLeave={tooltipLeave}
                                />
                            ))}
                            {/* 技能激活或特定响应时显示可选装备牌 */}
                            {(() => {
                                // 定义哪些主动技能可以用装备牌
                                const equipSkillFilter: Record<string, (card: Card) => boolean> = {
                                    'ganning_qixi': (c) => c.suit === CardSuit.SPADE || c.suit === CardSuit.CLUB,
                                    'diaochan_lijian': () => true,
                                    'xuhuang_jie_duanliang': (c) => (c.suit === CardSuit.SPADE || c.suit === CardSuit.CLUB),
                                    'daqiao_guose': (c) => c.suit === CardSuit.DIAMOND,
                                    'sunquan_zhiheng': () => true,
                                    'huanggai_kurou': () => true,
                                    'equip_zhangba_spear': () => true,
                                }
                                let filter: ((card: Card) => boolean) | null = null
                                if (activeSkillId) {
                                    filter = equipSkillFilter[activeSkillId] ?? null
                                } else if (myPendingResponse && isViewingResponding && pendingResponse) {
                                    // 响应阶段：急救(红色牌)、缓释/鬼才(任意牌)、贯石斧(任意牌)
                                    if (pendingResponse.type === ResponseType.PEACH_SAVE_ASK) {
                                        // 急救(红色牌) + 救主(任意牌)
                                        const responder = gameState.generals[pendingResponse.targetGeneralIndex]
                                        const hasJiuzhu = responder?.generalId === 'zhaoyun_jing'
                                        const hasJijiu = responder?.generalId === 'huatuo'
                                        if (hasJiuzhu) {
                                            filter = () => true // 救主可以弃任意牌
                                        } else if (hasJijiu) {
                                            filter = (c) => c.suit === CardSuit.HEART || c.suit === CardSuit.DIAMOND
                                        }
                                    } else if (pendingResponse.type === ResponseType.JUDGE_INTERVENE) {
                                        // 缓释（诸葛瑾）可用任意牌；鬼道（张角）只能用黑色牌
                                        const responder = gameState.generals[pendingResponse.targetGeneralIndex]
                                        if (responder?.generalId === 'zhugejin') filter = () => true
                                        else if (responder?.generalId === 'zhangjiao') {
                                            filter = (c) => c.suit === CardSuit.SPADE || c.suit === CardSuit.CLUB
                                        }
                                    } else if (pendingResponse.type === ResponseType.SKILL_ACTIVATE_CONFIRM
                                        && (pendingResponse.context as any)?.skillId === 'equip_stone_axe') {
                                        filter = () => true
                                    }
                                }
                                if (!filter || !displayGeneral) return null
                                const f = filter
                                const equipCards: Card[] = []
                                for (const slot of ['weapon', 'armor', 'plus_horse', 'minus_horse'] as const) {
                                    const card = displayGeneral.equip[slot]
                                    if (card && f(card)) equipCards.push(card)
                                }
                                if (equipCards.length === 0) return null
                                return (
                                    <div className="equip-select-row">
                                        <span className="equip-select-label">装备区：</span>
                                        {equipCards.map(card => (
                                            <PlayingCard
                                                key={card.id} card={card}
                                                selected={selectedCardIds.includes(card.id)}
                                                onClick={() => handleCardClick(card.id)}
                                                onPointerDown={(e) => startCardDrag(e, card)}
                                            />
                                        ))}
                                    </div>
                                )
                            })()}
                        </>
                    ) : null}
                </div>
                </div>
            </div>

            {/* 询问 / 操作条（手牌区上方，无内容时透明） */}
                <div className="action-btns action-dock">
                    {isActionPhase && isMyTurn && isViewingActive && !gameState.pendingResponse && !gameState.negateWindow && (() => {
                        // toggle模式技能：激活后仍用"出牌"按钮，不显示"确认发动"
                        const TOGGLE_SKILLS = ['guanyu_wusheng', 'chengpu_jie_lihuo']
                        const isToggleSkillActive = activeSkillId && TOGGLE_SKILLS.includes(activeSkillId)
                        const isNonToggleSkillActive = activeSkillId && !isToggleSkillActive
                        return (
                        <>
                            <button className="btn btn-primary"
                                disabled={selectedCardIds.length === 0 || !!isNonToggleSkillActive || !ironChainTargetReady}
                                title={isNonToggleSkillActive ? '技能已激活：请点「确认发动」'
                                    : !ironChainTargetReady ? '铁索连环需先指定 1-2 名角色'
                                        : selectedCardIds.length === 0 ? '先点选一张手牌' : '出牌（空格）'}
                                onClick={handleUseCard}>出牌</button>
                            {isIronChainSelected && (
                                <span className="action-hint">
                                    {ironChainTargetReady
                                        ? `已选 ${selectedTargets.length} 名角色（最多 2 名）`
                                        : '请先选择 1-2 名角色'}
                                </span>
                            )}
                            {/* AOE方向选择：显示相邻武将名表示方向 */}
                            {!isPair && isAoeCard && aoeDirectionLabels && (
                                <>
                                    <button className={`btn ${aoeDirection === 'clockwise' ? 'btn-skill aoe-dir-active' : 'btn-secondary aoe-dir-idle'}`}
                                        onClick={() => setAoeDirection('clockwise')}>
                                        {aoeDirection === 'clockwise' ? '✔ ' : ''}→ {aoeDirectionLabels.clockwise}方向
                                    </button>
                                    <button className={`btn ${aoeDirection === 'counterclockwise' ? 'btn-skill aoe-dir-active' : 'btn-secondary aoe-dir-idle'}`}
                                        onClick={() => setAoeDirection('counterclockwise')}>
                                        {aoeDirection === 'counterclockwise' ? '✔ ' : ''}→ {aoeDirectionLabels.counterclockwise}方向
                                    </button>
                                </>
                            )}
                            {!isNonToggleSkillActive && <button className="btn" title="结束出牌（空格）" onClick={handleEndTurn}>结束出牌</button>}
                            {selectedCard?.name === TrickCardName.IRON_CHAIN && !isNonToggleSkillActive && (
                                <>
                                    <button className="btn btn-skill" onClick={handleRecast}>重铸</button>
                                    <span className="action-hint">弃此牌摸一张；也可指定 1-2 名角色横置/重置</span>
                                </>
                            )}
                            {/* 活墨（钟繇）：黑色非基本牌当基本牌使用 */}
                            {selectedCard && activeGeneral && !isNonToggleSkillActive && (() => {
                                const skills = getGeneralById(activeGeneral.generalId)?.skills ?? []
                                if (!skills.some(s => s.id === 'zhongyao_huomo')) return null
                                const isBlack = selectedCard.suit === CardSuit.SPADE || selectedCard.suit === CardSuit.CLUB
                                if (!isBlack || selectedCard.category === CardCategory.BASIC) return null
                                const slashTarget = selectedTargets.find(i => i !== activeGeneralIndex && generals[i]?.alive)
                                return (
                                    <>
                                        <button className="btn btn-skill" disabled={slashTarget === undefined}
                                            onClick={() => handleHuomoUse('attack')}>活墨·杀</button>
                                        <button className="btn btn-skill" disabled={activeGeneral.hp >= activeGeneral.maxHp}
                                            onClick={() => handleHuomoUse('peach')}>活墨·桃</button>
                                        <button className="btn btn-skill" disabled={activeGeneral.wineDrunk}
                                            onClick={() => handleHuomoUse('wine')}>活墨·酒</button>
                                    </>
                                )
                            })()}
                            {/* toggle模式技能激活中：显示高亮标签和取消 */}
                            {isToggleSkillActive && (() => {
                                const skillDef = activeSkillDefs.find(s => s.id === activeSkillId) ?? null
                                return (
                                    <>
                                        <span style={{ color: '#ffd700', fontWeight: 'bold', fontSize: '12px' }}>
                                            {skillDef?.name ?? activeSkillId} 模式
                                        </span>
                                        <button className="btn btn-secondary" onClick={handleCancelSkill}>取消{skillDef?.name}</button>
                                    </>
                                )
                            })()}
                            {/* 非toggle技能激活中：显示确认/取消按钮 */}
                            {isNonToggleSkillActive && (() => {
                                const skillDef = activeSkillDefs.find(s => s.id === activeSkillId) ?? null
                                const equipSkillNames: Record<string, string> = { equip_zhangba_spear: '丈八蛇矛' }
                                const displayName = skillDef?.name ?? equipSkillNames[activeSkillId!] ?? activeSkillId
                                const skillHint = activeSkillId === 'equip_zhangba_spear'
                                    ? '（选2张手牌+1个目标）'
                                    : activeSkillId === 'bulianshi_anxu'
                                        ? '（依次点选两名其他角色）'
                                    : activeSkillId === 'huanggai_kurou' && activeGeneral?.generalId === 'huanggai_jie'
                                        ? '（选1张手牌或装备牌弃置）'
                                    : activeSkillId === 'chengong_mingce'
                                        ? '（选1张装备牌/杀 → 选受牌者 → 可选1名其攻击范围内的杀目标，按此顺序点选，共2个目标）'
                                        : ''
                                return (
                                    <>
                                        <span style={{ color: '#ffd700', fontWeight: 'bold', marginRight: '8px' }}>
                                            {displayName} 激活中{skillHint}
                                        </span>
                                        <button className="btn btn-skill"
                                            disabled={activeSkillId === 'huanggai_kurou'
                                                && activeGeneral?.generalId === 'huanggai_jie'
                                                && selectedCardIds.length !== 1}
                                            title={activeSkillId === 'huanggai_kurou'
                                                && activeGeneral?.generalId === 'huanggai_jie'
                                                && selectedCardIds.length !== 1
                                                ? '界苦肉需先选 1 张手牌或装备牌' : '确认发动该技能'}
                                            onClick={handleConfirmSkill}>确认发动</button>
                                        <button className="btn btn-secondary" onClick={handleCancelSkill}>取消</button>
                                    </>
                                )
                            })()}
                        </>
                        )
                    })()}
                    {isDiscardPhase && isMyTurn && isViewingActive && !gameState.pendingResponse && !gameState.negateWindow && (
                        <>
                            <span className="action-hint">
                                需弃 {discardNeed} 张 · 已选 {selectedCardIds.length} 张（可分批弃置）
                            </span>
                            <button className="btn btn-primary"
                                disabled={selectedCardIds.length === 0 || selectedCardIds.length > discardNeed}
                                title={selectedCardIds.length === 0 ? '先选要弃置的牌'
                                    : selectedCardIds.length > discardNeed ? `最多只能弃 ${discardNeed} 张` : '弃置所选（空格）'}
                                onClick={handleDiscard}>
                                弃置所选
                            </button>
                        </>
                    )}
                    {/* 有待响应但不在查看响应武将时，提示点击切换 */}
                    {myPendingResponse && !isViewingResponding && (() => {
                        const rg = generals[pendingResponse!.targetGeneralIndex]
                        const rgName = rg ? (GENERAL_NAMES[rg.generalId] ?? rg.generalId) : '武将'
                        return (
                            <button className="btn btn-danger" onClick={() => setViewingGeneralIdx(pendingResponse!.targetGeneralIndex)}>
                                点击查看 {rgName} 的待操作
                            </button>
                        )
                    })()}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.PEACH_SAVE_ASK && (() => {
                        const responder = generals[pendingResponse.targetGeneralIndex]
                        const dyingIdx = (pendingResponse.context as any)?.dyingGeneralIndex
                        const dying = typeof dyingIdx === 'number' ? generals[dyingIdx] : null
                        const cardCount = (responder?.hand?.length ?? 0)
                            + Object.values(responder?.equip ?? {}).filter(Boolean).length
                        const canJiuzhu = !!responder && responder.generalId === 'zhaoyun_jing'
                            && responder !== dying
                            && responder.hp > 1
                            && cardCount > 0
                            && responder.faction === dying?.faction
                        const canJijiu = !!responder
                            && (getGeneralById(responder.generalId)?.skills.some(s => s.id === 'huatuo_jijiu') ?? false)
                        const chunCount = responder?.generalPile?.length ?? 0
                        // 界程普：移去 X 张（X 为本轮以此法使用【酒】的次数），原版固定 1 张
                        const chunCost = Math.max(1, responder?.chunlaoCost ?? 0)
                        const canChunlao = !!responder
                            && (responder.generalId === 'chengpu' || responder.generalId === 'chengpu_jie')
                            && chunCount > 0 && chunCount >= chunCost
                        return (
                            <>
                                <button className="btn btn-danger" disabled={selectedCardIds.length === 0}
                                    onClick={() => handleRespond(selectedCardIds[0], { action: 'peach' })}>使用桃</button>
                                {canJiuzhu && (
                                    <button className="btn btn-skill"
                                        onClick={() => handleRespond(selectedCardIds[0] || undefined, { action: 'jiuzhu' })}>救主</button>
                                )}
                                {canJijiu && (
                                    <button className="btn btn-skill" disabled={selectedCardIds.length === 0}
                                        onClick={() => handleRespond(selectedCardIds[0], { action: 'jijiu' })}>急救</button>
                                )}
                                {canJijiu && responder && Object.entries(responder.equip)
                                    .filter(([, c]) => !!c && (c.suit === 'heart' || c.suit === 'diamond'))
                                    .map(([slot, c]) => (
                                        <button key={slot} className="btn btn-skill"
                                            onClick={() => handleRespond((c as any).id, { action: 'jijiu' })}>
                                            急救·装备
                                        </button>
                                    ))}
                                {canChunlao && (
                                    <button className="btn btn-skill"
                                        onClick={() => handleRespond(undefined, { action: 'chunlao' })}>
                                        醇醪（移去{chunCost}张“醇”）
                                    </button>
                                )}
                                {!!responder && getGeneralById(responder.generalId)?.skills
                                    .some(s => s.id === 'quancong_zhenshan') && (
                                        <button className="btn btn-skill" disabled={selectedTargets.length === 0}
                                            onClick={() => handleRespond(undefined, { action: 'zhenshan', targetIndex: selectedTargets[0] } as any)}>
                                            赈赡（先点选一名手牌少于你的角色）
                                        </button>
                                    )}
                                <button className="btn" onClick={() => handleRespond(undefined)}>跳过</button>
                                <button className="btn" onClick={() => handleRespond(undefined, { action: 'skip_all' })}>全部跳过</button>
                            </>
                        )
                    })()}
                    {/* 选项不跟随视角（切视角也要能点）；无懈窗口期间该询问会被引擎拒绝，先藏起来避免点空 */}
                    {myPendingResponse && (isViewingResponding || hasPendingOptions) && !gameState.negateWindow
                        && pendingResponse?.type === ResponseType.SKILL_ACTIVATE_CONFIRM && (
                        <>
                            <span className="skill-confirm-label">
                                {(pendingResponse.context as any)?.skillId === 'jiangwei_zhiji_choice'
                                    ? '【志继】选择：'
                                    : jianmiePromptOwner
                                        ? `【${jianmiePromptOwner}】发动技能【翦灭】`
                                        : `发动【${(pendingResponse.context as any)?.skillName}】？`}
                                {(pendingResponse.context as any)?.description && ` ${(pendingResponse.context as any).description}`}
                            </span>
                            {((pendingResponse.context as any)?.options as { action: string; label: string }[] | undefined)?.length ? (
                                <>
                                    {activationCardSelect && (
                                        <span className="skill-confirm-label">
                                            先点选要交出的手牌（数量与所选项相同，已选 {selectedCardIds.length} 张）
                                        </span>
                                    )}
                                    {((pendingResponse.context as any).options as { action: string; label: string }[])
                                        .map((opt) => (
                                            <button key={opt.action} className="btn btn-skill"
                                                onClick={() => handleRespond(undefined, {
                                                    action: opt.action,
                                                    generalIndex: pendingResponse.targetGeneralIndex,
                                                    ...(activationCardSelect && selectedCardIds.length > 0
                                                        ? { cardIds: selectedCardIds }
                                                        : {}),
                                                })}>
                                                {opt.label}
                                            </button>
                                        ))}
                                    {!((pendingResponse.context as any)?.mandatory) && (
                                        <button className="btn"
                                            onClick={() => handleRespond(undefined, {
                                                action: 'decline',
                                                generalIndex: pendingResponse.targetGeneralIndex,
                                            })}>放弃</button>
                                    )}
                                </>
                            ) : (pendingResponse.context as any)?.skillId === 'jiangwei_zhiji_choice' ? (
                                <>
                                    <button className="btn btn-skill"
                                        onClick={() => handleRespond(undefined, { action: 'heal' })}>回复体力</button>
                                    <button className="btn btn-skill"
                                        onClick={() => handleRespond(undefined, { action: 'draw' })}>摸2张牌</button>
                                </>
                            ) : (pendingResponse.context as any)?.skillId === 'sunjian_yinghun' ? (
                                <>
                                    <button className="btn btn-skill"
                                        onClick={() => handleRespond(undefined, { action: 'confirm' })}>模式A（摸X弃1）</button>
                                    <button className="btn btn-skill"
                                        onClick={() => handleRespond(undefined, { action: 'modeB' })}>模式B（摸1弃X）</button>
                                    <button className="btn"
                                        onClick={() => handleRespond(undefined, { action: 'decline' })}>放弃</button>
                                </>
                            ) : (pendingResponse.context as any)?.skillId === 'wangyi_miji_give' ? (
                                <>
                                    <button className="btn btn-skill"
                                        onClick={() => handleRespond(undefined, { action: 'confirm' })}>交给队友</button>
                                    <button className="btn"
                                        onClick={() => handleRespond(undefined, { action: 'decline' })}>不交</button>
                                </>
                            ) : (pendingResponse.context as any)?.skillId === 'wangping_feijun_option' ? (
                                <>
                                    <button className="btn btn-skill"
                                        onClick={() => handleRespond(undefined, { action: 'give' })}>令其交给你一张牌</button>
                                    <button className="btn btn-skill"
                                        onClick={() => handleRespond(undefined, { action: 'equip' })}>弃置其一张装备牌</button>
                                </>
                            ) : (pendingResponse.context as any)?.skillId === 'sp_sunshangxiang_liangzhu' ? (
                                <>
                                    <button className="btn btn-skill"
                                        onClick={() => handleRespond(undefined, { action: 'confirm' })}>自己摸1张</button>
                                    <button className="btn btn-skill"
                                        onClick={() => handleRespond(undefined, { action: 'target' })}>令其摸2张</button>
                                    <button className="btn"
                                        onClick={() => handleRespond(undefined, { action: 'decline' })}>放弃</button>
                                </>
                            ) : (pendingResponse.context as any)?.skillId === 'zhugejin_hongyuan' ? (
                                <>
                                    <button className="btn btn-skill"
                                        onClick={() => handleRespond(undefined, { action: 'confirm' })}>发动</button>
                                    <button className="btn"
                                        onClick={() => handleRespond(undefined, { action: 'decline' })}>放弃</button>
                                </>
                            ) : (pendingResponse.context as any)?.skillId === 'equip_stone_axe' ? (
                                <>
                                    <button className="btn btn-skill" disabled={selectedCardIds.length < 2}
                                        onClick={() => emit.respond({ action: 'confirm', cardIds: selectedCardIds.slice(0, 2) } as any)}>
                                        弃{selectedCardIds.length}/2张牌发动
                                    </button>
                                    <button className="btn"
                                        onClick={() => handleRespond(undefined, { action: 'decline' })}>放弃</button>
                                </>
                            ) : (pendingResponse.context as any)?.skillId === 'equip_green_dragon' ? (
                                <>
                                    <button className="btn btn-skill" disabled={selectedCardIds.length === 0}
                                        onClick={() => handleRespond(selectedCardIds[0], { action: 'confirm' })}>
                                        选杀牌追杀
                                    </button>
                                    <button className="btn"
                                        onClick={() => handleRespond(undefined, { action: 'decline' })}>放弃</button>
                                </>
                            ) : (pendingResponse.context as any)?.skillId === 'daqiao_liuli' ? (
                                <>
                                    <button className="btn btn-skill" disabled={selectedCardIds.length === 0}
                                        onClick={() => handleRespond(selectedCardIds[0], { action: 'confirm' })}>
                                        弃牌发动流离
                                    </button>
                                    <button className="btn"
                                        onClick={() => handleRespond(undefined, { action: 'decline' })}>放弃</button>
                                </>
                            ) : (pendingResponse.context as any)?.skillId === 'xiaoqiao_tianxiang' ? (() => {
                                // 天香：点选♥手牌，并可同时点选伤害转移目标
                                const selfIdx = pendingResponse.targetGeneralIndex
                                const txTargets = selectedTargets.filter(i => i !== selfIdx)
                                return (
                                    <>
                                        <span className="skill-confirm-label">
                                            点选一张♥手牌，可同时点选伤害转移目标（已选 {txTargets.length}/1）
                                        </span>
                                        <button className="btn btn-skill" disabled={selectedCardIds.length === 0}
                                            onClick={() => handleRespond(selectedCardIds[0], {
                                                action: 'confirm',
                                                ...(txTargets.length > 0 ? { targetIndices: txTargets.slice(0, 1) } : {}),
                                            } as any)}>
                                            选♥牌发动天香
                                        </button>
                                        <button className="btn"
                                            onClick={() => handleRespond(undefined, { action: 'decline' })}>放弃</button>
                                    </>
                                )
                            })() : (pendingResponse.context as any)?.skillId === 'chengong_mingce' ? (() => {
                                const mingceCtx = pendingResponse.context as any
                                const slashTargetIdx = mingceCtx.mingceSlashTargetIndex
                                const slashTarget = typeof slashTargetIdx === 'number' && slashTargetIdx >= 0
                                    ? generals[slashTargetIdx] : null
                                return (
                                    <>
                                        {slashTarget && (
                                            <button className="btn btn-skill"
                                                onClick={() => handleRespond(undefined, { action: 'mingce_slash' })}>
                                                视为对{GENERAL_NAMES[slashTarget.generalId] ?? slashTarget.generalId}使用【杀】
                                            </button>
                                        )}
                                        <button className="btn btn-skill"
                                            onClick={() => handleRespond(undefined, { action: 'mingce_draw' })}>
                                            摸一张牌
                                        </button>
                                    </>
                                )
                            })() : (pendingResponse.context as any)?.skillId === 'fuwan_moukui' ? (() => {
                                const moukuiCtx = pendingResponse.context as any
                                const mkTargetIdx = moukuiCtx.moukuiTargetIndex
                                const mkTarget = typeof mkTargetIdx === 'number' ? generals[mkTargetIdx] : null
                                const mkHasCard = !!mkTarget && (
                                    (mkTarget.handCount ?? 0) > 0
                                    || !!mkTarget.equip.weapon || !!mkTarget.equip.armor
                                    || !!mkTarget.equip.plus_horse || !!mkTarget.equip.minus_horse
                                )
                                return (
                                    <>
                                        <button className="btn btn-skill"
                                            onClick={() => handleRespond(undefined, { action: 'moukui_draw' })}>
                                            摸一张牌
                                        </button>
                                        <button className="btn btn-skill" disabled={!mkHasCard}
                                            onClick={() => handleRespond(undefined, { action: 'moukui_discard' })}>
                                            弃目标一张牌{mkTarget ? `（${GENERAL_NAMES[mkTarget.generalId] ?? mkTarget.generalId}）` : ''}
                                        </button>
                                        <button className="btn"
                                            onClick={() => handleRespond(undefined, { action: 'decline' })}>放弃</button>
                                    </>
                                )
                            })() : activationTargetSelect || activationCardSelect ? (() => {
                                // 引擎在这条询问上声明了可提前选择的目标/手牌：选好后点“发动”一次提交
                                const skillLabel = (activationCtx?.skillName as string | undefined) ?? ''
                                const pickedTargets = activationTargetCandidates
                                    ? selectedTargets.filter((i) => activationTargetCandidates.includes(i))
                                    : selectedTargets
                                const enoughTargets = !activationTargetSelect || pickedTargets.length >= activationMinTargets
                                const enoughCards = !activationCardSelect || selectedCardIds.length >= activationMinCards
                                return (
                                    <>
                                        <span className="skill-confirm-label">
                                            {activationTargetSelect && `点击角色选择目标（${activationMinTargets}~${activationMaxTargets === Infinity ? '不限' : activationMaxTargets}名，已选${pickedTargets.length}名）`}
                                            {activationTargetSelect && activationCardSelect && '，'}
                                            {activationCardSelect && `选择手牌（${activationMinCards}~${activationMaxCards}张，已选${selectedCardIds.length}张）`}
                                        </span>
                                        <button className="btn btn-skill" disabled={!enoughTargets || !enoughCards}
                                            onClick={() => handleRespond(undefined, {
                                                action: 'confirm',
                                                ...(activationTargetSelect ? { targetIndices: pickedTargets } : {}),
                                                ...(activationCardSelect && selectedCardIds.length > 0 ? { cardIds: selectedCardIds } : {}),
                                            } as any)}>发动{skillLabel}</button>
                                        <button className="btn"
                                            onClick={() => handleRespond(undefined, { action: 'decline' })}>放弃</button>
                                    </>
                                )
                            })() : (
                                <>
                                    <button className="btn btn-skill"
                                        onClick={() => handleRespond(undefined, { action: 'confirm' })}>发动</button>
                                    <button className="btn"
                                        onClick={() => handleRespond(undefined, { action: 'decline' })}>放弃</button>
                                </>
                            )}
                        </>
                    )}
                    {/* 火攻：目标展示手牌 → 使用者弃同花色牌（缺了这块，人类响应时没有任何按钮可点） */}
                    {myPendingResponse && pendingResponse?.type === ResponseType.FIRE_ATTACK_SHOW && (() => {
                        const faCtx = pendingResponse.context as any
                        const hand = generals[pendingResponse.targetGeneralIndex]?.hand ?? []
                        const shownCard = faCtx.shownCard as Card | undefined
                        const isShow = faCtx.stage === 'show'
                        const picked = selectedCardIds.length === 1
                            ? hand.find((c) => c.id === selectedCardIds[0])
                            : undefined
                        // 展示阶段任意手牌都行；弃置阶段只能弃与展示牌同花色的手牌
                        const pickedOk = !!picked && (isShow || picked.suit === shownCard?.suit)
                        return (
                            <>
                                <span className="skill-confirm-label">
                                    {isShow
                                        ? '火攻：点击一张手牌后点“展示”'
                                        : `火攻：点击一张${shownCard ? getSuitSymbol(shownCard.suit) : ''}同花色手牌后点“弃置”，对目标造成1点火焰伤害`}
                                </span>
                                <button className="btn btn-skill" disabled={!pickedOk}
                                    onClick={() => { if (picked) handleRespond(picked.id) }}>
                                    {isShow ? '展示' : '弃置'}
                                    {picked && pickedOk ? ` ${getSuitSymbol(picked.suit)}${getValueStr(picked.value)}【${cardNameOf(picked.name)}】` : '所选手牌'}
                                </button>
                                {!isShow && (
                                    <button className="btn" onClick={() => handleRespond(undefined)}>放弃</button>
                                )}
                            </>
                        )
                    })()}
                    {/* 忠勇（周仓）：交牌 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_ZHONGYONG_GIVE && (() => {
                        const zy = pendingResponse.context as any
                        const hasTarget = selectedTargets.length > 0
                        return (
                            <>
                                <span className="skill-confirm-label">
                                    {zy.zhongyongAll
                                        ? '忠勇：点击一名其他角色，将【杀】与【闪】一并交给其'
                                        : '忠勇：点击一名其他角色，然后选择交给其的牌'}
                                </span>
                                {zy.zhongyongAll && (
                                    <button className="btn btn-skill" disabled={!hasTarget}
                                        onClick={() => emit.respond({ action: 'confirm', targetIndex: selectedTargets[0] } as any)}>
                                        交出其牌{zy.attackCardLabel ? `（${zy.attackCardLabel}）` : ''}
                                    </button>
                                )}
                                {!zy.zhongyongAll && zy.attackCardId && (
                                    <button className="btn btn-skill" disabled={!hasTarget}
                                        onClick={() => emit.respond({ action: 'give_slash', targetIndex: selectedTargets[0] } as any)}>
                                        交【杀】{zy.attackCardLabel ? `（${zy.attackCardLabel}）` : ''}
                                    </button>
                                )}
                                {!zy.zhongyongAll && (zy.dodgeCardIds?.length ?? 0) > 0 && (
                                    <button className="btn btn-skill" disabled={!hasTarget}
                                        onClick={() => emit.respond({ action: 'give_dodge', targetIndex: selectedTargets[0] } as any)}>
                                        交【闪】{zy.dodgeCardLabel ? `（${zy.dodgeCardLabel}）` : ''}
                                    </button>
                                )}
                                <button className="btn" onClick={() => handleRespond(undefined, { action: 'decline' })}>放弃</button>
                            </>
                        )
                    })()}
                    {/* 忠勇：受牌者视为使用【杀】 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_ZHONGYONG_SLASH && (
                        <>
                            <span className="skill-confirm-label">
                                忠勇：选一张【杀】并点击攻击范围内的目标
                            </span>
                            <button className="btn btn-skill" disabled={selectedCardIds.length === 0 || selectedTargets.length === 0}
                                onClick={() => handleRespond(selectedCardIds[0], { action: 'slash', targetIndex: selectedTargets[0] })}>
                                使用【杀】
                            </button>
                            <button className="btn" onClick={() => handleRespond(undefined, { action: 'decline' })}>放弃</button>
                        </>
                    )}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.JUDGE_INTERVENE && (() => {
                        const responderView = gameState.generals[pendingResponse.targetGeneralIndex]
                        const huanshiOwnerIndex = (pendingResponse.context as any)?.huanshiOwnerIndex as number | undefined
                        const huanshiOwner = huanshiOwnerIndex !== undefined
                            ? gameState.generals[huanshiOwnerIndex] : undefined
                        const isZhangjiao = responderView?.generalId === 'zhangjiao'
                        const isHuanshi = !!huanshiOwner
                        return (
                            <>
                                <span className="skill-confirm-label">
                                    {isHuanshi
                                        ? `缓释：从【${GENERAL_NAMES[huanshiOwner.generalId] ?? huanshiOwner.generalId}】的手牌中选择一张替换判定牌`
                                        : isZhangjiao
                                            ? '鬼道：选一张黑色牌替换判定牌（手牌或装备区）'
                                            : '修改判定：选一张手牌替换'}
                                </span>
                                {isHuanshi ? (
                                    <div className="trick-pick-grid">
                                        {(huanshiOwner.hand ?? []).map((card: Card) => (
                                            <button key={card.id} className="btn btn-skill"
                                                onClick={() => handleRespond(card.id)}>
                                                {getValueStr(card.value)}{getSuitSymbol(card.suit)} {cardNameOf(card.name)}
                                            </button>
                                        ))}
                                    </div>
                                ) : (
                                    <button className="btn btn-skill" disabled={selectedCardIds.length === 0}
                                        onClick={() => handleRespond(selectedCardIds[0])}>替换判定牌</button>
                                )}
                                <button className="btn" onClick={() => handleRespond(undefined)}>放弃</button>
                            </>
                        )
                    })()}
                    {/* 雷击（张角）：选判定目标 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_LEIJI_TARGET && (
                        <>
                            <span className="skill-confirm-label">
                                雷击：点击一名其他角色作为判定者；♠造成2点雷电伤害，♣回复1点体力并造成1点雷电伤害
                            </span>
                            {selectedTargets.length > 0 && (
                                <button className="btn btn-skill"
                                    onClick={() => handleRespond(undefined, { targetIndex: selectedTargets[0] })}>
                                    确认雷击（{GENERAL_NAMES[generals[selectedTargets[0]]?.generalId ?? ''] ?? `角色${selectedTargets[0]}`}）
                                </button>
                            )}
                            <button className="btn"
                                onClick={() => handleRespond(undefined, { action: 'decline' })}>放弃</button>
                        </>
                    )}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_FANJIAN_SUIT && (
                        <>
                            <span className="skill-confirm-label">猜花色：</span>
                            <button className="btn btn-suit suit-spade" onClick={() => handleRespond(undefined, { suit: 'spade' } as any)}>♠</button>
                            <button className="btn btn-suit suit-heart" onClick={() => handleRespond(undefined, { suit: 'heart' } as any)}>♥</button>
                            <button className="btn btn-suit suit-club" onClick={() => handleRespond(undefined, { suit: 'club' } as any)}>♣</button>
                            <button className="btn btn-suit suit-diamond" onClick={() => handleRespond(undefined, { suit: 'diamond' } as any)}>♦</button>
                        </>
                    )}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_QICE_PICK && (
                        <>
                            <span className="skill-confirm-label">奇策：选择视为使用的普通锦囊：</span>
                            <button className="btn btn-skill" onClick={() => handleRespond(undefined, { action: 'draw_two' } as any)}>无中生有</button>
                            <button className="btn btn-skill" onClick={() => handleRespond(undefined, { action: 'duel' } as any)}>决斗</button>
                            <button className="btn btn-skill" onClick={() => handleRespond(undefined, { action: 'dismantle' } as any)}>过河拆桥</button>
                            <button className="btn btn-skill" onClick={() => handleRespond(undefined, { action: 'steal' } as any)}>顺手牵羊</button>
                        </>
                    )}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_GANGLIE_CHOICE && (
                        <>
                            <span className="skill-confirm-label">刚烈发动，选择：</span>
                            <button className="btn btn-skill" disabled={selectedCardIds.length < 2}
                                onClick={() => handleRespond(undefined, { action: 'discard', cardIds: selectedCardIds.slice(0, 2) } as any)}>
                                弃2张牌
                            </button>
                            <button className="btn btn-danger"
                                onClick={() => handleRespond(undefined, { action: 'damage' } as any)}>受1伤</button>
                        </>
                    )}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_FANJIAN_CHOICE && (() => {
                        const fjSuit = (pendingResponse.context as any)?.fanjianSuit
                        const fjTarget = generals[pendingResponse.targetGeneralIndex]
                        const fjCount = fjTarget?.hand?.filter(c => c.suit === fjSuit).length ?? 0
                        return (
                            <>
                                <span className="skill-confirm-label">
                                    反间：弃置所有{(fjSuit === 'heart' || fjSuit === 'diamond') ? '红桃/方块' : '黑桃/梅花'}
                                    同花色手牌（当前{fjCount}张，至少两张），或失去1点体力：
                                </span>
                                <button className="btn btn-skill" disabled={fjCount < 2}
                                    onClick={() => handleRespond(undefined, { action: 'discard' } as any)}>
                                    展示并弃同花色牌
                                </button>
                                <button className="btn btn-danger"
                                    onClick={() => handleRespond(undefined, { action: 'loseHp' } as any)}>失去1点体力</button>
                            </>
                        )
                    })()}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_GANGLIE_TARGET && (
                        <>
                            <span className="skill-confirm-label">刚烈：选择一名敌方角色判定：</span>
                            {(((pendingResponse.context as any)?.candidateIndices as number[]) ?? []).map((idx: number) => (
                                <button key={idx} className="btn btn-skill"
                                    onClick={() => handleRespond(undefined, { targetIndex: idx } as any)}>
                                    {generals[idx] ? (GENERAL_NAMES[generals[idx].generalId] ?? generals[idx].generalId) : `角色${idx}`}
                                </button>
                            ))}
                            <button className="btn" onClick={() => handleRespond(undefined, { action: 'decline' } as any)}>放弃</button>
                        </>
                    )}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_DIANHU_TARGET && (
                        <>
                            <span className="skill-confirm-label">点虎：选择一名敌方角色获得“筹进”：</span>
                            {(((pendingResponse.context as any)?.candidateIndices as number[]) ?? []).map((idx: number) => (
                                <button key={idx} className="btn btn-skill"
                                    onClick={() => handleRespond(undefined, { targetIndex: idx } as any)}>
                                    {generals[idx] ? (GENERAL_NAMES[generals[idx].generalId] ?? generals[idx].generalId) : `角色${idx}`}
                                </button>
                            ))}
                        </>
                    )}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_SHUOMENG_TARGET && (
                        <>
                            <span className="skill-confirm-label">说盟：选择拼点对象</span>
                            {(((pendingResponse.context as any)?.candidateIndices as number[]) ?? []).map((idx: number) => (
                                <button key={idx} className="btn btn-skill"
                                    onClick={() => handleRespond(undefined, { targetIndex: idx } as any)}>
                                    {generals[idx] ? (GENERAL_NAMES[generals[idx].generalId] ?? generals[idx].generalId) : `角色${idx}`}
                                </button>
                            ))}
                            <button className="btn" onClick={() => handleRespond(undefined, { action: 'decline' } as any)}>放弃</button>
                        </>
                    )}
                    {/* 说盟：选择拼点手牌 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_SHUOMENG_CARD && (
                        <>
                            <span className="skill-confirm-label">说盟：选择一张手牌拼点（点击手牌后确认）</span>
                            <button className="btn btn-skill" disabled={selectedCardIds.length === 0}
                                onClick={() => handleRespond(selectedCardIds[0])}>确认拼点</button>
                        </>
                    )}
                    {/* 秘计：选交牌对象 → 选牌 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_MIJI_GIVE && (() => {
                        const mctx = pendingResponse.context as any
                        if (mctx?.phase === 'target') {
                            return (
                                <>
                                    <span className="skill-confirm-label">秘计：选择将 {mctx.count} 张手牌交给谁</span>
                                    {((mctx.candidateIndices as number[]) ?? []).map((idx: number) => (
                                        <button key={idx} className="btn btn-skill"
                                            onClick={() => handleRespond(undefined, { targetIndex: idx } as any)}>
                                            {generals[idx] ? (GENERAL_NAMES[generals[idx].generalId] ?? generals[idx].generalId) : `角色${idx}`}
                                        </button>
                                    ))}
                                    <button className="btn" onClick={() => handleRespond(undefined, { action: 'decline' } as any)}>放弃</button>
                                </>
                            )
                        }
                        const count = Math.max(0, mctx?.count ?? 0)
                        const receiver = mctx?.receiverIndex !== undefined ? generals[mctx.receiverIndex] : undefined
                        const receiverName = receiver ? (GENERAL_NAMES[receiver.generalId] ?? receiver.generalId) : '目标'
                        return (
                            <>
                                <span className="skill-confirm-label">
                                    秘计：选择 {count} 张手牌交给【{receiverName}】（已选 {selectedCardIds.length}/{count}）
                                </span>
                                <button className="btn btn-skill" disabled={selectedCardIds.length !== count}
                                    onClick={() => handleRespond(undefined, { cardIds: selectedCardIds } as any)}>确认交牌</button>
                                <button className="btn" onClick={() => handleRespond(undefined, { action: 'decline' } as any)}>放弃</button>
                            </>
                        )
                    })()}
                    {/* 奇制：选择弃牌目标 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_QIZHI_TARGET && (() => {
                        const candidates = ((pendingResponse.context as any)?.candidateIndices as number[]) ?? []
                        return (
                            <>
                                <span className="skill-confirm-label">奇制：选择弃置谁的一张牌</span>
                                {candidates.map((idx: number) => (
                                    <button key={idx} className="btn btn-skill"
                                        onClick={() => handleRespond(undefined, { targetIndex: idx } as any)}>
                                        {generals[idx] ? (GENERAL_NAMES[generals[idx].generalId] ?? generals[idx].generalId) : `角色${idx}`}
                                    </button>
                                ))}
                                <button className="btn" onClick={() => handleRespond(undefined, { action: 'decline' } as any)}>放弃</button>
                            </>
                        )
                    })()}
                    {/* 进趋：选择弃置的手牌 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_JINQU_DISCARD && (() => {
                        const count = Math.max(0, (pendingResponse.context as any)?.discardCount ?? 0)
                        return (
                            <>
                                <span className="skill-confirm-label">
                                    进趋：选择 {count} 张手牌弃置（已选 {selectedCardIds.length}/{count}）
                                </span>
                                <button className="btn btn-skill" disabled={selectedCardIds.length !== count}
                                    onClick={() => handleRespond(undefined, { cardIds: selectedCardIds } as any)}>确认弃牌</button>
                            </>
                        )
                    })()}
                    {/* 独锋：失去体力或废除装备栏 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_DUFENG_CHOICE && (() => {
                        const slots = ((pendingResponse.context as any)?.candidateSlots as string[]) ?? []
                        const slotNames: Record<string, string> = {
                            weapon: '武器栏', armor: '防具栏', plus_horse: '+1马栏', minus_horse: '-1马栏',
                        }
                        return (
                            <>
                                <span className="skill-confirm-label">独锋：选择一项</span>
                                <button className="btn btn-danger"
                                    onClick={() => handleRespond(undefined, { action: 'loseHp' } as any)}>失去1点体力</button>
                                {slots.map(s => (
                                    <button key={s} className="btn btn-skill"
                                        onClick={() => handleRespond(undefined, { action: 'abolish', slot: s } as any)}>
                                        废除{slotNames[s] ?? s}
                                    </button>
                                ))}
                            </>
                        )
                    })()}
                    {/* 通用：技能选择目标（谦雅 / 旋风 / 弘援） */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_CHOOSE_TARGET && (() => {
                        const ctx = pendingResponse.context as any
                        const candidates = (ctx?.candidateIndices as number[]) ?? []
                        const multi = !!ctx?.multi
                        return (
                            <>
                                <span className="skill-confirm-label">
                                    {ctx?.skillName}：{ctx?.description ?? '选择目标'}
                                </span>
                                {candidates.map((idx: number) => {
                                    const name = generals[idx]
                                        ? (GENERAL_NAMES[generals[idx].generalId] ?? generals[idx].generalId)
                                        : `角色${idx}`
                                    const picked = selectedTargets.includes(idx)
                                    return (
                                        <button key={idx} className={`btn btn-skill ${picked ? 'selected' : ''}`}
                                            onClick={() => {
                                                if (!multi) {
                                                    emit.respond({ targetIndex: idx } as any)
                                                    return
                                                }
                                                toggleTargetSelection(idx)
                                            }}>
                                            {name}
                                        </button>
                                    )
                                })}
                                {multi && (
                                    <button className="btn btn-skill"
                                        disabled={selectedTargets.length === 0 || selectedTargets.length > 2}
                                        onClick={() => emit.respond({ targetIndices: selectedTargets.slice(0, 2) } as any)}>
                                        确认（已选 {selectedTargets.length}/2）
                                    </button>
                                )}
                                {!ctx?.mandatory && (
                                    <button className="btn"
                                        onClick={() => handleRespond(undefined, { action: 'decline' } as any)}>放弃</button>
                                )}
                            </>
                        )
                    })()}
                    {/* 通用：选择交给指定角色的手牌 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_GIVE_CARDS && (() => {
                        const gctx = pendingResponse.context as any
                        const receiver = gctx?.toIndex !== undefined ? generals[gctx.toIndex] : undefined
                        const receiverName = receiver
                            ? (GENERAL_NAMES[receiver.generalId] ?? receiver.generalId)
                            : '目标'
                        const need = Math.max(0, gctx?.count ?? 0)
                        return (
                            <>
                                <span className="skill-confirm-label">
                                    {gctx?.skillName}：选择{need > 0 ? ` ${need} ` : '任意'}张手牌交给【{receiverName}】（已选 {selectedCardIds.length}）
                                </span>
                                <button className="btn btn-skill"
                                    disabled={selectedCardIds.length === 0 || (need > 0 && selectedCardIds.length !== need)}
                                    onClick={() => handleRespond(undefined, { cardIds: selectedCardIds } as any)}>确认交牌</button>
                                {!gctx?.mandatory && (
                                    <button className="btn"
                                        onClick={() => handleRespond(undefined, { action: 'decline' } as any)}>放弃</button>
                                )}
                            </>
                        )
                    })()}
                    {/* 通用：选择自己的一张牌 */}
                    {/* 纵玄（界虞翻）：把因弃置进入弃牌堆的牌置于牌堆顶 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_PICK_CARD
                        && ['yufan_zongxuan', 'yufan_jie_zongxuan'].includes((pendingResponse.context as any)?.skillId) && (() => {
                        const ids: string[] = (pendingResponse.context as any)?.candidateCardIds ?? []
                        const choices = discardPile.filter((c: Card) => ids.includes(c.id))
                        const toggle = (id: string) => setZongxuanPicked((prev) => prev.includes(id)
                            ? prev.filter((x) => x !== id)
                            : [...prev, id])
                        return (
                            <>
                                <span className="skill-confirm-label">
                                    纵玄：选择置于牌堆顶的牌（已选 {zongxuanPicked.length} 张）
                                </span>
                                {choices.map((card: Card) => (
                                    <button key={card.id}
                                        className={`btn ${zongxuanPicked.includes(card.id) ? 'btn-skill' : 'btn-secondary'}`}
                                        style={{ margin: '2px', fontSize: '12px' }}
                                        onClick={() => toggle(card.id)}>
                                        {getValueStr(card.value)}{getSuitSymbol(card.suit)} {cardNameOf(card.name)}
                                    </button>
                                ))}
                                <button className="btn btn-skill" disabled={zongxuanPicked.length === 0}
                                    onClick={() => {
                                        handleRespond(undefined, { cardIds: zongxuanPicked } as any)
                                        setZongxuanPicked([])
                                    }}>
                                    置于牌堆顶
                                </button>
                                <button className="btn" onClick={() => {
                                    setZongxuanPicked([])
                                    handleRespond(undefined, { action: 'decline' } as any)
                                }}>放弃</button>
                            </>
                        )
                    })()}
                    {/* 眩惑（法正）：同阵营手牌可见，直接挑选获得的牌 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_PICK_CARD
                        && (pendingResponse.context as any)?.skillId === 'fazheng_xuanhuo_gain' && (() => {
                        const ctx = pendingResponse.context as any
                        const from = generals[ctx.xuanhuoFromIndex as number]
                        const ids: string[] = ctx.candidateCardIds ?? []
                        const fromCards = [
                            ...(from?.hand ?? []),
                            ...Object.values(from?.equip ?? {}).filter(Boolean),
                        ] as Card[]
                        const visible = fromCards.filter((c) => ids.includes(c.id))
                        const need = Math.max(1, ctx.count ?? 1)
                        const toggle = (id: string) => setXuanhuoPicked((prev) => prev.includes(id)
                            ? prev.filter((x) => x !== id)
                            : (prev.length >= need ? prev : [...prev, id]))
                        return (
                            <>
                                <span className="skill-confirm-label">
                                    眩惑：从【{from ? (GENERAL_NAMES[from.generalId] ?? from.generalId) : '?'}】处选择至多 {need} 张牌获得（已选 {xuanhuoPicked.length} 张）
                                </span>
                                {visible.map((card: Card) => (
                                    <button key={card.id}
                                        className={`btn ${xuanhuoPicked.includes(card.id) ? 'btn-skill' : 'btn-secondary'}`}
                                        style={{ margin: '2px', fontSize: '12px' }}
                                        onClick={() => toggle(card.id)}>
                                        {getValueStr(card.value)}{getSuitSymbol(card.suit)} {cardNameOf(card.name)}
                                    </button>
                                ))}
                                <button className="btn btn-skill" disabled={xuanhuoPicked.length === 0}
                                    onClick={() => {
                                        handleRespond(undefined, { cardIds: xuanhuoPicked.slice(0, need) } as any)
                                        setXuanhuoPicked([])
                                    }}>
                                    确认获得
                                </button>
                                <button className="btn" onClick={() => {
                                    setXuanhuoPicked([])
                                    handleRespond(undefined, { action: 'decline' } as any)
                                }}>放弃</button>
                            </>
                        )
                    })()}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_PICK_CARD
                        && (pendingResponse.context as any)?.skillId !== 'fazheng_xuanhuo_gain'
                        && !['yufan_zongxuan', 'yufan_jie_zongxuan'].includes((pendingResponse.context as any)?.skillId) && (() => {
                        const pctx = pendingResponse.context as any
                        const need = Math.max(1, pctx?.count ?? 1)
                        const minNeed = Math.max(1, Math.min(need, Number(pctx?.minCount ?? 1)))
                        const candidates: string[] = pctx?.candidateCardIds ?? []
                        const picker = gameState.generals[pendingResponse.targetGeneralIndex]
                        const equipSlots = ['weapon', 'armor', 'plus_horse', 'minus_horse'] as const
                        const equipChoices = pctx?.allowEquip
                            ? equipSlots.map(slot => ({ slot, card: picker?.equip?.[slot] })).filter(e => !!e.card)
                            : []
                        const equipPickedIds = equipChoices
                            .filter(e => selectedEquipSlots.includes(e.slot))
                            .map(e => e.card!.id)
                        const picked = [
                            ...(candidates.length > 0
                                ? selectedCardIds.filter((id: string) => candidates.includes(id))
                                : selectedCardIds),
                            ...equipPickedIds,
                        ]
                        const countOk = pctx?.exactCount
                            ? picked.length === need
                            : picked.length >= minNeed && picked.length <= need
                        return (
                            <>
                                <span className="skill-confirm-label">
                                    {pctx?.skillName}：{pctx?.description ?? '选择一张牌'}
                                    {(pctx?.exactCount || minNeed > 1)
                                        ? `（${pctx?.exactCount ? `需选 ${need} 张` : `至少 ${minNeed} 张，至多 ${need} 张`}，已选 ${picked.length}）`
                                        : (need > 1
                                            ? `（至多 ${need} 张，已选 ${picked.length}）`
                                            : (candidates.length > 0 && !pctx?.allowEquip ? '（点击手牌后确认）' : '（点击手牌或装备后确认）'))}
                                </span>
                                {equipChoices.map(({ slot, card }) => (
                                    <button key={slot}
                                        className={`btn ${selectedEquipSlots.includes(slot) ? 'btn-skill' : 'btn-secondary'}`}
                                        onClick={() => setSelectedEquipSlots(prev =>
                                            prev.includes(slot) ? prev.filter(s => s !== slot) : [...prev, slot])}>
                                        装备：{cardNameOf(card!.name)}
                                    </button>
                                ))}
                                <button className="btn btn-skill" disabled={!countOk}
                                    onClick={() => {
                                        handleRespond(undefined, { cardIds: picked.slice(0, need) } as any)
                                        setSelectedEquipSlots([])
                                    }}>确认</button>
                                <button className="btn"
                                    onClick={() => handleRespond(undefined, { action: 'decline' } as any)}>放弃</button>
                            </>
                        )
                    })()}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_QIANXI_PICK && (() => {
                        return (
                            <>
                                <span className="skill-confirm-label">
                                    潜袭：选择1张手牌展示（已选{selectedCardIds.length}张）
                                </span>
                                <button className="btn btn-skill" disabled={selectedCardIds.length !== 1}
                                    onClick={() => handleRespond(undefined, { cardIds: selectedCardIds.slice(0, 1) } as any)}>展示</button>
                                <button className="btn" onClick={() => handleRespond(undefined, { cardId: 'decline' } as any)}>放弃</button>
                            </>
                        )
                    })()}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_YIJI_DISTRIBUTE && (() => {
                        const remaining = (pendingResponse.context as any)?.remaining ?? 0
                        const yijiCardIds = (pendingResponse.context as any)?.yijiCardIds as string[] ?? []
                        // 只允许选择遗计可分配的手牌
                        const validSelected = selectedCardIds.filter(id => yijiCardIds.includes(id))
                        return (
                            <>
                                <span className="skill-confirm-label">
                                    遗计：选择手牌分给一名角色（剩余{remaining}张，已选{validSelected.length}张）
                                </span>
                                <button className="btn btn-skill"
                                    disabled={validSelected.length === 0 || selectedTargets.length === 0}
                                    onClick={() => emit.respond({
                                        cardIds: validSelected,
                                        targetIndex: selectedTargets[0],
                                    } as any)}>
                                    分配{validSelected.length}张给选定角色
                                </button>
                                <button className="btn"
                                    onClick={() => handleRespond(undefined)}>跳过（保留剩余牌）</button>
                            </>
                        )
                    })()}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_LUANWU_PICK_TARGET && (
                        <>
                            <span className="skill-confirm-label">选择杀的目标：</span>
                            {((pendingResponse.context as any)?.candidateIndices as number[] || []).map((idx: number) => (
                                <button key={idx} className="btn btn-skill"
                                    onClick={() => handleRespond(undefined, { targetIndex: idx } as any)}>
                                    {generals[idx] ? (GENERAL_NAMES[generals[idx].generalId] ?? generals[idx].generalId) : `角色${idx}`}
                                </button>
                            ))}
                        </>
                    )}
                    {/* 乱武②（界贾诩）：结算结束后视为使用一张无距离限制的【杀】 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_LUANWU_EXTRA_SLASH && (
                        <>
                            <span className="skill-confirm-label">乱武：视为使用一张无距离限制的【杀】，选择目标</span>
                            {((pendingResponse.context as any)?.candidateIndices as number[] || []).map((idx: number) => (
                                <button key={idx} className="btn btn-skill"
                                    onClick={() => handleRespond(undefined, { targetIndex: idx } as any)}>
                                    {generals[idx] ? (GENERAL_NAMES[generals[idx].generalId] ?? generals[idx].generalId) : `角色${idx}`}
                                </button>
                            ))}
                            <button className="btn btn-secondary"
                                onClick={() => handleRespond(undefined, { action: 'decline' } as any)}>
                                放弃
                            </button>
                        </>
                    )}
                    {/* 五谷丰登选牌 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.HARVEST_PICK && (
                        <>
                            <span className="skill-confirm-label">从五谷丰登中选一张牌：</span>
                            <div className="harvest-pool">
                                {(gameState.harvestPool ?? []).map(card => (
                                    <PlayingCard key={card.id} card={card} selected={false}
                                        onClick={() => handleRespond(card.id)}
                                        onTooltipEnter={(e) => { const c = cardTooltipContent(card.name); if (c) tooltipEnter(e, c) }}
                                        onTooltipMove={tooltipMove}
                                        onTooltipLeave={tooltipLeave}
                                    />
                                ))}
                            </div>
                        </>
                    )}
                    {/* 无懈可击已迁移到独立面板 */}
                    {/* 借刀杀人：出杀或交武器 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.BORROW_SWORD_RESPONSE && (
                        <>
                            <span className="skill-confirm-label">借刀杀人：出杀或交出武器</span>
                            <button className="btn btn-skill" disabled={selectedCardIds.length === 0}
                                onClick={() => handleRespond(selectedCardIds[0])}>
                                出杀
                            </button>
                            <button className="btn btn-secondary"
                                onClick={() => handleRespond(undefined)}>
                                交出武器
                            </button>
                        </>
                    )}
                    {/* 突袭：选角色 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_TUXI_CHOOSE && (() => {
                        const remaining = (pendingResponse.context as any)?.remainingPicks ?? 2
                        return (
                            <>
                                <span className="skill-confirm-label">
                                    突袭：选择至多{remaining}名有手牌的角色（已选{selectedTargets.length}名）
                                </span>
                                {selectedTargets.length > 0 && (
                                    <button className="btn btn-skill"
                                        onClick={() => emit.respond({ targetIndices: selectedTargets } as any)}>
                                        确认突袭（{selectedTargets.length}名）
                                    </button>
                                )}
                                <button className="btn" onClick={() => handleRespond(undefined)}>结束突袭</button>
                            </>
                        )
                    })()}
                    {/* 神速：选目标 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_SHENSU_TARGET && (
                        <>
                            <span className="skill-confirm-label">神速：选择杀的目标（点击角色区域）</span>
                            {selectedTargets.length > 0 && (
                                <button className="btn btn-skill"
                                    onClick={() => emit.respond({ targetIndex: selectedTargets[0] } as any)}>
                                    确认
                                </button>
                            )}
                        </>
                    )}
                    {/* 神速二：选弃装备 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_SHENSU_EQUIP && (() => {
                        const myGen = gameState.generals[pendingResponse.targetGeneralIndex]
                        return (
                            <>
                                <span className="skill-confirm-label">神速二：选择弃一张装备牌（已装备或手牌）</span>
                                {myGen?.equip?.weapon && (
                                    <button className="btn btn-skill" onClick={() => emit.respond({ action: 'weapon' } as any)}>武器</button>
                                )}
                                {myGen?.equip?.armor && (
                                    <button className="btn btn-skill" onClick={() => emit.respond({ action: 'armor' } as any)}>防具</button>
                                )}
                                {myGen?.equip?.plus_horse && (
                                    <button className="btn btn-skill" onClick={() => emit.respond({ action: 'plus_horse' } as any)}>+1马</button>
                                )}
                                {myGen?.equip?.minus_horse && (
                                    <button className="btn btn-skill" onClick={() => emit.respond({ action: 'minus_horse' } as any)}>-1马</button>
                                )}
                                <button className="btn btn-secondary"
                                    disabled={selectedCardIds.length === 0}
                                    onClick={() => emit.respond({ cardId: selectedCardIds[0] } as any)}>
                                    弃选中的手牌装备
                                </button>
                            </>
                        )
                    })()}
                    {/* 英魂弃牌：选手牌/装备 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_YINGHUN_DISCARD && (() => {
                        const ctx = pendingResponse.context as any
                        const discardCount = ctx.discardCount ?? 1
                        const myGen = gameState.generals[pendingResponse.targetGeneralIndex]
                        const totalSelected = selectedCardIds.length + selectedEquipSlots.length
                        const toggleEquip = (slot: string) => {
                            setSelectedEquipSlots(prev =>
                                prev.includes(slot) ? prev.filter(s => s !== slot) : [...prev, slot]
                            )
                        }
                        return (
                            <>
                                <span className="skill-confirm-label">英魂弃牌：选{discardCount}张（已选{totalSelected}）</span>
                                {myGen?.equip?.weapon && (
                                    <button className={`btn ${selectedEquipSlots.includes('weapon') ? 'btn-skill' : 'btn-secondary'}`}
                                        onClick={() => toggleEquip('weapon')}>武器</button>
                                )}
                                {myGen?.equip?.armor && (
                                    <button className={`btn ${selectedEquipSlots.includes('armor') ? 'btn-skill' : 'btn-secondary'}`}
                                        onClick={() => toggleEquip('armor')}>防具</button>
                                )}
                                {myGen?.equip?.plus_horse && (
                                    <button className={`btn ${selectedEquipSlots.includes('plus_horse') ? 'btn-skill' : 'btn-secondary'}`}
                                        onClick={() => toggleEquip('plus_horse')}>+1马</button>
                                )}
                                {myGen?.equip?.minus_horse && (
                                    <button className={`btn ${selectedEquipSlots.includes('minus_horse') ? 'btn-skill' : 'btn-secondary'}`}
                                        onClick={() => toggleEquip('minus_horse')}>-1马</button>
                                )}
                                <button className="btn btn-skill" disabled={totalSelected !== discardCount}
                                    onClick={() => {
                                        emit.respond({ cardIds: selectedCardIds, equipSlots: selectedEquipSlots } as any)
                                        setSelectedEquipSlots([])
                                    }}>
                                    确认弃牌
                                </button>
                            </>
                        )
                    })()}
                    {/* 反馈 / 利驭：选来源的牌 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_FANKUI_PICK && (() => {
                        const ctx = pendingResponse.context as any
                        const src = gameState.generals[ctx.sourceGeneralIndex]
                        const liyu = !!ctx.liyu
                        return (
                            <>
                                <span className="skill-confirm-label">{liyu ? '利驭' : '反馈'}：选择获取来源的一张牌</span>
                                {src && (src.handCount ?? 0) > 0 && (
                                    <button className="btn btn-secondary" onClick={() => {
                                        // 随机选一张手牌ID（客户端不知道具体哪张）
                                        emit.respond({ cardId: '__random_hand__' } as any)
                                    }}>手牌(随机{src.handCount ?? '?'}张)</button>
                                )}
                                {src?.equip?.weapon && (
                                    <button className="btn btn-skill" onClick={() => emit.respond({ cardId: src.equip.weapon!.id } as any)}>武器</button>
                                )}
                                {src?.equip?.armor && (
                                    <button className="btn btn-skill" onClick={() => emit.respond({ cardId: src.equip.armor!.id } as any)}>防具</button>
                                )}
                                {src?.equip?.plus_horse && (
                                    <button className="btn btn-skill" onClick={() => emit.respond({ cardId: src.equip.plus_horse!.id } as any)}>+1马</button>
                                )}
                                {src?.equip?.minus_horse && (
                                    <button className="btn btn-skill" onClick={() => emit.respond({ cardId: src.equip.minus_horse!.id } as any)}>-1马</button>
                                )}
                                {liyu && (src?.judgeZone ?? []).map((c: any) => (
                                    <button key={c.id} className="btn btn-skill"
                                        onClick={() => emit.respond({ cardId: c.id } as any)}>
                                        判定区·{cardNameOf(c.name)}
                                    </button>
                                ))}
                            </>
                        )
                    })()}
                    {/* 尚义：观看目标手牌并选一张获得 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_SHANGYI_PICK && (() => {
                        const ctx = pendingResponse.context as any
                        const cards = (ctx.shangyiCards ?? []) as any[]
                        return (
                            <>
                                <span className="skill-confirm-label">尚义：选择获得目标的一张手牌</span>
                                {cards.map((c: any) => (
                                    <button key={c.id} className="btn btn-skill"
                                        onClick={() => emit.respond({ cardId: c.id } as any)}>
                                        {cardNameOf(c.name)}
                                    </button>
                                ))}
                            </>
                        )
                    })()}
                    {/* 观星/罪论：独立图层排列牌堆顶/底，拖拽调整顺序 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_GUANXING_ARRANGE && (() => {
                        const ctx = pendingResponse.context as any
                        const allCards = (ctx.guanxingCards ?? []) as any[]
                        const allCardIds = allCards.map((c: any) => c.id)
                        // 初始化：如果 guanxingTop/Bottom 为空或包含上一轮的旧 ID，重新初始化
                        const allAssigned = [...guanxingTop, ...guanxingBottom]
                        const hasStaleIds = allAssigned.length > 0 && !allAssigned.every(id => allCardIds.includes(id))
                        if (hasStaleIds || (allAssigned.length === 0 && allCards.length > 0)) {
                            // 延迟设置以避免渲染中 setState
                            setTimeout(() => {
                                setGuanxingTop(allCardIds)
                                setGuanxingBottom([])
                            }, 0)
                        }
                        const suitSym = (s: string) => ({ heart: '♥', diamond: '♦', spade: '♠', club: '♣' }[s] ?? s)
                        const cardText = (id: string) => {
                            const c = allCards.find((x: any) => x.id === id)
                            if (!c) return id
                            return `${suitSym(c.suit)}${getValueStr(c.value)} ${cardNameOf(c.name)}`
                        }
                        const moveCard = (id: string, target: 'top' | 'bottom', index: number) => {
                            const fromIdx = (target === 'top' ? guanxingTop : guanxingBottom).indexOf(id)
                            const top = guanxingTop.filter(x => x !== id)
                            const bottom = guanxingBottom.filter(x => x !== id)
                            const list = target === 'top' ? top : bottom
                            let at = index
                            if (fromIdx !== -1 && fromIdx < index) at -= 1
                            at = Math.max(0, Math.min(at, list.length))
                            list.splice(at, 0, id)
                            setGuanxingTop(top)
                            setGuanxingBottom(bottom)
                        }
                        const dropOn = (target: 'top' | 'bottom') => ({
                            onDragOver: (e: React.DragEvent) => e.preventDefault(),
                            onDrop: (e: React.DragEvent) => {
                                e.preventDefault()
                                if (arrangeDragId) {
                                    moveCard(arrangeDragId, target, target === 'top' ? guanxingTop.length : guanxingBottom.length)
                                }
                                setArrangeDragId(null)
                            },
                        })
                        const total = guanxingTop.length + guanxingBottom.length
                        const allPlaced = total === allCards.length && allCards.length > 0
                        const topLabel = (ctx.guanxingTopLabel as string | undefined) ?? '牌堆顶（先摸到）'
                        const bottomLabel = (ctx.guanxingBottomLabel as string | undefined) ?? '牌堆底'
                        const title = ctx.mode === 'zuilun' ? '罪论 — 排列观看的牌' : '观星 — 排列牌堆顶/底'
                        const column = (target: 'top' | 'bottom', label: string) => {
                            const list = target === 'top' ? guanxingTop : guanxingBottom
                            return (
                                <div className={`arrange-col ${target}`} {...dropOn(target)}>
                                    <div className="arrange-col-head">{label}</div>
                                    {list.map((id, idx) => (
                                        <div key={id} draggable
                                            className={`arrange-card ${arrangeDragId === id ? 'dragging' : ''}`}
                                            onDragStart={() => setArrangeDragId(id)}
                                            onDragEnd={() => setArrangeDragId(null)}
                                            onDragOver={(e) => e.preventDefault()}
                                            onDrop={(e) => {
                                                e.preventDefault()
                                                e.stopPropagation()
                                                if (arrangeDragId) moveCard(arrangeDragId, target, idx)
                                                setArrangeDragId(null)
                                            }}>
                                            <span className="arrange-card-index">{idx + 1}</span>
                                            <span className="arrange-card-text">{cardText(id)}</span>
                                            <button className="btn btn-secondary" style={{ fontSize: '11px', padding: '1px 6px' }}
                                                onClick={() => moveCard(id, target === 'top' ? 'bottom' : 'top',
                                                    target === 'top' ? guanxingBottom.length : guanxingTop.length)}>
                                                {target === 'top' ? '→底' : '→顶'}
                                            </button>
                                        </div>
                                    ))}
                                    {list.length === 0 && (
                                        <div className="arrange-drop-hint">
                                            {target === 'top' ? '拖到这里即置于牌堆顶' : '拖到这里即置于牌堆底'}
                                        </div>
                                    )}
                                </div>
                            )
                        }
                        return (
                            <div className="arrange-overlay">
                                <div className="arrange-board"
                                    style={{ transform: `translate(${arrangeOffset.x}px, ${arrangeOffset.y}px)` }}>
                                    <div className="arrange-title"
                                        title="按住标题可拖动面板"
                                        onMouseDown={(e) => {
                                            const startX = e.clientX
                                            const startY = e.clientY
                                            const base = { ...arrangeOffset }
                                            const onMove = (ev: MouseEvent) => setArrangeOffset({
                                                x: base.x + ev.clientX - startX,
                                                y: base.y + ev.clientY - startY,
                                            })
                                            const onUp = () => {
                                                document.removeEventListener('mousemove', onMove)
                                                document.removeEventListener('mouseup', onUp)
                                            }
                                            document.addEventListener('mousemove', onMove)
                                            document.addEventListener('mouseup', onUp)
                                        }}>
                                        {title}（拖动排序，按住标题可移动面板）
                                    </div>
                                    <div className="arrange-cols">
                                        {column('top', topLabel)}
                                        {column('bottom', bottomLabel)}
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
                                        <button className="btn btn-skill" disabled={!allPlaced}
                                            onClick={() => {
                                                emit.respond({ topCardIds: guanxingTop, bottomCardIds: guanxingBottom } as any)
                                                setGuanxingTop([])
                                                setGuanxingBottom([])
                                            }}>
                                            确认排列
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )
                    })()}
                    {/* 英魂：选目标+模式 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_YINGHUN_CHOOSE && (() => {
                        const ctx = pendingResponse.context as any
                        const lostHp = ctx.lostHp || 1
                        const others = generals.filter((g, idx) => g.alive && idx !== pendingResponse.targetGeneralIndex)
                        const picked = yinghunTarget !== null ? generals[yinghunTarget] : undefined
                        const pickedName = picked ? (GENERAL_NAMES[picked.generalId] ?? picked.generalId) : ''
                        const finish = (action: 'modeA' | 'modeB' | 'skip', targetIndex?: number) => {
                            setYinghunTarget(null)
                            emit.respond({ action, ...(targetIndex !== undefined ? { targetIndex } : {}) } as any)
                        }
                        return (
                            <div style={{ background: 'rgba(0,0,0,0.85)', padding: '12px', borderRadius: '8px', marginBottom: '8px' }}>
                                <div style={{ fontWeight: 'bold', marginBottom: '8px', color: '#ffd700' }}>
                                    英魂 — 已损失体力 X={lostHp}
                                </div>
                                {yinghunTarget === null ? (
                                    <>
                                        <div style={{ color: '#eee', marginBottom: '6px', fontSize: '12px' }}>
                                            第一步：选择一名其他角色
                                        </div>
                                        {others.map(g => {
                                            const gIdx = generals.indexOf(g)
                                            return (
                                                <button key={gIdx} className="btn btn-skill"
                                                    style={{ margin: '2px', fontSize: '12px' }}
                                                    onClick={() => setYinghunTarget(gIdx)}>
                                                    {GENERAL_NAMES[g.generalId] ?? g.generalId}
                                                </button>
                                            )
                                        })}
                                    </>
                                ) : (
                                    <>
                                        <div style={{ color: '#eee', marginBottom: '6px', fontSize: '12px' }}>
                                            第二步：选择【{pickedName}】执行的效果
                                        </div>
                                        <button className="btn btn-skill" style={{ margin: '2px', fontSize: '12px' }}
                                            onClick={() => finish('modeA', yinghunTarget)}>
                                            令其摸{lostHp}张，然后弃1张
                                        </button>
                                        <button className="btn btn-secondary" style={{ margin: '2px', fontSize: '12px' }}
                                            onClick={() => finish('modeB', yinghunTarget)}>
                                            令其摸1张，然后弃{lostHp}张
                                        </button>
                                        <button className="btn" style={{ margin: '2px', fontSize: '12px' }}
                                            onClick={() => setYinghunTarget(null)}>返回</button>
                                    </>
                                )}
                                <button className="btn" style={{ marginTop: '6px' }}
                                    onClick={() => finish('skip')}>放弃</button>
                            </div>
                        )
                    })()}
                    {/* 天香：选转移目标 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_TIANXIANG_CHOOSE && (() => {
                        const others = generals.filter((g, idx) => g.alive && idx !== pendingResponse.targetGeneralIndex)
                        return (
                            <div style={{ background: 'rgba(0,0,0,0.85)', padding: '12px', borderRadius: '8px', marginBottom: '8px' }}>
                                <div style={{ fontWeight: 'bold', marginBottom: '8px', color: '#ff69b4' }}>天香 — 选择转移伤害的目标</div>
                                {others.map(g => {
                                    const gIdx = generals.indexOf(g)
                                    return (
                                        <button key={gIdx} className="btn btn-skill" style={{ margin: '2px', fontSize: '12px' }}
                                            onClick={() => emit.respond({ targetIndex: gIdx } as any)}>
                                            {GENERAL_NAMES[g.generalId] ?? g.generalId}
                                        </button>
                                    )
                                })}
                            </div>
                        )
                    })()}
                    {/* 天香（洛书版）：选择后续效果 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_TIANXIANG_LUOSHU_OPTION && (() => {
                        const ctx = pendingResponse.context as any
                        const chosen = generals[ctx.chosenIndex as number]
                        const chosenName = chosen ? (GENERAL_NAMES[chosen.generalId] ?? chosen.generalId) : '目标'
                        return (
                            <div style={{ background: 'rgba(0,0,0,0.85)', padding: '12px', borderRadius: '8px', marginBottom: '8px' }}>
                                <div style={{ fontWeight: 'bold', marginBottom: '8px', color: '#ff69b4' }}>天香 — 对{chosenName}选择后续效果</div>
                                <button className="btn btn-skill" style={{ margin: '2px', fontSize: '12px' }}
                                    onClick={() => emit.respond({ action: 'damage' } as any)}>
                                    受到伤害来源的1点伤害，然后摸X张牌
                                </button>
                                <button className="btn btn-skill" style={{ margin: '2px', fontSize: '12px' }}
                                    onClick={() => emit.respond({ action: 'lose' } as any)}>
                                    失去1点体力，然后获得该牌
                                </button>
                            </div>
                        )
                    })()}
                    {/* 狂骨：回复体力或摸牌 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_KUANGGU_CHOICE && (
                        <div style={{ background: 'rgba(0,0,0,0.85)', padding: '12px', borderRadius: '8px', marginBottom: '8px' }}>
                            <div style={{ fontWeight: 'bold', marginBottom: '8px', color: '#7fffd4' }}>狂骨 — 选择一项</div>
                            <button className="btn btn-skill" style={{ margin: '2px', fontSize: '12px' }}
                                onClick={() => emit.respond({ action: 'heal' } as any)}>回复1点体力</button>
                            <button className="btn btn-skill" style={{ margin: '2px', fontSize: '12px' }}
                                onClick={() => emit.respond({ action: 'draw' } as any)}>摸一张牌</button>
                            <button className="btn" style={{ margin: '2px', fontSize: '12px' }}
                                onClick={() => emit.respond({ action: 'decline' } as any)}>放弃</button>
                        </div>
                    )}
                    {/* 奇谋：选择失去的体力数 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_QIMOU_HP && (() => {
                        const maxLoss = (pendingResponse.context as any)?.maxHpLoss as number ?? 1
                        return (
                            <div style={{ background: 'rgba(0,0,0,0.85)', padding: '12px', borderRadius: '8px', marginBottom: '8px' }}>
                                <div style={{ fontWeight: 'bold', marginBottom: '8px', color: '#ffa07a' }}>奇谋 — 选择失去的体力数</div>
                                {Array.from({ length: maxLoss }, (_, i) => i + 1).map(x => (
                                    <button key={x} className="btn btn-skill" style={{ margin: '2px', fontSize: '12px' }}
                                        onClick={() => emit.respond({ amount: x } as any)}>
                                        失去{x}点（距离-{x}，杀上限+{x}）
                                    </button>
                                ))}
                            </div>
                        )
                    })()}
                    {/* 流离：选转移目标 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.SKILL_LIULI_REDIRECT && (() => {
                        const ctx = pendingResponse.context as any
                        const candidateIndices = ctx.candidateIndices as number[] || []
                        return (
                            <div style={{ background: 'rgba(0,0,0,0.85)', padding: '12px', borderRadius: '8px', marginBottom: '8px' }}>
                                <div style={{ fontWeight: 'bold', marginBottom: '8px', color: '#87ceeb' }}>流离 — 选择杀的转移目标</div>
                                {candidateIndices.map((idx: number) => {
                                    const g = generals[idx]
                                    if (!g) return null
                                    return (
                                        <button key={idx} className="btn btn-skill" style={{ margin: '2px', fontSize: '12px' }}
                                            onClick={() => emit.respond({ targetIndex: idx } as any)}>
                                            {GENERAL_NAMES[g.generalId] ?? g.generalId}
                                        </button>
                                    )
                                })}
                            </div>
                        )
                    })()}
                    {/* 过河拆桥/顺手牵羊：选目标的牌 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.TRICK_TARGET_CARD_PICK && (() => {
                        const ctx = pendingResponse.context as any
                        const pickTarget = gameState.generals[ctx.targetIndex]
                        const trickLabel = ctx.trickType === 'dismantle' ? '过河拆桥' : '顺手牵羊'
                        const actionLabel = ctx.trickType === 'dismantle' ? '弃' : '拿'
                        const handLen = pickTarget?.hand?.length ?? pickTarget?.handCount ?? 0
                        return (
                            <>
                                <span className="skill-confirm-label">{trickLabel}：选择{actionLabel}目标的哪张牌</span>
                                <div className="trick-pick-grid">
                                    {pickTarget && handLen > 0 && (
                                        pickTarget.faction === myFaction ? (
                                            (pickTarget.hand ?? []).map((card: Card) => (
                                                <button key={card.id} className="btn btn-skill"
                                                    onClick={() => emit.respond({ action: 'hand', cardId: card.id } as any)}>
                                                    {getValueStr(card.value)}{getSuitSymbol(card.suit)} {cardNameOf(card.name)}
                                                </button>
                                            ))
                                        ) : (
                                            <button className="btn btn-secondary"
                                                onClick={() => emit.respond({ action: 'hand' } as any)}>
                                                手牌(随机)
                                            </button>
                                        )
                                    )}
                                    {pickTarget?.equip?.weapon && (
                                        <button className="btn btn-skill"
                                            onClick={() => emit.respond({ action: 'weapon' } as any)}>
                                            武器：{cardNameOf(pickTarget.equip.weapon.name)}
                                        </button>
                                    )}
                                    {pickTarget?.equip?.armor && (
                                        <button className="btn btn-skill"
                                            onClick={() => emit.respond({ action: 'armor' } as any)}>
                                            防具：{cardNameOf(pickTarget.equip.armor.name)}
                                        </button>
                                    )}
                                    {pickTarget?.equip?.plus_horse && (
                                        <button className="btn btn-skill"
                                            onClick={() => emit.respond({ action: 'plus_horse' } as any)}>
                                            +1马
                                        </button>
                                    )}
                                    {pickTarget?.equip?.minus_horse && (
                                        <button className="btn btn-skill"
                                            onClick={() => emit.respond({ action: 'minus_horse' } as any)}>
                                            -1马
                                        </button>
                                    )}
                                    {pickTarget?.judgeZone && pickTarget.judgeZone.length > 0 && pickTarget.judgeZone.map((jc: any) => (
                                        <button key={jc.id} className="btn btn-secondary"
                                            onClick={() => emit.respond({ action: 'judge', cardId: jc.id } as any)}>
                                            判定区：{jc.name === 'overindulgence' ? '乐不思蜀' : jc.name === 'lightning' ? '闪电' : '兵粮寸断'}
                                        </button>
                                    ))}
                                </div>
                            </>
                        )
                    })()}
                    {/* 雌雄双股剑：目标选弃牌或让对方摸牌 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.EQUIP_DOUBLE_SWORDS_CHOICE && (
                        <>
                            <span className="skill-confirm-label">雌雄双股剑：弃1张手牌或让对方摸1张牌</span>
                            <button className="btn btn-skill" disabled={selectedCardIds.length === 0}
                                onClick={() => emit.respond({ cardId: selectedCardIds[0], action: 'discard' } as any)}>
                                弃1手牌
                            </button>
                            <button className="btn btn-secondary"
                                onClick={() => emit.respond({ action: 'draw' } as any)}>
                                让对方摸1牌
                            </button>
                        </>
                    )}
                    {/* 麒麟弓：选择弃哪匹马 / 加强版任意装备 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.EQUIP_KYLIN_BOW_CHOICE && (() => {
                        const kbCtx = pendingResponse.context as any
                        const kbTarget = gameState.generals[kbCtx.targetIndex]
                        if (kbCtx.anyEquip) {
                            const slots: Array<[string, string, any]> = [
                                ['weapon', '武器', kbTarget?.equip?.weapon],
                                ['armor', '防具', kbTarget?.equip?.armor],
                                ['plus_horse', '+1马', kbTarget?.equip?.plus_horse],
                                ['minus_horse', '-1马', kbTarget?.equip?.minus_horse],
                            ]
                            return (
                                <>
                                    <span className="skill-confirm-label">麒麟弓：选择弃目标装备区的一张牌</span>
                                    {slots.filter(([, , c]) => c).map(([action, label, c]) => (
                                        <button key={action} className="btn btn-skill"
                                            onClick={() => emit.respond({ action } as any)}>
                                            {label}：{cardNameOf(c.name)}
                                        </button>
                                    ))}
                                </>
                            )
                        }
                        return (
                            <>
                                <span className="skill-confirm-label">麒麟弓：选择弃目标哪匹马</span>
                                <button className="btn btn-skill"
                                    onClick={() => emit.respond({ action: 'plus' } as any)}>
                                    弃+1马
                                </button>
                                <button className="btn btn-skill"
                                    onClick={() => emit.respond({ action: 'minus' } as any)}>
                                    弃-1马
                                </button>
                            </>
                        )
                    })()}
                    {/* 寒冰剑：选择弃目标的牌 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.EQUIP_ICE_SWORD_PICK && (() => {
                        const iceCtx = pendingResponse.context as any
                        const iceTarget = gameState.generals[iceCtx.iceTargetIndex]
                        const remaining = iceCtx.remainingPicks ?? 0
                        const iceTargetName = iceTarget ? (GENERAL_NAMES[iceTarget.generalId] ?? iceTarget.generalId) : '目标'
                        return (
                            <>
                                <span className="skill-confirm-label">
                                    寒冰剑：选择弃【{iceTargetName}】的牌（剩余{remaining}次）
                                </span>
                                {(iceTarget?.handCount > 0 || (iceTarget?.hand && iceTarget.hand.length > 0)) && (
                                    <button className="btn btn-skill"
                                        onClick={() => emit.respond({ action: 'hand' } as any)}>
                                        手牌（随机）
                                    </button>
                                )}
                                {iceTarget?.equip?.weapon && (
                                    <button className="btn btn-skill"
                                        onClick={() => emit.respond({ action: 'weapon' } as any)}>
                                        武器：{cardNameOf(iceTarget.equip.weapon.name)}
                                    </button>
                                )}
                                {iceTarget?.equip?.armor && (
                                    <button className="btn btn-skill"
                                        onClick={() => emit.respond({ action: 'armor' } as any)}>
                                        防具：{cardNameOf(iceTarget.equip.armor.name)}
                                    </button>
                                )}
                                {iceTarget?.equip?.plus_horse && (
                                    <button className="btn btn-skill"
                                        onClick={() => emit.respond({ action: 'plus_horse' } as any)}>
                                        +1马：{cardNameOf(iceTarget.equip.plus_horse.name)}
                                    </button>
                                )}
                                {iceTarget?.equip?.minus_horse && (
                                    <button className="btn btn-skill"
                                        onClick={() => emit.respond({ action: 'minus_horse' } as any)}>
                                        -1马：{cardNameOf(iceTarget.equip.minus_horse.name)}
                                    </button>
                                )}
                            </>
                        )
                    })()}
                    {/* 斗地主：存活农民的阵亡奖励二选一 */}
                    {myPendingResponse && isViewingResponding && pendingResponse?.type === ResponseType.LANDLORD_REWARD && (
                        <>
                            <span className="skill-confirm-label">{isPair ? '同阵营阵亡补偿：选择一项' : '农民阵亡奖励：选择一项'}</span>
                            <button className="btn btn-skill"
                                onClick={() => handleRespond(undefined, { action: 'draw' } as any)}>摸两张牌</button>
                            <button className="btn btn-skill"
                                onClick={() => handleRespond(undefined, { action: 'recover' } as any)}>回复1点体力</button>
                        </>
                    )}
                    {/* 通用响应：出牌/放弃（排除所有专属类型） */}
                    {myPendingResponse
                        && isViewingResponding
                        && pendingResponse?.type !== ResponseType.PEACH_SAVE_ASK
                        && pendingResponse?.type !== ResponseType.SKILL_ACTIVATE_CONFIRM
                        && pendingResponse?.type !== ResponseType.JUDGE_INTERVENE
                        && pendingResponse?.type !== ResponseType.SKILL_LUANWU_PICK_TARGET
                        && pendingResponse?.type !== ResponseType.SKILL_LUANWU_EXTRA_SLASH
                        && pendingResponse?.type !== ResponseType.SKILL_FANJIAN_SUIT
                        && pendingResponse?.type !== ResponseType.SKILL_GANGLIE_CHOICE
                        && pendingResponse?.type !== ResponseType.SKILL_GANGLIE_TARGET
                        && pendingResponse?.type !== ResponseType.SKILL_FANJIAN_CHOICE
                        && pendingResponse?.type !== ResponseType.SKILL_QIANXI_PICK
                        && pendingResponse?.type !== ResponseType.SKILL_DIANHU_TARGET
                        && pendingResponse?.type !== ResponseType.SKILL_QICE_PICK
                        && pendingResponse?.type !== ResponseType.SKILL_YIJI_DISTRIBUTE
                        && pendingResponse?.type !== ResponseType.HARVEST_PICK
                        && pendingResponse?.type !== ResponseType.EQUIP_DOUBLE_SWORDS_CHOICE
                        && pendingResponse?.type !== ResponseType.EQUIP_KYLIN_BOW_CHOICE
                        && pendingResponse?.type !== ResponseType.EQUIP_ICE_SWORD_PICK

                        && pendingResponse?.type !== ResponseType.TRICK_TARGET_CARD_PICK
                        && pendingResponse?.type !== ResponseType.BORROW_SWORD_RESPONSE
                        && pendingResponse?.type !== ResponseType.SKILL_TUXI_CHOOSE
                        && pendingResponse?.type !== ResponseType.SKILL_SHENSU_TARGET
                        && pendingResponse?.type !== ResponseType.SKILL_SHENSU_EQUIP
                        && pendingResponse?.type !== ResponseType.SKILL_FANKUI_PICK
                        && pendingResponse?.type !== ResponseType.SKILL_GUANXING_ARRANGE
                        && pendingResponse?.type !== ResponseType.SKILL_YINGHUN_CHOOSE
                        && pendingResponse?.type !== ResponseType.SKILL_TIANXIANG_CHOOSE
                        && pendingResponse?.type !== ResponseType.SKILL_TIANXIANG_LUOSHU_OPTION
                        && pendingResponse?.type !== ResponseType.SKILL_KUANGGU_CHOICE
                        && pendingResponse?.type !== ResponseType.SKILL_QIMOU_HP
                        && pendingResponse?.type !== ResponseType.SKILL_LIULI_REDIRECT
                        && pendingResponse?.type !== ResponseType.SKILL_YINGHUN_DISCARD
                        && pendingResponse?.type !== ResponseType.SKILL_LEIJI_TARGET
                        && pendingResponse?.type !== ResponseType.SKILL_ZHONGYONG_GIVE
                        && pendingResponse?.type !== ResponseType.SKILL_ZHONGYONG_SLASH
                        && pendingResponse?.type !== ResponseType.SKILL_SHUOMENG_TARGET
                        && pendingResponse?.type !== ResponseType.SKILL_SHUOMENG_CARD
                        && pendingResponse?.type !== ResponseType.SKILL_MIJI_GIVE
                        && pendingResponse?.type !== ResponseType.SKILL_QIZHI_TARGET
                        && pendingResponse?.type !== ResponseType.SKILL_DUFENG_CHOICE
                        && pendingResponse?.type !== ResponseType.SKILL_JINQU_DISCARD
                        && pendingResponse?.type !== ResponseType.SKILL_CHOOSE_TARGET
                        && pendingResponse?.type !== ResponseType.SKILL_GIVE_CARDS
                        && pendingResponse?.type !== ResponseType.SKILL_PICK_CARD
                        && pendingResponse?.type !== ResponseType.LANDLORD_REWARD && (
                            <>
                                {/* 八卦阵按钮 + 倾国按钮：在 DODGE / AOE_DODGE 响应中 */}
                                {(pendingResponse?.type === ResponseType.DODGE || pendingResponse?.type === ResponseType.AOE_DODGE) && (() => {
                                    const rGeneral = gameState.generals[pendingResponse.targetGeneralIndex]
                                    const baguaUsed = !!(pendingResponse.context as any)?.eightTrigramsUsed
                                    const hasBazhen = !!rGeneral && !rGeneral.equip?.armor
                                        && (getGeneralById(rGeneral.generalId)?.skills.some(s => s.id === 'wolong_bazhen') ?? false)
                                    const hasEightTrigrams = (rGeneral?.equip?.armor?.name === 'eight_trigrams' || hasBazhen) && !baguaUsed
                                    const hasQingguo = rGeneral?.generalId === 'zhenji'
                                    const hasAocai = rGeneral?.generalId === 'zhugeke'
                                        && gameState.activeGeneralIndex !== pendingResponse.targetGeneralIndex
                                    const hasHuomo = rGeneral?.generalId === 'zhongyao'
                                    const hasShifei = rGeneral?.generalId === 'guotu'
                                        && !(pendingResponse.context as any)?.shifeiTried
                                    const hasWeijing = getGeneralById(rGeneral?.generalId ?? '')?.skills
                                        .some(s => s.id === 'luzhi_weijing') ?? false
                                    const hasLonghun = getGeneralById(rGeneral?.generalId ?? '')?.skills
                                        .some(s => s.id === 'shenzhaoyun_longhun') ?? false
                                    return (
                                        <>
                                            {hasHuomo && (
                                                <button className="btn btn-skill"
                                                    disabled={selectedCardIds.length === 0}
                                                    onClick={() => emit.respond({ action: 'huomo', cardId: selectedCardIds[0] } as any)}>
                                                    活墨（黑非基本牌当闪）
                                                </button>
                                            )}
                                            {hasShifei && (
                                                <button className="btn btn-skill"
                                                    onClick={() => emit.respond({ action: 'shifei' } as any)}>
                                                    饰非（视为使用闪）
                                                </button>
                                            )}
                                            {hasEightTrigrams && (
                                                <button className="btn btn-skill"
                                                    onClick={() => emit.respond({ action: 'eight_trigrams' } as any)}>
                                                    八卦阵判定
                                                </button>
                                            )}
                                            {hasWeijing && (
                                                <button className="btn btn-skill"
                                                    disabled={(rGeneral as any).weijingRound !== undefined
                                                        && (rGeneral as any).weijingRound === gameState.roundState?.roundNumber}
                                                    onClick={() => emit.respond({ action: 'weijing_dodge' } as any)}>
                                                    卫境（视为使用闪）
                                                </button>
                                            )}
                                            {hasQingguo && (
                                                <span style={{ color: '#a0d0ff', fontWeight: 'bold', fontSize: '12px' }}>
                                                    倾国：黑色手牌可当闪
                                                </span>
                                            )}
                                            {hasLonghun && (
                                                <span style={{ color: '#e0c060', fontWeight: 'bold', fontSize: '12px' }}>
                                                    龙魂：♣手牌可当闪
                                                </span>
                                            )}
                                            {hasAocai && (
                                                <button className="btn btn-skill"
                                                    onClick={() => emit.respond({ action: 'aocai' } as any)}>
                                                    傲才（看牌堆顶两张）
                                                </button>
                                            )}
                                        </>
                                    )
                                })()}
                                {/* 赈赡（界全琮）：交换手牌视为使用所需基本牌 */}
                                {(pendingResponse?.type === ResponseType.DODGE || pendingResponse?.type === ResponseType.AOE_DODGE
                                    || pendingResponse?.type === ResponseType.ATTACK_DUEL || pendingResponse?.type === ResponseType.AOE_ATTACK) && (() => {
                                    const zsGen = generals[pendingResponse.targetGeneralIndex]
                                    const zsSkill = getGeneralById(zsGen?.generalId ?? '')?.skills
                                        .some(s => s.id === 'quancong_zhenshan') ?? false
                                    if (!zsSkill) return null
                                    return (
                                        <button className="btn btn-skill" disabled={selectedTargets.length === 0}
                                            onClick={() => handleRespond(undefined, { action: 'zhenshan', targetIndex: selectedTargets[0] } as any)}>
                                            赈赡（先点选一名手牌少于你的角色）
                                        </button>
                                    )
                                })()}
                                {/* 卫境（鲁芝）：决斗 / 南蛮万箭入口，每轮限一次视为使用【杀】 */}
                                {(pendingResponse?.type === ResponseType.ATTACK_DUEL || pendingResponse?.type === ResponseType.AOE_ATTACK) && (() => {
                                    const wjGen = generals[pendingResponse.targetGeneralIndex]
                                    const wjSkill = getGeneralById(wjGen?.generalId ?? '')?.skills
                                        .some(s => s.id === 'luzhi_weijing') ?? false
                                    if (!wjSkill) return null
                                    const wjUsed = (wjGen as any)?.weijingRound !== undefined
                                        && (wjGen as any).weijingRound === gameState.roundState?.roundNumber
                                    return (
                                        <button className="btn btn-skill" disabled={wjUsed}
                                            onClick={() => handleRespond(undefined, { action: 'weijing_slash' } as any)}>
                                            卫境（视为使用【杀】）
                                        </button>
                                    )
                                })()}
                                <button className="btn btn-secondary" disabled={selectedCardIds.length === 0}
                                    onClick={() => handleRespond(selectedCardIds[0])}>出牌响应</button>
                                <button className="btn" onClick={() => handleRespond(undefined)}>放弃响应</button>
                            </>
                        )}
                </div>
          </div>
          {/* 右侧日志面板 */}
          <div className="game-log-sidebar">
            <div className="game-log-sidebar-header">
                <span>{isSpectator ? '👁 观战中' : '游戏日志'}</span>
                <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn-surrender" title="让规则 AI 评一下这一手"
                        onClick={openCoach}>
                        教练
                    </button>
                    {!isSpectator && (
                        <button className="btn-surrender" title="正常：放慢 AI 的行动，方便看清每一步；快速：当前速度"
                            onClick={() => {
                                const next = pace >= 500 ? 320 : 700
                                setLocalPace(next)
                                setPace(next)
                            }}>
                            节奏：{pace >= 500 ? '正常' : '快速'}
                        </button>
                    )}
                    <button className="btn-surrender" title="点击日志复制复盘 ID；Shift+点击清空清单"
                        onClick={(ev) => { if (ev.shiftKey) handleClearReviewQueue(); else void handleCopyReviewQueue() }}>
                        复盘 {reviewCount}
                    </button>
                    {!isSpectator && (
                        <button className="btn-surrender" onClick={() => {
                            if (window.confirm('返回模式选择？（本局进度不会保留）')) {
                                exitLocalMatch()
                                navigate('/')
                            }
                        }}>新开一局</button>
                    )}
                </div>
            </div>
            {reviewNotice && <div className="review-notice">{reviewNotice}</div>}
            <div className="action-log">
                {[...visibleLog].reverse().map((entry, i) => (
                    <div key={i} className="log-entry log-entry-clickable"
                        title={logReviewId(entry) ?? '这条日志没有本机复盘 ID'}
                        onClick={() => void handleLogClick(entry)}>
                        {highlightLogText(entry.text)}
                    </div>
                ))}
                {log.length > LOG_RECENT_LIMIT && (
                    <button className="btn btn-secondary log-expand-btn" onClick={() => setShowAllLog(v => !v)}>
                        {showAllLog ? `收起，只看最近 ${LOG_RECENT_LIMIT} 条` : `展开更早的日志（共 ${log.length} 条）`}
                    </button>
                )}
            </div>
          </div>
            {aiThinking && (
                <div className="ai-thinking" title="对方正在决策">
                    <span className="dot" />对方思考中
                </div>
            )}
            {playBanner && <div className="play-banner" key={playBanner.key}>{playBanner.name}</div>}
            <FxLayer ref={fxRef} />
        </div>
        {showCoach && (
            <div className="discard-modal-backdrop" onClick={() => setShowCoach(false)}>
                <div className="discard-modal" onClick={(ev) => ev.stopPropagation()}>
                    <div className="discard-modal-header">
                        <span>教练建议（与规则 AI 共用评分表）</span>
                        <button className="btn" onClick={() => setShowCoach(false)}>关闭</button>
                    </div>
                    <div className="discard-modal-list">
                        {coachTips.length === 0 && (
                            <div className="discard-empty">当前不是你的出牌阶段，或没有可用的动作</div>
                        )}
                        {coachTips.map((tip, i) => (
                            <div key={tip.key} className="discard-modal-card" style={{ textAlign: 'left' }}>
                                <span className="dmc-name">
                                    {i + 1}. {tip.label} · {tip.turnValue} 分
                                    <span style={{ color: 'var(--color-text-dim)' }}>
                                        （收益 {tip.gain} / 风险 {tip.risk} / 战略 {tip.strategic}）
                                    </span>
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        )}
        {showPool && poolStats && (
            <div className="discard-modal-backdrop" onClick={() => setShowPool(false)}>
                <div className="discard-modal" onClick={(ev) => ev.stopPropagation()}>
                    <div className="discard-modal-header">
                        <span>记牌器 · 未露面 {poolStats.unseen} 张</span>
                        <button className="btn" onClick={() => setShowPool(false)}>关闭</button>
                    </div>
                    <div className="discard-modal-list">
                        {poolStats.cards.map((c) => (
                            <div key={c.key} className="discard-modal-card"
                                title={`${c.label}：尚未露面 ${c.left} 张${c.played > 0 ? `，已使用/弃置 ${c.played} 张` : ''}`}>
                                <span className="dmc-name">【{c.label}】剩 {c.left}{c.played > 0 ? ` · 出 ${c.played}` : ''}</span>
                            </div>
                        ))}
                    </div>
                    <div className="discard-modal-header">
                        <span>敌方手牌（只公开牌数）</span>
                    </div>
                    <div className="discard-modal-list">
                        {poolStats.enemies.length === 0 && <div className="discard-empty">无存活敌人</div>}
                        {poolStats.enemies.map((e) => (
                            <div key={e.name} className="discard-modal-card">
                                <span className="dmc-name">{e.name}：{e.hand} 张（明牌 {e.known}）</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        )}
        {showDiscard && (
            <div className="discard-modal-backdrop" onClick={() => setShowDiscard(false)}>
                <div className="discard-modal" onClick={(ev) => ev.stopPropagation()}>
                    <div className="discard-modal-header">
                        <span>弃牌堆（{discardPile.length} 张）</span>
                        <button className="btn" onClick={() => setShowDiscard(false)}>关闭</button>
                    </div>
                    <div className="discard-modal-list">
                        {discardPile.length === 0 && <div className="discard-empty">暂无弃牌</div>}
                        {(() => {
                            // 按牌名归类：同一张牌只占一格，显示【杀】×9 这样的数量
                            const groups = new Map<string, { name: string; count: number }>()
                            const ordered: { name: string; count: number }[] = []
                            for (const c of discardPile) {
                                const hit = groups.get(c.name)
                                if (hit) { hit.count += 1; continue }
                                const fresh = { name: c.name, count: 1 }
                                groups.set(c.name, fresh)
                                ordered.push(fresh)
                            }
                            ordered.sort((a, b) => b.count - a.count)
                            return ordered.map((g) => (
                                <div key={g.name} className="discard-modal-card" title={`【${cardNameOf(g.name)}】${g.count} 张`}>
                                    <span className="dmc-name">【{cardNameOf(g.name)}】×{g.count}</span>
                                </div>
                            ))
                        })()}
                    </div>
                </div>
            </div>
        )}
        {error && (
            <div className="error-toast game-error-toast" onClick={() => setError(null)}>{error}</div>
        )}
        <TooltipBubble tooltip={tooltip} />
        </>
    )
}
