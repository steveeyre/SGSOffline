import {
    Faction,
    SeatRole,
    GameMode,
    GeneralDefinition,
    GeneralInstance,
    EquipZone,
    GameState,
    GameStateClientView,
    GeneralClientView,
    TurnPhase,
    GamePhase,
    SkillDefinition,
    CardSuit,
    Card,
    BasicCardName,
    ResponseType,
    PendingResponse,
    FxEvent,
} from 'sgs3v3-shared'
import { getGeneralById, skillMatches } from './generals'
import { cardFullName } from './card-utils'
import { recordSkillLog } from './combat-stats'

/**
 * 从武将定义创建武将实例
 */
export function createGeneralInstance(
    def: GeneralDefinition,
    playerId: string,
    faction: Faction,
    seatRole: SeatRole
): GeneralInstance {
    return {
        generalId: def.id,
        playerId,
        faction,
        seatRole,
        hp: def.maxHp,
        maxHp: def.maxHp,
        hand: [],
        equip: {} as EquipZone,
        judgeZone: [],
        alive: true,
        usedLimitedSkills: [],
        hasActed: false,
        awakened: false,
        skillsUsedThisTurn: [],
        acquiredSkills: [],
        rendeGivenThisTurn: 0,
        rendeHealedThisTurn: false,
        rendeReceivedThisPhase: [],
        chained: false,
        wineDrunk: false,
        generalPile: [],
        abolishedSlots: [],
        flipped: false,
        armorPoints: 0,
    }
}

/** 技能发动询问时可以一并提交的目标/手牌（供界面提前收集输入） */
export interface ActivationInputsSpec {
    targetSelectOnActivate?: boolean
    minTargets?: number
    maxTargets?: number
    targetCandidates?: number[]
    cardSelectOnActivate?: boolean
    minCards?: number
    maxCards?: number
    candidateCardIds?: string[]
}

const hasCardsInArea = (g: GeneralInstance): boolean =>
    g.hand.length > 0 || Object.values(g.equip).some(Boolean)

/** 带砺（罗宪）/ 火攻等公开亮出的牌：始终对所有角色可见 */
function visibleHand(g: GeneralInstance, fullyVisible: boolean): Card[] | undefined {
    if (fullyVisible) return g.hand
    const revealed = g.revealedCardIds?.length ? g.revealedCardIds : g.dailiCardIds
    if ((revealed?.length ?? 0) === 0) return undefined
    return g.hand.filter(c => revealed!.includes(c.id))
}

/**
 * 技能在“是否发动”询问上可提前声明的输入。
 * 声明后界面会让玩家先点角色/手牌，点“发动”时一次性提交，引擎直接结算，不再二次询问。
 * 返回 null 表示该技能仍走“确认→再询问”的两段式。
 */
function activationInputsFor(state: GameState, pending: PendingResponse): ActivationInputsSpec | null {
    if (pending.type !== ResponseType.SKILL_ACTIVATE_CONFIRM) return null
    const ctx = pending.context as any
    if (!ctx?.skillId) return null
    // 选项型询问本身就是“选什么”，不叠加目标/选牌（献图例外：选项只决定交牌张数）
    if ((ctx.options as unknown[] | undefined)?.length && ctx.skillId !== 'zhangsong_xiantu') return null
    const selfIdx = pending.targetGeneralIndex
    const self = state.generals[selfIdx]
    if (!self?.alive) return null
    const others = state.generals
        .map((g, i) => ({ g, i }))
        .filter(({ g, i }) => g.alive && i !== selfIdx)
    const otherIndices = others.map(({ i }) => i)

    switch (ctx.skillId) {
        case 'zhangliao_tuxi': {
            const candidates = others.filter(({ g }) => g.hand.length > 0).map(({ i }) => i)
            if (candidates.length === 0) return null
            return { targetSelectOnActivate: true, minTargets: 1, maxTargets: 2, targetCandidates: candidates }
        }
        case 'sunjian_wulie': {
            if (otherIndices.length === 0) return null
            return {
                targetSelectOnActivate: true, minTargets: 1,
                maxTargets: Math.max(1, self.hp - 1), targetCandidates: otherIndices,
            }
        }
        case 'liufeng_xiansi': {
            const candidates = others.filter(({ g }) => hasCardsInArea(g)).map(({ i }) => i)
            if (candidates.length === 0) return null
            return { targetSelectOnActivate: true, minTargets: 1, maxTargets: 2, targetCandidates: candidates }
        }
        case 'lingtong_xuanfeng': {
            const candidates = ((ctx.xuanfengCandidates as number[] | undefined) ?? []).filter(i => state.generals[i]?.alive)
            if (candidates.length === 0) return null
            return { targetSelectOnActivate: true, minTargets: 1, maxTargets: 1, targetCandidates: candidates }
        }
        case 'fazheng_xuanhuo': {
            // 受牌者的选项询问带 options，已在上面排除；这里只剩法正本人发起
            if (otherIndices.length === 0) return null
            return { targetSelectOnActivate: true, minTargets: 1, maxTargets: 1, targetCandidates: otherIndices }
        }
        // ── 确认后立刻选一名角色（目标集合由询问上下文直接给出） ──
        case 'kanze_xiashu':
        case 'caorui_huituo': {
            if (otherIndices.length === 0) return null
            return { targetSelectOnActivate: true, minTargets: 1, maxTargets: 1, targetCandidates: otherIndices }
        }
        case 'zhangsong_qiangshi': {
            const candidates = others.filter(({ g }) => g.hand.length > 0).map(({ i }) => i)
            if (candidates.length === 0) return null
            return { targetSelectOnActivate: true, minTargets: 1, maxTargets: 1, targetCandidates: candidates }
        }
        case 'xiaoqiao_tianxiang': {
            const hasHeart = (c: Card) => c.suit === CardSuit.HEART
                || (c.suit === CardSuit.SPADE
                    && (getGeneralById(self.generalId)?.skills.some(s => s.id === 'xiaoqiao_hongyan') ?? false))
            const hearts = self.hand.filter(hasHeart).map(c => c.id)
            if (hearts.length === 0 || otherIndices.length === 0) return null
            return {
                targetSelectOnActivate: true, minTargets: 1, maxTargets: 1, targetCandidates: otherIndices,
                cardSelectOnActivate: true, minCards: 1, maxCards: 1, candidateCardIds: hearts,
            }
        }
        case 'zhangsong_xiantu': {
            if (self.hand.length === 0) return null
            return {
                cardSelectOnActivate: true, minCards: 1, maxCards: 2,
                candidateCardIds: self.hand.map(c => c.id),
            }
        }
        case 'zhangxiu_congjian':
        case 'sunqian_qianya':
        case 'xunyu_jieming': {
            const raw = (ctx.congjianCandidates ?? ctx.candidateIndices ?? ctx.jiemingCandidates) as number[] | undefined
            const candidates = (raw ?? []).filter(i => state.generals[i]?.alive)
            if (candidates.length === 0) return null
            return { targetSelectOnActivate: true, minTargets: 1, maxTargets: 1, targetCandidates: candidates }
        }
        case 'zhanghe_qiaobian': {
            if (self.hand.length === 0) return null
            return { cardSelectOnActivate: true, minCards: 1, maxCards: 1, candidateCardIds: self.hand.map(c => c.id) }
        }
        case 'litong_tuifeng': {
            if (self.hand.length === 0) return null
            return { cardSelectOnActivate: true, minCards: 1, maxCards: 1, candidateCardIds: self.hand.map(c => c.id) }
        }
        case 'doudizhu_feiyang': {
            if (self.hand.length < 2) return null
            return { cardSelectOnActivate: true, minCards: 2, maxCards: 2, candidateCardIds: self.hand.map(c => c.id) }
        }
        case 'zhoufei_kongsheng': {
            if (self.hand.length === 0) return null
            return {
                cardSelectOnActivate: true, minCards: 1, maxCards: self.hand.length,
                candidateCardIds: self.hand.map(c => c.id),
            }
        }
        default:
            return null
    }
}

/** 给待响应询问补上技能可提前选择的输入（复制一份，避免污染引擎状态） */
function describePendingResponse(state: GameState, pending?: PendingResponse): PendingResponse | undefined {
    if (!pending) return undefined
    const spec = activationInputsFor(state, pending)
    if (!spec) return pending
    return { ...pending, context: { ...pending.context, ...spec } }
}

/**
 * 将服务端完整 GameState 转换为特定玩家视图（脱敏）
 * - 己方武将可见手牌
 * - 对方武将只显示手牌数量
 */
export function toClientView(
    state: GameState,
    myPlayerId: string
): GameStateClientView {
    const myPlayer = state.players[myPlayerId]
    const myFaction = myPlayer?.faction ?? Faction.WARM

    const generals: GeneralClientView[] = state.generals.map((g) => {
        const isMine = g.playerId === myPlayerId
        return {
            generalId: g.generalId,
            faction: g.faction,
            seatRole: g.seatRole,
            hp: g.hp,
            maxHp: g.maxHp,
            handCount: g.hand.length,
            // 3v3 同阵营手牌可见，便于对队友精确指定顺手牵羊等；带砺牌、火攻亮出的牌公开
            hand: visibleHand(g, isMine || g.faction === myFaction),
            revealedCards: g.hand.filter(c => (g.revealedCardIds ?? []).includes(c.id)),
            equip: g.equip,
            judgeZone: g.judgeZone,
            alive: g.alive,
            hasActed: g.hasActed,
            awakened: g.awakened,
            loyaltyCard: g.loyaltyCard,
            skillsUsedThisTurn: g.skillsUsedThisTurn,
            usedLimitedSkills: g.usedLimitedSkills,
            shuzhiLimited: g.shuzhiLimited,
            extraSlashTargets: g.extraSlashTargets,
            chained: g.chained,
            wineDrunk: g.wineDrunk,
            wineBonusAttackNo: g.wineBonusAttackNo,
            generalPile: g.generalPile,
            // 箜声（周妃）：武将牌上的牌尚未结算
            kongshengActive: g.kongshengActive,
            // 屯储（李丰）：武将牌上的“粮”
            liangCards: g.liangCards?.length ?? 0,
            abolishedSlots: g.abolishedSlots,
            orangeMarks: g.orangeMarks,
            jueMarks: g.jueMarks,
            flipped: g.flipped,
            armorPoints: g.armorPoints ?? 0,
            lieMarks: g.lieMarks,
            juzhanYang: g.juzhanYang,
            acquiredSkills: g.acquiredSkills,
            // 智迟：免疫只在“受伤所在回合”内有效
            zhichiImmune: g.zhichiImmuneTurn !== undefined
                && g.zhichiImmuneTurn === state.activeGeneralIndex,
            // 矫诏（郭皇后）：展示牌/声明牌名/强化等级/每轮限一次的记录
            jiaozhaoCardId: g.jiaozhaoCardId,
            jiaozhaoAs: g.jiaozhaoAs,
            jiaozhaoUpgrade: g.jiaozhaoUpgrade,
            jiaozhaoMod1Round: g.jiaozhaoMod1Round,
            jiaozhaoMod2Round: g.jiaozhaoMod2Round,
            // 醇醪（界程普）：本轮以此法使用【酒】需移去的“醇”数
            chunlaoCost: g.chunlaoWineRound !== undefined
                && g.chunlaoWineRound === state.roundState?.roundNumber
                ? (g.chunlaoWineCount ?? 0) : 0,
            // 珠（李肃）：标记数
            pearlMarks: g.pearlMarks,
            // 雄乱（张绣）：判定区已废除
            abolishedJudgeZone: g.abolishedJudgeZone,
            // 排异（界钟会）/ 称象（界曹冲）：阶段状态与加成
            paiyiUsesPhase: g.paiyiUsesPhase,
            paiyiLimitPhase: g.paiyiLimitPhase,
            chengxiangBonus: g.chengxiangBonus,
            // 镇胆（闪赵云）/ 宽释（阚泽）：本轮状态与施加者
            basicUsedThisRound: g.basicUsedRound === state.roundState?.roundNumber
                ? g.basicUsedThisRound : undefined,
            zhendanDisabledRound: g.zhendanDisabledRound,
            kuanshiSourceIndex: g.kuanshiSourceIndex,
        }
    })

    return {
        roomId: state.roomId,
        phase: state.phase,
        mode: state.mode,
        oddityMode: state.oddityMode,
        landlordPick: state.landlordPick,
        landlordHumanSide: state.landlordHumanSide,
        pairPick: state.pairPick,
        pairHumanSide: state.pairHumanSide,
        myPlayerId,
        myFaction,
        pickState: state.pickState,
        deployState: state.deployState,
        generals,
        deckCount: state.deck.length,
        discardTop: state.discard[state.discard.length - 1],
        discard: state.discard,
        turnPhase: state.turnPhase,
        activePlayerFaction: state.activePlayerFaction,
        currentActionUnit: state.currentActionUnit,
        activeGeneralIndex: state.activeGeneralIndex,
        turnSerial: state.turnSerial,
        attackUsedThisTurn: state.attackUsedThisTurn,
        pendingResponse: describePendingResponse(state, state.pendingResponseQueue[0]),
        negateWindow: state.negateWindow ? {
            trickCardName: state.negateWindow.trickCardName,
            trickTargetName: state.negateWindow.trickTargetName,
            isCurrentlyNegated: state.negateWindow.isCurrentlyNegated,
            anyoneHasNegate: state.negateWindow.anyoneHasNegate,
            startedAt: state.negateWindow.startedAt,
        } : undefined,
        roundState: state.roundState,
        harvestPool: state.harvestPool,
        // 单机/热座的对局日志就是本机内存里的完整记录，不截断；
        // 界面只负责按需渲染最近若干条，早先的日志仍可展开查看
        matchId: state.matchId,
        log: [...state.log],
        fx: state.fx,
    }
}

/**
 * 将服务端完整 GameState 转换为观战者视图
 * - 观战者以所选阵营为视角，可以看到该阵营的手牌
 * - 部署阶段不显示部署信息
 */
export function toSpectatorView(
    state: GameState,
    viewFaction: Faction
): GameStateClientView {
    const isDeploy = state.phase === GamePhase.DEPLOY

    const generals: GeneralClientView[] = state.generals.map((g) => {
        const isViewFaction = g.faction === viewFaction
        return {
            generalId: g.generalId,
            faction: g.faction,
            seatRole: g.seatRole,
            hp: g.hp,
            maxHp: g.maxHp,
            handCount: g.hand.length,
            hand: visibleHand(g, isViewFaction),
            revealedCards: g.hand.filter(c => (g.revealedCardIds ?? []).includes(c.id)),
            equip: g.equip,
            judgeZone: g.judgeZone,
            alive: g.alive,
            hasActed: g.hasActed,
            awakened: g.awakened,
            loyaltyCard: g.loyaltyCard,
            skillsUsedThisTurn: g.skillsUsedThisTurn,
            usedLimitedSkills: g.usedLimitedSkills,
            shuzhiLimited: g.shuzhiLimited,
            extraSlashTargets: g.extraSlashTargets,
            chained: g.chained,
            wineDrunk: g.wineDrunk,
            wineBonusAttackNo: g.wineBonusAttackNo,
            generalPile: g.generalPile,
            kongshengActive: g.kongshengActive,
            liangCards: g.liangCards?.length ?? 0,
            acquiredSkills: g.acquiredSkills,
            armorPoints: g.armorPoints ?? 0,
            // 智迟：免疫只在“受伤所在回合”内有效（观战视图同样公开）
            zhichiImmune: g.zhichiImmuneTurn !== undefined
                && g.zhichiImmuneTurn === state.activeGeneralIndex,
            jiaozhaoCardId: g.jiaozhaoCardId,
            jiaozhaoAs: g.jiaozhaoAs,
            jiaozhaoUpgrade: g.jiaozhaoUpgrade,
            jiaozhaoMod1Round: g.jiaozhaoMod1Round,
            jiaozhaoMod2Round: g.jiaozhaoMod2Round,
            chunlaoCost: g.chunlaoWineRound !== undefined
                && g.chunlaoWineRound === state.roundState?.roundNumber
                ? (g.chunlaoWineCount ?? 0) : 0,
            // 珠（李肃）：标记数
            pearlMarks: g.pearlMarks,
            // 雄乱（张绣）：判定区已废除
            abolishedJudgeZone: g.abolishedJudgeZone,
            // 排异（界钟会）/ 称象（界曹冲）：阶段状态与加成
            paiyiUsesPhase: g.paiyiUsesPhase,
            paiyiLimitPhase: g.paiyiLimitPhase,
            chengxiangBonus: g.chengxiangBonus,
            basicUsedThisRound: g.basicUsedRound === state.roundState?.roundNumber
                ? g.basicUsedThisRound : undefined,
            zhendanDisabledRound: g.zhendanDisabledRound,
            kuanshiSourceIndex: g.kuanshiSourceIndex,
        }
    })

    return {
        roomId: state.roomId,
        phase: state.phase,
        myPlayerId: '',
        myFaction: viewFaction,
        pickState: state.pickState,
        deployState: isDeploy ? undefined : state.deployState,
        generals: isDeploy ? [] : generals,
        deckCount: state.deck.length,
        discardTop: state.discard[state.discard.length - 1],
        discard: state.discard,
        turnPhase: state.turnPhase,
        activePlayerFaction: state.activePlayerFaction,
        currentActionUnit: state.currentActionUnit,
        activeGeneralIndex: state.activeGeneralIndex,
        turnSerial: state.turnSerial,
        attackUsedThisTurn: state.attackUsedThisTurn,
        pendingResponse: describePendingResponse(state, state.pendingResponseQueue[0]),
        negateWindow: state.negateWindow ? {
            trickCardName: state.negateWindow.trickCardName,
            trickTargetName: state.negateWindow.trickTargetName,
            isCurrentlyNegated: state.negateWindow.isCurrentlyNegated,
            anyoneHasNegate: state.negateWindow.anyoneHasNegate,
            startedAt: state.negateWindow.startedAt,
        } : undefined,
        roundState: state.roundState,
        harvestPool: state.harvestPool,
        matchId: state.matchId,
        log: [...state.log],
        fx: state.fx,
        isSpectator: true,
    }
}

/**
 * 添加日志条目
 */
export function addLog(state: GameState, text: string): void {
    const seq = (state.logSeq ?? 0) + 1
    state.logSeq = seq
    state.log.push({ timestamp: Date.now(), text, seq, matchId: state.matchId })
    recordSkillLog(state, text)
}

/** 记录一条动效事件；只保留尾部 40 条，避免长对局无限增长 */
export function addFx(state: GameState, ev: Omit<FxEvent, 'seq'>): void {
    const seq = (state.fxSeq ?? 0) + 1
    state.fxSeq = seq
    const list = state.fx ?? (state.fx = [])
    list.push({ ...ev, seq })
    if (list.length > 40) list.splice(0, list.length - 40)
}

/** 按卡牌实例 id 找牌名（用过的牌可能已进弃牌堆） */
export function cardNameById(state: GameState, id: string): string | undefined {
    for (const g of state.generals) {
        const hit = g.hand.find((c) => c.id === id)
            ?? Object.values(g.equip).find((c) => c?.id === id)
            ?? g.judgeZone.find((c) => c.id === id)
        if (hit) return hit.name
    }
    return state.discard.find((c) => c.id === id)?.name
}

/**
 * 获取当前行动武将
 */
export function getActiveGeneral(state: GameState): GeneralInstance | undefined {
    return state.generals[state.activeGeneralIndex]
}

/**
 * 计算两个武将之间的距离（座位距离）
 * 3v3 标准座次：冷前A(0) → 冷主(1) → 冷前B(2) → 暖前B(3) → 暖主(4) → 暖前A(5)
 */
export function getSeatDistance(
    from: GeneralInstance,
    to: GeneralInstance,
    allGenerals: GeneralInstance[]
): number {
    const aliveSeats = allGenerals.filter((g) => g.alive)
    const fromIdx = aliveSeats.indexOf(from)
    const toIdx = aliveSeats.indexOf(to)
    if (fromIdx === -1 || toIdx === -1) return 999
    const n = aliveSeats.length
    const clockwise = (toIdx - fromIdx + n) % n
    const counterClock = (fromIdx - toIdx + n) % n
    return Math.min(clockwise, counterClock)
}

/** 距离修正明细（-1马 / +1马 / 镇卫 / 马术 / 奇谋…） */
export type DistanceModifier = { label: string; value: number }

/**
 * 计算攻击范围
 * 实际攻击范围 = 武器攻击范围（默认1）- 出击方-1马加成 - 马术技能 + 防守方+1马加成 + 镇卫技能
 */
export function getAttackRange(
    attacker: GeneralInstance,
    target: GeneralInstance,
    allGenerals: GeneralInstance[]
): { inRange: boolean; distance: number; baseDistance: number; range: number; modifiers: DistanceModifier[] } {
    const baseDist = getSeatDistance(attacker, target, allGenerals)
    // 记录每一处距离修正，出杀被拒时可以把账算给玩家看
    const modifiers: DistanceModifier[] = []
    let effectiveDist = baseDist
    const apply = (label: string, delta: number) => {
        if (delta === 0) return
        effectiveDist += delta
        modifiers.push({ label, value: delta })
    }

    // 坐骑影响
    if (attacker.equip.minus_horse) apply('-1马', -1)
    if (target.equip.plus_horse) apply('目标+1马', 1)

    // 马术技能：马超/庞德/马岱 → 攻击其他角色距离-1
    if (hasSkillOnGeneral(attacker, 'machao_mashu')
        || hasSkillOnGeneral(attacker, 'pangde_mashu')
        || hasSkillOnGeneral(attacker, 'madai_mashu')
        || hasSkillOnGeneral(attacker, 'lvbu_jing_mashu')) apply('马术', -1)

    // 镇卫技能：文聘 → 对方计算与己方其他角色距离+1（仅限目标非文聘自己的己方角色受文聘保护）
    const wenpinAlly = allGenerals.find(g =>
        g.alive && g !== target && g.faction === target.faction &&
        hasSkillOnGeneral(g, 'wenpin_zhenwei')
    )
    if (wenpinAlly) apply('镇卫', 1)

    // 奇谋（魏延）：本回合与其他角色的距离-X
    if (attacker.qimouDistanceReduce) {
        apply('奇谋', -Math.min(attacker.qimouDistanceReduce, effectiveDist))
    }

    // 奋迅（丁奉）：本回合与选定角色计算距离视为1
    if (attacker.fenxunTargetIndex !== undefined
        && allGenerals.indexOf(target) === attacker.fenxunTargetIndex
        && effectiveDist > 1) {
        apply('奋迅', 1 - effectiveDist)
    }

    // 伪溃（SP曹仁）：本回合计算与选定角色的距离视为1
    if (attacker.weikuiTargetSeat !== undefined
        && allGenerals.indexOf(target) === attacker.weikuiTargetSeat
        && effectiveDist > 1) {
        apply('伪溃', 1 - effectiveDist)
    }

    // 千驹（曹休）：计算与其他角色的距离-X（X为已损失的体力值）
    if (hasSkillOnGeneral(attacker, 'caoxiu_qianju')) {
        apply('千驹', -Math.min(Math.max(0, attacker.maxHp - attacker.hp), effectiveDist))
    }

    // 屯田（界邓艾）：计算与其他角色的距离-X（X为“田”的数量）
    if (hasSkillOnGeneral(attacker, 'dengai_tuntian')) {
        apply('屯田', -Math.min(attacker.generalPile?.length ?? 0, effectiveDist))
    }

    // 追击（SP马超）：与体力值不大于你的角色计算距离视为1
    if (hasSkillOnGeneral(attacker, 'machao_sp_zhuiji')
        && target.hp <= attacker.hp && effectiveDist > 1) {
        apply('追击', 1 - effectiveDist)
    }

    // 弓骑（韩当）：本阶段攻击范围无限
    if (attacker.infiniteRangePhase) {
        return { inRange: true, distance: effectiveDist, baseDistance: baseDist, range: 999, modifiers }
    }

    const weaponRange = (attacker.equip.weapon?.attackRange ?? 1) + (attacker.dufengBonus ?? 0)

    return {
        inRange: effectiveDist <= weaponRange,
        distance: effectiveDist,
        baseDistance: baseDist,
        range: weaponRange,
        modifiers,
    }
}

/** 检查武将是否拥有某技能（含原生 + 觉醒获得 + 奇技授予） */
export function hasSkillOnGeneral(general: GeneralInstance, skillId: string): boolean {
    const gid = general.generalId
    const def = getGeneralById(gid)
    const hasNative = def?.skills.some(s => skillMatches(gid, s.id, skillId)) ?? false
    const hasAcquired = general.acquiredSkills?.some((id) => skillMatches(gid, id, skillId)) ?? false
    return hasNative || hasAcquired
}

/**
 * 手牌上限
 * 默认等于当前体力值；界周瑜【英姿】改为等于体力上限
 */
export function getHandLimit(general: GeneralInstance): number {
    let delta = general.handLimitDelta ?? 0
    // 永久上限修正（流矢/魄袭等）：不随回合清零
    delta -= general.handLimitPenalty ?? 0
    // 巨贾（糜竺）：手牌上限+X（X 为体力上限）
    if (hasSkillOnGeneral(general, 'mizhu_jujia')) delta += general.maxHp
    // 绝境（神赵云）：手牌上限+2
    if (hasSkillOnGeneral(general, 'shenzhaoyun_juejing')) delta += 2
    // 明鉴（曹叡）：其下个回合手牌上限+1
    if (general.mingjianBonus) delta += 1
    // 劫营（神甘宁）：持有“营”时手牌上限+1
    if (general.yingMark) delta += 1
    // 辟田（郑浑）：因弃置或受伤累计的手牌上限加值
    if (hasSkillOnGeneral(general, 'zhenghun_pitian')) delta += general.pitianBonus ?? 0
    // 急攻（郭图逢纪）：本回合手牌上限等于本阶段造成的伤害值
    if (general.jigongActive) return Math.max(0, (general.damageDealtThisTurn ?? 0) + delta)
    if (general.handLimitOverride !== undefined) {
        return Math.max(0, general.handLimitOverride + delta)
    }
    // 不屈（周泰）：武将牌上有“创”时，手牌上限等于“创”数
    if (hasSkillOnGeneral(general, 'zhoutai_buqu') && (general.generalPile?.length ?? 0) > 0) {
        return Math.max(0, (general.generalPile?.length ?? 0) + delta)
    }
    let limit = hasSkillOnGeneral(general, 'zhouyu_jie_yingzi') ? general.maxHp : general.hp
    // 权计（界钟会）：手牌上限增加“权”的数量
    if (hasSkillOnGeneral(general, 'zhonghui_quanji')) limit += general.generalPile?.length ?? 0
    // 将驰（界曹彰）：以第一项跳过时，本回合【杀】不计入手牌上限
    if (general.slashNotInHandLimit) {
        limit += general.hand.filter(isSlashLikeCard).length
    }
    // 腹鳞（李严）：你于回合内获得的牌不计入本回合的手牌上限
    if (hasSkillOnGeneral(general, 'liyan_fulin')) limit += general.gainedCardsThisTurn ?? 0
    return Math.max(0, limit + delta)
}

/**
 * 获取牌的有效花色（红颜：小乔的♠视为♥）
 * @param card 目标牌
 * @param owner 持有该牌的角色（可选，判定牌等无持有者时不转换）
 */
export function getEffectiveSuit(card: { suit: CardSuit }, owner?: GeneralInstance): CardSuit {
    if (owner && card.suit === CardSuit.SPADE && hasSkillOnGeneral(owner, 'xiaoqiao_hongyan')) {
        return CardSuit.HEART
    }
    return card.suit
}

/**
 * 找到武将在 generals 数组中的下标
 */
export function findGeneralIndex(
    state: GameState,
    generalId: string
): number {
    return state.generals.findIndex((g) => g.generalId === generalId)
}

/** 牌名是否为【杀】（含火杀/雷杀） */
export function isSlashLikeCard(card: Card): boolean {
    return card.name === BasicCardName.ATTACK
        || card.name === BasicCardName.FIRE_SLASH
        || card.name === BasicCardName.THUNDER_SLASH
}

/**
 * 醇醪（界程普）：当你或与你相邻的角色的【杀】因弃置而置入弃牌堆后，
 * 将此【杀】置于你的武将牌上，称为“醇”（你至多拥有九张“醇”）。
 */
export function maybeChunlaoPickup(
    state: GameState,
    discardingGeneral: GeneralInstance,
    cards: Card[],
): void {
    if (cards.length === 0) return
    const owners: GeneralInstance[] = []
    for (const g of state.generals) {
        if (!g.alive || !hasSkillOnGeneral(g, 'chengpu_chunlao')) continue
        // 界程普的醇醪改为“弃置时收集”，原版仍是结束阶段主动放置
        if (!hasSkillOnGeneral(g, 'chengpu_jie_lihuo')) continue
        const nearby = g === discardingGeneral
            || getSeatDistance(g, discardingGeneral, state.generals) === 1
        if (nearby) owners.push(g)
    }
    if (owners.length === 0) return
    for (const card of cards) {
        if (!isSlashLikeCard(card)) continue
        for (const owner of owners) {
            const pile = owner.generalPile ?? (owner.generalPile = [])
            if (pile.length >= 9) continue
            const idx = state.discard.lastIndexOf(card)
            if (idx >= 0) state.discard.splice(idx, 1)
            pile.push(card)
            addLog(state, `【${getGeneralById(owner.generalId)?.name ?? owner.generalId}】【醇醪】将${cardFullName(card)}置于武将牌上，称为“醇”（${pile.length}）`)
            break
        }
    }
}

/**
 * 重置一个行动单元内所有武将的 hasActed 标志
 */
export function resetActedFlags(state: GameState, faction: Faction): void {
    state.generals
        .filter((g) => g.faction === faction)
        .forEach((g) => (g.hasActed = false))
}

/**
 * 判断游戏是否结束
 * 任意一方主帅阵亡 → 立即结束
 */
export function checkGameOver(
    state: GameState
): { over: boolean; winnerFaction?: Faction; reason?: string } {
    // 斗地主：地主阵亡 → 农民胜；两名农民均阵亡 → 地主胜
    if (state.mode === GameMode.DOUDIZHU) {
        const landlord = state.generals.find((g) => g.faction === Faction.WARM)
        if (!landlord?.alive) {
            return { over: true, winnerFaction: Faction.COOL, reason: '地主阵亡' }
        }
        const farmers = state.generals.filter((g) => g.faction === Faction.COOL)
        if (farmers.length > 0 && farmers.every((g) => !g.alive)) {
            return { over: true, winnerFaction: Faction.WARM, reason: '农民全部阵亡' }
        }
        return { over: false }
    }

    // 欢乐成双：某一阵营两名角色全部阵亡即判负
    if (state.mode === GameMode.HUANLE_SHUANG) {
        const warmAlive = state.generals.some((g) => g.faction === Faction.WARM && g.alive)
        const coolAlive = state.generals.some((g) => g.faction === Faction.COOL && g.alive)
        if (!warmAlive) {
            return { over: true, winnerFaction: Faction.COOL, reason: '暖色方全员阵亡' }
        }
        if (!coolAlive) {
            return { over: true, winnerFaction: Faction.WARM, reason: '冷色方全员阵亡' }
        }
        return { over: false }
    }

    const warmCommander = state.generals.find(
        (g) => g.faction === Faction.WARM && g.seatRole === SeatRole.COMMANDER
    )
    const coolCommander = state.generals.find(
        (g) => g.faction === Faction.COOL && g.seatRole === SeatRole.COMMANDER
    )

    if (!warmCommander?.alive) {
        return {
            over: true,
            winnerFaction: Faction.COOL,
            reason: '暖色方主帅阵亡',
        }
    }
    if (!coolCommander?.alive) {
        return {
            over: true,
            winnerFaction: Faction.WARM,
            reason: '冷色方主帅阵亡',
        }
    }
    return { over: false }
}
