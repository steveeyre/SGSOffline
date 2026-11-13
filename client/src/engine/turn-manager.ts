import {
    GameState,
    Faction,
    GameMode,
    TurnPhase,
    ActionUnitType,
    SeatRole,
    GeneralInstance,
    Card,
    CardSuit,
    TrickCardName,
    ResponseType,
    CardCategory,
    EquipSlot,
    BasicCardName,
} from 'sgs3v3-shared'
import { drawCards, ensureDeck } from './deck'
import { addLog, getActiveGeneral, getHandLimit, getAttackRange, resetActedFlags, maybeChunlaoPickup, isSlashLikeCard } from './game-state'
import { getGeneralById, skillMatches } from './generals'
import { anyoneHasNegate, cardDisplayName, cardFullName } from './card-utils'
import { resetSkillUses } from './skill-limit'
import { noteDeckDraws } from './combat-stats'
import {
    dealDamage, triggerQingzheng, triggerXiashu, triggerKuanshi, triggerLizhan,
    triggerShenduan, triggerYonglueQueue, triggerZhendanDraw, triggerJuejing,
    triggerJiangJieDiscard,
    resolveYonglueAttack, checkTuntian, markCardStateBaseline, syncCardState,
    triggerBifa, triggerBifaTurnStart, triggerZhendu, triggerQiluan, triggerMeibu,
    triggerMumu, triggerShanjia, triggerChenqing, triggerMoshi, triggerGuanwei,
    triggerYimou, triggerShefu, triggerTunchu, triggerShuliang, triggerXianfuChoose,
    triggerXianfuDamage, triggerXianfuHeal, triggerLingjuFenxin, maybeZongxuan, triggerZhimeng,
    triggerFensi, startJuetao, triggerPitian, restoreChuanwu, triggerGoude, triggerDaili, maybeZhuri,
    maybePingjian, expirePingjian, resolveNishouPendingSwap, maybeHongyuan, checkZhuwei,
} from './game-actions'
import { bumpLandlordRound, nextLandlordSeat } from '../modes/FightTheLandlord/landlord-turn'
import { bumpPairRound, nextPairSeat } from '../modes/HappyPair/pair-turn'

// ─────────────────────────────────────────────────────────────
// 大回合管理
// ─────────────────────────────────────────────────────────────
//
// currentActionStep 语义：
//   0 = 等待先手方选择行动单元
//   1 = 先手方第一行动单元执行中
//   2 = 等待后手方选择行动单元（先手第一单元刚结束）
//   3 = 后手方第一行动单元执行中
//   4 = 先手方剩余行动单元执行中
//   5 = 后手方剩余行动单元执行中
// ─────────────────────────────────────────────────────────────

/**
 * 冷色方选择 先手/让先（仅在第1大回合之前调用一次）
 */
export function handleYieldChoice(
    state: GameState,
    playerId: string,
    yieldFirst: boolean,
): { error: string } | void {
    const rs = state.roundState
    if (!rs.waitingForYield) return { error: '当前不是选择先手/让先的时机' }

    const player = state.players[playerId]
    if (!player) return { error: '玩家不存在' }
    if (player.faction !== Faction.COOL) return { error: '只有冷色方可以选择先手/让先' }

    rs.waitingForYield = false
    rs.yieldedFirst = yieldFirst

    if (yieldFirst) {
        rs.firstMover = Faction.WARM
        addLog(state, `冷色方选择【让先】，暖色方为先手方`)
    } else {
        rs.firstMover = Faction.COOL
        addLog(state, `冷色方选择【先手】，冷色方为先手方`)
    }

    startNewRound(state)
}

/**
 * 开始一个新的大回合 —— 等待先手方选择行动单元
 * 先手方由开局的先手/让先选择确定，之后保持不变（暖主保护轮除外）
 */
export function startNewRound(state: GameState): void {
    const rs = state.roundState
    // 镇胆②（闪赵云）：每轮结束时摸X张牌，然后本轮此技能失效
    for (const g of state.generals) {
        if (g.alive && hasSkillById(g, 'shanzhaoyun_zhendan')) triggerZhendanDraw(state, g)
    }
    rs.turnsThisRound = 0
    rs.roundNumber++
    rs.currentActionStep = 0
    rs.firstMoverChoice = undefined
    rs.secondMoverChoice = undefined
    rs.firstMoverFlankOrder = undefined
    rs.secondMoverFlankOrder = undefined

    // 暖主保护轮：若暖色方只剩主帅存活，暖色方自动先手（临时覆盖）
    const warmAlive = state.generals.filter(g => g.faction === Faction.WARM && g.alive)
    const warmOnlyCommander = warmAlive.length === 1 && warmAlive[0].seatRole === SeatRole.COMMANDER
    if (warmOnlyCommander && rs.firstMover !== Faction.WARM) {
        rs.firstMover = Faction.WARM
        addLog(state, `暖主保护轮！暖色方自动成为先手`)
    }

    resetActedFlags(state, Faction.WARM)
    resetActedFlags(state, Faction.COOL)

    // 清除忠义效果（"至本轮结束"）
    for (const g of state.generals) {
        if (g.loyaltyCard) {
            state.discard.push(g.loyaltyCard)
            g.loyaltyCard = undefined
        }
    }

    addLog(state, `═══ 第 ${rs.roundNumber} 大回合开始 ═══ 先手方：${factionName(rs.firstMover)}`)

    // 等待先手方选择
    state.activePlayerFaction = rs.firstMover
    state.currentActionUnit = undefined
    state.activeGeneralIndex = -1
    state.turnPhase = TurnPhase.TURN_START
}

/**
 * 玩家选择行动单元
 *
 * Step 0 → 先手选择 → 进入 step 1（先手第一单元执行）
 * Step 2 → 后手选择 → 进入 step 3（后手第一单元执行）
 */
export function chooseActionUnit(
    state: GameState,
    playerId: string,
    unit: ActionUnitType,
    flankOrder?: number[]
): { error: string } | void {
    const rs = state.roundState
    const player = state.players[playerId]
    if (!player?.faction) return { error: '玩家不存在' }

    const faction = player.faction
    const secondMover = rs.firstMover === Faction.WARM ? Faction.COOL : Faction.WARM

    // ── 先手方选择（step 0）
    if (rs.currentActionStep === 0) {
        if (faction !== rs.firstMover) return { error: '等待先手方选择' }

        const pick = resolveUnitChoice(state, faction, unit)
        if ('error' in pick) return pick
        unit = pick.unit

        rs.firstMoverChoice = unit
        if (unit === ActionUnitType.FLANKS && flankOrder) {
            rs.firstMoverFlankOrder = flankOrder
        }

        addLog(state, `${factionName(faction)}选择${unit === ActionUnitType.COMMANDER ? '主帅' : '边锋'}先行动`)

        // 进入 step 1：执行先手第一单元
        rs.currentActionStep = 1
        executeCurrentStep(state)
        return
    }

    // ── 后手方选择（step 2）
    if (rs.currentActionStep === 2) {
        if (faction !== secondMover) return { error: '等待后手方选择' }

        const pick = resolveUnitChoice(state, faction, unit)
        if ('error' in pick) return pick
        unit = pick.unit

        rs.secondMoverChoice = unit
        if (unit === ActionUnitType.FLANKS && flankOrder) {
            rs.secondMoverFlankOrder = flankOrder
        }

        addLog(state, `${factionName(faction)}选择${unit === ActionUnitType.COMMANDER ? '主帅' : '边锋'}先行动`)

        // 进入 step 3：执行后手第一单元
        rs.currentActionStep = 3
        executeCurrentStep(state)
        return
    }

    // ── step 4/5：剩余单元是边锋时的边锋顺序选择
    if (rs.currentActionStep === 4 || rs.currentActionStep === 5) {
        const expectedFaction = rs.currentActionStep === 4 ? rs.firstMover : secondMover
        if (faction !== expectedFaction) return { error: '等待对方选择' }

        // 此时 unit 应该是 FLANKS（从客户端传来的是 FLANKS + flankOrder）
        if (unit === ActionUnitType.FLANKS && flankOrder) {
            if (rs.currentActionStep === 4) {
                rs.firstMoverFlankOrder = flankOrder
            } else {
                rs.secondMoverFlankOrder = flankOrder
            }
        }

        addLog(state, `${factionName(faction)}选择了边锋行动顺序`)
        executeCurrentStep(state)
        return
    }

    return { error: '当前不是选择行动单元的时机' }
}

/**
 * 选定的单元没有可行动角色时改用另一个单元。
 * 客户端只剩一个“继续”按钮，若它总是发 FLANKS，边锋全灭的那一侧就会
 * 反复被拒绝、界面停在这一步（表现为“没有按钮可点”）。
 * @returns 实际采用的单元，或错误信息
 */
function resolveUnitChoice(
    state: GameState,
    faction: Faction,
    unit: ActionUnitType,
): { unit: ActionUnitType } | { error: string } {
    const err = validateUnitChoice(state, faction, unit)
    if (!err) return { unit }
    const alt = unit === ActionUnitType.COMMANDER ? ActionUnitType.FLANKS : ActionUnitType.COMMANDER
    if (!validateUnitChoice(state, faction, alt)) return { unit: alt }
    return { error: err.error }
}

/** 验证行动单元选择是否有效 */
function validateUnitChoice(
    state: GameState,
    faction: Faction,
    unit: ActionUnitType
): { error: string } | undefined {
    const rs = state.roundState

    // 第1大回合，先手方只能选主帅
    if (rs.roundNumber === 1 && faction === rs.firstMover && unit === ActionUnitType.FLANKS) {
        return { error: '第一大回合先手方只能选择主帅先行动' }
    }

    if (unit === ActionUnitType.FLANKS) {
        const flanks = state.generals.filter(
            g => g.faction === faction &&
                (g.seatRole === SeatRole.FLANK_A || g.seatRole === SeatRole.FLANK_B) &&
                g.alive
        )
        if (flanks.length === 0) return { error: '没有存活的边锋，只能选主帅' }
    } else {
        const cmd = state.generals.find(
            g => g.faction === faction && g.seatRole === SeatRole.COMMANDER && g.alive
        )
        if (!cmd) return { error: '主帅已阵亡' }
    }
    return undefined
}

/**
 * 根据当前 step 执行对应的行动单元
 *
 *   step 1 → 先手方第一选择单元
 *   step 3 → 后手方第一选择单元
 *   step 4 → 先手方剩余单元
 *   step 5 → 后手方剩余单元
 */
function executeCurrentStep(state: GameState): void {
    const rs = state.roundState
    const secondMover = rs.firstMover === Faction.WARM ? Faction.COOL : Faction.WARM

    let faction: Faction
    let unit: ActionUnitType
    let flankOrder: number[] | undefined

    switch (rs.currentActionStep) {
        case 1:
            faction = rs.firstMover
            unit = rs.firstMoverChoice!
            flankOrder = rs.firstMoverFlankOrder
            break
        case 3:
            faction = secondMover
            unit = rs.secondMoverChoice!
            flankOrder = rs.secondMoverFlankOrder
            break
        case 4:
            faction = rs.firstMover
            unit = rs.firstMoverChoice === ActionUnitType.COMMANDER
                ? ActionUnitType.FLANKS : ActionUnitType.COMMANDER
            flankOrder = rs.firstMoverFlankOrder
            break
        case 5:
            faction = secondMover
            unit = rs.secondMoverChoice === ActionUnitType.COMMANDER
                ? ActionUnitType.FLANKS : ActionUnitType.COMMANDER
            flankOrder = rs.secondMoverFlankOrder
            break
        default:
            // 所有步骤执行完毕
            startNewRound(state)
            return
    }

    // 如果该单元没有存活角色，直接跳过
    const candidates = getUnitCandidates(state, faction, unit, flankOrder)
    if (candidates.length === 0) {
        advanceStep(state)
        return
    }

    // step 4/5 的边锋行动：如果有多个存活边锋且没有 flankOrder，需要让用户选择顺序
    if ((rs.currentActionStep === 4 || rs.currentActionStep === 5) && unit === ActionUnitType.FLANKS) {
        const aliveFlanks = state.generals.filter(
            g => g.faction === faction &&
                (g.seatRole === SeatRole.FLANK_A || g.seatRole === SeatRole.FLANK_B) &&
                g.alive
        )
        if (aliveFlanks.length > 1 && !flankOrder) {
            // 暂停，等待用户选择边锋顺序
            state.activePlayerFaction = faction
            state.currentActionUnit = undefined
            state.activeGeneralIndex = -1
            addLog(state, `${factionName(faction)}请选择边锋行动顺序`)
            return
        }
    }

    state.activePlayerFaction = faction
    state.currentActionUnit = unit
    state.activeGeneralIndex = state.generals.indexOf(candidates[0])

    addLog(state, `${factionName(faction)}的${unit === ActionUnitType.COMMANDER ? '主帅' : '边锋'}行动`)
    runTurnStart(state)
}

/**
 * 当前行动单元完成后推进到下一步
 * step 1 结束 → step 2（等待后手选择）
 * step 3 结束 → step 4（先手剩余）
 * step 4 结束 → step 5（后手剩余）
 * step 5 结束 → 下一大回合
 */
function advanceStep(state: GameState): void {
    const rs = state.roundState

    if (rs.currentActionStep === 1) {
        // 先手第一单元结束 → 等待后手选择
        rs.currentActionStep = 2
        const secondMover = rs.firstMover === Faction.WARM ? Faction.COOL : Faction.WARM
        state.activePlayerFaction = secondMover
        state.currentActionUnit = undefined
        state.activeGeneralIndex = -1
        addLog(state, `${factionName(secondMover)}请选择行动单元`)
        return
    }

    // 其他步骤直接递进
    rs.currentActionStep++
    executeCurrentStep(state)
}

/** 获取行动单元内的候选武将（按顺序，排除已行动的） */
function getUnitCandidates(
    state: GameState,
    faction: Faction,
    unit: ActionUnitType,
    flankOrder?: number[]
): GeneralInstance[] {
    if (unit === ActionUnitType.COMMANDER) {
        return state.generals.filter(
            g => g.faction === faction && g.seatRole === SeatRole.COMMANDER && g.alive && !g.hasActed
        )
    }

    const flanks = state.generals.filter(
        g => g.faction === faction &&
            (g.seatRole === SeatRole.FLANK_A || g.seatRole === SeatRole.FLANK_B) &&
            g.alive && !g.hasActed
    )

    if (flankOrder && flankOrder.length > 0) {
        flanks.sort((a, b) => {
            const ai = flankOrder.indexOf(state.generals.indexOf(a))
            const bi = flankOrder.indexOf(state.generals.indexOf(b))
            return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
        })
    }

    return flanks
}

// ─────────────────────────────────────────────────────────────
// 武将回合管理
// ─────────────────────────────────────────────────────────────

/** 武将回合开始：准备 → 判定 → 摸牌 → 出牌 */
export function runTurnStart(state: GameState): void {
    const general = getActiveGeneral(state)
    if (!general) return

    const name = getGeneralName(general)

    // 星卜（谯周）的“下个回合”效果只在该回合有效，未用掉的部分在回合开始时作废
    general.drawPhaseBonus = 0
    general.skipDiscardPhase = false

    // ── 翻面：背面朝上的角色在其回合开始时翻回正面并跳过整个回合
    if (general.flipped) {
        general.flipped = false
        general.hasActed = true
        state.turnPhase = TurnPhase.TURN_END
        addLog(state, `【${name}】从背面翻回正面，跳过本回合`)
        triggerFrontFlipSkills(state, general)
        if (state.pendingResponseQueue.length === 0) advanceAfterTurn(state)
        return
    }

    addLog(state, `【${name}】回合开始`)
    state.turnPhase = TurnPhase.TURN_START
    state.turnSerial = (state.turnSerial ?? 0) + 1
    // 轮次：每名存活角色各行动一次记为一轮（“每轮限一次”以此为基准）
    const roundSelfIdx = state.generals.indexOf(general)
    if ((state.roundSeen ?? []).includes(roundSelfIdx)) {
        state.roundSerial = (state.roundSerial ?? 0) + 1
        state.roundSeen = []
    }
    state.roundSeen = [...(state.roundSeen ?? []), roundSelfIdx]
    state.attackUsedThisTurn = 0
    resetSkillUses(general)
    general.wineDrunk = false
    general.wineBonusAttackNo = undefined
    general.skillsUsedThisTurn = []
    general.rendeGivenThisTurn = 0
    general.rendeHealedThisTurn = false
    general.rendeReceivedThisPhase = []
    general.rendeSecondGivenThisTurn = false
    // 回合级通用状态位清零（供新武将技能使用）
    general.damageTakenThisTurn = 0
    general.damageDealtThisTurn = 0
    general.lastUsedCard = undefined
    // “本回合获得的牌”统计（腹鳞、承诏）只在本回合有效
    general.gainedCardsThisTurn = 0
    // 好施（界鲁肃）：“直到你的下个回合开始”的受益者标记在自己回合开始时作废
    general.haoshiGuardReceiver = undefined
    // 博图（界吕蒙）：记录弃牌堆快照，回合结束时用它判断本回合置入弃牌堆的牌是否凑齐四种花色
    general.discardBaseline = hasSkillById(general, 'lvmeng_jie_botu')
        ? state.discard.map((c) => c.id)
        : undefined
    general.fenxunTargetIndex = undefined
    general.duwuLockedThisPhase = false
    // 平衡版新武将的回合级状态
    general.luoyiActive = false
    general.qianxiColor = undefined
    general.qizhiCount = 0
    general.dufengBonus = 0
    general.cardsUsedThisTurn = 0
    general.forbiddenTargetIndex = undefined
    general.forbiddenTargetTurn = undefined
    general.cannotUseHandTurn = undefined
    general.damageTakenBonusTurn = undefined
    general.yijueHeartBonusTurn = undefined
    general.yijueHeartTarget = undefined
    general.gainedCardIdsThisTurn = []
    general.luechengSlashIds = []
    general.luechengTarget = undefined
    general.luechengTurn = undefined
    general.manwangStep = 0
    general.panqinDiscardIds = []
    general.panqinPhaseKey = undefined
    general.zuolianUsesPhase = 0
    // 义绝（界关羽）：非锁定技失效与禁用手牌只持续到当前回合结束
    for (const g of state.generals) {
        g.yijueNoSkillTurn = undefined
        if (g !== general) g.cannotUseHandTurn = undefined
    }
    general.extraSlashCount = 0
    general.qiangxiUsesPhase = 0
    general.qiangxiTargetsPhase = []
    general.zhanjueDrawnThisPhase = 0
    general.qiceBonusThisTurn = 0
    general.weikuiTargetSeat = undefined
    general.weikuiTurn = undefined
    // 洛书版新增武将的回合级状态
    general.chenglueSuits = []
    general.usedCardCategories = []
    general.basicUsedThisTurn = []
    // 燃己（谋姜维）：阶段数按自己回合内的用牌阶段统计
    general.usedCardPhases = []
    general.infiniteRangePhase = false
    general.yanyuRecast = 0
    general.handLimitDelta = 0
    general.handLimitOverride = undefined
    general.jigongActive = false
    general.yaomingTurn = undefined
    general.cardsUsedOnOthersThisTurn = 0
    general.jisheCount = 0
    general.lihuoFirePhase = false
    general.lihuoDamaged = false
    general.jiaozhaoCardId = undefined
    general.jiaozhaoAs = undefined
    general.zhenguTargets = []
    general.paoxiaoBonus = false
    general.mijiExtraThisTurn = false
    // 洛书版扩展（二）回合级状态
    general.extraSlashTargets = 0
    general.slashNoRangeTurn = false
    general.cannotSlashTurn = false
    general.slashUnavoidableTurn = false
    general.slashRedRangeTurn = false
    general.ignoreArmorTargetIndex = undefined
    general.unlimitedTargetIndex = undefined
    general.extraTargetIndex = undefined
    general.xianzhenLoseIndex = undefined
    general.shuangxiongColor = undefined
    general.pindiCount = 0
    general.pindiTargets = []
    general.pindiCategories = []
    general.duanfaCount = 0
    general.damagedCardIds = []
    general.phaseEndDraw = 0
    general.changbiaoDamaged = 0
    general.kongshengActive = false
    // 洛书版扩展（四）：回合级状态
    general.jinceCategories = []
    general.jinceSuits = []
    general.fenliSkips = 0
    general.liegongBonusTarget = undefined
    general.discardedCardThisTurn = false
    general.yuxuPenalty = false
    general.xiongluanTarget = undefined
    general.xiongluanTurn = undefined
    // 洛书版扩展（五）：回合级状态
    general.slashLimitDelta = 0
    general.slashNotInHandLimit = false
    // 洛书版扩展（七）：龙临（闪赵云）的“只能指定自己”限制
    general.onlySelfTargetPhase = false

    // 星卜（谯周）：上回合亮出红牌数对应的效果，在自己的下个回合开始时生效
    if (general.xingbuMode) {
        const mode = general.xingbuMode
        general.xingbuMode = undefined
        if (mode === 'three') {
            general.drawPhaseBonus = (general.drawPhaseBonus ?? 0) + 2
            general.slashLimitDelta = (general.slashLimitDelta ?? 0) + 1
            addLog(state, `【${name}】的【星卜】生效：摸牌阶段多摸两张牌，本回合使用【杀】次数上限+1`)
        } else if (mode === 'two') {
            general.slashLimitDelta = (general.slashLimitDelta ?? 0) - 1
            general.skipDiscardPhase = true
            addLog(state, `【${name}】的【星卜】生效：本回合使用【杀】次数上限-1，跳过弃牌阶段`)
        } else {
            general.prepDiscardPending = (general.prepDiscardPending ?? 0) + 1
            addLog(state, `【${name}】的【星卜】生效：准备阶段须弃置一张手牌`)
        }
    }
    // 立牧（刘焉）：出牌阶段限一次，随回合重置
    general.limuUsedPhase = false

    // “本回合”语义的状态位：每次都回合都需要对全体清零
    // - damageTakenThisTurn：矢北判定“本回合第一次受伤”（可能在别人的回合受伤）
    // - zhichiImmuneTurn：智迟的免疫只持续到受伤所在回合结束
    for (const g of state.generals) {
        g.damageTakenThisTurn = 0
        g.damageTimesThisTurn = 0
        g.zhichiImmuneTurn = undefined
        // 奇谋（魏延）：距离与杀次数加成只持续到本回合结束
        g.qimouDistanceReduce = 0
        g.qimouSlashBonus = 0
        // 洛书版扩展（四）：“本回合”语义的状态位在回合切换时统一作废
        g.discardedCardThisTurn = false
        // 精策（界郭淮）：使用过的牌的类别/花色只统计本回合
        g.jinceCategories = []
        g.jinceSuits = []
        g.liegongBonusTarget = undefined
        if (g.handForbiddenTurn !== undefined && g.handForbiddenTurn !== state.turnSerial) {
            g.handForbiddenTurn = undefined
        }
        if (g.xiongluanTurn !== undefined && g.xiongluanTurn !== state.turnSerial) {
            g.xiongluanTurn = undefined
            g.xiongluanTarget = undefined
        }
        // 惴恐（界伏皇后）：只能指定自己为目标的限制只持续到该回合结束
        if (g.useOnlySelfTurn !== undefined && g.useOnlySelfTurn !== state.turnSerial) {
            g.useOnlySelfTurn = undefined
        }
        // 献图（界张松）：贡献记录只在本阶段有效
        if (g.xiantuTurn !== undefined && g.xiantuTurn !== state.turnSerial) {
            g.xiantuTargetIndex = undefined
            g.xiantuCount = undefined
            g.xiantuTurn = undefined
            g.xiantuDamageBaseline = undefined
        }
        // 实荐（许靖）：本回合获得的【誉虚】在回合结束后失去
        if (g.yuxuGrantedTurn !== undefined && g.yuxuGrantedTurn !== state.turnSerial) {
            g.acquiredSkills = (g.acquiredSkills ?? []).filter((s) => s !== 'xujing_yuxu')
            g.yuxuGrantedTurn = undefined
            g.yuxuPenalty = false
        }
    }

    // 劫营①（神甘宁）：回合开始时，若没有有“营”标记的角色，获得“营”
    if (hasSkillById(general, 'ganning_shen_jieying') && !state.generals.some(g => g.yingMark)) {
        general.yingMark = true
        addLog(state, `【${name}】发动【劫营】，获得“营”标记`)
    }

    // 贵相（族吴苋）：第 X 个阶段改为出牌阶段
    if (maybeGuixiang(state, general, 'prep')) return

    // 跋扈（斗地主地主技）：锁定技，准备阶段摸一张牌
    if (state.mode === GameMode.DOUDIZHU && hasSkillById(general, 'doudizhu_bahu')) {
        const bahuDrawn = drawCards(state, 1)
        general.hand.push(...bahuDrawn)
        addLog(state, `【${name}】发动【跋扈】，摸${bahuDrawn.length}张牌`)
    }

    // 忿肆（曹髦）：锁定技，准备阶段对一名体力值不小于你的角色造成1点伤害；
    // 若该角色不是你，其视为对你使用一张【杀】（走完整【杀】结算）
    if (hasSkillById(general, 'caomao_fensi')) {
        triggerFensi(state, general)
    }

    // 洛书版扩展（九）：回合级状态
    general.cardsUsedTurnCount = 0
    ;(general as any).yingyuanCategories = []
    general.moshiCards = []
    general.moshiUseIndex = 0
    general.niguBonus = 0
    general.extraActionPhase = false
    // 笔伐（陈琳）：有“笔伐”牌的角色回合开始时观看此牌并抉择
    triggerBifaTurnStart(state, general)
    // 先辅（戏志才）：游戏开始时选择一名其他角色
    triggerXianfuChoose(state, general)

    // ── 回合开始时（其他角色的技能）
    // 惴恐（界伏皇后）：其他角色的回合开始时，若你已受伤，你可以与其拼点
    for (const fh of state.generals) {
        if (!fh.alive || fh === general) continue
        if (!hasSkillById(fh, 'fuhuanghou_zhuikong')) continue
        if (fh.hp >= fh.maxHp) continue
        if (fh.hand.length === 0 || general.hand.length === 0) continue
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(fh),
            context: {
                skillId: 'fuhuanghou_zhuikong',
                skillName: '惴恐',
                description: `与【${name}】拼点：若你赢，其本回合使用牌只能指定自己为目标；否则你获得其拼点的牌且其视为对你使用一张【杀】`,
                chuikongOpponentIndex: state.generals.indexOf(general),
            },
        })
        addLog(state, `【${getGeneralName(fh)}】可发动【惴恐】`)
    }

    // 陷嗣②（刘封）：其他角色可以移去两张“逆”，视为对刘封使用一张【杀】
    for (const lf of state.generals) {
        if (!lf.alive || lf === general) continue
        if (!hasSkillById(lf, 'liufeng_xiansi')) continue
        if ((lf.generalPile?.length ?? 0) < 2) continue
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(general),
            context: {
                skillId: 'liufeng_xiansi_use',
                skillName: '陷嗣',
                description: `移去【${getGeneralName(lf)}】的两张“逆”，视为对其使用一张【杀】`,
                xiansiOwnerIndex: state.generals.indexOf(lf),
            },
        })
        addLog(state, `【${name}】可移去【${getGeneralName(lf)}】的两张“逆”，视为对其使用一张【杀】`)
    }

    // 自立（界钟会觉醒技）：一名角色的准备阶段，若“权”≥3 → 减1体力上限并获得【排异】，然后选择一项
    for (const zh of state.generals) {
        if (!zh.alive || zh.awakened) continue
        if (!hasSkillById(zh, 'zhonghui_zili')) continue
        if ((zh.generalPile?.length ?? 0) < 3) continue
        zh.awakened = true
        zh.maxHp -= 1
        if (zh.hp > zh.maxHp) zh.hp = zh.maxHp
        zh.acquiredSkills.push('zhonghui_paiyi')
        addLog(state, `【${getGeneralName(zh)}】发动【自立】觉醒！减1点体力上限，获得【排异】`)
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(zh),
            context: {
                skillId: 'zhonghui_zili',
                skillName: '自立',
                description: '选择一项：1.回复1点体力；2.摸两张牌',
                options: [
                    { action: 'heal', label: '回复1点体力' },
                    { action: 'draw', label: '摸两张牌' },
                ],
            },
        })
    }

    // ── 匡弼（孙登）：下个回合开始时获得“匡弼”牌，来源摸等量的牌
    if (hasSkillById(general, 'sundeng_kuangbi') && (general.kuangbiCount ?? 0) > 0) {
        const kbCards = general.generalPile ?? []
        const kbCount = general.kuangbiCount ?? kbCards.length
        const kbGiver = state.generals[general.kuangbiGiver as number]
        general.hand.push(...kbCards)
        general.generalPile = []
        general.kuangbiCount = undefined
        general.kuangbiGiver = undefined
        if (kbGiver?.alive) {
            const kbBonus = drawCards(state, kbCount)
            kbGiver.hand.push(...kbBonus)
        }
        addLog(state, `【${name}】【匡弼】获得${kbCards.length}张牌` +
            (kbGiver?.alive ? `，【${getGeneralName(kbGiver)}】摸${kbCount}张牌` : ''))

        // 良姻②（周妃）：游戏外的牌进入角色的手牌区时
        triggerLiangyinIn(state)
    }

    // ── 准备���段被动

    // 点虎（黄权）：游戏开始时选择一名其他角色（首次回合开始时询问一次）
    for (const g of state.generals) {
        if (!g.alive || g.dianhuPrompted || g.dianhuTargetIndex !== undefined) continue
        if (!hasSkillById(g, 'huangquan_dianhu')) continue
        g.dianhuPrompted = true
        const candidateIndices = state.generals
            .map((x, i) => ({ x, i }))
            .filter(({ x, i }) => x.alive && i !== state.generals.indexOf(g))
            .map(({ i }) => i)
        if (candidateIndices.length === 0) continue
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_DIANHU_TARGET,
            targetGeneralIndex: state.generals.indexOf(g),
            context: { candidateIndices },
        })
    }

    // 潜袭（马岱）：展示一张手牌，距离1的其他角色不能用/打出同色手牌，且此牌伤害+1
    if (hasSkillById(general, 'madai_qianxi') && general.hand.length > 0) {
        const qianxiCandidates = state.generals
            .map((g, idx) => ({ g, idx }))
            .filter(({ g, idx }) => g.alive && idx !== state.generals.indexOf(general)
                && getAttackRange(general, g, state.generals).distance <= 1)
            .map(({ idx }) => idx)
        if (qianxiCandidates.length > 0) {
            state.pendingResponseQueue.push({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    skillId: 'madai_qianxi',
                    skillName: '潜袭',
                    description: '展示一张手牌：距离1的其他角色本回合不能使用或打出同色手牌，你本回合使用此牌造成的伤害+1',
                    qianxiCandidates,
                },
            })
            addLog(state, `【${name}】可发动【潜袭】`)
        }
    }

    // 鸿举（毌丘俭觉醒技）：准备阶段“荣”≥3 → 可用任意张手牌替换等量“荣”，减1体力上限并获得【清侧】
    if (hasSkillById(general, 'guanqiujian_hongju') && !general.awakened
        && (general.generalPile?.length ?? 0) >= 3) {
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(general),
            context: {
                skillId: 'guanqiujian_hongju',
                skillName: '鸿举',
                description: `“荣”${general.generalPile!.length}张：可用任意张手牌替换等量的“荣”，然后减1点体力上限并获得【清侧】`,
            },
        })
        addLog(state, `【${name}】可发动【鸿举】`)
    }

    // 凿险（邓艾觉醒技）：准备阶段“田”≥3 → 减1体力上限，获得急袭
    if (hasSkillById(general, 'dengai_zaoxian') && !general.awakened
        && (general.generalPile?.length ?? 0) >= 3) {
        general.awakened = true
        general.maxHp -= 1
        if (general.hp > general.maxHp) general.hp = general.maxHp
        general.acquiredSkills.push('dengai_jixi')
        addLog(state, `【${name}】发动【凿险】觉醒！减1体力上限，获得【急袭】`)
    }

    // 战神（吕布-竞）：准备阶段，选择一项未获得的效果获得直到本局结束
    if (hasSkillById(general, 'lvbu_jing_zhanshen')) {
        const gained = general.zhanshenEffects ?? []
        const available: { action: string; label: string }[] = []
        if (!gained.includes(1)) available.push({ action: '1', label: '摸牌阶段多摸一张牌' })
        if (!gained.includes(2)) available.push({ action: '2', label: '使用【杀】造成的伤害+1' })
        if (!gained.includes(3)) available.push({ action: '3', label: '使用【杀】可额外选择一个目标' })
        if (!gained.includes(4) && hasSkillById(general, 'lvbu_jing_xiaoxiong')
            && general.seatRole !== SeatRole.COMMANDER) {
            available.push({ action: '4', label: '出牌阶段可以多使用一张【杀】（先锋技）' })
        }
        if (available.length > 0) {
            state.pendingResponseQueue.push({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    skillId: 'lvbu_jing_zhanshen',
                    skillName: '战神',
                    description: '选择一项未获得的效果获得直到本局结束',
                    options: available,
                },
            })
            addLog(state, `【${name}】可发动【战神】选择一项效果`)
        }
    }

    // 返乡（SP孙尚香觉醒技）：已受伤 → 加1体力上限并回复1体力，失去良助获得枭姬
    if (hasSkillById(general, 'sp_sunshangxiang_fanxiang') && !general.awakened
        && general.hp < general.maxHp) {
        general.awakened = true
        general.maxHp += 1
        if (!general.noRecoverUntilKill) general.hp = Math.min(general.hp + 1, general.maxHp)
        general.lostSkills = [...(general.lostSkills ?? []), 'sp_sunshangxiang_liangzhu']
        general.acquiredSkills.push('sunshangxiang_xiaoji')
        addLog(state, `【${name}】发动【返乡】觉醒！体力上限+1并回复1点体力，失去【良助】获得【枭姬】`)
    }

    // 绝地（祖茂）：准备阶段，若有“引兵”牌，选择一项
    if (hasSkillById(general, 'zumao_juedi') && (general.generalPile?.length ?? 0) > 0) {
        const candidates = state.generals
            .map((g, idx) => ({ g, idx }))
            .filter(({ g, idx }) => g.alive && idx !== state.generals.indexOf(general) && g.hp <= general.hp)
            .map(({ idx }) => idx)
        const juediOptions: { action: string; label: string }[] = [
            { action: 'draw', label: '移去所有“引兵”牌，将手牌摸至体力上限' },
        ]
        if (candidates.length > 0) {
            juediOptions.push({ action: 'give', label: '令一名体力值不大于你的其他角色获得所有“引兵”牌，然后其回复1点体力并摸等量的牌' })
        }
        state.pendingResponseQueue.unshift({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(general),
            context: {
                skillId: 'zumao_juedi',
                skillName: '绝地',
                description: `“引兵”${general.generalPile!.length}张，选择一项`,
                options: juediOptions,
                zumaoCandidates: candidates,
            },
        })
        addLog(state, `【${name}】发动【绝地】`)
    }

    // 推锋（李通）：准备阶段移去所有“锋”，摸等量牌并获得等量额外【杀】次数
    if (hasSkillById(general, 'litong_tuifeng') && (general.generalPile?.length ?? 0) > 0) {
        const count = general.generalPile!.length
        state.discard.push(...general.generalPile!)
        general.generalPile = []
        const drawn = drawCards(state, count)
        general.hand.push(...drawn)
        general.extraSlashCount = (general.extraSlashCount ?? 0) + count
        addLog(state, `【${name}】发动【推锋】，移去 ${count} 张“锋”，摸 ${drawn.length} 张牌，本回合【杀】次数上限+${count}`)
    }

    // 洛神（甄姬）：判定若黑色获得此牌，可选择继续判定（支持鬼才/缓释介入）
    if (hasSkillById(general, 'zhenji_luoshen') && ensureDeck(state)) {
        const judgeCard = state.deck.shift()!
        state.discard.push(judgeCard)
        addLog(state, `【${name}】的【洛神】判定：${cardFullName(judgeCard)}`)

        // 检查鬼才/缓释介入
        const intervenor = findJudgeIntervenor(state, general)
        if (intervenor) {
            const huanshiOwnerIndex = hasSkillById(intervenor, 'zhugejin_huanshi')
                ? state.generals.indexOf(intervenor) : undefined
            state.pendingResponseQueue.push({
                type: ResponseType.JUDGE_INTERVENE,
                targetGeneralIndex: huanshiOwnerIndex !== undefined
                    ? state.generals.indexOf(general)
                    : state.generals.indexOf(intervenor),
                context: {
                    judgeType: 'luoshen',
                    judgingGeneralIndex: state.generals.indexOf(general),
                    judgeCardId: judgeCard.id,
                    judgeCard,
                    judgeName: '洛神',
                    huanshiOwnerIndex,
                },
            })
            const skillName = judgeInterveneSkillName(intervenor)
            addLog(state, huanshiOwnerIndex !== undefined
                ? `【${getGeneralName(general)}】可选择【${getGeneralName(intervenor)}】的一张手牌发动【${skillName}】修改判定`
                : `【${getGeneralName(intervenor)}】可发动【${skillName}】修改判定`)
        } else {
            // 无人介入，直接结算
            const isBlack = judgeCard.suit === CardSuit.SPADE || judgeCard.suit === CardSuit.CLUB
            if (isBlack) {
                const discardIdx = state.discard.indexOf(judgeCard)
                if (discardIdx >= 0) state.discard.splice(discardIdx, 1)
                general.hand.push(judgeCard)
                addLog(state, `【${name}】【洛神】判定黑色！获得${cardFullName(judgeCard)}`)
                // 洛神获得的牌不计入本回合手牌上限
                general.handLimitDelta = (general.handLimitDelta ?? 0) + 1
                if (state.deck.length > 0) {
                    state.pendingResponseQueue.push({
                        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                        targetGeneralIndex: state.generals.indexOf(general),
                        context: {
                            skillId: 'zhenji_luoshen_continue',
                            skillName: '洛神',
                            description: '继续判定',
                        },
                    })
                }
            } else {
                addLog(state, `【${name}】【洛神】判定红色（${cardFullName(judgeCard)}），停止`)
                checkTiandu(state, general, judgeCard)
            }
        }
    }

    // 志继（姜维觉醒技）：准备阶段无手牌→减1体力上限→获得观星→选择回1血或摸2牌
    if (hasSkillById(general, 'jiangwei_zhiji') && !general.awakened && general.hand.length === 0) {
        general.awakened = true
        general.maxHp -= 1
        if (general.hp > general.maxHp) general.hp = general.maxHp
        general.acquiredSkills.push('zhugeliang_guanxing')
        addLog(state, `【${name}】发动【志继】觉醒！减1体力上限，获得【观星】`)

        // 让玩家选择：回1血 或 摸2牌
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(general),
            context: {
                skillId: 'jiangwei_zhiji_choice',
                skillName: '志继',
                description: '选择回复1点体力 或 摸2张牌',
            },
        })
    }

    // 魂姿（孙策觉醒技）：准备阶段，体力1→减1上限获得英姿+英魂
    if ((hasSkillById(general, 'sunce_hunzi') || hasSkillById(general, 'sunce_jie_hunzi'))
        && !general.awakened && general.hp === 1) {
        general.awakened = true
        general.maxHp -= 1
        if (general.hp > general.maxHp) general.hp = general.maxHp
        general.acquiredSkills.push(general.generalId === 'sunce_jie' ? 'zhouyu_jie_yingzi' : 'zhouyu_yingzi', 'sunjian_yinghun')
        // 界孙策：觉醒回合的结束阶段可再选择摸两张或回复1点体力
        if (general.generalId === 'sunce_jie') general.hunziEndChoice = true
        addLog(state, `【${name}】发动【魂姿】觉醒！减1体力上限，获得【英姿】和【英魂】`)
    }

    // 英魂（孙坚）：准备阶段已受伤时→选一名其他角色+选模式（摸X弃1 / 摸1弃X，X=损失体力）
    if (hasSkillById(general, 'sunjian_yinghun') && general.hp < general.maxHp) {
        const others = state.generals.filter(g => g.alive && g !== general)
        if (others.length > 0) {
            const lostHp = general.maxHp - general.hp
            state.pendingResponseQueue.push({
                type: ResponseType.SKILL_YINGHUN_CHOOSE,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    lostHp,
                },
            })
        }
    }

    // ── 观星（诸葛亮）：准备阶段，观看牌堆顶X张（X=存活角色数，最多5），分配至牌堆顶/底
    if (hasSkillById(general, 'zhugeliang_guanxing') || general.acquiredSkills.includes('zhugeliang_guanxing')) {
        const alive = state.generals.filter(g => g.alive).length
        // 界诸葛亮/界姜维：观看5张（存活角色小于4时改为3张），其余为存活数
        const base = general.generalId === 'zhugeliang_jie' || general.generalId === 'jiangwei_jie'
            ? (alive < 4 ? 3 : 5)
            : Math.min(alive, 5)
        const count = Math.min(base, state.deck.length)
        if (count > 0) {
            const cards = state.deck.splice(0, count)
            // 暂存观星牌到 context 中
            state.pendingResponseQueue.push({
                type: ResponseType.SKILL_GUANXING_ARRANGE,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    guanxingCards: cards,
                },
            })
            addLog(state, `【${name}】发动【观星】，观看了${count}张牌`)
        }
    }

    // 替身（界张飞）：限定技，准备阶段可将体力回复至体力上限，摸以此法回复的体力值数张牌
    if (hasSkillById(general, 'zhangfei_tishen') && general.alive
        && general.hp < general.maxHp
        && !general.usedLimitedSkills.includes('zhangfei_tishen')) {
        const tsRecover = general.maxHp - general.hp
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(general),
            context: {
                skillId: 'zhangfei_tishen',
                skillName: '替身',
                description: `将体力回复至${general.maxHp}点，并摸${tsRecover}张牌`,
                tishenRecover: tsRecover,
            },
        })
        addLog(state, `【${name}】可发动【替身】`)
    }

    // 陷嗣①（刘封）：准备阶段，将至多两名角色的各一张牌置于你的武将牌上，称为“逆”
    if (hasSkillById(general, 'liufeng_xiansi')
        && state.generals.some(g => g.alive && g !== general
            && (g.hand.length > 0 || Object.values(g.equip).some(Boolean)))) {
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(general),
            context: {
                skillId: 'liufeng_xiansi',
                skillName: '陷嗣',
                description: '将至多两名角色的各一张牌置于你的武将牌上，称为“逆”',
            },
        })
        addLog(state, `【${name}】可发动【陷嗣】`)
    }

    // ── 如果准备阶段有待处理的技能（洛神/观星/英魂等），等待完成后再继续
    // 完成后由各响应 handler 中的 continueFromPrepPhase() 推进到判定阶段
    if (state.pendingResponseQueue.length > 0) {
        return
    }

    // ── 箜声（周妃）：准备阶段可将任意张牌置于武将牌上，结束阶段再处理
    if (hasSkillById(general, 'zhoufei_kongsheng') && general.hand.length > 0) {
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(general),
            context: {
                skillId: 'zhoufei_kongsheng',
                skillName: '箜声',
                description: '将任意张手牌置于武将牌上，本回合结束阶段使用其中的装备牌并获得其余的牌',
            },
        })
        return
    }

    // ── 神速（夏侯渊）：回合开始选择跳阶段视为杀
    if (hasSkillById(general, 'xiahouyuan_shensu') && !general.skillsUsedThisTurn.includes('xiahouyuan_shensu')) {
        if (general.generalId === 'xiahouyuan_jie') {
            state.pendingResponseQueue.push({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    skillId: 'xiahouyuan_shensu_jie',
                    skillName: '神速',
                    description: '选择至多三项跳过阶段，每项视为使用一张无距离限制的【杀】',
                    options: [
                        { action: 'one', label: '①跳过判定和摸牌阶段' },
                        { action: 'two', label: '②跳过出牌阶段并弃置一张装备牌' },
                        { action: 'three', label: '③跳过弃牌阶段并翻面' },
                        { action: 'one_two', label: '①②' },
                        { action: 'one_three', label: '①③' },
                        { action: 'two_three', label: '②③' },
                        { action: 'all', label: '①②③' },
                        { action: 'decline', label: '不发动' },
                    ],
                },
            })
            return
        }
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(general),
            context: {
                skillId: 'xiahouyuan_shensu_1',
                skillName: '神速一',
                description: '跳过判定和摸牌阶段，视为对一名角色使用一张杀',
            },
        })
        return // 等待响应，后续由 handler 继续推进回合
    }

    // 飞扬（斗地主地主技）：判定阶段开始时，若判定区有牌，可弃2张手牌再弃置判定区一张牌
    if (maybeFeiyang(state, general)) return

    // 勇略（韩浩史涣）：其他角色的判定阶段开始时，若其在攻击范围内，可弃其判定牌并视为使用【杀】
    if (triggerYonglueQueue(state, general)) return

    // 星卜（谯周）：准备阶段弃置一张手牌
    if (triggerXingbuPrepDiscard(state, general)) return
    // 知命（谯周）：准备阶段摸一张，然后可置顶一张
    if (triggerZhiming(state, general, 'prep')) return

    startJudgePhase(state)
}

/** 判定阶段主流程（勇略等技能的响应结束后由此恢复） */
export function startJudgePhase(state: GameState): void {
    const general = getActiveGeneral(state)
    if (!general) return
    state.turnPhase = TurnPhase.JUDGE
    // 贵相（族吴苋）：第 X 个阶段改为出牌阶段
    if (maybeGuixiang(state, general, 'judge')) return
    const { skipAction, skipDraw } = runJudgePhase(state, general)

    // 如果判定被鬼才/缓释中断 或 延时锦囊正在询问无懈可击，等待结算
    if ((state.pendingResponseQueue.length > 0 && state.pendingResponseQueue[0].type === ResponseType.JUDGE_INTERVENE)
        || state.negateWindow) {
        return
    }

    // ── 判定完毕，进入后续阶段
    finishJudgePhaseAndContinue(state, general, skipAction, skipDraw)
}

/** 从背面翻至正面时的触发（法恩 / 解围②） */
function triggerFrontFlipSkills(state: GameState, general: GeneralInstance): void {
    const nm = getGeneralName(general)
    for (const g of state.generals) {
        if (!g.alive || g === general) continue
        if (hasSkillById(g, 'chenqun_faen')) {
            state.pendingResponseQueue.push({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(g),
                context: {
                    skillId: 'chenqun_faen', skillName: '法恩',
                    description: `令【${nm}】摸一张牌`,
                    faenTargetIndex: state.generals.indexOf(general),
                    aiConfirm: true,
                },
            })
        }
    }
    if (hasSkillById(general, 'caoren_jiewei')) {
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(general),
            context: {
                skillId: 'caoren_jiewei_front', skillName: '解围',
                description: '弃置一张牌，然后移动场上的一张牌',
                aiConfirm: true,
            },
        })
    }
}

/** 摸牌（寸目：许攸改为从牌堆底摸） */
function drawForTurn(state: GameState, general: GeneralInstance, count: number): Card[] {
    // 星卜（谯周）：摸牌阶段多摸两张牌
    if ((general.drawPhaseBonus ?? 0) > 0) {
        count += general.drawPhaseBonus!
        general.drawPhaseBonus = 0
    }
    // 战神①（吕布-竞）：摸牌阶段多摸一张牌
    if (hasSkillById(general, 'lvbu_jing_zhanshen')
        && (general.zhanshenEffects ?? []).includes(1)) {
        count += 1
    }
    // 雅俊①（崔琰）：摸牌阶段多摸一张牌
    if (hasSkillById(general, 'cuiyan_yajun')) {
        count += 1
    }
    if (!hasSkillById(general, 'xuyou_cunmu') || state.deck.length === 0) {
        return drawCards(state, count)
    }
    const drawn: Card[] = []
    for (let i = 0; i < count && state.deck.length > 0; i++) {
        drawn.push(state.deck.pop()!)
    }
    noteDeckDraws(state, drawn)
    return drawn
}

/**
 * 判定阶段全部完成后，继续推进摸牌→出牌→弃牌。
 * 被 startTurn、continueJudgePhase、continueDelayedTrickJudge 调用。
 */
export function finishJudgePhaseAndContinue(
    state: GameState,
    general: GeneralInstance,
    skipAction: boolean,
    skipDraw: boolean,
): void {
    const name = getGeneralName(general)

    // 泥首（屈晃）：本阶段结束，执行待结算的手牌交换
    resolveNishouSwaps(state)
    // 逐日（谋姜维）：判定阶段结束时手牌数变化则拼点
    maybeZhuri(state, general)

    // ── 摸牌阶段
    if (!skipDraw) {
        state.turnPhase = TurnPhase.DRAW
        // 贵相（族吴苋）：第 X 个阶段改为出牌阶段
        if (maybeGuixiang(state, general, 'draw')) return
        // 屯储（李丰）：摸牌阶段，武将牌上没有“粮”时可多摸两张
        triggerTunchu(state, general)

        // 宽释（阚泽）：被保护者受到伤害后，施加者跳过其下个摸牌阶段
        if (general.skipDrawNextTurn) {
            general.skipDrawNextTurn = false
            addLog(state, `【${name}】因【宽释】跳过摸牌阶段`)
            beginActionPhase(state, general)
            return
        }

        // 巧变（张郃）：摸牌阶段入口询问是否弃一张手牌跳过摸牌阶段
        if (maybeQiaobian(state, general, 'draw', { qiaobianSkipAction: skipAction })) return

        // 奋励（朱桓）：手牌数为全场最多，可跳过摸牌阶段
        if (hasSkillById(general, 'zhuhuan_fenli')
            && !general.skillsUsedThisTurn.includes('zhuhuan_fenli_draw')
            && isHandMaxOverall(state, general)) {
            general.skillsUsedThisTurn.push('zhuhuan_fenli_draw')
            state.pendingResponseQueue.push({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    skillId: 'zhuhuan_fenli_draw',
                    skillName: '奋励',
                    description: '你的手牌数为全场最多：跳过摸牌阶段？',
                    fenliSkipAction: skipAction,
                },
            })
            addLog(state, `【${name}】可发动【奋励】跳过摸牌阶段`)
            return
        }

        // 整论（陆绩）：没有“橘”时可跳过摸牌阶段获得1个“橘”
        if (hasSkillById(general, 'luji_zhenglun') && (general.orangeMarks ?? 0) === 0) {
            state.pendingResponseQueue.push({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    skillId: 'luji_zhenglun',
                    skillName: '整论',
                    description: '跳过摸牌阶段，获得1个“橘”',
                },
            })
            return
        }

        // 眩惑（法正）：改为令一名其他角色摸两张牌
        if (hasSkillById(general, 'fazheng_xuanhuo') && state.deck.length >= 2
            && state.generals.some(g => g.alive && g !== general)) {
            state.pendingResponseQueue.push({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    skillId: 'fazheng_xuanhuo',
                    skillName: '眩惑',
                    description: '令一名其他角色摸两张牌，并选择其攻击范围内的一名角色：其对其使用【杀】，或令你获得其两张牌',
                },
            })
            return
        }

        // 好施（鲁肃 / 界鲁肃）：多摸两张，若手牌大于5则将一半交给手牌最少的其他角色
        const haoshiId = hasSkillById(general, 'lusu_jie_haoshi') ? 'lusu_jie_haoshi'
            : hasSkillById(general, 'lusu_haoshi') ? 'lusu_haoshi' : undefined
        if (haoshiId) {
            state.pendingResponseQueue.push({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    skillId: haoshiId,
                    skillName: '好施',
                    description: '多摸两张牌；若手牌大于5，将一半（向下取整）交给手牌最少的一名其他角色',
                    skipAction,
                    aiConfirm: true,
                },
            })
            return
        }

        // 弘援（诸葛瑾-竞）：摸牌阶段少摸一张，令至多两名其他角色各摸一张
        if (hasSkillById(general, 'zhugejin_jing_hongyuan')) {
            state.pendingResponseQueue.push({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    skillId: 'zhugejin_jing_hongyuan',
                    skillName: '弘援',
                    description: '少摸一张牌，令至多两名其他角色各摸一张牌',
                    skipAction,
                },
            })
            addLog(state, `【${name}】可发动【弘援】`)
            return
        }

        // 裸衣（界许褚）：亮出牌堆顶三张，获得其中的基本牌/武器牌/【决斗】并放弃摸牌
        if (hasSkillById(general, 'xuchu_jie_luoyi') && state.deck.length > 0) {
            state.pendingResponseQueue.push({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    skillId: 'xuchu_jie_luoyi',
                    skillName: '裸衣',
                    description: '亮出牌堆顶三张，获得其中的基本牌/武器牌/【决斗】并放弃摸牌，本回合【杀】和【决斗】伤害+1',
                },
            })
            return
        }

        // 袭爵（张虎乐綝）：移去1个“爵”，发动一次【突袭】
        if (hasSkillById(general, 'zhanghulelin_xijue') && (general.jueMarks ?? 0) > 0
            && state.generals.some(g => g.alive && g !== general && g.hand.length > 0)) {
            state.pendingResponseQueue.push({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    skillId: 'zhangliao_tuxi',
                    skillName: '袭爵·突袭',
                    description: `移去1个“爵”（共${general.jueMarks}个），代替摸牌，获取至多2名其他角色的各一张手牌`,
                    skipAction,
                    xijueCost: true,
                    targetSelectOnActivate: true,
                    maxTargets: 2,
                },
            })
            return
        }

        if (hasSkillById(general, 'zhangliao_tuxi')
            || hasSkillById(general, 'zhanghulelin_tuxi')) {
            const oppWithCards = state.generals.filter(
                g => g.alive && g.faction !== general.faction && g.hand.length > 0
            )
            if (oppWithCards.length > 0) {
                state.pendingResponseQueue.push({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: state.generals.indexOf(general),
                    context: {
                        skillId: 'zhangliao_tuxi',
                        skillName: '突袭',
                        description: general.generalId === 'zhangliao'
                            ? '放弃摸牌，获得至多两名角色的各一张手牌'
                            : '少摸任意张牌，然后获得等量名其他角色的各一张手牌',
                        skipAction,
                        targetSelectOnActivate: true,
                        maxTargets: 2,
                    },
                })
                return
            } else {
                const drawn = drawForTurn(state, general, 2)
                general.hand.push(...drawn)
                addLog(state, `【${name}】摸了 ${drawn.length} 张牌`)
            }
        } else if (hasSkillById(general, 'lidian_xunxun') && state.deck.length > 0) {
            state.pendingResponseQueue.push({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    skillId: 'lidian_xunxun',
                    skillName: '恂恂',
                    description: '观看牌堆顶四张牌，将其中两张任意顺序置于牌堆顶，其余置于牌堆底',
                    skipAction,
                },
            })
            return
        } else {
            let drawCount = 2
            if (hasYingziSkill(general)) {
                drawCount = 3
            }
            // 劫营（神甘宁）：持有“营”时摸牌阶段多摸一张
            if (general.yingMark) drawCount += 1
            // 督粮（李严）：其下个回合摸牌阶段多摸一张
            if (general.duliangDrawBonus) {
                general.duliangDrawBonus = false
                drawCount += 1
            }

            const drawn = drawForTurn(state, general, drawCount)
            general.hand.push(...drawn)
            // 雅俊②（崔琰）：出牌阶段开始时只能用“本回合获得的牌”拼点，摸牌阶段到手的牌当场记下
            general.gainedCardIdsThisTurn = [
                ...(general.gainedCardIdsThisTurn ?? []), ...drawn.map(c => c.id),
            ]
            addLog(state, `【${name}】摸了 ${drawn.length} 张牌${drawCount > 2 ? '（英姿+1）' : ''}`)
            maybeHongyuan(state, general, drawn.length)
        }
    }

    // 将驰（界曹彰）：摸牌阶段结束时，选择一项
    if (hasSkillById(general, 'caozhang_jiangchi')
        && !general.skillsUsedThisTurn.includes('caozhang_jiangchi')) {
        general.skillsUsedThisTurn.push('caozhang_jiangchi')
        const jcOptions: { action: string; label: string }[] = [
            { action: 'draw', label: '①摸一张牌，本回合【杀】次数上限-1且【杀】不计入手牌上限' },
        ]
        if (general.hand.length > 0) {
            jcOptions.push({ action: 'recast', label: '②重铸一张牌，本回合使用【杀】无距离限制且次数上限+1' })
        }
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(general),
            context: {
                skillId: 'caozhang_jiangchi',
                skillName: '将驰',
                description: '选择一项',
                options: jcOptions,
                skipAction,
            },
        })
        addLog(state, `【${name}】可发动【将驰】`)
        return
    }

    // 双雄①（界颜良文丑）：摸牌阶段结束时，可弃置一张牌，本回合与其颜色不同的牌可当【决斗】
    if (hasSkillById(general, 'yanliang_shuangxiong') && general.hand.length > 0) {
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(general),
            context: {
                skillId: 'yanliang_shuangxiong',
                skillName: '双雄',
                description: '弃置一张牌，本回合与弃置牌颜色不同的手牌可当【决斗】使用',
                skipAction,
                aiConfirm: true,
            },
        })
        return
    }

    // ── 出牌阶段 / 直接弃牌
    if (!skipAction) {
        beginActionPhase(state, general)
    } else {
        if (maybeSkipDiscardPhase(state, general)) return
        enterDiscardPhase(state, general)
        if (general.hand.length <= getHandLimit(general)) {
            finishTurn(state)
        }
    }
}


/** 恂恂结算完成后继续摸牌阶段（正常摸牌并进入出牌/弃牌阶段） */
export function finishDrawPhaseAfterXunxun(
    state: GameState,
    general: GeneralInstance,
    skipAction: boolean,
): void {
    const drawCount = hasYingziSkill(general) ? 3 : 2
    const drawn = drawForTurn(state, general, drawCount)
    general.hand.push(...drawn)
    // 雅俊②（崔琰）：同上，摸牌阶段到手的牌当场记为“本回合获得的牌”
    general.gainedCardIdsThisTurn = [
        ...(general.gainedCardIdsThisTurn ?? []), ...drawn.map(c => c.id),
    ]
    addLog(state, `【${getGeneralName(general)}】摸了 ${drawn.length} 张牌`)
    if (!skipAction) {
        beginActionPhase(state, general)
        return
    }
    if (maybeSkipDiscardPhase(state, general)) return
    enterDiscardPhase(state, general)
    if (general.hand.length <= getHandLimit(general)) finishTurn(state)
}

const DUFENG_SLOTS = [EquipSlot.WEAPON, EquipSlot.ARMOR, EquipSlot.PLUS_HORSE, EquipSlot.MINUS_HORSE] as const
const DUFENG_SLOT_NAMES: Record<string, string> = {
    weapon: '武器', armor: '防具', plus_horse: '+1马', minus_horse: '-1马',
}

/** 独锋（凌操）：结算失去1点体力或废除一个装备栏，然后摸X张牌 */
export function resolveDufeng(
    state: GameState,
    general: GeneralInstance,
    choice: 'loseHp' | 'abolish',
    slot?: EquipSlot,
): void {
    if (choice === 'abolish') {
        const available = DUFENG_SLOTS.filter(s => !(general.abolishedSlots ?? []).includes(s))
        const target = slot && (available as EquipSlot[]).includes(slot) ? slot : available[0]
        if (target) {
            general.abolishedSlots = [...(general.abolishedSlots ?? []), target]
            const card = general.equip[target]
            if (card) {
                general.equip[target] = undefined
                state.discard.push(card)
            }
            addLog(state, `【${getGeneralName(general)}】【独锋】废除${DUFENG_SLOT_NAMES[target] ?? ''}装备栏`)
        }
    } else {
        general.hp -= 1
        addLog(state, `【${getGeneralName(general)}】发动【独锋】，失去1点体力`)
    }
    const x = Math.min(general.maxHp,
        (general.maxHp - general.hp) + (general.abolishedSlots?.length ?? 0))
    if (x > 0) {
        const drawn = drawCards(state, x)
        general.hand.push(...drawn)
        general.dufengBonus = Math.max(0, x - 1)
        addLog(state, `【${getGeneralName(general)}】【独锋】摸了 ${drawn.length} 张牌，本阶段攻击范围与【杀】次数上限+${general.dufengBonus}`)
    }
}

/** 进入出牌阶段（独锋等“出牌阶段开始时”技能在此结算） */
export function beginActionPhase(state: GameState, general: GeneralInstance): void {
    // 界刘备：仁德按“本阶段”统计受牌者与第二张奖励
    if (hasSkillById(general, 'liubei_jie_rende')) {
        general.rendeGivenThisTurn = 0
        general.rendeReceivedThisPhase = []
        general.rendeSecondGivenThisTurn = false
    }
    // 贵相（族吴苋）：出牌阶段计入本回合的阶段数
    maybeGuixiang(state, general, 'action')
    // 泥首（屈晃）：本阶段结束，执行待结算的手牌交换
    resolveNishouSwaps(state)
    // 逐日（谋姜维）：摸牌阶段结束时手牌数变化则拼点
    maybeZhuri(state, general)
    // 奋励（朱桓）：体力值为全场最多，可跳过出牌阶段
    if (hasSkillById(general, 'zhuhuan_fenli')
        && !general.skillsUsedThisTurn.includes('zhuhuan_fenli_action')
        && isHpMaxOverall(state, general)) {
        general.skillsUsedThisTurn.push('zhuhuan_fenli_action')
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(general),
            context: {
                skillId: 'zhuhuan_fenli_action',
                skillName: '奋励',
                description: '你的体力值为全场最多：跳过出牌阶段？',
            },
        })
        addLog(state, `【${getGeneralName(general)}】可发动【奋励】跳过出牌阶段`)
        return
    }

    // 怀橘（陆绩）：有“橘”的角色摸牌阶段多摸一张（各摸牌分支统一在此补发）
    if (state.turnPhase === TurnPhase.DRAW && (general.orangeMarks ?? 0) > 0) {
        const bonus = drawCards(state, 1)
        general.hand.push(...bonus)
        addLog(state, `【${getGeneralName(general)}】的“橘”使其摸牌阶段多摸${bonus.length}张牌`)
    }

    // 巧变（张郃）：出牌阶段入口询问是否弃一张手牌跳过出牌阶段
    if (maybeQiaobian(state, general, 'action')) return

    state.turnPhase = TurnPhase.ACTION
    state.damageThisActionPhase = 0
    general.infiniteRangePhase = false

    // 清忠（鲁芝）：出牌阶段开始时，可摸两张牌，本阶段结束时与手牌数最少的角色交换手牌
    if (hasSkillById(general, 'luzhi_qingzhong')) {
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(general),
            context: {
                skillId: 'luzhi_qingzhong', skillName: '清忠',
                description: '摸两张牌，然后本阶段结束时与手牌数最少的角色交换手牌',
            },
        })
        addLog(state, `【${getGeneralName(general)}】可发动【清忠】`)
    }

    // 决讨（曹髦）：限定技，出牌阶段开始时，若体力值为1，可依次使用牌堆底的牌
    if (hasSkillById(general, 'caomao_juetao') && general.hp === 1
        && !general.usedLimitedSkills.includes('caomao_juetao')
        && state.deck.length > 0
        && state.generals.some(g => g.alive && g !== general)) {
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(general),
            context: {
                skillId: 'caomao_juetao',
                skillName: '决讨',
                description: '选择一名角色，依次使用牌堆底的牌直到不能使用为止（只能指定你或该角色为目标）',
                juetaoCandidates: state.generals
                    .map((g, idx) => ({ g, idx }))
                    .filter(({ g, idx }) => g.alive && idx !== state.generals.indexOf(general))
                    .map(({ idx }) => idx),
            },
        })
        addLog(state, `【${getGeneralName(general)}】可发动【决讨】`)
    }

    // 清正（界曹操）/ 下书（阚泽）：出牌阶段开始时
    triggerQingzheng(state, general)
    triggerXiashu(state, general)
    // 洛书版扩展（九）：出牌阶段开始时的技能
    general.zhixiPhase = false
    general.meibuZhixi = false
    general.meibuSeat = undefined
    general.mumuNoSlashPhase = false
    general.shanjiaNoRangePhase = false
    general.guanweiSuits = []
    general.cardsUsedPhaseCount = 0
    triggerZhendu(state, general)
    triggerMeibu(state, general)
    triggerMumu(state, general)
    triggerShanjia(state, general)
    // 洛书版扩展（五）：出牌阶段级状态重置
    general.paiyiUsesPhase = 0
    general.paiyiLimitPhase = 1
    general.danshouItems = []
    general.qiangshiCategory = undefined

    // 新增武将（田畴 / 高览 / 崔琰）：出牌阶段级状态重置
    general.shandaoUsedPhase = false
    general.zundiUsedPhase = false
    general.cuiyanYajunUsedPhase = false
    // 峻攻：X 按“本阶段此前发动次数 +1”计算，阶段切换时清零
    general.jungongCount = 0

    // 雅俊②（崔琰）：出牌阶段开始时，可用一张本回合获得的牌与一名其他角色拼点
    if (hasSkillById(general, 'cuiyan_yajun') && !general.cuiyanYajunUsedPhase) {
        const yajunGained = new Set(general.gainedCardIdsThisTurn ?? [])
        const hasGainedCard = general.hand.some(c => yajunGained.has(c.id))
        const hasOpponent = state.generals.some(g => g.alive && g !== general && g.hand.length > 0)
        if (hasGainedCard && hasOpponent) {
            general.cuiyanYajunUsedPhase = true
            state.pendingResponseQueue.push({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    skillId: 'cuiyan_yajun',
                    skillName: '雅俊',
                    description: '用一张本回合获得的牌与一名其他角色拼点：赢则可将一张拼点牌置于牌堆顶；没赢则本回合手牌上限-1',
                },
            })
            addLog(state, `【${getGeneralName(general)}】可发动【雅俊】拼点`)
        }
    }

    // 强识（界张松）：出牌阶段开始时，观看一名其他角色的手牌并展示其中一张
    if (hasSkillById(general, 'zhangsong_qiangshi')
        && !general.skillsUsedThisTurn.includes('zhangsong_qiangshi')
        && state.generals.some(g => g.alive && g !== general && g.hand.length > 0)) {
        general.skillsUsedThisTurn.push('zhangsong_qiangshi')
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(general),
            context: {
                skillId: 'zhangsong_qiangshi',
                skillName: '强识',
                description: '观看一名其他角色的手牌并展示其中一张牌，本阶段你使用此类别的牌后可摸一张牌',
            },
        })
        addLog(state, `【${getGeneralName(general)}】可发动【强识】`)
    }

    // 献图（界张松）：其他角色出牌阶段开始时，摸至多两张牌然后交给其等量牌
    for (const xs of state.generals) {
        if (!xs.alive || xs === general) continue
        if (!hasSkillById(xs, 'zhangsong_xiantu')) continue
        if (xs.xiantuTurn === state.turnSerial) continue
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(xs),
            context: {
                skillId: 'zhangsong_xiantu',
                skillName: '献图',
                description: `摸至多两张牌，然后交给【${getGeneralName(general)}】等量牌；此阶段结束时若其造成的伤害小于你交给的牌数，你失去1点体力`,
                options: [
                    { action: 'one', label: '摸一张牌，交给其一张牌' },
                    { action: 'two', label: '摸两张牌，交给其两张牌' },
                ],
                xiantuTargetIndex: state.generals.indexOf(general),
            },
        })
        addLog(state, `【${getGeneralName(xs)}】可发动【献图】`)
    }

    // 献珠（李肃）：锁定技，出牌阶段开始时，令一名角色获得“珠”
    if (hasSkillById(general, 'lisu_xianzhu')
        && !general.skillsUsedThisTurn.includes('lisu_xianzhu')) {
        general.skillsUsedThisTurn.push('lisu_xianzhu')
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_CHOOSE_TARGET,
            targetGeneralIndex: state.generals.indexOf(general),
            context: {
                skillId: 'lisu_xianzhu',
                skillName: '献珠',
                description: '令一名角色获得“珠”（若不是你，其视为对你攻击范围内你指定的一名角色使用一张【杀】）',
                candidateIndices: state.generals
                    .map((g, idx) => ({ g, idx }))
                    .filter(({ g }) => g.alive)
                    .map(({ idx }) => idx),
            },
        })
        addLog(state, `【${getGeneralName(general)}】【献珠】：令一名角色获得“珠”`)
        return
    }

    // 遗礼（陆绩）：出牌阶段开始时，失去1点体力或移去1个“橘”，令一名其他角色获得“橘”
    if (hasSkillById(general, 'luji_yili')) {
        const yiliOptions: { action: string; label: string }[] = []
        if (general.hp > 1) yiliOptions.push({ action: 'loseHp', label: '失去 1 点体力' })
        if ((general.orangeMarks ?? 0) > 0) yiliOptions.push({ action: 'orange', label: '移去 1 个“橘”' })
        if (yiliOptions.length > 0 && state.generals.some(g => g.alive && g !== general)) {
            state.pendingResponseQueue.push({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    skillId: 'luji_yili',
                    skillName: '遗礼',
                    description: '失去1点体力或移去1个“橘”，令一名其他角色获得“橘”',
                    options: yiliOptions,
                },
            })
            addLog(state, `【${getGeneralName(general)}】可发动【遗礼】`)
        }
    }

    // 急攻（郭图逢纪）：出牌阶段开始时，可摸两张牌，本回合手牌上限等于本阶段造成的伤害
    if (hasSkillById(general, 'guotu_jigong')) {
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(general),
            context: {
                skillId: 'guotu_jigong',
                skillName: '急攻',
                description: '摸两张牌，然后本回合手牌上限等于你本阶段造成的伤害值',
            },
        })
        addLog(state, `【${getGeneralName(general)}】可发动【急攻】`)
    }

    // 独锋（凌操）：由玩家选择失去1点体力或废除一个装备栏
    if (hasSkillById(general, 'lingcao_dufeng')) {
        const available = DUFENG_SLOTS.filter(s => !(general.abolishedSlots ?? []).includes(s))
        if (available.length > 0 && general.hp > 1) {
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_DUFENG_CHOICE,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    candidateSlots: available,
                    description: '选择一项：失去1点体力，或废除一个装备栏',
                },
            })
            addLog(state, `【${getGeneralName(general)}】【独锋】：选择失去1点体力或废除一个装备栏`)
            return
        }
        // 无可用栏位或体力不足时只能废除（无栏位可废除时不改变状态）
        resolveDufeng(state, general, 'abolish')
    }

    if (hasSkillById(general, 'xiahouyuan_shensu') && !general.skillsUsedThisTurn.includes('xiahouyuan_shensu')) {
        const hasEquip = general.equip.weapon || general.equip.armor || general.equip.plus_horse || general.equip.minus_horse
        const hasHandEquip = general.hand.some(c => c.category === CardCategory.EQUIPMENT)
        if (hasEquip || hasHandEquip) {
            state.pendingResponseQueue.push({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    skillId: 'xiahouyuan_shensu_2',
                    skillName: '神速二',
                    description: '跳过出牌阶段并弃一张装备牌，视为对一名角色使用一张杀',
                },
            })
        }
    }
}
/**
 * 从判定阶段开始继续执行回合（用于神速等跳阶段技能）
 * @param skipJudge 是否跳过判定阶段
 * @param skipDraw 是否跳过摸牌阶段
 * @param skipAction 是否跳过出牌阶段
 */
export function continueTurnFromJudge(
    state: GameState,
    skipJudge: boolean,
    extraSkipDraw: boolean,
    extraSkipAction: boolean,
): void {
    const general = getActiveGeneral(state)
    if (!general) return

    let skipAction = extraSkipAction
    let skipDraw = extraSkipDraw

    // 巧变（张郃）：判定阶段入口询问是否弃一张手牌跳过判定阶段
    if (!skipJudge && maybeQiaobian(state, general, 'judge', { qiaobianSkipAction: skipAction })) {
        return
    }

    // 飞扬（斗地主地主技）：判定阶段开始时弃2张手牌弃置判定区一张牌
    if (!skipJudge && maybeFeiyang(state, general)) return

    // ── 判定阶段
    if (!skipJudge) {
        state.turnPhase = TurnPhase.JUDGE
        const judgeResult = runJudgePhase(state, general)

        if ((state.pendingResponseQueue.length > 0 && state.pendingResponseQueue[0].type === ResponseType.JUDGE_INTERVENE)
            || state.negateWindow) {
            return
        }

        if (judgeResult.skipAction) skipAction = true
        if (judgeResult.skipDraw) skipDraw = true
    }

    finishJudgePhaseAndContinue(state, general, skipAction, skipDraw)
}

/**
 * 准备阶段技能全部完成后，继续推进回合到判定阶段。
 * 由各准备阶段响应 handler（观星、洛神、英魂等）在 shift() 后调用。
 */
/**
 * 巧变（张郃）：各阶段入口询问“弃一张手牌跳过该阶段”。
 * @returns true 表示已压入询问，调用方应直接返回等待响应
 */
function maybeQiaobian(
    state: GameState,
    general: GeneralInstance,
    phase: 'judge' | 'draw' | 'action' | 'discard',
    extra: Record<string, unknown> = {},
): boolean {
    if (!hasSkillById(general, 'zhanghe_qiaobian')) return false
    if (general.hand.length === 0) return false
    const key = `zhanghe_qiaobian_${phase}`
    if (general.skillsUsedThisTurn.includes(key)) return false
    general.skillsUsedThisTurn.push(key)
    const label = phase === 'judge' ? '判定'
        : phase === 'draw' ? '摸牌'
            : phase === 'action' ? '出牌' : '弃牌'
    const reward = phase === 'draw' ? '，并获得至多两名角色的各一张手牌'
        : phase === 'action' ? '，并移动场上的一张牌'
            : ''
    state.pendingResponseQueue.push({
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: state.generals.indexOf(general),
        context: {
            skillId: 'zhanghe_qiaobian',
            skillName: '巧变',
            description: `弃置一张手牌，跳过${label}阶段${reward}`,
            qiaobianPhase: phase,
            ...extra,
        },
    })
    addLog(state, `【${getGeneralName(general)}】可发动【巧变】跳过${label}阶段`)
    return true
}

/**
 * 知命（谯周）：准备阶段或弃牌阶段结束时摸一张牌，然后可将一张牌置于牌堆顶。
 * 返回 true 表示已入队“置顶”询问，当前流程需等待响应。
 */
function triggerZhiming(
    state: GameState,
    general: GeneralInstance,
    timing: 'prep' | 'discard',
): boolean {
    if (!general.alive || !hasSkillById(general, 'qiaozhou_zhiming')) return false
    const key = `qiaozhou_zhiming_${timing}`
    if (general.skillsUsedThisTurn.includes(key)) return false
    general.skillsUsedThisTurn.push(key)
    const drawn = drawCards(state, 1)
    general.hand.push(...drawn)
    addLog(state, `【${getGeneralName(general)}】发动【知命】，摸${drawn.length}张牌`)
    if (general.hand.length === 0) return false
    state.pendingResponseQueue.push({
        type: ResponseType.SKILL_PICK_CARD,
        targetGeneralIndex: state.generals.indexOf(general),
        context: {
            skillId: 'qiaozhou_zhiming_top', skillName: '知命',
            description: '你可以将一张手牌置于牌堆顶（不选则放弃）',
            count: 1, mode: 'top', optional: true, zhimingTiming: timing,
        },
    })
    return true
}

/** 星卜（谯周）不大于1：准备阶段弃置一张手牌 */
function triggerXingbuPrepDiscard(state: GameState, general: GeneralInstance): boolean {
    if ((general.prepDiscardPending ?? 0) <= 0) return false
    general.prepDiscardPending = 0
    addLog(state, `【${getGeneralName(general)}】的【星卜】生效：弃置一张手牌`)
    if (general.hand.length === 0) return false
    state.pendingResponseQueue.push({
        type: ResponseType.SKILL_PICK_CARD,
        targetGeneralIndex: state.generals.indexOf(general),
        context: {
            skillId: 'qiaozhou_xingbu_discard', skillName: '星卜',
            description: '弃置一张手牌', count: 1, mode: 'discard',
        },
    })
    return true
}

export function continueFromPrepPhase(state: GameState): void {
    // 队列中还有其他准备阶段技能待处理，不推进
    if (state.pendingResponseQueue.length > 0) return
    // 只在准备阶段调用此函数
    if (state.turnPhase !== TurnPhase.TURN_START) return

    const general = getActiveGeneral(state)
    if (!general) return

    // 星卜（谯周）：准备阶段弃置一张手牌
    if (triggerXingbuPrepDiscard(state, general)) return
    // 知命（谯周）：准备阶段摸一张，然后可置顶一张
    if (triggerZhiming(state, general, 'prep')) return

    // 神速（夏侯渊）：准备阶段技能结束后，仍需询问神速
    if (hasSkillById(general, 'xiahouyuan_shensu') && !general.skillsUsedThisTurn.includes('xiahouyuan_shensu')) {
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(general),
            context: {
                skillId: 'xiahouyuan_shensu_1',
                skillName: '神速一',
                description: '跳过判定和摸牌阶段，视为对一名角色使用一张杀',
            },
        })
        return // 等待神速响应，后续由 handler 继续推进回合
    }

    // 直接进入判定阶段
    continueTurnFromJudge(state, false, false, false)
}

/** 判定阶段：处理判定区延时锦囊（后放先判）
 * 如果有鬼才/缓释可介入，会设置 PendingResponse 中断流程，
 * 后续由 continueJudgePhase 继续结算。
 */
function runJudgePhase(
    state: GameState,
    general: GeneralInstance
): { skipAction: boolean; skipDraw: boolean } {
    if (general.judgeZone.length === 0) return { skipAction: false, skipDraw: false }

    const toJudge = [...general.judgeZone].reverse()
    return processNextJudge(state, general, toJudge, 0, false, false)
}

/** 处理一张延时锦囊的判定（递归逻辑拆分，支持中断+继续） */
function processNextJudge(
    state: GameState,
    general: GeneralInstance,
    toJudge: Card[],
    judgeIndex: number,
    skipAction: boolean,
    skipDraw: boolean,
): { skipAction: boolean; skipDraw: boolean } {
    if (judgeIndex >= toJudge.length) return { skipAction, skipDraw }
    // 牌堆用尽时洗回弃牌堆；实在无牌可判就清掉剩余延时锦囊，避免判定阶段无提示卡死
    if (!ensureDeck(state)) {
        for (let i = judgeIndex; i < toJudge.length; i++) {
            const remaining = toJudge[i]
            if (general.judgeZone.some(c => c.id === remaining.id)) {
                general.judgeZone = general.judgeZone.filter(c => c.id !== remaining.id)
                state.discard.push(remaining)
            }
        }
        addLog(state, '牌堆与弃牌堆都没有牌，剩余的延时锦囊不再判定')
        return { skipAction, skipDraw }
    }

    const card = toJudge[judgeIndex]
    const name = getGeneralName(general)
    const gIdx = state.generals.indexOf(general)

    // ── 延时锦囊判定前，询问无懈可击 ──
    const hasNegate = anyoneHasNegate(state)
    state.negateWindow = {
        trickCardName: card.name,
        trickUserIndex: -1, // 延时锦囊没有"使用者"
        trickTargetIndex: gIdx,
        trickTargetName: name,
        isCurrentlyNegated: false,
        hasFollowUpResponse: false,
        passedPlayerIds: [],
        startedAt: Date.now(),
        anyoneHasNegate: hasNegate,
        delayedTrickJudgeContext: {
            judgingGeneralIndex: gIdx,
            delayedTrickCardId: card.id,
            toJudgeCardIds: toJudge.map(c => c.id),
            currentJudgeIndex: judgeIndex,
            skipAction,
            skipDraw,
        },
    }
    addLog(state, `【${name}】的${cardFullName(card)}即将判定，询问无懈可击...`)
    return { skipAction, skipDraw } // 暂时返回，由 resolveNegateWindow 继续
}

/**
 * 延时锦囊无懈结算后，继续判定流程。
 * negated=true → 锦囊被无懈，跳过判定，移除该锦囊
 * negated=false → 锦囊未被无懈，正常翻牌判定
 */
export function continueDelayedTrickJudge(
    state: GameState,
    ctx: NonNullable<import('sgs3v3-shared').NegateWindow['delayedTrickJudgeContext']>,
    negated: boolean,
): void {
    const general = state.generals[ctx.judgingGeneralIndex]
    if (!general) return

    const toJudge = ctx.toJudgeCardIds
        .map(id => general.judgeZone.find(c => c.id === id))
        .filter((c): c is Card => c != null)

    const card = toJudge[ctx.currentJudgeIndex]
    if (!card) return

    let { skipAction, skipDraw } = ctx

    if (negated) {
        // 锦囊被无懈 → 移除该延时锦囊，不执行判定
        addLog(state, `${cardFullName(card)}对【${getGeneralName(general)}】的效果被无懈可击抵消`)
        general.judgeZone = general.judgeZone.filter(c => c.id !== card.id)
        state.discard.push(card)
    } else {
        // 锦囊未被无懈 → 正常翻牌判定
        if (!ensureDeck(state)) {
            finishJudgePhaseAndContinue(state, general, skipAction, skipDraw)
            return
        }

        const judgeCard = state.deck.shift()!
        state.discard.push(judgeCard)
        const name = getGeneralName(general)
        addLog(state, `【${name}】的${cardFullName(card)}判定：${cardFullName(judgeCard)}`)

        // 检查是否有鬼才/缓释可介入
        const intervenor = findJudgeIntervenor(state, general)
        if (intervenor) {
            const huanshiOwnerIndex = hasSkillById(intervenor, 'zhugejin_huanshi')
                ? state.generals.indexOf(intervenor) : undefined
            state.pendingResponseQueue.unshift({
                type: ResponseType.JUDGE_INTERVENE,
                targetGeneralIndex: huanshiOwnerIndex !== undefined
                    ? state.generals.indexOf(general)
                    : state.generals.indexOf(intervenor),
                context: {
                    judgingGeneralIndex: ctx.judgingGeneralIndex,
                    judgeCardId: judgeCard.id,
                    judgeCard,
                    delayedTrickCardId: card.id,
                    delayedTrickName: card.name,
                    toJudgeCardIds: ctx.toJudgeCardIds,
                    currentJudgeIndex: ctx.currentJudgeIndex,
                    skipAction,
                    skipDraw,
                    huanshiOwnerIndex,
                },
            })
            addLog(state, `【${getGeneralName(intervenor)}】可发动【${judgeInterveneSkillName(intervenor)}】修改判定`)
            return // 等待介入结果
        }

        // 无人介入 → 直接结算
        const result = resolveJudge(state, general, card, judgeCard, skipAction, skipDraw)
        skipAction = result.skipAction
        skipDraw = result.skipDraw
    }

    // 继续下一张延时锦囊
    // 从原始列表中取当前索引之后的牌ID，再从judgeZone中查找仍存在的牌
    const nextCardIds = ctx.toJudgeCardIds.slice(ctx.currentJudgeIndex + 1)
    const nextToJudge = nextCardIds
        .map(id => general.judgeZone.find(c => c.id === id))
        .filter((c): c is Card => c != null)

    if (nextToJudge.length > 0) {
        // 还有下一张延时锦囊，递归调用 processNextJudge 开新的无懈窗口
        processNextJudge(state, general, nextToJudge, 0, skipAction, skipDraw)
    } else {
        // 所有延时锦囊处理完毕，进入后续阶段
        finishJudgePhaseAndContinue(state, general, skipAction, skipDraw)
    }
}

/** 从 idx 之后（不含）按座次找下一个存活角色 */
function nextAliveAfter(state: GameState, idx: number): GeneralInstance | undefined {
    const n = state.generals.length
    for (let step = 1; step < n; step++) {
        const g = state.generals[(idx + step) % n]
        if (g?.alive) return g
    }
    return undefined
}

/** 结算一张延时锦囊的判定效果 */
function resolveJudge(
    state: GameState,
    general: GeneralInstance,
    delayedCard: Card,
    judgeCard: Card,
    skipAction: boolean,
    skipDraw: boolean,
): { skipAction: boolean; skipDraw: boolean } {
    const isHeart = judgeCard.suit === CardSuit.HEART
    const isClub = judgeCard.suit === CardSuit.CLUB
    const name = getGeneralName(general)

    if (delayedCard.name === TrickCardName.OVERINDULGENCE) {
        if (!isHeart) {
            addLog(state, `【${name}】乐不思蜀生效，跳过出牌阶段`)
            skipAction = true
        } else {
            addLog(state, `【${name}】乐不思蜀判定♥，解除`)
        }
        general.judgeZone = general.judgeZone.filter(c => c.id !== delayedCard.id)
        state.discard.push(delayedCard)
        checkTiandu(state, general, judgeCard)
    } else if (delayedCard.name === TrickCardName.SUPPLY_SHORTAGE) {
        if (!isClub) {
            addLog(state, `【${name}】兵粮寸断生效，跳过摸牌阶段`)
            // 截輜（界徐晃）：其他角色跳过摸牌阶段后，你摸一张
            for (const jzOwner of state.generals) {
                if (!jzOwner.alive || jzOwner === general) continue
                if (!hasSkillById(jzOwner, 'xuhuang_jiezi')) continue
                if (state.deck.length === 0) break
                const jzDraw = drawCards(state, 1)
                jzOwner.hand.push(...jzDraw)
                addLog(state, `【${getGeneralName(jzOwner)}】【截輜】摸 ${jzDraw.length} 张牌`)
            }
            skipDraw = true
        } else {
            addLog(state, `【${name}】兵粮寸断判定♣，解除`)
        }
        general.judgeZone = general.judgeZone.filter(c => c.id !== delayedCard.id)
        state.discard.push(delayedCard)
        checkTiandu(state, general, judgeCard)
    } else if (delayedCard.name === TrickCardName.LIGHTNING) {
        // 闪电：判定♠2~♠9 则受到3点雷电伤害，否则移到下家的判定区
        const hit = judgeCard.suit === CardSuit.SPADE && judgeCard.value >= 2 && judgeCard.value <= 9
        general.judgeZone = general.judgeZone.filter(c => c.id !== delayedCard.id)
        if (hit) {
            state.discard.push(delayedCard)
            addLog(state, `【${name}】闪电判定${cardFullName(judgeCard)}，受到3点雷电伤害`)
            dealDamage(state, null, general, 3, delayedCard.id, { nature: 'thunder' })
        } else {
            const fromIdx = state.generals.indexOf(general)
            const nextHolder = nextAliveAfter(state, fromIdx)
            if (nextHolder) {
                nextHolder.judgeZone.push(delayedCard)
                addLog(state, `【${name}】闪电判定${cardFullName(judgeCard)}，未生效，移至【${getGeneralName(nextHolder)}】的判定区`)
            } else {
                state.discard.push(delayedCard)
            }
        }
        checkTiandu(state, general, judgeCard)
    }

    return { skipAction, skipDraw }
}

/** 黑色牌（♠/♣）——鬼道（张角）取牌判据，手牌与装备区均可用 */
function isBlackSuitCard(card: Card): boolean {
    return card.suit === CardSuit.SPADE || card.suit === CardSuit.CLUB
}

/** 手牌或装备区是否有黑色牌 */
function hasBlackCard(g: GeneralInstance): boolean {
    return g.hand.some(isBlackSuitCard) || Object.values(g.equip).some((c) => !!c && isBlackSuitCard(c))
}

/** 判定介入者实际发动的技能名（鬼才 / 缓释 / 鬼道） */
export function judgeInterveneSkillName(g: GeneralInstance): '鬼才' | '缓释' | '鬼道' {
    if (hasSkillById(g, 'simayi_guicai') || hasSkillById(g, 'simayi_jie_guicai') || hasSkillById(g, 'simayi_jing_guicai')) return '鬼才'
    if (hasSkillById(g, 'zhangjiao_guidao') || hasSkillById(g, 'zhangjiao_jie_guidao')) return '鬼道'
    return '鬼道'
}

/** 查找可以介入判定的角色（鬼才/缓释/鬼道），从判定者开始逆时针询问，excludeIndices 是已拒绝者的下标列表 */
export function findJudgeIntervenor(state: GameState, judgingGeneral: GeneralInstance, excludeIndices: number[] = []): GeneralInstance | null {
    const hasCards = (g: GeneralInstance) =>
        g.hand.length > 0 || Object.values(g.equip).some(Boolean)

    const judgingIdx = state.generals.indexOf(judgingGeneral)
    const n = state.generals.length

    // 从判定者开始，逆时针遍历所有角色（包括判定者自身）
    for (let i = 0; i < n; i++) {
        const idx = ((judgingIdx - i) % n + n) % n // 逆时针
        const g = state.generals[idx]
        if (!g.alive) continue
        if (!hasCards(g)) continue
        if (excludeIndices.includes(idx)) continue

        // 鬼才：可以改任何人的判定
        if (hasSkillById(g, 'simayi_guicai') || hasSkillById(g, 'simayi_jie_guicai') || hasSkillById(g, 'simayi_jing_guicai')) return g
        // 鬼道（张角）：可以改任何人的判定，但需有黑色牌（手牌或装备区）
        if ((hasSkillById(g, 'zhangjiao_guidao') || hasSkillById(g, 'zhangjiao_jie_guidao')) && hasBlackCard(g)) return g
        // 缓释：只能改己方角色的判定，且只能用手牌
        if (hasSkillById(g, 'zhugejin_huanshi') && g.faction === judgingGeneral.faction
            && g.hand.length > 0) return g
    }
    return null
}

/**
 * 判定介入处理完成后，继续判定流程
 * 由 handleRespond 的 JUDGE_INTERVENE case 调用
 */
export function continueJudgePhase(
    state: GameState,
    judgingGeneral: GeneralInstance,
    judgeCard: Card,
    delayedCard: Card,
    toJudgeCardIds: string[],
    currentJudgeIndex: number,
    skipAction: boolean,
    skipDraw: boolean,
): void {
    // 结算当前判定
    const result = resolveJudge(state, judgingGeneral, delayedCard, judgeCard, skipAction, skipDraw)

    // 从原始列表中取当前索引之后的牌，查找仍在judgeZone中的
    const nextCardIds = toJudgeCardIds.slice(currentJudgeIndex + 1)
    const nextToJudge = nextCardIds
        .map(id => judgingGeneral.judgeZone.find(c => c.id === id))
        .filter((c): c is Card => !!c)

    if (nextToJudge.length > 0) {
        // 继续下一张
        const finalResult = processNextJudge(
            state, judgingGeneral, nextToJudge, 0,
            result.skipAction, result.skipDraw
        )

        // 如果没有被新的介入或无懈窗口打断，继续回合流程
        if ((state.pendingResponseQueue.length === 0 || state.pendingResponseQueue[0].type !== ResponseType.JUDGE_INTERVENE)
            && !state.negateWindow) {
            finishJudgePhaseAndContinue(state, judgingGeneral, finalResult.skipAction, finalResult.skipDraw)
        }
    } else {
        // 所有延时锦囊处理完毕
        finishJudgePhaseAndContinue(state, judgingGeneral, result.skipAction, result.skipDraw)
    }
}

/** 天妒（郭嘉）：判定牌生效后将该牌加入手牌 */
function checkTiandu(state: GameState, general: GeneralInstance, judgeCard: Card): void {
    checkZhuwei(state, general, judgeCard)
    const def = getGeneralById(general.generalId)
    if (def?.skills.some(s => s.id === 'guojia_tiandu')) {
        const idx = state.discard.indexOf(judgeCard)
        if (idx >= 0) {
            state.discard.splice(idx, 1)
            general.hand.push(judgeCard)
            const name = def?.name ?? general.generalId
            addLog(state, `【${name}】发动【天妒】，获得判定牌`)
        }
    }
}

/** 结束出牌阶段，进入弃牌 */
export function handleEndTurn(
    state: GameState,
    playerId: string
): { error: string } | void {
    const general = getActiveGeneral(state)
    if (!general || general.playerId !== playerId) return { error: '不是你的回合' }
    if (state.turnPhase !== TurnPhase.ACTION) return { error: '当前不是出牌阶段' }

    // 燕语（夏侯氏）：出牌阶段结束时，本阶段重铸过至少两张【杀】则令一名男性角色摸两张牌
    if (hasSkillById(general, 'xiahoushi_yanyu') && (general.yanyuRecast ?? 0) >= 2) {
        const yyCandidates = state.generals
            .map((g, i) => ({ g, i }))
            .filter(({ g }) => g.alive && g !== general && getGeneralById(g.generalId)?.gender === 'male')
            .map(({ i }) => i)
        if (yyCandidates.length > 0) {
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_CHOOSE_TARGET,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    skillId: 'xiahoushi_yanyu_end',
                    skillName: '燕语',
                    description: '令一名男性角色摸两张牌',
                    candidateIndices: yyCandidates,
                },
            })
            addLog(state, `【${getGeneralName(general)}】可发动【燕语】`)
        }
    }

    // 燕语结算完成后（或放弃）继续弃牌阶段
    if (state.pendingResponseQueue.length > 0) return

    // 说盟（孙乾）：出牌阶段结束时，可以和一名角色拼点
    if (hasSkillById(general, 'sunqian_shuomeng') && general.hand.length > 0) {
        const candidates = state.generals
            .map((g, idx) => ({ g, idx }))
            .filter(({ g }) => g.alive && g !== general && g.hand.length > 0)
            .map(({ idx }) => idx)
        if (candidates.length > 0) {
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_SHUOMENG_TARGET,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    skillId: 'sunqian_shuomeng',
                    skillName: '说盟',
                    candidateIndices: candidates,
                    description: '与一名角色拼点：若你赢，视为使用【无中生有】；否则其视为对你使用【过河拆桥】',
                    atActionEnd: true,
                },
            })
            return
        }
    }

    // 精策①（界郭淮）：一名角色的出牌阶段结束时，可摸本回合使用过的牌的类别数张牌
    for (const gc of state.generals) {
        if (!gc.alive || !hasSkillById(gc, 'guohuai_jingce')) continue
        if (gc.skillsUsedThisTurn.includes('guohuai_jingce')) continue
        const jinceCount = (gc.jinceCategories ?? []).length
        if (jinceCount === 0) continue
        gc.skillsUsedThisTurn.push('guohuai_jingce')
        state.pendingResponseQueue.unshift({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(gc),
            context: {
                skillId: 'guohuai_jingce',
                skillName: '精策',
                description: `摸${jinceCount}张牌（你本回合使用过的牌的类别数）`,
                jinceCount,
            },
        })
        addLog(state, `【${getGeneralName(gc)}】可发动【精策】摸${jinceCount}张牌`)
    }
    if (state.pendingResponseQueue.length > 0) return

    // 献图（界张松）：此阶段结束时，若其造成的伤害小于你以此法交给其的牌数，你失去1点体力
    for (const xs of state.generals) {
        if (!xs.alive || !hasSkillById(xs, 'zhangsong_xiantu')) continue
        if (xs.xiantuTurn !== state.turnSerial) continue
        if (xs.xiantuTargetIndex !== state.activeGeneralIndex) continue
        const xsGiven = xs.xiantuCount ?? 0
        const xsDamaged = (general.damageDealtThisTurn ?? 0) - (xs.xiantuDamageBaseline ?? 0)
        xs.xiantuTargetIndex = undefined
        xs.xiantuCount = undefined
        xs.xiantuTurn = undefined
        xs.xiantuDamageBaseline = undefined
        if (xsDamaged < xsGiven) {
            addLog(state, `【${getGeneralName(xs)}】【献图】：【${getGeneralName(general)}】本阶段造成${xsDamaged}点伤害，小于交给其的${xsGiven}张牌，失去1点体力`)
            state.pendingResponseQueue.push({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(xs),
                context: {
                    skillId: 'zhangsong_xiantu_cost',
                    skillName: '献图',
                    description: '失去1点体力（献图的代价）',
                    autoExecute: true,
                },
            })
        } else {
            addLog(state, `【${getGeneralName(xs)}】【献图】：【${getGeneralName(general)}】本阶段造成${xsDamaged}点伤害，不小于交给其的${xsGiven}张牌`)
        }
    }
    if (state.pendingResponseQueue.length > 0) return

    // 节钺（谋于禁）：结束阶段，令一名其他角色获得1点护甲，然后其可以交给你一张牌
    if (hasSkillById(general, 'yujin_mou_jieyue')
        && !general.skillsUsedThisTurn.includes('yujin_mou_jieyue')
        && state.generals.some((g) => g.alive && g !== general)) {
        general.skillsUsedThisTurn.push('yujin_mou_jieyue')
        state.pendingResponseQueue.unshift({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(general),
            context: {
                skillId: 'yujin_mou_jieyue',
                skillName: '节钺',
                description: '令一名其他角色获得1点护甲，然后其可以交给你一张牌',
            },
        })
        addLog(state, `【${getGeneralName(general)}】可发动【节钺】`)
    }
    if (state.pendingResponseQueue.length > 0) return

    enterDiscardPhaseOrSkip(state, general)
}

/**
 * 出牌阶段结束后的弃牌阶段入口：
 * 奋励（朱桓）可跳过弃牌阶段，手牌未超限则直接结束回合
 */
/**
 * 星卜（谯周）为2：跳过弃牌阶段。返回 true 表示已直接结束回合。
 */
function maybeSkipDiscardPhase(state: GameState, general: GeneralInstance): boolean {
    if (!general.skipDiscardPhase) return false
    general.skipDiscardPhase = false
    addLog(state, `【${getGeneralName(general)}】的【星卜】生效，跳过弃牌阶段`)
    finishTurn(state)
    return true
}

export function enterDiscardPhaseOrSkip(state: GameState, general: GeneralInstance): void {
    if (state.pendingResponseQueue.length > 0) return
    // 评荐（许劭）：出牌阶段结束，失去此时机获得的技能
    expirePingjian(state, general, 'action')
    // 引兵（祖茂）：出牌阶段结束时，可将任意张非基本牌置于武将牌上
    if (hasSkillById(general, 'zumao_yinbing')
        && !general.skillsUsedThisTurn.includes('zumao_yinbing_asked')) {
        const nonBasic = [
            ...general.hand.filter(c => c.category !== CardCategory.BASIC),
            ...Object.values(general.equip)
                .filter((c): c is Card => !!c && c.category !== CardCategory.BASIC),
        ]
        if (nonBasic.length > 0) {
            general.skillsUsedThisTurn.push('zumao_yinbing_asked')
            state.pendingResponseQueue.push({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    skillId: 'zumao_yinbing',
                    skillName: '引兵',
                    description: `将任意张非基本牌置于武将牌上（现有${nonBasic.length}张可选）`,
                    yinbingMax: nonBasic.length,
                    candidateCardIds: nonBasic.map(c => c.id),
                },
            })
            addLog(state, `【${getGeneralName(general)}】可发动【引兵】`)
            return
        }
    }
    // 贵相（族吴苋）：第 X 个阶段改为出牌阶段
    if (maybeGuixiang(state, general, 'discard')) return
    // 泥首（屈晃）：本阶段结束，执行待结算的手牌交换
    resolveNishouSwaps(state)
    // 逐日（谋姜维）：出牌阶段结束时手牌数变化则拼点
    maybeZhuri(state, general)
    // 叛侵（SP孟获）：出牌阶段结束时，可将本阶段弃置的牌当【南蛮入侵】使用
    if (general.panqinOwned && (general.panqinDiscardIds?.length ?? 0) > 0
        && general.panqinPhaseKey === 'action' && general.panqinAskedPhase !== 'action') {
        general.panqinAskedPhase = 'action'
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(general),
            context: {
                skillId: 'menghuo_sp_panqin', skillName: '叛侵',
                description: `将本阶段弃置的${general.panqinDiscardIds!.length}张牌当【南蛮入侵】使用？`,
                panqinOwnerIndex: state.generals.indexOf(general),
                panqinCount: general.panqinDiscardIds!.length,
                panqinResume: 'action',
            },
        })
        addLog(state, `【${getGeneralName(general)}】可发动【叛侵】`)
        return
    }
    // 素俭（邓芝）：弃牌阶段改为分配/弃置本回合未获得的牌
    if (hasSkillById(general, 'dengzhi_sujian')) {
        const sjGained = new Set(general.gainedCardIdsThisTurn ?? [])
        const sjEligible = general.hand.filter(c => !sjGained.has(c.id))
        if (sjEligible.length > 0) {
            state.pendingResponseQueue.push({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    skillId: 'dengzhi_sujian', skillName: '素俭',
                    description: '选择本回合未获得的牌：分配给其他角色，或弃置并令一名其他角色弃等量牌',
                    options: [
                        { action: 'sujian_give', label: '分配给其他角色' },
                        { action: 'sujian_discard', label: '弃置并令一名其他角色弃等量牌' },
                    ],
                    sujianEligibleIds: sjEligible.map(c => c.id),
                },
            })
            addLog(state, `【${getGeneralName(general)}】可发动【素俭】`)
            return
        }
    }
    // 清忠（鲁芝）：本阶段结束时，与手牌数最少的角色交换手牌
    if ((general as any).qingzhongActive) {
        ;(general as any).qingzhongActive = false
        const qzOthers = state.generals.filter(g => g.alive && g !== general)
        if (qzOthers.length > 0) {
            const qzTarget = [...qzOthers].sort((a, b) => a.hand.length - b.hand.length)[0]
            const qzMine = general.hand.splice(0)
            const qzTheirs = qzTarget.hand.splice(0)
            general.hand.push(...qzTheirs)
            qzTarget.hand.push(...qzMine)
            addLog(state, `【${getGeneralName(general)}】发动【清忠】，与【${getGeneralName(qzTarget)}】交换手牌`)
        }
    }
    // 缔盟（界鲁肃）：此阶段结束时弃置 X 张牌（X 为两名角色交换前的牌数差）
    if (hasSkillById(general, 'lusu_jie_dimeng') && (general.dimengDebt ?? 0) > 0) {
        let debt = general.dimengDebt ?? 0
        general.dimengDebt = 0
        const dropped: Card[] = []
        for (const c of [...general.hand].sort((a, b) => a.value - b.value)) {
            if (debt <= 0) break
            const idx = general.hand.indexOf(c)
            if (idx < 0) continue
            general.hand.splice(idx, 1)
            state.discard.push(c)
            dropped.push(c)
            debt--
        }
        if (dropped.length > 0) {
            addLog(state, `【${getGeneralName(general)}】【缔盟】弃置${dropped.length}张牌`)
            markCardStateBaseline(state, general)
        }
    }
    // 观微（潘濬）：出牌阶段结束时，本回合使用过至少两张同花色的牌
    triggerGuanwei(state, general)
    if (state.pendingResponseQueue.length > 0) return
    // 克己（界吕蒙）：本回合未使用或打出过【杀】时，跳过弃牌阶段
    if (hasSkillById(general, 'lvmeng_jie_keji')
        && state.attackUsedThisTurn === 0
        && !(general.basicUsedThisTurn ?? []).includes('attack')) {
        addLog(state, `【${getGeneralName(general)}】发动【克己】，跳过弃牌阶段`)
        finishTurn(state)
        return
    }
    // 巧变（张郃）：弃牌阶段入口询问是否弃一张手牌跳过弃牌阶段
    if (maybeQiaobian(state, general, 'discard')) return
    // 奋励（朱桓）：装备区里有牌且数量为全场最多，可跳过弃牌阶段
    if (hasSkillById(general, 'zhuhuan_fenli')
        && !general.skillsUsedThisTurn.includes('zhuhuan_fenli_discard')
        && isEquipMaxOverall(state, general)) {
        general.skillsUsedThisTurn.push('zhuhuan_fenli_discard')
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(general),
            context: {
                skillId: 'zhuhuan_fenli_discard',
                skillName: '奋励',
                description: '你的装备区牌数为全场最多：跳过弃牌阶段？',
            },
        })
        addLog(state, `【${getGeneralName(general)}】可发动【奋励】跳过弃牌阶段`)
        return
    }
    if (maybeSkipDiscardPhase(state, general)) return
    enterDiscardPhase(state, general)
    if (general.hand.length <= getHandLimit(general)) {
        finishTurn(state)
    }
}

/** 燕语结算结束后继续：进入弃牌阶段，手牌未超限则直接结束 */
export function continueAfterYanyu(state: GameState): void {
    const general = getActiveGeneral(state)
    if (!general) return
    if (state.pendingResponseQueue.length > 0) return
    if (maybeSkipDiscardPhase(state, general)) return
    enterDiscardPhase(state, general)
    if (general.hand.length <= getHandLimit(general)) finishTurn(state)
}

/** 说盟结算结束后继续结束回合：进入弃牌阶段，手牌未超限则直接结束 */
export function proceedAfterShuomeng(state: GameState): void {
    const general = getActiveGeneral(state)
    if (!general) return
    if (maybeSkipDiscardPhase(state, general)) return
    enterDiscardPhase(state, general)
    if (general.hand.length <= getHandLimit(general)) finishTurn(state)
}

/**
 * 进入弃牌阶段（唯一重置点：本阶段弃牌计数只在这里清零一次，
 * 分批弃牌过程中不会重复重置）
 */
export function enterDiscardPhase(state: GameState, general: GeneralInstance): void {
    state.turnPhase = TurnPhase.DISCARD
    general.discardedHandThisPhase = 0
}

/** 弃牌处理 */
export function handleDiscard(
    state: GameState,
    playerId: string,
    cardIds: string[]
): { error: string } | void {
    const general = getActiveGeneral(state)
    if (!general || general.playerId !== playerId) return { error: '不是你的回合' }
    if (state.turnPhase !== TurnPhase.DISCARD) return { error: '现在不是弃牌阶段' }

    const handLimit = getHandLimit(general)
    const mustDiscard = general.hand.length - handLimit

    if (mustDiscard <= 0) {
        finishTurn(state)
        return
    }

    if (cardIds.length === 0) return { error: '请选择要弃置的牌' }
    if (cardIds.length > mustDiscard) return { error: `最多弃置 ${mustDiscard} 张牌` }
    if (new Set(cardIds).size !== cardIds.length) return { error: '弃牌选择重复' }

    // 先校验全部手牌存在，避免中途失败留下半弃状态
    for (const id of cardIds) {
        if (!general.hand.some(c => c.id === id)) return { error: `手牌中没有牌 ${id}` }
    }

    const discarded: Card[] = []
    for (const id of cardIds) {
        const idx = general.hand.findIndex(c => c.id === id)
        discarded.push(general.hand.splice(idx, 1)[0])
    }
    state.discard.push(...discarded)
    // 弃牌已在下面显式判定屯田；先把基线推进到弃牌后的手牌，
    // 避免回合切换后的界面刷新把同一批弃牌误判成回合外失去牌。
    markCardStateBaseline(state, general)
    maybeChunlaoPickup(state, general, discarded)
    general.discardedHandThisPhase = (general.discardedHandThisPhase ?? 0) + discarded.length
    // 叛侵（SP孟获）：记录本阶段弃置的牌
    if (general.panqinOwned) {
        if (general.panqinPhaseKey !== 'discard') {
            general.panqinPhaseKey = 'discard'
            general.panqinDiscardIds = []
            general.panqinAskedPhase = undefined
        }
        general.panqinDiscardIds = [...(general.panqinDiscardIds ?? []), ...discarded.map(c => c.id)]
    }

    const cardNames = discarded.map(c => cardFullName(c)).join('、')
    addLog(state, `【${getGeneralName(general)}】弃置了 ${discarded.length} 张牌：${cardNames}`)

    // 固政（界张昭张纮）：其他角色至少两张牌因弃置进入弃牌堆后
    if (discarded.length >= 2) {
        for (const gz of state.generals) {
            if (!gz.alive || gz === general) continue
            if (!hasSkillById(gz, 'zhangzhao_guzheng')) continue
            if (gz.skillsUsedThisTurn.includes('zhangzhao_guzheng')) continue
            gz.skillsUsedThisTurn.push('zhangzhao_guzheng')
            state.pendingResponseQueue.push({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(gz),
                context: {
                    skillId: 'zhangzhao_guzheng',
                    skillName: '固政',
                    description: `选择一张牌交还【${getGeneralName(general)}】，然后获得其余牌`,
                    guzhengCardIds: discarded.map(c => c.id),
                    guzhengGiverIndex: state.generals.indexOf(general),
                    guzhengOrderedIds: [...discarded]
                        .sort((a, b) => (a.value ?? 0) - (b.value ?? 0))
                        .map(c => c.id),
                    options: discarded.map(c => ({
                        action: `return:${c.id}`,
                        label: `交还${cardFullName(c)}`,
                    })),
                },
            })
        }
    }

    // 旋风（凌统）：弃牌阶段弃置至少两张牌后，可弃置至多两名其他角色各一张牌
    if (hasSkillById(general, 'lingtong_xuanfeng') && discarded.length >= 2) {
        const candidates = state.generals
            .map((g, idx) => ({ g, idx }))
            .filter(({ g }) => g.alive && g !== general
                && (g.hand.length > 0 || Object.values(g.equip).some(Boolean)))
            .map(({ idx }) => idx)
        if (candidates.length > 0) {
            state.pendingResponseQueue.push({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    skillId: 'lingtong_xuanfeng',
                    skillName: '旋风',
                    description: '弃置任意名其他角色的共计至多两张牌',
                    xuanfengCandidates: candidates,
                    xuanfengDiscardPhase: true,
                },
            })
            addLog(state, `【${getGeneralName(general)}】可发动【旋风】`)
        }
    }

    // 屯田（界邓艾）：回合内弃置【杀】后判定
    for (const c of discarded) {
        if (isSlashLikeCard(c)) checkTuntian(state, general, c)
    }

    // 慎断（韩浩史涣）：黑色基本牌因弃置进入弃牌堆时，可当无距离限制的【兵粮寸断】使用
    triggerShenduan(state, general, discarded)

    // 激昂②（界孙策）：红杀/决斗因弃置进入弃牌堆
    triggerJiangJieDiscard(state, discarded)

    // 纵玄（界虞翻）：自己弃置时，或上家的牌每回合第一次因弃置进入弃牌堆时，
    // 可将其中任意张牌置于牌堆顶
    maybeZongxuan(state, general, discarded)

    // 连营（界陆逊）：失去最后的手牌后，询问是否摸一张牌
    if (hasSkillById(general, 'luxun_jie_lianying') && general.hand.length === 0
        && discarded.length > 0 && state.deck.length > 0) {
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(general),
            context: {
                skillId: 'luxun_jie_lianying',
                skillName: '连营',
                description: '你失去了最后的手牌，摸一张牌',
                lianyingDiscardPhase: true,
            },
        })
        addLog(state, `【${getGeneralName(general)}】可发动【连营】`)
        return
    }

    // 允许分多次弃置：弃够为止，未弃完则停留在弃牌阶段
    if (general.hand.length > handLimit) {
        addLog(state, `【${getGeneralName(general)}】还需弃置 ${general.hand.length - handLimit} 张牌`)
        return
    }
    // 旋风等技能的询问尚未结算时，先等玩家响应
    if (state.pendingResponseQueue.length > 0) return
    // 叛侵（SP孟获）：弃牌阶段结束时，可将本阶段弃置的牌当【南蛮入侵】使用
    if (general.panqinOwned && (general.panqinDiscardIds?.length ?? 0) > 0
        && general.panqinPhaseKey === 'discard' && general.panqinAskedPhase !== 'discard') {
        general.panqinAskedPhase = 'discard'
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(general),
            context: {
                skillId: 'menghuo_sp_panqin', skillName: '叛侵',
                description: `将本阶段弃置的${general.panqinDiscardIds!.length}张牌当【南蛮入侵】使用？`,
                panqinOwnerIndex: state.generals.indexOf(general),
                panqinCount: general.panqinDiscardIds!.length,
                panqinResume: 'discard',
            },
        })
        addLog(state, `【${getGeneralName(general)}】可发动【叛侵】`)
        return
    }
    finishTurn(state)
}

/**
 * 贵相（族吴苋）：本回合第 X 个阶段开始前，将此阶段改为出牌阶段（X 为手牌上限）。
 * 返回 true 表示该阶段已被替换，调用方应直接返回。
 */
let guixiangBusy = false
function maybeGuixiang(state: GameState, general: GeneralInstance, phaseKey: string): boolean {
    if (!general.alive || !hasSkillById(general, 'wuxian_zu_guixiang')) return false
    // 由改写而进入的出牌阶段不再重复计数
    if (guixiangBusy) return false
    if (general.guixiangTurn !== state.turnSerial) {
        general.guixiangTurn = state.turnSerial
        general.guixiangPhases = 0
    }
    const ordinal = (general.guixiangPhases ?? 0) + 1
    general.guixiangPhases = ordinal
    if (phaseKey === 'action') return false
    const limit = getHandLimit(general)
    if (limit <= 0 || ordinal !== limit) return false
    addLog(state, `【${getGeneralName(general)}】【贵相】本回合第${ordinal}个阶段改为出牌阶段`)
    guixiangBusy = true
    try {
        beginActionPhase(state, general)
    } finally {
        guixiangBusy = false
    }
    return true
}

/**
 * 结束阶段技能结算（在回合结束前统一处理）。
 * 说明：部分技能按“玩家会同意的最优选择”自动结算，以免打断单机节奏。
 */
/** 泥首（屈晃）：阶段结束时统一结算待交换的手牌 */
function resolveNishouSwaps(state: GameState): void {
    for (const g of state.generals) resolveNishouPendingSwap(state, g)
}

function runEndPhaseSkills(state: GameState, general: GeneralInstance): void {
    const name = getGeneralName(general)
    const aliveOthers = state.generals.filter(g => g.alive && g !== general)
    const allies = aliveOthers.filter(g => g.faction === general.faction)
    const enemies = aliveOthers.filter(g => g.faction !== general.faction)
    const handValue = (c: Card): number => {
        if (c.name === 'peach') return 100
        if (c.name === 'dodge') return 80
        if (c.name === 'attack' || c.name === 'fire_slash' || c.name === 'thunder_slash') return 70
        if (c.name === 'wine') return 55
        if (c.name === 'draw_two' || c.name === 'dismantle' || c.name === 'steal') return 75
        if (c.category === CardCategory.EQUIPMENT) return 50
        return 30
    }
    const lowestCards = (g: GeneralInstance, count: number): Card[] =>
        [...g.hand].sort((a, b) => handValue(a) - handValue(b)).slice(0, count)

    // 星卜（谯周）：结束阶段亮出牌堆顶三张牌，选择一名其他角色按红牌数获得效果
    if (hasSkillById(general, 'qiaozhou_xingbu')) {
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(general),
            context: {
                skillId: 'qiaozhou_xingbu', skillName: '星卜',
                description: '亮出牌堆顶的三张牌，然后可选择一名其他角色，令其根据红色牌数获得对应效果',
                endPhaseSkill: true,
            },
        })
        addLog(state, `【${name}】可发动【星卜】`)
    }

    // 辟田（郑浑）：结束阶段摸至手牌上限（至多五张），然后失去因此获得的上限加值
    triggerPitian(state, general)

    // 执义（张翼）：一名角色的结束阶段，若张翼本回合使用或打出过基本牌，选择一项
    for (const zy of state.generals) {
        if (!zy.alive || !hasSkillById(zy, 'zhangyi_yiyi')) continue
        if (state.turnSerial !== undefined && zy.yiyiTurn === state.turnSerial) continue
        const zyUsed = zy.basicUsedThisTurn ?? []
        if (zyUsed.length === 0) continue
        zy.yiyiTurn = state.turnSerial
        const zyOptions: { action: string; label: string }[] = []
        for (const usedName of zyUsed) {
            // 【闪】不能主动使用，不作为“视为使用”的选项
            if (usedName === BasicCardName.DODGE) continue
            if (usedName === BasicCardName.PEACH && zy.hp >= zy.maxHp) continue
            const isSlashName = usedName === BasicCardName.ATTACK
                || usedName === BasicCardName.FIRE_SLASH || usedName === BasicCardName.THUNDER_SLASH
            if (isSlashName && !state.generals.some(g => g.alive && g !== zy
                && getAttackRange(zy, g, state.generals).inRange)) continue
            zyOptions.push({
                action: `use:${usedName}`,
                label: `视为使用${usedName === BasicCardName.PEACH ? '【桃】'
                    : usedName === BasicCardName.WINE ? '【酒】'
                        : `【${cardDisplayName({ name: usedName } as any)}】`}`,
            })
        }
        zyOptions.push({ action: 'draw', label: '摸一张牌' })
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(zy),
            context: {
                skillId: 'zhangyi_yiyi',
                skillName: '执义',
                description: `本回合使用或打出过基本牌（${zyUsed.map(n => cardDisplayName({ name: n } as any)).join('、')}），选择一项`,
                options: zyOptions,
                endPhaseSkill: true,
            },
        })
        addLog(state, `【${getGeneralName(zy)}】可发动【执义】`)
    }

    // 生息（蒋琬-竞）：一名角色回合结束时，若其已受伤，可弃置其X张牌，然后其回复1点体力
    for (const jw of state.generals) {
        if (!jw.alive || !hasSkillById(jw, 'jiangwan_jing_shengxi')) continue
        if (general.hp >= general.maxHp) continue
        const lost = general.maxHp - general.hp
        const pool = [
            ...general.hand.map(c => c.id),
            ...Object.values(general.equip).filter((c): c is Card => !!c).map(c => c.id),
        ]
        if (pool.length < lost) continue
        const jwIdx = state.generals.indexOf(jw)
        if (state.pendingResponseQueue.some(p => (p.context as any)?.skillId === 'jiangwan_jing_shengxi'
            && p.targetGeneralIndex === jwIdx)) continue
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: jwIdx,
            context: {
                skillId: 'jiangwan_jing_shengxi', skillName: '生息',
                description: `【${name}】已受伤，可弃置其${lost}张牌，然后其回复1点体力`,
                options: [
                    { action: 'confirm', label: '发动' },
                    { action: 'decline', label: '不发动' },
                ],
                shengxiTargetIndex: state.generals.indexOf(general),
                shengxiCount: lost,
            },
        })
        addLog(state, `【${getGeneralName(jw)}】可发动【生息】`)
    }

    // 诫训（薛综）：令一名其他角色摸场上♦牌数张，再弃此前发动次数张
    if (hasSkillById(general, 'xuezong_jiexun')) {
        const diamondCount = state.generals.reduce((sum, g) => {
            const cards = [...g.hand, ...Object.values(g.equip).filter((c): c is Card => !!c), ...g.judgeZone]
            return sum + cards.filter((c) => c.suit === CardSuit.DIAMOND).length
        }, 0)
        if (diamondCount > 0) {
            const uses = general.jiexunUses ?? 0
            const preferred = uses === 0 ? allies : enemies
            const candidates = preferred.length > 0 ? preferred : aliveOthers
            const cardCount = (g: GeneralInstance) => g.hand.length + Object.values(g.equip).filter(Boolean).length
            const target = [...candidates].sort((a, b) => cardCount(b) - cardCount(a))[0]
            if (target) {
                const drawn = drawCards(state, diamondCount)
                target.hand.push(...drawn)
                const discarded = lowestCards(target, uses)
                for (const card of discarded) {
                    const idx = target.hand.findIndex((c) => c.id === card.id)
                    if (idx >= 0) {
                        target.hand.splice(idx, 1)
                        state.discard.push(card)
                    }
                }
                general.jiexunUses = uses + 1
                addLog(state, `【${name}】发动【诫训】，令【${getGeneralName(target)}】摸 ${drawn.length} 张牌并弃置 ${discarded.length} 张牌`)
                if (discarded.length > 0 && target.hand.length === 0) {
                    general.lostSkills = [...(general.lostSkills ?? []), 'xuezong_jiexun']
                    general.funanUpgraded = true
                    addLog(state, `【${name}】的【诫训】弃光了【${getGeneralName(target)}】的牌，失去【诫训】并强化【复难】`)
                }
            }
        }
    }

    // ══ 洛书版扩展（二）结束阶段技能 ══
    // 据守（曹仁）：摸四张并翻面，然后弃置一张手牌（装备牌则改为使用）
    if (hasSkillById(general, 'caoren_jushou')) {
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(general),
            context: {
                skillId: 'caoren_jushou', skillName: '据守',
                description: '摸四张牌并翻面，然后弃置一张手牌（若为装备牌则改为使用）',
                endPhaseSkill: true, aiConfirm: true,
            },
        })
    }
    // 崩坏（界董卓）：锁定技，结束阶段选择失去1点体力或减1点体力上限（酒池③可使本回合失效）
    if (hasSkillById(general, 'dongzhuo_banghuai') && general.alive
        && general.banghuaiDisabledTurn !== state.turnSerial) {
        const lowestHp = Math.min(...state.generals.filter(g => g.alive).map(g => g.hp))
        if (general.hp > lowestHp) {
            state.pendingResponseQueue.push({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    skillId: 'dongzhuo_banghuai', skillName: '崩坏',
                    description: '你不是全场体力值最低的角色：选择失去1点体力或减1点体力上限',
                    endPhaseSkill: true,
                    options: [
                        { action: 'loseHp', label: '失去1点体力' },
                        { action: 'reduceMaxHp', label: '减1点体力上限' },
                    ],
                },
            })
        }
    }
    // 武继（关银屏）：觉醒技，本回合造成过至少3点伤害
    if (hasSkillById(general, 'guanyinping_wuji') && !general.awakened && general.alive
        && (general.damageDealtThisTurn ?? 0) >= 3) {
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(general),
            context: {
                skillId: 'guanyinping_wuji', skillName: '武继',
                description: '觉醒：加1点体力上限并回复1点体力，失去【虎啸】，获得【青龙偃月刀】',
                endPhaseSkill: true, aiConfirm: true,
            },
        })
    }
    // 追忆（界步练师）：限定技，令一名其他角色摸三张牌并回复1点体力
    if (hasSkillById(general, 'bulianshi_zhuiyi') && general.alive
        && !general.usedLimitedSkills.includes('bulianshi_zhuiyi')
        && aliveOthers.length > 0) {
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(general),
            context: {
                skillId: 'bulianshi_zhuiyi', skillName: '追忆',
                description: '令一名其他角色摸三张牌并回复1点体力',
                endPhaseSkill: true, aiConfirm: true,
            },
        })
    }
    // 武烈（界孙坚）：限定技，失去任意点体力，令等量其他角色获得“烈”
    if (hasSkillById(general, 'sunjian_wulie') && general.alive && general.hp > 1
        && !general.usedLimitedSkills.includes('sunjian_wulie')) {
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(general),
            context: {
                skillId: 'sunjian_wulie', skillName: '武烈',
                description: `选择至多${Math.max(1, general.hp - 1)}名其他角色，失去等量体力，令其各获得1个“烈”标记`,
                endPhaseSkill: true, aiConfirm: true,
                targetSelectOnActivate: true,
                maxTargets: Math.max(1, general.hp - 1),
            },
        })
    }
    // 诱敌（周鲂）
    if (hasSkillById(general, 'zhoufang_youdi') && general.alive && general.hand.length > 0) {
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(general),
            context: {
                skillId: 'zhoufang_youdi', skillName: '诱敌',
                description: '令一名其他角色弃置你的一张手牌：若不为【杀】你获得其一张牌；若为黑色你摸一张牌',
                endPhaseSkill: true, aiConfirm: true,
            },
        })
    }
    // 评荐（许劭）：结束阶段可再次发动
    if (hasSkillById(general, 'xushao_pingjian')) {
        maybePingjian(state, general, 'end')
    }
    // 困奋（谋姜维）：结束阶段，可失去1点体力摸两张牌
    if (hasSkillById(general, 'jiangwei_mou_kunfen') && general.alive
        && general.hp > 0 && general.kunfenTurn !== state.turnSerial) {
        general.kunfenTurn = state.turnSerial
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(general),
            context: {
                skillId: 'jiangwei_mou_kunfen', skillName: '困奋',
                description: '失去1点体力，摸两张牌',
                options: [
                    { action: 'loseHp', label: '失去1点体力，摸两张牌' },
                    { action: 'decline', label: '不发动' },
                ],
                endPhaseSkill: true,
            },
        })
        addLog(state, `【${name}】可发动【困奋】`)
    }
    // 燃己（谋姜维）：结束阶段，按本回合使用过牌的阶段数获得【困奋】或【诈降】
    if (hasSkillById(general, 'jiangwei_mou_ranji') && general.alive
        && !general.usedLimitedSkills.includes('jiangwei_mou_ranji')) {
        const phaseCount = new Set(general.usedCardPhases ?? []).size
        const ranjiOptions = [
            ...(phaseCount >= general.hp ? [{ action: 'kunfen', label: '获得【困奋】' }] : []),
            ...(phaseCount <= general.hp ? [{ action: 'zhaoxiang', label: '获得【诈降】' }] : []),
        ]
        if (ranjiOptions.length > 0) {
            state.pendingResponseQueue.push({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    skillId: 'jiangwei_mou_ranji', skillName: '燃己',
                    description: `本回合于${phaseCount}个阶段使用过牌（体力值${general.hp}），获得一个技能`,
                    options: ranjiOptions,
                    endPhaseSkill: true,
                },
            })
            addLog(state, `【${name}】可发动【燃己】`)
        }
    }
    // 双雄②（界颜良文丑）：获得本回合对你造成伤害的牌
    if (hasSkillById(general, 'yanliang_shuangxiong') && (general.damagedCardIds ?? []).length > 0) {
        const gained: Card[] = []
        for (const cid of general.damagedCardIds!) {
            const di = state.discard.findIndex(c => c.id === cid)
            if (di >= 0) gained.push(state.discard.splice(di, 1)[0])
        }
        general.damagedCardIds = []
        if (gained.length > 0) {
            general.hand.push(...gained)
            addLog(state, `【${name}】发动【双雄】，获得本回合造成伤害的 ${gained.length} 张牌`)
        }
    }
    // 长标（界祝融）：本阶段造成过伤害则摸等量的牌
    if (hasSkillById(general, 'zhurong_changbiao') && (general.changbiaoDamaged ?? 0) > 0) {
        const drawN = general.changbiaoDamaged!
        general.changbiaoDamaged = 0
        const drawn = drawCards(state, drawN)
        general.hand.push(...drawn)
        addLog(state, `【${name}】【长标】摸${drawn.length}张牌`)
    }
    // 箜声（周妃）：使用武将牌上的装备牌，获得其余的牌
    if (hasSkillById(general, 'zhoufei_kongsheng') && general.kongshengActive && (general.generalPile?.length ?? 0) > 0) {
        const pile = [...general.generalPile!]
        general.generalPile = []
        general.kongshengActive = false
        const rest: Card[] = []
        for (const c of pile) {
            if (c.category === CardCategory.EQUIPMENT && c.equipSlot) {
                const old = general.equip[c.equipSlot]
                if (old) state.discard.push(old)
                general.equip[c.equipSlot] = c
                addLog(state, `【${name}】【箜声】使用了${cardFullName(c)}`)
            } else {
                rest.push(c)
            }
        }
        if (rest.length > 0) {
            general.hand.push(...rest)
            addLog(state, `【${name}】【箜声】获得 ${rest.length} 张牌`)
            triggerLiangyinIn(state)
        }
    }

    // 镇骨（郝昭）：结束阶段选择一名其他角色
    if (hasSkillById(general, 'haozhao_zhengu')) {
        const zgCandidates = state.generals
            .map((g, i) => ({ g, i }))
            .filter(({ g }) => g.alive && g !== general)
            .map(({ i }) => i)
        if (zgCandidates.length > 0) {
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_CHOOSE_TARGET,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    skillId: 'haozhao_zhengu',
                    skillName: '镇骨',
                    description: '选择一名其他角色：你与其的回合结束时，其将手牌摸至或弃置至与你相同',
                    candidateIndices: zgCandidates,
                },
            })
            addLog(state, `【${name}】可发动【镇骨】`)
        }
    }

    // 镇骨：被镇骨者在其回合结束时结算
    if (general.zhenguBy !== undefined) {
        const zgOwnerIdx = general.zhenguBy
        const zgOwner = state.generals[zgOwnerIdx]
        general.zhenguBy = undefined
        if (zgOwner?.alive) {
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    skillId: 'haozhao_zhengu',
                    skillName: '镇骨',
                    description: `【${getGeneralName(zgOwner)}】的【镇骨】：将手牌摸至或弃置至与其相同`,
                    options: [
                        { action: 'draw', label: '将手牌摸至与其相同（至多五张）' },
                        { action: 'discard', label: '将手牌弃置至与其相同' },
                    ],
                    zhenguOwnerIndex: zgOwnerIdx,
                },
            })
        }
    }

    // 醇醪（程普）：结束阶段将任意张【杀】置于武将牌上
    // 界程普的醇醪改为“弃置时收集”，此处不再询问
    if (hasSkillById(general, 'chengpu_chunlao') && !general.chunlaoPlaced
        && !hasSkillById(general, 'chengpu_jie_lihuo')) {
        const chunlaoSlashes = general.hand.filter(isSlashCard)
        if (chunlaoSlashes.length > 0) {
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_PICK_CARD,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    skillId: 'chengpu_chunlao',
                    skillName: '醇醪',
                    description: '将任意张【杀】置于武将牌上，称为“醇”',
                    count: chunlaoSlashes.length,
                    mode: 'pile',
                    candidateCardIds: chunlaoSlashes.map(c => c.id),
                    endPhase: true,
                },
            })
            addLog(state, `【${name}】可发动【醇醪】`)
        }
    }

    // 极奢②（岑昏）：没有手牌时，可横置至多X名角色（X为体力值）
    if (hasSkillById(general, 'cenhun_jishe') && general.hand.length === 0 && general.hp > 0) {
        const jsCandidates = state.generals
            .map((g, i) => ({ g, i }))
            .filter(({ g }) => g.alive && g !== general)
            .map(({ i }) => i)
        if (jsCandidates.length > 0) {
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_CHOOSE_TARGET,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    skillId: 'cenhun_jishe_end',
                    skillName: '极奢',
                    description: `横置至多${general.hp}名角色`,
                    candidateIndices: jsCandidates,
                    multi: true,
                    maxPicks: Math.min(general.hp, jsCandidates.length),
                    endPhaseSkill: true,
                },
            })
            addLog(state, `【${name}】可发动【极奢】横置角色`)
        }
    }

    // 樵拾（夏侯氏）：其他角色的结束阶段，若手牌数相等则各摸一张
    for (const xs of state.generals) {
        if (!xs.alive || xs === general) continue
        if (!hasSkillById(xs, 'xiahoushi_qiaoshi')) continue
        if (xs.hand.length !== general.hand.length) continue
        if (state.deck.length === 0) continue
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(xs),
            context: {
                skillId: 'xiahoushi_qiaoshi',
                skillName: '樵拾',
                description: `你与【${name}】手牌数相等，各摸一张牌`,
                qiaoshiPartnerIndex: state.generals.indexOf(general),
            },
        })
        addLog(state, `【${getGeneralName(xs)}】可发动【樵拾】`)
    }

    // 俭衣（蒋钦）：其他角色的回合结束时，若弃牌堆中有本回合因弃置置入的防具牌，选择一张获得之
    for (const jq of state.generals) {
        if (!jq.alive || jq === general) continue
        if (!hasSkillById(jq, 'jiangqin_jianyi')) continue
        const jianyiCards = state.discard.filter(c => c.discardTurn === state.turnSerial
            && c.category === CardCategory.EQUIPMENT && c.equipSlot === EquipSlot.ARMOR)
        if (jianyiCards.length === 0) continue
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(jq),
            context: {
                skillId: 'jiangqin_jianyi',
                skillName: '俭衣',
                description: '选择一张本回合因弃置置入弃牌堆的防具牌获得之',
                jianyiCardIds: jianyiCards.map(c => c.id),
                options: jianyiCards.map(c => ({ action: `take:${c.id}`, label: `获得${cardFullName(c)}` })),
            },
        })
        addLog(state, `【${getGeneralName(jq)}】发动【俭衣】`)
    }

    // 秘计（王异）：已受伤时可摸X张，然后将等量手牌交给其他角色
    if (hasSkillById(general, 'wangyi_miji') && general.hp < general.maxHp) {
        const x = general.maxHp - general.hp
        state.pendingResponseQueue.unshift({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(general),
            context: {
                skillId: 'wangyi_miji',
                skillName: '秘计',
                description: `摸${x}张牌，然后可将等量的手牌交给其他角色`,
                mijiDraw: x,
                mijiEndPhase: true,
            },
        })
    }

    // 贞烈②（界王异）：本回合发动过【贞烈】的角色，可在本回合的结束阶段发动一次【秘计】
    for (const wy of state.generals) {
        if (!wy.alive || wy === general) continue
        if (!wy.mijiExtraThisTurn) continue
        if (!hasSkillById(wy, 'wangyi_miji')) continue
        wy.mijiExtraThisTurn = false
        const mijiX = Math.max(0, wy.maxHp - wy.hp)
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(wy),
            context: {
                skillId: 'wangyi_miji',
                skillName: '秘计',
                description: `【贞烈】：本回合的结束阶段发动一次【秘计】，摸${mijiX}张牌`,
                mijiDraw: mijiX,
                mijiEndPhase: true,
            },
        })
        addLog(state, `【${getGeneralName(wy)}】因【贞烈】可发动【秘计】`)
    }

    // 进趋（王基）：奇制次数≥2 时，可摸两张然后弃置至奇制次数张
    const qizhi = general.qizhiCount ?? 0
    if (hasSkillById(general, 'wangji_jinqu') && qizhi >= 2) {
        state.pendingResponseQueue.unshift({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(general),
            context: {
                skillId: 'wangji_jinqu',
                skillName: '进趋',
                description: `摸两张牌，然后将手牌弃置至 ${qizhi} 张`,
                jinjuQizhi: qizhi,
            },
        })
    }

    // 秉壹（顾雍/界顾雍）：展示手牌，颜色均相同（界版颜色或类型相同）则令至多手牌数名角色各摸一张
    const guyongBingyiId = hasSkillById(general, 'guyong_jie_bingyi') ? 'guyong_jie_bingyi'
        : hasSkillById(general, 'guyong_bingyi') ? 'guyong_bingyi' : undefined
    if (guyongBingyiId && general.hand.length > 0) {
        const isJieGuyong = guyongBingyiId === 'guyong_jie_bingyi'
        const suits = general.hand.map(c => c.suit)
        const allRed = suits.every(s => s === CardSuit.HEART || s === CardSuit.DIAMOND)
        const allBlack = suits.every(s => s === CardSuit.SPADE || s === CardSuit.CLUB)
        const bingyiSameCat = isJieGuyong
            && general.hand.every((c) => c.category === general.hand[0].category)
        const bingyiLabel = isJieGuyong ? '手牌颜色或类型相同' : '手牌颜色相同'
        if (allRed || allBlack || bingyiSameCat) {
            const candidates = state.generals.map((g, i) => ({ g, i })).filter(({ g }) => g.alive).map(({ i }) => i)
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_CHOOSE_TARGET,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    skillId: guyongBingyiId,
                    skillName: '秉壹',
                    description: `${bingyiLabel}，选择至多 ${general.hand.length} 名角色各摸一张牌`,
                    candidateIndices: candidates,
                    multi: true,
                    maxPicks: general.hand.length,
                },
            })
            addLog(state, `【${name}】可发动【秉壹】`)
        }
    }

    // 直言（界虞翻）：结束阶段，或你距离1以内的其他角色的结束阶段，令一名角色摸一张牌并展示
    for (const [zyIdx, zyOwner] of state.generals.entries()) {
        const yufanZhiyanId = hasSkillById(zyOwner, 'yufan_jie_zhiyan') ? 'yufan_jie_zhiyan'
            : hasSkillById(zyOwner, 'yufan_zhiyan') ? 'yufan_zhiyan' : undefined
        if (!zyOwner.alive || !yufanZhiyanId) continue
        if (state.deck.length === 0) break
        const isJieYufan = yufanZhiyanId === 'yufan_jie_zhiyan'
        const zyTriggers = zyOwner === general
            || (isJieYufan
                && getAttackRange(zyOwner, general, state.generals).distance <= 1)
        if (!zyTriggers) continue
        state.pendingResponseQueue.unshift({
            type: ResponseType.SKILL_CHOOSE_TARGET,
            targetGeneralIndex: zyIdx,
            context: {
                skillId: yufanZhiyanId,
                skillName: '直言',
                description: isJieYufan
                    ? '选择一名角色摸一张牌并展示，若为装备牌则其使用并回复1点体力，否则若其体力值不等于你，其失去1点体力'
                    : '选择一名角色摸一张牌并展示，若为装备牌则其使用并回复1点体力',
                candidateIndices: state.generals
                    .map((g, idx) => ({ g, idx }))
                    .filter(({ g }) => g.alive)
                    .map(({ idx }) => idx),
            },
        })
        addLog(state, '【' + getGeneralName(zyOwner) + '】可发动【直言】')
    }

    // 郡兵已随司马朗一并移除

    // 窃听（蔡夫人）：其他角色本回合未对其余角色使用过牌时，取其装备或摸一张
    if ((general.cardsUsedOnOthersThisTurn ?? 0) === 0) {
        for (const caifuren of state.generals) {
            if (!caifuren.alive || caifuren === general) continue
            if (!hasSkillById(caifuren, 'caifuren_qieting')) continue
            const hasEquip = Object.values(general.equip).some(Boolean)
            const qietingOptions: { action: string; label: string }[] = []
            if (hasEquip) qietingOptions.push({ action: 'equip', label: '将其装备区一张牌置入你的装备区' })
            qietingOptions.push({ action: 'draw', label: '摸一张牌' })
            state.pendingResponseQueue.push({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(caifuren),
                context: {
                    skillId: 'caifuren_qieting',
                    skillName: '窃听',
                    description: `【${name}】本回合未对其他角色使用过牌`,
                    options: qietingOptions,
                    endingIndex: state.generals.indexOf(general),
                },
            })
            addLog(state, `【${getGeneralName(caifuren)}】可发动【窃听】`)
        }
    }

    // 窃听（界蔡夫人）：其他角色回合结束时，若其本回合没有对其他角色造成过伤害，
    // 可选项；若其本回合也没有对其他角色使用过牌，则两项都可以选
    if ((general.damageDealtThisTurn ?? 0) === 0) {
        for (const caifuren of state.generals) {
            if (!caifuren.alive || caifuren === general) continue
            if (!hasSkillById(caifuren, 'caifuren_jie_qieting')) continue
            const hasEquip = Object.values(general.equip).some(Boolean)
            const noCardsOnOthers = (general.cardsUsedOnOthersThisTurn ?? 0) === 0
            const jqOptions: { action: string; label: string }[] = []
            if (hasEquip) jqOptions.push({ action: 'equip', label: '将其装备区一张牌置入你的装备区' })
            jqOptions.push({ action: 'draw', label: '摸一张牌' })
            if (hasEquip && noCardsOnOthers) {
                jqOptions.push({ action: 'both', label: '执行上述两项' })
            }
            state.pendingResponseQueue.push({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(caifuren),
                context: {
                    skillId: 'caifuren_jie_qieting',
                    skillName: '窃听',
                    description: `【${name}】本回合未对其他角色造成过伤害${noCardsOnOthers ? '，且未对其他角色使用过牌' : ''}`,
                    options: jqOptions,
                    endingIndex: state.generals.indexOf(general),
                },
            })
            addLog(state, `【${getGeneralName(caifuren)}】可发动【窃听】`)
        }
    }

    // 骁果（乐进）：弃一张基本牌，令敌方结束角色弃装备牌（乐进摸一张）或受到1点伤害
    for (const yuejin of state.generals) {
        if (!yuejin.alive || yuejin === general) continue
        if (!hasSkillById(yuejin, 'yuejin_xiaoguo')
            && !hasSkillById(yuejin, 'zhanghulelin_xiaoguo')) continue
        if (yuejin.faction === general.faction) continue
        const basics = yuejin.hand.filter(c => c.category === CardCategory.BASIC)
        if (basics.length === 0) continue
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(yuejin),
            context: {
                skillId: 'yuejin_xiaoguo',
                skillName: '骁果',
                description: `弃置一张基本牌，令【${name}】弃置装备牌（你摸一张）或受到1点伤害`,
                candidateCardIds: basics.map(c => c.id),
                xiaoguoTargetIndex: state.generals.indexOf(general),
            } as any,
        })
    }

    // 袭爵（张虎乐綝）：其他角色的结束阶段，可移去1个“爵”发动【骁果】
    for (const zhl of state.generals) {
        if (!zhl.alive || zhl === general) continue
        if (!hasSkillById(zhl, 'zhanghulelin_xijue')) continue
        if ((zhl.jueMarks ?? 0) <= 0) continue
        const basics = zhl.hand.filter(c => c.category === CardCategory.BASIC)
        if (basics.length === 0) continue
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(zhl),
            context: {
                skillId: 'yuejin_xiaoguo',
                skillName: '袭爵·骁果',
                description: `移去1个“爵”（共${zhl.jueMarks}个），弃置一张基本牌，令【${name}】弃置装备牌（你摸一张）或受到1点伤害`,
                candidateCardIds: basics.map(c => c.id),
                xiaoguoTargetIndex: state.generals.indexOf(general),
                xijueCost: true,
            } as any,
        })
    }

    // ══ 洛书版扩展（四）结束阶段技能 ══
    // 平寇（朱桓）：对至多X名其他角色各造成1点伤害（X为本回合跳过的阶段数）
    const pkouX = general.fenliSkips ?? 0
    if (hasSkillById(general, 'zhuhuan_pingkou') && pkouX > 0 && general.alive) {
        const pkouCandidates = aliveOthers.map(g => state.generals.indexOf(g))
        if (pkouCandidates.length > 0) {
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_CHOOSE_TARGET,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    skillId: 'zhuhuan_pingkou',
                    skillName: '平寇',
                    description: `对至多${Math.min(pkouX, pkouCandidates.length)}名其他角色各造成1点伤害`,
                    candidateIndices: pkouCandidates,
                    multi: true,
                    maxPicks: Math.min(pkouX, pkouCandidates.length),
                    endPhaseSkill: true,
                },
            })
            addLog(state, `【${name}】可发动【平寇】`)
        }
    }

    // 兴学（孙休）：令至多X名角色依次摸一张牌并将一张牌置于牌堆顶
    if (hasSkillById(general, 'sunxiu_xingxue') && general.alive && state.deck.length > 0) {
        // 拥有“宴诛”时 X 为体力值，否则为体力上限
        const xxX = hasSkillById(general, 'sunxiu_yanzhu') ? general.hp : general.maxHp
        const xxCandidates = state.generals
            .map((g, idx) => ({ g, idx }))
            .filter(({ g }) => g.alive)
            .map(({ idx }) => idx)
        if (xxX > 0 && xxCandidates.length > 0) {
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_CHOOSE_TARGET,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    skillId: 'sunxiu_xingxue',
                    skillName: '兴学',
                    description: `令至多${Math.min(xxX, xxCandidates.length)}名角色依次摸一张牌并将一张牌置于牌堆顶`,
                    candidateIndices: xxCandidates,
                    multi: true,
                    maxPicks: Math.min(xxX, xxCandidates.length),
                    endPhaseSkill: true,
                },
            })
            addLog(state, `【${name}】可发动【兴学】`)
        }
    }

    // 罪论（诸葛瞻）：观看牌堆顶三张，获得其中X张，然后以任意顺序放回其余的牌
    if (hasSkillById(general, 'zhugezhan_zuilun') && general.alive && state.deck.length > 0) {
        const zuilunMet: string[] = []
        if ((general.damageDealtThisTurn ?? 0) > 0) zuilunMet.push('本回合造成过伤害')
        if (!general.discardedCardThisTurn) zuilunMet.push('本回合未弃置过牌')
        if (isHandMinOverall(state, general)) zuilunMet.push('手牌数为全场最少')
        state.pendingResponseQueue.unshift({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(general),
            context: {
                skillId: 'zhugezhan_zuilun',
                skillName: '罪论',
                description: zuilunMet.length > 0
                    ? `观看牌堆顶三张牌，获得其中${zuilunMet.length}张（${zuilunMet.join('、')}）`
                    : '你未满足任何选项：你与一名其他角色各失去1点体力',
                zuilunMet,
                endPhaseSkill: true,
            },
        })
        addLog(state, `【${name}】可发动【罪论】`)
    }

    // 绝策（界李儒）：对一名本回合失去过牌的其他角色造成1点伤害
    if (hasSkillById(general, 'liru_juece') && general.alive) {
        const jueceCandidates = aliveOthers
            .filter(g => g.lostCardTurn === state.turnSerial)
            .map(g => state.generals.indexOf(g))
        if (jueceCandidates.length > 0) {
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_CHOOSE_TARGET,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    skillId: 'liru_juece',
                    skillName: '绝策',
                    description: '对一名本回合失去过牌的其他角色造成1点伤害',
                    candidateIndices: jueceCandidates,
                    endPhaseSkill: true,
                },
            })
            addLog(state, `【${name}】可发动【绝策】`)
        }
    }

    // 洛书版扩展（九）：结束阶段技能
    triggerBifa(state, general)
    triggerMoshi(state, general)
    triggerShefu(state, general)
    triggerQiluan(state, general)
    triggerShuliang(state, general)
    triggerGoude(state, general)
    triggerDaili(state, general)

    // 自书（马良）①：其他角色的结束阶段结束时，将其本回合获得的牌置入弃牌堆
    for (const zsOwner of state.generals) {
        if (!zsOwner.alive || zsOwner === general || !hasSkillById(zsOwner, 'maliang_zishu')) continue
        const zsGained = new Set(general.gainedCardIdsThisTurn ?? [])
        let zsMoved = 0
        for (const c of [...general.hand]) {
            if (!zsGained.has(c.id)) continue
            general.hand.splice(general.hand.indexOf(c), 1)
            state.discard.push(c)
            zsMoved++
        }
        if (zsMoved > 0) {
            addLog(state, `【${getGeneralName(zsOwner)}】发动【自书】，将【${getGeneralName(general)}】本回合获得的${zsMoved}张牌置入弃牌堆`)
        }
    }
    // 掠城（张曼成）：回合结束时目标展示手牌并可对其依次使用【杀】
    if (general.luechengTurn !== undefined && general.luechengTurn === state.turnSerial
        && general.luechengTarget !== undefined) {
        const lcTarget = state.generals[general.luechengTarget]
        if (lcTarget?.alive && lcTarget !== general) {
            addLog(state, `【${getGeneralName(general)}】的【掠城】：【${getGeneralName(lcTarget)}】展示所有手牌`)
            if (lcTarget.hand.some(c => isSlashLikeCard(c))) {
                state.pendingResponseQueue.push({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: general.luechengTarget,
                    context: {
                        skillId: 'zhangmancheng_luecheng_end', skillName: '掠城',
                        description: '展示手牌中的【杀】，是否对你依次使用这些【杀】？',
                        luechengSourceIndex: state.generals.indexOf(general),
                    },
                })
                addLog(state, `【${getGeneralName(lcTarget)}】可对【${getGeneralName(general)}】依次使用手牌中的【杀】`)
            }
        }
    }
    // 励战（曹仁）：结束阶段结束时，令任意名已受伤的角色各摸一张牌
    triggerLizhan(state, general)
    // 宽释（阚泽）：结束阶段，选择一名角色获得伤害防止
    triggerKuanshi(state, general)
}

/** 骁果结算：目标弃置装备牌（乐进摸一张），否则受到1点伤害 */
export function resolveXiaoguo(state: GameState, yuejin: GeneralInstance, target: GeneralInstance): void {
    const equipSlot = (['weapon', 'armor', 'plus_horse', 'minus_horse'] as const).find(s => target.equip[s])
    if (equipSlot) {
        const card = target.equip[equipSlot]!
        target.equip[equipSlot] = undefined
        state.discard.push(card)
        const drawn = drawCards(state, 1)
        yuejin.hand.push(...drawn)
        addLog(state, `【${getGeneralName(yuejin)}】发动【骁果】，【${getGeneralName(target)}】弃置装备牌，乐进摸一张牌`)
        return
    }
    addLog(state, `【${getGeneralName(yuejin)}】发动【骁果】，【${getGeneralName(target)}】须受到1点伤害`)
    state.pendingResponseQueue.push({
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: state.generals.indexOf(yuejin),
        context: {
            skillId: 'yuejin_xiaoguo_apply',
            skillName: '骁果',
            autoExecute: true,
            xiaoguoSourceIndex: state.generals.indexOf(yuejin),
            xiaoguoTargetIndex: state.generals.indexOf(target),
        } as any,
    })
}


export function finishTurn(state: GameState): void {
    const general = getActiveGeneral(state)
    // 知命（谯周）：弃牌阶段结束时摸一张，然后可置顶一张
    if (general && state.turnPhase === TurnPhase.DISCARD
        && triggerZhiming(state, general, 'discard')) return
    // 逐日（谋姜维）：弃牌阶段结束时手牌数变化则拼点
    if (general) maybeZhuri(state, general)
    // 贵相（族吴苋）：结束阶段同样可被改写为出牌阶段
    if (general && state.pendingResponseQueue.length === 0 && maybeGuixiang(state, general, 'end')) return
    // 穿屋（张华）：回合结束时恢复本回合失去的技能
    restoreChuanwu(state)
    // 观微（潘濬）：于此阶段结束后执行一个额外的出牌阶段
    if (general?.alive && general.extraActionPhase) {
        general.extraActionPhase = false
        addLog(state, `【${getGeneralName(general)}】因【观微】执行一个额外的出牌阶段`)
        beginActionPhase(state, general)
        return
    }
    if (general) {
        // 谦逊（界陆逊）：当前回合结束时，取回因谦逊置于武将牌上的手牌
        for (const g of state.generals) {
            if ((g.generalPile?.length ?? 0) > 0 && g.qianxunPileTurn !== undefined) {
                g.hand.push(...g.generalPile!)
                addLog(state, `【${getGeneralName(g)}】取回【谦逊】置于武将牌上的 ${g.generalPile!.length} 张牌`)
                g.generalPile = []
                g.qianxunPileTurn = undefined
                triggerLiangyinIn(state)
            }
        }

        // 镇卫（文聘）：回合结束时，将因镇卫无效的牌归还给其使用者
        for (const g of state.generals) {
            if ((g.zhenweiRegain?.length ?? 0) === 0) continue
            g.hand.push(...g.zhenweiRegain!)
            addLog(state, `【${getGeneralName(g)}】取回因【镇卫】无效的 ${g.zhenweiRegain!.length} 张牌`)
            g.zhenweiRegain = []
        }

        // 斩腕（曹性）：因流矢减少手牌上限的角色，弃牌阶段结束时若其弃置过牌，
        // 曹性摸等量牌，然后恢复其因流矢减少的手牌上限
        if ((general.liushiPenalty ?? 0) > 0 && (general.discardedHandThisPhase ?? 0) > 0) {
            const zwDiscard = general.discardedHandThisPhase ?? 0
            const zwOwner = state.generals.find(
                (g) => g.alive && hasSkillById(g, 'caoxing_zhanwan'))
            if (zwOwner) {
                const zwDrawn = drawCards(state, zwDiscard)
                zwOwner.hand.push(...zwDrawn)
                addLog(state, `【${getGeneralName(zwOwner)}】发动【斩腕】，摸${zwDrawn.length}张牌`)
            }
            const zwRestore = general.liushiPenalty ?? 0
            general.handLimitPenalty = Math.max(0, (general.handLimitPenalty ?? 0) - zwRestore)
            general.liushiPenalty = 0
            addLog(state, `【${getGeneralName(general)}】因【斩腕】恢复${zwRestore}点手牌上限`)
        }

        runEndPhaseSkills(state, general)

        // 闭月（貂蝉）：结束阶段摸一张；界貂蝉无手牌时改为摸两张
        if (hasSkillById(general, 'diaochan_biyue')) {
            const biyueTwo = general.generalId === 'diaochan_jie' && general.hand.length === 0
            const biyueCount = biyueTwo ? 2 : 1
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    skillId: 'diaochan_biyue',
                    skillName: '闭月',
                    description: biyueTwo ? '没有手牌，摸两张牌' : '摸一张牌',
                    biyueCount,
                },
            })
        }

        // 魂姿（界孙策）：觉醒回合的结束阶段，选择摸两张牌或回复1点体力
        if (general.hunziEndChoice) {
            general.hunziEndChoice = false
            state.pendingResponseQueue.push({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    skillId: 'sunce_hunzi_end',
                    skillName: '魂姿',
                    description: '选择一项：摸两张牌 或 回复1点体力',
                    options: [
                        { action: 'draw', label: '摸两张牌' },
                        { action: 'recover', label: '回复1点体力' },
                    ],
                },
            })
        }

        // 观星（界诸葛亮）：准备阶段将所有牌置于牌堆底后，结束阶段可再次观星
        if (general.guanxingEndAgain) {
            general.guanxingEndAgain = false
            const gxAlive = state.generals.filter(g => g.alive).length
            const gxBase = general.generalId === 'zhugeliang_jie' || general.generalId === 'jiangwei_jie'
                ? (gxAlive < 4 ? 3 : 5)
                : Math.min(gxAlive, 5)
            const gxCount = Math.min(gxBase, state.deck.length)
            if (gxCount > 0) {
                const gxCards = state.deck.splice(0, gxCount)
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_GUANXING_ARRANGE,
                    targetGeneralIndex: state.generals.indexOf(general),
                    context: {
                        guanxingCards: gxCards,
                        guanxingEndPhase: true,
                    },
                })
                addLog(state, `【${getGeneralName(general)}】【观星】结束阶段再次观星${gxCount}张牌`)
            }
        }

        // 劫营②③（神甘宁）：结束阶段交出“营”；持有“营”的其他角色回合结束时，神甘宁获得其所有手牌
        const yingOwner = state.generals.find((g) => g.yingMark)
        if (yingOwner) {
            if (yingOwner === general && hasSkillById(general, 'ganning_shen_jieying')) {
                const yingTarget = state.generals
                    .filter((g) => g.alive && g !== general)
                    .sort((a, b) => (a.faction === general.faction ? 1 : 0) - (b.faction === general.faction ? 1 : 0)
                        || b.hand.length - a.hand.length)[0]
                if (yingTarget) {
                    // ②是“可以将营交给一名其他角色”，由持有者选择目标或放弃
                    const yingCandidates = state.generals
                        .map((g, idx) => ({ g, idx }))
                        .filter(({ g }) => g.alive && g !== general)
                        .map(({ idx }) => idx)
                    if (yingCandidates.length > 0) {
                        state.pendingResponseQueue.push({
                            type: ResponseType.SKILL_CHOOSE_TARGET,
                            targetGeneralIndex: state.generals.indexOf(general),
                            context: {
                                skillId: 'ganning_shen_jieying_give',
                                skillName: '劫营',
                                description: '将“营”交给一名其他角色？',
                                candidateIndices: yingCandidates,
                            },
                        })
                        addLog(state, `【${getGeneralName(general)}】可发动【劫营】将“营”交给一名其他角色`)
                    }
                }
            } else if (yingOwner === general) {
                const jieyingOwner = state.generals.find(
                    (g) => g.alive && hasSkillById(g, 'ganning_shen_jieying'))
                yingOwner.yingMark = false
                if (jieyingOwner && yingOwner.hand.length > 0) {
                    const stolen = yingOwner.hand.splice(0)
                    jieyingOwner.hand.push(...stolen)
                    addLog(state, `【${getGeneralName(jieyingOwner)}】【劫营】移去“营”，获得【${getGeneralName(yingOwner)}】的${stolen.length}张手牌`)
                }
            }
        }

        // 勤学（界吕蒙·觉醒技）：结束阶段，手牌数减体力值至少为2 → 减1点体力上限，摸两张并获得【攻心】
        if (hasSkillById(general, 'lvmeng_jie_qinxue') && !general.awakened
            && general.hand.length - general.hp >= 2) {
            general.awakened = true
            general.maxHp = Math.max(1, general.maxHp - 1)
            if (general.hp > general.maxHp) general.hp = general.maxHp
            state.pendingResponseQueue.push({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    skillId: 'lvmeng_jie_qinxue',
                    skillName: '勤学',
                    description: '觉醒：减1点体力上限，摸两张牌并获得【攻心】',
                    autoExecute: true,
                },
            })
            addLog(state, `【${getGeneralName(general)}】【勤学】觉醒！减1点体力上限`)
        }

        // 诛害（界徐庶）：其他角色的结束阶段，若其本回合造成过伤害，可对其使用一张【杀】
        if ((general.damageDealtThisTurn ?? 0) > 0) {
            for (const xs of state.generals) {
                if (!xs.alive || xs === general) continue
                if (!hasSkillById(xs, 'xushu_zhuhai')) continue
                if (!getAttackRange(xs, general, state.generals).inRange) continue
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: state.generals.indexOf(xs),
                    context: {
                        skillId: 'xushu_zhuhai',
                        skillName: '诛害',
                        description: `对【${getGeneralName(general)}】使用一张【杀】（其本回合造成过伤害）`,
                        zhuhaiTargetIndex: state.generals.indexOf(general),
                    },
                })
                addLog(state, `【${getGeneralName(xs)}】可发动【诛害】`)
            }
        }

        // 承诏（董承）：结束阶段，若本回合获得过至少两张手牌，可与一名角色拼点
        if (hasSkillById(general, 'dongcheng_chengzhao')
            && (general.gainedCardsThisTurn ?? 0) >= 2
            && !general.skillsUsedThisTurn.includes('dongcheng_chengzhao')
            && general.hand.length > 0) {
            const ccTarget = state.generals
                .map((g, i) => ({ g, i }))
                .filter(({ g }) => g.alive && g !== general && g.hand.length > 0)
                .sort((a, b) => a.g.hand.length - b.g.hand.length)[0]
            if (ccTarget) {
                general.skillsUsedThisTurn.push('dongcheng_chengzhao')
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: state.generals.indexOf(general),
                    context: {
                        skillId: 'dongcheng_chengzhao',
                        skillName: '承诏',
                        description: `与【${getGeneralName(ccTarget.g)}】拼点：若你赢，视为对其使用一张无视防具的【杀】`,
                        chengzhaoTargetIndex: ccTarget.i,
                    },
                })
                addLog(state, `【${getGeneralName(general)}】可发动【承诏】`)
            }
        }

        general.hasActed = true
        state.turnPhase = TurnPhase.TURN_END
        // 袭爵（张虎乐綝）：回合结束时，获得X个“爵”（X为本回合造成的伤害值）
        if (hasSkillById(general, 'zhanghulelin_xijue')) {
            const xjGain = Math.max(0, general.damageDealtThisTurn ?? 0)
            if (xjGain > 0) {
                general.jueMarks = (general.jueMarks ?? 0) + xjGain
                addLog(state, `【${getGeneralName(general)}】【袭爵】获得${xjGain}个“爵”（共${general.jueMarks}个）`)
            }
        }
        // 邀名（界全琮）授予的“其回合内赈赡无次数限制”随该角色回合结束失效
        const endingIdx = state.generals.indexOf(general)
        for (const g of state.generals) {
            if (g.zhenshanFreeSeat === endingIdx) g.zhenshanFreeSeat = undefined
        }
        // 勇略（韩浩史涣）：旧版未造成伤害的补偿已按新规则改为攻击范围内直接摸牌
        for (const g of state.generals) {
            g.yonglueWatchIndex = undefined
            g.yonglueTurn = undefined
        }
        // 奋迅（丁奉）：直到回合结束未对其造成伤害，弃置一张牌
        if (general.fenxunTargetIndex !== undefined && !general.fenxunDamagedTarget) {
            const fxTarget = state.generals[general.fenxunTargetIndex]
            const fxHasCard = general.hand.length > 0 || Object.values(general.equip).some(Boolean)
            if (fxTarget?.alive && fxHasCard) {
                addLog(state, `【${getGeneralName(general)}】【奋迅】未对【${getGeneralName(fxTarget)}】造成伤害，须弃置一张牌`)
                state.pendingResponseQueue.push({
                    type: ResponseType.SKILL_PICK_CARD,
                    targetGeneralIndex: state.generals.indexOf(general),
                    context: {
                        skillId: 'dingfeng_fenxun_penalty',
                        skillName: '奋迅',
                        description: '未对其造成伤害，弃置一张牌',
                        count: 1,
                        mode: 'discard',
                        endPhase: true,
                    },
                })
            }
        }
        general.fenxunTargetIndex = undefined
        general.fenxunDamagedTarget = undefined
        // 潜袭（界马岱）：展示牌带来的颜色限制随其回合结束失效
        if (hasSkillById(general, 'madai_qianxi')) {
            for (const g of state.generals) g.qianxiColor = undefined
            general.qianxiCardId = undefined
            general.qianxiTurn = undefined
        }
        // 明鉴（曹叡）：其下个回合的手牌上限与【杀】次数上限加成在本回合结束时失效
        general.mingjianBonus = false
        addLog(state, `【${getGeneralName(general)}】回合结束`)

        // 博图（界吕蒙）：本回合置入弃牌堆的牌包含四种花色时，可执行一个额外回合
        if (hasSkillById(general, 'lvmeng_jie_botu')
            && !general.skillsUsedThisTurn.includes('lvmeng_jie_botu')) {
            const botuRound = state.roundState?.roundNumber ?? 0
            const botuUsed = general.botuRound === botuRound ? (general.botuUses ?? 0) : 0
            const botuLimit = Math.min(3, state.generals.filter((g) => g.alive).length)
            const botuBase = new Set(general.discardBaseline ?? [])
            const botuSuits = new Set(
                state.discard.filter((c) => !botuBase.has(c.id)).map((c) => c.suit))
            const botuReady = botuUsed < botuLimit
                && botuSuits.has(CardSuit.SPADE) && botuSuits.has(CardSuit.HEART)
                && botuSuits.has(CardSuit.CLUB) && botuSuits.has(CardSuit.DIAMOND)
            if (botuReady) {
                general.skillsUsedThisTurn.push('lvmeng_jie_botu')
                general.botuRound = botuRound
                general.botuUses = botuUsed + 1
                state.pendingResponseQueue.push({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: state.generals.indexOf(general),
                    context: {
                        skillId: 'lvmeng_jie_botu',
                        skillName: '博图',
                        description: '本回合置入弃牌堆的牌包含四种花色，可执行一个额外回合',
                    },
                })
                addLog(state, `【${getGeneralName(general)}】可发动【博图】`)
            }
        }

        // 智盟（神鲁肃）：回合结束后，可随机平分自己与一名手牌数受限的其他角色的所有手牌
        triggerZhimeng(state, general)

        // 结束阶段技能还在等待响应（如秘计）：等响应处理完再推进
        if (state.pendingResponseQueue.length > 0) return
    }

    if (state.roundState) {
        state.roundState.turnsThisRound = (state.roundState.turnsThisRound ?? 0) + 1
    }
    advanceAfterTurn(state)
}

/**
 * 飞扬（斗地主地主技）：判定阶段开始时，若判定区有牌，可弃2张手牌再弃置判定区一张牌。
 * @returns true 表示已压入询问，调用方应直接返回等待响应
 */
function maybeFeiyang(state: GameState, general: GeneralInstance): boolean {
    if (state.mode !== GameMode.DOUDIZHU) return false
    if (!hasSkillById(general, 'doudizhu_feiyang')) return false
    if (general.judgeZone.length === 0) return false
    if (general.hand.length < 2) return false
    if (general.skillsUsedThisTurn.includes('doudizhu_feiyang')) return false
    state.pendingResponseQueue.push({
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: state.generals.indexOf(general),
        context: {
            skillId: 'doudizhu_feiyang',
            skillName: '飞扬',
            description: '弃置两张手牌，然后弃置自己判定区内的一张牌',
        },
    })
    addLog(state, `【${getGeneralName(general)}】可发动【飞扬】`)
    return true
}

/** 结束阶段技能结算完毕：队列为空时推进到下一行动单元 */
export function continueEndPhase(state: GameState): void {
    if (state.pendingResponseQueue.length > 0) return
    if (state.turnPhase !== TurnPhase.TURN_END) return
    advanceAfterTurn(state)
}

/** 斗地主：按存活座次轮转；一轮走完则进入新的大回合 */
function advanceLandlordTurn(state: GameState): void {
    const seat = nextLandlordSeat(state)
    if (!seat) return
    if (seat.wrapped) bumpLandlordRound(state)
    const next = state.generals[seat.index]
    if (!next?.alive) return
    state.activeGeneralIndex = seat.index
    state.activePlayerFaction = next.faction
    state.currentActionUnit = undefined
    runTurnStart(state)
}

/** 欢乐成双：按存活座次轮转；一圈走完则进入新的大回合 */
function advancePairTurn(state: GameState): void {
    const seat = nextPairSeat(state)
    if (!seat) return
    if (seat.wrapped) bumpPairRound(state)
    const next = state.generals[seat.index]
    if (!next?.alive) return
    state.activeGeneralIndex = seat.index
    state.activePlayerFaction = next.faction
    state.currentActionUnit = undefined
    runTurnStart(state)
}

/**
 * 安全推进：回合已进入 TURN_END 且没有待响应/无懈窗口时，说明收尾技能已结算完，
 * 推进到下一个行动单元（或斗地主的下一个座次）。避免收尾技能不带推进导致卡死。
 */
export function resumeStalledTurn(state: GameState): boolean {
    if (state.phase !== 'playing') return false
    if (state.pendingResponseQueue.length > 0) return false
    if (state.negateWindow) return false
    const general = getActiveGeneral(state)
    if (!general) return false
    // 摸牌阶段被技能的出牌/伤害结算打断后没有回到回合流程（如眩惑令他人出杀）：
    // 队列为空说明没有待结算项，直接进入出牌阶段，避免回合永久停在 DRAW
    if (state.turnPhase === TurnPhase.DRAW) {
        beginActionPhase(state, general)
        return true
    }
    if (state.turnPhase !== TurnPhase.TURN_END) return false
    advanceAfterTurn(state)
    return true
}

/** finishTurn 中推进到下一个行动单元/大回合的收尾部分 */
export function advanceAfterTurn(state: GameState): void {
    // 回合切换前按“当前回合角色”补一次失去牌检测：弃牌阶段的弃牌就发生在这之前，
    // 等下一回合的界面刷新再检测会把回合内的失去牌误判成回合外（屯田等技能依赖这个归属）
    syncCardState(state, state.activeGeneralIndex)
    // 评荐（许劭）：回合结束，失去此时机获得的技能
    const endingGeneral = state.generals[state.activeGeneralIndex]
    if (endingGeneral) {
        resolveNishouSwaps(state)
        if (endingGeneral.alive) maybeZhuri(state, endingGeneral, true)
        expirePingjian(state, endingGeneral, 'end')
    }
    // 放权（刘禅）：本回合结束后，令一名其他角色执行一个额外回合
    if (state.fangquanFor !== undefined) {
        const extraIdx = state.fangquanFor
        state.fangquanFor = undefined
        const extra = state.generals[extraIdx]
        if (extra?.alive) {
            addLog(state, `【${getGeneralName(extra)}】因【${state.fangquanLabel ?? '放权'}】执行一个额外回合`)
            state.fangquanLabel = undefined
            state.activeGeneralIndex = extraIdx
            runTurnStart(state)
            return
        }
    }

    // 斗地主：不按行动单元轮转，按 1→2→3 号位依次各走一个完整回合
    if (state.mode === GameMode.DOUDIZHU) {
        advanceLandlordTurn(state)
        return
    }

    // 欢乐成双：不按行动单元轮转，按 1→2→3→4 号位依次各走一个完整回合
    if (state.mode === GameMode.HUANLE_SHUANG) {
        advancePairTurn(state)
        return
    }

    const faction = state.activePlayerFaction
    const unit = state.currentActionUnit!

    // 边锋行动单元：检查还有无未行动的边锋
    if (unit === ActionUnitType.FLANKS) {
        const rs = state.roundState
        const flankOrder =
            rs.currentActionStep === 1 ? rs.firstMoverFlankOrder :
                rs.currentActionStep === 3 ? rs.secondMoverFlankOrder :
                    undefined

        const nexts = getUnitCandidates(state, faction, unit, flankOrder)
        if (nexts.length > 0) {
            state.activeGeneralIndex = state.generals.indexOf(nexts[0])
            runTurnStart(state)
            return
        }
    }

    // 行动单元结束，推进到下一步
    advanceStep(state)
}

// ─────────────────────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────────────────────

/** 手牌数是否为全场最多（并列最多也算，奋励） */
function isHandMaxOverall(state: GameState, general: GeneralInstance): boolean {
    return state.generals.every(
        (g) => !g.alive || g === general || g.hand.length <= general.hand.length,
    )
}

/** 体力值是否为全场最多（并列最多也算，奋励） */
function isHpMaxOverall(state: GameState, general: GeneralInstance): boolean {
    return state.generals.every(
        (g) => !g.alive || g === general || g.hp <= general.hp,
    )
}

/** 装备区里牌的数量 */
function equipCountOf(general: GeneralInstance): number {
    return Object.values(general.equip).filter(Boolean).length
}

/** 装备区有牌且数量为全场最多（奋励） */
function isEquipMaxOverall(state: GameState, general: GeneralInstance): boolean {
    const mine = equipCountOf(general)
    if (mine === 0) return false
    return state.generals.every(
        (g) => !g.alive || g === general || equipCountOf(g) <= mine,
    )
}

/** 手牌数是否为全场最少（并列最少也算，罪论） */
function isHandMinOverall(state: GameState, general: GeneralInstance): boolean {
    return state.generals.every(
        (g) => !g.alive || g === general || g.hand.length >= general.hand.length,
    )
}

function isSlashCard(card: Card): boolean {
    return card.category === CardCategory.BASIC
        && (card.name === 'attack' || card.name === 'fire_slash' || card.name === 'thunder_slash')
}

function hasYingziSkill(general: GeneralInstance): boolean {
    return hasSkillById(general, 'zhouyu_yingzi') || hasSkillById(general, 'zhouyu_jie_yingzi') || hasSkillById(general, 'sunce_yingzi')
}

/** 检查武将是否拥有某技能（含原生技能 + 觉醒后获得的技能） */
function hasSkillById(general: GeneralInstance, skillId: string): boolean {
    const gid = general.generalId
    if (general.lostSkills?.some((id) => skillMatches(gid, id, skillId))) return false
    const def = getGeneralById(gid)
    const hasNative = def?.skills.some(s => skillMatches(gid, s.id, skillId)) ?? false
    const hasAcquired = general.acquiredSkills?.some((id) => skillMatches(gid, id, skillId)) ?? false
    return hasNative || hasAcquired
}

function getGeneralName(general: GeneralInstance): string {
    const def = getGeneralById(general.generalId)
    return def?.name ?? general.generalId
}

function factionName(f: Faction): string {
    return f === Faction.WARM ? '暖色方' : '冷色方'
}

function suitName(suit: CardSuit): string {
    const map: Record<string, string> = {
        spade: '♠', heart: '♥', club: '♣', diamond: '♦',
    }
    return map[suit] ?? suit
}

function valueName(value: number): string {
    const map: Record<number, string> = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' }
    return map[value] ?? String(value)
}
/** 良姻②（周妃）：有牌从游戏外（武将牌上等）进入角色手牌区时询问 */
function triggerLiangyinIn(state: GameState): void {
    for (const ly of state.generals) {
        if (!ly.alive || !hasSkillById(ly, 'zhoufei_liangyin')) continue
        if (ly.skillsUsedThisTurn.includes('zhoufei_liangyin_in')) continue
        // 同一动作里可能既被技能直接调用又被牌区差集命中，已在队列中就不再重复询问
        if (state.pendingResponseQueue.some(p => (p.context as any)?.skillId === 'zhoufei_liangyin_in'
            && p.targetGeneralIndex === state.generals.indexOf(ly))) continue
        const victim = state.generals
            .filter(o => o !== ly && o.alive && o.hand.length < ly.hand.length)
            .sort((a, b) => a.hand.length - b.hand.length)[0]
        if (!victim) continue
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(ly),
            context: {
                skillId: 'zhoufei_liangyin_in',
                skillName: '良姻',
                description: `令【${getGeneralName(victim)}】弃置一张牌`,
                liangyinVictimIndex: state.generals.indexOf(victim),
            },
        })
    }
}
