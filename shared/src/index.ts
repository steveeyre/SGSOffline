// ============================================================
// 三国杀 3v3 — 共享类型定义
// ============================================================

// ─────────────────────────────────────────────────────────────
// 基础枚举
// ─────────────────────────────────────────────────────────────

/** 阵营 */
export enum Faction {
    WARM = 'warm',
    COOL = 'cool',
}

/** 座位角色 */
export enum SeatRole {
    COMMANDER = 'commander',
    FLANK_A = 'flank_a',
    FLANK_B = 'flank_b',
}

/** 游戏阶段 */
export enum GamePhase {
    WAITING = 'waiting',
    GENERAL_PICK = 'general_pick',
    DEPLOY = 'deploy',
    PLAYING = 'playing',
    GAME_OVER = 'game_over',
}

/** 对局模式 */
export enum GameMode {
    CLASSIC = 'classic',
    DOUDIZHU = 'doudizhu',
    HUANLE_SHUANG = 'huanle_shuang',
}

/** 回合阶段 */
export enum TurnPhase {
    TURN_START = 'turn_start',
    JUDGE = 'judge',
    DRAW = 'draw',
    ACTION = 'action',
    DISCARD = 'discard',
    TURN_END = 'turn_end',
}

/** 行动单元类型 */
export enum ActionUnitType {
    COMMANDER = 'commander',
    FLANKS = 'flanks',
}

/** 卡牌花色 */
export enum CardSuit {
    SPADE = 'spade',
    HEART = 'heart',
    CLUB = 'club',
    DIAMOND = 'diamond',
}

/** 卡牌类型大类 */
export enum CardCategory {
    BASIC = 'basic',
    TRICK = 'trick',
    EQUIPMENT = 'equipment',
}

/** 基本牌名 */
export enum BasicCardName {
    ATTACK = 'attack',
    FIRE_SLASH = 'fire_slash',
    THUNDER_SLASH = 'thunder_slash',
    DODGE = 'dodge',
    PEACH = 'peach',
    WINE = 'wine',
}

/** 锦囊牌子类型 */
export enum TrickType {
    INSTANT = 'instant',
    DELAYED = 'delayed',
}

/** 锦囊牌名 */
export enum TrickCardName {
    DRAW_TWO = 'draw_two',
    DISMANTLE = 'dismantle',
    STEAL = 'steal',
    DUEL = 'duel',
    BARBARIANS = 'barbarians',
    ARROWS = 'arrows',
    PEACH_GARDEN = 'peach_garden',
    HARVEST = 'harvest',
    NEGATE = 'negate',
    BORROW_SWORD = 'borrow_sword',
    OVERINDULGENCE = 'overindulgence',
    SUPPLY_SHORTAGE = 'supply_shortage',
    FIRE_ATTACK = 'fire_attack',
    IRON_CHAIN = 'iron_chain',
    LIGHTNING = 'lightning',
}

/** 装备区槽位 */
export enum EquipSlot {
    WEAPON = 'weapon',
    ARMOR = 'armor',
    PLUS_HORSE = 'plus_horse',
    MINUS_HORSE = 'minus_horse',
}

/** 装备牌名 */
export enum EquipmentCardName {
    // 武器
    CROSSBOW = 'crossbow',               // 连弩
    DOUBLE_SWORDS = 'double_swords',     // 雌雄双股剑
    QINGGANG_SWORD = 'qinggang_sword',   // 青釭剑
    ICE_SWORD = 'ice_sword',             // 寒冰剑
    ZHANGBA_SPEAR = 'zhangba_spear',     // 丈八蛇矛
    GREEN_DRAGON = 'green_dragon',       // 青龙偃月刀
    STONE_AXE = 'stone_axe',             // 贯石斧
    FANGTIAN_HALBERD = 'fangtian_halberd', // 方天画戟
    KYLIN_BOW = 'kylin_bow',             // 麒麟弓
    GUDING_BLADE = 'guding_blade',       // 古锭刀
    ZHUQUE_FAN = 'zhuque_fan',           // 朱雀羽扇
    // 防具
    EIGHT_TRIGRAMS = 'eight_trigrams',    // 八卦阵
    NIOH_SHIELD = 'nioh_shield',         // 仁王盾
    VINE = 'vine',                       // 藤甲
    SILVER_LION = 'silver_lion',         // 白银狮子
    // 坐骑
    PLUS_HORSE = 'plus_horse',           // +1 马
    MINUS_HORSE = 'minus_horse',         // -1 马
}

/** 武将技能类型 */
export enum SkillType {
    ACTIVE = 'active',
    PASSIVE = 'passive',
    LOCKED = 'locked',
    LIMITED = 'limited',
    AWAKENED = 'awakened',
}

/** 技能触发时机 */
export enum SkillTrigger {
    ON_TURN_START = 'on_turn_start',
    ON_DRAW_CARDS = 'on_draw_cards',
    ON_USE_CARD = 'on_use_card',
    ON_USED_AS_TARGET = 'on_used_as_target',
    ON_DAMAGE_DEALT = 'on_damage_dealt',
    ON_DAMAGE_RECEIVED = 'on_damage_received',
    ON_HP_CHANGED = 'on_hp_changed',
    ON_DYING = 'on_dying',
    ON_KILLED = 'on_killed',
    ON_TURN_END = 'on_turn_end',
    ON_JUDGE = 'on_judge',
    ON_DISCARD = 'on_discard',
    ON_LOSE_EQUIP = 'on_lose_equip',
    ACTIVE = 'active',
}

// ─────────────────────────────────────────────────────────────
// 卡牌
// ─────────────────────────────────────────────────────────────

export interface Card {
    id: string
    suit: CardSuit
    value: number           // 1(A) ~ 13(K)
    category: CardCategory
    name: BasicCardName | TrickCardName | EquipmentCardName
    equipSlot?: EquipSlot
    trickType?: TrickType
    attackRange?: number    // 武器专属
    /** 杀的属性：普通 / 火 / 雷（仅杀类基本牌） */
    nature?: 'normal' | 'fire' | 'thunder'
    // 技能转换牌在判定区时保存原始身份（断粮/国色等）
    originalName?: BasicCardName | TrickCardName | EquipmentCardName
    originalCategory?: CardCategory
    /** 虚视为的牌（如神速/长标），不进入弃牌堆 */
    virtual?: boolean
}

// ─────────────────────────────────────────────────────────────
// 武将
// ─────────────────────────────────────────────────────────────

export interface SkillDefinition {
    id: string
    name: string
    description: string
    type: SkillType
    trigger?: SkillTrigger
}

export interface GeneralDefinition {
    id: string
    name: string
    maxHp: number
    gender: 'male' | 'female'
    kingdom: 'wei' | 'shu' | 'wu' | 'qun'
    skills: SkillDefinition[]
}

// ─────────────────────────────────────────────────────────────
// 武将实例（游戏中）
// ─────────────────────────────────────────────────────────────

export interface EquipZone {
    [EquipSlot.WEAPON]?: Card
    [EquipSlot.ARMOR]?: Card
    [EquipSlot.PLUS_HORSE]?: Card
    [EquipSlot.MINUS_HORSE]?: Card
}

export interface GeneralInstance {
    generalId: string
    playerId: string
    faction: Faction
    seatRole: SeatRole
    hp: number
    maxHp: number
    hand: Card[]
    equip: EquipZone
    judgeZone: Card[]
    alive: boolean
    usedLimitedSkills: string[]
    /** 述志（界曹操）：被修改为限定技的技能 ID */
    shuzhiLimited?: string
    hasActed: boolean
    /** 觉醒技是否已触发 */
    awakened: boolean
    /** 忠义牌（关羽限定技） */
    loyaltyCard?: Card
    /** 本回合已使用的技能（限一次的技能追踪） */
    skillsUsedThisTurn: string[]
    /** 觉醒后获得的额外技能 ID */
    acquiredSkills: string[]
    /** 仁德本回合已给出的牌数 */
    rendeGivenThisTurn: number
    /** 仁德本回合是否已回复过体力 */
    rendeHealedThisTurn: boolean
    /** 铁索连环：是否横置 */
    chained: boolean
    /** 本回合是否已饮酒（酒杀加伤标记） */
    wineDrunk: boolean
    /** 酒的加成已绑定到的那张【杀】的本回合序号，用掉即失效 */
    wineBonusAttackNo?: number

    // ── 通用状态位（新武将技能用，均可选） ──
    /** 置于武将牌上的牌（谦逊/引兵/屯田等） */
    generalPile?: Card[]
    /** 本弃牌阶段已弃置的手牌数（旋风） */
    discardedHandThisPhase?: number
    /** 本回合受到的伤害值 */
    damageTakenThisTurn?: number
    /** 本回合造成的伤害值 */
    damageDealtThisTurn?: number
    /** 本回合最后使用的牌的花色与点数（渐营） */
    lastUsedCard?: { suit: CardSuit; value: number }
    /** 奋迅：本回合无视与其距离的目标下标 */
    fenxunTargetIndex?: number
    /** 奋迅：本回合是否已对该目标造成过伤害 */
    fenxunDamagedTarget?: boolean
    /** 黩武：本阶段是否已锁定 */
    duwuLockedThisPhase?: boolean
    /** 已废除的装备栏（凌操） */
    abolishedSlots?: EquipSlot[]
    /**
     * 智迟（陈宫）：免疫【杀】与普通锦囊牌的回合标识。
     * 记录“受到伤害时所处的回合”（= 当时行动武将的下标）；
     * 当前行动武将与之相同才免疫，回合切换时由 runTurnStart 清零。
     */
    zhichiImmuneTurn?: number

    // ── 自用平衡版新武将状态位（均可选） ──
    /** 裸衣（界许褚）：本回合【杀】/【决斗】伤害+1，持续到自己下回合开始 */
    luoyiActive?: boolean
    /** 铁骑（界马超）：非锁定技失效，持续到目标下回合开始 */
    skillsDisabled?: boolean
    /** 潜袭（马岱）：本回合不能使用/打出该颜色的手牌 */
    qianxiColor?: 'red' | 'black'
    /** 拒战（严颜）：true=阳，false=阴 */
    juzhanYang?: boolean
    /** 奇制（王基）：本回合发动次数 */
    qizhiCount?: number
    /** 良助（SP孙尚香）：曾令其摸牌的角色 generalId 列表 */
    liangzhuHelped?: string[]
    /** 已失去的技能（SP孙尚香返乡） */
    lostSkills?: string[]
    /** 飞军（王平）：兵略已结算过的角色下标 */
    feijunTargets?: number[]
    /** 劝谏（黄权）：本回合不能使用手牌 */
    cannotUseHandTurn?: number
    /** 劝谏（黄权）：本回合下一次受到的伤害+1 */
    damageTakenBonusTurn?: number
    /** 独锋（凌操）：本阶段攻击范围与杀次数加成 */
    dufengBonus?: number
    /** 严颜拒战：本回合不能对其使用牌的目标下标 */
    forbiddenTargetIndex?: number
    forbiddenTargetTurn?: number
    /** 谦逊（界陆逊）：置于武将牌上的手牌返还回合 */
    qianxunPileTurn?: number
    /** 本回合使用过的牌数（蔡夫人窃听） */
    cardsUsedThisTurn?: number
    /** 推锋（李通）：本回合额外的【杀】次数上限 */
    extraSlashCount?: number
    /** 强袭（界典韦）：本阶段已发动次数 */
    qiangxiUsesPhase?: number
    /** 强袭（界典韦）：本阶段已指定过的目标下标 */
    qiangxiTargetsPhase?: number[]
    /** 本回合受到的伤害次数（狞恶） */
    damageTimesThisTurn?: number
    /** 点虎（黄权）：选定的其他角色下标 */
    dianhuTargetIndex?: number
    /** 点虎（黄权）：是否已询问过选择目标 */
    dianhuPrompted?: boolean

    // ── 洛书版新武将状态位（均可选） ──
    /** 战绝（刘谌）：本阶段以此法摸牌数，达到 2 后本阶段失效 */
    zhanjueDrawnThisPhase?: number
    /** 奇谋（魏延）：本回合与其他角色计算距离的减少值 */
    qimouDistanceReduce?: number
    /** 奇谋（魏延）：本回合【杀】次数上限加成 */
    qimouSlashBonus?: number

    // ── 洛书版第二批武将状态位（均可选） ──
    /** 怀橘（陆绩）：持有“橘”标记数 */
    orangeMarks?: number
    /** 袭爵（张虎乐綝）：持有“爵”标记数 */
    jueMarks?: number
    /** 本回合手牌上限的覆盖值（急攻：等于本阶段造成的伤害） */
    handLimitOverride?: number
    /** 本回合手牌上限的增减（极奢） */
    handLimitDelta?: number
    /** 成略（许攸）：本回合无距离与次数限制的花色 */
    chenglueSuits?: CardSuit[]
    /** 成略（许攸）：转换技当前形态，true = 阳 */
    chenglueYang?: boolean
    /** 恃才（许攸）：本回合已使用过的牌的类别 */
    usedCardCategories?: string[]
    /** 活墨（钟繇）：本回合已使用过的基本牌牌名 */
    basicUsedThisTurn?: string[]
    /** 翻面：true 表示背面朝上（下个回合跳过） */
    flipped?: boolean
    /** 本回合【杀】可指定的目标数加成（天义/陷阵） */
    extraSlashTargets?: number
    /** 本回合【杀】无距离限制（天义/诈降/长标） */
    slashNoRangeTurn?: boolean
    /** 本回合不能使用【杀】（天义败/陷阵败） */
    cannotSlashTurn?: boolean
    /** 陷阵：无视该角色防具 */
    ignoreArmorTargetIndex?: number
    /** 陷阵：对该角色使用牌无距离与次数限制 */
    unlimitedTargetIndex?: number
    /** 陷阵：使用牌可额外指定该角色为目标 */
    extraTargetIndex?: number
    /** 天义/诈降：红色【杀】不可被【闪】响应 */
    slashUnavoidableTurn?: boolean
    /** 诈降：本阶段红色【杀】无距离限制（黑色【杀】不受影响） */
    slashRedRangeTurn?: boolean
    /** 激昂②（界孙策）：本回合已因弃置获得过红色【杀】或【决斗】 */
    jiangJieTurn?: number
    /** 魂姿（界孙策）：觉醒回合结束阶段的选择待结算 */
    hunziEndChoice?: boolean
    /** 观星（界诸葛亮）：本回合结束阶段可再次观星 */
    guanxingEndAgain?: boolean
    /** 英姿：手牌上限等于体力上限 */
    handLimitEqualsMaxHp?: boolean
    /** 双雄：本回合可将与此颜色不同的牌当【决斗】使用 */
    shuangxiongColor?: 'red' | 'black'
    /** 品第：本回合发动次数、已选角色与已用类别 */
    pindiCount?: number
    pindiTargets?: number[]
    pindiCategories?: string[]
    /** 断发：本阶段已弃置的黑色牌数 */
    duanfaCount?: number
    /** 武烈：受到的“烈”标记数 */
    lieMarks?: number
    /** 清俭：已发动过的回合（每回合限一次） */
    qingjianTurn?: number
    /** 追忆：已发动过（可于死亡时再次发动） */
    zhuiyiUsed?: boolean
    /** 箜声：本回合置于武将牌上的牌（结束阶段处理） */
    kongshengActive?: boolean
    /** 陷阵拼点没赢：本回合不能对其使用【杀】 */
    xianzhenLoseIndex?: number
    /** 本回合对你造成伤害的牌 id（双雄②） */
    damagedCardIds?: string[]
    /** 虎啸/长标等：本阶段结束时要摸的牌数 */
    phaseEndDraw?: number
    /** 长标：本阶段造成的伤害数（结束时摸等量牌） */
    changbiaoDamaged?: number
    /** 弓骑（韩当）：本阶段攻击范围无限 */
    infiniteRangePhase?: boolean
    /** 疠火（程普）：本次【杀】由疠火转化为火【杀】 */
    lihuoFirePhase?: boolean
    /** 疠火（程普）：本次转化【杀】是否造成过伤害 */
    lihuoDamaged?: boolean
    /** 镇骨（郝昭）：回合结束时需结算的目标下标 */
    zhenguTargets?: number[]
    /** 镇骨：施加者下标（被镇骨者的下个回合结束时结算） */
    zhenguBy?: number
    /** 匡弼（孙登）：武将牌上“匡弼”牌的来源与数量 */
    kuangbiGiver?: number
    kuangbiCount?: number
    /** 醇醪（程普）：是否已放置“醇” */
    chunlaoPlaced?: boolean
    /** 矫诏（郭皇后）：展示的牌与声明的牌名 */
    jiaozhaoCardId?: string
    jiaozhaoAs?: string
    /** 殚心（郭皇后）：矫诏强化次数 */
    jiaozhaoUpgrade?: number
    /** 急攻（郭图逢纪）：本回合手牌上限等于本阶段造成的伤害 */
    jigongActive?: boolean
    /** 极奢（岑昏）：本阶段已发动次数 */
    jisheCount?: number
    /** 邀名（界全琮）：最近一次发动所在回合序号 */
    yaomingTurn?: number
    /** 赈赡（界全琮）：最近一次发动所在回合序号 */
    zhenshanUseTurn?: number
    /** 邀名授予的“其回合内赈赡无次数限制”标记（记录该角色座位） */
    zhenshanFreeSeat?: number
    /** 燕语（夏侯氏）：本阶段重铸【杀】数 */
    yanyuRecast?: number
    /** 竊听（蔡夫人）：本回合对其他角色使用过的牌数 */
    cardsUsedOnOthersThisTurn?: number
    /** 智愚（界荀攸）：本回合【奇策】额外发动次数上限 */
    qiceBonusThisTurn?: number
    /** 绝策（界李儒）：最近一次失去牌的回合序号 */
    lostCardTurn?: number
    /** 潜袭（界马岱）：展示的牌与本回合序号 */
    qianxiCardId?: string
    qianxiTurn?: number
    /** 舍宴（董允）：本回合被舍宴取消的锦囊 */
    sheyanTrick?: { name: string; turn: number }
    /** 伪溃（SP曹仁）：本回合视为距离1的目标座位 */
    weikuiTargetSeat?: number
    weikuiTurn?: number

    // ── 洛书版第三批（界将升级）状态位（均可选） ──
    /** 矫诏（界郭皇后）：修改一发动时的大回合号（每轮限一次） */
    jiaozhaoMod1Round?: number
    /** 矫诏（界郭皇后）：修改二发动时的大回合号（每轮限一次） */
    jiaozhaoMod2Round?: number
    /** 咆哮（界张飞）：本回合下一次【杀】造成伤害+1 */
    paoxiaoBonus?: boolean
    /** 醇醪（界程普）：本轮以此法使用【酒】的次数与所属大回合号 */
    chunlaoWineRound?: number
    chunlaoWineCount?: number
    /** 秘计（界王异）：本回合结束阶段额外发动一次【秘计】 */
    mijiExtraThisTurn?: boolean

    // ── 洛书版第四批（新增武将）状态位（均可选） ──
    /** 精策（界郭淮）：本回合使用过的牌的类别 */
    jinceCategories?: string[]
    /** 精策（界郭淮）：本回合已使用过牌的花色 */
    jinceSuits?: CardSuit[]
    /** 奋励（朱桓）：本回合跳过的阶段数（平寇用） */
    fenliSkips?: number
    /** 雄乱（张绣）：本回合使用牌无距离与次数限制的目标下标 */
    xiongluanTarget?: number
    /** 雄乱（张绣）：上述限制生效的回合序号 */
    xiongluanTurn?: number
    /** 雄乱（张绣）：本回合不能使用或打出手牌的回合序号 */
    handForbiddenTurn?: number
    /** 雄乱（张绣）：判定区已废除 */
    abolishedJudgeZone?: boolean
    /** 父荫（诸葛瞻）：已触发过【父荫】的回合序号 */
    fuyinTurn?: number
    /** 珠（李肃）标记数 */
    pearlMarks?: number
    /** 誉虚（许靖）：本阶段下一次用牌结算后不能发动誉虚且须弃置一张牌 */
    yuxuPenalty?: boolean
    /** 誉虚（许靖）：本回合因【实荐】获得【誉虚】的回合序号 */
    yuxuGrantedTurn?: number
    /** 罪论（诸葛瞻）：本回合是否弃置过牌 */
    discardedCardThisTurn?: boolean
    /** 烈弓（界黄忠）：本回合【杀】对其伤害+1的目标下标 */
    liegongBonusTarget?: number

    // ── 洛书版第五批（新增武将）状态位（均可选） ──
    /** 排异（界钟会）：本阶段已发动次数 */
    paiyiUsesPhase?: number
    /** 排异（界钟会）：本阶段发动次数上限（默认 1，执行“另一项”后改为 2） */
    paiyiLimitPhase?: number
    /** 将驰（界曹彰）：本回合【杀】的次数上限增减 */
    slashLimitDelta?: number
    /** 将驰（界曹彰）：本回合【杀】不计入手牌上限 */
    slashNotInHandLimit?: boolean
    /** 强识（界张松）：本阶段展示的牌类别（使用该类别的牌后可摸一张） */
    qiangshiCategory?: string
    /** 献图（界张松）：以此法交给牌的角色下标 */
    xiantuTargetIndex?: number
    /** 献图（界张松）：以此法交给的牌数 */
    xiantuCount?: number
    /** 献图（界张松）：发动时的回合序号（阶段结束时结算失血） */
    xiantuTurn?: number
    /** 献图（界张松）：发动时目标已造成的伤害基线 */
    xiantuDamageBaseline?: number
    /** 惴恐（界伏皇后）：使用牌只能指定自己为目标的回合序号 */
    useOnlySelfTurn?: number
    /** 胆守（界朱然）：本阶段已执行过的项（1~4） */
    danshouItems?: number[]
    /** 称象（界曹冲）：下一次发动此技能时亮出的牌数加成 */
    chengxiangBonus?: number
    /** 明鉴（曹叡）：下个回合手牌上限与【杀】次数上限+1 */
    mingjianBonus?: boolean
    /** 巨贾（糜竺）：游戏开始时多摸的牌是否已发放 */
    jujiaDrawn?: boolean

    // ── 洛书版第七批状态位（均可选） ──
    /** 镇胆（闪赵云）：本轮已使用过的基本牌牌名 */
    basicUsedThisRound?: string[]
    /** 镇胆（闪赵云）：basicUsedThisRound 所属大回合号 */
    basicUsedRound?: number
    /** 镇胆（闪赵云）：本轮已因受伤/轮末失效的大回合号 */
    zhendanDisabledRound?: number
    /** 龙临（闪赵云）：本阶段已发动的回合序号（用于“出牌阶段内第一次使用杀”） */
    longlinUsedSerial?: number
    /** 龙临（闪赵云）：本阶段使用的下一张牌只能指定自己 */
    onlySelfTargetPhase?: boolean
    /** 酒池（界董卓）：本回合“崩坏”失效的回合序号 */
    banghuaiDisabledTurn?: number
    /** 纵玄（界虞翻）：上家弃置已触发过的回合序号 */
    zongxuanUpstreamTurn?: number
    /** 宽释（阚泽）：施加者座位下标 */
    kuanshiSourceIndex?: number
    /** 宽释（阚泽）：跳过下个摸牌阶段 */
    skipDrawNextTurn?: boolean
    /** 勇略（韩浩史涣）：等待确认“未造成伤害”的目标下标 */
    yonglueWatchIndex?: number
    /** 慷忾（曹昂）：本次【杀】的用牌者与目标 */
    kangkaiSlashTurn?: number
    /** 谏征（秦宓）：本回合已发动过的回合序号 */
    jianzhengTurn?: number
    /** 下书（阚泽）：展示的牌 id 与领取方向 */
    xiashuShownIds?: string[]
    /** 下书（阚泽）：本回合已发动过的回合序号 */
    xiashuTurn?: number
    /** 镇胆（闪赵云）：待转化使用的手牌 id */
    zhendanCardId?: string
    /** 龙魂（神赵云）：两张红色牌转化的伤害/回复 +1（结算一次） */
    longhunBonus?: boolean
    /** 绝境（神赵云）：濒死状态标记 */
    juejingDying?: boolean
    /** 勇略（韩浩史涣）：视为使用的【杀】所属回合序号 */
    yonglueTurn?: number
    /** 励战（曹仁）：结束阶段发动过的回合序号 */
    lizhanTurn?: number

    // ── 洛书版第九批（新增武将）状态位（均可选） ──
    /** 笔伐（陈琳）：置于该角色武将牌上的“笔伐”牌 */
    bifaCards?: Card[]
    /** 笔伐（陈琳）：放置者座位下标 */
    bifaSourceIndex?: number
    /** 颂词（陈琳）：已对其发动过颂词的座位 */
    songciUsedSeats?: number[]
    /** 鸩毒（何太后）：本次【酒】来自鸩毒 */
    zhenduWine?: boolean
    /** 止息：本阶段不能再使用牌 */
    zhixiPhase?: boolean
    /** 魅步（孙鲁育）：本阶段计算与此座位距离视为1 */
    meibuSeat?: number
    /** 魅步（孙鲁育）：本阶段被授予【止息】 */
    meibuZhixi?: boolean
    /** 穆穆（孙鲁育）：本阶段不能使用【杀】 */
    mumuNoSlashPhase?: boolean
    /** 缮甲（曹纯）：本阶段使用【杀】次数上限+1 */
    shanjiaFreeSlashPhase?: boolean
    /** 缮甲（曹纯）：本阶段使用牌无距离限制 */
    shanjiaNoRangePhase?: boolean
    /** 缮甲（曹纯）：已失去的装备牌数（使用装备牌除外） */
    shanjiaLostEquip?: number
    /** 本回合使用或打出的牌数（蒺藜） */
    cardsUsedTurnCount?: number
    /** 本阶段使用或打出的牌数（止息） */
    cardsUsedPhaseCount?: number
    /** 蒺藜（沙摩柯）：本回合已触发过的回合序号 */
    jiliTurn?: number
    /** 行图（裴秀）：上一张使用牌的点数 */
    xingtuLastPoint?: number
    /** 行图（裴秀）：本张牌无次数限制 */
    xingtuFreeCardId?: string
    /** 戮连（孙綝）：已触发过的回合序号 */
    lulianTurn?: number
    /** 观微（潘濬）：本阶段使用过的牌的花色 */
    guanweiSuits?: CardSuit[]
    /** 观微（潘濬）：本回合已发动过的回合序号 */
    guanweiTurn?: number
    /** 默识（SP蔡文姬）：本回合出牌阶段使用的第一/第二张基本牌或普通锦囊 */
    moshiCards?: { name: string; category: string }[]
    /** 默识（SP蔡文姬）：本阶段已用其转化的手牌数（0~2） */
    moshiUseIndex?: number
    /** 陈情（SP蔡文姬）：本轮已发动的大回合号 */
    chenqingRound?: number
    /** 定州（神鲁肃）：累计发动次数 */
    dingzhouUses?: number
    /** 定州（神鲁肃）：本回合已发动过的回合序号 */
    dingzhouTurn?: number
    /** 逆固（孙綝）：本回合后续伤害+1的次数 */
    niguBonus?: number
    /** 屯储（李丰）：武将牌上的“粮” */
    liangCards?: Card[]
    /** 设伏（程昱）：扣置于武将牌上的“伏兵” */
    fubing?: { card: Card; name: string }[]
    /** 先辅（戏志才）：选定角色下标 */
    xianfuIndex?: number
    /** 焚心（灵雎）：已获得过阵亡角色技能 */
    fenxinGained?: boolean
    /** 观微（潘濬）：额外的出牌阶段 */
    extraActionPhase?: boolean
    /** 天妒（戏志才）：判定牌来源标记 */
    tianbianJudge?: boolean
}

export interface Player {
    id: string
    nickname: string
    faction?: Faction
    connected: boolean
}

// ─────────────────────────────────────────────────────────────
// 选将
// ─────────────────────────────────────────────────────────────

/** 1-2-2-2-2-2-2-2-1 选将顺序（16步） */
export const PICK_SEQUENCE: Faction[] = [
    Faction.WARM,
    Faction.COOL, Faction.COOL,
    Faction.WARM, Faction.WARM,
    Faction.COOL, Faction.COOL,
    Faction.WARM, Faction.WARM,
    Faction.COOL, Faction.COOL,
    Faction.WARM, Faction.WARM,
    Faction.COOL, Faction.COOL,
    Faction.WARM,
]

export interface GeneralPickState {
    pool: GeneralDefinition[]
    pickStep: number
    warmPicked: GeneralDefinition[]
    coolPicked: GeneralDefinition[]
    /** 暖色方是否正在选择先选/让先（选将前） */
    waitingForPickYield?: boolean
    /** 暖色方让先：冷色方先选将（选将顺序反转） */
    yieldedPick?: boolean
}

export interface DeployState {
    warmDeployed: boolean
    coolDeployed: boolean
}

/** 斗地主选将态：三池互不重复，地主 6 选 1、农民各 5 选 1，同时进行 */
export interface LandlordPickState {
    /** [地主池, 农民一池, 农民二池] */
    pools: GeneralDefinition[][]
    /** 各池已选武将 id，null 表示还没选 */
    picked: (string | null)[]
}

/** 欢乐成双选将态：四个座位各一个池，同时进行 */
export interface PairPickState {
    /** [1号位池, 2号位池, 3号位池, 4号位池] */
    pools: GeneralDefinition[][]
    /** 各池已选武将 id，null 表示还没选 */
    picked: (string | null)[]
}

// ─────────────────────────────────────────────────────────────
// 大回合状态
// ─────────────────────────────────────────────────────────────

export interface RoundState {
    /** 当前大回合编号（从 1 开始） */
    roundNumber: number
    /** 先手方（冷色方决定，暖主保护轮时暖色方自动先手） */
    firstMover: Faction
    /** 是否让先（冷色方选择让先→暖色方永久先手） */
    yieldedFirst?: boolean
    /** 是否正在等待冷色方选择先手/让先（仅第1大回合前） */
    waitingForYield?: boolean
    /** 先手方选择的行动单元（commander / flanks），undefined 表示尚未选择 */
    firstMoverChoice?: ActionUnitType
    /** 后手方选择的行动单元 */
    secondMoverChoice?: ActionUnitType
    /** 先手方选边锋时的顺序（[先动边锋index, 后动边锋index]） */
    firstMoverFlankOrder?: number[]
    /** 后手方选边锋时的顺序 */
    secondMoverFlankOrder?: number[]
    /** 当前执行到第几个行动单元（0~3） */
    currentActionStep: number
    /** 本轮已执行过的回合数（镇胆 X 值） */
    turnsThisRound?: number
}

// ─────────────────────────────────────────────────────────────
// 游戏核心状态
// ─────────────────────────────────────────────────────────────

export interface GameState {
    roomId: string
    phase: GamePhase
    /** 对局模式，缺省为统率三军 */
    mode?: GameMode
    /** 斗地主选将态 */
    landlordPick?: LandlordPickState
    /** 斗地主：本地玩家执哪一方 */
    landlordHumanSide?: 'landlord' | 'farmers'
    /** 欢乐成双选将态 */
    pairPick?: PairPickState
    /** 欢乐成双：本地玩家执哪个阵营（两个座位同属该阵营） */
    pairHumanSide?: Faction

    players: Record<string, Player>
    warmPlayerId: string
    coolPlayerId: string

    pickState?: GeneralPickState
    deployState?: DeployState

    generals: GeneralInstance[]

    deck: Card[]
    discard: Card[]

    // 回合状态
    turnPhase: TurnPhase
    activePlayerFaction: Faction
    currentActionUnit?: ActionUnitType
    activeGeneralIndex: number

    /** 大回合状态 */
    roundState: RoundState

    attackUsedThisTurn: number
    /** 待响应队列（队首为当前需响应的事件） */
    pendingResponseQueue: PendingResponse[]

    /** 五谷丰登可选牌池 */
    harvestPool?: Card[]

    /** 无懈可击独立窗口 */
    negateWindow?: NegateWindow

    /** 本出牌阶段内已造成的伤害总量（佐定判定用） */
    damageThisActionPhase?: number

    /** 拼点进行中 */
    pindian?: {
        initiatorIndex: number
        opponentIndex: number
        skillId: string
        skillName: string
        stage: 'initiator' | 'opponent'
        firstCard?: Card
        extra?: Record<string, unknown>
    }
    /**
     * 乱武（贾诩）：待询问的后续角色。
     * 上一名角色的【杀】结算（出闪 / 造成伤害 / 濒死）全部完成后，
     * 再从这里创建下一次询问，避免下一名角色的提示插在本次结算中间。
     */
    pendingLuanwu?: {
        luanwuUserIndex: number
        remainingIndices: number[]
    }
    /** 放权：本回合结束后由该下标角色执行额外回合 */
    fangquanFor?: number
    /** 回合序号（每回合开始自增，用于“每回合限一次”判定） */
    turnSerial?: number
    /** 本回合各角色击杀数（按下标）与死亡总数（戚乱） */
    turnKillCounts?: number[]
    turnDeathCount?: number

    log: LogEntry[]
}

/** 无懈可击窗口（服务端完整版） */
export interface NegateWindow {
    trickCardName: string
    trickUserIndex: number
    trickTargetIndex: number
    trickTargetName: string
    isCurrentlyNegated: boolean
    deferredEffect?: any
    hasFollowUpResponse: boolean
    passedPlayerIds: string[]
    startedAt: number
    anyoneHasNegate: boolean
    /** 伏骑（麹义）：与使用者距离为 1 的其他角色不能打出【无懈可击】响应此牌 */
    fuqiBlockedIndices?: number[]
    /** 延时锦囊判定上下文：无懈结算后继续/跳过判定 */
    delayedTrickJudgeContext?: {
        judgingGeneralIndex: number
        delayedTrickCardId: string
        toJudgeCardIds: string[]
        currentJudgeIndex: number
        skipAction: boolean
        skipDraw: boolean
    }
}

/** 无懈可击窗口（客户端脱敏版） */
export interface NegateWindowClientView {
    trickCardName: string
    trickTargetName: string
    isCurrentlyNegated: boolean
    anyoneHasNegate: boolean
    startedAt: number
}

// ─────────────────────────────────────────────────────────────
// 客户端视图
// ─────────────────────────────────────────────────────────────

export interface GeneralClientView {
    generalId: string
    faction: Faction
    seatRole: SeatRole
    hp: number
    maxHp: number
    handCount: number
    hand?: Card[]
    equip: EquipZone
    judgeZone: Card[]
    alive: boolean
    hasActed: boolean
    awakened: boolean
    loyaltyCard?: Card
    skillsUsedThisTurn?: string[]
    usedLimitedSkills?: string[]
    /** 述志（界曹操）：被修改为限定技的技能 ID（UI 展示用） */
    shuzhiLimited?: string
    /** 本回合【杀】可指定的目标数加成（UI 选择目标用） */
    extraSlashTargets?: number
    chained: boolean
    wineDrunk: boolean
    /** 酒的加成已绑定到的那张【杀】的本回合序号（UI 标记用） */
    wineBonusAttackNo?: number
    /** 置于武将牌上的牌（UI 展示用） */
    generalPile?: Card[]
    /** 箜声（周妃）：武将牌上的牌尚未在结束阶段结算（UI 标记用） */
    kongshengActive?: boolean
    /** 屯储（李丰）：武将牌上的“粮”数量（UI 标记用） */
    liangCards?: number
    /** 已废除的装备栏（UI 展示用） */
    abolishedSlots?: EquipSlot[]
    /** 智迟（陈宫）：当前回合【杀】与普通锦囊牌对其无效（UI 标记用） */
    zhichiImmune?: boolean
    /** 拒战（严颜）：true/undefined=阳，false=阴（UI 标记用） */
    juzhanYang?: boolean
    /** 觉醒/转化获得的技能 id（UI 技能列表用） */
    acquiredSkills?: string[]
    /** 怀橘（陆绩）：“橘”标记数（UI 展示用） */
    orangeMarks?: number
    /** 袭爵（张虎乐綝）：“爵”标记数（UI 展示用） */
    jueMarks?: number
    /** 翻面状态（UI 展示用） */
    flipped?: boolean
    /** 武烈：“烈”标记数（UI 展示用） */
    lieMarks?: number
    /** 成略（许攸）：true = 阳 */
    chenglueYang?: boolean
    /** 矫诏（郭皇后）：展示的牌与声明的牌名（UI 展示用） */
    jiaozhaoCardId?: string
    jiaozhaoAs?: string
    /** 矫诏（界郭皇后）：修改等级（UI 按钮解锁用） */
    jiaozhaoUpgrade?: number
    /** 矫诏（界司马懿）：修改一/修改二已发动的大回合号（UI 按钮禁用用） */
    jiaozhaoMod1Round?: number
    jiaozhaoMod2Round?: number
    /** 醇醪（界程普）：本轮以此法使用【酒】需移去的“醇”数量（UI 展示用） */
    chunlaoCost?: number
    /** 珠（李肃）标记数（UI 展示用） */
    pearlMarks?: number
    /** 雄乱（张绣）：判定区已废除（UI 展示用） */
    abolishedJudgeZone?: boolean
    /** 排异（界钟会）：本阶段已发动次数（UI 按钮禁用用） */
    paiyiUsesPhase?: number
    /** 排异（界钟会）：本阶段发动次数上限（UI 按钮禁用用） */
    paiyiLimitPhase?: number
    /** 称象（界曹冲）：下次亮出的牌数加成（UI 展示用） */
    chengxiangBonus?: number
    /** 镇胆（闪赵云）：本轮已使用过的基本牌（UI 展示用） */
    basicUsedThisRound?: string[]
    /** 镇胆（闪赵云）：本轮失效的大回合号（UI 展示用） */
    zhendanDisabledRound?: number
    /** 宽释（阚泽）：施加者座位（UI 展示用） */
    kuanshiSourceIndex?: number
}

export interface GameStateClientView {
    roomId: string
    phase: GamePhase
    mode?: GameMode
    landlordPick?: LandlordPickState
    landlordHumanSide?: 'landlord' | 'farmers'
    pairPick?: PairPickState
    pairHumanSide?: Faction
    myPlayerId: string
    myFaction: Faction
    pickState?: GeneralPickState
    deployState?: DeployState
    generals: GeneralClientView[]
    deckCount: number
    discardTop?: Card
    discard?: Card[]
    turnPhase: TurnPhase
    activePlayerFaction: Faction
    currentActionUnit?: ActionUnitType
    activeGeneralIndex: number
    attackUsedThisTurn: number
    pendingResponse?: PendingResponse
    negateWindow?: NegateWindowClientView
    roundState: RoundState
    harvestPool?: Card[]
    log: LogEntry[]
    isSpectator?: boolean
}

// ─────────────────────────────────────────────────────────────
// 响应
// ─────────────────────────────────────────────────────────────

export enum ResponseType {
    DODGE = 'dodge',
    NEGATE = 'negate',
    ATTACK_DUEL = 'attack_duel',
    PEACH_SAVE = 'peach_save',
    HARVEST_CHOICE = 'harvest_choice',
    BARBARIANS_RESPONSE = 'barbarians_response',
    ARROWS_RESPONSE = 'arrows_response',
    // ── 技能交互 ──
    SKILL_YIJI_DISTRIBUTE = 'skill_yiji_distribute',       // 遗计：选择分配2张牌给谁
    SKILL_GANGLIE_CHOICE = 'skill_ganglie_choice',         // 刚烈：来源选弃2牌或受1伤
    SKILL_FANJIAN_SUIT = 'skill_fanjian_suit',             // 反间(周瑜)：目标选花色
    SKILL_FANKUI_PICK = 'skill_fankui_pick',               // 反馈(司马懿)：选来源一张牌
    SKILL_TIAOXIN_RESPONSE = 'skill_tiaoxin_response',     // 挑衅：目标出杀或放弃
    SKILL_TIANXIANG_CHOOSE = 'skill_tianxiang_choose',      // 天香(小乔)：选转移目标
    SKILL_TIANXIANG_LUOSHU_OPTION = 'skill_tianxiang_luoshu_option', // 天香(洛书版)：选择后续效果
    SKILL_KUANGGU_CHOICE = 'skill_kuanggu_choice',          // 狂骨(魏延)：回血或摸牌
    SKILL_QIMOU_HP = 'skill_qimou_hp',                      // 奇谋(魏延)：选择失去的体力数
    SKILL_GUANXING_ARRANGE = 'skill_guanxing_arrange',     // 观星：排列牌堆顶/底
    SKILL_LUOSHEN_CONTINUE = 'skill_luoshen_continue',     // 洛神：是否继续判定
    SKILL_TUXI_CHOOSE = 'skill_tuxi_choose',               // 突袭(张辽)：选偷谁的牌
    SKILL_SHENSU_TARGET = 'skill_shensu_target',           // 神速：选杀的目标
    SKILL_SHENSU_EQUIP = 'skill_shensu_equip',             // 神速二：选弃哪件装备
    SKILL_LUANWU_RESPONSE = 'skill_luanwu_response',       // 乱武：出杀或失血
    SKILL_LUANWU_PICK_TARGET = 'skill_luanwu_pick_target', // 乱武：选择出杀目标（多个最近）
    SKILL_LUANWU_EXTRA_SLASH = 'skill_luanwu_extra_slash', // 乱武②(界贾诩)：结算结束后视为使用一张无距离限制的【杀】
    SKILL_RENDE_GIVE = 'skill_rende_give',                 // 仁德(刘备)：给牌
    SKILL_YINGHUN_CHOOSE = 'skill_yinghun_choose',         // 英魂(孙坚)：选目标+模式
    SKILL_YINGHUN_DISCARD = 'skill_yinghun_discard',       // 英魂(孙坚)：目标弃牌
    SKILL_LIULI_REDIRECT = 'skill_liuli_redirect',         // 流离(大乔)：重定向杀
    SKILL_YINGHUN_OPTION = 'skill_yinghun_option',         // 英魂(孙坚)：选模式
    SKILL_ZHIJI_CHOICE = 'skill_zhiji_choice',             // 志继(姜维)：回血或摸牌
    HARVEST_PICK = 'harvest_pick',                         // 五谷丰登：选择一张牌
    AOE_DODGE = 'aoe_dodge',                               // 万箭齐发：出闪或受伤
    AOE_ATTACK = 'aoe_attack',                             // 南蛮入侵：出杀或受伤
    PEACH_GARDEN_HEAL = 'peach_garden_heal',               // 桃园结义：回复体力（逐目标无懈）
    EQUIP_DOUBLE_SWORDS_CHOICE = 'equip_double_swords_choice', // 雌雄双股剑：目标选弃牌或让对方摸牌
    EQUIP_KYLIN_BOW_CHOICE = 'equip_kylin_bow_choice',     // 麒麟弓：选择弃哪匹马
    SKILL_EIGHT_TRIGRAMS = 'skill_eight_trigrams',          // 八卦阵：翻牌判定
    NEGATE_CHANCE = 'negate_chance',                       // 无懈可击：询问是否打出
    TRICK_TARGET_CARD_PICK = 'trick_target_card_pick',     // 过河拆桥/顺手牵羊：选目标的牌
    EQUIP_ICE_SWORD_PICK = 'equip_ice_sword_pick',         // 寒冰剑：选弃目标的牌
    BORROW_SWORD_RESPONSE = 'borrow_sword_response',       // 借刀杀人：出杀或交武器
    FIRE_ATTACK_SHOW = 'fire_attack_show',                 // 火攻：展示手牌/弃同花色牌
    // ── 濒死询问 ──
    PEACH_SAVE_ASK = 'peach_save_ask',                     // 逐人询问是否出桃/救主/急救
    // ── 判定介入 ──
    JUDGE_INTERVENE = 'judge_intervene',                   // 鬼才/缓释/鬼道：打出牌替换判定牌
    // ── 雷击（张角）──
    SKILL_LEIJI_TARGET = 'skill_leiji_target',             // 雷击：选择令哪名角色判定（可放弃）
    // ── 技能确认 ──
    SKILL_ACTIVATE_CONFIRM = 'skill_activate_confirm',     // 通用：确认是否发动某技能
    IRON_CHAIN_RECAST = 'iron_chain_recast',               // 铁索连环：重铸换牌确认
    // ── 自用平衡版新武将 ──
    SKILL_QICE_PICK = 'skill_qice_pick',                   // 奇策(荀攸)：选择当作哪张普通锦囊
    SKILL_FANJIAN_CHOICE = 'skill_fanjian_choice',          // 反间(界周瑜)：弃同花色或失去1点体力
    SKILL_QIANXI_PICK = 'skill_qianxi_pick',                // 潜袭(马岱)：弃一张牌并选距离1的目标
    SKILL_GANGLIE_TARGET = 'skill_ganglie_target',          // 刚烈(夏侯惇-竞)：选择令哪名敌方角色判定
    SKILL_DIANHU_TARGET = 'skill_dianhu_target',            // 点虎(黄权)：选择一名其他角色
    SKILL_ZHONGYONG_GIVE = 'skill_zhongyong_give',          // 忠勇(周仓)：将杀/闪交给另一名角色
    SKILL_ZHONGYONG_SLASH = 'skill_zhongyong_slash',        // 忠勇：受牌者视为使用一张【杀】
    SKILL_SHUOMENG_TARGET = 'skill_shuomeng_target',        // 说盟(孙乾)：选择拼点对象
    SKILL_SHUOMENG_CARD = 'skill_shuomeng_card',            // 说盟(孙乾)：选择拼点用的手牌
    SKILL_MIJI_GIVE = 'skill_miji_give',                    // 秘计(王异)：选交牌对象与手牌
    SKILL_QIZHI_TARGET = 'skill_qizhi_target',              // 奇制(王基)：选择弃牌目标
    SKILL_DUFENG_CHOICE = 'skill_dufeng_choice',            // 独锋(凌操)：失去体力或废除装备栏
    SKILL_JINQU_DISCARD = 'skill_jinqu_discard',            // 进趋(王基)：选择弃置到X张
    SKILL_CHOOSE_TARGET = 'skill_choose_target',            // 通用：技能选择目标（谦雅/旋风/弘援等）
    SKILL_GIVE_CARDS = 'skill_give_cards',                  // 通用：选择交给指定角色的手牌
    SKILL_PICK_CARD = 'skill_pick_card',                    // 通用：选择自己的一张牌（弃置/置于武将牌上）
    // ── 斗地主 ──
    LANDLORD_REWARD = 'landlord_reward',                    // 农民阵亡奖励：存活农民二选一（摸2张 / 回复1点体力）
}

export interface PendingResponse {
    type: ResponseType
    /** 需要响应的武将下标（或列表中当前响应者） */
    targetGeneralIndex: number
    /** 上下文 */
    context?: Record<string, unknown>
    /** 可使用的卡牌过滤 */
    validCardIds?: string[]
}

// ─────────────────────────────────────────────────────────────
// 日志
// ─────────────────────────────────────────────────────────────

export interface LogEntry {
    timestamp: number
    text: string
}

// ─────────────────────────────────────────────────────────────
// Socket.io 事件协议
// ─────────────────────────────────────────────────────────────

/* ---- C2S ---- */

export interface C2S_CreateRoom { nickname: string }
export interface C2S_JoinRoom { roomCode: string; nickname: string }
export interface C2S_PickGeneral { generalId: string }
export interface C2S_DeployGenerals { commander: string; flankA: string; flankB: string }

/** 选择行动单元（主帅 or 边锋） */
export interface C2S_ChooseActionUnit {
    unit: ActionUnitType
    /** 选边锋时指定行动顺序：[先动边锋 generalIndex, 后动边锋 generalIndex] */
    flankOrder?: number[]
}

export interface C2S_UseCard {
    cardId: string
    targetIndices: number[]
    /** 额外参数：AOE 方向 ('clockwise' | 'counterclockwise') 等 */
    extra?: Record<string, unknown>
    /** 技能转换声明：如 'ganning_qixi' 表示此黑色牌当过河拆桥使用 */
    asSkill?: string
}

export interface C2S_UseSkill {
    skillId: string
    targetIndices?: number[]
    cardIds?: string[]
}

export interface C2S_Respond {
    cardId?: string
    /** 一次提交多张牌（技能发动时提前选好的手牌等） */
    cardIds?: string[]
    /** 用哪个武将的牌响应（无懈可击方案B需要） */
    generalIndex?: number
    /** 技能发动时提前选好的单个目标 */
    targetIndex?: number
    /** 技能发动时提前选好的多个目标 */
    targetIndices?: number[]
    /** 具体动作（如 'peach' / 'jiuzhu' / 'jijiu'） */
    action?: string
}

export interface C2S_Discard { cardIds: string[] }
export interface C2S_YieldChoice {
    yield: boolean
    /** pick = 暖色方选将阶段的先选/让先；缺省为冷色方的先手/让先 */
    phase?: 'pick' | 'action'
}
export interface C2S_NegateRespond {
    /** 无懈可击牌 ID（undefined = 放弃） */
    cardId?: string
    /** 出牌武将 index */
    generalIndex: number
}

/* ---- S2C ---- */

export interface S2C_RoomCreated { roomCode: string; playerId: string }
export interface S2C_RoomJoined { playerId: string }
export interface S2C_RoomUpdate { roomCode: string; players: Player[]; phase: GamePhase }
export interface S2C_GameStateUpdate { state: GameStateClientView }
export interface S2C_Error { message: string }
export interface S2C_GameOver { winnerFaction: Faction; reason: string }

/* ---- 事件名 ---- */

export const SocketEvents = {
    CREATE_ROOM: 'create_room',
    JOIN_ROOM: 'join_room',
    REJOIN_ROOM: 'rejoin_room',
    PICK_GENERAL: 'pick_general',
    DEPLOY_GENERALS: 'deploy_generals',
    CHOOSE_ACTION_UNIT: 'choose_action_unit',
    USE_CARD: 'use_card',
    USE_SKILL: 'use_skill',
    RESPOND: 'respond',
    END_TURN: 'end_turn',
    DISCARD: 'discard',
    YIELD_CHOICE: 'yield_choice',
    NEGATE_RESPOND: 'negate_respond',
    SURRENDER: 'surrender',
    SWITCH_SPECTATE_FACTION: 'switch_spectate_faction',
    ROOM_CREATED: 'room_created',
    ROOM_JOINED: 'room_joined',
    SPECTATE_JOIN: 'spectate_join',
    REJOIN_OK: 'rejoin_ok',
    REJOIN_FAIL: 'rejoin_fail',
    ROOM_UPDATE: 'room_update',
    GAME_STATE_UPDATE: 'game_state_update',
    GAME_OVER: 'game_over',
    ERROR: 'error',
} as const
