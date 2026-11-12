import {
    Faction,
    GameMode,
    GamePhase,
    GameState,
    LandlordPickState,
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
import { AI_PLAYER_ID, HUMAN_PLAYER_ID } from '../../engine/local-match'
import { newRandomSeed, setRandomSeed } from '../../engine/rng'
import { runTurnStart } from '../../engine/turn-manager'
import { resetSkillUses } from '../../engine/skill-limit'
import { drawOddities, oddityCatalog, pickOddity } from '../../engine/oddity'
import { aiLandlordDraft, buildLandlordPools, getLandlordPointPickPool } from './landlord-draft'

export type LandlordSide = 'landlord' | 'farmers'

/**
 * 创建斗地主单机对局。
 * 地主 = 暖方 + 主帅（1 号位），两名农民 = 冷方 + 边锋（2、3 号位），农民共用一个 playerId。
 */
export function createLandlordMatch(
    side: LandlordSide,
    seed: number = newRandomSeed(),
    autoDraft = true,
    oddityMode = false,
    skillLimitRule?: SkillLimitRule,
    weaponEnhance?: boolean,
): GameState {
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
    const pools = buildLandlordPools()
    const landlordPick: LandlordPickState = { pools, picked: [null, null, null] }
    if (oddityMode) {
        // 玩家先选、电脑后选：人类席位的候选此刻抽好，AI 席位等玩家选完后由 aiLandlordDraft 现场抽取
        const humanSeats = new Set(side === 'landlord' ? [0] : [1, 2])
        const used: string[] = []
        landlordPick.oddities = pools.map((pool, i) => {
            if (!autoDraft && !humanSeats.has(i)) return []
            // 先排除该席位武将已有技能，再排除前面席位已抽到的，避免重复
            const own = pool.flatMap((g) => g.skills.map((s) => s.id))
            const options = drawOddities([...own, ...used])
            used.push(...options.map((o) => o.skillId))
            return options
        })
        landlordPick.oddityPicked = [null, null, null]
    }
    const state: GameState = {
        roomId: 'local',
        phase: GamePhase.GENERAL_PICK,
        mode: GameMode.DOUDIZHU,
        oddityMode: oddityMode || undefined,
        skillLimitRule,
        weaponEnhance,
        landlordHumanSide: side,
        players,
        warmPlayerId: landlordPlayerId,
        coolPlayerId: farmerPlayerId,
        landlordPick,
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
    if (oddityMode) addLog(state, '奇技模式：每名角色另有 3 个奇技候选，选定武将时一并选择')
    // autoDraft=false 时把 AI 席位的选将留给调用方（自对弈/校测构造固定阵容用）
    if (autoDraft) aiLandlordDraft(state, () => setupLandlordPlay(state))
    return state
}

/** 人类在某个席位选将（非奇技模式：武将即选即定） */
export function landlordPickGeneral(
    state: GameState,
    poolIndex: number,
    generalId: string,
): { error: string } | { done: boolean } {
    return commitLandlordPick(state, poolIndex, generalId)
}

/** 奇技模式：武将 + 奇技一并提交（界面点“确认”时调用） */
export function landlordConfirmPick(
    state: GameState,
    poolIndex: number,
    generalId: string,
    oddityId: string,
): { error: string } | { done: boolean } {
    return commitLandlordPick(state, poolIndex, generalId, oddityId)
}

/** 点将：从模式全池任选武将，仍受“场上不重复”与奇技规则约束 */
export function landlordPointPick(
    state: GameState,
    poolIndex: number,
    generalId: string,
    oddityId?: string,
): { error: string } | { done: boolean } {
    return commitLandlordPick(state, poolIndex, generalId, oddityId, true)
}

function commitLandlordPick(
    state: GameState,
    poolIndex: number,
    generalId: string,
    oddityId?: string,
    fromPointPick = false,
): { error: string } | { done: boolean } {
    const pick = state.landlordPick
    if (!pick || state.phase !== GamePhase.GENERAL_PICK) return { error: '不在选将阶段' }
    if (poolIndex < 0 || poolIndex > 2) return { error: '无效的选将席位' }
    const humanSide = state.landlordHumanSide ?? 'landlord'
    const isMine = poolIndex === 0 ? humanSide === 'landlord' : humanSide === 'farmers'
    if (!isMine) return { error: '该席位由 AI 选择' }
    if (pick.picked[poolIndex]) return { error: '该席位已选好武将' }
    if (fromPointPick) {
        if (!getLandlordPointPickPool().some((g) => g.id === generalId)) return { error: '武将不在点将池中' }
    } else {
        const pool = pick.pools[poolIndex]
        if (!pool.some((g) => g.id === generalId)) return { error: '武将不在可选池中' }
    }
    if (pick.picked.some((id, i) => i !== poolIndex && id === generalId)) return { error: '武将已被选走' }

    // 奇技模式：未显式给出时由规则 AI 兜底（自对弈、脚本构造局面的路径）
    let oddity = oddityId
    if (pick.oddityPicked) {
        if (!oddity) oddity = pickOddity(pick.oddities?.[poolIndex] ?? [])?.skillId
        if (!oddity) return { error: '请选择奇技' }
        // 奇技可任选：只要求是奇技目录里的技能，候选 3 个只是快捷入口
        if (!oddityCatalog().some((o) => o.skillId === oddity)) return { error: '奇技不存在' }
        // AI 的奇技在玩家之后才抽，这里只拦已提交席位之间的重复
        if (pick.oddityPicked.some((id, i) => i !== poolIndex && id === oddity)) return { error: '该奇技已被其他席位选定' }
        pick.oddityPicked[poolIndex] = oddity
    }

    pick.picked[poolIndex] = generalId
    const seatName = poolIndex === 0 ? '地主' : poolIndex === 1 ? '农民一' : '农民二'
    const generalName = getGeneralById(generalId)?.name ?? generalId
    const oddityName = oddityCatalog().find((o) => o.skillId === oddity)?.skillName
    addLog(state, `【${seatName}】选定武将【${generalName}】`
        + (oddity ? `，奇技【${oddityName ?? oddity}】` : ''))
    const allPicked = pick.picked.every((id) => id !== null)
        && (!pick.oddityPicked || pick.oddityPicked.every((id) => id !== null))
    if (allPicked) setupLandlordPlay(state)
    return { done: allPicked }
}

/** 三方选将完成 → 落座、发牌、授予地主专技并开始地主的第一回合 */
export function setupLandlordPlay(state: GameState): void {
    const pick = state.landlordPick
    if (!pick || state.phase !== GamePhase.GENERAL_PICK) return
    if (!pick.picked.every((id) => id !== null)) return

    state.generals = pick.picked.map((id, i) => {
        // 点将可能选出本席位池外的武将，按模式全池兜底查找
        const def = pick.pools[i].find((g) => g.id === id)
            ?? getLandlordPointPickPool().find((g) => g.id === id)!
        const faction = i === 0 ? Faction.WARM : Faction.COOL
        const seatRole = i === 0 ? SeatRole.COMMANDER : i === 1 ? SeatRole.FLANK_A : SeatRole.FLANK_B
        const playerId = i === 0 ? state.warmPlayerId : state.coolPlayerId
        const general = createGeneralInstance(def, playerId, faction, seatRole)
        const oddity = pick.oddityPicked?.[i]
        if (oddity) {
            general.acquiredSkills.push(oddity)
            const name = oddityCatalog().find((o) => o.skillId === oddity)?.skillName ?? oddity
            addLog(state, `【${def.name}】获得奇技【${name}】`)
        }
        return general
    })

    const landlord = state.generals[0]
    landlord.maxHp += 1
    landlord.hp += 1
    landlord.acquiredSkills.push('doudizhu_feiyang', 'doudizhu_bahu', 'doudizhu_qiangyi')

    state.deck = shuffleDeck(createDeck158('tongshuai156'))

    // 怀橘（陆绩）、袭爵（张虎乐綝）：游戏开始时补标记
    // 用 hasSkillOnGeneral 而非 def.skills，奇技授予的同名技能同样在开局补标记
    for (const general of state.generals) {
        const name = getGeneralById(general.generalId)?.name ?? general.generalId
        if (hasSkillOnGeneral(general, 'luji_huaiyu')) {
            general.orangeMarks = 3
            addLog(state, `【${name}】发动【怀橘】，获得3个“橘”`)
        }
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
    for (const general of state.generals) {
        general.hand = drawCards(state, 4)
    }
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
    state.roundState = { roundNumber: 1, firstMover: Faction.WARM, currentActionStep: 0 }
    state.currentActionUnit = undefined
    state.activeGeneralIndex = 0
    state.activePlayerFaction = Faction.WARM
    state.attackUsedThisTurn = 0
    state.generals.forEach((g) => resetSkillUses(g))
    addLog(state, '═══ 第 1 大回合开始 ═══ 地主先手')
    triggerShuzhiChoose(state)
    if (state.pendingResponseQueue.length === 0) runTurnStart(state)
}
