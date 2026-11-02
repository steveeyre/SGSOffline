/**
 * 武将定位与配合表：供 AI 抓将、布阵与后续决策使用。
 * 定位取“该武将在统率三军里的主要职责”，一名武将可以有多个定位。
 */
export type GeneralRole = 'core' | 'damage' | 'tank' | 'support' | 'control'

export const ROLE_LABEL: Record<GeneralRole, string> = {
    core: '核心',
    damage: '输出',
    tank: '盾将',
    support: '辅助',
    control: '控制',
}

/** 武将定位（按主要职责排序，首位即主定位） */
export const GENERAL_ROLES: Record<string, GeneralRole[]> = {
    // 魏
    guojia: ['core', 'support'],
    zhangliao: ['control'],
    zhenji: ['damage', 'tank'],
    wenpin: ['tank', 'control'],
    xiahoudun: ['tank'],
    xiahoudun_jing: ['tank', 'damage'],
    lidian_jie: ['support', 'damage'],
    simayi: ['control', 'core'],
    simayi_jie: ['control', 'core'],
    xuchu_jie: ['damage'],
    dengai: ['tank', 'damage'],
    xunyou: ['core', 'control'],
    wangyi: ['control', 'support'],
    wangji: ['core', 'control'],
    yuejin: ['damage'],
    simalang: ['support'],
    litong: ['damage'],
    caocao: ['tank', 'core'],
    caocao_jie: ['tank', 'core'],
    dianwei_jie: ['damage'],
    xuhuang: ['control'],
    xiahoyuan: ['damage'],
    // 蜀
    liubei: ['support', 'core'],
    guanyu: ['damage'],
    zhangfei: ['damage'],
    zhugeliang: ['control', 'support'],
    zhaoyun: ['damage', 'tank'],
    huangyueying: ['damage', 'core'],
    machao: ['damage'],
    machao_jie: ['damage'],
    madai: ['damage', 'control'],
    jiangwei: ['control', 'damage'],
    sunshangxiang_sp: ['support', 'control'],
    zhoucang: ['damage'],
    yanyan: ['tank', 'damage'],
    wangping: ['control'],
    huangquan_jing: ['support', 'control'],
    sunqian: ['support'],
    // 吴
    sunquan: ['core'],
    ganning: ['control'],
    ganning_jie: ['control'],
    huanggai: ['damage'],
    zhouyu: ['damage', 'control'],
    zhouyu_jie: ['damage', 'control'],
    daqiao: ['control'],
    xiaoqiao: ['tank', 'control'],
    sunshangxiang: ['support'],
    sunjian: ['damage', 'control'],
    sunce: ['tank', 'damage'],
    zhugejin: ['support'],
    zhugeke: ['damage', 'control'],
    lingtong: ['damage', 'control'],
    luxun_jie: ['core'],
    guyong: ['support'],
    dingfeng: ['damage'],
    yufan: ['support', 'control'],
    zumao: ['tank'],
    lingcao: ['damage'],
    // 群
    huatuo: ['support'],
    lvbu: ['damage'],
    lvbu_jing: ['damage'],
    diaochan: ['control', 'damage'],
    pangde: ['damage'],
    jiaxu: ['control'],
    chengong: ['support', 'control'],
    jushou: ['core'],
    caifuren: ['support', 'control'],
    fuwan: ['damage', 'control'],
    zhangjiao: ['damage', 'control'],
    // 洛书版扩展
    liuchen: ['damage', 'control'],
    huaxiong_jie: ['tank', 'damage'],
    weiyan: ['damage'],
    luji: ['support', 'tank'],
    haozhao: ['control', 'tank'],
    xuyou: ['core', 'damage'],
    handang: ['damage', 'control'],
    fazheng: ['control', 'support'],
    masu: ['damage', 'control'],
    zhongyao: ['support', 'control'],
    chengpu: ['damage', 'support'],
    cenhun: ['core', 'damage'],
    sundeng: ['support'],
    guotu: ['control', 'support'],
    caoxiu: ['damage', 'control'],
    guohuanghou: ['core', 'support'],
    xiahoushi: ['support', 'damage'],
    gongsunyuan: ['control', 'damage'],
    quancong: ['support', 'control'],
    // 洛书版扩展（二）
    xiahouyuan_jie: ['damage'],
    caoren: ['tank', 'core'],
    guanyinping: ['damage', 'control'],
    chenqun: ['support', 'control'],
    xunyu: ['core', 'damage'],
    zhurong_jie: ['damage', 'control'],
    liushan: ['support'],
    zhangzhaozhanghong_jie: ['support', 'control'],
    dongzhuo: ['tank', 'damage'],
    pangtong: ['core', 'damage'],
    yanliangwenchou_jie: ['damage', 'core'],
    wolong: ['control', 'damage'],
    taishici: ['damage'],
    zhoufei: ['support', 'control'],
    lusu: ['support', 'core'],
    bulianshi_jie: ['support'],
    kuailiangkuaiyue: ['control', 'support'],
    gaoshun_jie: ['damage', 'control'],
    zhoufang: ['control', 'support'],
    zhugeliang_jie: ['control', 'core'],
    sunjian_jie: ['core', 'support'],
    sunce_jie: ['core', 'damage'],
    guojia_jie: ['core', 'support'],
    huanggai_jie: ['damage'],
    pangde_jie: ['damage'],
    jiaxu_jie: ['control', 'damage'],
    chengong_jie: ['support', 'control'],
    // 洛书版扩展（三）：界将升级
    sunshangxiang_jie: ['support', 'core'],
    daqiao_jie: ['control'],
    chengpu_jie: ['damage', 'support'],
    caifuren_jie: ['support', 'control'],
    caoxiu_jie: ['damage', 'control'],
    wangyi_jie: ['control', 'tank'],
    zhangfei_jie: ['damage'],
    taishici_jie: ['damage', 'control'],
    // 洛书版扩展（四）：新增武将
    guohuai_jie: ['core', 'support'],
    sunxiu: ['control', 'support'],
    zhuhuan: ['damage', 'tank'],
    huangzhong_jie: ['damage'],
    zhuzhi: ['support', 'tank'],
    zhugezhan: ['control', 'core'],
    zhangxiu: ['damage', 'control'],
    liru: ['damage', 'control'],
    lisu: ['tank', 'support'],
    xujing: ['core', 'support'],
    quyi: ['damage', 'control'],
    // 洛书版扩展（五）：新增武将
    zhonghui_jie: ['core', 'control'],
    zhangchunhua_jie: ['damage', 'control'],
    caozhang_jie: ['damage'],
    zhangsong_jie: ['support', 'control'],
    fuhuanghou_jie: ['control', 'tank'],
    zhuran_jie: ['damage', 'control'],
    caochong_jie: ['tank', 'support'],
    mizhu: ['support', 'core'],
    caorui: ['support', 'tank'],
    liufeng: ['control', 'damage'],
    zhanghe: ['control', 'core'],
}

export function rolesOf(generalId: string): GeneralRole[] {
    return GENERAL_ROLES[generalId] ?? ['core']
}

export function hasRole(generalId: string, role: GeneralRole): boolean {
    return rolesOf(generalId).includes(role)
}

/**
 * 配合权重：抓到搭档后价值提升的量。
 * 只记录引擎里真实成立的联动（给牌、卖血、改判、弃牌触发等），不做想象。
 */
const SYNERGY: Array<[string, string, number]> = [
    // 郭嘉【遗计】给牌：惠及需要牌或需要弃牌的武将
    ['guojia', 'huangyueying', 8], ['guojia', 'huatuo', 7], ['guojia', 'sunshangxiang', 6],
    ['guojia', 'huanggai', 6], ['guojia', 'caocao', 5], ['guojia', 'simayi', 6],
    ['guojia', 'xiaoqiao', 5], ['guojia', 'zhangfei', 5], ['guojia', 'luxun_jie', 6],
    // 刘备【仁德】给牌
    ['liubei', 'zhangfei', 7], ['liubei', 'guanyu', 6], ['liubei', 'huatuo', 6],
    ['liubei', 'huanggai', 5], ['liubei', 'huangyueying', 6], ['liubei', 'luxun_jie', 5],
    // 华佗【急救/青囊】保住卖血与低血武将
    ['huatuo', 'huanggai', 7], ['huatuo', 'huangyueying', 5], ['huatuo', 'sunshangxiang', 5],
    ['huatuo', 'xiahoudun', 5], ['huatuo', 'yanyan', 4],
    // 判定系：观星控顶 + 改判
    ['zhugeliang', 'zhangjiao', 6], ['zhugeliang', 'simayi', 5], ['zhugeliang', 'zhugejin', 5],
    ['zhangjiao', 'simayi', 4], ['zhangjiao', 'zhenji', 4], ['simayi', 'zhenji', 5],
    // 弃牌/失去牌触发：奇制、旋风、连营、枭姬、屯田
    ['wangji', 'lingtong', 6], ['wangji', 'luxun_jie', 5], ['wangji', 'sunshangxiang', 5],
    ['dengai', 'wangyi', 5], ['dengai', 'sunshangxiang', 4],
    // 令队友出杀：忠勇、明策
    ['zhoucang', 'guanyu', 5], ['zhoucang', 'zhangfei', 5], ['zhoucang', 'machao_jie', 4],
    ['chengong', 'lvbu', 6], ['chengong', 'lvbu_jing', 6], ['chengong', 'machao', 5],
    // 拆牌/控牌组合
    ['zhangliao', 'xuhuang', 4], ['ganning_jie', 'daqiao', 4], ['wangping', 'xuhuang', 4],
    ['fuwan', 'zhangliao', 4],
    // 回复/续航
    ['sunshangxiang', 'huanggai', 6], ['sunshangxiang', 'xiahoudun', 5],
    ['sunqian', 'liubei', 5], ['guyong', 'sunquan', 5], ['huangquan_jing', 'sunquan', 4],
]

const SYNERGY_MAP = new Map<string, number>()
for (const [a, b, w] of SYNERGY) {
    SYNERGY_MAP.set(`${a}|${b}`, w)
    SYNERGY_MAP.set(`${b}|${a}`, w)
}

/** 两名武将之间的配合权重（无配合返回 0） */
export function synergyWeight(a: string, b: string): number {
    return SYNERGY_MAP.get(`${a}|${b}`) ?? 0
}

/** 某武将的搭档列表（调试与选将提示用） */
export function partnersOf(generalId: string): string[] {
    return SYNERGY.filter(([a, b]) => a === generalId || b === generalId)
        .map(([a, b]) => (a === generalId ? b : a))
}
