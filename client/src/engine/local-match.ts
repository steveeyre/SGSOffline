import {
    Faction,
    GameMode,
    GamePhase,
    GameState,
    GeneralDefinition,
    PICK_SEQUENCE,
    Player,
    SeatRole,
    SkillLimitRule,
    TurnPhase,
} from 'sgs3v3-shared'
import { createDeck, getDeckPreference, shuffleDeck } from './cards'
import { addLog, createGeneralInstance } from './game-state'
import { triggerShuzhiChoose } from './game-actions'
import { getGeneralById, getGeneralPool, type GeneralPoolVersion } from './generals'
import { drawCards } from './deck'
import { newRandomSeed, setRandomSeed, shuffleInPlace } from './rng'

export const HUMAN_PLAYER_ID = 'human'
export const AI_PLAYER_ID = 'ai'
/** 左右手对弈时冷方（第二个本地玩家）的 id */
export const HUMAN2_PLAYER_ID = 'human2'

/**
 * 创建单机对局：同一种子可完整复现本局。
 * hotseat = true 时两边都是本地玩家（暖方 HUMAN_PLAYER_ID、冷方 HUMAN2_PLAYER_ID），不跑 AI。
 */
export function createLocalMatch(
    humanFaction: Faction,
    seed: number = newRandomSeed(),
    hotseat = false,
    poolVersion?: GeneralPoolVersion,
    skillLimitRule?: SkillLimitRule,
    weaponEnhance?: boolean,
): GameState {
    setRandomSeed(seed)
    const humanSide = hotseat ? Faction.WARM : humanFaction
    const aiFaction = humanSide === Faction.WARM ? Faction.COOL : Faction.WARM
    const human: Player = { id: HUMAN_PLAYER_ID, nickname: hotseat ? '暖方' : '我', faction: humanSide, connected: true }
    const ai: Player = hotseat
        ? { id: HUMAN2_PLAYER_ID, nickname: '冷方', faction: Faction.COOL, connected: true }
        : { id: AI_PLAYER_ID, nickname: 'AI', faction: aiFaction, connected: true }
    const state: GameState = {
        roomId: 'local',
        phase: GamePhase.GENERAL_PICK,
        mode: GameMode.CLASSIC,
        skillLimitRule,
        weaponEnhance,
        players: { [HUMAN_PLAYER_ID]: human, [ai.id]: ai },
        warmPlayerId: humanSide === Faction.WARM ? HUMAN_PLAYER_ID : AI_PLAYER_ID,
        coolPlayerId: humanSide === Faction.COOL ? HUMAN_PLAYER_ID : (hotseat ? HUMAN2_PLAYER_ID : AI_PLAYER_ID),
        pickState: {
            pool: shuffleInPlace([...getGeneralPool(poolVersion)]).slice(0, 16),
            pickStep: 0,
            warmPicked: [],
            coolPicked: [],
            // 暖色方先决定先选/让先（让先→冷色方先选将）
            waitingForPickYield: true,
        },
        generals: [],
        deck: [],
        discard: [],
        turnPhase: TurnPhase.TURN_START,
        activePlayerFaction: Faction.COOL,
        activeGeneralIndex: -1,
        attackUsedThisTurn: 0,
        pendingResponseQueue: [],
        roundState: { roundNumber: 0, firstMover: Faction.COOL, currentActionStep: 0 },
        log: [],
    }
    addLog(state, `随机种子 ${seed}（出现异常时可用此种子复现本局）`)
    return state
}

/** 选将顺序（暖色方让先时冷暖对调） */
export function pickSequenceFor(state: { pickState?: { yieldedPick?: boolean } }): Faction[] {
    if (!state.pickState?.yieldedPick) return PICK_SEQUENCE
    return PICK_SEQUENCE.map((f) => (f === Faction.WARM ? Faction.COOL : Faction.WARM))
}

/** 本地对战：冷方也是本地玩家（冷方 id 为 HUMAN2_PLAYER_ID） */
export function isHotseatState(state: GameState): boolean {
    return !!state.players[HUMAN2_PLAYER_ID]
}

/** 暖色方选择先选/让先（选将开始前） */
export function handlePickYield(
    state: GameState,
    faction: Faction,
    yieldPick: boolean,
): { error: string } | void {
    const pick = state.pickState
    if (!pick || state.phase !== GamePhase.GENERAL_PICK) return { error: '不在选将阶段' }
    if (!pick.waitingForPickYield) return { error: '当前不是选择先选/让先的时机' }
    if (faction !== Faction.WARM) return { error: '只有暖色方可以选择先选/让先' }
    pick.waitingForPickYield = false
    pick.yieldedPick = yieldPick
    addLog(state, yieldPick
        ? '暖色方选择【让先】，冷色方先选将'
        : '暖色方选择【先选】，暖色方先选将')
}

/** 按选将顺序轮到谁选将 */
export function currentPickFaction(state: GameState): Faction | undefined {
    const pick = state.pickState
    if (!pick || state.phase !== GamePhase.GENERAL_PICK) return undefined
    if (pick.waitingForPickYield) return undefined
    return pickSequenceFor(state)[pick.pickStep]
}

/** 单机选将（不校验 socket，只校验阵营轮次） */
export function localPickGeneral(state: GameState, faction: Faction, generalId: string): { error: string } | { done: boolean } {
    const pick = state.pickState
    if (!pick || state.phase !== GamePhase.GENERAL_PICK) return { error: '不在选将阶段' }
    if (pick.waitingForPickYield) return { error: '等待暖色方选择先选/让先' }
    if (pickSequenceFor(state)[pick.pickStep] !== faction) return { error: '还没到该阵营选将' }
    const general = pick.pool.find((g) => g.id === generalId)
    if (!general) return { error: '武将不在可选池中' }
    const taken = [...pick.warmPicked, ...pick.coolPicked].some((g) => g.id === generalId)
    if (taken) return { error: '武将已被选走' }
    if (faction === Faction.WARM) pick.warmPicked.push(general)
    else pick.coolPicked.push(general)
    pick.pickStep++
    if (pick.pickStep >= PICK_SEQUENCE.length) {
        state.phase = GamePhase.DEPLOY
        state.deployState = { warmDeployed: false, coolDeployed: false }
        return { done: true }
    }
    return { done: false }
}

/** 单机部署：双方齐后同时亮出，随后由冷色方选择先手/让先 */
export function localDeployGenerals(
    state: GameState,
    faction: Faction,
    commanderId: string,
    flankAId: string,
    flankBId: string,
): { error: string } | { allDeployed: boolean } {
    const deployState = state.deployState
    const pick = state.pickState
    if (!deployState || !pick || state.phase !== GamePhase.DEPLOY) return { error: '不在部署阶段' }
    const playerId = faction === Faction.WARM ? state.warmPlayerId : state.coolPlayerId
    const picked = faction === Faction.WARM ? pick.warmPicked : pick.coolPicked
    const ids = [commanderId, flankAId, flankBId]
    for (const id of ids) {
        if (!picked.find((g) => g.id === id)) return { error: `武将 ${id} 不在己方已选武将中` }
    }
    if (new Set(ids).size !== 3) return { error: '不能重复部署同一武将' }
    if (state.generals.some((g) => g.faction === faction)) return { error: '已经部署过了' }

    const roles: Array<{ id: string; role: SeatRole }> = [
        { id: commanderId, role: SeatRole.COMMANDER },
        { id: flankAId, role: SeatRole.FLANK_A },
        { id: flankBId, role: SeatRole.FLANK_B },
    ]
    for (const { id, role } of roles) {
        const def = picked.find((g) => g.id === id) as GeneralDefinition
        state.generals.push(createGeneralInstance(def, playerId, faction, role))
    }
    if (faction === Faction.WARM) deployState.warmDeployed = true
    else deployState.coolDeployed = true

    const allDeployed = deployState.warmDeployed && deployState.coolDeployed
    if (allDeployed) {
        state.generals = sortGeneralsBySeat(state.generals)
        for (const g of state.generals) {
            if (g.seatRole === SeatRole.COMMANDER) {
                g.maxHp += 1
                g.hp += 1
            }
        }
        state.deck = shuffleDeck(createDeck(getDeckPreference()))
        // 怀橘（陆绩）：游戏开始时获得3个“橘”
        for (const general of state.generals) {
            const def = getGeneralById(general.generalId)
            if (!def) continue
            if (def.skills.some((s) => s.id === 'luji_huaiyu')) {
                general.orangeMarks = 3
                addLog(state, `【${def.name}】发动【怀橘】，获得3个“橘”`)
            }
            // 袭爵（张虎乐綝）：游戏开始时获得4个“爵”
            if (def?.skills.some((s) => s.id === 'zhanghulelin_xijue')) {
                general.jueMarks = 4
                addLog(state, `【${def.name}】发动【袭爵】，获得4个“爵”`)
            }
            // 矢北（界沮授）：游戏开始时失去1点体力并获得3点护甲
            if (def?.skills.some((s) => s.id === 'jushou_jie_shibei')) {
                general.hp -= 1
                general.armorPoints = (general.armorPoints ?? 0) + 3
                addLog(state, `【${def.name}】发动【矢北】，失去1点体力并获得3点护甲`)
            }
            // 英魂（界孙坚）：游戏开始时失去1点体力
            if (general.generalId === 'sunjian_jie') {
                general.hp -= 1
                addLog(state, `【${def.name}】发动【英魂】，游戏开始时失去1点体力`)
            }
            // 魄袭（神甘宁）：游戏开始时失去3点体力
            if (def?.skills.some((s) => s.id === 'ganning_shen_poxi')) {
                general.hp = Math.max(1, general.hp - 3)
                addLog(state, `【${def.name}】发动【魄袭】，游戏开始时失去3点体力`)
            }
        }
        for (const general of state.generals) {
            const isWarmCommander = general.faction === Faction.WARM && general.seatRole === SeatRole.COMMANDER
            general.hand = drawCards(state, isWarmCommander ? 5 : 4)
        }
        // 巨贾（糜竺）：游戏开始时多摸 X 张牌（X 为体力上限）
        for (const general of state.generals) {
            const def = getGeneralById(general.generalId)
            if (!def?.skills.some((s) => s.id === 'mizhu_jujia')) continue
            if (general.jujiaDrawn) continue
            const jujiaCards = drawCards(state, general.maxHp)
            general.hand.push(...jujiaCards)
            general.jujiaDrawn = true
            addLog(state, `【${def.name}】发动【巨贾】，游戏开始时多摸${jujiaCards.length}张牌`)
        }
        state.phase = GamePhase.PLAYING
        state.turnPhase = TurnPhase.TURN_START
        state.activePlayerFaction = Faction.COOL
        state.activeGeneralIndex = -1
        // 等待冷色方选择先手/让先，之后再开第 1 大回合
        state.roundState = {
            roundNumber: 0,
            firstMover: Faction.COOL,
            waitingForYield: true,
            currentActionStep: 0,
        }
        triggerShuzhiChoose(state)
    }
    return { allDeployed }
}

function sortGeneralsBySeat(generals: GameState['generals']) {
    const seatOrder: Array<{ faction: Faction; role: SeatRole }> = [
        { faction: Faction.COOL, role: SeatRole.FLANK_A },
        { faction: Faction.COOL, role: SeatRole.COMMANDER },
        { faction: Faction.COOL, role: SeatRole.FLANK_B },
        { faction: Faction.WARM, role: SeatRole.FLANK_B },
        { faction: Faction.WARM, role: SeatRole.COMMANDER },
        { faction: Faction.WARM, role: SeatRole.FLANK_A },
    ]
    return seatOrder
        .map(({ faction, role }) => generals.find((g) => g.faction === faction && g.seatRole === role))
        .filter((g): g is NonNullable<typeof g> => g !== undefined)
}
