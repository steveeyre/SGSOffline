import { Faction, GamePhase, TurnPhase } from 'sgs3v3-shared'
import type { GameState } from 'sgs3v3-shared'
import { checkGameOver } from './game-state'
import { createLocalMatch, HUMAN_PLAYER_ID, AI_PLAYER_ID } from './local-match'
import { aiAct, aiOwnsPending, aiRespond } from './local-ai'
import { checkAndOpenNegateWindow, exportJianmieColors, importJianmieColors, negateWindowTimeout, processAutoExecutePending } from './game-actions'
import { resumeStalledTurn } from './turn-manager'
import { getRandomCursor, random, setRandomCursor, setRandomSeed } from './rng'
import { getLocalState, hasResumeSave, rematchLocalMatch, resumeLocalMatch, RESUME_KEY } from './local-dispatch'
import { exportMemory, knownHand, rememberCards } from './ai-memory'
import { useGameStore } from '../store/gameStore'

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

const LEGACY_RESUME_KEY = 'sgs3v3.resumeMatch.v1'
const SEED = 20261111

let failures = 0
function check(label: string, ok: boolean, detail = '') {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `（${detail}）`}`)
    if (!ok) failures++
}

/** 全 AI 驱动一步；返回值表示局面是否推进 */
function step(state: GameState): boolean {
    processAutoExecutePending(state)
    checkAndOpenNegateWindow(state)
    if (state.negateWindow) {
        const a = aiAct(state, HUMAN_PLAYER_ID)
        const b = aiAct(state, AI_PLAYER_ID)
        if (!a && !b) negateWindowTimeout(state)
        return true
    }
    if (state.phase === GamePhase.PLAYING && state.pendingResponseQueue.length > 0) {
        if (aiOwnsPending(state, HUMAN_PLAYER_ID)) return aiRespond(state, HUMAN_PLAYER_ID)
        if (aiOwnsPending(state, AI_PLAYER_ID)) return aiRespond(state, AI_PLAYER_ID)
        return false
    }
    if (aiAct(state, HUMAN_PLAYER_ID) || aiAct(state, AI_PLAYER_ID)) return true
    return resumeStalledTurn(state)
}

function drive(state: GameState, maxSteps: number): boolean {
    for (let i = 0; i < maxSteps; i++) {
        if (state.phase === GamePhase.PLAYING) {
            const over = checkGameOver(state)
            if (over.over) {
                state.phase = GamePhase.GAME_OVER
                return true
            }
        }
        if (state.phase === GamePhase.GAME_OVER) return true
        if (!step(state)) return false
    }
    return state.phase === GamePhase.GAME_OVER
}

/** 推进到指定轮次就停：续局验证需要“进行中”的局面，不能拿已经打完的局来存档 */
function driveUntilRound(state: GameState, targetRound: number, maxSteps: number): void {
    for (let i = 0; i < maxSteps; i++) {
        if (state.phase === GamePhase.GAME_OVER) return
        if (state.phase === GamePhase.PLAYING && (state.roundState?.roundNumber ?? 0) >= targetRound) return
        if (!step(state)) return
    }
}

console.log('[断点续局]')

setRandomSeed(SEED)
const state = createLocalMatch(Faction.WARM, SEED)
driveUntilRound(state, 1, 80)
check('中途仍在进行中', state.phase === GamePhase.PLAYING, state.phase)

const cursorAtSave = getRandomCursor()

// 记忆层：亮过的牌必须能随存档接回，否则读档后 AI 会当作没见过
const hiddenCard = state.generals[0]?.hand[0]
if (hiddenCard) rememberCards(state, 0, [hiddenCard], 'check')
check('记忆可导出', !hiddenCard || exportMemory(state).length > 0)

const raw = JSON.stringify(state)
const restored = JSON.parse(raw) as GameState
check('局面 JSON 往返稳定', JSON.stringify(restored) === raw)
check('武将/手牌/牌堆完整', restored.generals.length === state.generals.length
    && restored.deck.length === state.deck.length
    && restored.log.length === state.log.length)

setRandomCursor(cursorAtSave)
const nextRandom = random()
setRandomCursor(cursorAtSave)
check('随机游标续接后序列一致', random() === nextRandom)

const finished = drive(restored, 60000)
check('恢复后的局面能继续打完', finished, `${restored.phase} round=${restored.roundState?.roundNumber}`)

const save = {
    version: 1,
    savedAt: Date.now(),
    seed: SEED,
    cursor: cursorAtSave,
    mode: 'classic',
    hotseat: false,
    landlordSide: null,
    pairSide: null,
    humanFaction: Faction.WARM,
    matchLog: null,
    aiMemory: exportMemory(state),
    jianmieColors: exportJianmieColors(state),
    state,
}
;(globalThis as any).localStorage.setItem(LEGACY_RESUME_KEY, JSON.stringify(save))
check('旧键存档可被识别', hasResumeSave())
check('旧键内容已迁到新键', (globalThis as any).localStorage.getItem(RESUME_KEY) !== null
    && (globalThis as any).localStorage.getItem(LEGACY_RESUME_KEY) === null)

const ok = resumeLocalMatch()
check('从存档恢复成功', ok)
const active = getLocalState()
check('恢复后引擎状态存在', !!active && active.matchId === state.matchId)
check('恢复后玩家阵营正确', useGameStore.getState().myFaction === Faction.WARM)
check('恢复后对局模式正确', useGameStore.getState().mode === 'classic')
check('恢复后记忆仍认得明牌', !hiddenCard
    || knownHand(getLocalState()!, 0).some((c) => c.id === hiddenCard.id))
check('恢复后翦灭暂存色可读', Array.isArray(exportJianmieColors(getLocalState()!)))

console.log('[再战 / 换边]')
const poolBefore = state.pickState?.pool.map((g) => g.id).join(',')
rematchLocalMatch({ seed: SEED })
const poolAfter = getLocalState()?.pickState?.pool.map((g) => g.id).join(',')
check('同种子复现：选将池一致', poolBefore === poolAfter)
check('同种子复现：仍是统率三军', useGameStore.getState().mode === 'classic')

rematchLocalMatch({ swapSide: true })
check('换边后玩家执冷', useGameStore.getState().myFaction === Faction.COOL)
check('换边后人类阵营同步到引擎', getLocalState()?.players[HUMAN_PLAYER_ID]?.faction === Faction.COOL)

const saveSize = JSON.stringify({ ...save, state: restored }).length
console.log(`  终局存档体积约 ${Math.round(saveSize / 1024)}KB`)
check('存档体积远低于 localStorage 上限', saveSize < 4 * 1024 * 1024, String(saveSize))

exitAfterCheck()

function exitAfterCheck(): void {
    if (failures > 0) {
        console.error(`断点续局检查失败 ${failures} 项`)
        process.exit(1)
    }
    console.log('断点续局检查全部通过')
    process.exit(0)
}
