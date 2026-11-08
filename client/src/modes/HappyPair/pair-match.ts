import {
    Faction,
    GameMode,
    GamePhase,
    GameState,
    Player,
    SeatRole,
    TurnPhase,
} from 'sgs3v3-shared'
import { createDeck158, shuffleDeck } from '../../engine/cards'
import { drawCards } from '../../engine/deck'
import { addLog, createGeneralInstance } from '../../engine/game-state'
import { triggerShuzhiChoose } from '../../engine/game-actions'
import { getGeneralById } from '../../engine/generals'
import { AI_PLAYER_ID, HUMAN_PLAYER_ID } from '../../engine/local-match'
import { newRandomSeed, setRandomSeed } from '../../engine/rng'
import { runTurnStart } from '../../engine/turn-manager'
import { aiPairDraft, buildPairPools, pairSeatsOf } from './pair-draft'

/** 欢乐成双座次阵营：1 号位冷、2 号位暖、3 号位暖、4 号位冷 */
export const PAIR_SEAT_FACTIONS: Faction[] = [
    Faction.COOL,
    Faction.WARM,
    Faction.WARM,
    Faction.COOL,
]

/**
 * 欢乐成双的固定桌面座次（逆时针）：1、4 号位在上排，2、3 号位在下排。
 * 返回己方/对方按上排左→右、下排左→右排好的座位下标，以及己方行是否在上方。
 */
export function pairBoardSeats(myFaction: Faction): {
    mySeats: number[]
    oppSeats: number[]
    mineOnTop: boolean
} {
    return myFaction === Faction.COOL
        ? { mySeats: [0, 3], oppSeats: [1, 2], mineOnTop: true }
        : { mySeats: [1, 2], oppSeats: [0, 3], mineOnTop: false }
}

/**
 * 创建欢乐成双单机对局。
 * 本地玩家与 PC 各控制一个阵营的两个座位：冷色为 1、4 号位，暖色为 2、3 号位。
 */
export function createPairMatch(
    humanFaction: Faction,
    seed: number = newRandomSeed(),
    autoDraft = true,
): GameState {
    setRandomSeed(seed)
    const aiFaction = humanFaction === Faction.WARM ? Faction.COOL : Faction.WARM
    const human: Player = { id: HUMAN_PLAYER_ID, nickname: '我', faction: humanFaction, connected: true }
    const ai: Player = { id: AI_PLAYER_ID, nickname: 'AI', faction: aiFaction, connected: true }
    const state: GameState = {
        roomId: 'local',
        phase: GamePhase.GENERAL_PICK,
        mode: GameMode.HUANLE_SHUANG,
        pairHumanSide: humanFaction,
        players: { [human.id]: human, [ai.id]: ai },
        warmPlayerId: humanFaction === Faction.WARM ? HUMAN_PLAYER_ID : AI_PLAYER_ID,
        coolPlayerId: humanFaction === Faction.COOL ? HUMAN_PLAYER_ID : AI_PLAYER_ID,
        pairPick: {
            pools: buildPairPools(),
            picked: [null, null, null, null],
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
    addLog(state, '欢乐成双：1 号位冷色、2/3 号位暖色、4 号位冷色，四方同时选将')
    // autoDraft=false 时把 AI 席位的选将留给调用方（自对弈/校测构造固定阵容用）
    if (autoDraft) aiPairDraft(state, () => setupPairPlay(state))
    return state
}

/** 本地玩家在自己阵营的座位上选将 */
export function pairPickGeneral(
    state: GameState,
    seat: number,
    generalId: string,
): { error: string } | { done: boolean } {
    const pick = state.pairPick
    if (!pick || state.phase !== GamePhase.GENERAL_PICK) return { error: '不在选将阶段' }
    if (seat < 0 || seat > 3) return { error: '无效的选将席位' }
    const humanSide = state.pairHumanSide
    if (!humanSide) return { error: '当前不是欢乐成双对局' }
    if (!pairSeatsOf(humanSide).includes(seat)) return { error: '该席位由 AI 选择' }
    if (pick.picked[seat]) return { error: '该席位已选好武将' }
    const pool = pick.pools[seat]
    if (!pool.some((g) => g.id === generalId)) return { error: '武将不在可选池中' }
    if (pick.picked.some((id, i) => i !== seat && id === generalId)) return { error: '武将已被选走' }
    pick.picked[seat] = generalId
    addLog(state, `【${seat + 1} 号位】选定武将【${getGeneralById(generalId)?.name ?? generalId}】`)
    const allPicked = pick.picked.every((id) => id !== null)
    if (allPicked) setupPairPlay(state)
    return { done: allPicked }
}

/** 四方选将完成 → 落座、发牌并开始 1 号位的第一回合 */
export function setupPairPlay(state: GameState): void {
    const pick = state.pairPick
    if (!pick || state.phase !== GamePhase.GENERAL_PICK) return
    if (!pick.picked.every((id) => id !== null)) return

    state.generals = pick.picked.map((id, i) => {
        const def = pick.pools[i].find((g) => g.id === id)!
        const faction = PAIR_SEAT_FACTIONS[i]
        const playerId = faction === Faction.WARM ? state.warmPlayerId : state.coolPlayerId
        return createGeneralInstance(def, playerId, faction, SeatRole.FLANK_A)
    })

    state.deck = shuffleDeck(createDeck158('tongshuai156'))

    // 怀橘（陆绩）：游戏开始时获得3个“橘”
    for (const general of state.generals) {
        const def = getGeneralById(general.generalId)
        if (def?.skills.some((s) => s.id === 'luji_huaiyu')) {
            general.orangeMarks = 3
            addLog(state, `【${def.name}】发动【怀橘】，获得3个“橘”`)
        }
        // 袭爵（张虎乐綝）：游戏开始时获得4个“爵”
        if (def?.skills.some((s) => s.id === 'zhanghulelin_xijue')) {
            general.jueMarks = 4
            addLog(state, `【${def.name}】发动【袭爵】，获得4个“爵”`)
        }
    }

    // 1 号位先手，初始手牌比其他人少 1 张
    state.generals.forEach((general, i) => {
        general.hand = drawCards(state, i === 0 ? 3 : 4)
    })
    if (state.generals[0]) addLog(state, '【1 号位】初始手牌 -1')

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
    state.roundState = { roundNumber: 1, firstMover: Faction.COOL, currentActionStep: 0 }
    state.currentActionUnit = undefined
    state.activeGeneralIndex = 0
    state.activePlayerFaction = Faction.COOL
    state.attackUsedThisTurn = 0
    addLog(state, '═══ 第 1 大回合开始 ═══ 1 号位先手')
    triggerShuzhiChoose(state)
    if (state.pendingResponseQueue.length === 0) runTurnStart(state)
}
