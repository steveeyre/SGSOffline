import type { GameState, LogEntry } from 'sgs3v3-shared'
import { getGeneralById } from './generals'
import { cardFullName } from './card-utils'
import { readStorageItem, removeStorageItem } from './storage-keys'

/**
 * 玩家对局日志：记录每一手的操作、参与武将与该手产生的引擎日志，
 * 供之后复盘“这一手为什么这么打 / 哪一手打错了”来改进 AI。
 *
 * v2 增加“为复盘而生”的决策记录：决策快照、候选动作及得分、最终动作、
 * 触发规则 ID、关键事件标记。随机种子在记录顶层。
 *
 * 复盘 ID：对局为 m{开局时间36}-{种子36}，操作/决策分别追加 .a{seq} / .d{seq}，
 * 日志条目在 addLog 时带 matchId+seq，被操作/决策覆盖时补 actionSeq/decisionSeq，
 * 因此界面点任意一条日志都能拼出可直接检索的 ID。
 */

const STORAGE_KEY = 'sgsoffline.matchLogs.v1'
const MAX_RECORDS = 100

/** 生成对局复盘 ID；单机下一毫秒内同种子重复开局不会出现 */
export function makeMatchId(seed: number | null, startedAt: number): string {
    return `m${startedAt.toString(36)}-${((seed ?? 0) >>> 0).toString(36)}`
}

/** 一条日志对应的复盘 ID：优先决策，其次操作，最后退化为本局日志序号 */
export function logReviewId(entry: LogEntry): string | null {
    if (!entry.matchId) return null
    if (entry.decisionSeq !== undefined) return `${entry.matchId}.d${entry.decisionSeq}`
    if (entry.actionSeq !== undefined) return `${entry.matchId}.a${entry.actionSeq}`
    if (entry.seq !== undefined) return `${entry.matchId}.l${entry.seq}`
    return entry.matchId
}

export interface MatchLogAction {
    /** 复盘 ID：{matchId}.a{seq} */
    id: string
    seq: number
    at: number
    round: number
    turnSerial: number
    phase: string
    side: 'human' | 'ai' | 'hotseat'
    seat: number
    actor: string
    kind: string
    payload?: unknown
    error?: string
    logs: string[]
}

/** 决策时刻的完整状态向量：含所有座位的牌面，仅供本地复盘使用 */
export interface DecisionSnapshot {
    round: number
    turnSerial: number
    phase: string
    turnPhase: string
    activeSeat: number
    attackUsed: number
    deckCount: number
    discardTop: string | null
    seats: Array<{
        seat: number
        id: string
        name: string
        faction: string
        role: string
        hp: number
        maxHp: number
        handCount: number
        hand: string[]
        equip: string[]
        judge: string[]
        chained: boolean
        alive: boolean
    }>
}

export interface DecisionCandidate {
    id: string
    /** 触发该候选的规则标识（规则 AI 的决策表 key，如 slash / skill:kurou） */
    ruleId: string
    label: string
    score: number
    finalScore?: number
    chosen?: boolean
}

export interface DecisionRecord {
    /** 复盘 ID：{matchId}.d{seq} */
    id: string
    seq: number
    at: number
    kind: 'play' | 'skill' | 'pick' | 'discard' | 'respond'
    source: 'rule' | 'human'
    side: 'human' | 'ai' | 'hotseat'
    actor: string
    seat: number
    /** 计划/策略分支（规则 AI 的 plan 或技能 ID） */
    plan?: string
    snapshot: DecisionSnapshot
    candidates: DecisionCandidate[]
    chosen: DecisionCandidate | null
    events: string[]
    logs: string[]
}

export interface MatchLogRecord {
    version: 2
    /** 本局复盘 ID，日志/操作/决策 ID 的前缀 */
    id: string
    mode: string
    seed: number | null
    startedAt: number
    endedAt?: number
    winner?: string
    /** 本地玩家执哪一方；hotseat / 旧记录可能没有 */
    humanFaction?: string
    /** 左右手对弈（同屏两人），不计入普通胜率 */
    hotseat?: boolean
    generals: Array<{ seat: number; id: string; name: string; faction: string; role: string }>
    actions: MatchLogAction[]
    decisions: DecisionRecord[]
}

let current: MatchLogRecord | null = null

function safeStorage(): Storage | null {
    try {
        return typeof localStorage !== 'undefined' ? localStorage : null
    } catch {
        return null
    }
}

function generalName(state: GameState, index: number): string {
    const g = state.generals[index]
    if (!g) return `座位${index}`
    return getGeneralById(g.generalId)?.name ?? g.generalId
}

function cardLabel(card: { suit: string; value: number; name: string }): string {
    return cardFullName(card as never)
}

export function captureSnapshot(state: GameState): DecisionSnapshot {
    return {
        round: state.roundState?.roundNumber ?? 0,
        turnSerial: state.turnSerial ?? 0,
        phase: state.phase,
        turnPhase: state.turnPhase,
        activeSeat: state.activeGeneralIndex,
        attackUsed: state.attackUsedThisTurn ?? 0,
        deckCount: state.deck.length,
        discardTop: state.discard.length > 0 ? cardLabel(state.discard[state.discard.length - 1]) : null,
        seats: state.generals.map((g, seat) => ({
            seat,
            id: g.generalId,
            name: getGeneralById(g.generalId)?.name ?? g.generalId,
            faction: g.faction,
            role: g.seatRole ?? '',
            hp: g.hp,
            maxHp: g.maxHp,
            handCount: g.hand.length,
            hand: g.hand.map(cardLabel),
            equip: [g.equip.weapon, g.equip.armor, g.equip.plus_horse, g.equip.minus_horse]
                .filter((c): c is NonNullable<typeof c> => !!c)
                .map(cardLabel),
            judge: g.judgeZone.map(cardLabel),
            chained: !!g.chained,
            alive: g.alive,
        })),
    }
}

const KEY_TRICKS = ['桃园结义', '五谷丰登', '万箭齐发', '南蛮入侵', '决斗', '借刀杀人', '铁索连环', '无懈可击', '火攻']

/**
 * 关键事件标记：把复盘搜索范围压到“可能出问题的一手”。
 * 既看这一手产生的引擎日志，也看快照之间的血量/手牌落差。
 */
export function detectKeyEvents(logs: string[], before: DecisionSnapshot, after: DecisionSnapshot): string[] {
    const events = new Set<string>()
    const text = logs.join('\n')
    if (/阵亡|死亡/.test(text)) events.add('death')
    if (/濒死|求桃/.test(text)) events.add('dying')
    if (/主帅/.test(text) && /受到|濒死|阵亡/.test(text)) events.add('commander_hit')
    if (/无懈可击/.test(text)) events.add('negate')
    for (const trick of KEY_TRICKS) {
        if (text.includes(trick)) {
            events.add(`trick:${trick}`)
            break
        }
    }
    if (/觉醒/.test(text)) events.add('awaken')
    if (/限定技/.test(text)) events.add('limited_skill')
    if (/判定/.test(text)) events.add('judge')
    if (/闪电/.test(text)) events.add('lightning')
    if (/摸[了得]?\s*\d+\s*张/.test(text) && /摸\s*[3-9]\s*张/.test(text)) events.add('big_draw')

    let handSwing = 0
    let hpSwing = 0
    for (const seat of after.seats) {
        const prev = before.seats.find(s => s.seat === seat.seat)
        if (!prev) continue
        handSwing += Math.abs(seat.handCount - prev.handCount)
        hpSwing += Math.abs(seat.hp - prev.hp)
    }
    if (handSwing >= 6) events.add('card_swing')
    if (hpSwing >= 2) events.add('hp_swing')
    return [...events]
}

export function beginMatchLog(
    state: GameState,
    seed: number | null,
    mode: string,
    meta: { humanFaction?: string | null; hotseat?: boolean } = {},
): void {
    // 上一局若未正常结束（重开/退出），先落盘避免丢失
    if (current) finishMatchLog()
    const startedAt = Date.now()
    const id = makeMatchId(seed, startedAt)
    state.matchId = id
    // 开局日志（随机种子、选将提示）在 beginMatchLog 之前就写进了 state.log，
    // 不补 matchId 的话点它们只会提示“没有复盘 ID”
    let seq = state.logSeq ?? 0
    for (const entry of state.log) {
        if (entry.matchId) continue
        entry.matchId = id
        if (entry.seq === undefined) {
            seq += 1
            entry.seq = seq
        }
    }
    state.logSeq = seq
    current = {
        version: 2,
        id,
        mode,
        seed,
        startedAt,
        humanFaction: meta.humanFaction ?? undefined,
        hotseat: meta.hotseat,
        generals: state.generals.map((g, i) => ({
            seat: i,
            id: g.generalId,
            name: getGeneralById(g.generalId)?.name ?? g.generalId,
            faction: g.faction,
            role: g.seatRole ?? '',
        })),
        actions: [],
        decisions: [],
    }
}

export function isMatchLogging(): boolean {
    return current !== null
}

/** 未结束对局的全量记录：断点续局时随局面一起落盘 */
export function exportCurrentMatchLog(): MatchLogRecord | null {
    return current
}

/** 断点续局恢复：把上次未结束的记录接回来，操作/决策序号接着往下编 */
export function resumeMatchLog(record: MatchLogRecord | null): void {
    current = record
}

export function recordMatchAction(
    state: GameState,
    kind: string,
    payload: unknown,
    logFrom: number,
    opts: { side?: 'human' | 'ai' | 'hotseat'; seat?: number; error?: string } = {},
): void {
    if (!current) return
    const seat = opts.seat ?? state.activeGeneralIndex
    const seq = current.actions.length + 1
    // 引擎日志在动作执行时写入，这里补上操作归属，界面点击即可拿到 ID
    for (const entry of state.log.slice(logFrom)) entry.actionSeq = seq
    current.actions.push({
        id: `${current.id}.a${seq}`,
        seq,
        at: Date.now(),
        round: state.roundState?.roundNumber ?? 0,
        turnSerial: state.turnSerial ?? 0,
        phase: `${state.phase}/${state.turnPhase}`,
        side: opts.side ?? 'human',
        seat,
        actor: generalName(state, seat),
        kind,
        payload,
        error: opts.error,
        logs: state.log.slice(logFrom).map((l) => l.text),
    })
}

export interface DecisionInput {
    /** 本决策从哪条日志开始写（含），用于给日志打 decisionSeq */
    logFrom?: number
    kind: DecisionRecord['kind']
    source: DecisionRecord['source']
    side: DecisionRecord['side']
    seat: number
    snapshot: DecisionSnapshot
    candidates: DecisionCandidate[]
    chosen: DecisionCandidate | null
    plan?: string
    logs: string[]
}

/** 选将结束后才确定双方武将：首次拿到有效 generals 时补进本局记录 */
function syncGenerals(state: GameState): void {
    if (!current || current.generals.length > 0 || state.generals.length === 0) return
    current.generals = state.generals.map((g, seat) => ({
        seat,
        id: g.generalId,
        name: getGeneralById(g.generalId)?.name ?? g.generalId,
        faction: g.faction,
        role: g.seatRole ?? '',
    }))
}

/** 记录一个决策点：候选、得分、实际选择、当时局面与由此产生的日志 */
export function recordDecision(state: GameState, input: DecisionInput): void {
    if (!current) return
    syncGenerals(state)
    const after = captureSnapshot(state)
    const seq = current.decisions.length + 1
    if (input.logFrom !== undefined) {
        for (const entry of state.log.slice(input.logFrom)) {
            // 同一步骤可能有多个决策，保留最先占用这些日志的那个
            if (entry.decisionSeq === undefined) entry.decisionSeq = seq
        }
    }
    current.decisions.push({
        id: `${current.id}.d${seq}`,
        seq,
        at: Date.now(),
        kind: input.kind,
        source: input.source,
        side: input.side,
        actor: generalName(state, input.seat),
        seat: input.seat,
        plan: input.plan,
        snapshot: input.snapshot,
        candidates: input.candidates,
        chosen: input.chosen,
        events: detectKeyEvents(input.logs, input.snapshot, after),
        logs: input.logs,
    })
}

function saveRecords(store: Storage, records: MatchLogRecord[]): void {
    let slice = records.slice(-MAX_RECORDS)
    while (slice.length > 0) {
        try {
            store.setItem(STORAGE_KEY, JSON.stringify(slice))
            return
        } catch {
            // localStorage 通常只有 5MB：先丢最旧的整局，仍放不下再丢弃逐手引擎日志
            if (slice.length > 1) {
                slice = slice.slice(1)
                continue
            }
            const slim = slice.map((r) => ({
                ...r,
                actions: r.actions.map((a) => ({ ...a, logs: [] })),
                decisions: (r.decisions ?? []).map((d) => ({ ...d, logs: [] })),
            }))
            try {
                store.setItem(STORAGE_KEY, JSON.stringify(slim))
            } catch {
                // 实在存不下就放弃，不影响对局
            }
            return
        }
    }
}

export function finishMatchLog(winner?: string | null): void {
    if (!current) return
    current.endedAt = Date.now()
    if (winner) current.winner = winner
    const store = safeStorage()
    if (!store) {
        current = null
        return
    }
    const records = listMatchLogs()
    records.push(current)
    current = null
    saveRecords(store, records)
}

export function listMatchLogs(): MatchLogRecord[] {
    const store = safeStorage()
    if (!store) return []
    try {
        const raw = readStorageItem(store, STORAGE_KEY)
        const parsed = raw ? JSON.parse(raw) : []
        if (!Array.isArray(parsed)) return []
        // 旧版本记录没有 id：按同样的规则补出来，保证导出的历史局也能检索
        return parsed.map((r: MatchLogRecord) => ({ ...r, id: r.id ?? makeMatchId(r.seed ?? null, r.startedAt) }))
    } catch {
        return []
    }
}

export function clearMatchLogs(): void {
    const store = safeStorage()
    if (store) removeStorageItem(store, STORAGE_KEY)
}

export function exportMatchLogs(): string {
    const records = listMatchLogs()
    if (current) records.push(current)
    return JSON.stringify(records, null, 2)
}

/** 浏览器端：把全部对局日志下载为 JSON 文件 */
export function downloadMatchLogs(): void {
    if (typeof document === 'undefined') return
    const blob = new Blob([exportMatchLogs()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `sgsoffline-matchlogs-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
}
