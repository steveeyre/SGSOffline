import { Faction, GamePhase, TurnPhase } from 'sgs3v3-shared'
import type { GameState } from 'sgs3v3-shared'
import { addLog } from './game-state'
import {
    beginMatchLog, captureSnapshot, finishMatchLog, listMatchLogs, logReviewId,
    recordDecision, recordMatchAction,
} from './match-log'

class MemoryStorage {
    private map = new Map<string, string>()
    get length() { return this.map.size }
    clear() { this.map.clear() }
    getItem(key: string) { return this.map.get(key) ?? null }
    key(index: number) { return [...this.map.keys()][index] ?? null }
    removeItem(key: string) { this.map.delete(key) }
    setItem(key: string, value: string) { this.map.set(key, value) }
}

;(globalThis as any).localStorage = new MemoryStorage()

const state = {
    roomId: 'local',
    phase: GamePhase.PLAYING,
    players: {
        human: { id: 'human', nickname: '我', faction: Faction.WARM, connected: true },
        ai: { id: 'ai', nickname: 'AI', faction: Faction.COOL, connected: true },
    },
    generals: [],
    deck: [],
    discard: [],
    turnPhase: TurnPhase.TURN_START,
    activePlayerFaction: Faction.WARM,
    activeGeneralIndex: 0,
    roundState: { roundNumber: 1, firstMover: Faction.WARM, currentActionStep: 0 },
    attackUsedThisTurn: 0,
    pendingResponseQueue: [],
    log: [],
} as unknown as GameState

let failures = 0
function check(label: string, ok: boolean, detail = '') {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `（${detail}）`}`)
    if (!ok) failures++
}

console.log('[复盘 ID]')

beginMatchLog(state, 1234, 'classic')
const matchId = state.matchId ?? ''
check('开局写入对局 ID', /^m[0-9a-z]+-[0-9a-z]+$/.test(matchId), matchId)

addLog(state, '第一条日志')
recordMatchAction(state, 'use_card', { card: 'sha' }, 0)
check('日志序号连续', state.log[0].seq === 1)
check('日志带对局 ID', state.log[0].matchId === matchId)
check('操作覆盖日志打 actionSeq', state.log[0].actionSeq === 1)

addLog(state, 'AI 出牌')
const snapshot = captureSnapshot(state)
recordDecision(state, {
    logFrom: 1,
    kind: 'play',
    source: 'rule',
    side: 'ai',
    seat: 0,
    snapshot,
    candidates: [{ id: 'slash', ruleId: 'slash', label: '杀', score: 10, chosen: true }],
    chosen: { id: 'slash', ruleId: 'slash', label: '杀', score: 10, chosen: true },
    logs: ['AI 出牌'],
})
check('决策覆盖日志打 decisionSeq', state.log[1].decisionSeq === 1)
check('点击决策日志得到 d ID', logReviewId(state.log[1]) === `${matchId}.d1`, String(logReviewId(state.log[1])))

addLog(state, '第三条日志')
check('未归属日志退化为 l ID', logReviewId(state.log[2]) === `${matchId}.l3`, String(logReviewId(state.log[2])))
check('无 matchId 的日志不产生 ID', logReviewId({ timestamp: 0, text: '在线' }) === null)

finishMatchLog('warm')
const saved = listMatchLogs()[0]
check('记录带对局 ID', saved?.id === matchId, String(saved?.id))
check('操作记录带 a ID', saved?.actions[0]?.id === `${matchId}.a1`, String(saved?.actions[0]?.id))
check('决策记录带 d ID', saved?.decisions[0]?.id === `${matchId}.d1`, String(saved?.decisions[0]?.id))

if (failures > 0) {
    console.error(`复盘 ID 检查失败 ${failures} 项`)
    process.exit(1)
}
console.log('复盘 ID 检查全部通过')
