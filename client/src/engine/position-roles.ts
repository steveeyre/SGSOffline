/**
 * 统率三军位置职责与武将定位。
 *
 * 位置职责来自实际行动次序，而不是“主帅一定辅助、前锋一定输出”：
 *   冷主 → 冷 A → 冷 B → 暖 B → 暖主 → 暖 A
 * - 冷主帅第一个行动，目标是限制暖二连，吃控制、阻断、拆牌与防御。
 * - 暖 B 第二个行动，冷主没干扰到位时形成暖二连，吃伤害、控制与距离。
 * - 冷 B 第三个行动，承接冷方连续行动，吃伤害、控制与持续作战。
 * - 暖主帅最后行动，重回合外支援与保护，而不是回合内主动进攻。
 * - 冷 A 是冷方先手边锋，暖 A 是暖方后手边锋，分别沿用两边的边锋职责。
 *
 * 定位表由使用者划定；未登记的武将回退到旧定位表或按牌差处理。
 */

import { GENERAL_ROLES, type GeneralRole } from './general-meta'

export type PositionRole = 'support' | 'card' | 'blade' | 'burst' | 'control' | 'tank' | 'heal'

export const POSITION_ROLE_LABEL: Record<PositionRole, string> = {
    support: '辅助',
    card: '牌差',
    blade: '菜刀',
    burst: '直伤',
    control: '控制',
    tank: '肉盾',
    heal: '回复',
}

export interface RoleTraits {
    survive: number
    offense: number
    control: number
    support: number
    tempo: number
    reach: number
    fragile: number
    anchor: number
}

/** 七类定位的基础能力向量；技能与体力只做小幅修正，不覆盖定位。 */
export const ROLE_TRAITS: Record<PositionRole, RoleTraits> = {
    support: { survive: 4, offense: 1, control: 4, support: 9, tempo: 4, reach: 1, fragile: 3, anchor: 7 },
    card: { survive: 4, offense: 2, control: 5, support: 6, tempo: 8, reach: 2, fragile: 3, anchor: 4 },
    blade: { survive: 5, offense: 9, control: 3, support: 1, tempo: 7, reach: 4, fragile: 4, anchor: 2 },
    burst: { survive: 3, offense: 9, control: 4, support: 1, tempo: 7, reach: 6, fragile: 6, anchor: 2 },
    control: { survive: 5, offense: 3, control: 9, support: 3, tempo: 6, reach: 3, fragile: 4, anchor: 5 },
    tank: { survive: 9, offense: 2, control: 4, support: 3, tempo: 2, reach: 1, fragile: 1, anchor: 7 },
    heal: { survive: 7, offense: 1, control: 2, support: 8, tempo: 3, reach: 1, fragile: 2, anchor: 8 },
}

/**
 * 使用者划定的统率三军定位。
 * 同一武将的经典版与界/竞版分别登记；洛书池实际使用界版 ID。
 */
export const POSITION_ROLE_BY_ID: Record<string, PositionRole> = {
    // 辅助（24）
    liubei: 'support',
    liubei_jie: 'support',
    guojia_jie: 'support',
    guojia: 'support',
    caorui: 'support',
    lusu: 'support',
    xiahoudun_jing: 'support',
    luxun_jie: 'support',
    zhangsong_jie: 'support',
    zhongyao: 'support',
    chenqun: 'support',
    xunyu: 'support',
    xujing: 'support',
    liushan: 'support',
    chengong_jie: 'support',
    chengong: 'support',
    xiaoqiao: 'support',
    zhoufei: 'support',
    xiahoushi: 'support',
    sunshangxiang_sp: 'support',
    guyong: 'support',
    kanze: 'support',
    shenlusu: 'support',
    baoxin: 'support',
    xizhicai: 'support',
    liuxie: 'support',
    panjun: 'support',

    // 牌差（31）
    lidian_jie: 'card',
    wangji: 'card',
    sunquan: 'card',
    lingtong: 'card',
    huangyueying_jie: 'card',
    huangyueying: 'card',
    wangping: 'card',
    zhenji_jie: 'card',
    zhenji: 'card',
    huangquan_jing: 'card',
    sunjian_jie: 'card',
    sunjian: 'card',
    zhouyu_jie: 'card',
    zhouyu: 'card',
    sunqian: 'card',
    zumao: 'card',
    jushou: 'card',
    handang: 'card',
    fazheng: 'card',
    sundeng: 'card',
    guotu: 'card',
    quancong: 'card',
    zhangzhaozhanghong_jie: 'card',
    bulianshi_jie: 'card',
    kuailiangkuaiyue: 'card',
    zhoufang: 'card',
    guohuai_jie: 'card',
    sunxiu: 'card',
    zhuzhi: 'card',
    zhuran_jie: 'card',
    guanqiujian: 'card',
    xuezong: 'card',
    shamoke: 'card',
    chenlin: 'card',
    lifeng: 'card',

    // 菜刀（24）
    xuchu_jie: 'blade',
    zhangfei_jie: 'blade',
    zhangfei: 'blade',
    machao_jie: 'blade',
    machao: 'blade',
    litong: 'blade',
    zhoucang: 'blade',
    madai: 'blade',
    dingfeng: 'blade',
    lingcao: 'blade',
    lvbu_jing: 'blade',
    lvbu: 'blade',
    pangde_jie: 'blade',
    pangde: 'blade',
    fuwan: 'blade',
    guanyu: 'blade',
    weiyan: 'blade',
    caoxiu_jie: 'blade',
    caoxiu: 'blade',
    xiahouyuan_jie: 'blade',
    xiahoyuan: 'blade',
    zhurong_jie: 'blade',
    taishici_jie: 'blade',
    taishici: 'blade',
    gaoshun_jie: 'blade',
    lisu: 'blade',
    caozhang_jie: 'blade',
    caochun: 'blade',
    lingju: 'blade',
    peixiu: 'blade',
    caiwenji_sp: 'blade',

    // 直伤（22）
    dianwei_jie: 'burst',
    huanggai_jie: 'burst',
    huanggai: 'burst',
    yuejin: 'burst',
    zhugeke: 'burst',
    zhangjiao: 'burst',
    jiaxu_jie: 'burst',
    jiaxu: 'burst',
    diaochan_jie: 'burst',
    diaochan: 'burst',
    caifuren_jie: 'burst',
    liuchen: 'burst',
    huaxiong_jie: 'burst',
    cenhun: 'burst',
    guanyinping: 'burst',
    pangtong: 'burst',
    yanliangwenchou_jie: 'burst',
    yufan: 'burst',
    zhuhuan: 'burst',
    huangzhong_jie: 'burst',
    zhangxiu: 'burst',
    liru: 'burst',
    quyi: 'burst',
    hetaihou: 'burst',
    sunchen: 'burst',

    // 控制（26）
    daqiao_jie: 'control',
    daqiao: 'control',
    fuhuanghou_jie: 'control',
    xuhuang_jie: 'control',
    xuhuang: 'control',
    hanhaosihuan: 'control',
    ganning_jie: 'control',
    ganning: 'control',
    wenpin: 'control',
    zhugeliang_jie: 'control',
    zhugeliang: 'control',
    xuyou: 'control',
    zhugezhan: 'control',
    gongsunyuan: 'control',
    masu: 'control',
    zhanghulelin: 'control',
    zhangliao_jie: 'control',
    zhangliao: 'control',
    liufeng: 'control',
    zhanghe: 'control',
    wolong: 'control',
    caoren: 'control',
    caoren_sp: 'control',
    dongyun: 'control',
    zhugejin: 'control',
    simayi_jie: 'control',
    simayi: 'control',
    xunyou: 'control',
    jiangwei: 'control',
    haozhao: 'control',
    sunluyu: 'control',
    chengyu: 'control',

    // 肉盾（12）
    qinmi: 'tank',
    caoang: 'tank',
    dengai: 'tank',
    wangyi_jie: 'tank',
    caocao_jie: 'tank',
    caocao: 'tank',
    yanyan: 'tank',
    sunce_jie: 'tank',
    sunce: 'tank',
    luji: 'tank',
    dongzhuo: 'tank',
    zhonghui_jie: 'tank',
    zhangchunhua_jie: 'tank',
    caochong_jie: 'tank',

    // 回复（8）
    zhaoyun_jing: 'heal',
    shenzhaoyun: 'heal',
    shanzhaoyun: 'heal',
    huatuo_jie: 'heal',
    huatuo: 'heal',
    sunshangxiang_jie: 'heal',
    sunshangxiang: 'heal',
    chengpu_jie: 'heal',
    mizhu: 'heal',
    simalang: 'heal',

    // 未在用户表中、但属于现有池的旧定位补全
    wangyi: 'control',
    caifuren: 'control',
    chengpu: 'support',
    guohuanghou: 'support',
}

export type SlotKey = 'coldCommander' | 'coldFlankA' | 'coldFlankB' | 'warmCommander' | 'warmFlankA' | 'warmFlankB'

/** 只记录定位表无法表达、且反复被验证的个体偏离。 */
export const SLOT_OVERRIDE: Record<string, Partial<Record<SlotKey, number>>> = {
    // 冷主帅：阻断、拆牌、防御三类点名武将
    daqiao_jie: { coldCommander: 4 },
    ganning_jie: { coldCommander: 3 },
    xuhuang_jie: { coldCommander: 3 },
    xuhuang: { coldCommander: 2 },
    wenpin: { coldCommander: 4 },
    qinmi: { coldCommander: 3 },
    caoang: { coldCommander: 3 },
    xiahoudun_jing: { coldCommander: 2 },
    zhugeliang_jie: { coldCommander: 2 },
    zhugeliang: { coldCommander: 1 },
    simayi_jie: { coldCommander: 1 },
    wolong: { coldCommander: 1 },
    caoren: { coldCommander: 1 },
    caoren_sp: { coldCommander: 1 },
    haozhao: { coldCommander: 1 },
    fuhuanghou_jie: { coldCommander: 1 },

    // 张辽的突袭直接压制手牌，符合冷主限制暖二连；只保留边锋的小幅加成
    zhangliao: { coldFlankB: 1 },
    zhangliao_jie: { coldFlankB: 1 },

    // 暖主帅：回合外支援与保护
    guojia: { warmCommander: 4 },
    guojia_jie: { warmCommander: 4 },
    huatuo: { warmCommander: 3 },
    huatuo_jie: { warmCommander: 3 },
    liubei: { warmCommander: 2 },
    liubei_jie: { warmCommander: 2 },
    caorui: { warmCommander: 3 },
    lusu: { warmCommander: 2 },
    xunyu: { warmCommander: 2 },
    luxun_jie: { warmCommander: 2 },
    sunshangxiang_jie: { warmCommander: 2 },
    sunshangxiang_sp: { warmCommander: 2 },

    // 暖 B 的先手爆发：能直接击杀冷主或破坏冷边锋
    zhangfei_jie: { warmFlankB: 2 },
    lvbu_jing: { warmFlankB: 2 },
    machao_jie: { warmFlankB: 1 },
    xuchu_jie: { warmFlankB: 2 },
    huanggai_jie: { warmFlankB: 1 },
    dianwei_jie: { warmFlankB: 1 },
    huangzhong_jie: { warmFlankB: 1 },
    zhangxiu: { warmFlankB: 1 },
    quyi: { warmFlankB: 1 },
}

const LEGACY_ROLE_MAP: Record<GeneralRole, PositionRole> = {
    core: 'card',
    damage: 'blade',
    tank: 'tank',
    support: 'support',
    control: 'control',
}

/** 未登记时回退旧定位；旧表也没有则按牌差处理。 */
export function roleOfGeneral(id: string): PositionRole {
    const explicit = POSITION_ROLE_BY_ID[id]
    if (explicit) return explicit
    const legacy = GENERAL_ROLES[id]?.[0]
    return legacy ? LEGACY_ROLE_MAP[legacy] : 'card'
}
