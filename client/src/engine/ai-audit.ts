/**
 * 规则式 PC 的决策点审计层。
 *
 * 未开启时所有入口立即返回，对正常对局零影响；录制结果通过 sink 交给调用方落盘，
 * 本文件不依赖 Node，浏览器端同样安全。
 */
import {
    BasicCardName, CardCategory, Faction, GameState, SeatRole, TrickCardName,
} from 'sgs3v3-shared'
import { getActiveGeneral, getAttackRange } from './game-state'
import { PASS_SCORE } from './ai-policy'

export type DecisionKind = 'play' | 'respond' | 'discard' | 'skill' | 'negate' | 'unit' | 'draft'
export type FeatureValue = number | boolean
export type Features = Record<string, FeatureValue>

export interface FeatureSpec {
    name: string
    type: 'number' | 'boolean'
    desc: string
}

/**
 * 局面特征词表：谓词校验、LLM 提示词与后续代码生成共用这一份定义。
 * 只使用公开信息（血量、手牌张数、装备、弃牌堆等），不读取对手手牌内容。
 */
export const FEATURE_SPECS: FeatureSpec[] = [
    { name: 'my_hp', type: 'number', desc: '当前决策角色体力' },
    { name: 'my_max_hp', type: 'number', desc: '当前决策角色体力上限' },
    { name: 'my_hand', type: 'number', desc: '当前决策角色手牌数' },
    { name: 'my_equip', type: 'number', desc: '当前决策角色装备数' },
    { name: 'my_judge', type: 'number', desc: '当前决策角色判定区牌数' },
    { name: 'cmd_hp', type: 'number', desc: '己方主帅体力（无主帅记 0）' },
    { name: 'cmd_max_hp', type: 'number', desc: '己方主帅体力上限' },
    { name: 'ally_alive', type: 'number', desc: '己方存活人数' },
    { name: 'ally_low_hp', type: 'number', desc: '己方体力≤1 的存活人数' },
    { name: 'enemy_alive', type: 'number', desc: '敌方存活人数' },
    { name: 'enemy_cmd_hp', type: 'number', desc: '敌方主帅体力' },
    { name: 'enemy_cmd_hand', type: 'number', desc: '敌方主帅手牌数' },
    { name: 'enemy_cmd_armor', type: 'boolean', desc: '敌方主帅有防具' },
    { name: 'enemy_cmd_horse', type: 'boolean', desc: '敌方主帅有 +1 马' },
    { name: 'enemy_cmd_judge', type: 'number', desc: '敌方主帅判定区牌数' },
    { name: 'enemy_min_hp', type: 'number', desc: '敌方存活角色最低体力' },
    { name: 'enemy_hand_total', type: 'number', desc: '敌方手牌总数' },
    { name: 'enemy_equip_total', type: 'number', desc: '敌方装备总数' },
    { name: 'hp_gap', type: 'number', desc: '己方总血量减敌方总血量' },
    { name: 'slash', type: 'number', desc: '手牌中【杀】的数量' },
    { name: 'dodge', type: 'number', desc: '手牌中【闪】的数量' },
    { name: 'peach', type: 'number', desc: '手牌中【桃】的数量' },
    { name: 'wine', type: 'number', desc: '手牌中【酒】的数量' },
    { name: 'trick', type: 'number', desc: '手牌中锦囊牌的数量' },
    { name: 'equip_hand', type: 'number', desc: '手牌中装备牌的数量' },
    { name: 'negate_hand', type: 'number', desc: '手牌中【无懈可击】的数量' },
    { name: 'attack_used', type: 'number', desc: '本回合已使用的【杀】次数' },
    { name: 'deck_left', type: 'number', desc: '牌堆剩余张数' },
    { name: 'discard_count', type: 'number', desc: '弃牌堆张数' },
    { name: 'round', type: 'number', desc: '当前大回合数' },
    { name: 'action_step', type: 'number', desc: '当前大回合内行动序号' },
    { name: 'foe_in_range', type: 'number', desc: '攻击范围内敌方人数' },
    { name: 'enemy_chained', type: 'number', desc: '横置状态的敌方人数' },
    { name: 'ally_chained', type: 'number', desc: '横置状态的己方人数' },
    { name: 'is_first_mover', type: 'boolean', desc: '己方是本大回合先手' },
    { name: 'has_weapon', type: 'boolean', desc: '当前决策角色装备武器' },
    { name: 'has_armor', type: 'boolean', desc: '当前决策角色装备防具' },
    { name: 'kill_window', type: 'boolean', desc: '本回合存在可斩杀的目标' },
    { name: 'commander_kill', type: 'boolean', desc: '本回合可直接斩杀敌方主帅' },
    { name: 'under_threat', type: 'boolean', desc: '主帅血量≤2 或己方有人濒危或人数劣势' },
    { name: 'enemy_saving', type: 'boolean', desc: '对手正在攒牌（近期无明显动作）' },
    { name: 'is_aggressive', type: 'boolean', desc: '己方是先手方（节奏偏进攻）' },
]

const FEATURE_TYPES = new Map(FEATURE_SPECS.map((spec) => [spec.name, spec.type]))

export function isFeatureName(name: string): boolean {
    return FEATURE_TYPES.has(name)
}

export function featureTable(): FeatureSpec[] {
    return FEATURE_SPECS.map((spec) => ({ ...spec }))
}

const SLASH_NAMES: string[] = [BasicCardName.ATTACK, BasicCardName.FIRE_SLASH, BasicCardName.THUNDER_SLASH]

/** 局面特征抽取；extras 覆盖同名项（由出牌阶段已有的中间量提供，避免重复推导） */
export function extractFeatures(state: GameState, playerId: string, extras: Features = {}): Features {
    const faction = state.players[playerId]?.faction
    const mine = faction ? state.generals.filter((g) => g.faction === faction) : []
    const mineAlive = mine.filter((g) => g.alive)
    const foes = faction ? state.generals.filter((g) => g.alive && g.faction !== faction) : []
    const active = getActiveGeneral(state)
    const me = active && active.playerId === playerId ? active : mineAlive.find((g) => g.playerId === playerId)
    const hand = me?.hand ?? []
    const commander = mine.find((g) => g.seatRole === SeatRole.COMMANDER)
    const enemyCommander = foes.find((g) => g.seatRole === SeatRole.COMMANDER)
    const firstMover = state.roundState?.firstMover
    const inRange = me
        ? foes.filter((g) => {
            try {
                return getAttackRange(me, g, state.generals).inRange
            } catch {
                return false
            }
        }).length
        : 0

    const feats: Features = {
        my_hp: me?.hp ?? 0,
        my_max_hp: me?.maxHp ?? 0,
        my_hand: hand.length,
        my_equip: me ? Object.values(me.equip).filter(Boolean).length : 0,
        my_judge: me?.judgeZone.length ?? 0,
        cmd_hp: commander?.alive ? commander.hp : 0,
        cmd_max_hp: commander?.maxHp ?? 0,
        ally_alive: mineAlive.length,
        ally_low_hp: mineAlive.filter((g) => g.hp <= 1).length,
        enemy_alive: foes.length,
        enemy_cmd_hp: enemyCommander?.hp ?? 9,
        enemy_cmd_hand: enemyCommander?.hand.length ?? 0,
        enemy_cmd_armor: !!enemyCommander?.equip.armor,
        enemy_cmd_horse: !!enemyCommander?.equip.plus_horse,
        enemy_cmd_judge: enemyCommander?.judgeZone.length ?? 0,
        enemy_min_hp: foes.length ? Math.min(...foes.map((g) => g.hp)) : 9,
        enemy_hand_total: foes.reduce((sum, g) => sum + g.hand.length, 0),
        enemy_equip_total: foes.reduce((sum, g) => sum + Object.values(g.equip).filter(Boolean).length, 0),
        hp_gap: mineAlive.reduce((sum, g) => sum + g.hp, 0) - foes.reduce((sum, g) => sum + g.hp, 0),
        slash: hand.filter((c) => c.category === CardCategory.BASIC && SLASH_NAMES.includes(c.name)).length,
        dodge: hand.filter((c) => c.name === BasicCardName.DODGE).length,
        peach: hand.filter((c) => c.name === BasicCardName.PEACH).length,
        wine: hand.filter((c) => c.name === BasicCardName.WINE).length,
        trick: hand.filter((c) => c.category === CardCategory.TRICK).length,
        equip_hand: hand.filter((c) => c.category === CardCategory.EQUIPMENT).length,
        negate_hand: hand.filter((c) => c.name === TrickCardName.NEGATE).length,
        attack_used: state.attackUsedThisTurn ?? 0,
        deck_left: state.deck.length,
        discard_count: state.discard.length,
        round: state.roundState?.roundNumber ?? 0,
        action_step: state.roundState?.currentActionStep ?? 0,
        foe_in_range: inRange,
        enemy_chained: foes.filter((g) => g.chained).length,
        ally_chained: mineAlive.filter((g) => g.chained).length,
        is_first_mover: !!faction && firstMover === faction,
        has_weapon: !!me?.equip.weapon,
        has_armor: !!me?.equip.armor,
        // 下列项由出牌阶段的已有判断覆盖，缺省为保守值
        kill_window: false,
        commander_kill: false,
        under_threat: (commander?.alive ? commander.hp : 9) <= 2,
        enemy_saving: false,
        is_aggressive: !!faction && firstMover === faction,
    }
    for (const [key, value] of Object.entries(extras)) {
        if (FEATURE_TYPES.has(key)) feats[key] = value
    }
    return feats
}

// ─────────────────────────────────────────────────────────────
// 谓词 DSL：只允许词表内的字段与固定比较符，可在代码里直接翻译成 if 条件
// ─────────────────────────────────────────────────────────────

export type CompareOp = '<=' | '>=' | '<' | '>' | '==' | '!='
export const COMPARE_OPS: CompareOp[] = ['<=', '>=', '<', '>', '==', '!=']

export type Predicate =
    | { all: Predicate[] }
    | { any: Predicate[] }
    | { not: Predicate | string }
    | { cmp: [string, CompareOp, FeatureValue] }
    | { in: [string, FeatureValue[]] }

export function validatePredicate(pred: unknown, path = 'trigger'): string[] {
    if (!pred || typeof pred !== 'object') return [`${path} 不是对象`]
    const p = pred as Record<string, unknown>
    const keys = Object.keys(p)
    if (keys.length !== 1) return [`${path} 必须恰好包含一个操作符（all/any/not/cmp/in）`]
    const op = keys[0]
    if (op === 'all' || op === 'any') {
        const list = p[op]
        if (!Array.isArray(list)) return [`${path}.${op} 必须是数组`]
        return list.flatMap((item, i) => validatePredicate(item, `${path}.${op}[${i}]`))
    }
    if (op === 'not') {
        // 布尔特征允许简写为 { "not": "特征名" }
        if (typeof p.not === 'string') {
            const type = FEATURE_TYPES.get(p.not)
            return type === 'boolean' ? [] : [`${path}.not 引用了非布尔特征：${p.not}`]
        }
        return validatePredicate(p.not, `${path}.not`)
    }
    if (op === 'cmp' || op === 'in') {
        const args = p[op]
        if (!Array.isArray(args)) return [`${path}.${op} 必须是数组`]
        const [name, second, third] = args as [unknown, unknown, unknown]
        if (typeof name !== 'string' || !isFeatureName(name)) return [`${path} 含未知特征：${String(name)}`]
        const expected = FEATURE_TYPES.get(name)
        const errors: string[] = []
        if (op === 'cmp') {
            if (!COMPARE_OPS.includes(second as CompareOp)) errors.push(`${path} 比较符非法：${String(second)}`)
            if (typeof third !== 'boolean' && typeof third !== 'number') errors.push(`${path} 比较值必须是数字或布尔`)
            else if (expected === 'boolean' && typeof third !== 'boolean') errors.push(`${path}.${name} 是布尔特征，比较值必须是 true/false`)
            else if (expected === 'number' && typeof third !== 'number') errors.push(`${path}.${name} 是数值特征，比较值必须是数字`)
            if (args.length !== 3) errors.push(`${path}.cmp 必须是 [特征, 比较符, 值]`)
        } else {
            const values = args[1]
            if (!Array.isArray(values) || values.length === 0) errors.push(`${path}.in 必须是 [特征, 非空数组]`)
            else if (values.some((v) => typeof v !== 'number' && typeof v !== 'boolean')) errors.push(`${path}.in 的值必须是数字或布尔`)
            if (args.length !== 2) errors.push(`${path}.in 必须是 [特征, 值数组]`)
        }
        return errors
    }
    return [`${path} 含未知操作符：${op}`]
}

export function evalPredicate(pred: Predicate, feats: Features): boolean {
    const p = pred as Record<string, unknown>
    const op = Object.keys(p)[0]
    if (op === 'all') return (p.all as Predicate[]).every((item) => evalPredicate(item, feats))
    if (op === 'any') return (p.any as Predicate[]).some((item) => evalPredicate(item, feats))
    if (op === 'not') {
        if (typeof p.not === 'string') return !feats[p.not]
        return !evalPredicate(p.not as Predicate, feats)
    }
    if (op === 'cmp') {
        const [name, operator, value] = p.cmp as [string, CompareOp, FeatureValue]
        const actual = feats[name]
        if (actual === undefined) return false
        switch (operator) {
            case '<=': return actual <= value
            case '>=': return actual >= value
            case '<': return actual < value
            case '>': return actual > value
            case '==': return actual === value
            case '!=': return actual !== value
            default: return false
        }
    }
    if (op === 'in') {
        const [name, values] = p.in as [string, FeatureValue[]]
        return values.includes(feats[name])
    }
    return false
}

// ─────────────────────────────────────────────────────────────
// 决策点录制
// ─────────────────────────────────────────────────────────────

export interface CandidateRecord {
    ruleId: string
    score?: number
    final?: number
    chosen?: boolean
    plan?: string
}

export interface DecisionRecord {
    runId: string
    seed: number
    game: number
    kind: DecisionKind
    decisionIndex: number
    playerId: string
    faction: string
    generalId: string
    seatRole: string
    ruleId: string
    candidates: CandidateRecord[]
    feats: Features
    alternative: 'enumerated' | 'none'
    meta: Record<string, unknown>
    outcome?: { winner: string | null; steps: number; ok: boolean }
}

export interface AuditIntervention {
    when: Predicate
    forceRuleId: string
    /** 只作用于该阵营（反事实必须只改一方，否则双方都变，测不出差异） */
    onlyFaction?: string
    /** 只作用于该局（种子序号），用于单点干预复核 */
    onlyGame?: number
    /** 只作用于该决策序号，用于单点反事实 */
    onlyDecisionIndex?: number
    /** 命中上限，避免整局被同一干预带偏 */
    maxHits?: number
}

export interface AuditOptions {
    runId: string
    /** 是否记录决策点 */
    record: boolean
    sink?: (record: DecisionRecord) => void
    /** 未被重点标记的出牌决策，每 N 个保留 1 个（确定性步长，不消耗对局随机数） */
    playStride?: number
    maxDecisionsPerGame?: number
    intervention?: AuditIntervention | null
}

export interface DecisionContext {
    index: number
    playerId: string
    faction: string
    generalId: string
    seatRole: string
    feats: Features
}

const MARGIN_EPSILON = 6

let options: AuditOptions | null = null
let gameMeta: { seed: number; game: number } | null = null
let decisionIndex = 0
let playSeen = 0
let interventionHits = 0
let forcedApplied = 0
let buffer: DecisionRecord[] = []

export function startAudit(next: AuditOptions): void {
    options = next
    gameMeta = null
    decisionIndex = 0
    playSeen = 0
    interventionHits = 0
    forcedApplied = 0
    buffer = []
}

export function stopAudit(): void {
    options = null
    gameMeta = null
    buffer = []
}

export function auditEnabled(): boolean {
    return !!options?.record
}

export function interventionEnabled(): boolean {
    return !!options?.intervention
}

export function startAuditGame(meta: { seed: number; game: number }): void {
    gameMeta = meta
    decisionIndex = 0
    playSeen = 0
    interventionHits = 0
    forcedApplied = 0
    buffer = []
}

/** 结束本局：给缓冲的决策点打上结果并交给 sink；返回本局记录条数 */
export function finishAuditGame(outcome: { winner: string | null; steps: number; ok: boolean }): number {
    if (!options) return 0
    const sink = options.sink
    if (sink) {
        const result = { winner: outcome.winner, steps: outcome.steps, ok: outcome.ok }
        for (const record of buffer) {
            record.outcome = result
            sink(record)
        }
    }
    const count = buffer.length
    buffer = []
    gameMeta = null
    return count
}

/** 每次决策都必须调用，保证决策序号连续（即使该条不入库） */
export function beginDecision(
    state: GameState,
    playerId: string,
    kind: DecisionKind,
    extras: Features = {},
): DecisionContext | null {
    if (!options) return null
    const player = state.players[playerId]
    if (!player) return null
    const mine = state.generals.filter((g) => g.playerId === playerId && g.alive)
    const active = getActiveGeneral(state)
    const actor = active && active.playerId === playerId ? active : mine[0]
    return {
        index: decisionIndex,
        playerId,
        faction: player.faction ?? '',
        generalId: actor?.generalId ?? '',
        seatRole: actor ? String(actor.seatRole) : '',
        feats: extractFeatures(state, playerId, extras),
    }
}

/** 干预是否命中本决策；命中时返回必须强制选择的规则 id */
export function forcedRule(context: DecisionContext, _kind: DecisionKind): string | null {
    const intervention = options?.intervention
    if (!intervention) return null
    if (intervention.onlyFaction && intervention.onlyFaction !== context.faction) return null
    if (intervention.onlyGame !== undefined && gameMeta?.game !== intervention.onlyGame) return null
    if (intervention.onlyDecisionIndex !== undefined && intervention.onlyDecisionIndex !== context.index) return null
    if (intervention.maxHits !== undefined && interventionHits >= intervention.maxHits) return null
    if (!evalPredicate(intervention.when, context.feats)) return null
    interventionHits++
    return intervention.forceRuleId
}

function isInteresting(candidates: CandidateRecord[], ruleId: string): boolean {
    if (ruleId === 'PASS') return true
    if (candidates.length < 2) return false
    const chosen = candidates.find((c) => c.chosen)
    if (!chosen) return true
    const others = candidates.filter((c) => !c.chosen && (c.score ?? 0) > 0)
    if (others.length === 0) return false
    const bestOther = others.reduce((best, c) => ((c.final ?? c.score ?? 0) > (best.final ?? best.score ?? 0) ? c : best))
    // 近失：分差极小，胜负可能被一条规则翻转
    if (Math.abs((chosen.final ?? chosen.score ?? 0) - (bestOther.final ?? bestOther.score ?? 0)) < MARGIN_EPSILON) return true
    // 冲突：原始分更高却因计划加成落选
    if ((bestOther.score ?? 0) > (chosen.score ?? 0) &&
        (bestOther.final ?? 0) < (chosen.final ?? 0)) return true
    // 空过：所有候选都低于门槛
    const bestScore = Math.max(...candidates.map((c) => c.score ?? 0))
    return bestScore < PASS_SCORE
}

/**
 * 记录一个决策点。play 决策按“重点标记 + 确定性步长抽样”保留，
 * 其余类型体量很小，全部保留。
 */
export function endDecision(
    context: DecisionContext | null,
    kind: DecisionKind,
    ruleId: string,
    candidates: CandidateRecord[] = [],
    meta: Record<string, unknown> = {},
): void {
    if (!context || !options) return
    const index = decisionIndex
    decisionIndex++
    if (meta.forced) forcedApplied++
    if (!gameMeta) return
    if (buffer.length >= (options.maxDecisionsPerGame ?? 400)) return
    if (!options.record) return
    const interesting = (kind === 'play' || kind === 'respond' || kind === 'negate') && isInteresting(candidates, ruleId)
    const forced = interventionHits > 0 && !!options.intervention
    let keep = kind !== 'play'
    if (kind === 'play') {
        playSeen++
        const stride = options.playStride ?? 8
        keep = interesting || forced || playSeen % stride === 0
    }
    if (!keep) return
    buffer.push({
        runId: options.runId,
        seed: gameMeta.seed,
        game: gameMeta.game,
        kind,
        decisionIndex: index,
        playerId: context.playerId,
        faction: context.faction,
        generalId: context.generalId,
        seatRole: context.seatRole,
        ruleId,
        candidates,
        feats: context.feats,
        alternative: kind === 'play' && candidates.length > 1 ? 'enumerated' : 'none',
        meta,
    })
}

export function pendingDecisionCount(): number {
    return buffer.length
}

/** 本局干预命中次数（反事实分析用来判断该局是否真的被改动过） */
export function interventionHitCount(): number {
    return interventionHits
}

/** 本局干预真正落到执行上的次数（备选动作不可执行时不会计入） */
export function forcedAppliedCount(): number {
    return forcedApplied
}
