import { GameState, GamePhase, TurnPhase, SkillType, GeneralInstance, GameMode, Faction, GeneralDefinition } from 'sgs3v3-shared'
import { getGeneralById, getSkillDefById } from './generals'
import { GENERAL_ROLES, ROLE_LABEL } from './general-meta'
import { cardFullName } from './card-utils'
import { addLog } from './game-state'
import { handleEndTurn } from './turn-manager'
import { draftScore, runPlayOption, type AiPlayOptionView } from './local-ai'
import { currentPickFaction, handlePickYield, localDeployGenerals, localPickGeneral } from './local-match'
import { setupLandlordPlay } from '../modes/FightTheLandlord/landlord-match'
import { setupPairPlay } from '../modes/HappyPair/pair-match'
import { pairSeatsOf } from '../modes/HappyPair/pair-draft'

const LLM_PREF_KEY = 'sgs3v3.llmAi'

/** 是否让单机 AI 走本地 Ollama 模型（默认关闭，规则 AI 兜底） */
export function isLlmAiEnabled(): boolean {
    if (typeof localStorage === 'undefined') return false
    return localStorage.getItem(LLM_PREF_KEY) === 'on'
}

export function setLlmAiEnabled(enabled: boolean): void {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(LLM_PREF_KEY, enabled ? 'on' : 'off')
}

export type ModelTier = 'fast' | 'deep'

/** 请求前定格的局面指纹：响应回来时局面若已变化就丢弃这次决策 */
export interface LlmTicket {
    turnSerial: string
    activeIndex: number
    handIds: string[]
    logLength: number
    tier: ModelTier
    optionIds: string[]
}

const SYSTEM_PROMPT = [
    '你在代替一名玩家玩《三国杀》。',
    '你不需要描述动作：游戏引擎已经枚举出当前所有可执行的动作，每个动作有一个 id。',
    '你只能从给定的动作列表里挑选一个，回答格式固定为 JSON：{"option":"o3"}。',
    '若当前没有值得执行的动作，回答 {"option":"end"} 表示结束出牌阶段。',
    '只能使用列表里出现过的 id，不要编造。只输出 JSON。',
].join('\n')

const OPTION_LABELS: Record<string, string> = {
    slash: '使用【杀】',
    fire_slash: '使用【火杀】',
    thunder_slash: '使用【雷杀】',
    peach: '使用【桃】',
    wine: '使用【酒】',
    draw_two: '使用【无中生有】',
    dismantle: '使用【过河拆桥】',
    steal: '使用【顺手牵羊】',
    duel: '使用【决斗】',
    arrows: '使用【万箭齐发】',
    barbarians: '使用【南蛮入侵】',
    peach_garden: '使用【桃园结义】',
    harvest: '使用【五谷丰登】',
    iron_chain: '使用【铁索连环】',
    iron_chain_recast: '重铸【铁索连环】',
    equip_weapon: '装备武器',
    equip_armor: '装备防具',
    equip_plus_horse: '装备+1马',
    equip_minus_horse: '装备-1马',
    huomo_peach: '使用【桃】（火攻后）',
}

/** 把选项 key 转成给模型看的中文说明；key 形如 slash / skill:kurou / equip_weapon */
export function describeOption(key: string): string {
    const direct = OPTION_LABELS[key]
    if (direct) return direct
    const skillId = key.startsWith('skill:') ? key.slice(6) : key
    const skill = getSkillDefById(skillId)
    if (skill) return `发动技能【${skill.name}】`
    if (key.startsWith('equip:')) return `装备${key.slice(6)}`
    return key
}

function generalLabel(g: GeneralInstance): string {
    return getGeneralById(g.generalId)?.name ?? g.generalId
}

/** 只序列化该玩家能看到的信息：自己的手牌明细 + 其他角色的公开信息 */
function fmtGeneral(g: GeneralInstance, index: number, selfIndex: number, revealHand = false): string {
    const parts = [
        `#${index} ${generalLabel(g)}`,
        `势力=${g.faction}`,
        `体力=${g.hp}/${g.maxHp}`,
        `手牌=${g.hand.length}张`,
    ]
    const equips = [g.equip.weapon, g.equip.armor, g.equip.plus_horse, g.equip.minus_horse]
        .filter((c): c is NonNullable<typeof c> => !!c)
        .map(c => cardFullName(c))
    if (equips.length > 0) parts.push(`装备=${equips.join('、')}`)
    if (g.judgeZone.length > 0) parts.push(`判定区=${g.judgeZone.map(c => cardFullName(c)).join('、')}`)
    if (g.chained) parts.push('横置')
    if (index === selfIndex) {
        const hand = g.hand.map(c => `${c.id}=${cardFullName(c)}`).join('、') || '无'
        parts.push(`[你的手牌] ${hand}`)
        const skills = (getGeneralById(g.generalId)?.skills ?? [])
            .filter(s => s.type === SkillType.ACTIVE && !g.skillsUsedThisTurn.includes(s.id))
            .map(s => s.name)
        if (skills.length > 0) parts.push(`[主动技能] ${skills.join('、')}`)
    } else if (revealHand) {
        const hand = g.hand.map(c => `${c.id}=${cardFullName(c)}`).join('、') || '无'
        parts.push(`[同阵营手牌] ${hand}`)
    }
    if (!g.alive) parts.push('已阵亡')
    return parts.join(' ')
}

/** 残局（有人濒死/残血）交给大模型，其余用快模型 */
function pickTier(state: GameState): ModelTier {
    return state.generals.some(g => g.alive && g.hp <= 1) ? 'deep' : 'fast'
}

export function buildLlmPrompt(
    state: GameState,
    playerId: string,
    options: AiPlayOptionView[],
): { system: string; prompt: string; ticket: LlmTicket } {
    const selfIndex = state.activeGeneralIndex
    const self = state.generals[selfIndex]
    const lines: string[] = []
    lines.push(`模式：${state.mode === GameMode.DOUDIZHU ? '斗地主' : state.mode === GameMode.HUANLE_SHUANG ? '欢乐成双（2v2）' : '3v3'}`)
    lines.push(`你是 #${selfIndex} 的${generalLabel(self)}，现在是你的出牌阶段`)
    lines.push(`本回合已使用【杀】${state.attackUsedThisTurn} 次`)
    lines.push('场上角色（下标从 0 开始）：')
    state.generals.forEach((g, i) => lines.push(
        `- ${fmtGeneral(g, i, selfIndex, g.faction === self.faction && i !== selfIndex)}`))
    const recent = state.log.slice(-12).map(e => `- ${e.text}`)
    if (recent.length > 0) {
        lines.push('最近事件：')
        lines.push(...recent)
    }
    lines.push('可执行的动作（引擎已按规则校验，评分只是参考）：')
    for (const option of options) {
        lines.push(`- ${option.id}｜${describeOption(option.key)}｜评分 ${option.score}`)
    }
    lines.push('- end｜结束出牌阶段')
    lines.push('请只输出 JSON：{"option":"o1"} 或 {"option":"end"}')
    return {
        system: SYSTEM_PROMPT,
        prompt: lines.join('\n'),
        ticket: {
            turnSerial: `${state.roundState.roundNumber}:${state.activeGeneralIndex}:${state.turnPhase}`,
            activeIndex: selfIndex,
            handIds: self ? self.hand.map(c => c.id) : [],
            logLength: state.log.length,
            tier: pickTier(state),
            optionIds: options.map(o => o.id),
        },
    }
}

/** 解析模型给出的选项 id；不在本次列表里的 id 一律视为无效 */
export function parseChoice(raw: string, allowedIds: string[], allowEnd = true): string | null {
    const text = raw.trim()
    if (!text) return null
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    let parsed: unknown
    try {
        parsed = JSON.parse(text.slice(start, end + 1))
    } catch {
        return null
    }
    if (!parsed || typeof parsed !== 'object') return null
    const option = (parsed as Record<string, unknown>).option
    if (typeof option !== 'string') return null
    if (option === 'end') return allowEnd ? option : null
    return allowedIds.includes(option) ? option : null
}

/** 向 server 端代理请求一次决策；网络/解析失败都返回 null，由规则 AI 兜底 */
export async function requestLlmChoice(
    system: string,
    prompt: string,
    tier: ModelTier,
    allowedIds: string[],
    allowEnd = true,
    signal?: AbortSignal,
): Promise<string | null> {
    try {
        const res = await fetch('/api/ai/decision', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tier, system, prompt }),
            signal,
        })
        if (!res.ok) return null
        const data = await res.json() as { ok?: boolean; content?: string }
        if (!data.ok || typeof data.content !== 'string') {
            console.debug('[llm] server 未返回内容', data)
            return null
        }
        const parsed = parseChoice(data.content, allowedIds, allowEnd)
        if (!parsed) console.debug('[llm] 无法解析模型输出', data.content.slice(0, 240))
        return parsed
    } catch {
        return null
    }
}

/** 局面在等待模型期间是否已经被推进（推进了就丢弃这次决策） */
export function ticketStillValid(state: GameState, ticket: LlmTicket): boolean {
    if (state.phase !== GamePhase.PLAYING) return false
    if (state.activeGeneralIndex !== ticket.activeIndex) return false
    if (state.turnPhase !== TurnPhase.ACTION) return false
    const serial = `${state.roundState.roundNumber}:${state.activeGeneralIndex}:${state.turnPhase}`
    if (serial !== ticket.turnSerial) return false
    const self = state.generals[ticket.activeIndex]
    if (!self || !self.alive) return false
    const nowIds = self.hand.map(c => c.id)
    return nowIds.length === ticket.handIds.length && nowIds.every(id => ticket.handIds.includes(id))
}

/** 执行模型选中的选项；invalid 表示引擎拒绝执行，调用方应退回规则 AI */
export function applyLlmChoice(state: GameState, playerId: string, optionId: string): 'applied' | 'end_turn' | 'invalid' {
    if (optionId === 'end') {
        return handleEndTurn(state, playerId) === undefined ? 'end_turn' : 'invalid'
    }
    return runPlayOption(state, playerId, optionId) ? 'applied' : 'invalid'
}

// ─────────────────────────────────────────────────────────────
// 选将 / 布阵：同样交给本地模型
// ─────────────────────────────────────────────────────────────

export interface LlmDraftOption {
    id: string
    /** 引擎内部键，形如 pick:caocao / deploy:caocao:zhangliao:guojia / yield:first / landlord:1:caocao */
    key: string
    label: string
    score: number
}

export interface LlmDraftRequest {
    system: string
    prompt: string
    optionIds: string[]
    options: LlmDraftOption[]
}

const DRAFT_SYSTEM_PROMPT = [
    '你在代替一名玩家玩《三国杀》的选将环节。',
    '你只能从给定的选项列表里挑一个，回答格式固定为 JSON：{"option":"o1"}。',
    '判断依据是武将的技能本身：考虑技能联动、位置职责与胜负条件，而不是只看单将强度。',
    '只能使用列表里出现过的 id，不要编造。只输出 JSON。',
].join('\n')

/** 选将/布阵阶段的局面指纹：等待模型期间局面若已变化就丢弃这次选择 */
export function draftFingerprint(state: GameState): string {
    const pick = state.pickState
    const landlord = state.landlordPick
    return [
        state.phase,
        pick
            ? `${pick.pickStep}/${pick.warmPicked.length}/${pick.coolPicked.length}/${pick.waitingForPickYield ? 1 : 0}`
            : '-',
        landlord ? landlord.picked.map((id) => id ?? '_').join(',') : '-',
        state.pairPick ? state.pairPick.picked.map((id) => id ?? '_').join(',') : '-',
        state.deployState ? `${state.deployState.warmDeployed}/${state.deployState.coolDeployed}` : '-',
        deployStages.get(state)?.commander ?? '-',
    ].join('|')
}

/** 技能描述按长度截断：本地模型上下文不大，选将时要的是技能主旨而不是全文 */
const BRIEF_SKILL_CHARS = 40

function briefGeneral(def: GeneralDefinition): string {
    const roles = (GENERAL_ROLES[def.id] ?? []).map((r) => ROLE_LABEL[r]).join('/')
    const skills = def.skills.map((s) => {
        const text = s.description.length > BRIEF_SKILL_CHARS
            ? `${s.description.slice(0, BRIEF_SKILL_CHARS)}…`
            : s.description
        return `${s.name}：${text}`
    }).join('　')
    return `体力${def.maxHp}${roles ? `｜定位${roles}` : ''}｜${skills}`
}

function optionLines(options: LlmDraftOption[]): string[] {
    return options.map((o) => `- ${o.id}｜${o.label}｜评分 ${o.score}`)
}

/** 选将阶段的完整武将为池：已选武将也列出来，标明是谁选走的 */
function poolOverview(pick: NonNullable<GameState['pickState']>, faction: Faction): string[] {
    const mine = new Set((faction === Faction.WARM ? pick.warmPicked : pick.coolPicked).map((g) => g.id))
    const rival = new Set((faction === Faction.WARM ? pick.coolPicked : pick.warmPicked).map((g) => g.id))
    return pick.pool.map((def) => {
        const mark = mine.has(def.id) ? '（我方已选）' : rival.has(def.id) ? '（对方已选）' : ''
        return `- ${def.name}${mark}｜${briefGeneral(def)}`
    })
}

/** 斗地主：两名农民一起选，才能按技能联动组阵容 */
function farmerPairRequest(pick: NonNullable<GameState['landlordPick']>): LlmDraftRequest {
    const poolA = pick.pools[1]
    const poolB = pick.pools[2]
    const options: LlmDraftOption[] = []
    for (const a of poolA) {
        for (const b of poolB) {
            const score = (draftScore(a, [], []).total + draftScore(b, [a], []).total) / 2
            options.push({
                id: `o${options.length + 1}`,
                key: `landlord-pair:${a.id}:${b.id}`,
                label: `农民一 ${a.name}｜农民二 ${b.name}`,
                score: Math.round(score),
            })
        }
    }
    const lines = [
        '模式：斗地主（地主 6 选 1、两个农民各 5 选 1，三方同时选将）',
        '你是冷色方，一次性为两名农民选将：这一选决定的是两人的组合，要按技能联动来挑，而不是各挑最强单将',
        '胜负条件：地主阵亡则农民胜；两名农民全部阵亡则地主胜。不要选两人都脆皮、都不防守的组合',
        '两名农民同属冷方，可以互相喂牌、拆牌、拼点接应；一人开节奏、一人补刀续航最稳',
        '行动顺序：农民一先行动，农民二后行动',
        '农民一可选池：',
        ...poolA.map((g) => `- ${g.name}｜${briefGeneral(g)}`),
        '农民二可选池：',
        ...poolB.map((g) => `- ${g.name}｜${briefGeneral(g)}`),
        '可选组合（农民一 + 农民二，评分是规则表的联动参考值）：',
        ...optionLines(options),
        '请只输出 JSON：{"option":"o1"}',
    ]
    return {
        system: DRAFT_SYSTEM_PROMPT,
        prompt: lines.join('\n'),
        optionIds: options.map((o) => o.id),
        options,
    }
}

/** 斗地主：只差一个 AI 席位时单独问 */
function singleLandlordSeatRequest(pick: NonNullable<GameState['landlordPick']>, seat: number): LlmDraftRequest {
    const seatName = seat === 0 ? '地主' : seat === 1 ? '农民一' : '农民二'
    const allySeats = seat === 0 ? [0] : [1, 2]
    const allyPicked = allySeats
        .filter((i) => pick.picked[i])
        .map((i) => pick.pools[i].find((g) => g.id === pick.picked[i]))
        .filter((g): g is GeneralDefinition => !!g)

    const pool = pick.pools[seat]
    const options: LlmDraftOption[] = pool.map((def, i) => ({
        id: `o${i + 1}`,
        key: `landlord:${seat}:${def.id}`,
        label: `${def.name}（${briefGeneral(def)}）`,
        score: Math.round(draftScore(def, allyPicked, []).total),
    }))

    const lines = [
        '模式：斗地主（地主 6 选 1、两个农民各 5 选 1，三方同时选将）',
        seat === 0
            ? '你在为【地主】选将：地主单人对抗两名农民，体力上限 +1，并获得【飞扬】【跋扈】【强易】。你阵亡即负，两名农民全部阵亡才轮到农民输'
            : `你在为【${seatName}】选将：农民方两人共存亡，任意一人存活即可继续，只要地主阵亡就赢`,
        allySeats.length > 1 ? `另一名农民已选：${allyPicked.map((g) => g.name).join('、') || '无'}` : '',
        '可选武将：',
        ...optionLines(options),
        '请只输出 JSON：{"option":"o1"}',
    ].filter((line) => line !== '')
    return {
        system: DRAFT_SYSTEM_PROMPT,
        prompt: lines.join('\n'),
        optionIds: options.map((o) => o.id),
        options,
    }
}

function buildLandlordDraftPrompt(state: GameState, playerId: string): LlmDraftRequest | null {
    const pick = state.landlordPick
    const faction = state.players[playerId]?.faction
    if (!pick || !faction) return null
    const humanSide = state.landlordHumanSide ?? 'landlord'
    const isHumanSeat = (i: number) => (i === 0 ? humanSide === 'landlord' : humanSide === 'farmers')
    const emptyAi = [0, 1, 2].filter((i) => pick.picked[i] === null && !isHumanSeat(i))
    if (emptyAi.length === 0) return null
    // 两个农民席位都没定时合并成一次选择，模型才能考虑联动
    if (emptyAi.length === 2) return farmerPairRequest(pick)
    return singleLandlordSeatRequest(pick, emptyAi[0])
}

/** 欢乐成双：AI 同时控制两个座位，一次选出整套组合 */
function pairDraftRequest(state: GameState, playerId: string): LlmDraftRequest | null {
    const pick = state.pairPick
    const aiFaction = state.players[playerId]?.faction
    if (!pick || !aiFaction) return null
    const aiSeats = pairSeatsOf(aiFaction)
    const emptyAi = aiSeats.filter((i) => pick.picked[i] === null)
    if (emptyAi.length === 0) return null
    const humanSeats = state.pairHumanSide ? pairSeatsOf(state.pairHumanSide) : []
    const pickedDefs = (seats: number[]) => seats
        .map((i) => pick.picked[i] ? pick.pools[i].find((g) => g.id === pick.picked[i]) : undefined)
        .filter((g): g is GeneralDefinition => !!g)
    const allyPicked = pickedDefs(aiSeats)
    const rivalPicked = pickedDefs(humanSeats)
    const seatName = (i: number) => `${i + 1} 号位`
    const aiFactionName = aiFaction === Faction.WARM ? '暖色方' : '冷色方'
    const commonLines = [
        '模式：欢乐成双（2v2，四名角色，每席各选 1 名武将）',
        `你是${aiFactionName}，控制 ${aiSeats.map(seatName).join('、')}；对方控制 ${humanSeats.map(seatName).join('、')}`,
        '座次：1 号位冷色 → 2 号位暖色 → 3 号位暖色 → 4 号位冷色；1 号位先手，但初始手牌少 1 张',
        '胜负条件：任意一方两名角色全部阵亡即判负；同阵营两人手牌互相可见，能互相喂牌、拆牌、接杀',
        `我方已选：${allyPicked.map((g) => g.name).join('、') || '无'}`,
        `对方已选：${rivalPicked.map((g) => g.name).join('、') || '无'}`,
    ]

    if (emptyAi.length === 1) {
        const seat = emptyAi[0]
        const options: LlmDraftOption[] = pick.pools[seat].map((def, i) => ({
            id: `o${i + 1}`,
            key: `pair-seat:${seat}:${def.id}`,
            label: `【${seatName(seat)}】${def.name}（${briefGeneral(def)}）`,
            score: Math.round(draftScore(def, allyPicked, rivalPicked).total),
        }))
        const lines = [
            ...commonLines,
            `${seatName(seat)}可选池：`,
            ...pick.pools[seat].map((g) => `- ${g.name}｜${briefGeneral(g)}`),
            '可选武将：',
            ...optionLines(options),
            '请只输出 JSON：{"option":"o1"}',
        ]
        return { system: DRAFT_SYSTEM_PROMPT, prompt: lines.join('\n'), optionIds: options.map((o) => o.id), options }
    }

    const [seatA, seatB] = emptyAi
    const options: LlmDraftOption[] = []
    for (const a of pick.pools[seatA]) {
        for (const b of pick.pools[seatB]) {
            const score = (draftScore(a, allyPicked, rivalPicked).total
                + draftScore(b, [...allyPicked, a], rivalPicked).total) / 2
            options.push({
                id: `o${options.length + 1}`,
                key: `pair-pair:${seatA}:${a.id}:${seatB}:${b.id}`,
                label: `【${seatName(seatA)}】${a.name}｜【${seatName(seatB)}】${b.name}`,
                score: Math.round(score),
            })
        }
    }
    const lines = [
        ...commonLines,
        '你方两席是同一阵营，请一次性选出能配合的两人：一人开节奏、一人补位，或按技能联动组阵',
        `${seatName(seatA)}可选池：`,
        ...pick.pools[seatA].map((g) => `- ${g.name}｜${briefGeneral(g)}`),
        `${seatName(seatB)}可选池：`,
        ...pick.pools[seatB].map((g) => `- ${g.name}｜${briefGeneral(g)}`),
        '可选组合（两席同时选，评分是规则表的联动参考值）：',
        ...optionLines(options),
        '请只输出 JSON：{"option":"o1"}',
    ]
    return { system: DRAFT_SYSTEM_PROMPT, prompt: lines.join('\n'), optionIds: options.map((o) => o.id), options }
}

function buildPairDraftPrompt(state: GameState, playerId: string): LlmDraftRequest | null {
    if (state.phase !== GamePhase.GENERAL_PICK) return null
    return pairDraftRequest(state, playerId)
}

export function buildLlmDraftPrompt(state: GameState, playerId: string): LlmDraftRequest | null {
    if (state.mode === GameMode.DOUDIZHU) return buildLandlordDraftPrompt(state, playerId)
    if (state.mode === GameMode.HUANLE_SHUANG) return buildPairDraftPrompt(state, playerId)

    const pick = state.pickState
    const faction = state.players[playerId]?.faction
    if (!pick || !faction) return null

    if (state.phase === GamePhase.GENERAL_PICK && pick.waitingForPickYield) {
        if (faction !== Faction.WARM) return null
        const options: LlmDraftOption[] = [
            { id: 'o1', key: 'yield:first', label: '先选（我方先挑，对方连挑两名）', score: 0 },
            { id: 'o2', key: 'yield:second', label: '让先（对方先挑，我方连挑两名）', score: 0 },
        ]
        const lines = [
            '模式：3v3 统率三军（双方各选 8 名武将，随后各部署主帅 1 名 + 前锋 2 名）',
            '现在由暖色方（你）决定选将顺序：先选先拿走最强的第一名，让先则连续挑选两名、能凑成一手连招',
            '本局武将池：',
            ...poolOverview(pick, faction),
            '可选操作：',
            ...optionLines(options),
            '请只输出 JSON：{"option":"o1"}',
        ]
        return { system: DRAFT_SYSTEM_PROMPT, prompt: lines.join('\n'), optionIds: options.map((o) => o.id), options }
    }

    if (state.phase === GamePhase.GENERAL_PICK) {
        if (currentPickFaction(state) !== faction) return null
        const taken = new Set([...pick.warmPicked, ...pick.coolPicked].map((g) => g.id))
        const candidates = pick.pool.filter((g) => !taken.has(g.id))
        if (candidates.length === 0) return null
        const mine = faction === Faction.WARM ? pick.warmPicked : pick.coolPicked
        const rival = faction === Faction.WARM ? pick.coolPicked : pick.warmPicked
        const options: LlmDraftOption[] = candidates.map((def, i) => ({
            id: `o${i + 1}`,
            key: `pick:${def.id}`,
            label: def.name,
            score: Math.round(draftScore(def, mine, rival).total),
        }))
        const lines = [
            '模式：3v3 统率三军（双方各选 8 名武将，随后各部署主帅 1 名 + 前锋 2 名）',
            `你是${faction === Faction.WARM ? '暖' : '冷'}色方，现在选第 ${mine.length + 1} 名武将`,
            `我方已选：${mine.map((g) => g.name).join('、') || '无'}`,
            `对方已选：${rival.map((g) => g.name).join('、') || '无'}`,
            '本局武将池（含已被选走的）：',
            ...poolOverview(pick, faction),
            '本轮可选的 id（武将详情见上表，评分是按规则表算的参考值）：',
            ...optionLines(options),
            '请只输出 JSON：{"option":"o1"}',
        ]
        return { system: DRAFT_SYSTEM_PROMPT, prompt: lines.join('\n'), optionIds: options.map((o) => o.id), options }
    }

    if (state.phase === GamePhase.DEPLOY) {
        if (state.generals.some((g) => g.playerId === playerId)) return null
        const mine = faction === Faction.WARM ? pick.warmPicked : pick.coolPicked
        if (mine.length < 3) return null
        return deployRequest(state, faction, mine)
    }

    return null
}

/** 部署分两步问：先定主帅，再从剩下的人里定两名前锋与先后顺序 */
interface DeployStage {
    commander?: string
}

const deployStages = new WeakMap<GameState, DeployStage>()

function deployStageOf(state: GameState): DeployStage {
    let stage = deployStages.get(state)
    if (!stage) {
        stage = {}
        deployStages.set(state, stage)
    }
    return stage
}

function deployRequest(state: GameState, faction: Faction, mine: GeneralDefinition[]): LlmDraftRequest {
    const stage = deployStageOf(state)
    const isWarm = faction === Faction.WARM
    const options: LlmDraftOption[] = []
    const lines = [
        '模式：3v3 统率三军部署阶段：从已选的武将里定主帅 1 名、前锋 2 名，其余不上场',
        isWarm
            ? '你是暖色方：主帅体力上限 +1，且起手多摸 1 张（5 张，其余角色 4 张）；本局默认由冷色方先手，主帅必须扛得住第一轮'
            : '你是冷色方：主帅体力上限 +1；本局默认由你方先手，前锋的连招能更早启动',
        '胜负条件：主帅阵亡即判负，前锋阵亡不直接输',
        '两名前锋是推动局势的主要进程：按先后顺序行动，先行动的先出手，两人的接杀/喂牌/控制决定中期节奏',
        '推荐结构：一人开节奏（输出或控制）、一人补位（辅助或续航反打），别把两个脆皮一起放前锋',
        '我方已选武将：',
        ...mine.map((g) => `- ${g.name}（${briefGeneral(g)}）`),
    ]

    if (!stage.commander) {
        for (const g of mine) {
            options.push({ id: `o${options.length + 1}`, key: `deploy-commander:${g.id}`, label: `主帅 ${g.name}`, score: 0 })
        }
        lines.push('第一步：先定主帅——谁最能承伤与自保，+1 体力上限给谁最值', ...optionLinesNoScore(options))
    } else {
        const commander = mine.find((g) => g.id === stage.commander)
        const rest = mine.filter((g) => g.id !== stage.commander)
        for (const a of rest) {
            for (const b of rest) {
                if (a.id === b.id) continue
                options.push({
                    id: `o${options.length + 1}`,
                    key: `deploy-flanks:${stage.commander}:${a.id}:${b.id}`,
                    label: `先行动前锋 ${a.name}｜后行动前锋 ${b.name}`,
                    score: 0,
                })
            }
        }
        lines.push(
            `主帅已定：${commander?.name ?? stage.commander}`,
            `第二步：从剩下 ${rest.length} 人里选两名前锋，并决定谁先行动`,
            ...optionLinesNoScore(options),
        )
    }

    lines.push('请只输出 JSON：{"option":"o1"}')
    return {
        system: DRAFT_SYSTEM_PROMPT,
        prompt: lines.join('\n'),
        optionIds: options.map((o) => o.id),
        options,
    }
}

function optionLinesNoScore(options: LlmDraftOption[]): string[] {
    return options.map((o) => `- ${o.id}｜${o.label}`)
}

/** 执行模型选中的选将/布阵选项；返回是否真的推进了局面 */
export function applyLlmDraft(state: GameState, playerId: string, option: LlmDraftOption): boolean {
    const key = option.key
    const faction = state.players[playerId]?.faction

    if (key.startsWith('yield:')) {
        return handlePickYield(state, Faction.WARM, key === 'yield:second') === undefined
    }

    if (key.startsWith('pick:') && faction) {
        return !('error' in localPickGeneral(state, faction, key.slice(5)))
    }

    if (key.startsWith('deploy-commander:')) {
        const commander = key.slice('deploy-commander:'.length)
        const strike = faction === Faction.WARM ? state.pickState?.warmPicked : state.pickState?.coolPicked
        if (!strike?.some((g) => g.id === commander)) return false
        deployStageOf(state).commander = commander
        return true
    }

    if (key.startsWith('deploy-flanks:')) {
        if (!faction) return false
        const [, commander, flankA, flankB] = key.split(':')
        const deployed = !('error' in localDeployGenerals(state, faction, commander, flankA, flankB))
        if (deployed) delete deployStages.get(state)?.commander
        return deployed
    }

    if (key.startsWith('pair-pair:')) {
        const pick = state.pairPick
        const aiFaction = state.players[playerId]?.faction
        if (!pick || !aiFaction) return false
        const [, seatAText, firstId, seatBText, secondId] = key.split(':')
        const seatA = Number(seatAText)
        const seatB = Number(seatBText)
        const aiSeats = pairSeatsOf(aiFaction)
        if (!aiSeats.includes(seatA) || !aiSeats.includes(seatB) || seatA === seatB) return false
        if (pick.picked[seatA] || pick.picked[seatB]) return false
        if (!pick.pools[seatA].some((g) => g.id === firstId)) return false
        if (!pick.pools[seatB].some((g) => g.id === secondId)) return false
        pick.picked[seatA] = firstId
        pick.picked[seatB] = secondId
        const nameOf = (id: string) => getGeneralById(id)?.name ?? id
        addLog(state, `【${seatA + 1} 号位】选定武将【${nameOf(firstId)}】，【${seatB + 1} 号位】选定武将【${nameOf(secondId)}】`)
        if (pick.picked.every((id) => id !== null)) setupPairPlay(state)
        return true
    }

    if (key.startsWith('pair-seat:')) {
        const pick = state.pairPick
        const aiFaction = state.players[playerId]?.faction
        if (!pick || !aiFaction) return false
        const [, seatText, generalId] = key.split(':')
        const seat = Number(seatText)
        if (!pairSeatsOf(aiFaction).includes(seat)) return false
        if (pick.picked[seat]) return false
        if (!pick.pools[seat].some((g) => g.id === generalId)) return false
        pick.picked[seat] = generalId
        addLog(state, `【${seat + 1} 号位】选定武将【${getGeneralById(generalId)?.name ?? generalId}】`)
        if (pick.picked.every((id) => id !== null)) setupPairPlay(state)
        return true
    }

    if (key.startsWith('landlord-pair:')) {
        const pick = state.landlordPick
        if (!pick) return false
        const [, firstId, secondId] = key.split(':')
        if (pick.picked[1] || pick.picked[2]) return false
        if (!pick.pools[1].some((g) => g.id === firstId)) return false
        if (!pick.pools[2].some((g) => g.id === secondId)) return false
        pick.picked[1] = firstId
        pick.picked[2] = secondId
        const nameOf = (id: string) => getGeneralById(id)?.name ?? id
        addLog(state, `【农民一】选定武将【${nameOf(firstId)}】，【农民二】选定武将【${nameOf(secondId)}】`)
        if (pick.picked.every((id) => id !== null)) setupLandlordPlay(state)
        return true
    }

    if (key.startsWith('landlord:')) {
        const pick = state.landlordPick
        if (!pick) return false
        const [, seatText, generalId] = key.split(':')
        const seat = Number(seatText)
        if (!Number.isInteger(seat) || seat < 0 || seat > 2) return false
        if (pick.picked[seat]) return false
        if (!pick.pools[seat].some((g) => g.id === generalId)) return false
        pick.picked[seat] = generalId
        const seatName = seat === 0 ? '地主' : seat === 1 ? '农民一' : '农民二'
        addLog(state, `【${seatName}】选定武将【${getGeneralById(generalId)?.name ?? generalId}】`)
        if (pick.picked.every((id) => id !== null)) setupLandlordPlay(state)
        return true
    }

    return false
}
