/**
 * 武将操作手册：按武将/技能登记的专属操作事实。
 *
 * 通用规则 AI 只读这里的结论，不再在各处重复写技能名判断；
 * 新增武将时在此登记一条即可被拆牌、弃牌、选目标等逻辑共用。
 * 这里的每条结论都必须与 game-actions.ts 的实际结算一致，否则 AI 会做出引擎拒绝的操作。
 *
 * 已登记：奇才（拆牌目标过滤）、杀伤害加成来源、青囊（主动治疗）、拆牌位选择、
 * 断粮（合法目标）、解烦（目标阵营）、崩坏与将驰（选项取舍）、胆守（牌差取舍）。
 */
import { BasicCardName, Card, EquipSlot, EquipmentCardName, Faction, GameState, SeatRole, TrickCardName } from 'sgs3v3-shared'
import { hasSkillOf } from './ai-synergy'

export type GeneralView = GameState['generals'][number]

/**
 * 奇才（黄月英/界黄月英）：其他角色弃置其装备区里的防具牌时，取消之。
 *
 * 判定只看技能 id：game-actions.ts 的 TRICK_TARGET_CARD_PICK 对拥有【奇才】的角色
 * 一律取消防具的弃置（removeCardFromHandOrEquip 那条路径另加了界黄月英限定，两处不一致）。
 * 手册按更宽的那条走，否则 AI 选防具会被引擎拒绝，整张拆/顺锦囊白费。
 */
function hasQicaiArmorShield(g: GeneralView): boolean {
    return hasSkillOf(g, 'huangyueying_qicai')
}

/**
 * 该武将装备区里的某个牌位能否被对手拆/顺/弃置。
 * 返回 false 表示技能会取消这次弃置，AI 不应把它作为目标。
 */
export function equipSlotIsStealable(g: GeneralView, slot: EquipSlot): boolean {
    if (slot === EquipSlot.ARMOR && hasQicaiArmorShield(g)) return false
    return true
}

/** 该武将装备区里所有可被对手拆/顺的牌位（按武器→防具→坐骑顺序） */
export function stealableEquipSlots(g: GeneralView): EquipSlot[] {
    return [EquipSlot.WEAPON, EquipSlot.ARMOR, EquipSlot.PLUS_HORSE, EquipSlot.MINUS_HORSE]
        .filter((slot) => !!g.equip[slot] && equipSlotIsStealable(g, slot))
}

/**
 * 拆/顺/寒冰剑该拿走哪个牌位：按牌的价值挑最高的那一张，而不是固定取第一个。
 * 目标有八卦阵时先拆防具，比固定先拆武器更划算。
 */
export function bestStealSlot(g: GeneralView, valueOf: (card: Card) => number): EquipSlot | undefined {
    let best: EquipSlot | undefined
    let bestValue = -Infinity
    for (const slot of stealableEquipSlots(g)) {
        const card = g.equip[slot]
        if (!card) continue
        const value = valueOf(card)
        if (value > bestValue) {
            bestValue = value
            best = slot
        }
    }
    return best
}

/** 【杀】伤害加成的公开来源 */
export interface SlashBonus {
    amount: number
    reasons: string[]
}

/**
 * 该角色打出【杀】时能吃到的伤害加成，只算公开可判断的来源。
 *
 * 必须与 game-actions.ts 的 calcKillDamage 对齐，否则 AI 会误判「这一刀痛不痛」，
 * 从而错判该不该留【闪】。
 *
 * 酒只绑定紧跟着的那一张【杀】。结算 current 时酒还没被 consumeWineBonus 清掉，
 * 所以酒要看 wineDrunk / wineBonusAttackNo；future 不含酒——之后还能不能吃到酒杀，
 * 取决于对手手里还有没有【酒】，由调用方按明牌另判。
 *
 * @param which current = 正在结算的这一刀；future = 之后还能打出的下一刀
 */
export function slashDamageBonus(
    state: GameState,
    attacker: GeneralView | undefined,
    target: GeneralView | undefined,
    which: 'current' | 'future',
): SlashBonus {
    let amount = 0
    const reasons: string[] = []
    // 伤害来源不可知（例如从日志推断出的结算）时按无加成处理
    if (!attacker) return { amount, reasons }
    const add = (label: string): void => {
        amount += 1
        reasons.push(label)
    }

    if (state.generals.some((g) => g.alive && g.faction === attacker.faction && g.loyaltyCard)) add('忠义')
    if (which === 'current') {
        const wine = attacker.wineDrunk === true || attacker.wineBonusAttackNo === state.attackUsedThisTurn
        if (wine) add('酒')
    }
    if (attacker.luoyiActive) add('裸衣')
    if (attacker.longhunBonus) add('龙魂')
    if (target) {
        if (attacker.equip.weapon?.name === EquipmentCardName.GUDING_BLADE && target.hand.length === 0) {
            add('古锦刀')
        }
        if (attacker.liegongBonusTarget === state.generals.indexOf(target)) add('烈弓')
    }
    if (attacker.paoxiaoBonus) add('咆哮')
    return { amount, reasons }
}

/**
 * 青囊（华佗）：出牌阶段限一次，弃一张手牌令一名已受伤角色回复 1 点体力。
 *
 * 引擎（handleUseSkillImpl 的 huatuo_qingnang）要求 cardIds 恰好 1 张、targets 恰好 1 名且未满血，
 * 弃的是手牌（不含装备区），限一次由 skillsUsedThisTurn 记录。
 * 通用出牌表此前没有为它生成候选，自对弈 400 局里华佗 1354 次出牌决策一次都没发动过青囊。
 */
export function canUseQingnang(general: GeneralView): boolean {
    return hasSkillOf(general, 'huatuo_qingnang')
        && !general.skillsUsedThisTurn.includes('huatuo_qingnang')
        && general.hand.length > 0
}

export interface QingnangPlan {
    targetIndex: number
    cardId: string
}

/**
 * 选出青囊的最优目标：优先己方，其中主帅权重最高（统率三军里主帅阵亡即负），
 * 其次看已损失体力。敌方满血外不救——替对手回血是净亏。
 */
export function pickQingnangPlan(
    general: GeneralView,
    selfIndex: number,
    generals: GameState['generals'],
    playerFaction: string | undefined,
): QingnangPlan | null {
    if (!canUseQingnang(general) || !playerFaction) return null
    const wounded = generals
        .map((g, index) => ({ g, index }))
        .filter(({ g }) => g.alive && g.hp < g.maxHp)
        .sort((a, b) => {
            const aAlly = a.g.faction === playerFaction
            const bAlly = b.g.faction === playerFaction
            if (aAlly !== bAlly) return aAlly ? -1 : 1
            const aCmd = a.g.seatRole === SeatRole.COMMANDER ? 1 : 0
            const bCmd = b.g.seatRole === SeatRole.COMMANDER ? 1 : 0
            if (aCmd !== bCmd) return bCmd - aCmd
            const aLost = a.g.maxHp - a.g.hp
            const bLost = b.g.maxHp - b.g.hp
            if (aLost !== bLost) return bLost - aLost
            return a.index === selfIndex ? -1 : b.index === selfIndex ? 1 : a.index - b.index
        })
    const best = wounded[0]
    if (!best) return null
    // 对手只有在濒死边缘（1 点体力）时才值得用青囊续住，避免误伤己方阵型
    if (best.g.faction !== playerFaction && best.g.hp > 1) return null
    const card = [...general.hand].sort((a, b) => a.value - b.value)[0]
    if (!card) return null
    return { targetIndex: best.index, cardId: card.id }
}

export interface RendeOpportunity {
    trigger: boolean
    wantHeal: boolean
}

/**
 * 仁德（刘备）：给两张牌换回血或牌差。
 * 受伤时优先回血；手牌明显溢出或队友手牌见底时也值得给牌。
 */
export function rendeOpportunity(
    active: GeneralView,
    allies: GeneralView[],
    healedThisTurn: boolean,
): RendeOpportunity {
    const wantHeal = active.hp < active.maxHp && !healedThisTurn
    const wantRelief = active.hand.length > active.hp + 1
    const allyShort = allies.some((g) => g.alive && g.hand.length <= 1)
    return { trigger: wantHeal || wantRelief || allyShort, wantHeal }
}

/**
 * 遗计（郭嘉）：摸到的两张牌交给需求最高的人。
 * 主帅优先，其次缺牌与已受伤；自己只有在确实最缺牌时才留牌。
 */
export function pickYijiReceiver(
    generals: GameState['generals'],
    selfIndex: number,
    faction: Faction | undefined,
): number {
    const receivers = generals
        .map((g, index) => ({ g, index }))
        .filter(({ g }) => g.alive && g.faction === faction)
    const need = ({ g, index }: { g: GeneralView; index: number }): number =>
        (g.seatRole === SeatRole.COMMANDER ? 30 : 0) +
        Math.max(0, 3 - g.hand.length) * 6 +
        (g.maxHp - g.hp) * 8 +
        (index === selfIndex ? -6 : 0)
    const best = [...receivers].sort((a, b) => need(b) - need(a))[0]
    return best ? best.index : -1
}

/**
 * 断粮（徐晃）：能否对目标合法使用。
 *
 * 引擎要求距离 1 以内；界徐晃在目标手牌数不少于自己时可无视距离；黄月英的奇才同样无距离。
 * 判定区已废除或已有兵粮寸断时会被引擎拒绝，AI 不应出价。
 */
export function duanliangTargetLegal(active: GeneralView, target: GeneralView, distance: number): boolean {
    if (!target.alive || target.abolishedJudgeZone) return false
    if (target.judgeZone.some((c) => c.name === TrickCardName.SUPPLY_SHORTAGE)) return false
    if (hasSkillOf(active, 'huangyueying_qicai')) return true
    if (active.generalId === 'xuhuang_jie' && target.hand.length >= active.hand.length) return true
    return distance <= 1
}

export interface JiefanPlan {
    targetIndex: number
    enemies: number
}

/**
 * 解烦（韩当）：限定技的目标必须是己方。
 *
 * 目标为敌人时，己方角色会弃武器或让敌人摸牌，等于白送；目标为队友时，
 * 敌人只能弃武器或让队友摸牌。至少两名敌人在其攻击范围内才值得用。
 */
export function pickJiefanTarget(
    generals: GameState['generals'],
    faction: string | undefined,
    enemiesInRange: (targetIndex: number) => number,
): JiefanPlan | null {
    if (!faction) return null
    const plans = generals
        .map((g, index) => ({ g, index }))
        .filter(({ g }) => g.alive && g.faction === faction)
        .map(({ g, index }) => ({ g, index, enemies: enemiesInRange(index) }))
        .filter(({ enemies }) => enemies >= 2)
        .sort((a, b) => b.enemies - a.enemies
            || (b.g.seatRole === SeatRole.COMMANDER ? 1 : 0) - (a.g.seatRole === SeatRole.COMMANDER ? 1 : 0)
            || a.g.hand.length - b.g.hand.length
            || a.index - b.index)
    const best = plans[0]
    return best ? { targetIndex: best.index, enemies: best.enemies } : null
}

/**
 * 崩坏（董卓）：失去 1 点体力或减 1 点体力上限。
 *
 * 减上限只在当前体力高于新上限时才连带扣当前体力；已受伤时减上限不疼，
 * 满血时减上限等于双重损失，此时应选择失去体力。
 */
export function pickBanghuaiChoice(hp: number, maxHp: number): 'loseHp' | 'reduceMaxHp' {
    return hp < maxHp ? 'reduceMaxHp' : 'loseHp'
}

/**
 * 胆守（界朱然）：四项各只能执行一次，执行后须弃置「本次序号」张牌
 * （game-actions.ts 的 dsCost = min(dsItem, 手牌 + 装备)）。
 *
 * 代价与收益必须按相对牌差算，否则会高估③的价值：
 *   ① 弃敌方一张（lowValueCard 取敌方最低价值牌） / 弃自己 1 张 → 牌差 0
 *   ② 获得敌方一张（gainRandomCardFrom 随机）      / 弃自己 2 张 → 牌差 0
 *   ③ 对敌方造成 1 点伤害                          / 弃自己 3 张 → 牌差 -3
 *   ④ 双方各摸两张                                 / 弃自己 4 张 → 牌差 -4
 *
 * 所以①②是零牌差的纯收益，任何时候都优于③；③只留给斩杀线
 * （统率三军主帅阵亡即负，一点伤害换三张牌在斩杀上是划算的）。
 *
 * 统计上量不出差异：A/B 3000 种子 × 4 座位共 12000 局，Δ=+0.03%、p=0.80，
 * 因为胆守只占全部决策 0.29%。本条结论来自引擎结算的牌差推导，不是统计结论。
 */
export function pickDanshouChoice(
    options: readonly { action: string }[],
    targetIsEnemy: boolean,
    targetHp: number,
    cardCount: number,
): string {
    const has = (action: string): boolean => options.some((o) => o.action === action)
    if (targetIsEnemy) {
        if (targetHp <= 1 && has('3')) return '3'
        if (has('2') && cardCount >= 2) return '2'
        if (has('1') && cardCount >= 1) return '1'
        if (has('3')) return '3'
        if (has('4')) return '4'
        return options[0]?.action ?? 'decline'
    }
    if (has('4') && cardCount >= 5) return '4'
    return 'decline'
}

/**
 * 禁酒（界高顺）：自己的【酒】一律视为点数为 K 的【杀】，且必须指定目标。
 *
 * 引擎在 handleBasicCard 的 WINE 分支里先判禁酒再判「已饮过酒」，所以持有禁酒时
 * 按【酒】喝掉必然报「请选择【杀】的目标」。自对弈 80 局里有 2 次整回合因此空过。
 */
export function jinjiuTurnsWineIntoSlash(general: GeneralView): boolean {
    return hasSkillOf(general, 'gaoshun_jinjiu')
}

/**
 * 矫诏（界郭皇后）：被声明的牌仍留在手里，但只能通过矫诏本身打出。
 *
 * 引擎在 handleUseCardImpl 里对 jiaozhaoCardId 命中的牌先做矫诏分支，
 * 且该分支拒绝以自己为目标。若 AI 的常规出牌表把这牌当装备/锦囊打，
 * 就会撞上「【矫诏】不能指定自己为目标」而整张作废（自对弈 80 局 13 次）。
 */
export function isJiaozhaoSealed(general: GeneralView, cardId: string): boolean {
    return !!general.jiaozhaoAs && general.jiaozhaoCardId === cardId
}

/**
 * 惴恐（界伏皇后）/ 龙临（闪赵云）：本回合或本阶段使用牌只能指定自己为目标。
 *
 * 引擎在 handleUseCardImpl 里对二者一视同仁（useOnlySelfTurn 按回合计、
 * onlySelfTargetPhase 按阶段计），任何指向他人的牌都会被整张拒绝。
 * AI 此前照常给杀、偷、拆、延时锦囊打分，被拒后该阶段直接空过。
 */
export function selfTargetOnly(state: GameState, general: GeneralView): boolean {
    if (general.onlySelfTargetPhase) return true
    return general.useOnlySelfTurn !== undefined && general.useOnlySelfTurn === state.turnSerial
}

/**
 * 将驰（界曹彰）：摸一张牌（杀次数 -1、杀不计手牌上限）或重铸一张牌
 * （杀无距离限制、次数 +1）。手里没有【杀】时重铸换来的距离用不上，摸牌更实在。
 */
export function pickJiangchiChoice(
    hand: Card[],
    hasRecast: boolean,
    hasDraw: boolean,
): 'recast' | 'draw' {
    const junk = hand.filter((c) => c.name !== BasicCardName.ATTACK
        && c.name !== BasicCardName.FIRE_SLASH && c.name !== BasicCardName.THUNDER_SLASH
        && c.name !== BasicCardName.DODGE && c.name !== BasicCardName.PEACH).length
    const hasSlash = hand.some((c) => c.name === BasicCardName.ATTACK
        || c.name === BasicCardName.FIRE_SLASH || c.name === BasicCardName.THUNDER_SLASH)
    if (hasRecast && junk > 0 && hand.length >= 2 && hasSlash) return 'recast'
    return hasDraw ? 'draw' : 'recast'
}
