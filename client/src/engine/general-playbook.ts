/**
 * 武将操作手册：按武将/技能登记的专属操作事实。
 *
 * 通用规则 AI 只读这里的结论，不再在各处重复写技能名判断；
 * 新增武将时在此登记一条即可被拆牌、弃牌、选目标等逻辑共用。
 * 这里的每条结论都必须与 game-actions.ts 的实际结算一致，否则 AI 会做出引擎拒绝的操作。
 *
 * 已登记：奇才（拆牌目标过滤）、杀伤害加成来源、青囊（主动治疗）。
 */
import { EquipSlot, EquipmentCardName, Faction, GameState, SeatRole } from 'sgs3v3-shared'
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
 * 取决于对手手里是否还有【酒】，由调用方按牌池另算。
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
