import {
    GeneralDefinition,
    SkillDefinition,
    SkillType,
    SkillTrigger,
} from 'sgs3v3-shared'

/**
 * 武将数据库 — 32 个武将（统率三军 3v3）
 */
export const GENERALS: GeneralDefinition[] = [
    // ══════════════════════════════════════════
    // 魏国 (9)
    // ══════════════════════════════════════════
    {
        id: 'caocao', name: '曹操', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [{
            id: 'caocao_jianxiong', name: '奸雄',
            description: '你受到伤害后，可获得造成此伤害的牌。',
            type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
        }],
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
    {
        id: 'zhangliao', name: '张辽', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [{
            id: 'zhangliao_tuxi', name: '突袭',
            description: '摸牌阶段，你可以放弃摸牌，改为获得至多两名角色的各一张手牌。',
            type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DRAW_CARDS,
        }],
    },
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
        id: 'xiahoyuan', name: '夏侯渊', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [{
            id: 'xiahoyuan_shensu', name: '神速',
            description: '可选一至两项：①跳过判定和摸牌阶段；②跳过出牌阶段弃一张装备牌。每选一项视为对一名角色使用一张无距离限制的【杀】。',
            type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_START,
        }],
    },
    {
        id: 'xuhuang', name: '徐晃', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'xuhuang_duanliang', name: '断粮',
                description: '你可以将一张黑色基本牌或黑色装备牌当【兵粮寸断】使用。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
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
        id: 'wenpin', name: '文聘', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [{
            id: 'wenpin_zhenwei', name: '镇卫',
            description: '锁定技，对方角色计算与其他己方角色的距离时，始终+1。',
            type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
        }],
    },

    // ══════════════════════════════════════════
    // 蜀国 (8)
    // ══════════════════════════════════════════
    {
        id: 'liubei', name: '刘备', maxHp: 4, gender: 'male', kingdom: 'shu',
        skills: [{
            id: 'liubei_rende', name: '仁德',
            description: '出牌阶段，你可将任意张手牌给予其他角色。每通过此技能给出第2张牌时，回复1点体力。',
            type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
        }],
    },
    {
        id: 'liubei_jie', name: '界刘备', maxHp: 4, gender: 'male', kingdom: 'shu',
        skills: [{
            id: 'liubei_rende', name: '仁德',
            description: '出牌阶段，你可将任意张手牌给予其他角色。每通过此技能给出第2张牌时，回复1点体力。',
            type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
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
        id: 'zhangfei', name: '张飞', maxHp: 4, gender: 'male', kingdom: 'shu',
        skills: [{
            id: 'zhangfei_paoxiao', name: '咆哮',
            description: '锁定技，你使用【杀】无次数限制。',
            type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
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

    // ══════════════════════════════════════════
    // 吴国 (10)
    // ══════════════════════════════════════════
    {
        id: 'sunquan', name: '孙权', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [{
            id: 'sunquan_zhiheng', name: '制衡',
            description: '出牌阶段限一次，你可弃置任意张牌，然后摸等量的牌。',
            type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
        }],
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
        id: 'huanggai', name: '黄盖', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [{
            id: 'huanggai_kurou', name: '苦肉',
            description: '出牌阶段，你可失去1点体力，然后摸两张牌。',
            type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
        }],
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
    {
        id: 'sunjian', name: '孙坚', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [{
            id: 'sunjian_yinghun', name: '英魂',
            description: '准备阶段，若你已受伤，可令一名其他角色：摸X张牌然后弃一张牌；或摸一张牌然后弃X张牌（X为你已损失的体力值）。',
            type: SkillType.ACTIVE, trigger: SkillTrigger.ON_TURN_START,
        }],
    },
    {
        id: 'xiaoqiao', name: '小乔', maxHp: 3, gender: 'female', kingdom: 'wu',
        skills: [
            {
                id: 'xiaoqiao_tianxiang_luoshu', name: '天香',
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
        id: 'zhugejin', name: '诸葛瑾', maxHp: 3, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'zhugejin_mingzhe', name: '明哲',
                description: '你的回合外，当你使用、打出或弃置一张红色牌时，你可摸一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'zhugejin_huanshi', name: '缓释',
                description: '己方角色的判定牌生效前，你可打出一张牌代替之。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_JUDGE,
            },
            {
                id: 'zhugejin_hongyuan', name: '弘援',
                description: '摸牌阶段，你可少摸一张牌，令至多两名其他己方角色各摸一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DRAW_CARDS,
            },
        ],
    },

    // ══════════════════════════════════════════
    // 群雄 (5)
    // ══════════════════════════════════════════
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
        id: 'lvbu', name: '吕布', maxHp: 4, gender: 'male', kingdom: 'qun',
        skills: [{
            id: 'lvbu_wushuang', name: '无双',
            description: '锁定技，你使用【杀】时目标需打出两张【闪】才能抵消；你使用/成为【决斗】目标时，对方每次需打出两张【杀】。',
            type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
        }],
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
    {
        id: 'pangde', name: '庞德', maxHp: 4, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'pangde_mashu', name: '马术',
                description: '锁定技，你计算与其他角色的距离-1。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'pangde_mengjin', name: '猛进',
                description: '当你使用的【杀】被【闪】抵消时，你可以弃置该角色的一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },
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
        id: 'fuwan', name: '伏完', maxHp: 4, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'fuwan_moukui', name: '谋溃',
                description: '当你使用【杀】指定一名角色为目标后，你可以选择一项：1.摸一张牌；2.弃置该角色的一张牌。你可以同时选择两项，若如此做，当此【杀】被无效或抵消时，该角色弃置你一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },
    {
        id: 'zhangjiao', name: '张角', maxHp: 3, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'zhangjiao_leiji', name: '雷击',
                description: '当你使用或打出【闪】时，你可以令一名其他角色判定：若结果为♠，你对其造成2点雷电伤害；若结果为♣，你回复1点体力，然后对其造成1点雷电伤害。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'zhangjiao_guidao', name: '鬼道',
                description: '当一名角色的判定牌生效前，你可以打出一张黑色牌替换之，然后若你打出的牌为黑桃，你摸一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_JUDGE,
            },
        ],
    },

    // ══════════════════════════════════════════
    // 自用平衡版新增武将
    // ══════════════════════════════════════════

    // ── 魏 ──
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
    {
        id: 'simayi_jie', name: '界司马懿', maxHp: 3, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'simayi_jie_fankui', name: '反馈',
                description: '当你受到1点伤害后，你可以获得伤害来源的一张牌，然后修改“矫诏”。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
            {
                id: 'simayi_jie_guicai', name: '鬼才',
                description: '一名角色的判定牌生效前，你可打出一张牌（手牌或装备区的牌）代替之。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_JUDGE,
            },
            {
                id: 'simayi_jie_jiaozhao', name: '矫诏',
                description: '出牌阶段限一次，你可以将一张牌当任意基本牌使用。修改一：每轮限一次，你可以将一张牌当任意基本牌或普通锦囊牌使用。修改二：每轮限一次，你可以视为使用一张基本牌或普通锦囊牌。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },
    {
        id: 'xuchu_jie', name: '界许褚', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [{
            id: 'xuchu_luoyi', name: '裸衣',
            description: '摸牌阶段开始时，你可以亮出牌堆顶三张牌，获得其中的基本牌、武器牌或【决斗】并放弃摸牌；直到你的下回合开始，你为伤害来源的【杀】或【决斗】造成的伤害+1。',
            type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DRAW_CARDS,
        }],
    },
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
    {
        id: 'yuejin', name: '乐进', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [{
            id: 'yuejin_xiaoguo', name: '骁果',
            description: '其他角色的结束阶段，你可以弃置一张手牌，令该角色选择一项：1.弃置一张装备牌且你摸一张牌；2.受到1点伤害。',
            type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
        }],
    },
    {
        id: 'simalang', name: '司马朗', maxHp: 3, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'simalang_junbing', name: '郡兵',
                description: '一名角色的结束阶段，若其手牌数小于2，你可以令其摸一张牌，然后其交给你一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
            {
                id: 'simalang_quji', name: '去疾',
                description: '出牌阶段限一次，你可以弃置X张牌（X为你已损失的体力值），令至多X名角色各回复1点体力；若弃置的牌中包含黑色牌，你失去1点体力。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
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

    // ── 蜀 ──
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
    {
        id: 'zhoucang', name: '界周仓', maxHp: 4, gender: 'male', kingdom: 'shu',
        skills: [{
            id: 'zhoucang_zhongyong', name: '忠勇',
            description: '当你对其他角色使用【杀】结算结束后，你可以将此【杀】和目标角色使用的【闪】交给另一名其他角色，然后若你交给其获得的牌中包含：黑色牌，其摸一张牌；红色牌，其可以对你攻击范围内的一名角色使用一张【杀】。',
            type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
        }],
    },
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
        id: 'yanyan', name: '严颜', maxHp: 4, gender: 'male', kingdom: 'shu',
        skills: [{
            id: 'yanyan_juzhan', name: '拒战',
            description: '转换技，阳：当你成为其他角色使用【杀】的目标后，你可以与其各摸一张牌，然后其本回合不能再对你使用牌；阴：当你使用【杀】指定目标后，你可以获得其一张牌，然后你本回合不能再对其使用牌。',
            type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
        }],
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
    {
        id: 'huangquan_jing', name: '黄权', maxHp: 3, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'huangquan_dianhu', name: '点虎',
                description: '锁定技，游戏开始时，你选择一名其他角色。当你对该角色造成伤害后，或当该角色回复体力后，你摸一张牌。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_DAMAGE_DEALT,
            },
            {
                id: 'huangquan_jianji', name: '谏计',
                description: '出牌阶段限一次，你可以令一名其他角色摸一张牌，然后其可以使用该牌。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
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

    // ── 吴 ──
    {
        id: 'lingtong', name: '凌统', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [{
            id: 'lingtong_xuanfeng', name: '旋风',
            description: '当你于弃牌阶段弃置至少两张牌，或当你失去装备区里的牌后，你可以依次弃置任意名其他角色的共计至多两张牌。',
            type: SkillType.PASSIVE, trigger: SkillTrigger.ON_LOSE_EQUIP,
        }],
    },
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
                description: '出牌阶段限一次，你可以展示一张手牌并交给一名其他角色，然后令其选择一项：1.展示所有手牌，弃置与此牌花色相同的所有牌；2.失去1点体力。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },
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
        id: 'guyong', name: '界顾雍', maxHp: 3, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'guyong_shenxing', name: '慎行',
                description: '出牌阶段限X次（X为你的体力值），你可以弃置两张牌，若弃置牌颜色不同，则你摸两张牌；否则你摸一张牌。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'guyong_bingyi', name: '秉壹',
                description: '结束阶段，你可以展示所有手牌，若颜色均相同或类型均相同，你选择至多X名角色（X为你的手牌数），这些角色各摸一张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },
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
        id: 'yufan', name: '界虞翻', maxHp: 3, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'yufan_zongxuan', name: '纵玄',
                description: '当你的牌因弃置而置入弃牌堆时，或上家的牌每回合第一次因弃置而置入弃牌堆时，你可以将其中任意张牌置于牌堆顶。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DISCARD,
            },
            {
                id: 'yufan_zhiyan', name: '直言',
                description: '结束阶段，或上家的结束阶段，你可以令一名角色摸一张牌并展示之，若此牌为装备牌，则其使用此牌并回复1点体力，否则若其体力值不等于你，其失去1点体力。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },
    {
        id: 'zumao', name: '祖茂', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'zumao_yinbing', name: '引兵',
                description: '结束阶段，你可以将任意张非基本牌置于你的武将牌上；当你受到【杀】或【决斗】造成的伤害后，你移去一张“引兵”牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
            {
                id: 'zumao_juedi', name: '绝地',
                description: '锁定技，准备阶段，若你的武将牌上有“引兵”牌，你选择一项：1.移去所有“引兵”牌，将手牌摸至体力上限；2.令一名体力值不大于你的其他角色获得所有“引兵”牌，然后其回复1点体力并摸等量的牌。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_TURN_START,
            },
        ],
    },
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
        id: 'lingcao', name: '凌操', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [{
            id: 'lingcao_dufeng', name: '独锋',
            description: '锁定技，出牌阶段开始时，你选择至少一项：1.失去1点体力；2.废除一个装备栏。然后你摸X张牌，且本阶段攻击范围与使用【杀】的次数上限+X-1（X=已废除装备栏数+已损失体力值，至多体力上限）。',
            type: SkillType.LOCKED, trigger: SkillTrigger.ON_TURN_START,
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
    {
        id: 'lvbu_jing', name: '吕布-竞', maxHp: 4, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'lvbu_wushuang', name: '无双',
                description: '锁定技，①当你使用【杀】指定一名角色为目标后，其需连续使用两张【闪】才能抵消；②当你使用【决斗】指定其他角色为目标后，或成为其他角色使用【决斗】的目标后，其每次响应需连续打出两张【杀】。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'lvbu_jing_zhanshen', name: '战神',
                description: '觉醒技，准备阶段，若你已受伤且有己方角色已死亡，你减1点体力上限，弃置装备区里的所有牌，然后获得技能“神戟”和“马术”。',
                type: SkillType.AWAKENED, trigger: SkillTrigger.ON_TURN_START,
            },
        ],
    },
    {
        id: 'liuchen', name: '刘谌', maxHp: 4, gender: 'male', kingdom: 'shu',
        skills: [{
            id: 'liuchen_zhanjue', name: '战绝',
            description: '出牌阶段，你可以将所有手牌当【决斗】使用，然后你和因此受伤的角色各摸一张牌。若你本阶段以此法摸过至少三张牌，本阶段此技能失效。',
            type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
        }],
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

    // ══════════════════════════════════════════
    // 洛书版新增（16 名）
    // ══════════════════════════════════════════
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
    {
        id: 'haozhao', name: '郝昭', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [{
            id: 'haozhao_zhengu', name: '镇骨',
            description: '结束阶段，你可以选择一名其他角色，你的回合结束时和该角色的下个回合结束时，其将手牌摸至（至多摸至五张）或弃置至与你手牌数相同。',
            type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
        }],
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
    {
        id: 'sundeng', name: '孙登', maxHp: 3, gender: 'male', kingdom: 'wu',
        skills: [{
            id: 'sundeng_kuangbi', name: '匡弼',
            description: '出牌阶段限一次，你可以令一名其他角色将至多三张牌置于你的武将牌上。若如此做，你的下个回合开始时，你获得这些牌，然后该角色摸等量的牌。',
            type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
        }],
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
        id: 'caoxiu', name: '曹休', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'caoxiu_qianju', name: '千驹',
                description: '锁定技，你计算与其他角色的距离-X（X为你已损失的体力值）。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'caoxiu_qingxi', name: '倾袭',
                description: '当你使用【杀】对目标角色造成伤害时，若你的装备区里有武器牌，你可以令其选择一项：1.弃置等同于你武器牌攻击范围数张手牌，然后弃置你装备区里的武器牌；2.令此伤害+1。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_DEALT,
            },
        ],
    },
    {
        id: 'guohuanghou', name: '郭皇后', maxHp: 3, gender: 'female', kingdom: 'wei',
        skills: [
            {
                id: 'guohuanghou_jiaozhao', name: '矫诏',
                description: '出牌阶段限一次，你可以展示一张手牌，然后令一名距离最近的其他角色声明一种基本牌的牌名，本回合你可以将此牌当声明的牌使用（不能指定自己为目标）。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'guohuanghou_danxin', name: '殚心',
                description: '当你受到伤害后，你可以摸一张牌，或对技能“矫诏”依次执行一次修改：1.将“基本牌”改为“基本牌或普通锦囊牌”；2.“令一名距离最近的其他角色”改为“你”。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
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
    {
        id: 'gongsunyuan', name: '公孙渊', maxHp: 4, gender: 'male', kingdom: 'qun',
        skills: [{
            id: 'gongsunyuan_huaiyi', name: '怀异',
            description: '出牌阶段限一次，你可以展示所有手牌，若包含两种颜色，你弃置其中一种颜色的所有牌，然后获得至多X名其他角色的各一张牌（X为你以此法弃置的手牌数）。若你以此法获得的牌大于一张，你失去1点体力。',
            type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
        }],
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
    // ══════════════════════════════════════════
    // 洛书版扩展（二）：新武将
    // ══════════════════════════════════════════
    {
        id: 'xiahouyuan_jie', name: '界夏侯渊', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'xiahoyuan_shensu', name: '神速',
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
                description: '当你受到1点伤害后，你可以令一名角色摸X张牌，然后其将手牌弃置至X张（X为其体力上限且至多为5）。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
        ],
    },
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
        id: 'pangtong', name: '庞统', maxHp: 3, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'pangtong_lianhuan', name: '连环',
                description: '出牌阶段，你可以将一张手牌当【铁索连环】使用或重铸。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'pangtong_niepan', name: '涅槃',
                description: '限定技，当你处于濒死状态时，你可以弃置你区域里所有的牌，然后复原你的武将牌并摸三张牌。若如此做，你将体力值回复至3点。',
                type: SkillType.LIMITED, trigger: SkillTrigger.ON_DYING,
            },
        ],
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
        id: 'taishici', name: '太史慈', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [{
            id: 'taishici_tianyi', name: '天义',
            description: '出牌阶段限一次，你可以与一名角色拼点，然后你本回合根据拼点结果获得对应效果：若你赢，则你使用【杀】的次数上限+1、使用【杀】无距离限制、使用【杀】的目标数上限+1，否则你不能使用【杀】。',
            type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
        }],
    },
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
        id: 'lusu', name: '鲁肃', maxHp: 3, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'lusu_haoshi', name: '好施',
                description: '摸牌阶段，你可以多摸两张牌，然后若你的手牌数大于5，你将一半的手牌（向下取整）交给手牌最少的一名其他角色。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DRAW_CARDS,
            },
            {
                id: 'lusu_dimeng', name: '缔盟',
                description: '出牌阶段限一次，你可以选择两名其他角色并弃置X张牌（X为这两名角色手牌数的差），然后令这两名角色交换手牌。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
        ],
    },
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
    // ══════════════════════════════════════════
    // 洛书版扩展（二）：界武将
    // ══════════════════════════════════════════
    {
        id: 'zhugeliang_jie', name: '界诸葛亮', maxHp: 3, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'zhugeliang_guanxing', name: '观星',
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
    {
        id: 'sunjian_jie', name: '界孙坚', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'sunjian_yinghun', name: '英魂',
                description: '准备阶段，若你已受伤，你可以选择一名其他角色并选择一项令其执行之：1.摸X张牌并弃置一张牌；2.摸一张牌并弃置X张牌（X为你已损失的体力值）。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_START,
            },
            {
                id: 'sunjian_wulie', name: '武烈', description: '限定技，结束阶段，你可以失去任意点体力，令等量的其他角色各获得1个“烈”标记（有“烈”的角色受到伤害时，防止此伤害，然后移去“烈”）。',
                type: SkillType.LIMITED, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },
    {
        id: 'sunce_jie', name: '界孙策', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'sunce_jiang', name: '激昂',
                description: '①当你使用【决斗】或红色【杀】指定目标后，或成为【决斗】或红色【杀】的目标后，你可以摸一张牌；②当每回合首次有【决斗】和红色【杀】因弃置进入弃牌堆后，你可以失去1点体力并获得之。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'sunce_hunzi', name: '魂姿',
                description: '觉醒技，准备阶段，若你的体力值为1，你减1点体力上限，获得技能“英姿”和“英魂”，然后本回合结束阶段，你选择一项：1.摸两张牌；2.回复1点体力。',
                type: SkillType.AWAKENED, trigger: SkillTrigger.ON_TURN_START,
            },
        ],
    },
    {
        id: 'guojia_jie', name: '界郭嘉', maxHp: 3, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'guojia_tiandu', name: '天妒',
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
        id: 'huatuo_jie', name: '界华佗', maxHp: 3, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'huatuo_jijiu', name: '急救',
                description: '你的回合外，你可以将一张红色牌当【桃】使用。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DYING,
            },
            {
                id: 'huatuo_chuli', name: '除疠',
                description: '出牌阶段限一次，你可以选择任意名势力各不相同的其他角色，然后弃置你和这些角色的各一张牌。因此被弃置牌的角色各摸一张牌。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
        ],
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
                id: 'diaochan_biyue', name: '闭月',
                description: '结束阶段，若你有手牌，则你可以摸一张牌，否则你可以摸两张牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },
    {
        id: 'xuhuang_jie', name: '界徐晃', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'xuhuang_duanliang', name: '断粮',
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
        id: 'huangyueying_jie', name: '界黄月英', maxHp: 3, gender: 'female', kingdom: 'shu',
        skills: [
            {
                id: 'huangyueying_jizhi', name: '集智',
                description: '当你使用一张非转化的锦囊牌时，你可以摸一张牌。若此牌为基本牌，你可以弃置此牌，令你本回合的手牌上限+1。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'huangyueying_qicai', name: '奇才',
                description: '锁定技，①你使用锦囊牌无距离限制；②当其他角色弃置你装备区里的防具牌时，取消之。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },
    {
        id: 'zhangliao_jie', name: '界张辽', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [{
            id: 'zhangliao_tuxi', name: '突袭',
            description: '摸牌阶段，你可以少摸任意张牌，然后获得等量名其他角色的各一张手牌。',
            type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DRAW_CARDS,
        }],
    },
    {
        id: 'zhenji_jie', name: '界甄姬', maxHp: 3, gender: 'female', kingdom: 'wei',
        skills: [
            {
                id: 'zhenji_luoshen', name: '洛神',
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
    {
        id: 'huanggai_jie', name: '界黄盖', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'huanggai_kurou', name: '苦肉',
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
    {
        id: 'pangde_jie', name: '界庞德', maxHp: 4, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'pangde_mashu', name: '马术',
                description: '锁定技，你计算与其他角色的距离-1。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'pangde_jianchu', name: '鞬出',
                description: '当你使用【杀】指定其他角色为目标后，你可以弃置该角色的一张牌，若此牌不为基本牌，则其不能使用【闪】响应此【杀】、你本回合使用【杀】的次数上限+1，否则其获得此【杀】。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USE_CARD,
            },
        ],
    },
    {
        id: 'jiaxu_jie', name: '界贾诩', maxHp: 3, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'jiaxu_wansha', name: '完杀',
                description: '锁定技，你的回合内，当一名角色进入濒死状态时，你令除你和其以外的角色不能对其使用【桃】且所有非锁定技失效直到此次濒死结算结束。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_DYING,
            },
            {
                id: 'jiaxu_luanwu', name: '乱武',
                description: '限定技，出牌阶段，你可以令所有其他角色依次选择一项：1.对其攻击范围内距离最近的另一名角色使用一张【杀】；2.失去1点体力。所有结算结束后，你可以视为使用一张无距离限制的【杀】。',
                type: SkillType.LIMITED, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'jiaxu_weimu', name: '帷幕',
                description: '锁定技，①你不能成为黑色锦囊牌的目标；②当你于回合内受到伤害时，防止此伤害并摸伤害值的两倍数量的牌。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
        ],
    },
    {
        id: 'chengong_jie', name: '界陈宫', maxHp: 3, gender: 'male', kingdom: 'qun',
        skills: [
            {
                id: 'chengong_mingce', name: '明策',
                description: '出牌阶段限一次，你可以交给一名其他角色一张装备牌或【杀】，并选择另一名角色，令其选择一项：1.视为对你选择的角色使用一张【杀】，若此【杀】造成过伤害，你与其各摸一张牌；2.令你与其各摸一张牌。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'chengong_zhichi', name: '智迟',
                description: '锁定技，当你于回合外受到伤害后，本回合【杀】和普通锦囊牌对你无效。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_DAMAGE_RECEIVED,
            },
        ],
    },
    // ── 洛书版扩展（三）：界将升级 ──
    {
        id: 'sunshangxiang_jie', name: '界孙尚香', maxHp: 3, gender: 'female', kingdom: 'wu',
        skills: [
            {
                id: 'sunshangxiang_jieyuan', name: '结姻',
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
        id: 'daqiao_jie', name: '界大乔', maxHp: 3, gender: 'female', kingdom: 'wu',
        skills: [
            {
                id: 'daqiao_jie_guose', name: '国色',
                description: '出牌阶段限一次，你可以选择一项：1.将一张♦牌当【乐不思蜀】使用；2.弃置一张♦牌，并弃置场上的一张【乐不思蜀】。选择结束后，你摸一张牌。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'daqiao_liuli', name: '流离',
                description: '当你成为其他角色使用【杀】的目标时，你可以弃置一张牌，将此【杀】转移给你攻击范围内的另一名其他角色。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USED_AS_TARGET,
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
                id: 'chengpu_chunlao', name: '醇醪',
                description: '当你或与你相邻的角色的【杀】因弃置而置入弃牌堆后，你将此【杀】置于你的武将牌上，称为“醇”（你至多拥有九张“醇”；当一名角色处于濒死状态时，你可以移去X张“醇”，令该角色视为使用一张【酒】，X为你本轮以此法使用【酒】的次数）。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DISCARD,
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
        id: 'caoxiu_jie', name: '界曹休', maxHp: 4, gender: 'male', kingdom: 'wei',
        skills: [
            {
                id: 'caoxiu_qianju', name: '千驹',
                description: '锁定技，你每损失1点体力，你计算与其他角色的距离便-1。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
            },
            {
                id: 'caoxiu_jie_qingxi', name: '倾袭',
                description: '当你使用【杀】时，你可以选择一项：1.令所有目标弃置你攻击范围张牌；2.此【杀】伤害+1。若你的装备区有武器牌，则改为其依次执行这两项，然后弃置此牌。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_DAMAGE_DEALT,
            },
        ],
    },
    {
        id: 'wangyi_jie', name: '界王异', maxHp: 3, gender: 'female', kingdom: 'wei',
        skills: [
            {
                id: 'wangyi_jie_zhenlie', name: '贞烈',
                description: '当你成为其他角色使用【杀】或普通锦囊牌的目标后，你可以失去1点体力，令此牌对你无效，然后你选择一项：1.获得其一张牌；2.于本回合的结束阶段发动一次“秘计”。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_USED_AS_TARGET,
            },
            {
                id: 'wangyi_miji', name: '秘计',
                description: '结束阶段，你可以摸X张牌（X为你已损失的体力值），然后可以将至多等量的牌交给其他角色。',
                type: SkillType.PASSIVE, trigger: SkillTrigger.ON_TURN_END,
            },
        ],
    },
    {
        id: 'zhangfei_jie', name: '界张飞', maxHp: 4, gender: 'male', kingdom: 'shu',
        skills: [
            {
                id: 'zhangfei_paoxiao', name: '咆哮',
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
    // ── 洛书版扩展（四）：新增武将 ──
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
    // ══ 洛书版扩展（五）：新增武将 ══
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
        id: 'fuhuanghou_jie', name: '界伏皇后', maxHp: 3, gender: 'female', kingdom: 'qun',
        skills: [
            {
                id: 'fuhuanghou_chuikong', name: '惴恐',
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
    // ══════════════════════════════════════════
    // 洛书版扩展（九）：新增武将
    // ══════════════════════════════════════════
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
        id: 'sunchen', name: '孙綝', maxHp: 4, gender: 'male', kingdom: 'wu',
        skills: [
            {
                id: 'sunchen_nigu', name: '逆固',
                description: '出牌阶段限一次，你可以弃置任意张花色不同的牌，令攻击范围内的所有角色同时选择是否交给你一张牌，然后你本回合下X次造成的伤害+1（X为以此法选择不交给你牌的角色数）。',
                type: SkillType.ACTIVE, trigger: SkillTrigger.ACTIVE,
            },
            {
                id: 'sunchen_lulian', name: '戮连',
                description: '锁定技，你使用手牌结算后，若你没有此类别的手牌，且有目标角色：①体力值小于等于你，此牌所有目标进入连环状态；②装备区牌数小于等于你，你摸一张牌。若上述两个条件均满足：你对一名体力值不为最小的角色造成1点火焰伤害。',
                type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
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
]

/** 觉醒/转化获得、但未挂在武将原生技能列表里的技能（仅用于展示与查询） */
const GRANTED_SKILL_DEFS: SkillDefinition[] = [
    {
        id: 'lvbu_jing_shenji', name: '神戟',
        description: '锁定技，你使用【杀】的次数上限+1；你使用【杀】可以额外指定至多两名目标。',
        type: SkillType.LOCKED, trigger: SkillTrigger.ON_USE_CARD,
    },
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

/** 武将池版本：classic2013 = 统率三军 2013 版；custom = 平衡版；luoshu = 洛书版 */
export type GeneralPoolVersion = 'classic2013' | 'custom' | 'luoshu'

const POOL_PREF_KEY = 'sgs3v3_pool'

/** 读取武将池偏好（默认 2013 版，脏值/异常回退默认） */
export function getPoolPreference(): GeneralPoolVersion {
    try {
        if (typeof localStorage === 'undefined') return 'classic2013'
        const raw = localStorage.getItem(POOL_PREF_KEY)
        if (raw === 'custom' || raw === 'classic2013' || raw === 'luoshu') return raw
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
 * 平衡版武将白名单（严格按下列顺序；共 60 席）
 * 尚未实现定义的 id 由 getGeneralPool('custom') 跳过
 */
export const CUSTOM_POOL_IDS: string[] = [
    // 魏 (18)
    'guojia', 'zhangliao', 'zhenji', 'wenpin', 'xiahoudun_jing', 'lidian_jie',
    'simayi_jie', 'xuchu_jie', 'dengai', 'xunyou', 'wangyi', 'wangji',
    'yuejin', 'simalang', 'litong', 'caocao_jie', 'dianwei_jie', 'xuhuang_jie',
    // 蜀 (14)
    'liubei_jie', 'zhangfei', 'zhugeliang', 'huangyueying', 'zhaoyun_jing', 'jiangwei',
    'machao_jie', 'madai', 'sunshangxiang_sp', 'zhoucang', 'yanyan', 'wangping',
    'huangquan_jing', 'sunqian',
    // 吴 (18)
    'sunquan', 'huanggai', 'zhugejin', 'sunjian', 'daqiao', 'xiaoqiao',
    'lingtong', 'ganning_jie', 'zhouyu_jie', 'sunce', 'luxun_jie', 'guyong', 'dingfeng',
    'yufan', 'zumao', 'zhugeke', 'lingcao', 'zhuhuan',
    // 群 (10)
    'zhangjiao', 'huatuo', 'jiaxu', 'diaochan', 'chengong', 'caifuren',
    'jushou', 'lvbu_jing', 'pangde', 'fuwan',
]

/**
 * 洛书版武将池：按定位分类展示，共 147 名。
 */
export const LUOSHU_POOL_IDS: string[] = [
    // 辅助（23）
    'liubei_jie', 'guojia_jie', 'caorui', 'lusu', 'xiahoudun_jing', 'luxun_jie',
    'zhangsong_jie', 'zhongyao', 'chenqun', 'xunyu', 'xujing', 'liushan',
    'chengong_jie', 'xiaoqiao', 'zhoufei', 'xiahoushi', 'sunshangxiang_sp', 'guyong',
    'kanze', 'shenlusu', 'baoxin', 'xizhicai', 'liuxie',
    // 牌差（29）
    'lidian_jie', 'wangji', 'sunquan', 'lingtong', 'huangyueying_jie', 'wangping',
    'zhenji_jie', 'huangquan_jing', 'sunjian_jie', 'zhouyu_jie', 'sunqian', 'zumao',
    'jushou', 'handang', 'fazheng', 'sundeng', 'guotu', 'quancong',
    'zhangzhaozhanghong_jie', 'bulianshi_jie', 'kuailiangkuaiyue', 'zhoufang', 'guohuai_jie', 'sunxiu',
    'zhuzhi', 'zhuran_jie', 'guanqiujian', 'chenlin', 'lifeng', 'xuezong',
    // 菜刀（22）
    'xuchu_jie', 'zhangfei_jie', 'machao_jie', 'litong', 'zhoucang', 'madai',
    'dingfeng', 'lingcao', 'lvbu_jing', 'pangde_jie', 'fuwan', 'guanyu',
    'weiyan', 'caoxiu_jie', 'xiahouyuan_jie', 'zhurong_jie', 'taishici_jie', 'gaoshun_jie',
    'lisu', 'caozhang_jie', 'shamoke', 'caochun',
    // 直伤（23）
    'dianwei_jie', 'huanggai_jie', 'yuejin', 'zhugeke', 'zhangjiao', 'jiaxu_jie',
    'diaochan_jie', 'caifuren_jie', 'liuchen', 'huaxiong_jie', 'cenhun', 'guanyinping',
    'pangtong', 'yanliangwenchou_jie', 'yufan', 'zhuhuan', 'huangzhong_jie', 'zhangxiu',
    'liru', 'quyi', 'hetaihou', 'sunchen', 'lingju',
    // 控制（27）
    'daqiao_jie', 'fuhuanghou_jie', 'xuhuang_jie', 'hanhaosihuan', 'ganning_jie', 'wenpin',
    'zhugeliang_jie', 'xuyou', 'zhugezhan', 'gongsunyuan', 'masu', 'zhanghulelin',
    'zhangliao_jie', 'liufeng', 'zhanghe', 'wolong', 'caoren', 'caoren_sp',
    'dongyun', 'zhugejin', 'simayi_jie', 'xunyou', 'jiangwei', 'haozhao',
    'sunluyu', 'peixiu', 'chengyu',
    // 肉盾（13）
    'qinmi', 'caoang', 'dengai', 'wangyi_jie', 'caocao_jie', 'yanyan',
    'sunce_jie', 'luji', 'dongzhuo', 'zhonghui_jie', 'zhangchunhua_jie', 'caochong_jie',
    'panjun',
    // 回复（9）
    'zhaoyun_jing', 'shenzhaoyun', 'shanzhaoyun', 'huatuo_jie', 'sunshangxiang_jie', 'chengpu_jie',
    'mizhu', 'simalang', 'caiwenji_sp',
]

/** 统率三军 2013 版武将池（原始 32 人） */
export const CLASSIC_POOL_IDS: string[] = [
    // 魏 (9)
    'caocao', 'simayi', 'zhangliao', 'guojia', 'zhenji', 'xiahoyuan', 'xuhuang', 'xiahoudun', 'wenpin',
    // 蜀 (8)
    'liubei', 'guanyu', 'zhangfei', 'zhugeliang', 'zhaoyun_jing', 'machao', 'huangyueying', 'jiangwei',
    // 吴 (10)
    'sunquan', 'ganning', 'huanggai', 'zhouyu', 'daqiao', 'sunshangxiang', 'sunjian', 'xiaoqiao', 'sunce',
    'zhugejin',
    // 群 (5)
    'huatuo', 'lvbu', 'diaochan', 'pangde', 'jiaxu',
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
    if (version === 'custom') {
        // 按白名单顺序过滤，未定义（本次未新增）的 id 直接跳过
        return poolFromIds(CUSTOM_POOL_IDS)
    }
    if (version === 'luoshu') {
        return poolFromIds(LUOSHU_POOL_IDS)
    }
    return poolFromIds(CLASSIC_POOL_IDS)
}

/** 按 ID 获取武将定义 */
export function getGeneralById(id: string): GeneralDefinition | undefined {
    return GENERALS.find((g) => g.id === id)
}
