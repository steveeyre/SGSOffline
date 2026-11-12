/**
 * 对手留牌倾向：同样抽到这些牌时，他更可能留下哪一类。
 *
 * 这里只登记“技能会让留牌结构偏离牌池密度”的结论，不重复实现技能结算。
 * 权重只作用于未知手牌，不会改变明牌；新增武将时在 RULES 里补一条即可。
 */
import type { GeneralView } from './ai-synergy'
import { hasSkillOf } from './ai-synergy'

export interface HandTendency {
    slash: number
    dodge: number
    peach: number
    negate: number
    /** 装备、普通锦囊、酒等非核心牌 */
    other: number
}

const NEUTRAL: HandTendency = { slash: 1, dodge: 1, peach: 1, negate: 1, other: 1 }

interface TendencyRule {
    skills: string[]
    weight: Partial<HandTendency>
}

/**
 * 权重含义：1 = 与牌池同密度，>1 = 更可能留在手里，<1 = 更容易被打出/弃掉。
 * 数值是启发式，不是统计拟合；宁可保守，也不要把某一类抬到必留。
 */
const RULES: TendencyRule[] = [
    {
        // 菜刀：杀是回合内资源，没杀时连输出都没有
        skills: [
            'zhangfei_paoxiao', 'zhangfei_tishen', 'guanyu_wusheng', 'lvbu_wushuang',
            'lvbu_jing_zhanshen', 'machao_tieqi', 'machao_jie_tieqi', 'xuchu_jie_luoyi',
            'dianwei_jie_qiangxi', 'fuwan_moukui', 'huangzhong_liegong', 'zhangxiu_xiongluan',
            'quyi_jiaozi', 'taishici_hanzhan', 'caoxiu_jie_qingxi', 'dingfeng_duanbing',
            'lingcao_dufeng', 'madai_qianxi', 'zhoucang_zhongyong', 'zhoucang_jie_zhongyong',
        ],
        weight: { slash: 1.35, dodge: 0.9 },
    },
    {
        // 闪可转化/可触发防御技：赵云龙胆、甄姬倾国、小乔红颜
        skills: ['zhaoyun_longdan', 'zhenji_qingguo', 'xiaoqiao_hongyan'],
        weight: { dodge: 1.3, peach: 1.1 },
    },
    {
        // 卖血/受击收益：需要留闪桃保证自己不死，才吃得到收益
        skills: [
            'guojia_yiji', 'guojia_jie_yiji', 'caocao_jianxiong', 'caocao_jie_jianxiong',
            'xiahoudun_ganglie', 'xiahoudun_jing_ganglie', 'sunce_jiang', 'sunce_jie_jiang',
        ],
        weight: { dodge: 1.15, peach: 1.15 },
    },
    {
        // 治疗核心：桃的边际价值高于普通武将
        skills: ['huatuo_jijiu', 'huatuo_qingnang', 'sunshangxiang_jieyin'],
        weight: { peach: 1.35 },
    },
    {
        // 装备流：装备既是收益也是后续技能的燃料
        skills: ['sunshangxiang_xiaoji', 'lingtong_xuanfeng', 'caifuren_xianzhou'],
        weight: { other: 1.2 },
    },
    {
        // 锦囊流：锦囊密度直接决定回合上限；空城诸葛额外留无懈
        skills: ['huangyueying_jizhi', 'xunyou_qice', 'zhugeliang_kongcheng'],
        weight: { negate: 1.25, other: 1.15 },
    },
    {
        // 黑牌流：甄姬倾国/洛神、张角鬼道/雷击都吃黑牌
        skills: ['zhenji_luoshen', 'zhangjiao_guidao', 'zhangjiao_leiji'],
        weight: { dodge: 1.1, other: 1.1 },
    },
    {
        // 制衡/奇制：高质量散牌也能换，留牌面更宽
        skills: ['sunquan_zhiheng', 'wangji_qizhi'],
        weight: { other: 1.15 },
    },
    {
        // 改判/手牌流动：红黑牌都有用途，倾向留结构牌
        skills: ['simayi_guicai', 'simayi_jie_guicai', 'simayi_jie_jiaozhao', 'luxun_jie_lianying'],
        weight: { other: 1.1 },
    },
    {
        // 苦肉：失去体力换牌，桃的价值上升
        skills: ['huanggai_kurou'],
        weight: { peach: 1.15 },
    },
]

export function handTendencyOf(g: GeneralView | undefined): HandTendency {
    if (!g) return { ...NEUTRAL }
    const out = { ...NEUTRAL }
    for (const rule of RULES) {
        if (!rule.skills.some((id) => hasSkillOf(g, id))) continue
        for (const key of Object.keys(rule.weight) as (keyof HandTendency)[]) {
            out[key] *= rule.weight[key] ?? 1
        }
    }
    for (const key of Object.keys(out) as (keyof HandTendency)[]) {
        out[key] = Math.max(0.75, Math.min(1.6, out[key]))
    }
    return out
}
