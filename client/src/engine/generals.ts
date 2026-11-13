import {
    GeneralDefinition,
    SkillDefinition,
    SkillType,
    SkillTrigger,
} from 'sgs3v3-shared'

/**
 * 2013经典版
 */
export const GENERALS: GeneralDefinition[] = [
    // ══════════════════════════════════════════
    // 2013 经典版（32 名）
    // ══════════════════════════════════════════
    // ── 辅助（5 名）──
    {
        id: 'guojia', name: '郭嘉', maxHp: 3, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'guojia_tiandu', name: '天妒',
                description: '你的判定牌生效后，你可获得此牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_JUDGE,
            },
            {
                id: 'guojia_yiji', name: '遗计',
                description: '你受到1点伤害后，可观看牌堆顶两张牌，分别交给任意角色。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
        ],
    },

    {
        id: 'liubei', name: '刘备', maxHp: 4, gender: 'male', kingdom: 'shu',
        skills: [{
            id: 'liubei_rende', name: '仁德',
            description: '出牌阶段，你可将任意张手牌给予其他角色。每通过此技能给出第2张牌时，回复1点体力。',
            type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
        }],
    },

    {
        id: 'xiaoqiao', name: '小乔', maxHp: 3, gender: 'female', kingdom: 'wu',
        skills: [
            {
                id: 'xiaoqiao_tianxiang', name: '天香',
                description: '当你受到伤害时，你可以弃置一张♥手牌，防止此伤害并选择一名其他角色，若如此做，你选择一项：1.令其受到伤害来源对其造成的1点伤害，然后其摸X张牌（X为其已损失的体力值，至多5）；2.令其失去1点体力，然后其获得你弃置的牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
            {
                id: 'xiaoqiao_hongyan', name: '红颜',
                description: '锁定技，你的黑桃牌视为红桃牌。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },

    {
        id: 'zhugejin_jing', name: '诸葛瑾-竞', maxHp: 3, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'zhugejin_jing_huanshi', name: '缓释',
                description: '当一名角色的判定牌生效前，你可以令其观看你的手牌并选择你的一张牌，然后你打出此牌代替判定牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_JUDGE,
            },
            {
                id: 'zhugejin_jing_hongyuan', name: '弘援',
                description: '摸牌阶段，你可以少摸一张牌，令至多两名其他角色各摸一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DRAW_CARDS,
            },
            {
                id: 'zhugejin_jing_mingzhe', name: '明哲',
                description: '当你于回合外因使用、打出或弃置而失去一张红色牌时，你可以摸一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },

    {
        id: 'simayi', name: '司马懿', maxHp: 3, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'simayi_fankui', name: '反馈',
                description: '你受到1点伤害后，可获得伤害来源的一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
            {
                id: 'simayi_guicai', name: '鬼才',
                description: '一名角色的判定牌生效前，你可打出一张手牌代替之。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_JUDGE,
            },
        ],
    },

    // ── 牌差（6 名）──
    {
        id: 'sunquan', name: '孙权', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [{
            id: 'sunquan_zhiheng', name: '制衡',
            description: '出牌阶段限一次，你可弃置任意张牌，然后摸等量的牌。',
            type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
        }],
    },

    {
        id: 'huangyueying', name: '黄月英', maxHp: 3, gender: 'female', kingdom: 'shu',
        skills: [
            {
                id: 'huangyueying_jizhi', name: '集智',
                description: '当你使用一张非延时锦囊牌时，你可以摸一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'huangyueying_qicai', name: '奇才',
                description: '锁定技，你使用锦囊牌无距离限制。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },

    {
        id: 'huanggai', name: '黄盖', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [{
            id: 'huanggai_kurou', name: '苦肉',
            description: '出牌阶段，你可失去1点体力，然后摸两张牌。',
            type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
        }],
    },

    {
        id: 'zhenji', name: '甄姬', maxHp: 3, gender: 'female', kingdom: 'wei',
        skills: [
            {
                id: 'zhenji_luoshen', name: '洛神',
                description: '准备阶段，你可以进行判定，若结果为黑色，你获得此牌并可重复此流程。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_START,
            },
            {
                id: 'zhenji_qingguo', name: '倾国',
                description: '你可以将一张黑色手牌当【闪】使用或打出。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },

    {
        id: 'jiangwei', name: '姜维', maxHp: 4, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'jiangwei_tiaoxin', name: '挑衅',
                description: '出牌阶段限一次，指定一名你在其攻击范围内的角色，该角色须对你使用一张【杀】，否则你弃其一张牌。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'jiangwei_zhiji', name: '志继',
                description: '觉醒技，准备阶段，若你没有手牌，你须回复1点体力或摸两张牌，然后减1点体力上限，获得技能"观星"。',
                type: SkillType.AWAKENED, trigger: SkillTrigger.ON_TURN_START,
            },
        ],
    },

    {
        id: 'zhouyu', name: '周瑜', maxHp: 3, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'zhouyu_yingzi', name: '英姿',
                description: '锁定技，摸牌阶段你多摸一张牌。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_DRAW_CARDS,
            },
            {
                id: 'zhouyu_fanjian', name: '反间',
                description: '出牌阶段限一次，令一名其他角色选择一种花色，然后该角色获得你的一张手牌并展示之，若花色不同则你对其造成1点伤害。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },

    // ── 菜刀（6 名）──
    {
        id: 'zhangfei', name: '张飞', maxHp: 4, gender: 'male', kingdom: 'shu',
        skills: [{
            id: 'zhangfei_paoxiao', name: '咆哮',
            description: '锁定技，你使用【杀】无次数限制。',
            type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
        }],
    },

    {
        id: 'xiahouyuan', name: '夏侯渊', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [{
            id: 'xiahouyuan_shensu', name: '神速',
            description: '可选一至两项：①跳过判定和摸牌阶段；②跳过出牌阶段弃一张装备牌。每选一项视为对一名角色使用一张无距离限制的【杀】。',
            type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_START,
        }],
    },

    {
        id: 'guanyu', name: '关羽', maxHp: 4, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'guanyu_wusheng', name: '武圣',
                description: '你可将红色牌当【杀】使用或打出。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'guanyu_zhongyi', name: '忠义',
                description: '限定技，出牌阶段，你可将一张红色手牌置于武将牌上至本轮结束。期间己方角色使用【杀】造成的伤害+1。',
                type: SkillType.LIMITED, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },

    {
        id: 'lvbu', name: '吕布', maxHp: 4, gender: 'male', kingdom: 'qun',
        skills: [{
            id: 'lvbu_wushuang', name: '无双',
            description: '锁定技，你使用【杀】时目标需打出两张【闪】才能抵消；你使用/成为【决斗】目标时，对方每次需打出两张【杀】。',
            type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
        }],
    },

    {
        id: 'machao', name: '马超', maxHp: 4, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'machao_mashu', name: '马术',
                description: '锁定技，你计算与其他角色的距离-1。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'machao_tieqi', name: '铁骑',
                description: '你使用【杀】指定目标后，可判定：红色则目标不能使用【闪】。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },

    {
        id: 'pangde', name: '庞德', maxHp: 4, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'pangde_mashu', name: '马术',
                description: '锁定技，你计算与其他角色的距离-1。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'pangde_jianchu', name: '鞬出',
                description: '当你使用【杀】指定其他角色为目标后，你可以弃置该角色的一张牌，若此牌不为基本牌，则其不能使用【闪】响应此【杀】，否则其获得此【杀】。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },

    // ── 直伤（2 名）──
    {
        id: 'jiaxu', name: '贾诩', maxHp: 3, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'jiaxu_wansha', name: '完杀',
                description: '锁定技，你的回合内，不处于濒死状态的其他角色不能使用【桃】。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_DYING,
            },
            {
                id: 'jiaxu_luanwu', name: '乱武',
                description: '限定技，出牌阶段，你可令所有其他角色依次选择：对距离最近的另一名角色使用一张【杀】，或失去1点体力。',
                type: SkillType.LIMITED, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'jiaxu_weimu', name: '帷幕',
                description: '锁定技，你不能被选择为黑色锦囊牌的目标。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USED_AS_TARGET,
            },
        ],
    },

    {
        id: 'diaochan', name: '貂蝉', maxHp: 3, gender: 'female', kingdom: 'qun',
        skills: [
            {
                id: 'diaochan_lijian', name: '离间',
                description: '出牌阶段限一次，你可弃置一张牌，令两名男性角色进行决斗。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'diaochan_biyue', name: '闭月',
                description: '结束阶段，你可以摸一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },

    // ── 控制（6 名）──
    {
        id: 'daqiao', name: '大乔', maxHp: 3, gender: 'female', kingdom: 'wu',
        skills: [
            {
                id: 'daqiao_guose', name: '国色',
                description: '你可将一张方块牌当【乐不思蜀】使用。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'daqiao_liuli', name: '流离',
                description: '你成为【杀】的目标时，可弃置一张牌，将此【杀】转移给你攻击范围内的另一名角色。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USED_AS_TARGET,
            },
        ],
    },

    {
        id: 'ganning', name: '甘宁', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [{
            id: 'ganning_qixi', name: '奇袭',
            description: '你可将一张黑色牌当【过河拆桥】使用。',
            type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
        }],
    },

    {
        id: 'zhugeliang', name: '诸葛亮', maxHp: 3, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'zhugeliang_guanxing', name: '观星',
                description: '准备阶段，观看牌堆顶X张牌（X为存活角色数，最多5），以任意顺序置于牌堆顶或底。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ON_TURN_START,
            },
            {
                id: 'zhugeliang_kongcheng', name: '空城',
                description: '锁定技，若你没有手牌，你不能成为【杀】或【决斗】的目标。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USED_AS_TARGET,
            },
        ],
    },

    {
        id: 'xuhuang_jing', name: '徐晃-竞', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'xuhuang_jing_duanliang', name: '断粮',
                description: '①你可以将一张黑色非锦囊牌当【兵粮寸断】使用；②你对距离为2的其他角色使用【兵粮寸断】无距离限制。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },

    {
        id: 'wenpin_jing', name: '文聘-竞', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [{
            id: 'wenpin_zhenwei_jing', name: '镇卫',
            description: '锁定技，对方角色计算与其他己方角色的距离时，始终+1。',
            type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
        }],
    },

    {
        id: 'zhangliao', name: '张辽', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [{
            id: 'zhangliao_tuxi', name: '突袭',
            description: '摸牌阶段，你可以放弃摸牌，改为获得至多两名角色的各一张手牌。',
            type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DRAW_CARDS,
        }],
    },

    // ── 防御（4 名）──
    {
        id: 'caocao', name: '曹操', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [{
            id: 'caocao_jianxiong', name: '奸雄',
            description: '你受到伤害后，可获得造成此伤害的牌。',
            type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
        }],
    },

    {
        id: 'xiahoudun', name: '夏侯惇', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [{
            id: 'xiahoudun_ganglie', name: '刚烈',
            description: '你受到1点伤害后，可判定：非红桃则伤害来源须弃两张手牌或受1点伤害。',
            type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
        }],
    },

    {
        id: 'sunce', name: '孙策', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'sunce_jiang', name: '激昂',
                description: '当你使用【决斗】或红色【杀】指定目标后，或成为【决斗】或红色【杀】的目标后，你可摸一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'sunce_hunzi', name: '魂姿',
                description: '觉醒技，准备阶段，若你的体力值为1，你减1点体力上限，然后获得技能"英姿"和"英魂"。',
                type: SkillType.AWAKENED, trigger: SkillTrigger.ON_TURN_START,
            },
        ],
    },

    {
        id: 'sunjian', name: '孙坚', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [{
            id: 'sunjian_yinghun', name: '英魂',
            description: '准备阶段，若你已受伤，可令一名其他角色：摸X张牌然后弃一张牌；或摸一张牌然后弃X张牌（X为你已损失的体力值）。',
            type: SkillType.ACTIVE, trigger: SkillTrigger.ON_TURN_START,
        }],
    },

    // ── 回复（3 名）──
    {
        id: 'huatuo', name: '华佗', maxHp: 3, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'huatuo_jijiu', name: '急救',
                description: '你的回合外，你可以将一张红色牌当【桃】使用。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DYING,
            },
            {
                id: 'huatuo_qingnang', name: '青囊',
                description: '出牌阶段限一次，你可以弃置一张手牌，令一名已受伤的角色回复1点体力。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },

    {
        id: 'zhaoyun_jing', name: '赵云-竞', maxHp: 4, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'zhaoyun_longdan', name: '龙胆',
                description: '你可将【杀】当【闪】使用或打出，也可将【闪】当【杀】使用或打出。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'zhaoyun_jiuzhu', name: '救主',
                description: '己方其他角色濒死时，若你体力>1，你可失去1点体力并弃一张牌，令其回复1点体力。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DYING,
            },
        ],
    },

    {
        id: 'sunshangxiang', name: '孙尚香', maxHp: 3, gender: 'female', kingdom: 'wu',
        skills: [
            {
                id: 'sunshangxiang_jieyin', name: '结姻',
                description: '出牌阶段限一次，你可弃置两张手牌并选择一名已受伤的男性角色，你与其各回复1点体力。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'sunshangxiang_xiaoji', name: '枭姬',
                description: '当你失去装备区里的一张牌时，你可摸两张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_LOSE_EQUIP,
            },
        ],
    },

    // ══════════════════════════════════════════
    // 平衡版（40 个）
    // ══════════════════════════════════════════

    // ── 辅助（6 个）──
    {
        id: 'guojia_jie', name: '界郭嘉', maxHp: 3, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'guojia_jie_tiandu', name: '天妒',
                description: '当你的判定牌生效后，你可以获得之。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_JUDGE,
            },
            {
                id: 'guojia_jie_yiji', name: '遗计',
                description: '当你受到1点伤害后，你可以摸两张牌，然后你可以将至多两张手牌分配给其他角色。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
        ],
    },

    {
        id: 'liubei_jie', name: '界刘备', maxHp: 4, gender: 'male', kingdom: 'shu',
        skills: [{
            id: 'liubei_jie_rende', name: '仁德',
            description: '出牌阶段，你可以交给一名本阶段未获得过“仁德”牌的其他角色任意张手牌，然后若你此次给出了本阶段的第二张“仁德”牌，你可以视为使用一张基本牌（可视为使用【火杀】【雷杀】【杀】【桃】【酒】；以此法使用的虚拟【杀】有距离限制）。',
            type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
        }],
    },

    // 小乔（xiaoqiao）：同 2013 经典版
    // 诸葛瑾-竞（zhugejin_jing）：同 2013 经典版
    {
        id: 'chengong', name: '陈宫', maxHp: 3, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'chengong_mingce', name: '明策',
                description: '出牌阶段限一次，你可将一张装备牌或【杀】交给一名其他角色，然后其选择：视为对其攻击范围内由你指定的一名角色使用一张【杀】；或摸一张牌。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'chengong_zhichi', name: '智迟',
                description: '锁定技，你于回合外受到伤害后，本回合【杀】和普通锦囊牌对你无效。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
        ],
    },

    {
        id: 'simayi_jing', name: '司马懿-竞', maxHp: 3, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'simayi_jing_guicai', name: '鬼才',
                description: '一名角色的判定牌生效前，你可打出一张牌（手牌或装备区的牌）代替之。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_JUDGE,
            },
            {
                id: 'simayi_jing_jiaozhao', name: '矫诏',
                description: '出牌阶段限一次，你可以将一张牌当任意基本牌使用。修改一：每轮限一次，你可以将一张牌当任意基本牌或普通锦囊牌使用。修改二：每轮限一次，你可以视为使用一张基本牌或普通锦囊牌。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'simayi_jing_cangqi', name: '藏器',
                description: '当你受到1点伤害后，你可以获得伤害来源的一张牌，修改一次“矫诏”。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
        ],
    },

    // ── 牌差（10 个）──
    // 孙权（sunquan）：同 2013 经典版
    // 黄月英（huangyueying）：同 2013 经典版
    {
        id: 'lidian_jie', name: '界李典', maxHp: 3, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'lidian_xunxun', name: '恂恂',
                description: '摸牌阶段开始时，你可以观看牌堆顶四张牌，将其中两张以任意顺序置于牌堆顶，其余置于牌堆底。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DRAW_CARDS,
            },
            {
                id: 'lidian_wangxi', name: '忘隙',
                description: '当你对其他角色造成1点伤害后，或受到其他角色造成的1点伤害后，你可以摸两张牌，交给其一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
        ],
    },

    // 黄盖（huanggai）：同 2013 经典版
    {
        id: 'zhouyu_jie', name: '界周瑜', maxHp: 3, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'zhouyu_jie_yingzi', name: '英姿',
                description: '锁定技，摸牌阶段你多摸一张牌；你的手牌上限等于体力上限。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_DRAW_CARDS,
            },
            {
                id: 'zhouyu_jie_fanjian', name: '反间',
                description: '出牌阶段限一次，你可以展示一张手牌，将其交给一名敌方角色并令其本回合非锁定技失效，然后其选择一项：1.展示所有手牌并弃置与其花色相同的所有牌（至少两张）；2.失去1点体力。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },

    {
        id: 'huangquan_jing', name: '黄权-竞', maxHp: 3, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'huangquan_dianhu', name: '点虎',
                description: '锁定技，游戏开始前，你令一名敌方角色获得“筹进”标记。每回合限两次，己方角色对拥有“筹进”标记的角色造成伤害后摸一张牌。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_DAMAGE_DEALT,
            },
            {
                id: 'huangquan_jianji', name: '谏计',
                description: '出牌阶段限一次，你可以令一名其他角色摸一张牌，然后其可以使用该牌。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },

    // 甄姬（zhenji）：同 2013 经典版
    {
        id: 'guyong', name: '顾雍', maxHp: 3, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'guyong_shenxing', name: '慎行',
                description: '出牌阶段，你可以弃置两张牌，然后摸一张牌。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'guyong_bingyi', name: '秉壹',
                description: '结束阶段，你可以展示所有手牌。若你的手牌颜色均相同，你令至多等同于你手牌数名角色各摸一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },

    {
        id: 'yufan', name: '虞翻', maxHp: 3, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'yufan_zongxuan', name: '纵玄',
                description: '当你的牌因弃置而置入弃牌堆时，你可以将其中任意张牌置于牌堆顶。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DISCARD,
            },
            {
                id: 'yufan_zhiyan', name: '直言',
                description: '结束阶段，你可以令一名角色摸一张牌并展示之，若此牌为装备牌，其使用此牌并回复1点体力。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },

    // 姜维（jiangwei）：同 2013 经典版

    // ── 菜刀（7 个）──
    // 张飞（zhangfei）：同 2013 经典版
    {
        id: 'xuchu_jie', name: '界许褚', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [{
            id: 'xuchu_jie_luoyi', name: '裸衣',
            description: '摸牌阶段开始时，你可以亮出牌堆顶三张牌，获得其中的基本牌、武器牌或【决斗】并放弃摸牌；直到你的下回合开始，你为伤害来源的【杀】或【决斗】造成的伤害+1。',
            type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DRAW_CARDS,
        }],
    },

    {
        id: 'lvbu_jing', name: '吕布-竞', maxHp: 4, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'lvbu_jing_wushuang', name: '无双',
                description: '锁定技，①当你使用【杀】指定一名角色为目标后，其需连续使用两张【闪】才能抵消；②当你使用【决斗】指定其他角色为目标后，或成为其他角色使用【决斗】的目标后，其每次响应需连续打出两张【杀】。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'lvbu_jing_zhanshen', name: '战神',
                description: '准备阶段，你选择一项未获得的效果获得直到本局结束：1.摸牌阶段，你多摸一张牌；2.你使用【杀】造成的伤害+1；3.你使用【杀】可以额外选择一个目标。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ON_TURN_START,
            },
            {
                id: 'lvbu_jing_xiaoxiong', name: '虓雄',
                description: '先锋技，当你的身份为先锋时，“战神”增加第四个效果：出牌阶段，你可以多使用一张【杀】。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_START,
            },
        ],
    },

    {
        id: 'machao_jie', name: '界马超', maxHp: 4, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'machao_mashu', name: '马术',
                description: '锁定技，你计算与其他角色的距离-1。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'machao_jie_tieqi', name: '铁骑',
                description: '当你使用【杀】指定目标后，你可以令其本回合所有非锁定技失效，然后判定；除非其弃置一张与判定结果花色相同的牌，否则其不能使用【闪】响应此【杀】。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },

    {
        id: 'zhoucang', name: '周仓', maxHp: 4, gender: 'male', kingdom: 'shu',
        skills: [{
            id: 'zhoucang_zhongyong', name: '忠勇',
            description: '当你对其他角色使用【杀】结算结束后，你可以将此【杀】或目标角色使用的【闪】交给另一名其他角色，然后若你交给其的牌为红色，其可以对你攻击范围内的一名角色使用一张【杀】。',
            type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
        }],
    },

    {
        id: 'fuwan', name: '伏完', maxHp: 4, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'fuwan_moukui', name: '谋溃',
                description: '当你使用【杀】指定一名角色为目标后，你可以选择一项：1.摸一张牌；2.弃置该角色的一张牌。你可以同时选择两项，若如此做，当此【杀】被无效或抵消时，该角色弃置你一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },

    // 庞德（pangde）：同 2013 经典版

    // ── 直伤（4 个）──
    {
        id: 'zhangjiao', name: '张角', maxHp: 3, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'zhangjiao_leiji', name: '雷击',
                description: '当你使用或打出【闪】时，你可以令一名其他角色进行一次判定，若结果为：♠，你对其造成2点雷电伤害；♣，你回复1点体力并对其造成1点雷电伤害。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'zhangjiao_guidao', name: '鬼道',
                description: '当一名角色的判定牌生效前，你可以打出一张黑色牌替换之。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_JUDGE,
            },
        ],
    },

    // 贾诩（jiaxu）：同 2013 经典版
    // 貂蝉（diaochan）：同 2013 经典版
    {
        id: 'dianwei_jie', name: '界典韦', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [{
            id: 'dianwei_jie_qiangxi', name: '强袭',
            description: '出牌阶段限两次，你可以受到1点伤害或弃置一张武器牌，对一名其他角色造成1点伤害（每名角色每阶段限一次）。',
            type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
        },
        {
            id: 'dianwei_jie_ninge', name: '狞恶',
            description: '锁定技，当一名角色每回合第二次受到伤害后，若受伤角色或伤害来源为你，你摸一张牌并弃置其场上一张牌。',
            type: SkillType.LOCKED, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
        }],
    },

    // ── 控制（6 个）──
    // 大乔（daqiao）：同 2013 经典版
    {
        id: 'ganning_jie', name: '界甘宁', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'ganning_qixi', name: '奇袭',
                description: '你可将一张黑色牌当【过河拆桥】使用。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'ganning_jie_fenwei', name: '奋威',
                description: '限定技，当一张锦囊牌指定至少两个目标后，你可以令此牌对其中任意名目标角色无效。',
                type: SkillType.LIMITED, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },

    // 徐晃-竞（xuhuang_jing）：同 2013 经典版
    // 诸葛亮（zhugeliang）：同 2013 经典版
    // 文聘-竞（wenpin_jing）：同 2013 经典版
    {
        id: 'zhangliao_jie', name: '界张辽', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [{
            id: 'zhangliao_jie_tuxi', name: '突袭',
            description: '摸牌阶段，你可以少摸任意张牌，然后获得等量名其他角色的各一张手牌。',
            type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DRAW_CARDS,
        }],
    },

    // ── 防御（4 个）──
    {
        id: 'xiahoudun_jing', name: '夏侯惇-竞', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'xiahoudun_jing_ganglie', name: '刚烈',
                description: '当你受到伤害后，你可以令一名敌方角色进行一次判定，若结果不为♥，其选择一项：1.弃置两张手牌；2.受到你对其造成的1点伤害。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
            {
                id: 'xiahoudun_qingjian', name: '清俭',
                description: '每回合限一次，当你于你的摸牌阶段外获得牌后，你可以展示任意张牌并将这些牌交给一名其他角色，然后当前回合角色本回合的手牌上限+X（X为给出的牌包含的类别数）。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DRAW_CARDS,
            },
        ],
    },

    {
        id: 'caocao_jie', name: '界曹操', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [{
            id: 'caocao_jie_jianxiong', name: '奸雄',
            description: '当你受到伤害后，你可以获得对你造成伤害的牌并摸一张牌。',
            type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
        }, {
            id: 'caocao_jie_qingzheng', name: '清正',
            description: '出牌阶段开始时，你可以弃置手牌中一种花色的所有牌，并观看一名有手牌的其他角色的手牌，弃置其中一种花色的所有牌，若其被弃置的牌数小于你弃置的牌数，你对其造成1点伤害。',
            type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_START,
        }, {
            id: 'caocao_jie_shuzhi', name: '述志',
            description: '游戏开始时，你将【清正】或【奸雄】之一修改为限定技。',
            type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_START,
        }],
    },

    {
        id: 'sunce_jie', name: '界孙策', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'sunce_jie_jiang', name: '激昂',
                description: '①当你使用【决斗】或红色【杀】指定目标后，或成为【决斗】或红色【杀】的目标后，你可以摸一张牌；②当每回合首次有【决斗】和红色【杀】因弃置进入弃牌堆后，你可以失去1点体力并获得之。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'sunce_jie_hunzi', name: '魂姿',
                description: '觉醒技，准备阶段，若你的体力值为1，你减1点体力上限，获得界“英姿”和“英魂”，然后本回合结束阶段，你选择一项：1.摸两张牌；2.回复1点体力。',
                type: SkillType.AWAKENED, trigger: SkillTrigger.ON_TURN_START,
            },
        ],
    },

    {
        id: 'sunjian_jie', name: '界孙坚', maxHp: 5, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'sunjian_jie_yinghun', name: '英魂',
                description: '游戏开始时，你失去1点体力。准备阶段，若你已受伤，你可以选择一名其他角色并选择一项令其执行之：1.摸X张牌并弃置一张牌；2.摸一张牌并弃置X张牌（X为你已损失的体力值）。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_START,
            },
            {
                id: 'sunjian_wulie', name: '武烈', description: '限定技，结束阶段，你可以失去任意点体力，令等量的其他角色各获得1个“烈”标记（有“烈”的角色受到伤害时，防止此伤害，然后移去“烈”）。',
                type: SkillType.LIMITED, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },

    // ── 回复（3 个）──
    // 华佗（huatuo）：同 2013 经典版
    // 赵云-竞（zhaoyun_jing）：同 2013 经典版
    // 孙尚香（sunshangxiang）：同 2013 经典版

    // ══════════════════════════════════════════
    // 平衡拓展版（60 个）
    // ══════════════════════════════════════════

    // ── 辅助（9 个）──
    // 界郭嘉（guojia_jie）：同平衡版
    // 界刘备（liubei_jie）：同平衡版
    {
        id: 'luxun_jie', name: '界陆逊', maxHp: 3, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'luxun_jie_qianxun', name: '谦逊',
                description: '当一张延时锦囊牌或其他角色使用的普通锦囊牌对你生效时，若你是此牌的唯一目标，你可以将所有手牌置于武将牌上，然后于当前回合结束时获得之。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USED_AS_TARGET,
            },
            {
                id: 'luxun_jie_lianying', name: '连营',
                description: '当你失去最后的手牌后，你可以令至多X名角色各摸一张牌（X为你此次失去的手牌数）。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DISCARD,
            },
        ],
    },

    {
        id: 'sunqian', name: '孙乾', maxHp: 3, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'sunqian_qianya', name: '谦雅',
                description: '当你成为锦囊牌的目标后，你可以将任意张手牌交给一名其他角色。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USED_AS_TARGET,
            },
            {
                id: 'sunqian_shuomeng', name: '说盟',
                description: '出牌阶段结束时，你可以与一名角色拼点：若你赢，你摸一张牌；若你没赢，其摸一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },

    // 小乔（xiaoqiao）：同2013 经典版
    // 诸葛瑾-竞（zhugejin_jing）：同2013 经典版
    {
        id: 'sunshangxiang_sp', name: 'SP孙尚香', maxHp: 3, gender: 'female', kingdom: 'shu',
        skills: [
            {
                id: 'sp_sunshangxiang_liangzhu', name: '良助',
                description: '当一名角色于其出牌阶段内回复体力后，你可以选择一项：1.摸一张牌；2.令其摸两张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_HP_CHANGED,
            },
            {
                id: 'sp_sunshangxiang_fanxiang', name: '返乡',
                description: '觉醒技，准备阶段，若场上有已受伤且你发动过“良助”令其摸牌的角色，你加1点体力上限并回复1点体力，然后失去“良助”并获得“枭姬”。',
                type: SkillType.AWAKENED, trigger: SkillTrigger.ON_TURN_START,
            },
        ],
    },

    // 陈宫（chengong）：同平衡版
    // 司马懿-竞（simayi_jing）：同平衡版

    // ── 牌差（14 个）──
    // 孙权（sunquan）：同2013 经典版
    // 黄月英（huangyueying）：同2013 经典版
    // 界李典（lidian_jie）：同平衡版
    {
        id: 'wangji', name: '王基', maxHp: 3, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'wangji_qizhi', name: '奇制',
                description: '当你于回合内使用一张非装备牌指定目标后，你可以弃置不是此牌目标的一名角色的一张牌，然后该角色摸一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'wangji_jinqu', name: '进趋',
                description: '结束阶段，你可以摸两张牌，然后将手牌弃置至X张（X为你本回合发动“奇制”的次数）。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },

    // 黄盖（huanggai）：同2013 经典版
    {
        id: 'jushou', name: '沮授', maxHp: 3, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'jushou_jianying', name: '渐营',
                description: '当你于出牌阶段内使用与此阶段上一张使用的牌花色或点数相同的牌时，你可以摸一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'jushou_shibei', name: '矢北',
                description: '锁定技，当你受到伤害后：若此伤害是你本回合第一次受到的伤害，你回复1点体力；否则你失去1点体力。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
        ],
    },

    {
        id: 'wangping', name: '王平', maxHp: 4, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'wangping_feijun', name: '飞军',
                description: '出牌阶段限一次，你可以弃置一张牌，然后选择一项：1.令一名手牌数大于你的角色交给你一张牌；2.令一名装备区里牌数大于你的角色弃置一张装备区里的牌。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'wangping_binglue', name: '兵略',
                description: '锁定技，当你对每名其他角色第一次发动“飞军”时，你摸两张牌。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },

    // 界周瑜（zhouyu_jie）：同平衡版
    // 黄权-竞（huangquan_jing）：同平衡版
    // 甄姬（zhenji）：同2013 经典版
    // 顾雍（guyong）：同平衡版
    // 虞翻（yufan）：同平衡版
    // 姜维（jiangwei）：同2013 经典版
    {
        id: 'zumao', name: '祖茂', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'zumao_yinbing', name: '引兵',
                description: '出牌阶段结束时，你可以将任意张非基本牌置于你的武将牌上；当你受到【杀】或【决斗】造成的伤害后，你移去一张“引兵”牌，然后摸一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
            {
                id: 'zumao_juedi', name: '绝地',
                description: '锁定技，准备阶段，若你的武将牌上有“引兵”牌，你选择一项：1.移去所有“引兵”牌，将手牌摸至体力上限；2.令一名体力值不大于你的其他角色获得所有“引兵”牌，然后其回复1点体力并摸等量的牌。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_TURN_START,
            },
        ],
    },

    // ── 菜刀（11 个）──
    // 张飞（zhangfei）：同2013 经典版
    // 界许褚（xuchu_jie）：同平衡版
    // 吕布-竞（lvbu_jing）：同平衡版
    // 界马超（machao_jie）：同平衡版
    {
        id: 'dingfeng', name: '丁奉', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'dingfeng_duanbing', name: '短兵',
                description: '当你使用【杀】时，可以额外选择一名距离为1的角色为目标；当你使用【杀】指定距离为1的角色为目标后，其需使用两张【闪】才能抵消。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'dingfeng_fenxun', name: '奋迅',
                description: '出牌阶段限一次，你可以令你本回合计算与一名其他角色的距离视为1，然后直到此回合结束时，若你未对其造成过伤害，你弃置一张牌。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },

    {
        id: 'madai', name: '界马岱', maxHp: 4, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'madai_mashu', name: '马术',
                description: '锁定技，你计算与其他角色的距离-1。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'madai_qianxi', name: '潜袭',
                description: '出牌阶段开始时，你可以展示一张牌，令距离为1的其他角色本回合不能使用或打出与展示牌颜色相同的手牌。若如此做，你本回合使用此牌造成的伤害+1。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_START,
            },
        ],
    },

    {
        id: 'litong', name: '李通', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [{
            id: 'litong_tuifeng', name: '推锋',
            description: '当你受到1点伤害后，你可以将一张牌置于武将牌上，称为“锋”。准备阶段，你移去所有“锋”，摸等量的牌，然后本回合你使用【杀】的次数上限+X（X为移去的“锋”数）。',
            type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
        }],
    },

    {
        id: 'lingcao', name: '凌操', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [{
            id: 'lingcao_dufeng', name: '独锋',
            description: '锁定技，出牌阶段开始时，你选择至少一项：1.失去1点体力；2.废除一个装备栏。然后你摸X张牌，且本阶段攻击范围与使用【杀】的次数上限+X-1（X=已废除装备栏数+已损失体力值，至多体力上限）。',
            type: SkillType.LOCKED, trigger: SkillTrigger.ON_TURN_START,
        }],
    },

    // 周仓（zhoucang）：同平衡版
    // 伏完（fuwan）：同平衡版
    // 庞德（pangde）：同2013 经典版

    // ── 直伤（7 个）──
    // 张角（zhangjiao）：同平衡版
    // 贾诩（jiaxu）：同2013 经典版
    // 貂蝉（diaochan）：同2013 经典版
    // 界典韦（dianwei_jie）：同平衡版
    {
        id: 'zhugeke', name: '诸葛恪', maxHp: 3, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'zhugeke_aocai', name: '傲才',
                description: '你的回合外，每当你需要使用或打出一张基本牌时，你可以观看牌堆顶的两张牌，然后使用或打出其中一张。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'zhugeke_duwu', name: '黩武',
                description: '出牌阶段，你可以弃置X张牌，对你攻击范围内的一名其他角色造成1点伤害（X为其体力值）；若其因此进入濒死，结算后你失去1点体力且本阶段此技能失效。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },

    {
        id: 'yuejin', name: '乐进', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [{
            id: 'yuejin_xiaoguo', name: '骁果',
            description: '其他角色的结束阶段，你可以弃置一张手牌，令该角色选择一项：1.弃置一张装备牌且你摸一张牌；2.受到1点伤害。',
            type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
        }],
    },

    {
        id: 'caifuren', name: '蔡夫人', maxHp: 3, gender: 'female', kingdom: 'qun',
        skills: [
            {
                id: 'caifuren_qieting', name: '窃听',
                description: '其他角色的回合结束时，若其本回合没有对其他角色使用过牌，你可以选择一项：1.将其装备区里的一张牌置入你的装备区；2.摸一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
            {
                id: 'caifuren_xianzhou', name: '献州',
                description: '限定技，出牌阶段，你可以将装备区里的所有牌交给一名其他角色，然后该角色选择一项：1.令你回复X点体力；2.对其攻击范围内的至多X名角色各造成1点伤害（X为你交给其的牌数）。',
                type: SkillType.LIMITED, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },

    // ── 控制（8 个）──
    // 大乔（daqiao）：同2013 经典版
    // 界甘宁（ganning_jie）：同平衡版
    // 徐晃-竞（xuhuang_jing）：同2013 经典版
    {
        id: 'lingtong', name: '凌统', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [{
            id: 'lingtong_xuanfeng', name: '旋风',
            description: '当你于弃牌阶段弃置至少两张牌，或当你失去装备区里的牌后，你可以依次弃置任意名其他角色的共计至多两张牌。',
            type: SkillType.PASSIVE, trigger: SkillTrigger.ON_LOSE_EQUIP,
        }],
    },

    {
        id: 'xunyou', name: '界荀攸', maxHp: 3, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'xunyou_qice', name: '奇策',
                description: '出牌阶段限一次，你可以将所有手牌当【无中生有】【决斗】【过河拆桥】或【顺手牵羊】使用。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'xunyou_zhiyu', name: '智愚',
                description: '当你受到伤害后，你可以摸一张牌并展示所有手牌，然后令伤害来源弃置一张手牌。若你的手牌颜色均相同，你获得弃置的牌且“奇策”的发动次数上限+1直到你的回合结束。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
        ],
    },

    // 诸葛亮（zhugeliang）：同2013 经典版
    // 文聘-竞（wenpin_jing）：同2013 经典版
    // 界张辽（zhangliao_jie）：同平衡版

    // ── 防御（7 个）──
    // 夏侯惇-竞（xiahoudun_jing）：同平衡版
    {
        id: 'dengai', name: '界邓艾', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'dengai_tuntian', name: '屯田',
                description: '当你于回合外失去牌后，或于回合内弃置【杀】后，你可以进行一次判定，若结果不为♥，你将此判定牌置于你的武将牌上，称为“田”（你计算与其他角色的距离-X，X为“田”的数量）。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DISCARD,
            },
            {
                id: 'dengai_zaoxian', name: '凿险',
                description: '觉醒技，准备阶段，若“田”数不小于3，你减1点体力上限，然后获得技能“急袭”。',
                type: SkillType.AWAKENED, trigger: SkillTrigger.ON_TURN_START,
            },
            {
                id: 'dengai_jixi', name: '急袭',
                description: '出牌阶段，你可以将一张“田”当【顺手牵羊】使用。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },

    {
        id: 'wangyi', name: '王异', maxHp: 3, gender: 'female', kingdom: 'wei',
        skills: [
            {
                id: 'wangyi_zhenlie', name: '贞烈',
                description: '当你成为其他角色使用【杀】或普通锦囊牌的目标后，你可以失去1点体力，令此牌对你无效，然后你弃置其一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USED_AS_TARGET,
            },
            {
                id: 'wangyi_miji', name: '秘计',
                description: '结束阶段，你可以摸X张牌（X为你已损失的体力值），然后可以将等量的手牌交给其他角色。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },

    // 界曹操（caocao_jie）：同平衡版
    {
        id: 'yanyan', name: '严颜', maxHp: 4, gender: 'male', kingdom: 'shu',
        skills: [{
            id: 'yanyan_juzhan', name: '拒战',
            description: '转换技，阳：当你成为其他角色使用【杀】的目标后，你可以与其各摸一张牌，然后其本回合不能再对你使用牌；阴：当你使用【杀】指定目标后，你可以获得其一张牌，然后你本回合不能再对其使用牌。',
            type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
        }],
    },

    // 界孙策（sunce_jie）：同平衡版
    // 界孙坚（sunjian_jie）：同平衡版

    // ── 回复（4 个）──
    // 华佗（huatuo）：同2013 经典版
    // 赵云-竞（zhaoyun_jing）：同2013 经典版
    // 孙尚香（sunshangxiang）：同2013 经典版
    {
        id: 'chengpu', name: '程普', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'chengpu_lihuo', name: '疠火',
                description: '①当你使用火【杀】时，你可以多选择一个目标；②当你使用普通【杀】时，你可以将此【杀】改为火【杀】，然后此【杀】结算结束后，若此【杀】造成过伤害，你失去1点体力。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'chengpu_chunlao', name: '醇醪',
                description: '结束阶段，若你的武将牌上没有“醇”，你可以将任意张【杀】置于你的武将牌上，称为“醇”（当一名角色处于濒死状态时，你可以移去一张“醇”，令该角色视为使用一张【酒】）。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },

    // ══════════════════════════════════════════
    // 乱斗版（186 个）
    // ══════════════════════════════════════════

    // ── 特殊（1 个）──
    {
        id: 'xushao', name: '许劭', maxHp: 3, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'xushao_pingjian', name: '评荐',
                description: '出牌阶段限一次，或结束阶段，或当你受到伤害后，你可以从对应时机的技能池中随机抽取三个技能，然后你选择并获得其中一个技能直到时机结束或你发动完此技能或你再次发动“评荐”（每个技能限获得一次）。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },

    // ── 辅助（33 个）──
    // ── 主动补牌（14 个）──
    // 界刘备（liubei_jie）：同平衡版
    {
        id: 'lusu_jie', name: '界鲁肃', maxHp: 3, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'lusu_jie_haoshi', name: '好施',
                description: '摸牌阶段，你可以多摸两张牌，然后若你的手牌数大于5，你将一半的手牌（向下取整）交给手牌最少的一名其他角色。然后直到你的下个回合开始，当你成为【杀】或普通锦囊牌的目标后，其可以交给你一张手牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DRAW_CARDS,
            },
            {
                id: 'lusu_jie_dimeng', name: '缔盟',
                description: '出牌阶段限一次，你可以选择X不大于你的牌数的两名其他角色（X为这两名角色手牌数的差），令这两名角色交换手牌。若如此做，此阶段结束时，你弃置X张牌。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },
    {
        id: 'zhangsong_jie', name: '界张松', maxHp: 3, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'zhangsong_qiangshi', name: '强识',
                description: '出牌阶段开始时，你可以观看一名其他角色的手牌并展示其中一张牌，然后你本阶段使用此类别的牌后可摸一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_START,
            },
            {
                id: 'zhangsong_xiantu', name: '献图',
                description: '其他角色出牌阶段开始时，你可以摸至多两张牌，然后交给其等量牌。此阶段结束时，若其造成伤害小于你以此法交给其的牌数，你失去1点体力。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_START,
            },
        ],
    },
    {
        id: 'caorui', name: '曹叡', maxHp: 3, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'caorui_huituo', name: '恢拓',
                description: '当你受到伤害后，你可以令一名角色进行一次判定，若结果为：红色，其回复1点体力；黑色，其摸X张牌（X为此伤害的伤害值）。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
            {
                id: 'caorui_mingjian', name: '明鉴',
                description: '出牌阶段限一次，你可以将所有手牌交给一名其他角色，然后该角色的下个回合：手牌上限+1、出牌阶段内使用【杀】的次数上限+1。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },
    {
        id: 'liuxie', name: '刘协', maxHp: 3, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'liuxie_tianming', name: '天命',
                description: '当你成为【杀】的目标后，你可以弃置两张牌（不足则全弃）并摸两张牌。然后全场体力值唯一最多的其他角色也可以如此做。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USED_AS_TARGET,
            },
            {
                id: 'liuxie_mizhao', name: '密诏',
                description: '出牌阶段限一次，你可以将所有手牌（至少一张）交给一名其他角色，令其与你选择的另一名其他角色拼点。赢的角色视为对没赢的角色使用一张普通【杀】。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },
    {
        id: 'sunqian_jie', name: '界孙乾', maxHp: 3, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'sunqian_jie_qianya', name: '谦雅',
                description: '当你成为锦囊牌的目标后，你可以将任意张手牌交给一名其他角色。每阶段限一次，若你以此法交给了一名角色所有手牌或交给其他角色的手牌数大于等于你的体力值，则你可以摸一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USED_AS_TARGET,
            },
            {
                id: 'sunqian_jie_shuomeng', name: '说盟',
                description: '出牌阶段结束时，你可以与一名角色拼点，若你赢，视为你使用【无中生有】；若你没赢，视为其对你使用【过河拆桥】。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },
    {
        id: 'xujing', name: '许靖', maxHp: 3, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'xujing_yuxu', name: '誉虚',
                description: '出牌阶段，当你使用牌结算结束后，你可以摸一张牌，然后你本阶段下一次使用牌结算结束后，你不能发动此技能且弃置一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'xujing_shijian', name: '实荐',
                description: '当一名其他角色于其出牌阶段第二次使用牌结算结束后，你可以弃置一张牌，令其本回合获得技能“誉虚”。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },

    {
        id: 'guyong_jie', name: '界顾雍', maxHp: 3, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'guyong_jie_shenxing', name: '慎行',
                description: '出牌阶段限X次（X为你的体力值），你可以弃置两张牌，若弃置牌颜色不同，则你摸两张牌；否则你摸一张牌。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'guyong_jie_bingyi', name: '秉壹',
                description: '结束阶段，你可以展示所有手牌，若颜色均相同或类型均相同，你选择至多X名角色（X为你的手牌数），这些角色各摸一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },
    {
        id: 'kanze', name: '阚泽', maxHp: 3, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'kanze_xiashu', name: '下书',
                description: '出牌阶段开始时，你可以将所有手牌交给一名其他角色，令该角色展示任意张手牌，然后你选择一项：1.获得其展示的手牌；2.获得其未展示的手牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_START,
            },
            {
                id: 'kanze_kuanshi', name: '宽释',
                description: '结束阶段，你可以选择一名角色。直到你的下个回合开始，当其下一次受到大于1点的伤害时，防止此伤害，然后你跳过你的下个回合的摸牌阶段。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },
    {
        id: 'xuhuang_xing', name: '星徐晃', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'xuhuang_xing_zhiyan', name: '治严',
                description: '出牌阶段各限一次，你可以将数量大于体力值的手牌交给一名其他角色，或将手牌数补至体力上限。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },
    {
        id: 'dengzhi', name: '邓芝', maxHp: 4, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'dengzhi_xiuhao', name: '修好',
                description: '每回合限一次，当你对其他角色造成伤害时，或受到其他角色造成的伤害时，你可以防止此伤害，然后伤害来源摸两张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
            {
                id: 'dengzhi_sujian', name: '素俭',
                description: '锁定技，弃牌阶段，你改为选择不为本回合获得的所有手牌并选择一项：1.将选择的牌分配给其他角色；2.弃置选择的牌，然后弃置一名其他角色至多等量张牌。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_DISCARD,
            },
        ],
    },
    {
        id: 'huban', name: '胡班', maxHp: 4, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'huban_huiyun', name: '晖云',
                description: '你可以将一张牌当【火攻】使用，然后于此牌结算结束后选择一项（每个选项每轮限一次）：1.令目标可以使用其展示的牌，然后重铸你的所有手牌；2.令目标可以使用一张手牌，然后重铸展示牌；3.令目标摸一张牌。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },
    {
        id: 'maliang', name: '马良', maxHp: 3, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'maliang_zishu', name: '自书',
                description: '锁定技，①其他角色的结束阶段结束时，你将本回合获得的牌置入弃牌堆；②你的回合内，当你不是因此技能获得牌时，你摸一张牌。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_TURN_END,
            },
            {
                id: 'maliang_yingyuan', name: '应援',
                description: '每种类别的牌每回合限一次，当你于回合内使用牌结算结束时，你可以令一名其他角色随机从牌堆中获得一张与此牌类型相同的牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },
    {
        id: 'mazhong', name: '马忠', maxHp: 4, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'mazhong_fuman', name: '抚蛮',
                description: '出牌阶段每名角色限一次，你可以将一张手牌交给一名其他角色并令此牌视为【杀】，然后其使用此【杀】结算结束后，若此【杀】造成过伤害，则你摸两张牌，否则你摸一张牌。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },
    // ── 受伤补牌（4 个）──
    // 界郭嘉（guojia_jie）：同平衡版
    {
        id: 'xunyu', name: '界荀彧', maxHp: 3, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'xunyu_quhu', name: '驱虎',
                description: '出牌阶段限一次，你可以与一名体力值大于你的角色拼点，若你赢，则该角色对其攻击范围内你选择的一名角色造成1点伤害，否则其对你造成1点伤害。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'xunyu_jieming', name: '节命',
                description: '当你受到1点伤害后，你可以选择一项：1.令一名角色摸X张牌，然后其将手牌弃置至X张（X为其体力上限且至多为5）；2.令一名角色摸两张牌，然后若其手牌数小于体力上限，则你可以摸一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
        ],
    },
    // 小乔（xiaoqiao）：同2013经典版
    {
        id: 'xizhicai', name: '戏志才', maxHp: 3, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'xizhicai_tiandu', name: '天妒',
                description: '当你的判定牌生效后，你可以获得之。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_JUDGE,
            },
            {
                id: 'xizhicai_xianfu', name: '先辅',
                description: '锁定技，游戏开始时，你选择一名其他角色。当该角色受到伤害后，你受到等量的伤害；当该角色回复体力后，你回复等量的体力。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
            {
                id: 'xizhicai_chouce', name: '筹策',
                description: '当你受到1点伤害后，你可以进行一次判定，若结果为黑色，你弃置一名角色区域里的一张牌；若结果为红色，你令一名角色摸一张牌（若其为“先辅”角色，其改为摸两张牌）。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
        ],
    },
    // ── 条件补牌（9 个）──
    // 界陆逊（luxun_jie）：同平衡拓展版
    {
        id: 'zhongyao', name: '钟繇', maxHp: 3, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'zhongyao_huomo', name: '活墨',
                description: '当你需要使用基本牌时（你本回合使用过的基本牌除外），你可以将一张黑色非基本牌置于牌堆顶，视为使用此基本牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'zhongyao_zuoding', name: '佐定',
                description: '当其他角色于其出牌阶段内使用黑桃牌指定目标后，若本阶段没有角色受到过伤害，你可以令其中一名目标角色摸一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },
    {
        id: 'chenqun', name: '陈群', maxHp: 3, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'chenqun_pindi', name: '品第',
                description: '出牌阶段，你可以弃置一张牌并选择一名其他角色（每种类别的牌和每名角色每回合各限一次），令其摸X张牌或令其弃置X张牌（X为本回合此技能发动次数）。若其已受伤，你横置。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'chenqun_faen', name: '法恩',
                description: '当一名角色翻至正面或横置后，你可以令其摸一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_HP_CHANGED,
            },
        ],
    },
    // 夏侯惇-竞（xiahoudun_jing）：同平衡版
    {
        id: 'zhoufei', name: '周妃', maxHp: 3, gender: 'female', kingdom: 'wu',
        skills: [
            {
                id: 'zhoufei_liangyin', name: '良姻',
                description: '①当有牌移出游戏时，你可以令一名手牌数大于你的其他角色摸一张牌；②当有游戏外的牌进入角色的手牌区时，你可以令一名手牌数小于你的其他角色弃置一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DISCARD,
            },
            {
                id: 'zhoufei_kongsheng', name: '箜声',
                description: '准备阶段，你可以将任意张牌置于你的武将牌上，然后你于本回合的结束阶段使用这些牌中的装备牌并获得其余的牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_START,
            },
        ],
    },
    {
        id: 'xiahoushi', name: '夏侯氏', maxHp: 3, gender: 'female', kingdom: 'shu',
        skills: [
            {
                id: 'xiahoushi_qiaoshi', name: '樵拾',
                description: '其他角色的结束阶段，若你与其手牌数相等，你可以与其各摸一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
            {
                id: 'xiahoushi_yanyu', name: '燕语',
                description: '出牌阶段，你可以重铸【杀】。出牌阶段结束时，若你于本阶段重铸过至少两张【杀】，你可以令一名男性角色摸两张牌。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },
    // SP孙尚香（sunshangxiang_sp）：同平衡拓展版
    {
        id: 'xushu', name: '界徐庶', maxHp: 4, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'xushu_zhuhai', name: '诛害',
                description: '其他角色的结束阶段，若该角色本回合造成过伤害，你可以对其使用一张【杀】。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
            {
                id: 'xushu_qianxin', name: '潜心',
                description: '觉醒技，当你造成伤害后，若你已受伤，你减1点体力上限，然后获得技能“荐言”。',
                type: SkillType.AWAKENED, trigger: SkillTrigger.ON_DAMAGE_DEALT,
            },
            {
                id: 'xushu_jianyan', name: '荐言',
                description: '出牌阶段限一次，你可以选择一种牌的类别或颜色，然后亮出牌堆中一张符合要求的牌并令一名男性角色获得此牌。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },
    {
        id: 'luzhi', name: '鲁芝', maxHp: 3, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'luzhi_qingzhong', name: '清忠',
                description: '出牌阶段开始时，你可以摸两张牌，然后本阶段结束时，你与一名全场手牌数最少的角色交换手牌。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'luzhi_weijing', name: '卫境',
                description: '每轮限一次，当你需要使用【杀】或【闪】时，你可以视为使用一张【杀】或【闪】。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USED_AS_TARGET,
            },
        ],
    },
    // ── 特殊辅助（6 个）──
    {
        id: 'shenlusu', name: '神鲁肃', maxHp: 3, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'shenlusu_tamo', name: '榻谟',
                description: '限定技，出牌阶段，你失去1点体力，然后重新排列所有角色的座次（此调整不影响行动顺序）。',
                type: SkillType.LIMITED, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'shenlusu_dingzhou', name: '定州',
                description: '出牌阶段限一次，你可以交给一名场上有牌的其他角色X张牌（X为其场上的牌的数量），然后你获得其场上的所有牌。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'shenlusu_zhimeng', name: '智盟',
                description: '回合结束后，你可以选择一名手牌数不大于Y的其他角色（Y为你的手牌数+1），然后随机平分你与其的所有手牌（若这些牌的数量为奇数，则你获得的牌的数量较多）。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },
    {
        id: 'chengong_jie', name: '界陈宫', maxHp: 3, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'chengong_jie_mingce', name: '明策',
                description: '出牌阶段限一次，你可以交给一名其他角色一张装备牌或【杀】，并选择另一名角色，令其选择一项：1.视为对你选择的角色使用一张【杀】，若此【杀】造成过伤害，你与其各摸一张牌；2.令你与其各摸一张牌。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'chengong_jie_zhichi', name: '智迟',
                description: '锁定技，当你于回合外受到伤害后，本回合【杀】和普通锦囊牌对你无效。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
        ],
    },
    {
        id: 'guanping', name: '关平', maxHp: 4, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'guanping_longyin', name: '龙吟',
                description: '当一名角色于其出牌阶段内使用【杀】时，你可以弃置一张牌，令此【杀】不计入此阶段使用次数，若此【杀】为红色，你摸一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },
    {
        id: 'lisu', name: '李肃', maxHp: 4, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'lisu_qiaoyan', name: '巧言',
                description: '锁定技，当其他角色于你的回合外对你造成伤害时，若你有“珠”，则其获得“珠”，否则你防止此伤害，摸一张牌并将一张牌置于你的武将牌上，称为“珠”。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
            {
                id: 'lisu_xianzhu', name: '献珠',
                description: '锁定技，出牌阶段开始时，你令一名角色获得“珠”。若该角色不是你，其视为对你攻击范围内你指定的一名角色使用一张【杀】。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },
    {
        id: 'liushan', name: '刘禅', maxHp: 3, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'liushan_xangle', name: '享乐',
                description: '锁定技，当你成为一名角色使用【杀】的目标后，该角色选择一项：1.弃置一张基本牌；2.令此【杀】对你无效。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USED_AS_TARGET,
            },
            {
                id: 'liushan_fangquan', name: '放权',
                description: '你可以跳过出牌阶段，然后本回合结束时，你可以弃置一张手牌，令一名其他角色执行一个额外的回合。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },
    {
        id: 'panjun', name: '潘濬', maxHp: 3, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'panjun_guanwei', name: '观微',
                description: '每回合限一次，一名角色的出牌阶段结束时，若其本回合使用过至少两张牌且这些牌花色均相同，你可以弃置一张牌，令其摸两张牌并于此阶段结束后执行一个额外的出牌阶段。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
            {
                id: 'panjun_gongqing', name: '公清',
                description: '锁定技，当你受到伤害时，若伤害来源的攻击范围小于3，此伤害调整为1；若大于3，令此伤害+1。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
        ],
    },

    // ── 牌差（38 个）──
    // ── 多摸牌（32 个）──
    {
        id: 'wuxian_zu', name: '族吴苋', maxHp: 3, gender: 'female', kingdom: 'shu',
        skills: [
            {
                id: 'wuxian_zu_yirong', name: '移荣',
                description: '出牌阶段限两次，你可以将手牌摸至/弃置至手牌上限，然后你的手牌上限-1/+1。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'wuxian_zu_guixiang', name: '贵相',
                description: '锁定技，你本回合的第X个阶段开始前，将此阶段改为出牌阶段（X为你的手牌上限）。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_TURN_START,
            },
        ],
    },
    // 界李典（lidian_jie）：同平衡版
    {
        id: 'huangyueying_jie', name: '界黄月英', maxHp: 3, gender: 'female', kingdom: 'shu',
        skills: [
            {
                id: 'huangyueying_jie_jizhi', name: '集智',
                description: '当你使用一张非转化的锦囊牌时，你可以摸一张牌。若此牌为基本牌，你可以弃置此牌，令你本回合的手牌上限+1。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'huangyueying_jie_qicai', name: '奇才',
                description: '锁定技，①你使用锦囊牌无距离限制；②当其他角色弃置你装备区里的防具牌时，取消之。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },
    // 王平（wangping）：同平衡拓展版
    {
        id: 'bulianshi_jie', name: '界步练师', maxHp: 3, gender: 'female', kingdom: 'wu',
        skills: [
            {
                id: 'bulianshi_anxu', name: '安恤',
                description: '出牌阶段限一次，你可以获得两名角色各一张牌。然后你展示一张牌并交给其中手牌较少的角色，若不为黑桃，你摸一张牌。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'bulianshi_zhuiyi', name: '追忆',
                description: '限定技，结束阶段，你可令一名其他角色摸三张牌并回复1点体力。然后你死亡时，可以对其再次发动本技能。',
                type: SkillType.LIMITED, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },
    {
        id: 'zhenji_jie', name: '界甄姬', maxHp: 3, gender: 'female', kingdom: 'wei',
        skills: [
            {
                id: 'zhenji_jie_luoshen', name: '洛神',
                description: '准备阶段，你可以进行判定，若结果为黑色，你获得此牌并可重复此流程（以此法获得的牌不计入本回合的手牌上限）。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_START,
            },
            {
                id: 'zhenji_qingguo', name: '倾国',
                description: '你可以将一张黑色手牌当【闪】使用或打出。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },
    // 黄权-竞（huangquan_jing）：同平衡版
    // 界孙坚（sunjian_jie）：同平衡版
    // 界周瑜（zhouyu_jie）：同平衡版
    {
        id: 'jushou_jie', name: '界沮授', maxHp: 3, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'jushou_jie_jianying', name: '渐营',
                description: '①当你于你的出牌阶段内使用牌时，若此牌与你本阶段使用的上一张牌点数或花色相同，你可以摸一张牌；②出牌阶段限一次，你可以将一张牌当任意一张基本牌使用（若你本阶段使用的上一张牌有花色，此牌花色视为与上一张牌花色相同）。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'jushou_jie_shibei', name: '矢北',
                description: '锁定技，当你受到伤害后，若此次伤害是你本回合受到的第一次伤害，则你回复1点体力，否则你失去1点体力。游戏开始时，你失去1点体力，获得3点护甲。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
        ],
    },
    {
        id: 'handang', name: '韩当', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'handang_gongqi', name: '弓骑',
                description: '出牌阶段限一次，你可以弃置一张牌，令你本阶段的攻击范围无限，然后若此牌为装备牌，你可以弃置一名其他角色的一张牌。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'handang_jiefan', name: '解烦',
                description: '限定技，出牌阶段，你可以选择一名角色，令所有攻击范围内含有其的角色依次选择一项：1.弃置一张武器牌；2.令其摸一张牌。',
                type: SkillType.LIMITED, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },
    {
        id: 'fazheng', name: '法正', maxHp: 3, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'fazheng_enyuan', name: '恩怨',
                description: '①当你一次性获得一名其他角色的至少两张牌后，你可以令其摸一张牌；②当你受到1点伤害后，你可以令伤害来源选择一项：1.交给你一张手牌；2.失去1点体力。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
            {
                id: 'fazheng_xuanhuo', name: '眩惑',
                description: '摸牌阶段，你可以改为令一名其他角色摸两张牌，并选择其攻击范围内的另一名其他角色，然后令该角色选择一项：1.对你选择的角色使用一张【杀】；2.令你获得其两张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DRAW_CARDS,
            },
        ],
    },
    {
        id: 'guotu', name: '郭图逢纪', maxHp: 3, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'guotu_jigong', name: '急攻',
                description: '出牌阶段开始时，你可以摸两张牌，然后你本回合的手牌上限等于你本阶段造成的伤害值。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_START,
            },
            {
                id: 'guotu_shifei', name: '饰非',
                description: '当你需要使用或打出【闪】时，你可以令当前回合角色摸一张牌，然后若其手牌数不是全场唯一最多的，你弃置一名手牌全场最多的角色一张牌，视为你使用或打出一张【闪】。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },
    {
        id: 'quancong', name: '界全琮', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'quancong_yaoming', name: '邀名',
                description: '每回合限一次，当你造成或受到伤害后，你可以选择一名角色，若其手牌数：大于等于你，你弃置其一张牌；小于等于你，其摸一张牌。然后本回合内，你发动【赈赡】无次数限制。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
            {
                id: 'quancong_zhenshan', name: '赈赡',
                description: '每回合限一次，当你需要使用或打出基本牌时，你可以与手牌数小于你的一名角色交换手牌，视为使用或打出之，然后可以发动一次【邀名】。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },
    {
        id: 'kuailiangkuaiyue', name: '蒯良蒯越', maxHp: 3, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'kuailiang_jiandjiang', name: '荐降',
                description: '当你成为其他角色使用牌的目标后，你可以令全场手牌数最少的一名角色摸一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USED_AS_TARGET,
            },
            {
                id: 'kuailiang_shenshi', name: '审时',
                description: '转换技，阳：出牌阶段限一次，你可以将一张牌交给一名手牌数最多（除你以外）的角色，对其造成1点伤害，若该角色因此死亡，你可以令一名角色将手牌摸至四张；阴：当你受到其他角色造成的伤害后，你可以观看该角色的手牌，然后交给其一张牌。若如此做，当前回合结束时，若该角色未失去此牌，你将手牌摸至四张。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },
    {
        id: 'zhoufang', name: '周鲂', maxHp: 3, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'zhoufang_duanfa', name: '断发',
                description: '出牌阶段，你可以弃置任意张黑色牌，然后摸等量的牌（本阶段以此法弃置的牌的总数至多为你的体力上限）。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'zhoufang_youdi', name: '诱敌',
                description: '结束阶段，你可以令一名其他角色弃置你的一张手牌，若此牌不为【杀】，你获得其一张牌；若为黑色牌，你摸一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },
    {
        id: 'guohuai_jie', name: '界郭淮', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'guohuai_jingce', name: '精策',
                description: '①一名角色的出牌阶段结束时，你可以摸你本回合使用过的牌的类别数张牌；②当你于回合内使用每种花色的第一张牌结算结束后，你的手牌上限+1。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },
    {
        id: 'sunxiu', name: '孙休', maxHp: 3, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'sunxiu_yanzhu', name: '宴诛',
                description: '出牌阶段限一次，你可以令一名有牌的其他角色选择一项：1.弃置一张牌；2.令你获得其装备区里的所有牌（至少一张），然后你失去此技能。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'sunxiu_xingxue', name: '兴学',
                description: '结束阶段，你可以令至多X名角色依次摸一张牌并将一张牌置于牌堆顶（若你拥有技能“宴诛”，则X为你的体力值，否则X为你的体力上限）。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },
    {
        id: 'zhuzhi', name: '朱治', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'zhuzhi_anguo', name: '安国',
                description: '出牌阶段限一次，你可以选择一名其他角色，若其手牌数/体力值/装备区内的牌数为全场最少，其摸一张牌/回复1点体力/随机使用一张装备牌。若该角色有未执行的分支且你满足条件，你执行之。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },
    {
        id: 'zhuran_jie', name: '界朱然', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'zhuran_danshou', name: '胆守',
                description: '出牌阶段每项限一次，若你有牌，你可以选择一名角色执行以下一项：1.你弃置其一张牌；2.你获得其一张牌；3.你对其造成1点伤害；4.你与其各摸两张牌。然后你弃置本次执行序号数张牌（不足则全弃）。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },
    {
        id: 'guanqiujian', name: '毌丘俭', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'guanqiujian_zhengrong', name: '征荣',
                description: '当你使用伤害牌指定目标后，你可以将其中一名手牌数不小于你的目标角色的一张牌置于你的武将牌上，称为“荣”。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'guanqiujian_hongju', name: '鸿举',
                description: '觉醒技，准备阶段，若“荣”的数量不小于3，你可以用任意张手牌替换等量的“荣”，然后你减1点体力上限并获得技能“清侧”。',
                type: SkillType.AWAKENED, trigger: SkillTrigger.ON_TURN_START,
            },
        ],
    },
    {
        id: 'xuezong', name: '薛综', maxHp: 3, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'xuezong_funan', name: '复难',
                description: '当其他角色使用或打出牌响应你使用的牌时，你可以令其获得你使用的牌（其本回合不能使用或打出此牌），然后你获得其使用或打出的牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'xuezong_jiexun', name: '诫训',
                description: '结束阶段，你可以令一名其他角色摸等同于场上♦牌数的牌，然后其弃置X张牌（X为此前此技能发动过的次数）。若该角色因此弃置了所有牌，你失去此技能，并将复难改为“当其他角色使用或打出牌响应你使用的牌时，你获得其使用或打出的牌，并可令其获得你使用的牌（其本回合不能使用或打出此牌）。”',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },
    {
        id: 'chenlin', name: '陈琳', maxHp: 3, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'chenlin_bifa', name: '笔伐',
                description: '结束阶段，你可以将一张手牌扣置于一名没有“笔伐”牌的其他角色武将牌上。有“笔伐”牌的角色的回合开始时，其观看此牌并选择一项：1.交给你一张与此牌类别相同的手牌，获得此牌；2.移去此牌，失去1点体力。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
            {
                id: 'chenlin_songci', name: '颂词',
                description: '每名角色限一次，出牌阶段，你可以选择一名手牌数不等于体力值的角色，若该角色的手牌数小于体力值，其摸两张牌；大于体力值，其弃置两张牌。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },
    {
        id: 'pangtong_sp', name: 'SP庞统', maxHp: 3, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'pangtong_sp_guolun', name: '过论',
                description: '出牌阶段限一次，你可以展示一名其他角色的一张手牌，然后你可以用你的一张牌交换此牌。若如此做，交换前点数小的一方摸一张牌。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'pangtong_sp_songsang', name: '送丧',
                description: '限定技，当其他角色死亡时，若你已受伤，则你可以回复1点体力，否则你可以加1点体力上限。若如此做，你获得技能“展骥”。',
                type: SkillType.LIMITED, trigger: SkillTrigger.ON_KILLED,
            },
            {
                id: 'pangtong_sp_zhanji', name: '展骥',
                description: '锁定技，当你于出牌阶段内不因此技能摸牌时，你摸一张牌。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_DRAW_CARDS,
            },
        ],
    },
    {
        id: 'feiyi', name: '费祎', maxHp: 3, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'feiyi_yanru', name: '晏如',
                description: '出牌阶段各限一次，若你的手牌数为：奇数，你可以摸三张牌并弃置至少半数手牌；偶数，你可以弃置至少半数手牌并摸三张牌。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'feiyi_hezhong', name: '和衷',
                description: '每回合各限一次，当你的手牌数变化为1后，你可以展示之并摸一张牌，然后你可以令你本回合使用下一张点数大于/小于展示牌的普通锦囊牌额外结算一次。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DRAW_CARDS,
            },
        ],
    },
    {
        id: 'mengda', name: '孟达', maxHp: 4, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'mengda_goude', name: '苟得',
                description: '一名角色的回合结束时，若与你势力相同的角色于本回合执行过摸牌、弃置一名角色的手牌、视为使用【杀】、变更势力中的任意项，你可以选择一个未被执行过的项并执行。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },
    {
        id: 'luoxian', name: '罗宪', maxHp: 4, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'luoxian_daili', name: '带砺',
                description: '当你的手牌被展示时，你将此牌标记为“带砺”牌：1.“带砺”牌始终对所有角色可见；2.一名角色的回合结束时，若你的“带砺”牌数为偶数，你可以翻面，摸三张牌并展示之。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },
    {
        id: 'liyan', name: '李严', maxHp: 4, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'liyan_duliang', name: '督粮',
                description: '出牌阶段限一次，你可以获得一名其他角色的一张牌并选择一项：1.观看牌堆顶的两张牌，选择其中的至多两张基本牌并令其获得之；2.令其于其下个回合的摸牌阶段多摸一张牌。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'liyan_fulin', name: '腹鳞',
                description: '锁定技，你于回合内获得的牌不计入你本回合的手牌上限。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },
    {
        id: 'lifeng', name: '李丰', maxHp: 3, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'lifeng_tunchu', name: '屯储',
                description: '摸牌阶段，若你的武将牌上没有“粮”，你可以多摸两张牌，然后你可以将任意张手牌置于你的武将牌上，称为“粮”（当你的武将牌上有“粮”时，你不能使用【杀】）。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DRAW_CARDS,
            },
            {
                id: 'lifeng_shuliang', name: '输粮',
                description: '一名角色的结束阶段，若该角色的手牌数小于体力值，你可以移去一张“粮”，令其摸两张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },
    {
        id: 'shamoke', name: '沙摩柯', maxHp: 4, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'shamoke_jili', name: '蒺藜',
                description: '当你于一回合内使用或打出第X张牌时，你可以摸X张牌（X为你的攻击范围）。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },
    {
        id: 'sundeng', name: '孙登', maxHp: 3, gender: 'male', kingdom: 'wu',
        skills: [{
            id: 'sundeng_kuangbi', name: '匡弼',
            description: '出牌阶段限一次，你可以令一名其他角色将至多三张牌置于你的武将牌上。若如此做，你的下个回合开始时，你获得这些牌，然后该角色摸等量的牌。',
            type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
        }],
    },
    // 祖茂（zumao）：同平衡拓展版
    // ── 少弃牌（2 个）──
    {
        id: 'zhangzhaozhanghong_jie', name: '界张昭张纮', maxHp: 3, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'zhangzhao_zhijian', name: '直谏',
                description: '出牌阶段，你可以将一张装备牌置入一名其他角色的装备区（可替换原装备），然后摸一张牌。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'zhangzhao_guzheng', name: '固政',
                description: '每阶段限一次，当其他角色的至少两张牌因弃置而置入弃牌堆后，你可以将其中一张牌交给该角色，然后你可以获得其余的牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DISCARD,
            },
        ],
    },
    {
        id: 'lvmeng_jie', name: '界吕蒙', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'lvmeng_jie_keji', name: '克己',
                description: '若你未于本回合的出牌阶段内使用或打出过【杀】，你可以跳过弃牌阶段。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_DISCARD,
            },
            {
                id: 'lvmeng_jie_qinxue', name: '勤学',
                description: '觉醒技，准备阶段或结束阶段，若你的手牌数减体力值至少为2，你减1点体力上限并选择一项：1.摸两张牌；2.回复1点体力。若如此做，你获得技能“攻心”。',
                type: SkillType.AWAKENED, trigger: SkillTrigger.ON_TURN_START,
            },
            {
                id: 'lvmeng_jie_botu', name: '博图',
                description: '每轮限X次（X为存活角色数且至多为3），回合结束时，若本回合置入弃牌堆的牌中包含四种花色，你可以执行一个额外的回合。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
            {
                id: 'lvmeng_jie_gongxin', name: '攻心',
                description: '出牌阶段限一次，你可以观看一名其他角色的手牌，然后你可以展示其中一张♥牌并选择一项：1.弃置此牌；2.将此牌置于牌堆顶。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },
    // ── 利用废牌（4 个）──
    // 王基（wangji）：同平衡拓展版
    {
        id: 'sunquan_jie', name: '界孙权', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [{
            id: 'sunquan_jie_zhiheng', name: '制衡',
            description: '出牌阶段限一次，你可以弃置任意张牌，然后摸等量的牌；若你以此法弃置了所有的手牌，则多摸一张牌。',
            type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
        }],
    },
    {
        id: 'lingtong_jie', name: '界凌统', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'lingtong_jie_xuanfeng', name: '旋风',
                description: '当你失去装备区里的牌后，或一次性失去至少两张牌后，你可以依次弃置至多两名其他角色共计至多两张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_LOSE_EQUIP,
            },
        ],
    },
    {
        id: 'zhuhuan', name: '界朱桓', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'zhuhuan_fenli', name: '奋励',
                description: '若你的手牌数为全场最多，你可以跳过摸牌阶段；若你的体力值为全场最多，你可以跳过出牌阶段；若你的装备区里有牌且数量为全场最多，你可以跳过弃牌阶段。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_START,
            },
            {
                id: 'zhuhuan_pingkou', name: '平寇',
                description: '回合结束时，你可以对至多X名其他角色各造成1点伤害（X为你本回合跳过的阶段数）。你每以此法造成1次伤害，摸一张牌（每名角色限一次）。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },

    // ── 菜刀（31 个）──
    // ── 加伤（4 个）──
    // 界许褚（xuchu_jie）：同平衡版
    {
        id: 'guanyu_jie', name: '界关羽', maxHp: 4, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'guanyu_jie_wusheng', name: '武圣',
                description: '①你可以将一张红色牌当【杀】使用或打出；②你使用【杀】无距离限制。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'guanyu_jie_yijue', name: '义绝',
                description: '出牌阶段限一次，你可以弃置一张牌，令一名其他角色展示一张手牌，若此牌为：红色，你获得此牌且你可以令其回复1点体力；黑色，其所有非锁定技失效且不能使用或打出手牌、你使用♥【杀】对其造成的伤害+1。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },
    {
        id: 'caoxiu_jie', name: '界曹休', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'caoxiu_qianju', name: '千驹',
                description: '锁定技，你每损失1点体力，你计算与其他角色的距离便-1。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'caoxiu_jie_qingxi', name: '倾袭',
                description: '当你使用【杀】时，你可以令所有目标分别选择一项：1.弃置你攻击范围张牌；2.此【杀】伤害+1。若你的装备区有武器牌，则改为其依次执行这两项，然后弃置此牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },
    {
        id: 'lingju', name: '灵雎', maxHp: 3, gender: 'female', kingdom: 'qun',
        skills: [
            {
                id: 'lingju_jieyuan', name: '竭缘',
                description: '①当你对其他角色造成伤害时，若该角色体力值不小于你，你可以弃置一张黑色手牌，令此伤害+1；②当你受到其他角色造成的伤害时，若其体力值不小于你，你可以弃置一张红色手牌，令此伤害-1。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
            {
                id: 'lingju_fenxin', name: '焚心',
                description: '当你杀死一名角色后，你可以获得其武将牌上的所有技能（限定技、觉醒技、使命技、主公技和持恒技除外）。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_KILLED,
            },
        ],
    },
    // ── 多刀（21 个）──
    {
        id: 'zhangfei_jie', name: '界张飞', maxHp: 4, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'zhangfei_jie_paoxiao', name: '咆哮',
                description: '锁定技，①你使用【杀】无次数限制；②当你使用的【杀】被其他角色使用【闪】抵消后，你本回合下一次使用【杀】造成伤害时，此伤害+1。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'zhangfei_tishen', name: '替身',
                description: '限定技，准备阶段，你可以将体力回复至体力上限，摸以此法回复的体力值数张牌。',
                type: SkillType.LIMITED, trigger: SkillTrigger.ON_TURN_START,
            },
        ],
    },
    {
        id: 'huanggai_jie', name: '界黄盖', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'huanggai_jie_kurou', name: '苦肉',
                description: '出牌阶段限一次，你可以弃置一张牌，失去1点体力。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'huanggai_zhaxiang', name: '诈降',
                description: '锁定技，当你失去1点体力后，你摸三张牌，然后若此时是你的出牌阶段，你本阶段：使用红色【杀】无距离限制且不能被【闪】响应、使用【杀】的次数上限+1。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_HP_CHANGED,
            },
        ],
    },
    // 李通（litong）：同平衡拓展版
    // 丁奉（dingfeng）：同平衡拓展版
    // 凌操（lingcao）：同平衡拓展版
    // 吕布-竞（lvbu_jing）：同平衡版
    {
        id: 'weiyan', name: '魏延', maxHp: 4, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'weiyan_kuanggu', name: '狂骨',
                description: '当你对一名角色造成1点伤害后，若其扣减体力前你计算与其的距离不大于1，你可以选择一项：1.回复1点体力；2.摸一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_DEALT,
            },
            {
                id: 'weiyan_qimou', name: '奇谋',
                description: '限定技，出牌阶段，你可以失去任意点体力，然后你本回合计算与其他角色的距离-X、使用【杀】的次数上限+X（X为你以此法失去的体力数）。',
                type: SkillType.LIMITED, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },
    {
        id: 'xiahouyuan_jie', name: '界夏侯渊', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'xiahouyuan_jie_shensu', name: '神速',
                description: '你可以选择至多三项：1.跳过判定阶段和摸牌阶段；2.跳过出牌阶段并弃置一张装备牌；3.跳过弃牌阶段并翻面。你每选择一项，便视为你使用一张无距离限制的【杀】。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_START,
            },
            {
                id: 'xiahouyuan_shebian', name: '设变',
                description: '当你翻面时，你可以移动场上一张装备牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_HP_CHANGED,
            },
        ],
    },
    {
        id: 'taishici_jie', name: '界太史慈', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'taishici_tianyi', name: '天义',
                description: '出牌阶段限一次，你可以与一名角色拼点，然后你本回合根据拼点结果获得对应效果：若你赢，则你使用【杀】的次数上限+1、使用【杀】无距离限制、使用【杀】的目标数上限+1，否则你不能使用【杀】。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'taishici_hanzhan', name: '酣战',
                description: '①当你拼点时，你可以令其改为用随机的一张手牌拼点；②当你拼点结束后，你可以获得拼点牌中点数最大的【杀】。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },
    {
        id: 'gaoshun_jie', name: '界高顺', maxHp: 4, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'gaoshun_xianzhen', name: '陷阵',
                description: '出牌阶段限一次，你可以与一名角色拼点，然后你本回合根据拼点结果获得对应效果：若你赢，则你无视该角色的防具、对其使用牌无距离和次数限制、使用【杀】或普通锦囊牌时可以额外选择该角色为目标，否则其不能成为你使用【杀】的目标且【杀】不计入你的手牌上限。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'gaoshun_jinjiu', name: '禁酒',
                description: '锁定技，①你的【酒】均视为点数为K的【杀】；②你的回合内，其他角色不能使用【酒】。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },
    {
        id: 'caochun', name: '曹纯', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'caochun_shanjia', name: '缮甲',
                description: '出牌阶段开始时，你可以摸三张牌，然后弃置X张牌（X为3减去你失去过装备牌的数量，使用装备牌除外）。若你未以此法弃置基本牌，本阶段使用【杀】的次数上限+1；若你未以此法弃置锦囊牌，本阶段使用牌无距离限制；若你未以此法弃置非装备牌，你可以视为使用一张不计入次数的【杀】。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_START,
            },
        ],
    },
    {
        id: 'caozhang_jie', name: '界曹彰', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'caozhang_jiangchi', name: '将驰',
                description: '摸牌阶段结束时，你可以选择一项：1.摸一张牌，然后本回合使用【杀】的次数上限-1且【杀】不计入你的手牌上限；2.重铸一张牌，然后本回合使用【杀】无距离限制且使用【杀】的次数上限+1。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DRAW_CARDS,
            },
        ],
    },
    {
        id: 'peixiu', name: '裴秀', maxHp: 3, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'peixiu_xingtu', name: '行图',
                description: '锁定技，当你使用一张牌时，若此牌的点数为你使用的上一张牌的点数的约数，你摸一张牌；若为倍数，你使用此牌无次数限制。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'peixiu_juezhi', name: '爵制',
                description: '出牌阶段，你可以弃置至少两张牌，然后随机获得牌堆中一张点数为X的牌（X为你弃置的牌的点数之和除以13的余数，若余数为0，则X为13）。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },
    {
        id: 'caiwenji_sp', name: 'SP蔡文姬', maxHp: 3, gender: 'female', kingdom: 'qun',
        skills: [
            {
                id: 'caiwenji_sp_chenqing', name: '陈情',
                description: '每轮限一次，当一名角色进入濒死状态时，你可以令另一名其他角色摸四张牌并弃置四张牌。若其以此法弃置的牌花色均不相同，其视为对前者使用一张【桃】。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DYING,
            },
            {
                id: 'caiwenji_sp_moshi', name: '默识',
                description: '结束阶段，你可以将一张手牌当你本回合出牌阶段内使用过的第一张基本牌或普通锦囊牌使用，然后你可以将一张手牌当你本回合出牌阶段内使用过的第二张基本牌或普通锦囊牌使用。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },
    {
        id: 'zhangmancheng', name: '张曼成', maxHp: 4, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'zhangmancheng_luecheng', name: '掠城',
                description: '出牌阶段限一次，你可以选择一名其他角色并标记你所有手牌中的【杀】，令你本回合对其使用标记过的【杀】无次数限制，然后此回合结束时，其展示所有手牌，若其中有【杀】，其可以对你依次使用这些【杀】。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'zhangmancheng_zhongji', name: '螽集',
                description: '当你使用牌时，若你没有与此牌花色相同的手牌，你可以将手牌摸至体力上限，然后弃置X张牌（X为你本回合发动此技能的次数）。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },
    {
        id: 'caoxing', name: '曹性', maxHp: 4, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'caoxing_liushi', name: '流矢',
                description: '出牌阶段，你可以将一张♥牌置于牌堆顶，视为使用一张无距离与次数限制的【杀】（受到此【杀】伤害的目标角色的手牌上限-1）。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'caoxing_zhanwan', name: '斩腕',
                description: '锁定技，因“流矢”而减少手牌上限的角色的弃牌阶段结束时，若其本阶段弃置过牌，你摸等同于其弃牌数的牌，然后恢复其因“流矢”减少的手牌上限。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },
    {
        id: 'machao_sp', name: 'SP马超', maxHp: 4, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'machao_sp_zhuiji', name: '追击',
                description: '锁定技，①你计算与体力值不大于你的其他角色的距离视为1；②当你使用【杀】指定距离为1的角色为目标后，其选择一项：1.弃置一张牌；2.重铸装备区里的所有牌。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'machao_sp_shicou', name: '誓仇',
                description: '你使用【杀】可以多选择至多X名角色为目标（X为你已损失的体力值+1）。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },
    {
        id: 'jiangwei_mou', name: '谋姜维', maxHp: 4, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'jiangwei_mou_zhuri', name: '逐日',
                description: '你的一个阶段结束时，若你的手牌数于此阶段内变化过，你可以与一名其他角色拼点。若你赢，则你可以使用其中一张拼点牌，否则你选择一项：1.失去1点体力；2.失去此技能直到回合结束。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
            {
                id: 'jiangwei_mou_ranji', name: '燃己',
                description: '限定技，结束阶段，若你本回合使用过牌的阶段数：大于等于体力值，你可以获得“困奋”；小于等于体力值，你可以获得“诈降”。若如此做，你将手牌数或体力值调整至上限，然后你不能回复体力直到你杀死角色。',
                type: SkillType.LIMITED, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },
    {
        id: 'caomao', name: '曹髦', maxHp: 3, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'caomao_qianlong', name: '潜龙',
                description: '当你受到伤害后，你可以展示牌堆顶的三张牌，获得其中的任意张牌（至多为你已损失的体力值数张），然后将剩余的牌以任意顺序置于牌堆底。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
            {
                id: 'caomao_fensi', name: '忿肆',
                description: '锁定技，准备阶段，你对一名体力值不小于你的角色造成1点伤害。若该角色不为你，其视为对你使用一张【杀】。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_TURN_START,
            },
            {
                id: 'caomao_juetao', name: '决讨',
                description: '限定技，出牌阶段开始时，若你的体力值为1，你可以选择一名角色，依次使用牌堆底的牌直到不能使用为止（只能指定你或该角色为目标）。',
                type: SkillType.LIMITED, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },
    {
        id: 'dongcheng', name: '董承', maxHp: 3, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'dongcheng_chengzhao', name: '承诏',
                description: '一名角色的结束阶段，若你本回合获得过至少两张手牌，则你可以与一名角色拼点：若你赢，则视为你对其使用一张无视防具的普通【杀】。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },
    {
        id: 'qianzhao', name: '牵招', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'qianzhao_weifu', name: '威抚',
                description: '出牌阶段，你可以弃置一张牌并进行一次判定，然后你本回合使用的下一张与判定牌类别相同的牌无距离限制且可以额外指定一名角色为目标。若你以此法弃置的牌与判定牌类别相同，你摸一张牌。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'qianzhao_kuansai', name: '款塞',
                description: '每回合限一次，当一名角色使用牌指定目标后，若此牌的目标数不小于你的体力值，你可以令其中一名目标角色选择一项：1.交给你一张牌；2.令你回复1点体力。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },
    // ── 强中（6 个）──
    // 界马超（machao_jie）：同平衡版
    {
        id: 'huangzhong_jie', name: '界黄忠', maxHp: 4, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'huangzhong_liegong', name: '烈弓',
                description: '①你对你计算与其距离不大于【杀】的点数的其他角色使用此【杀】无距离限制；②当你使用【杀】指定一名角色为目标后，你可以执行符合条件的项：1.若你的手牌数不小于其，其不能使用【闪】响应此【杀】；2.若你的体力值不大于其，此【杀】对其造成的伤害+1。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },

    {
        id: 'zhoucang_jie', name: '界周仓', maxHp: 4, gender: 'male', kingdom: 'shu',
        skills: [{
            id: 'zhoucang_jie_zhongyong', name: '忠勇',
            description: '当你使用【杀】后，你可以将此【杀】以及目标角色使用的【闪】交给一名其他角色，若其获得的牌中有红色，则其可以对你攻击范围内的角色使用一张【杀】。若其获得的牌中有黑色，其摸一张牌。',
            type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
        }],
    },
    // 界马岱（madai）：同平衡拓展版
    {
        id: 'pangde_jie', name: '界庞德', maxHp: 4, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'pangde_mashu', name: '马术',
                description: '锁定技，你计算与其他角色的距离-1。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'pangde_jie_jianchu', name: '鞬出',
                description: '当你使用【杀】指定其他角色为目标后，你可以弃置该角色的一张牌，若此牌不为基本牌，则其不能使用【闪】响应此【杀】、你本回合使用【杀】的次数上限+1，否则其获得此【杀】。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },
    // 伏完（fuwan）：同平衡版

    // ── 直伤（26 个）──
    // ── 技能直伤（17 个）──
    // 界典韦（dianwei_jie）：同平衡版
    {
        id: 'sunchen_shi', name: '势孙綝', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'sunchen_shi_nigu', name: '逆固',
                description: '出牌阶段限一次，你可以弃置任意张花色不同的牌，令攻击范围内的所有角色同时选择是否交给你一张牌，然后你本回合下X次造成的伤害+1（X为以此法选择不交给你牌的角色数）。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'sunchen_shi_lulian', name: '戮连',
                description: '锁定技，你使用手牌结算后，若你没有此类别的手牌，且有目标角色：①体力值小于等于你，此牌所有目标进入连环状态；②装备区牌数小于等于你，你摸一张牌。若上述两个条件均满足：你对一名体力值不为最小的角色造成1点火焰伤害。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },
    {
        id: 'sunchen', name: '孙綝', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'sunchen_zigu', name: '自固',
                description: '出牌阶段限一次，你可以弃置一张牌，选择自己或一名装备区里有牌的其他角色，你获得其装备区里的一张牌。若你手牌中没有此次以此法获得的其他角色的装备牌，你摸一张牌。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'sunchen_zuowei', name: '作威',
                description: '当你于回合内使用牌时，若你的手牌数：大于X，你可以令此牌不能被响应；等于X，你可以对一名其他角色造成1点伤害；小于X，你可以摸两张牌且本回合不能再发动此项效果（X为你装备区里的牌数，至少为1）。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },
    {
        id: 'zhaoyun_sp', name: 'SP赵云', maxHp: 2, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'zhaoyun_longdan', name: '龙胆',
                description: '你可以将一张【杀】当【闪】、【闪】当【杀】使用或打出。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'zhaoyun_sp_chongzhen', name: '冲阵',
                description: '当你发动“龙胆”使用或打出一张手牌时，你可以获得对方的一张手牌或对对方造成1点伤害。若其因此失去了最后一张手牌或进入了濒死状态，你摸两张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },
    // 乐进（yuejin）：同平衡拓展版
    // 诸葛恪（zhugeke）：同平衡拓展版
    {
        id: 'baoxin', name: '鲍信', maxHp: 4, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'baoxin_taotao', name: '募讨',
                description: '出牌阶段限一次，你可以选择一名角色，令其将手牌中所有的【杀】置于其武将牌上，然后其依次将这些【杀】随机交给由其下家开始的每一名角色，然后其对最后一名角色造成X点伤害（X为最后一名角色手牌中【杀】的数量且至多为2）。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'baoxin_yimou', name: '毅谋',
                description: '当一名角色受到伤害后，若你与其距离1以内，你可以选择一项令其执行之：1.从牌堆中获得一张【杀】；2.将一张手牌交给另一名角色，然后摸一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
        ],
    },
    {
        id: 'zhangjiao_jie', name: '界张角', maxHp: 3, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'zhangjiao_jie_leiji', name: '雷击',
                description: '①当你使用或打出【闪】时，或使用【闪电】时，你可以进行一次判定；②当你的判定牌生效后，若此牌为黑色，你可以选择一名角色，然后若此牌的花色为：♠，你对其造成2点雷电伤害；♣，你回复1点体力并对其造成1点雷电伤害。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_JUDGE,
            },
            {
                id: 'zhangjiao_jie_guidao', name: '鬼道',
                description: '当一名角色的判定牌生效前，你可以打出一张黑色牌替换之，然后若你打出的牌为♠2~9，你摸一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_JUDGE,
            },
        ],
    },
    {
        id: 'guanyinping', name: '关银屏', maxHp: 3, gender: 'female', kingdom: 'shu',
        skills: [
            {
                id: 'guanyinping_xuehen', name: '雪恨',
                description: '出牌阶段限一次，你可以弃置一张红色牌并选择至多X名角色（X为你已损失的体力值且至少为1），然后你横置这些角色，并对其中一名角色造成1点火焰伤害。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'guanyinping_huxiao', name: '虎啸',
                description: '锁定技，当你对一名角色造成火焰伤害后，其摸一张牌，然后你本回合对其使用牌无次数限制。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_DAMAGE_DEALT,
            },
            {
                id: 'guanyinping_wuji', name: '武继',
                description: '觉醒技，结束阶段，若你本回合造成过至少3点伤害，你加1点体力上限并回复1点体力，失去技能“虎啸”，然后从牌堆、弃牌堆或场上获得【青龙偃月刀】。',
                type: SkillType.AWAKENED, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },
    {
        id: 'jiaxu_jie', name: '界贾诩', maxHp: 3, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'jiaxu_jie_wansha', name: '完杀',
                description: '锁定技，你的回合内，当一名角色进入濒死状态时，你令除你和其以外的角色不能对其使用【桃】且所有非锁定技失效直到此次濒死结算结束。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_DYING,
            },
            {
                id: 'jiaxu_jie_luanwu', name: '乱武',
                description: '限定技，出牌阶段，你可以令所有其他角色依次选择一项：1.对其攻击范围内距离最近的另一名角色使用一张【杀】；2.失去1点体力。所有结算结束后，你可以视为使用一张无距离限制的【杀】。',
                type: SkillType.LIMITED, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'jiaxu_jie_weimu', name: '帷幕',
                description: '锁定技，①你不能成为黑色锦囊牌的目标；②当你于回合内受到伤害时，防止此伤害并摸伤害值的两倍数量的牌。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
        ],
    },
    {
        id: 'caifuren_jie', name: '界蔡夫人', maxHp: 3, gender: 'female', kingdom: 'qun',
        skills: [
            {
                id: 'caifuren_jie_qieting', name: '窃听',
                description: '其他角色的回合结束时，若其本回合没有对其他角色造成过伤害，你可以选择一项（若其本回合没有对其他角色使用过牌，则改为至多两项）：1.将其装备区里的一张牌置入你的装备区；2.摸一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
            {
                id: 'caifuren_xianzhou', name: '献州',
                description: '限定技，出牌阶段，你可以将装备区里的所有牌交给一名其他角色，然后该角色选择一项：1.令你回复X点体力；2.对其攻击范围内的至多X名角色各造成1点伤害（X为你交给其的牌数）。',
                type: SkillType.LIMITED, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },

    {
        id: 'yufan_jie', name: '界虞翻', maxHp: 3, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'yufan_jie_zongxuan', name: '纵玄',
                description: '当你距离1以内角色的牌每回合第一次因弃置而置入弃牌堆时，你可以将其中任意张牌置于牌堆顶。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DISCARD,
            },
            {
                id: 'yufan_jie_zhiyan', name: '直言',
                description: '你距离1以内角色的结束阶段，你可以令一名角色摸一张牌并展示之，若此牌为装备牌，则其使用此牌并回复1点体力，否则若其体力值不等于你，其失去1点体力。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },
    {
        id: 'zhangxiu', name: '张绣', maxHp: 4, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'zhangxiu_xiongluan', name: '雄乱',
                description: '限定技，出牌阶段，你可以废除你的判定区和装备区并选择一名其他角色，然后本回合：你对其使用牌无距离和次数限制、其不能使用或打出手牌。',
                type: SkillType.LIMITED, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'zhangxiu_congjian', name: '从谏',
                description: '当你成为目标数大于1的普通锦囊牌的目标时，你可以交给一名其他目标角色一张牌。若你给出的牌为装备牌，则你摸两张牌，否则你摸一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USED_AS_TARGET,
            },
        ],
    },
    {
        id: 'liru', name: '界李儒', maxHp: 3, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'liru_juece', name: '绝策',
                description: '结束阶段，你可以对一名本回合失去过牌的其他角色造成1点伤害。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
            {
                id: 'liru_mieji', name: '灭计',
                description: '出牌阶段限一次，你可以将一张黑色锦囊牌置于牌堆顶并选择一名有牌的其他角色，然后你令其选择一项：1.交给你一张锦囊牌（没有锦囊牌不可选择此项）；2.依次弃置两张非锦囊牌（没有非锦囊牌不可选择此项；不足则只需弃置一张）。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'liru_fencheng', name: '焚城',
                description: '限定技，出牌阶段，你可以令所有其他角色依次选择一项：1.弃置至少X张牌（X为上一名此技能的目标因此弃置的牌数+1）；2.受到2点火焰伤害。',
                type: SkillType.LIMITED, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },
    {
        id: 'zhanghua', name: '张华', maxHp: 3, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'zhanghua_bihun', name: '弼昏',
                description: '锁定技，当你使用牌指定其他角色为目标时，若你的手牌数大于手牌上限，你取消之，然后若其为此牌的唯一目标，其获得之。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'zhanghua_jianhe', name: '剑合',
                description: '出牌阶段每名角色限一次，你可以重铸至少两张同名牌或装备牌，令一名角色选择一项：1.重铸等量张此类别的牌；2.受到你造成的1点雷电伤害。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'zhanghua_chuanwu', name: '穿屋',
                description: '锁定技，当你造成或受到伤害后，你失去武将牌上前X个技能直到回合结束（X为你的攻击范围）并摸本次失去的技能数张牌。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_DAMAGE_DEALT,
            },
        ],
    },
    {
        id: 'quyi', name: '麹义', maxHp: 4, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'quyi_fuqi', name: '伏骑',
                description: '锁定技，当你使用【杀】或普通锦囊牌指定目标后，与你距离为1的其他角色不能响应此牌。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'quyi_jiaozi', name: '骄恣',
                description: '锁定技，当你造成或受到伤害时，若你的手牌数为全场唯一最多，此伤害+1。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_DAMAGE_DEALT,
            },
        ],
    },
    {
        id: 'hetaihou', name: '何太后', maxHp: 3, gender: 'female', kingdom: 'qun',
        skills: [
            {
                id: 'hetaihou_zhendu', name: '鸩毒',
                description: '一名角色的出牌阶段开始时，你可以弃置一张手牌，依次执行以下所有项：1.令该角色视为使用一张【酒】；2.若该角色不为你，你对其造成1点伤害。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_START,
            },
            {
                id: 'hetaihou_qiluan', name: '戚乱',
                description: '一名角色的回合结束时，你可以摸X张牌（X为你本回合杀死的角色数的两倍加本回合死亡的角色数）。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },
    // ── 南蛮（2 个）──
    {
        id: 'zhurong_jie', name: '界祝融', maxHp: 4, gender: 'female', kingdom: 'shu',
        skills: [
            {
                id: 'zhurong_juxiang', name: '巨象',
                description: '锁定技，①【南蛮入侵】对你无效；②当其他角色使用的【南蛮入侵】结算结束后置入弃牌堆时，你获得之。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'zhurong_lierend', name: '烈刃',
                description: '当你使用【杀】对目标角色造成伤害后，你可以与其拼点，若你赢，你获得该角色的一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_DEALT,
            },
            {
                id: 'zhurong_changbiao', name: '长标',
                description: '出牌阶段限一次，你可以将任意张手牌当一张无距离限制的【杀】使用。若此【杀】对目标角色造成过伤害，你于本阶段结束时摸等量的牌。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },
    {
        id: 'menghuo_sp', name: 'SP孟获', maxHp: 4, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'menghuo_sp_manwang', name: '蛮王',
                description: '出牌阶段，你可以弃置任意张牌并依次执行等量项：1.获得技能“叛侵”；2.摸一张牌；3.回复一点体力；4.摸两张牌并失去技能“叛侵”。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'menghuo_sp_panqin', name: '叛侵',
                description: '出牌阶段结束时，或弃牌阶段结束时，你可以将你本阶段弃置的牌当【南蛮入侵】使用，若这些牌数不大于此牌目标数，你执行并移除“蛮王”的最后一项。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },
    // ── 决斗（4 个）──
    {
        id: 'liuchen', name: '界刘谌', maxHp: 4, gender: 'male', kingdom: 'shu',
        skills: [{
            id: 'liuchen_zhanjue', name: '战绝',
            description: '出牌阶段，你可以将所有手牌当【决斗】使用，然后你和因此受伤的角色各摸一张牌。若你本阶段以此法摸过至少三张牌，本阶段此技能失效。',
            type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
        }],
    },
    {
        id: 'yanliangwenchou_jie', name: '界颜良文丑', maxHp: 4, gender: 'male', kingdom: 'qun',
        skills: [{
            id: 'yanliang_shuangxiong', name: '双雄',
            description: '①摸牌阶段结束时，你可以弃置一张牌，若如此做，本回合你可以将任意一张与以此法弃置的牌颜色不同的牌当【决斗】使用；②结束阶段，你获得本回合对你造成伤害的牌。',
            type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DRAW_CARDS,
        }],
    },
    {
        id: 'diaochan_jie', name: '界貂蝉', maxHp: 3, gender: 'female', kingdom: 'qun',
        skills: [
            {
                id: 'diaochan_lijian', name: '离间',
                description: '出牌阶段限一次，你可弃置一张牌，令两名男性角色进行决斗。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'diaochan_jie_biyue', name: '闭月',
                description: '结束阶段，若你有手牌，则你可以摸一张牌，否则你可以摸两张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },
    {
        id: 'huaxiong_jie', name: '界华雄', maxHp: 4, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'huaxiong_yaowu', name: '耀武',
                description: '锁定技，当你受到牌造成的伤害时，若此牌为红色，则伤害来源摸一张牌，否则你摸一张牌。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
            {
                id: 'huaxiong_shizhan', name: '势斩',
                description: '出牌阶段限两次，你可以令一名其他角色视为对你使用一张【决斗】。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },
    // ── 属性传导（3 个）──
    {
        id: 'pangtong', name: '谋庞统', maxHp: 3, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'pangtong_lianhuan', name: '连环',
                description: '①出牌阶段限一次，你可以将一张手牌当【铁索连环】使用，或重铸一张手牌；②你使用【铁索连环】可以指定任意名角色为目标；③当你使用【铁索连环】指定一名角色为目标后，若其不处于“连环状态”，你可以弃置其一张手牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'pangtong_niepan', name: '涅槃',
                description: '限定技，当你处于濒死状态时，你可以弃置你区域里所有的牌，摸两张牌，将体力值回复至2点，复原武将牌，然后修改“连环”。',
                type: SkillType.LIMITED, trigger: SkillTrigger.ON_DYING,
            },
        ],
    },
    {
        id: 'caimao', name: '蔡瑁', maxHp: 4, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'caimao_zuolian', name: '佐练',
                description: '出牌阶段限一次，你可以令至多体力值数名有手牌的角色各随机展示一张手牌，然后你可以用牌堆或弃牌堆中的火【杀】随机交换这些牌（若牌堆或弃牌堆中没有火【杀】，则改为用雷【杀】随机交换）。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'caimao_jingzhou', name: '精舟',
                description: '当你受到伤害时，你可以选择至多体力值数名角色，若这些角色已横置，则其重置，否则其横置。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
        ],
    },
    {
        id: 'cenhun', name: '岑昏', maxHp: 3, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'cenhun_jishe', name: '极奢',
                description: '①出牌阶段，若你的手牌上限大于0，你可以摸一张牌，令你本回合的手牌上限-1；②结束阶段，若你没有手牌，你可以横置至多X名角色（X为你的体力值）。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'cenhun_lianhuo', name: '链祸',
                description: '锁定技，当你受到火焰伤害时，若你处于“连环状态”且是传导伤害的起点，此伤害+1。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
        ],
    },

    // ── 控制（28 个）──
    // ── 限制出牌（4 个）──
    {
        id: 'daqiao_jie', name: '界大乔', maxHp: 3, gender: 'female', kingdom: 'wu',
        skills: [
            {
                id: 'daqiao_jie_guose', name: '国色',
                description: '出牌阶段限一次，你可以选择一项：1.将一张♦牌当【乐不思蜀】使用；2.弃置一张♦牌，并弃置场上的一张【乐不思蜀】。选择结束后，你摸一张牌。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'daqiao_jie_liuli', name: '流离',
                description: '当你成为其他角色使用【杀】的目标时，你可以弃置一张牌，将此【杀】转移给你攻击范围内的另一名其他角色。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USED_AS_TARGET,
            },
        ],
    },
    {
        id: 'manchong', name: '满宠', maxHp: 3, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'manchong_junxing', name: '峻刑',
                description: '出牌阶段限一次，你可以弃置任意张手牌，令一名其他角色选择一项：1.弃置等量张牌，失去1点体力；2.翻面，摸等量的牌。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'manchong_yuce', name: '御策',
                description: '当你受到伤害后，你可以展示一张手牌，令伤害来源选择一项：1.弃置一张与你展示的牌类别不同的手牌；2.令你回复1点体力。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
        ],
    },
    {
        id: 'fuhuanghou_jie', name: '界伏皇后', maxHp: 3, gender: 'female', kingdom: 'qun',
        skills: [
            {
                id: 'fuhuanghou_zhuikong', name: '惴恐',
                description: '其他角色的回合开始时，若你已受伤，你可以与其拼点。若你赢，则其本回合使用牌只能指定自己为目标；否则你获得其拼点的牌且其视为对你使用一张【杀】。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_START,
            },
            {
                id: 'fuhuanghou_xuanqiu', name: '求援',
                description: '当你成为其他角色使用伤害牌的目标时，你可以选择另一名其他角色（若此牌为锦囊牌，则改为另一名不为目标的其他角色），除非其交给你一张与此牌类别相同且牌名不同的牌，否则其也成为此牌的目标。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USED_AS_TARGET,
            },
        ],
    },
    {
        id: 'sunluyu', name: '孙鲁育', maxHp: 3, gender: 'female', kingdom: 'wu',
        skills: [
            {
                id: 'sunluyu_meibu', name: '魅步',
                description: '其他角色的出牌阶段开始时，若你在其攻击范围内，你可以弃置一张牌，令该角色本阶段视为拥有技能“止息”。若你以此法弃置的牌不为【杀】或黑色锦囊牌，其本阶段计算与你的距离视为1。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_START,
            },
            {
                id: 'sunluyu_mumu', name: '穆穆',
                description: '出牌阶段开始时，你可以选择一项：1.弃置场上的一张装备牌；2.获得场上的一张防具牌且你本阶段不能使用或打出【杀】。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_START,
            },
            {
                id: 'sunluyu_zhixi', name: '☆止息',
                description: '锁定技，当你的出牌阶段内使用第X张牌后，或使用锦囊牌结算结束后，你本阶段不能再使用牌（X为你的体力值）。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },
    // ── 限制摸牌（2 个）──
    {
        id: 'xuhuang_jie', name: '界徐晃', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'xuhuang_jie_duanliang', name: '断粮',
                description: '①你可以将一张黑色非锦囊牌当【兵粮寸断】使用；②你对手牌数不小于你的其他角色使用【兵粮寸断】无距离限制。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'xuhuang_jiezi', name: '截輜',
                description: '锁定技，当一名其他角色跳过摸牌阶段后，你摸一张牌。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_DRAW_CARDS,
            },
        ],
    },
    {
        id: 'hanhaosihuan', name: '界韩浩史涣', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'hanhaosihuan_shenduan', name: '慎断',
                description: '当你的黑色非锦囊牌因弃置而置入弃牌堆时，你可以将此牌当无距离限制的【兵粮寸断】使用。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DISCARD,
            },
            {
                id: 'hanhaosihuan_yonglue', name: '勇略',
                description: '其他角色的判定阶段开始时，你可以弃置其判定区内的一张牌。若该角色在你的攻击范围内，则你摸一张牌，否则你视为对其使用一张【杀】。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_START,
            },
        ],
    },
    // ── 减少手牌（9 个）──
    {
        id: 'zhenghun', name: '郑浑', maxHp: 3, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'zhenghun_qiangzhi', name: '强峙',
                description: '出牌阶段限一次，你可以弃置你与一名其他角色的共计三张牌。若其中一名角色因此失去三张牌，其对另一名角色造成1点伤害。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'zhenghun_pitian', name: '辟田',
                description: '①当你的牌因弃置而置入弃牌堆时，或当你受到伤害后，你的手牌上限+1；②结束阶段，若你的手牌数小于手牌上限，你可以将手牌摸至手牌上限（至多摸五张），然后失去因此技能获得的手牌上限加值。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DISCARD,
            },
        ],
    },
    // 界甘宁（ganning_jie）：同平衡版
    {
        id: 'gongsunyuan', name: '公孙渊', maxHp: 4, gender: 'male', kingdom: 'qun',
        skills: [{
            id: 'gongsunyuan_huaiyi', name: '怀异',
            description: '出牌阶段限一次，你可以展示所有手牌，若包含两种颜色，你弃置其中一种颜色的所有牌，然后获得至多X名其他角色的各一张牌（X为你以此法弃置的手牌数）。若你以此法获得的牌大于一张，你失去1点体力。',
            type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
        }],
    },
    {
        id: 'masu', name: '马谡', maxHp: 3, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'masu_sanyao', name: '散谣',
                description: '出牌阶段每项各限一次，你可以弃置一张牌，对全场体力值最大/手牌数最多的一名角色造成1点伤害。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'masu_zhiman', name: '制蛮',
                description: '当你对其他角色造成伤害时，你可以防止此伤害，然后获得其区域里的一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_DEALT,
            },
        ],
    },
    {
        id: 'zhanghulelin', name: '张虎乐綝', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'zhanghulelin_xijue', name: '袭爵',
                description: '①游戏开始时，或回合结束时，你获得X个“爵”标记（若为回合结束时，X为你本回合造成的伤害值；否则X为4）；②你可以移去1个“爵”标记，于对应时机发动一次“突袭”或“骁果”。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_START,
            },
            {
                id: 'zhanghulelin_tuxi', name: '突袭',
                description: '摸牌阶段，你可以少摸任意张牌，然后获得等量名其他角色的各一张手牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DRAW_CARDS,
            },
            {
                id: 'zhanghulelin_xiaoguo', name: '骁果',
                description: '其他角色的结束阶段，你可以弃置一张基本牌，令其选择一项：1.弃置一张装备牌，并令你摸一张牌；2.受到你对其造成的1点伤害。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },
    // 界张辽（zhangliao_jie）：同平衡版
    {
        id: 'lidian_ji', name: '骥李典', maxHp: 3, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'lidian_ji_duanjin', name: '断津',
                description: '当你使用一张基本牌结算完毕后，你可以弃置一名本回合使用过牌的其他角色的一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'lidian_ji_kaigong', name: '慨公',
                description: '每回合限一次，当你对其他角色造成伤害后或者受到其他角色造成的伤害后，你可以选择并展示你或者该角色的至多两张手牌并与牌堆底的等量张牌交换；若此过程中交换的牌至少包含三种花色，你可以使用其中一张牌（无次数限制且不计入使用次数）。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_DEALT,
            },
        ],
    },
    {
        id: 'jiangwei_jie', name: '界姜维', maxHp: 4, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'jiangwei_jie_tiaoxin', name: '挑衅',
                description: '出牌阶段限一次，你可以令一名其他角色选择一项：1.若你在其攻击范围内，对你使用一张【杀】；2.令你弃置其一张牌。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'jiangwei_jie_zhiji', name: '志继',
                description: '觉醒技，准备阶段，若你没有手牌，你选择一项：1.回复1点体力；2.摸两张牌。若如此做，你减1点体力上限，获得技能“观星”。',
                type: SkillType.AWAKENED, trigger: SkillTrigger.ON_TURN_START,
            },
        ],
    },
    {
        id: 'haozhao', name: '郝昭', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [{
            id: 'haozhao_zhengu', name: '镇骨',
            description: '结束阶段，你可以选择一名其他角色，你的回合结束时和该角色的下个回合结束时，其将手牌摸至（至多摸至五张）或弃置至与你手牌数相同。',
            type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
        }],
    },
    // ── 控制判定（3 个）──
    {
        id: 'zhugejin', name: '诸葛瑾', maxHp: 3, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'zhugejin_mingzhe', name: '明哲',
                description: '锁定技，当你于出牌阶段外失去红色牌后，你展示之并摸一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'zhugejin_huanshi', name: '缓释',
                description: '当一名角色的判定牌生效前，你可以令其观看你的手牌并选择你的一张牌，然后你用此牌代替判定牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_JUDGE,
            },
            {
                id: 'zhugejin_hongyuan', name: '弘援',
                description: '每阶段限一次，当你一次获得至少两张牌后，你可以交给至多两名其他角色各一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DRAW_CARDS,
            },
        ],
    },
    // 司马懿-竞（simayi_jing）：同平衡版
    {
        id: 'zhugeliang_jie', name: '界诸葛亮', maxHp: 3, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'zhugeliang_jie_guanxing', name: '观星',
                description: '准备阶段，你可以观看牌堆顶的五张牌（当存活角色数小于4时改为三张），然后将这些牌以任意顺序置于牌堆顶或牌堆底。若你将这些牌均置于牌堆底，你可以于结束阶段再次“观星”。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_START,
            },
            {
                id: 'zhugeliang_kongcheng', name: '空城',
                description: '锁定技，若你没有手牌，你不能成为【杀】或【决斗】的目标。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USED_AS_TARGET,
            },
        ],
    },
    // ── 影响手牌（7 个）──
    {
        id: 'ganning_shen', name: '神甘宁', maxHp: 6, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'ganning_shen_poxi', name: '魄袭',
                description: '游戏开始时，你失去3点体力。出牌阶段限一次，你可以观看一名其他角色的手牌，且你可以弃置你与其手牌中共计四张不同花色的牌，然后若你以此法被弃置的牌数为：0，你减1点体力上限；1，你结束出牌阶段且你本回合的手牌上限-1；3，你回复1点体力；4，你摸四张牌。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'ganning_shen_jieying', name: '劫营',
                description: '①回合开始时，若没有有“营”标记的角色，你获得“营”标记；②结束阶段，你可以将“营”标记交给一名其他角色；③有“营”标记的其他角色的回合结束时，移去“营”标记，你获得其所有手牌。（“营”：摸牌阶段多摸一张牌、使用【杀】次数上限+1、手牌上限+1）',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },
    {
        id: 'caoren_sp', name: 'SP曹仁', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'caoren_weikui', name: '伪溃',
                description: '出牌阶段限一次，你可以失去1点体力，然后观看一名有手牌的其他角色的手牌。若其手牌中有【闪】，你视为对其使用一张不计入次数限制的【杀】，且你本回合计算与其的距离视为1；若没有【闪】，你弃置其中的一张牌。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'caoren_lizhan', name: '励战',
                description: '结束阶段结束时，你可以令任意名已受伤的角色各摸一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },
    {
        id: 'jiangqin', name: '蒋钦', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'jiangqin_shangyi', name: '尚义',
                description: '出牌阶段限一次，你可以弃置一张牌，令一名有手牌的其他角色观看你的手牌，然后你观看其手牌，并获得其中的一张牌。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'jiangqin_jianyi', name: '俭衣',
                description: '锁定技，其他角色的回合结束时，若弃牌堆中有本回合因弃置而置入的防具牌，你选择一张获得之。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },
    {
        id: 'xuyou', name: '许攸', maxHp: 3, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'xuyou_chenglue', name: '成略',
                description: '转换技，出牌阶段限一次。阳：你可以摸一张牌，然后弃置两张手牌；阴：你可以摸两张牌，然后弃置一张手牌。若如此做，直到回合结束，你使用与弃置牌相同花色的牌无距离和次数限制。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'xuyou_shicai', name: '恃才',
                description: '当你使用一张牌结算结束后，若此牌与你本回合使用过的牌类型均不同，你可以将此牌置于牌堆顶，然后摸一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'xuyou_cunmu', name: '寸目',
                description: '锁定技，当你摸牌时，改为从牌堆底摸牌。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_DRAW_CARDS,
            },
        ],
    },
    {
        id: 'zhugezhan', name: '诸葛瞻', maxHp: 3, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'zhugezhan_zuilun', name: '罪论',
                description: '结束阶段，你可以观看牌堆顶的三张牌，获得其中X张（X为你满足的选项数），然后以任意顺序放回其余的牌：1.本回合造成过伤害；2.本回合未弃置过牌；3.手牌数为全场最少。若均不满足，你与一名其他角色各失去1点体力。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
            {
                id: 'zhugezhan_fuyin', name: '父荫',
                description: '锁定技，当你每回合第一次成为【杀】或【决斗】的目标后，若你的手牌数不大于使用者，此牌对你无效。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USED_AS_TARGET,
            },
        ],
    },
    {
        id: 'jianyong', name: '界简雍', maxHp: 3, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'jianyong_qiaoshuo', name: '巧说',
                description: '出牌阶段，你可以与一名其他角色拼点，若你赢，则你本回合使用下一张基本牌或普通锦囊牌时可以为此牌增加或减少一个目标，否则你本回合不能使用锦囊牌且此技能本回合失效。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'jianyong_zongshi', name: '纵适',
                description: '当你拼点结束后，若你赢，则你可以获得两张拼点牌中点数较小的一张，否则你可以收回你拼点的牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },
    {
        id: 'quhuang', name: '屈晃', maxHp: 3, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'quhuang_qiejian', name: '切谏',
                description: '当一名角色失去最后的手牌后，你可以与其各摸一张牌，然后你选择一项：1.弃置你或其场上一张牌；2.你本轮不能对其发动此技能。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DISCARD,
            },
            {
                id: 'quhuang_nishou', name: '泥首',
                description: '锁定技，当你装备区里的牌进入弃牌堆后，你选择一项：1.将此牌当【闪电】使用；2.于本阶段结束时与一名全场手牌数最少的角色交换手牌且本阶段你不能再发动此项效果。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_LOSE_EQUIP,
            },
        ],
    },
    // ── 控制距离（3 个）──
    // 文聘-竞（wenpin_jing）：同2013经典版
    {
        id: 'liufeng', name: '刘封', maxHp: 4, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'liufeng_xiansi', name: '陷嗣',
                description: '①准备阶段，你可以将至多两名角色的各一张牌置于你的武将牌上，称为“逆”；②其他角色可以移去两张“逆”，视为对你使用一张【杀】。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_START,
            },
        ],
    },
    {
        id: 'zhanghe', name: '张郃', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'zhanghe_qiaobian', name: '巧变',
                description: '你可以弃置一张手牌，跳过一个阶段（准备阶段和结束阶段除外）。若你以此法跳过了：摸牌阶段，你可以获得至多两名角色的各一张手牌；出牌阶段，你可以移动场上的一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_START,
            },
        ],
    },

    // ── 防御（21 个）──
    // ── 团队防御（4 个）──
    {
        id: 'qinmi', name: '秦宓', maxHp: 3, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'qinmi_jianzheng', name: '谏征',
                description: '当其他角色使用【杀】指定目标时，若你在其攻击范围内且你不是目标，你可以将一张手牌置于牌堆顶，取消所有目标，然后若此【杀】不为黑色，你成为目标。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'qinmi_zhuandui', name: '专对',
                description: '当你使用【杀】指定其他角色为目标后/成为其他角色使用【杀】的目标后，你可以与其拼点，若你赢，其不能使用【闪】响应此【杀】/此【杀】对你无效。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'qinmi_tianbian', name: '天辩',
                description: '①当你拼点时，你可以改为用牌堆顶的一张牌拼点；②当你的拼点牌亮出后，若花色为♥，则点数视为K。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },
    {
        id: 'caoang', name: '曹昂', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'caoang_kangkai', name: '慷忾',
                description: '当一名角色成为【杀】的目标后，若你与其距离1以内，你可以摸一张牌，然后交给其一张牌并展示之。若此牌为装备牌，该角色可以使用此牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },
    {
        id: 'wenpin', name: '文聘', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [{
            id: 'wenpin_zhenwei', name: '镇卫',
            description: '当一名体力值小于你的其他角色成为另一名其他角色使用【杀】或黑色锦囊牌的唯一目标时，你可以弃置一张牌并选择一项：1.摸一张牌，将此牌转移给你；2.令此牌无效，然后使用者于当前回合结束时重新获得之。',
            type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USED_AS_TARGET,
        }],
    },
    {
        id: 'luji', name: '陆绩', maxHp: 3, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'luji_huaiyu', name: '怀橘',
                description: '锁定技，游戏开始时，你获得3个“橘”标记；有“橘”的角色受到伤害时，防止此伤害并移去1个“橘”；有“橘”的角色的摸牌阶段，其多摸一张牌。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
            {
                id: 'luji_yili', name: '遗礼',
                description: '出牌阶段开始时，你可以失去1点体力或移去1个“橘”，令一名其他角色获得“橘”。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_START,
            },
            {
                id: 'luji_zhenglun', name: '整论',
                description: '若你没有“橘”，你可以跳过摸牌阶段，获得1个“橘”。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DRAW_CARDS,
            },
        ],
    },
    // ── 团队保护（7 个）──
    {
        id: 'wolong', name: '卧龙诸葛', maxHp: 3, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'wolong_bazhen', name: '八阵',
                description: '锁定技，若你的装备区里没有防具牌，视为你装备着【八卦阵】。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'wolong_huoji', name: '火计',
                description: '出牌阶段，你可以将一张红色手牌当【火攻】使用。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'wolong_kanpo', name: '看破',
                description: '你可以将一张黑色手牌当【无懈可击】使用。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },
    {
        id: 'caoren', name: '曹仁', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'caoren_jushou', name: '据守',
                description: '结束阶段，你可以摸四张牌并翻面，然后弃置一张手牌（若此牌为装备牌，你改为使用之）。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
            {
                id: 'caoren_jiewei', name: '解围',
                description: '①你可以将装备区里的一张牌当【无懈可击】使用；②当你的武将牌从背面翻至正面时，你可以弃置一张牌，然后移动场上的一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },
    // 界荀攸（xunyou）：同平衡拓展版
    {
        id: 'dongyun', name: '董允', maxHp: 3, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'dongyun_bingzheng', name: '秉正',
                description: '出牌阶段结束时，你可以选择一名手牌数不等于体力值的角色并选择一项：1.令其弃置一张手牌；2.令其摸一张牌。然后若该角色的手牌数等于体力值，你摸一张牌，且可以交给其一张牌。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'dongyun_sheyan', name: '舍宴',
                description: '当你成为普通锦囊牌的目标时，你可以选择一名不为此牌唯一目标的角色，若其为此牌的目标，则此牌对其无效，否则其成为此牌的目标。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USED_AS_TARGET,
            },
        ],
    },
    {
        id: 'chengyu', name: '程昱', maxHp: 3, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'chengyu_shefu', name: '设伏',
                description: '①结束阶段，你可以扣置一张手牌并记录一个非装备牌的牌名，称为“伏兵”；②你的回合外，当其他角色使用牌时，你可以移去一张记录名称相同的“伏兵”，令此牌无效并摸一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
            {
                id: 'chengyu_benyu', name: '贲育',
                description: '当你受到伤害后，若你的手牌数小于X，你可以将手牌摸至X张（至多摸五张）；若你的手牌数大于X，你可以弃置至少X+1张手牌，对伤害来源造成1点伤害（X为伤害来源的手牌数）。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
        ],
    },
    {
        id: 'yujin_mou', name: '谋于禁', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'yujin_mou_xiayuan', name: '狭援',
                description: '每轮限一次，当其他角色受到伤害后，若此次伤害令其失去了全部的“护甲”，你可以弃置两张手牌，令其重新获得失去的“护甲”。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
            {
                id: 'yujin_mou_jieyue', name: '节钺',
                description: '结束阶段，你可以令一名其他角色获得1点“护甲”，然后其可以交给你一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },
    {
        id: 'caiwenji_jie', name: '界蔡文姬', maxHp: 3, gender: 'female', kingdom: 'qun',
        skills: [
            {
                id: 'caiwenji_jie_beige', name: '悲歌',
                description: '当一名角色受到【杀】造成的伤害后，若你有牌，你可以令其进行一次判定，然后你可以弃置一张牌，根据判定结果执行对应效果：♥，其回复1点体力；♦，其摸两张牌；♣，伤害来源弃置两张牌；♠，伤害来源翻面。若你弃置的牌与判定牌：点数相同，你获得你弃置的牌；花色相同，你获得判定牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
            {
                id: 'caiwenji_jie_duanchang', name: '断肠',
                description: '锁定技，当你死亡时，你指定一名角色，其选择失去一个武将技能。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_KILLED,
            },
        ],
    },
    // ── 肉盾（10 个）──
    // 界邓艾（dengai）：同平衡拓展版
    {
        id: 'wangyi_jie', name: '界王异', maxHp: 3, gender: 'female', kingdom: 'wei',
        skills: [
            {
                id: 'wangyi_jie_zhenlie', name: '贞烈',
                description: '当你成为其他角色使用【杀】或普通锦囊牌的目标后，你可以失去1点体力，令此牌对你无效，然后你选择一项：1.获得其一张牌；2.于本回合的结束阶段发动一次“秘计”。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USED_AS_TARGET,
            },
            {
                id: 'wangyi_jie_miji', name: '秘计',
                description: '结束阶段，你可以摸X张牌（X为你已损失的体力值），然后可以将至多等量的牌交给其他角色。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },
    // 界曹操（caocao_jie）：同平衡版
    // 严颜（yanyan）：同平衡拓展版
    // 界孙策（sunce_jie）：同平衡版
    {
        id: 'dongzhuo', name: '界董卓', maxHp: 8, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'dongzhuo_jiuchi', name: '酒池',
                description: '①你可以将一张手牌当【酒】使用；②你使用【酒】无次数限制；③当你使用【酒】【杀】造成伤害后，本回合“崩坏”失效。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'dongzhuo_roulin', name: '肉林',
                description: '锁定技，当你使用【杀】指定女性角色为目标后/成为女性角色使用【杀】的目标后，该角色/你需连续使用两张【闪】才能抵消。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'dongzhuo_banghuai', name: '崩坏',
                description: '锁定技，结束阶段，若你不是全场体力值最低的角色，你选择一项：1.失去1点体力；2.减1点体力上限。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },
    {
        id: 'zhonghui_jie', name: '界钟会', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'zhonghui_quanji', name: '权计',
                description: '当你造成或受到1点伤害后，你可以摸一张牌并令当前回合角色将一张手牌置于你的武将牌上，称为“权”（你的手牌上限增加“权”的数量）。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
            {
                id: 'zhonghui_zili', name: '自立',
                description: '觉醒技，一名角色的准备阶段，若“权”的数量不小于3，你选择一项：1.回复1点体力；2.摸两张牌。若如此做，你减1点体力上限，获得技能“排异”。',
                type: SkillType.AWAKENED, trigger: SkillTrigger.ON_TURN_START,
            },
        ],
    },
    {
        id: 'zhangchunhua_jie', name: '界张春华', maxHp: 3, gender: 'female', kingdom: 'wei',
        skills: [
            {
                id: 'zhangchunhua_jueqing', name: '绝情',
                description: '锁定技，你即将造成的伤害视为失去体力。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_DAMAGE_DEALT,
            },
            {
                id: 'zhangchunhua_shangshi', name: '伤逝',
                description: '当你的手牌数小于X时，你可以将手牌摸至X张（X为你已损失的体力值）。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_HP_CHANGED,
            },
            {
                id: 'zhangchunhua_jianmie', name: '翦灭',
                description: '出牌阶段限一次，你可以与一名其他角色同时在红色或黑色中选择一种颜色，你与其各弃置此颜色的所有手牌，然后弃牌数较多的角色视为对弃牌数较少的角色使用一张【决斗】。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },
    {
        id: 'caochong_jie', name: '界曹冲', maxHp: 3, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'caochong_chengxiang', name: '称象',
                description: '当你受到1点伤害后，你可以亮出牌堆顶的四张牌，获得其中任意张点数之和不大于13的牌。若你以此法获得的牌点数之和为13，你下一次发动此技能亮出的牌数+1。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
            {
                id: 'caochong_renxin', name: '仁心',
                description: '当其他角色进入濒死状态时，你可以翻面并弃置一张装备牌，令其将体力回复至1点。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DYING,
            },
        ],
    },
    {
        id: 'zhoutai', name: '周泰', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'zhoutai_buqu', name: '不屈',
                description: '锁定技，当你处于濒死状态时，将牌堆顶的一张牌置于你的武将牌上，称为“创”。若此牌点数与已有的“创”均不相同，则你将体力回复至1点，否则你将此“创”置入弃牌堆（若你的武将牌上有“创”，你的手牌上限为“创”数）。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_DYING,
            },
            {
                id: 'zhoutai_fenji', name: '奋激',
                description: '当一名角色被另一名角色弃置或获得而失去手牌后，你可以失去1点体力，令该角色摸两张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DISCARD,
            },
        ],
    },

    // ── 回复（8 个）──
    {
        id: 'huatuo_jie', name: '界华佗', maxHp: 3, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'huatuo_jijiu', name: '急救',
                description: '你的回合外，你可以将一张红色牌当【桃】使用。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DYING,
            },
            {
                id: 'huatuo_jie_qingnang', name: '青囊',
                description: '出牌阶段限一次，你可以弃置一张手牌，令一名角色回复1点体力。若你弃置的牌为红色，你本阶段可以再次发动此技能（每名角色每阶段限一次）。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'huatuo_chuli', name: '除疠',
                description: '出牌阶段限一次，你可以弃置你和任意名势力各不相同的其他角色的各一张牌，然后因此弃牌的角色各摸一张牌。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },
    {
        id: 'shenzhaoyun', name: '神赵云', maxHp: 2, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'shenzhaoyun_juejing', name: '绝境',
                description: '锁定技，①你的手牌上限+2；②当你进入或脱离濒死状态时，你摸一张牌。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_DYING,
            },
            {
                id: 'shenzhaoyun_longhun', name: '龙魂',
                description: '你可以将一至两张花色相同的牌当对应牌使用或打出：♥当【桃】；♦当火【杀】；♣当【闪】；♠当【无懈可击】。若你以此法转化了两张：红色牌，此牌使用时回复值或伤害值+1；黑色牌，你弃置当前回合角色的一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },
    // 赵云-竞（zhaoyun_jing）：同2013经典版
    {
        id: 'shanzhaoyun', name: '闪赵云', maxHp: 4, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'shanzhaoyun_longlin', name: '龙临',
                description: '当其他角色于其出牌阶段内第一次使用【杀】指定目标后，你可以弃置一张牌，令此【杀】无效。若如此做，其可以视为对你使用一张【决斗】，然后当你以此法造成伤害后，其本阶段使用的下一张牌只能指定自己为目标。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'shanzhaoyun_zhendan', name: '镇胆',
                description: '①你可以将一张非基本手牌当任意一张基本牌使用或打出（你本轮使用过的基本牌除外）；②当你受到伤害后，或每轮结束时，你摸X张牌，然后本轮此技能失效（X为本轮所有角色执行过的回合数且至多为5）。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
        ],
    },
    {
        id: 'sunshangxiang_jie', name: '界孙尚香', maxHp: 3, gender: 'female', kingdom: 'wu',
        skills: [
            {
                id: 'sunshangxiang_jie_jieyin', name: '结姻',
                description: '出牌阶段限一次，你可以选择一名男性角色，然后你弃置一张手牌或将一张装备牌置入其装备区。若如此做，你与其之中体力值较高的角色摸一张牌，体力值较低的角色回复1点体力。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'sunshangxiang_jie_xiaoji', name: '枭姬',
                description: '当你失去装备区里的一张牌后，你可以摸两张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_LOSE_EQUIP,
            },
        ],
    },
    {
        id: 'chengpu_jie', name: '界程普', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'chengpu_jie_lihuo', name: '疠火',
                description: '①当你使用火【杀】时，你可以多选择一个目标；②当你使用【杀】时，若此【杀】不为火【杀】，你可以将此【杀】改为火【杀】，然后此【杀】结算结束后，若此【杀】造成过伤害，你选择一项：1.弃置一张牌；2.失去1点体力。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'chengpu_jie_chunlao', name: '醇醪',
                description: '当你或与你相邻的角色的【杀】因弃置而置入弃牌堆后，你将此【杀】置于你的武将牌上，称为“醇”（你至多拥有九张“醇”；当一名角色处于濒死状态时，你可以移去X张“醇”，令该角色视为使用一张【酒】，X为你本轮以此法使用【酒】的次数）。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DISCARD,
            },
        ],
    },
    {
        id: 'mizhu', name: '糜竺', maxHp: 3, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'mizhu_ziyuan', name: '资援',
                description: '出牌阶段限一次，你可以交给一名其他角色任意张点数之和为13的牌，然后该角色回复1点体力。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'mizhu_jujia', name: '巨贾',
                description: '锁定技，①你的手牌上限+X；②游戏开始时，你多摸X张牌（X为你的体力上限）。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_TURN_START,
            },
        ],
    },
    {
        id: 'qiaozhou', name: '谯周', maxHp: 3, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'qiaozhou_zhiming', name: '知命',
                description: '准备阶段，或弃牌阶段结束时，你摸一张牌，然后你可以将一张牌置于牌堆顶。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_START,
            },
            {
                id: 'qiaozhou_xingbu', name: '星卜',
                description: '结束阶段，你可以亮出牌堆顶的三张  ，然后你可以选择一名其他角色，令其根据本次亮出的红色牌数执行对应的效果：为3，其摸牌阶段多摸两张牌、出牌阶段使用【杀】的次数上限+1；为2，其出牌阶段使用【杀】的次数上限-1、跳过弃牌阶段；不大于1，其准备阶段弃置一张手牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },
    {
        id: 'liuyan', name: '刘焉', maxHp: 3, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'liuyan_tushe', name: '图射',
                description: '当你使用非装备牌指定目标后，若你没有基本牌，你可以摸X张牌（X为此牌目标数）。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'liuyan_limu', name: '立牧',
                description: '①出牌阶段，你可以将一张牌当【乐不思蜀】对自己使用，并回复1点体力；②若你的判定区里有牌，你对你攻击范围内的其他角色使用牌无距离和次数限制。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },
    {
        id: 'lvbu_jie', name: '界吕布', maxHp: 5, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'lvbu_wushuang', name: '无双',
                description: '锁定技，①当你使用【杀】指定一名角色为目标后，其需使用两张【闪】才能抵消；②当你使用【决斗】指定其他角色为目标后，或成为其他角色使用【决斗】的目标后，其每次响应需打出两张【杀】。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'lvbu_jie_liyu', name: '利驭',
                description: '当你使用【杀】对其他角色造成伤害后，你可以获得其区域里的一张牌，若你获得的牌不为装备牌，则其摸一张牌，否则视为你对其指定的另一名其他角色使用一张【决斗】。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_DEALT,
            },
        ],
    },
    {
        id: 'lukang', name: '陆抗', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'lukang_keshou', name: '恪守',
                description: '当你受到或造成伤害时，你可以弃置两张颜色相同的手牌，令此伤害-1或+1。然后你进行一次判定，若结果为红色，你摸一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
            {
                id: 'lukang_zhuwei', name: '筑围',
                description: '当你的判定牌生效后，若此牌为【杀】或伤害类锦囊牌，你可以获得之，然后你可以令当前回合角色本回合：出牌阶段内使用【杀】的次数上限+1、手牌上限+1。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_JUDGE,
            },
        ],
    },
    {
        id: 'wujing', name: '吴景', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'wujing_heji', name: '合击',
                description: '当一名角色对其他角色使用仅指定一个目标的【决斗】或红色【杀】结算结束后，你可以对该目标角色使用一张无距离与次数限制的【杀】或【决斗】，然后若你使用的牌不为转化牌，你随机获得一张红色牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'wujing_liubing', name: '流兵',
                description: '锁定技，①当你于出牌阶段内使用第一张非虚拟【杀】时，此牌的花色视为♦；②当其他角色于其出牌阶段内使用非转化的黑色【杀】结算结束后，若此牌未造成过伤害，你获得之。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },
    {
        id: 'ganning_jing', name: '甘宁-竞', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'ganning_qixi', name: '奇袭',
                description: '你可以将一张黑色牌当【过河拆桥】使用。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'ganning_jing_fenwei', name: '奋威',
                description: '每轮限一次，当目标数大于1的锦囊牌指定目标后，你可以令此牌对其中任意个目标无效。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },
    {
        id: 'sunquan_jing', name: '孙权-竞', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [{
            id: 'sunquan_jing_zhiheng', name: '制衡',
            description: '出牌阶段限一次，你可以弃置任意张牌，然后摸等量的牌。若己方有角色阵亡且你以此法弃置了全部的手牌，你额外摸X张牌（X为己方阵营阵亡武将数）。',
            type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
        }],
    },
    {
        id: 'jiangwan_jing', name: '蒋琬-竞', maxHp: 3, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'jiangwan_jing_shengxi', name: '生息',
                description: '一名角色回合结束时，若其已受伤，你可以弃置其X张牌，然后其回复1点体力（X为其已损失的体力值）。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
            {
                id: 'jiangwan_jing_shoucheng', name: '守成',
                description: '当一名角色于其出牌阶段外失去最后的手牌时，你可以令其摸一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DISCARD,
            },
        ],
    },
    {
        id: 'wenyang', name: '文鸯', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'wenyang_quedi', name: '却敌',
                description: '每回合限一次，当你使用【杀】或【决斗】指定一名角色为唯一目标后，你可以选择一项：1.获得该角色的一张手牌；2.弃置一张基本牌，令此牌造成的伤害+1。你可以同时选择两项，若如此做，你减1点体力上限。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'wenyang_qiujue', name: '仇决',
                description: '锁定技，当你杀死其他角色后，你加1点体力上限并摸两张牌，然后你本回合发动“却敌”的次数上限+1。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_KILLED,
            },
            {
                id: 'wenyang_zhuifeng', name: '椎锋',
                description: '出牌阶段限两次，你可以失去1点体力，视为使用一张【决斗】，然后若你因此受到伤害，你防止此伤害且本阶段此技能失效。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },
    {
        id: 'tianchou', name: '田畴', maxHp: 3, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'tianchou_shandao', name: '善刀',
                description: '出牌阶段限一次，你可以将任意名角色的各一张牌置于牌堆顶，视为对这些角色使用一张【五谷丰登】，然后视为对除这些角色外的其他角色使用一张【万箭齐发】。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },
    {
        id: 'gaolan', name: '高览', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'gaolan_jungong', name: '峻攻',
                description: '出牌阶段，你可以弃置X张牌或者失去X点体力，视为使用一张无距离次数限制的【杀】（X为你本阶段此前发动过此技能的次数+1），然后当此【杀】造成伤害后，此技能失效直至本回合结束。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'gaolan_dengli', name: '等力',
                description: '当你使用【杀】指定一名角色为目标时，或当你成为其他角色使用【杀】的目标时，若你与其体力值相等，你可以摸一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USED_AS_TARGET,
            },
        ],
    },
    {
        id: 'cuiyan', name: '崔琰', maxHp: 3, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'cuiyan_yajun', name: '雅俊',
                description: '①摸牌阶段，你多摸一张牌；②出牌阶段开始时，你可以用一张本回合获得的牌与一名其他角色拼点，若你赢，你可以将其中一张拼点牌置于牌堆顶；若你没赢，你本回合的手牌上限-1。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DRAW_CARDS,
            },
            {
                id: 'cuiyan_zundi', name: '尊嫡',
                description: '出牌阶段限一次，你可以弃置一张手牌并选择一名角色，然后你进行一次判定，若结果为：黑色，其摸三张牌；红色，其可以移动场上的一张牌。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },
    {
        id: 'zhangyi', name: '张翼', maxHp: 4, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'zhangyi_yiyi', name: '执义',
                description: '锁定技，一名角色的结束阶段，若你本回合使用或打出过基本牌，你选择一项：1.视为使用任意一张你本回合使用或打出过的基本牌；2.摸一张牌。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },
]

/** 觉醒/转化获得、但未挂在武将原生技能列表里的技能（仅用于展示与查询） */
const GRANTED_SKILL_DEFS: SkillDefinition[] = [
    {
        id: 'lvbu_jing_mashu', name: '马术',
        description: '锁定技，你计算与其他角色的距离-1。',
        type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
    },
    {
        id: 'guanqiujian_qingce', name: '清侧',
        description: '出牌阶段，你可以获得一张“荣”并弃置一张手牌，然后弃置场上的一张牌。',
        type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
    },
    {
        id: 'zhonghui_paiyi', name: '排异',
        description: '出牌阶段限一次，你可以移去一张“权”，选择一名角色并选择一项：1.令其摸两张牌；2.对其造成1点伤害。然后若其手牌数大于你，你执行另一项并将本技能于本阶段内改为限两次。',
        type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
    },
    {
        id: 'doudizhu_feiyang', name: '飞扬',
        description: '判定阶段开始时，若你的判定区内有牌，你可以弃置两张手牌，然后弃置自己判定区内的一张牌。每回合限一次。',
        type: SkillType.ACTIVE, trigger: SkillTrigger.ON_TURN_START,
    },
    {
        id: 'doudizhu_bahu', name: '跋扈',
        description: '锁定技，准备阶段，你摸一张牌。出牌阶段，你使用【杀】的次数上限+1。',
        type: SkillType.LOCKED, trigger: SkillTrigger.ON_TURN_START,
    },
    {
        id: 'doudizhu_qiangyi', name: '强易',
        description: '整局游戏每个角色限一次，你可以获得一名其他角色的一张手牌，然后交给其一张牌。',
        type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
    },
]

/** 界/竞版技能 id 形如 `<武将>_jie_<技能>` / `<武将>_jing_<技能>`，取基础 id 让同一技能的不同形态共用判定 */
export const skillBaseId = (id: string): string => id.replace(/_(jie|jing)_/g, '_')

/** 界/竞形态标记：技能 id 或武将 id 中的 jie / jing 段 */
export const skillForm = (id: string): string | undefined => id.match(/_(jie|jing)(?:_|$)/)?.[1]

/** 技能 id 匹配：基础 id 匹配任意形态；带 _jie/_jing 的 id 只匹配同形态武将 */
export function skillMatches(generalId: string, ownId: string, queryId: string): boolean {
    if (ownId === queryId) return true
    if (skillBaseId(ownId) !== skillBaseId(queryId)) return false
    const qForm = skillForm(queryId)
    return !qForm || skillForm(generalId) === qForm
}

/** 按技能 id 取技能定义（原生技能 + 觉醒获得技能） */
export function getSkillDefById(skillId: string): SkillDefinition | undefined {
    for (const general of GENERALS) {
        const found = general.skills.find((s) => s.id === skillId)
        if (found) return found
    }
    return GRANTED_SKILL_DEFS.find((s) => s.id === skillId)
}

// ─────────────────────────────────────────────────────────────
// 武将池版本（单机对战可选）
// ─────────────────────────────────────────────────────────────

/** 武将池版本：classic2013 = 2013 版；balance = 平衡版（40）；balance_ext = 平衡扩展版（60）；brawl = 乱斗版 */
export type GeneralPoolVersion = 'classic2013' | 'balance' | 'balance_ext' | 'brawl'

const POOL_PREF_KEY = 'sgsoffline.pool'
/** 早期版本用的旧键名（下划线分隔），首次读取时搬到新键 */
const LEGACY_POOL_PREF_KEY = 'sgs3v3_pool'

/** 读取武将池偏好（默认 2013 版，脏值/异常回退默认） */
export function getPoolPreference(): GeneralPoolVersion {
    try {
        if (typeof localStorage === 'undefined') return 'classic2013'
        let raw = localStorage.getItem(POOL_PREF_KEY)
        if (raw === null) {
            raw = localStorage.getItem(LEGACY_POOL_PREF_KEY)
            if (raw !== null) {
                localStorage.setItem(POOL_PREF_KEY, raw)
                localStorage.removeItem(LEGACY_POOL_PREF_KEY)
            }
        }
        if (raw === 'classic2013' || raw === 'balance' || raw === 'balance_ext' || raw === 'brawl') return raw
        if (raw === 'custom') return 'balance_ext'
        if (raw === 'luoshu') return 'brawl'
        return 'classic2013'
    } catch {
        return 'classic2013'
    }
}

/** 保存武将池偏好 */
export function setPoolPreference(v: GeneralPoolVersion): void {
    try {
        if (typeof localStorage === 'undefined') return
        localStorage.setItem(POOL_PREF_KEY, v)
    } catch {
        // 隐私模式等场景忽略存储异常
    }
}

/** 
* 2013经典版武将名单（32 名） 
*/
export const CLASSIC_POOL_IDS: string[] = [
    // 辅助（5）
    'guojia', 'liubei', 'xiaoqiao', 'zhugejin_jing', 'simayi',
    // 牌差（6）
    'sunquan', 'huangyueying', 'huanggai', 'zhenji', 'jiangwei', 'zhouyu',
    // 菜刀（6）
    'zhangfei', 'xiahouyuan', 'guanyu', 'lvbu', 'machao', 'pangde',
    // 直伤（2）
    'jiaxu', 'diaochan',
    // 控制（6）
    'daqiao', 'ganning', 'zhugeliang', 'xuhuang_jing', 'wenpin_jing', 'zhangliao',
    // 防御（4）
    'caocao', 'xiahoudun', 'sunce', 'sunjian',
    // 回复（3）
    'huatuo', 'zhaoyun_jing', 'sunshangxiang',
]

/**
 * 平衡版武将名单（40 名）
 */
export const BALANCE_POOL_IDS: string[] = [
    // 辅助（6）
    'guojia_jie', 'liubei_jie', 'xiaoqiao', 'zhugejin_jing', 'chengong', 'simayi_jing',
    // 牌差（10）
    'sunquan', 'huangyueying', 'lidian_jie', 'huanggai', 'zhouyu_jie',
    'huangquan_jing', 'zhenji', 'guyong', 'yufan', 'jiangwei',
    // 菜刀（7）
    'zhangfei', 'xuchu_jie', 'lvbu_jing', 'machao_jie', 'zhoucang', 'fuwan', 'pangde',
    // 直伤（4）
    'zhangjiao', 'jiaxu', 'diaochan', 'dianwei_jie',
    // 控制（6）
    'daqiao_jie', 'ganning_jie', 'xuhuang_jing', 'zhugeliang', 'wenpin_jing', 'zhangliao_jie',
    // 防御（4）
    'xiahoudun_jing', 'caocao_jie', 'sunce_jie', 'sunjian_jie',
    // 回复（3）
    'huatuo', 'zhaoyun_jing', 'sunshangxiang',
]

/**
 * 平衡扩展版武将名单（60 名）
 */
export const BALANCE_EXT_POOL_IDS: string[] = [
    // 辅助（9）
    'guojia_jie', 'liubei_jie', 'luxun_jie', 'sunqian', 'xiaoqiao',
    'zhugejin_jing', 'sunshangxiang_sp', 'chengong', 'simayi_jing',
    // 牌差（14）
    'sunquan', 'huangyueying', 'lidian_jie', 'wangji', 'huanggai',
    'jushou', 'wangping', 'zhouyu_jie', 'huangquan_jing', 'zhenji',
    'guyong', 'yufan', 'jiangwei', 'zumao',
    // 菜刀（11）
    'zhangfei', 'xuchu_jie', 'lvbu_jing', 'machao_jie', 'dingfeng',
    'madai', 'litong', 'lingcao', 'zhoucang', 'fuwan', 'pangde',
    // 直伤（7）
    'zhangjiao', 'jiaxu', 'diaochan', 'dianwei_jie', 'zhugeke',
    'yuejin', 'caifuren',
    // 控制（8）
    'daqiao_jie', 'ganning_jie', 'xuhuang_jing', 'lingtong',
    'xunyou', 'zhugeliang', 'wenpin_jing', 'zhangliao_jie',
    // 防御（7）
    'xiahoudun_jing', 'dengai', 'wangyi', 'caocao_jie',
    'yanyan', 'sunce_jie', 'sunjian_jie',
    // 回复（4）
    'huatuo', 'zhaoyun_jing', 'sunshangxiang', 'chengpu',
]

/**
 * 乱斗版武将名单（186 名）
 */
export const BRAWL_POOL_IDS: string[] = [
    // 辅助（23）
    'liubei_jie', 'guojia_jie', 'caorui', 'lusu_jie', 'xiahoudun_jing', 'luxun_jie',
    'zhangsong_jie', 'zhongyao', 'chenqun', 'xunyu', 'xujing', 'liushan',
    'chengong_jie', 'xiaoqiao', 'zhoufei', 'xiahoushi', 'sunshangxiang_sp', 'guyong_jie',
    'kanze', 'shenlusu', 'baoxin', 'xizhicai', 'liuxie',
    'xuhuang_xing', 'dengzhi', 'maliang', 'guanping', 'xushu', 'luzhi',
    'mazhong', 'xushao',
    'cuiyan', 'tianchou',
    // 牌差（36）
    'lidian_jie', 'wangji', 'sunquan_jing', 'lingtong_jie', 'huangyueying_jie', 'wangping',
    'zhenji_jie', 'huangquan_jing', 'sunjian_jie', 'zhouyu_jie', 'sunqian_jie', 'zumao',
    'jushou_jie', 'handang', 'fazheng', 'sundeng', 'guotu', 'quancong',
    'zhangzhaozhanghong_jie', 'bulianshi_jie', 'kuailiangkuaiyue', 'zhoufang', 'guohuai_jie', 'sunxiu',
    'zhuzhi', 'zhuran_jie', 'guanqiujian', 'chenlin', 'lifeng', 'xuezong',
    'pangtong_sp', 'feiyi', 'liyan', 'lvmeng_jie',
    'lidian_ji', 'mengda', 'luoxian', 'wuxian_zu', 'sunchen_shi', 'zhenghun',
    // 菜刀（25）
    'xuchu_jie', 'zhangfei_jie', 'machao_jie', 'litong', 'zhoucang_jie', 'madai',
    'dingfeng', 'lingcao', 'lvbu_jing', 'pangde_jie', 'fuwan', 'guanyu_jie',
    'weiyan', 'caoxiu_jie', 'xiahouyuan_jie', 'zhurong_jie', 'taishici_jie', 'gaoshun_jie',
    'lisu', 'caozhang_jie', 'shamoke', 'caochun',
    'zhangmancheng', 'caoxing', 'dongcheng',
    'zhaoyun_sp', 'machao_sp', 'jiangwei_mou',
    'wenyang', 'gaolan',
    // 直伤（24）
    'dianwei_jie', 'huanggai_jie', 'yuejin', 'zhugeke', 'zhangjiao_jie', 'jiaxu_jie',
    'diaochan_jie', 'caifuren_jie', 'liuchen', 'huaxiong_jie', 'cenhun', 'guanyinping',
    'pangtong', 'yanliangwenchou_jie', 'yufan_jie', 'zhuhuan', 'huangzhong_jie', 'zhangxiu',
    'liru', 'quyi', 'hetaihou', 'sunchen', 'lingju',
    'caomao', 'menghuo_sp', 'huban',
    // 控制（31）
    'daqiao_jie', 'fuhuanghou_jie', 'xuhuang_jie', 'hanhaosihuan', 'ganning_jing', 'wenpin', 'wenpin_jing',
    'zhugeliang_jie', 'xuyou', 'zhugezhan', 'gongsunyuan', 'masu', 'zhanghulelin',
    'zhangliao_jie', 'liufeng', 'zhanghe', 'wolong', 'caoren', 'caoren_sp',
    'dongyun', 'zhugejin', 'simayi_jing', 'xunyou', 'jiangwei_jie', 'haozhao',
    'sunluyu', 'peixiu', 'chengyu',
    'ganning_shen', 'jianyong', 'caimao',
    'manchong', 'qianzhao', 'zhanghua', 'quhuang', 'jiangqin',
    // 肉盾（13）
    'qinmi', 'caoang', 'dengai', 'wangyi_jie', 'caocao_jie', 'yanyan',
    'sunce_jie', 'luji', 'dongzhuo', 'zhonghui_jie', 'zhangchunhua_jie', 'caochong_jie',
    'panjun',
    'yujin_mou', 'zhoutai',
    'zhangyi',
    // 回复（10）
    'zhaoyun_jing', 'shenzhaoyun', 'shanzhaoyun', 'huatuo_jie', 'sunshangxiang_jie', 'chengpu_jie',
    'mizhu', 'caiwenji_sp', 'jiangwan_jing',
    'caiwenji_jie',
    // 洛书版扩展（十）：新增武将
    'qiaozhou', 'liuyan', 'lvbu_jie',
    // 竞版调整：新增陆抗
    'lukang',
    // 新增吴景
    'wujing',
]


function poolFromIds(ids: string[]): GeneralDefinition[] {
    return ids
        .map((id) => GENERALS.find((g) => g.id === id))
        .filter((g): g is GeneralDefinition => g !== undefined)
}

/**
 * 获取武将池（浅拷贝，防选将池污染原表）
 * @param version 默认读取 localStorage 偏好
 */
export function getGeneralPool(
    version: GeneralPoolVersion = getPoolPreference()
): GeneralDefinition[] {
    if (version === 'balance') {
        return poolFromIds(BALANCE_POOL_IDS)
    }
    if (version === 'balance_ext') {
        return poolFromIds(BALANCE_EXT_POOL_IDS)
    }
    if (version === 'brawl') {
        return poolFromIds(BRAWL_POOL_IDS)
    }
    return poolFromIds(CLASSIC_POOL_IDS)
}

/** 按 ID 获取武将定义 */
export function getGeneralById(id: string): GeneralDefinition | undefined {
    return GENERALS.find((g) => g.id === id)
}
