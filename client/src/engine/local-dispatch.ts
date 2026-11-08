import {
    C2S_ChooseActionUnit,
    C2S_Discard,
    C2S_NegateRespond,
    C2S_Respond,
    C2S_UseCard,
    C2S_UseSkill,
    C2S_YieldChoice,
    Faction,
    GameMode,
    GamePhase,
    GameState,
    ResponseType,
    TurnPhase,
} from 'sgs3v3-shared'
import { useGameStore } from '../store/gameStore'
import {
    checkAndOpenNegateWindow,
    handleNegateRespond,
    handleRespond,
    handleUseCard,
    handleUseSkill,
    negateWindowTimeout,
    processAutoExecutePending,
    syncCardState,
} from './game-actions'
import { addLog, checkGameOver, toClientView } from './game-state'
import { aiRespond, aiAct, describeOption, takeDraftTraces, takePlayTrace, takeSkillTrace } from './local-ai'
import { AI_PLAYER_ID, HUMAN_PLAYER_ID, createLocalMatch, currentPickFaction, handlePickYield, localDeployGenerals, localPickGeneral } from './local-match'
import { chooseActionUnit, handleDiscard, handleEndTurn, handleYieldChoice, resumeStalledTurn } from './turn-manager'
import { getRandomSeed } from './rng'
import { beginMatchLog, captureSnapshot, finishMatchLog, recordDecision, recordMatchAction, type DecisionSnapshot } from './match-log'
import { aiLandlordDraft } from '../modes/FightTheLandlord/landlord-draft'
import { createLandlordMatch, landlordPickGeneral, setupLandlordPlay, type LandlordSide } from '../modes/FightTheLandlord/landlord-match'
import { createPairMatch, pairPickGeneral, setupPairPlay } from '../modes/HappyPair/pair-match'
import { aiPairDraft } from '../modes/HappyPair/pair-draft'

let activeGame: GameState | null = null
/** 斗地主：本地玩家执哪一方（统率三军为 null） */
let activeLandlordSide: LandlordSide | null = null
/** 欢乐成双：本地玩家执哪个阵营（其他模式为 null） */
let activePairSide: Faction | null = null
/** 左右手对弈：两边都是本地玩家，不跑 AI */
let hotseatMode = false

export function isHotseatMatch(): boolean {
    return hotseatMode
}

/**
 * 当前操作的本地玩家 id。
 * 左右手对弈时没有固定的“我”，按待响应方 → 出牌武将 → 当前行动方的顺序推断。
 */
function actorId(state: GameState, payload?: { generalIndex?: number }): string {
    if (!hotseatMode) return HUMAN_PLAYER_ID
    if (typeof payload?.generalIndex === 'number' && state.generals[payload.generalIndex]) {
        return state.generals[payload.generalIndex].playerId
    }
    const pending = state.pendingResponseQueue[0]
    if (pending) {
        const responder = state.generals[pending.targetGeneralIndex]
        if (responder) return responder.playerId
    }
    const active = state.generals[state.activeGeneralIndex]
    if (active) return active.playerId
    return state.activePlayerFaction === Faction.WARM ? state.warmPlayerId : state.coolPlayerId
}

/** 部署阶段：按所选武将归属推断是谁在部署 */
function deployFactionFor(state: GameState, ids: string[]): Faction {
    const pick = state.pickState
    const ds = state.deployState
    if (pick && ds) {
        if (!ds.warmDeployed && ids.every(id => pick.warmPicked.some(g => g.id === id))) return Faction.WARM
        if (!ds.coolDeployed) return Faction.COOL
    }
    return Faction.WARM
}

/** AI 每步之间的停顿（毫秒）；0 表示瞬时结算 */
let paceMs = 320
let stepTimer: ReturnType<typeof setTimeout> | null = null
let paceToken = 0

export function getLocalPace(): number {
    return paceMs
}

export function setLocalPace(ms: number): void {
    paceMs = Math.max(0, Math.floor(ms))
}

function stopPacing(): void {
    paceToken++
    if (stepTimer !== null) {
        clearTimeout(stepTimer)
        stepTimer = null
    }
}

export function getLocalState(): GameState | null {
    return activeGame
}

export function isLocalMatchActive(): boolean {
    return activeGame !== null
}

/** 当前单机对局的随机种子；无对局时返回 null */
export function getLocalSeed(): number | null {
    return activeGame ? getRandomSeed() : null
}

export function startLocalMatch(humanFaction: Faction, seed?: number): void {
    hotseatMode = false
    activeLandlordSide = null
    activePairSide = null
    activeGame = createLocalMatch(humanFaction, seed)
    beginMatchLog(activeGame, getRandomSeed(), 'classic')
    const store = useGameStore.getState()
    store.setMode(GameMode.CLASSIC)
    store.setLandlordSide(null)
    store.setHotseat(false)
    store.setHotseatViews(null)
    store.setPlayerId(HUMAN_PLAYER_ID)
    store.setNickname('我')
    store.setRoomCode('local')
    store.setMyFaction(humanFaction)
    store.setIsSpectator(false)
    store.setWinnerFaction(null)
    store.setError(null)
    store.clearSelection()
    publish()
}

/** 左右手对弈：暖方 HUMAN_PLAYER_ID、冷方 HUMAN2_PLAYER_ID，同屏两方都由本地玩家操作 */
export function startLocalHotseatMatch(seed?: number): void {
    hotseatMode = true
    activeLandlordSide = null
    activePairSide = null
    activeGame = createLocalMatch(Faction.WARM, seed, true)
    beginMatchLog(activeGame, getRandomSeed(), 'hotseat')
    const store = useGameStore.getState()
    store.setMode(GameMode.CLASSIC)
    store.setLandlordSide(null)
    store.setHotseat(true)
    store.setHotseatViews(null)
    store.setPlayerId(HUMAN_PLAYER_ID)
    store.setNickname('暖方')
    store.setRoomCode('local')
    store.setMyFaction(Faction.WARM)
    store.setIsSpectator(false)
    store.setWinnerFaction(null)
    store.setError(null)
    store.clearSelection()
    publish()
}

/** 斗地主：本地玩家执地主或农民（两个农民同屏控制） */
export function startLocalLandlordMatch(side: LandlordSide, seed?: number): void {
    hotseatMode = false
    activeLandlordSide = side
    activePairSide = null
    activeGame = createLandlordMatch(side, seed)
    beginMatchLog(activeGame, getRandomSeed(), 'doudizhu')
    const store = useGameStore.getState()
    store.setHotseat(false)
    store.setHotseatViews(null)
    store.setMode(GameMode.DOUDIZHU)
    store.setLandlordSide(side)
    store.setPlayerId(HUMAN_PLAYER_ID)
    store.setNickname(side === 'landlord' ? '地主' : '农民')
    store.setRoomCode('local')
    store.setMyFaction(side === 'landlord' ? Faction.WARM : Faction.COOL)
    store.setIsSpectator(false)
    store.setWinnerFaction(null)
    store.setError(null)
    store.clearSelection()
    publish()
}

/** 欢乐成双：本地玩家执冷色（1、4 号位）或暖色（2、3 号位） */
export function startLocalPairMatch(side: Faction, seed?: number): void {
    hotseatMode = false
    activeLandlordSide = null
    activePairSide = side
    activeGame = createPairMatch(side, seed)
    beginMatchLog(activeGame, getRandomSeed(), 'huanle_shuang')
    const store = useGameStore.getState()
    store.setHotseat(false)
    store.setHotseatViews(null)
    store.setMode(GameMode.HUANLE_SHUANG)
    store.setLandlordSide(null)
    store.setPlayerId(HUMAN_PLAYER_ID)
    store.setNickname(side === Faction.WARM ? '暖方' : '冷方')
    store.setRoomCode('local')
    store.setMyFaction(side)
    store.setIsSpectator(false)
    store.setWinnerFaction(null)
    store.setError(null)
    store.clearSelection()
    publish()
}

/** 欢乐成双选将：人类点选自己阵营座位的武将（AI 席位由模型或规则 AI 补齐） */
export function dispatchLocalPairPick(seat: number, generalId: string): void {
    const state = activeGame
    if (!state) return
    const logFrom = state.log.length
    const decisionSnapshot = captureSnapshot(state)
    const result = pairPickGeneral(state, seat, generalId)
    if ('error' in result) return useGameStore.getState().setError(result.error)
    // 规则 AI 补齐的选将轨迹记进对局日志
    recordAiDecision(state, decisionSnapshot, logFrom)
    useGameStore.getState().setError(null)
    publish()
}

/** 斗地主选将：人类点选自己一方的席位的武将 */
export function dispatchLocalLandlordPick(poolIndex: number, generalId: string): void {
    const state = activeGame
    if (!state) return
    const result = landlordPickGeneral(state, poolIndex, generalId)
    if ('error' in result) return useGameStore.getState().setError(result.error)
    // AI 一方即时补齐（三方同时选）
    const logFrom = state.log.length
    const decisionSnapshot = captureSnapshot(state)
    aiLandlordDraft(state, () => {})
    recordAiDecision(state, decisionSnapshot, logFrom)
    useGameStore.getState().setError(null)
    publish()
}

export function exitLocalMatch(): void {
    stopPacing()
    finishMatchLog()
    activeGame = null
    hotseatMode = false
    activeLandlordSide = null
    activePairSide = null
    const store = useGameStore.getState()
    store.setGameState(null)
    store.setWinnerFaction(null)
    store.setPlayerId(null)
    store.setRoomCode(null)
    store.setMyFaction(null)
    store.setHotseat(false)
    store.setHotseatViews(null)
    store.clearSelection()
}

export function dispatchLocalPickGeneral(generalId: string): void {
    const state = activeGame
    if (!state) return
    // 非热座只替己方阵营出手；热座按引擎的当前轮次切换操作方
    const faction = hotseatMode ? currentPickFaction(state) : state.players[HUMAN_PLAYER_ID]?.faction
    if (!faction) {
        const store = useGameStore.getState()
        store.setError(state.pickState?.waitingForPickYield ? '请先选择先选/让先' : '现在还不是你选将')
        publish()
        return
    }
    const result = localPickGeneral(state, faction, generalId)
    if ('error' in result) {
        useGameStore.getState().setError(result.error)
        // 界面可能停在旧局面上（例如刚被对方选走），重新推一次让卡片状态与引擎对齐
        publish()
        return
    }
    publish()
}

export function dispatchLocalDeployGenerals(commander: string, flankA: string, flankB: string): void {
    const state = activeGame
    if (!state) return
    const faction = hotseatMode
        ? deployFactionFor(state, [commander, flankA, flankB])
        : state.players[HUMAN_PLAYER_ID]?.faction
    if (!faction) return
    const result = localDeployGenerals(state, faction, commander, flankA, flankB)
    if ('error' in result) return useGameStore.getState().setError(result.error)
    publish()
}

export function dispatchLocalChooseActionUnit(data: C2S_ChooseActionUnit): void {
    runHuman((state) => chooseActionUnit(state, actorId(state), data.unit, data.flankOrder),
        { kind: 'choose_unit', payload: data })
}

export function dispatchLocalUseCard(data: C2S_UseCard): void {
    runHuman((state) => handleUseCard(state, actorId(state), data), { kind: 'use_card', payload: data })
}

export function dispatchLocalUseSkill(data: C2S_UseSkill): void {
    runHuman((state) => handleUseSkill(state, actorId(state), data), { kind: 'use_skill', payload: data })
}

export function dispatchLocalRespond(data: C2S_Respond): void {
    runHuman((state) => handleRespond(state, actorId(state, data), data), { kind: 'respond', payload: data })
}

export function dispatchLocalNegateRespond(data: C2S_NegateRespond): void {
    runHuman((state) => handleNegateRespond(state, actorId(state, data), data), { kind: 'negate', payload: data })
}

export function dispatchLocalYieldChoice(data: C2S_YieldChoice): void {
    if (data.phase === 'pick') {
        runHuman((state) => {
            const faction = hotseatMode ? Faction.WARM : state.players[HUMAN_PLAYER_ID]?.faction
            if (!faction) return { error: '玩家不存在' }
            return handlePickYield(state, faction, data.yield)
        }, { kind: 'yield_pick', payload: data })
        return
    }
    runHuman((state) => handleYieldChoice(state, actorId(state), data.yield), { kind: 'yield', payload: data })
}

export function dispatchLocalEndTurn(): void {
    runHuman((state) => handleEndTurn(state, actorId(state)), { kind: 'end_turn' })
}

export function dispatchLocalDiscard(data: C2S_Discard): void {
    runHuman((state) => handleDiscard(state, actorId(state), data.cardIds), { kind: 'discard', payload: data })
}

/** 单机认输：直接判本方失败，交给路由跳转结算页 */
export function dispatchLocalSurrender(): void {
    const state = activeGame
    if (!state || state.phase === GamePhase.GAME_OVER) return
    const faction = hotseatMode
        ? state.activePlayerFaction
        : state.players[HUMAN_PLAYER_ID]?.faction
    if (!faction) return
    stopPacing()
    state.phase = GamePhase.GAME_OVER
    const store = useGameStore.getState()
    const winner = faction === Faction.WARM ? Faction.COOL : Faction.WARM
    store.setWinnerFaction(winner)
    store.setGameState(toClientView(state, HUMAN_PLAYER_ID))
    finishMatchLog(winner)
}

/** 单机重开：保留当前模式与阵营，重新开始一局 */
export function dispatchLocalRestart(): void {
    if (hotseatMode) return startLocalHotseatMatch()
    if (activeLandlordSide) return startLocalLandlordMatch(activeLandlordSide)
    if (activePairSide) return startLocalPairMatch(activePairSide)
    const faction = activeGame?.players[HUMAN_PLAYER_ID]?.faction
    if (!faction) return
    startLocalMatch(faction)
}

/** 斗地主 / 欢乐成双的 AI 席位没有推进循环兜底，局面停在选将时要由规则 AI 补齐 */
function fillAiDraftByRule(state: GameState): void {
    if (hotseatMode || state.phase !== GamePhase.GENERAL_PICK) return
    if (state.mode === GameMode.DOUDIZHU) aiLandlordDraft(state, () => setupLandlordPlay(state))
    else if (state.mode === GameMode.HUANLE_SHUANG) aiPairDraft(state, () => setupPairPlay(state))
}

function runHuman(
    action: (state: GameState) => { error: string } | void,
    meta?: { kind: string; payload?: unknown },
): void {
    const state = activeGame
    if (!state) return
    const logFrom = state.log.length
    let result: { error: string } | void
    try {
        result = action(state)
    } catch (err) {
        // 引擎结算中途抛异常时不能就此吞掉：界面还停在旧局面上，所有按钮都会显得“点不动”
        console.error('[local-dispatch] 玩家操作结算异常，已重新同步界面', err)
        useGameStore.getState().setError(`结算异常：${(err as Error)?.message ?? String(err)}`)
        try { publish() } catch (err2) { console.error('[local-dispatch] 界面刷新失败', err2) }
        return
    }
    if (meta) {
        recordMatchAction(state, meta.kind, meta.payload, logFrom, {
            side: hotseatMode ? 'hotseat' : 'human',
            error: result && 'error' in result ? result.error : undefined,
        })
    }
    if (result && 'error' in result) {
        useGameStore.getState().setError(result.error)
        // 界面可能停留在旧局面上（例如点击了已经失效的按钮），重新推一次状态让操作项与真实局面同步
        publish()
        return
    }
    useGameStore.getState().setError(null)
    publish()
}

function publish(): void {
    const state = activeGame
    if (!state) return
    stopPacing()
    const token = paceToken
    reveal(state)
    if (paceMs <= 0) {
        runSteps(state, token)
        return
    }
    stepTimer = setTimeout(() => runSteps(state, token), 0)
}

/** 把当前引擎状态推给界面 */
function reveal(state: GameState): void {
    if (activeGame !== state) return
    // 回合管理里“从武将牌上取回牌”等变化不会经过动作包装函数，这里补一次检测
    syncCardState(state)
    finishIfOver(state)
    const store = useGameStore.getState()
    if (!hotseatMode) {
        store.setGameState(toClientView(state, HUMAN_PLAYER_ID))
        return
    }
    const warmView = toClientView(state, state.warmPlayerId)
    const coolView = toClientView(state, state.coolPlayerId)
    store.setHotseatViews({ warm: warmView, cool: coolView })
    // 选将/部署阶段是单人操作，主视图跟随当前操作的阵营
    if (state.phase === GamePhase.GENERAL_PICK && !state.pickState?.waitingForPickYield) {
        const faction = currentPickFaction(state) ?? Faction.WARM
        store.setMyFaction(faction)
        store.setGameState(faction === Faction.COOL ? coolView : warmView)
        return
    }
    if (state.phase === GamePhase.DEPLOY && state.deployState) {
        const faction = state.deployState.warmDeployed ? Faction.COOL : Faction.WARM
        store.setMyFaction(faction)
        store.setGameState(faction === Faction.COOL ? coolView : warmView)
        return
    }
    store.setMyFaction(Faction.WARM)
    store.setGameState(warmView)
}

/** 判定胜负；一旦结束就锁定为 GAME_OVER，让路由跳转结算页 */
function finishIfOver(state: GameState): boolean {
    if (state.phase === GamePhase.GAME_OVER) return true
    if (state.phase !== GamePhase.PLAYING) return false
    const over = checkGameOver(state)
    if (!over.over) return false
    state.phase = GamePhase.GAME_OVER
    useGameStore.getState().setWinnerFaction(over.winnerFaction ?? null)
    finishMatchLog(over.winnerFaction ?? null)
    return true
}

/**
 * 反复驱动自动结算与 AI，直到需要人类操作或状态不再变化。
 * 每出现一次可见事件（新日志）就推一次界面并停顿，玩家才能看清 AI 的出牌；
 * 纯粹的内部状态变化则连续跑完，不做无意义等待。
 */
function runSteps(state: GameState, token: number): void {
    stepTimer = null
    if (token !== paceToken || activeGame !== state) return
    for (let i = 0; i < 500; i++) {
        if (finishIfOver(state)) {
            reveal(state)
            return
        }
        fillAiDraftByRule(state)
        const logBefore = state.log.length
        let advanced = false
        try {
            advanced = stepOnce(state)
        } catch (err) {
            // 结算过程中抛出异常时不能中断计时链，否则界面会停在半截对局
            console.warn('[local-dispatch] 结算步骤异常，已跳过', err)
            advanced = true
        }
        if (!advanced) {
            reveal(state)
            return
        }
        const visible = state.log.length > logBefore
        if (state.phase === GamePhase.GAME_OVER) {
            reveal(state)
            return
        }
        if (visible) {
            reveal(state)
            if (paceMs > 0) {
                stepTimer = setTimeout(() => runSteps(state, token), paceMs)
                return
            }
        }
    }
    reveal(state)
}

/**
 * 把规则 AI 刚刚做出的决策（出牌/技能/选将）连同当时的局面写进对局日志，
 * 复盘时能看出它当时看到了哪些候选、各自多少分、最后选了哪个。
 */
function recordAiDecision(state: GameState, decisionSnapshot: DecisionSnapshot, logFrom: number): void {
    const play = takePlayTrace()
    const skill = takeSkillTrace()
    const drafts = takeDraftTraces()
    if (!play && !skill && drafts.length === 0) return
    const logs = state.log.slice(logFrom).map(l => l.text)
    const seat = Math.max(0, state.activeGeneralIndex)
    for (const draft of drafts) {
        const winner = draft.candidates.find(c => c.chosen)
        recordDecision(state, {
            logFrom,
            kind: 'pick',
            source: 'rule',
            side: 'ai',
            seat,
            plan: draft.phase,
            snapshot: decisionSnapshot,
            candidates: draft.candidates.map(c => ({
                id: c.id,
                ruleId: `draft:${draft.phase}`,
                label: c.id,
                score: c.score,
                chosen: c.chosen,
            })),
            chosen: winner
                ? { id: winner.id, ruleId: `draft:${draft.phase}`, label: winner.id, score: winner.score, chosen: true }
                : null,
            logs,
        })
    }
    if (play) {
        const winner = play.candidates.find(c => c.chosen)
        recordDecision(state, {
            logFrom,
            kind: 'play',
            source: 'rule',
            side: 'ai',
            seat,
            plan: play.plan,
            snapshot: decisionSnapshot,
            candidates: play.candidates.map(c => ({
                id: c.key,
                ruleId: c.key,
                label: describeOption(c.key),
                score: c.score,
                finalScore: c.final,
                chosen: c.chosen,
            })),
            chosen: winner
                ? {
                    id: winner.key,
                    ruleId: winner.key,
                    label: describeOption(winner.key),
                    score: winner.score,
                    finalScore: winner.final,
                    chosen: true,
                }
                : null,
            logs,
        })
    }
    if (skill) {
        recordDecision(state, {
            logFrom,
            kind: 'skill',
            source: 'rule',
            side: 'ai',
            seat,
            plan: skill.skillId,
            snapshot: decisionSnapshot,
            candidates: skill.options.map(action => ({
                id: `${skill.skillId}->${action}`,
                ruleId: skill.skillId,
                label: action,
                score: 0,
                chosen: action === skill.chosen,
            })),
            chosen: {
                id: `${skill.skillId}->${skill.chosen}`,
                ruleId: skill.skillId,
                label: skill.chosen,
                score: 0,
                chosen: true,
            },
            logs,
        })
    }
}

function stepOnce(state: GameState): boolean {
    const before = snapshot(state)
    processAutoExecutePending(state)
    if (resumeStalledTurn(state)) return snapshot(state) !== before
    checkAndOpenNegateWindow(state)
    if (state.negateWindow) {
        // 无懈窗口打开时必须让 AI 表态：否则只要有人握着无懈，窗口就永远等不到“放弃”，
        // 人类那边又只有“等待对方决定”，整局就此停住。aiAct 内部只处理窗口本身，不会再动其它 pending。
        // 一次表态可能引出反无懈、再引出新的表态，因此循环到窗口结算或已无可表态者为止。
        if (!hotseatMode) {
            for (let guard = 0; guard < 6; guard++) {
                if (!state.negateWindow || !state.negateWindow.anyoneHasNegate) break
                const passedBefore: number = state.negateWindow.passedPlayerIds.length
                try {
                    if (!aiAct(state)) break
                } catch (err) {
                    console.warn('[local-dispatch] AI 无懈决策抛出异常，已跳过', err)
                    break
                }
                if (state.negateWindow?.passedPlayerIds.length === passedBefore
                    && state.negateWindow?.anyoneHasNegate) break
            }
        }
        // 双方都表态完（或已经没人握有无懈）后立即结算；联网端由 3 秒定时器兜底
        if (state.negateWindow && !state.negateWindow.anyoneHasNegate) {
            negateWindowTimeout(state)
        }
        return snapshot(state) !== before
    }
    if (!hotseatMode) {
        const logFrom = state.log.length
        const frontBefore = state.pendingResponseQueue[0]
        const frontKeyBefore = pendingKey(frontBefore)
        const decisionSnapshot = captureSnapshot(state)
        try {
            aiAct(state)
        } catch (err) {
            console.warn('[local-dispatch] AI 步骤抛出异常，已跳过', err)
        }
        recordAiDecision(state, decisionSnapshot, logFrom)
        if (state.log.length > logFrom) {
            recordMatchAction(state, 'ai_step', undefined, logFrom, { side: 'ai' })
        }
        // AI 卡在某个待响应上时，再由 AI 明确回一次；仍未推进则记入停滞计数
        // （用“队首类型+响应者”判断是否推进：濒死询问/判定介入是轮转给下一个人，不是队列长度变化）
        if (frontBefore && pendingKey(state.pendingResponseQueue[0]) === frontKeyBefore
            && state.generals[state.pendingResponseQueue[0].targetGeneralIndex]?.playerId === AI_PLAYER_ID) {
            try {
                aiRespond(state, AI_PLAYER_ID)
            } catch (err) {
                console.warn('[local-dispatch] AI 响应抛出异常，已跳过', err)
            }
        }
        // AI 明知轮到自己、却在这一步里完全无法推进这条询问：直接跳过并留痕，
        // 否则界面会永久停在同一条提示上（人类没有任何按钮可点）。
        if (frontBefore && pendingKey(state.pendingResponseQueue[0]) === frontKeyBefore) {
            const head = state.pendingResponseQueue[0]
            const stuckOwner = state.generals[head.targetGeneralIndex]
            const ownerIsAi = !stuckOwner || !stuckOwner.alive
                || stuckOwner.playerId === AI_PLAYER_ID
            if (ownerIsAi) {
                if (head.type === ResponseType.PEACH_SAVE_ASK) {
                    // 濒死询问绝不能被丢弃：按“无人救援”结算，否则该角色会以 0 体力继续行动
                    handleRespond(state, AI_PLAYER_ID, { action: 'skip_all' } as any)
                } else {
                    state.pendingResponseQueue.shift()
                    addLog(state, `【${head.context?.skillName ?? '待操作'}】无法完成，已自动跳过`)
                }
            }
        }
        noteStalledPending(state)
    }
    return snapshot(state) !== before
}

/**
 * 兜底：某个待响应连续多步毫无进展（技能询问异常、响应目标已离场等）时丢弃该提示，
 * 避免界面只剩一句提示、双方都无法操作。轮到人类操作的提示不受影响。
 */
let stalledPending: { pending: GameState['pendingResponseQueue'][number]; steps: number } | null = null

function noteStalledPending(state: GameState): void {
    const front = state.pendingResponseQueue[0]
    if (!front) {
        stalledPending = null
        return
    }
    if (stalledPending?.pending !== front) {
        stalledPending = { pending: front, steps: 0 }
        return
    }
    stalledPending.steps++
    const owner = state.generals[front.targetGeneralIndex]
    const hopeless = !owner || !owner.alive
    if (!hopeless && owner.playerId !== AI_PLAYER_ID) return
    if (stalledPending.steps < 3) return
    if (front.type === ResponseType.PEACH_SAVE_ASK && owner && owner.alive) {
        // 濒死询问不能被丢弃：按“无人救援”结算，否则该角色会以 0 体力继续行动
        stalledPending = null
        handleRespond(state, owner.playerId, { action: 'skip_all' } as any)
        return
    }
    state.pendingResponseQueue.shift()
    stalledPending = null
    addLog(state, `【${front.context?.skillName ?? '待操作'}】无法完成，已自动跳过`)
}

/** 队首询问的“身份”：类型 + 响应者（用于判断这一步是否真的推进了） */
function pendingKey(p: GameState['pendingResponseQueue'][number] | undefined): string {
    if (!p) return ''
    const ctx = (p.context ?? {}) as any
    return `${p.type}#${p.targetGeneralIndex}#${ctx.dyingGeneralIndex ?? ''}`
}

function snapshot(state: GameState): string {
    return [
        state.phase,
        state.turnPhase,
        state.activeGeneralIndex,
        state.roundState.roundNumber,
        state.roundState.currentActionStep,
        state.pickState?.pickStep ?? -1,
        state.pickState?.warmPicked.length ?? 0,
        state.pickState?.coolPicked.length ?? 0,
        state.deployState ? `${state.deployState.warmDeployed}/${state.deployState.coolDeployed}` : '-',
        state.pendingResponseQueue.length,
        // 队首换了响应者也算推进（濒死询问/判定介入会在同一位置轮转给下一个人）
        state.pendingResponseQueue[0]
            ? `${state.pendingResponseQueue[0].type}#${state.pendingResponseQueue[0].targetGeneralIndex}`
            : '-',
        state.negateWindow?.startedAt ?? 0,
        state.log.length,
        state.deck.length,
        state.discard.length,
        state.generals.map((g) => `${g.hp}/${g.hand.length}/${g.alive ? 1 : 0}`).join(','),
    ].join('|')
}

