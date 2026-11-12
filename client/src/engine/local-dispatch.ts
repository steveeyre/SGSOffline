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
    SkillLimitRule,
    TurnPhase,
} from 'sgs3v3-shared'
import { useGameStore } from '../store/gameStore'
import {
    checkAndOpenNegateWindow,
    exportJianmieColors,
    handleNegateRespond,
    handleRespond,
    handleUseCard,
    handleUseSkill,
    importJianmieColors,
    negateWindowTimeout,
    processAutoExecutePending,
    syncCardState,
} from './game-actions'
import { addLog, checkGameOver, toClientView } from './game-state'
import { exportMemory, importMemory, knownHand, poolView, type MemoryEntry } from './ai-memory'
import { KEY_CARD_COUNTS } from './deck-meta'
import { getGeneralById } from './generals'
import { aiRespond, aiAct, describeOption, listPlayOptions, takeDraftTraces, takePlayTrace, takeSkillTrace } from './local-ai'
import { AI_PLAYER_ID, HUMAN_PLAYER_ID, createLocalMatch, currentPickFaction, handlePickYield, localDeployGenerals, localPickGeneral } from './local-match'
import { chooseActionUnit, handleDiscard, handleEndTurn, handleYieldChoice, resumeStalledTurn } from './turn-manager'
import { getRandomCursor, getRandomSeed, setRandomCursor, setRandomSeed } from './rng'
import {
    beginMatchLog, captureSnapshot, exportCurrentMatchLog, finishMatchLog, recordDecision, recordMatchAction,
    resumeMatchLog, type DecisionSnapshot, type MatchLogRecord,
} from './match-log'
import { aiLandlordDraft } from '../modes/FightTheLandlord/landlord-draft'
import {
    createLandlordMatch, landlordConfirmPick, landlordPickGeneral, landlordPointPick,
    setupLandlordPlay, type LandlordSide,
} from '../modes/FightTheLandlord/landlord-match'
import {
    createPairMatch, pairConfirmPick, pairPickGeneral, pairPointPick, setupPairPlay,
} from '../modes/HappyPair/pair-match'
import { aiPairDraft } from '../modes/HappyPair/pair-draft'
import { pairSeatsOf } from '../modes/HappyPair/pair-draft'
import { readStorageItem, removeStorageItem } from './storage-keys'

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

/** AI 每步之间的停顿（毫秒）：正常 700（看清每一步）、快速 320（原有速度） */
let paceMs = 700
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

export interface CardCountStat {
    key: keyof typeof KEY_CARD_COUNTS
    label: string
    /** 还没露面、仍可能在牌堆或敌方手里的张数 */
    left: number
    /** 已经使用/弃置的张数（仅四大基础牌统计） */
    played: number
}

const POOL_LABELS: Array<[keyof typeof KEY_CARD_COUNTS, string]> = [
    ['slash', '杀'],
    ['dodge', '闪'],
    ['peach', '桃'],
    ['negate', '无懈可击'],
    ['wine', '酒'],
    ['duel', '决斗'],
    ['fire_attack', '火攻'],
    ['harvest', '五谷丰登'],
    ['arrows', '万箭齐发'],
    ['barbarians', '南蛮入侵'],
    ['peach_garden', '桃园结义'],
    ['overindulgence', '乐不思蜀'],
    ['supply_shortage', '兵粮寸断'],
    ['crossbow', '诸葛连弩'],
]

const PLAYED_KINDS = new Set(['slash', 'dodge', 'peach', 'negate'])

/** 教练提示：与规则 AI 共用同一张决策表，只列候选不执行 */
export interface CoachSuggestion {
    key: string
    label: string
    score: number
    gain: number
    risk: number
    strategic: number
    turnValue: number
}

/** 当前出牌阶段 AI 会怎么打：取分数最高的前几个候选，不改变局面 */
export function getCoachSuggestions(): CoachSuggestion[] {
    const state = activeGame
    if (!state || state.phase !== GamePhase.PLAYING) return []
    if (state.turnPhase !== TurnPhase.ACTION || state.negateWindow) return []
    if (state.pendingResponseQueue.length > 0) return []
    const active = state.generals[state.activeGeneralIndex]
    if (!active || active.playerId !== HUMAN_PLAYER_ID) return []
    return listPlayOptions(state, HUMAN_PLAYER_ID)
        .map((option) => ({ ...option, label: describeOption(option.key) }))
        .sort((a, b) => b.turnValue - a.turnValue || b.score - a.score)
        .slice(0, 6)
}

/** 记牌器：只汇总公开信息（弃牌堆、装备/判定区、己方手牌、亮过的明牌） */
export interface PoolStats {
    unseen: number
    seen: number
    hidden: number
    cards: CardCountStat[]
    enemies: Array<{ name: string; hand: number; known: number }>
}

export function getPoolStats(): PoolStats | null {
    const state = activeGame
    if (!state) return null
    const pool = poolView(state, HUMAN_PLAYER_ID)
    const faction = state.players[HUMAN_PLAYER_ID]?.faction
    return {
        unseen: pool.unseen,
        seen: pool.seenCount,
        hidden: pool.hiddenCount,
        cards: POOL_LABELS.map(([key, label]) => ({
            key,
            label,
            left: pool.left(key),
            played: PLAYED_KINDS.has(key)
                ? pool.played(key as 'slash' | 'dodge' | 'peach' | 'negate')
                : 0,
        })),
        enemies: state.generals
            .filter((g) => g.alive && g.faction !== faction)
            .map((g) => ({
                name: getGeneralById(g.generalId)?.name ?? g.generalId,
                hand: g.hand.length,
                known: knownHand(state, state.generals.indexOf(g)).length,
            })),
    }
}

export function startLocalMatch(humanFaction: Faction, seed?: number, skillLimitRule?: SkillLimitRule, weaponEnhance?: boolean): void {
    hotseatMode = false
    activeLandlordSide = null
    activePairSide = null
    activeGame = createLocalMatch(humanFaction, seed, false, undefined, skillLimitRule, weaponEnhance)
    beginMatchLog(activeGame, getRandomSeed(), 'classic', { humanFaction })
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
export function startLocalHotseatMatch(seed?: number, skillLimitRule?: SkillLimitRule, weaponEnhance?: boolean): void {
    hotseatMode = true
    activeLandlordSide = null
    activePairSide = null
    activeGame = createLocalMatch(Faction.WARM, seed, true, undefined, skillLimitRule, weaponEnhance)
    beginMatchLog(activeGame, getRandomSeed(), 'hotseat', { hotseat: true })
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
export function startLocalLandlordMatch(side: LandlordSide, seed?: number, oddityMode = false, skillLimitRule?: SkillLimitRule, weaponEnhance?: boolean): void {
    hotseatMode = false
    activeLandlordSide = side
    activePairSide = null
    // 玩家先选将，AI 等人类席位全部确定后再补
    activeGame = createLandlordMatch(side, seed, false, oddityMode, skillLimitRule, weaponEnhance)
    beginMatchLog(activeGame, getRandomSeed(), 'doudizhu', {
        humanFaction: side === 'landlord' ? Faction.WARM : Faction.COOL,
    })
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
export function startLocalPairMatch(side: Faction, seed?: number, oddityMode = false, skillLimitRule?: SkillLimitRule, weaponEnhance?: boolean): void {
    hotseatMode = false
    activeLandlordSide = null
    activePairSide = side
    // 玩家先选将，AI 等人类席位全部确定后再补
    activeGame = createPairMatch(side, seed, false, oddityMode, skillLimitRule, weaponEnhance)
    beginMatchLog(activeGame, getRandomSeed(), 'huanle_shuang', { humanFaction: side })
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

/** 人类席位是否已全部选好武将（奇技模式下奇技也要选） */
function pairHumanDraftDone(state: GameState): boolean {
    const pick = state.pairPick
    const side = state.pairHumanSide
    if (!pick || !side) return false
    const seats = pairSeatsOf(side)
    if (!seats.every((i) => pick.picked[i] !== null)) return false
    return !pick.oddityPicked || seats.every((i) => pick.oddityPicked![i] !== null)
}

function landlordHumanDraftDone(state: GameState): boolean {
    const pick = state.landlordPick
    if (!pick) return false
    const side = state.landlordHumanSide ?? 'landlord'
    const seats = [0, 1, 2].filter((i) => (i === 0 ? side === 'landlord' : side === 'farmers'))
    if (!seats.every((i) => pick.picked[i] !== null)) return false
    return !pick.oddityPicked || seats.every((i) => pick.oddityPicked![i] !== null)
}

/** 欢乐成双选将：人类点选自己阵营座位的武将（AI 席位由模型或规则 AI 补齐） */
export function dispatchLocalPairPick(seat: number, generalId: string): void {
    const state = activeGame
    if (!state) return
    const logFrom = state.log.length
    const decisionSnapshot = captureSnapshot(state)
    const result = pairPickGeneral(state, seat, generalId)
    if ('error' in result) return useGameStore.getState().setError(result.error)
    // 人类席位选完后再让 AI 补，避免 AI 抢先占走玩家想点将的武将
    if (pairHumanDraftDone(state)) aiPairDraft(state, () => setupPairPlay(state))
    // 规则 AI 补齐的选将轨迹记进对局日志
    recordAiDecision(state, decisionSnapshot, logFrom)
    useGameStore.getState().setError(null)
    publish()
}

/** 欢乐成双奇技模式：武将与奇技一并确认 */
export function dispatchLocalPairConfirmPick(seat: number, generalId: string, oddityId: string): void {
    const state = activeGame
    if (!state) return
    const logFrom = state.log.length
    const decisionSnapshot = captureSnapshot(state)
    const result = pairConfirmPick(state, seat, generalId, oddityId)
    if ('error' in result) return useGameStore.getState().setError(result.error)
    if (pairHumanDraftDone(state)) aiPairDraft(state, () => setupPairPlay(state))
    recordAiDecision(state, decisionSnapshot, logFrom)
    useGameStore.getState().setError(null)
    publish()
}

/** 欢乐成双点将：从模式全池任选武将（奇技模式下与奇技一并提交） */
export function dispatchLocalPairPointPick(seat: number, generalId: string, oddityId?: string): void {
    const state = activeGame
    if (!state) return
    const logFrom = state.log.length
    const decisionSnapshot = captureSnapshot(state)
    const result = pairPointPick(state, seat, generalId, oddityId)
    if ('error' in result) return useGameStore.getState().setError(result.error)
    if (pairHumanDraftDone(state)) aiPairDraft(state, () => setupPairPlay(state))
    recordAiDecision(state, decisionSnapshot, logFrom)
    useGameStore.getState().setError(null)
    publish()
}

/** 斗地主点将：从模式全池任选武将（奇技模式下与奇技一并提交） */
export function dispatchLocalLandlordPointPick(poolIndex: number, generalId: string, oddityId?: string): void {
    const state = activeGame
    if (!state) return
    const result = landlordPointPick(state, poolIndex, generalId, oddityId)
    if ('error' in result) return useGameStore.getState().setError(result.error)
    const logFrom = state.log.length
    const decisionSnapshot = captureSnapshot(state)
    if (landlordHumanDraftDone(state)) aiLandlordDraft(state, () => setupLandlordPlay(state))
    recordAiDecision(state, decisionSnapshot, logFrom)
    useGameStore.getState().setError(null)
    publish()
}

/** 斗地主奇技模式：武将与奇技一并确认 */
export function dispatchLocalLandlordConfirmPick(poolIndex: number, generalId: string, oddityId: string): void {
    const state = activeGame
    if (!state) return
    const result = landlordConfirmPick(state, poolIndex, generalId, oddityId)
    if ('error' in result) return useGameStore.getState().setError(result.error)
    const logFrom = state.log.length
    const decisionSnapshot = captureSnapshot(state)
    if (landlordHumanDraftDone(state)) aiLandlordDraft(state, () => setupLandlordPlay(state))
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
    // 人类席位选完后再让 AI 补齐
    const logFrom = state.log.length
    const decisionSnapshot = captureSnapshot(state)
    if (landlordHumanDraftDone(state)) aiLandlordDraft(state, () => setupLandlordPlay(state))
    recordAiDecision(state, decisionSnapshot, logFrom)
    useGameStore.getState().setError(null)
    publish()
}

export function exitLocalMatch(): void {
    stopPacing()
    finishMatchLog()
    clearResumeSave()
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
    clearResumeSave()
}

/** 单机重开：保留当前模式与阵营，重新开始一局 */
export function dispatchLocalRestart(): void {
    rematchLocalMatch()
}

export interface LocalRematchOptions {
    /** 指定种子可复现同一局；留空则开新种子 */
    seed?: number
    /** 交换玩家阵营（斗地主的地主/农民、冷暖方互换） */
    swapSide?: boolean
}

/** 按当前对局的模式、奇技与阵营重开一局 */
export function rematchLocalMatch(opts: LocalRematchOptions = {}): void {
    const state = activeGame
    const oddity = state?.oddityMode ?? false
    const skillLimitRule = state?.skillLimitRule
    const weaponEnhance = state?.weaponEnhance
    if (hotseatMode) {
        startLocalHotseatMatch(opts.seed, skillLimitRule, weaponEnhance)
        return
    }
    if (activeLandlordSide) {
        const side: LandlordSide = opts.swapSide
            ? (activeLandlordSide === 'landlord' ? 'farmers' : 'landlord')
            : activeLandlordSide
        startLocalLandlordMatch(side, opts.seed, oddity, skillLimitRule, weaponEnhance)
        return
    }
    if (activePairSide) {
        const side = opts.swapSide
            ? (activePairSide === Faction.WARM ? Faction.COOL : Faction.WARM)
            : activePairSide
        startLocalPairMatch(side, opts.seed, oddity, skillLimitRule, weaponEnhance)
        return
    }
    const faction = state?.players[HUMAN_PLAYER_ID]?.faction
    if (!faction) return
    const nextFaction = opts.swapSide
        ? (faction === Faction.WARM ? Faction.COOL : Faction.WARM)
        : faction
    startLocalMatch(nextFaction, opts.seed, skillLimitRule, weaponEnhance)
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
    pushViewToStore(state)
    scheduleResumeSave()
}

function pushViewToStore(state: GameState): void {
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
    clearResumeSave()
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

/**
 * 断点续局：每次结算后把完整局面（含随机游标与对局记录）写进 localStorage。
 * 关页面/刷新后从大厅的「继续上次对局」接着打，序号与随机序列都和存档时一致。
 */
export const RESUME_KEY = 'sgsoffline.resumeMatch.v1'
const RESUME_VERSION = 1

export interface ResumeSave {
    version: number
    savedAt: number
    seed: number
    cursor: number
    mode: GameMode
    hotseat: boolean
    landlordSide: LandlordSide | null
    pairSide: Faction | null
    humanFaction: Faction | null
    matchLog: MatchLogRecord | null
    /** AI 的公开明牌记忆：不随存档接回的话，读档后 AI 会“忘牌” */
    aiMemory: MemoryEntry[]
    /** 翦灭先选方的暂存颜色（另一方还没选时存在） */
    jianmieColors: Array<[number, string]>
    state: GameState
}

/** 大厅展示用：只带够判断“要不要继续”的摘要 */
export interface ResumeInfo {
    mode: GameMode
    hotseat: boolean
    phase: GamePhase
    round: number
    savedAt: number
}

function resumeStorage(): Storage | null {
    try {
        return typeof localStorage !== 'undefined' ? localStorage : null
    } catch {
        return null
    }
}

function readResumeSave(): ResumeSave | null {
    const store = resumeStorage()
    if (!store) return null
    try {
        const raw = readStorageItem(store, RESUME_KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw) as ResumeSave
        if (parsed?.version !== RESUME_VERSION || !parsed.state) return null
        return parsed
    } catch {
        return null
    }
}

let resumeSaveTimer: ReturnType<typeof setTimeout> | null = null

function clearResumeSave(): void {
    if (resumeSaveTimer !== null) {
        clearTimeout(resumeSaveTimer)
        resumeSaveTimer = null
    }
    const store = resumeStorage()
    if (store) removeStorageItem(store, RESUME_KEY)
}

function flushResumeSave(): void {
    if (resumeSaveTimer !== null) {
        clearTimeout(resumeSaveTimer)
        resumeSaveTimer = null
    }
    const state = activeGame
    const store = resumeStorage()
    if (!state || !store) return
    if (state.phase === GamePhase.GAME_OVER) {
        removeStorageItem(store, RESUME_KEY)
        return
    }
    const save: ResumeSave = {
        version: RESUME_VERSION,
        savedAt: Date.now(),
        seed: getRandomSeed(),
        cursor: getRandomCursor(),
        mode: state.mode ?? GameMode.CLASSIC,
        hotseat: hotseatMode,
        landlordSide: activeLandlordSide,
        pairSide: activePairSide,
        humanFaction: state.players[HUMAN_PLAYER_ID]?.faction ?? null,
        matchLog: exportCurrentMatchLog(),
        aiMemory: exportMemory(state),
        jianmieColors: exportJianmieColors(state),
        state,
    }
    try {
        store.setItem(RESUME_KEY, JSON.stringify(save))
    } catch {
        // 超出配额就放弃，不能因为存档影响对局
    }
}

function scheduleResumeSave(): void {
    if (!activeGame || activeGame.phase === GamePhase.GAME_OVER) return
    if (resumeSaveTimer !== null) return
    // 连续结算时合并写入，避免每一帧都整局序列化
    resumeSaveTimer = setTimeout(flushResumeSave, 250)
}

if (typeof window !== 'undefined') {
    // 关标签页/切后台时立刻落盘，避免最后一次节流写入被丢掉
    window.addEventListener('beforeunload', flushResumeSave)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushResumeSave()
    })
}

/** 有没有可继续的对局 */
export function hasResumeSave(): boolean {
    const save = readResumeSave()
    return !!save && save.state.phase !== GamePhase.GAME_OVER
}

/** 大厅「继续上次对局」按钮的摘要；没有存档时返回 null */
export function getResumeInfo(): ResumeInfo | null {
    const save = readResumeSave()
    if (!save || save.state.phase === GamePhase.GAME_OVER) return null
    return {
        mode: save.mode,
        hotseat: save.hotseat,
        phase: save.state.phase,
        round: save.state.roundState?.roundNumber ?? 0,
        savedAt: save.savedAt,
    }
}

/** 从存档恢复对局；成功返回 true */
export function resumeLocalMatch(): boolean {
    const save = readResumeSave()
    if (!save) return false
    if (save.state.phase === GamePhase.GAME_OVER) {
        clearResumeSave()
        return false
    }
    stopPacing()
    activeGame = save.state
    hotseatMode = save.hotseat
    activeLandlordSide = save.landlordSide
    activePairSide = save.pairSide
    // 种子固定、游标续接：恢复后的摸牌与 AI 决策和存档时完全一致
    setRandomSeed(save.seed)
    setRandomCursor(save.cursor)
    resumeMatchLog(save.matchLog)
    // 记忆与暂存色一起接回，读档后 AI 不会突然“忘掉”已亮的牌或翦灭颜色
    importMemory(save.state, save.aiMemory)
    importJianmieColors(save.state, save.jianmieColors)

    const store = useGameStore.getState()
    store.setMode(save.mode)
    store.setLandlordSide(save.landlordSide)
    store.setHotseat(save.hotseat)
    store.setHotseatViews(null)
    store.setPlayerId(HUMAN_PLAYER_ID)
    store.setNickname(nicknameForResume(save))
    store.setRoomCode('local')
    store.setMyFaction(save.humanFaction ?? Faction.WARM)
    store.setIsSpectator(false)
    store.setWinnerFaction(null)
    store.setError(null)
    store.clearSelection()
    publish()
    return true
}

function nicknameForResume(save: ResumeSave): string {
    if (save.hotseat) return '暖方'
    if (save.mode === GameMode.DOUDIZHU) return save.landlordSide === 'farmers' ? '农民' : '地主'
    if (save.mode === GameMode.HUANLE_SHUANG) return save.humanFaction === Faction.COOL ? '冷方' : '暖方'
    return '我'
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

