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
import { aiLandlordDraft, buildLandlordPools } from './landlord-draft'

export type LandlordSide = 'landlord' | 'farmers'

/**
 * 创建斗地主单机对局。
 * 地主 = 暖方 + 主帅（1 号位），两名农民 = 冷方 + 边锋（2、3 号位），农民共用一个 playerId。
 */
export function createLandlordMatch(side: LandlordSide, seed: number = newRandomSeed(), autoDraft = true): GameState {
    setRandomSeed(seed)
    const landlordPlayerId = side === 'landlord' ? HUMAN_PLAYER_ID : AI_PLAYER_ID
    const farmerPlayerId = side === 'farmers' ? HUMAN_PLAYER_ID : AI_PLAYER_ID
    const players: Record<string, Player> = {
        [landlordPlayerId]: {
            id: landlordPlayerId,
            nickname: side === 'landlord' ? '我（地主）' : 'AI（地主）',
            faction: Faction.WARM,
            connected: true,
        },
        [farmerPlayerId]: {
            id: farmerPlayerId,
            nickname: side === 'farmers' ? '我（农民）' : 'AI（农民）',
            faction: Faction.COOL,
            connected: true,
        },
    }
    const state: GameState = {
        roomId: 'local',
        phase: GamePhase.GENERAL_PICK,
        mode: GameMode.DOUDIZHU,
        landlordHumanSide: side,
        players,
        warmPlayerId: landlordPlayerId,
        coolPlayerId: farmerPlayerId,
        landlordPick: {
            pools: buildLandlordPools(),
            picked: [null, null, null],
        },
        generals: [],
        deck: [],
        discard: [],
        turnPhase: TurnPhase.TURN_START,
        activePlayerFaction: Faction.WARM,
        activeGeneralIndex: -1,
        attackUsedThisTurn: 0,
        pendingResponseQueue: [],
        roundState: { roundNumber: 0, firstMover: Faction.WARM, currentActionStep: 0 },
        log: [],
    }
    addLog(state, `随机种子 ${seed}（出现异常时可用此种子复现本局）`)
    addLog(state, '斗地主模式：地主 6 选 1，农民各 5 选 1，同时进行')
    // autoDraft=false 时把 AI 席位的选将留给调用方（本地模型接入时用）
    if (autoDraft) aiLandlordDraft(state, () => setupLandlordPlay(state))
    return state
}

/** 人类在某个席位选将 */
export function landlordPickGeneral(
    state: GameState,
    poolIndex: number,
    generalId: string,
): { error: string } | { done: boolean } {
    const pick = state.landlordPick
    if (!pick || state.phase !== GamePhase.GENERAL_PICK) return { error: '不在选将阶段' }
    if (poolIndex < 0 || poolIndex > 2) return { error: '无效的选将席位' }
    const humanSide = state.landlordHumanSide ?? 'landlord'
    const isMine = poolIndex === 0 ? humanSide === 'landlord' : humanSide === 'farmers'
    if (!isMine) return { error: '该席位由 AI 选择' }
    if (pick.picked[poolIndex]) return { error: '该席位已选好武将' }
    const pool = pick.pools[poolIndex]
    if (!pool.some((g) => g.id === generalId)) return { error: '武将不在可选池中' }
    if (pick.picked.some((id, i) => i !== poolIndex && id === generalId)) return { error: '武将已被选走' }
    pick.picked[poolIndex] = generalId
    const seatName = poolIndex === 0 ? '地主' : poolIndex === 1 ? '农民一' : '农民二'
    addLog(state, `【${seatName}】选定武将【${getGeneralById(generalId)?.name ?? generalId}】`)
    const allPicked = pick.picked.every((id) => id !== null)
    if (allPicked) setupLandlordPlay(state)
    return { done: allPicked }
}

/** 三方选将完成 → 落座、发牌、授予地主专技并开始地主的第一回合 */
export function setupLandlordPlay(state: GameState): void {
    const pick = state.landlordPick
    if (!pick || state.phase !== GamePhase.GENERAL_PICK) return
    if (!pick.picked.every((id) => id !== null)) return

    state.generals = pick.picked.map((id, i) => {
        const def = pick.pools[i].find((g) => g.id === id)!
        const faction = i === 0 ? Faction.WARM : Faction.COOL
        const seatRole = i === 0 ? SeatRole.COMMANDER : i === 1 ? SeatRole.FLANK_A : SeatRole.FLANK_B
        const playerId = i === 0 ? state.warmPlayerId : state.coolPlayerId
        return createGeneralInstance(def, playerId, faction, seatRole)
    })

    const landlord = state.generals[0]
    landlord.maxHp += 1
    landlord.hp += 1
    landlord.acquiredSkills.push('doudizhu_feiyang', 'doudizhu_bahu', 'doudizhu_qiangyi')

    state.deck = shuffleDeck(createDeck158('tongshuai156'))

    // 怀橘（陆绩）：游戏开始时获得3个“橘”
    for (const general of state.generals) {
        const def = getGeneralById(general.generalId)
        if (def?.skills.some((s) => s.id === 'luji_huaiyu')) {
            general.orangeMarks = 3
            addLog(state, `【${def.name}】发动【怀橘】，获得3个“橘”`)
        }
    }
    for (const general of state.generals) {
        general.hand = drawCards(state, 4)
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
    state.roundState = { roundNumber: 1, firstMover: Faction.WARM, currentActionStep: 0 }
    state.currentActionUnit = undefined
    state.activeGeneralIndex = 0
    state.activePlayerFaction = Faction.WARM
    state.attackUsedThisTurn = 0
    addLog(state, '═══ 第 1 大回合开始 ═══ 地主先手')
    triggerShuzhiChoose(state)
    if (state.pendingResponseQueue.length === 0) runTurnStart(state)
}
