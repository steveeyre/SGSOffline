import {
    Faction,
    GameMode,
    GamePhase,
    GameState,
    PairPickState,
    Player,
    SeatRole,
    SkillLimitRule,
    TurnPhase,
} from 'sgs3v3-shared'
import { createDeck158, shuffleDeck } from '../../engine/cards'
import { drawCards } from '../../engine/deck'
import { addLog, createGeneralInstance, hasSkillOnGeneral } from '../../engine/game-state'
import { triggerShuzhiChoose } from '../../engine/game-actions'
import { getGeneralById } from '../../engine/generals'
import { AI_PLAYER_ID, HUMAN_PLAYER_ID, HUMAN2_PLAYER_ID, isHotseatState } from '../../engine/local-match'
import { newRandomSeed, setRandomSeed } from '../../engine/rng'
import { runTurnStart } from '../../engine/turn-manager'
import { resetSkillUses } from '../../engine/skill-limit'
import { drawOddities, oddityCatalog, pickOddity } from '../../engine/oddity'
import { aiPairDraft, buildPairPools, getPairPointPickPool, pairSeatsOf } from './pair-draft'

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
    oddityMode = false,
    skillLimitRule?: SkillLimitRule,
    weaponEnhance?: boolean,
    hotseat = false,
): GameState {
    setRandomSeed(seed)
    const humanSide = hotseat ? Faction.WARM : humanFaction
    const aiFaction = humanSide === Faction.WARM ? Faction.COOL : Faction.WARM
    const human: Player = hotseat
        ? { id: HUMAN_PLAYER_ID, nickname: '暖方', faction: Faction.WARM, connected: true }
        : { id: HUMAN_PLAYER_ID, nickname: '我', faction: humanFaction, connected: true }
    const opponent: Player = hotseat
        ? { id: HUMAN2_PLAYER_ID, nickname: '冷方', faction: Faction.COOL, connected: true }
        : { id: AI_PLAYER_ID, nickname: 'AI', faction: aiFaction, connected: true }
    const pools = buildPairPools()
    const pairPick: PairPickState = { pools, picked: [null, null, null, null] }
    if (oddityMode) {
        // 玩家先选、电脑后选：人类席位的候选此刻抽好，AI 席位等玩家选完后由 aiPairDraft 现场抽取
        const humanSeats = new Set(hotseat ? [0, 1, 2, 3] : pairSeatsOf(humanFaction))
        const used: string[] = []
        pairPick.oddities = pools.map((pool, i) => {
            if (!autoDraft && !humanSeats.has(i)) return []
            // 先排除该席位武将已有技能，再排除前面席位已抽到的，避免重复
            const own = pool.flatMap((g) => g.skills.map((s) => s.id))
            const options = drawOddities([...own, ...used])
            used.push(...options.map((o) => o.skillId))
            return options
        })
        pairPick.oddityPicked = [null, null, null, null]
    }
    const state: GameState = {
        roomId: 'local',
        phase: GamePhase.GENERAL_PICK,
        mode: GameMode.HUANLE_SHUANG,
        oddityMode: oddityMode || undefined,
        skillLimitRule,
        weaponEnhance,
        pairHumanSide: humanSide,
        players: { [human.id]: human, [opponent.id]: opponent },
        warmPlayerId: humanSide === Faction.WARM ? HUMAN_PLAYER_ID : AI_PLAYER_ID,
        coolPlayerId: humanSide === Faction.COOL ? HUMAN_PLAYER_ID : (hotseat ? HUMAN2_PLAYER_ID : AI_PLAYER_ID),
        pairPick,
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
    if (oddityMode) addLog(state, '奇技模式：每名角色另有 3 个奇技候选，选定武将时一并选择')
    // autoDraft=false 时把 AI 席位的选将留给调用方（自对弈/校测构造固定阵容用）
    if (autoDraft && !hotseat) aiPairDraft(state, () => setupPairPlay(state))
    return state
}

/** 本地玩家在自己阵营的座位上选将（非奇技模式：武将即选即定） */
export function pairPickGeneral(
    state: GameState,
    seat: number,
    generalId: string,
): { error: string } | { done: boolean } {
    return commitPairPick(state, seat, generalId)
}

/** 奇技模式：武将 + 奇技一并提交（界面点“确认”时调用） */
export function pairConfirmPick(
    state: GameState,
    seat: number,
    generalId: string,
    oddityId: string,
): { error: string } | { done: boolean } {
    return commitPairPick(state, seat, generalId, oddityId)
}

/** 点将：从模式全池任选武将，仍受“场上不重复”与奇技规则约束 */
export function pairPointPick(
    state: GameState,
    seat: number,
    generalId: string,
    oddityId?: string,
): { error: string } | { done: boolean } {
    return commitPairPick(state, seat, generalId, oddityId, true)
}

function commitPairPick(
    state: GameState,
    seat: number,
    generalId: string,
    oddityId?: string,
    fromPointPick = false,
): { error: string } | { done: boolean } {
    const pick = state.pairPick
    if (!pick || state.phase !== GamePhase.GENERAL_PICK) return { error: '不在选将阶段' }
    if (seat < 0 || seat > 3) return { error: '无效的选将席位' }
    const humanSide = state.pairHumanSide
    if (!humanSide) return { error: '当前不是欢乐成双对局' }
    if (!isHotseatState(state) && !pairSeatsOf(humanSide).includes(seat)) return { error: '该席位由 AI 选择' }
    if (pick.picked[seat]) return { error: '该席位已选好武将' }
    if (fromPointPick) {
        if (!getPairPointPickPool().some((g) => g.id === generalId)) return { error: '武将不在点将池中' }
    } else {
        const pool = pick.pools[seat]
        if (!pool.some((g) => g.id === generalId)) return { error: '武将不在可选池中' }
    }
    if (pick.picked.some((id, i) => i !== seat && id === generalId)) return { error: '武将已被选走' }

    // 奇技模式：未显式给出时由规则 AI 兜底（自对弈、脚本构造局面的路径）
    let oddity = oddityId
    if (pick.oddityPicked) {
        if (!oddity) oddity = pickOddity(pick.oddities?.[seat] ?? [])?.skillId
        if (!oddity) return { error: '请选择奇技' }
        // 奇技可任选：只要求是奇技目录里的技能，候选 3 个只是快捷入口
        if (!oddityCatalog().some((o) => o.skillId === oddity)) return { error: '奇技不存在' }
        // AI 的奇技在玩家之后才抽，这里只拦两个席位都提交完后的重复
        if (pick.oddityPicked.some((id, i) => i !== seat && id === oddity)) return { error: '该奇技已被其他席位选定' }
        pick.oddityPicked[seat] = oddity
    }

    pick.picked[seat] = generalId
    const generalName = getGeneralById(generalId)?.name ?? generalId
    const oddityName = oddityCatalog().find((o) => o.skillId === oddity)?.skillName
    addLog(state, `【${seat + 1} 号位】选定武将【${generalName}】`
        + (oddity ? `，奇技【${oddityName ?? oddity}】` : ''))
    const allPicked = pick.picked.every((id) => id !== null)
        && (!pick.oddityPicked || pick.oddityPicked.every((id) => id !== null))
    if (allPicked) setupPairPlay(state)
    return { done: allPicked }
}

/** 四方选将完成 → 落座、发牌并开始 1 号位的第一回合 */
export function setupPairPlay(state: GameState): void {
    const pick = state.pairPick
    if (!pick || state.phase !== GamePhase.GENERAL_PICK) return
    if (!pick.picked.every((id) => id !== null)) return

    state.generals = pick.picked.map((id, i) => {
        // 点将可能选出本席位池外的武将，按模式全池兜底查找
        const def = pick.pools[i].find((g) => g.id === id)
            ?? getPairPointPickPool().find((g) => g.id === id)!
        const faction = PAIR_SEAT_FACTIONS[i]
        const playerId = faction === Faction.WARM ? state.warmPlayerId : state.coolPlayerId
        const general = createGeneralInstance(def, playerId, faction, SeatRole.FLANK_A)
        const oddity = pick.oddityPicked?.[i]
        if (oddity) {
            general.acquiredSkills.push(oddity)
            const name = oddityCatalog().find((o) => o.skillId === oddity)?.skillName ?? oddity
            addLog(state, `【${def.name}】获得奇技【${name}】`)
        }
        return general
    })

    state.deck = shuffleDeck(createDeck158('tongshuai156'))

    // 怀橘（陆绩）：游戏开始时获得3个“橘”
    // 用 hasSkillOnGeneral 而非 def.skills，奇技授予的同名技能同样在开局补标记
    for (const general of state.generals) {
        const name = getGeneralById(general.generalId)?.name ?? general.generalId
        if (hasSkillOnGeneral(general, 'luji_huaiyu')) {
            general.orangeMarks = 3
            addLog(state, `【${name}】发动【怀橘】，获得3个“橘”`)
        }
        // 袭爵（张虎乐綝）：游戏开始时获得4个“爵”
        if (hasSkillOnGeneral(general, 'zhanghulelin_xijue')) {
            general.jueMarks = 4
            addLog(state, `【${name}】发动【袭爵】，获得4个“爵”`)
        }
        // 魄袭（神甘宁）：游戏开始时失去3点体力
        if (hasSkillOnGeneral(general, 'ganning_shen_poxi')) {
            general.hp = Math.max(1, general.hp - 3)
            addLog(state, `【${name}】发动【魄袭】，游戏开始时失去3点体力`)
        }
    }

    // 1 号位先手，初始手牌比其他人少 1 张
    state.generals.forEach((general, i) => {
        general.hand = drawCards(state, i === 0 ? 3 : 4)
    })
    if (state.generals[0]) addLog(state, '【1 号位】初始手牌 -1')

    // 巨贾（糜竺）：游戏开始时多摸 X 张牌（X 为体力上限）
    for (const general of state.generals) {
        if (!hasSkillOnGeneral(general, 'mizhu_jujia')) continue
        if (general.jujiaDrawn) continue
        const jujiaCards = drawCards(state, general.maxHp)
        general.hand.push(...jujiaCards)
        general.jujiaDrawn = true
        const name = getGeneralById(general.generalId)?.name ?? general.generalId
        addLog(state, `【${name}】发动【巨贾】，游戏开始时多摸${jujiaCards.length}张牌`)
    }

    state.phase = GamePhase.PLAYING
    state.turnPhase = TurnPhase.TURN_START
    state.roundState = { roundNumber: 1, firstMover: Faction.COOL, currentActionStep: 0 }
    state.currentActionUnit = undefined
    state.activeGeneralIndex = 0
    state.activePlayerFaction = Faction.COOL
    state.attackUsedThisTurn = 0
    state.generals.forEach((g) => resetSkillUses(g))
    addLog(state, '═══ 第 1 大回合开始 ═══ 1 号位先手')
    triggerShuzhiChoose(state)
    if (state.pendingResponseQueue.length === 0) runTurnStart(state)
}
