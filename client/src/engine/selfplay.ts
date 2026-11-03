import { Faction, GamePhase, GameState } from 'sgs3v3-shared'
import { checkGameOver } from './game-state'
import { createLocalMatch, HUMAN_PLAYER_ID, AI_PLAYER_ID } from './local-match'
import type { GeneralPoolVersion } from './generals'
import { aiAct, aiOwnsPending, aiRespond } from './local-ai'
import { checkAndOpenNegateWindow, negateWindowTimeout, processAutoExecutePending } from './game-actions'
import { resumeStalledTurn } from './turn-manager'

export type SelfPlayResult = {
    ok: boolean
    winner?: Faction
    steps: number
    state: GameState
    seed: number
}

function describePending(state: GameState): string {
    const p = state.pendingResponseQueue[0]
    if (!p) return 'none'
    return `${p.type}@${p.targetGeneralIndex} ${JSON.stringify(p.context ?? {})}`
}

function dump(state: GameState, steps: number, seed: number): void {
    console.log('--- STUCK ---')
    console.log('seed', seed, 'steps', steps, 'phase', state.phase, 'turnPhase', state.turnPhase)
    console.log('round', JSON.stringify(state.roundState), 'active', state.activeGeneralIndex, 'faction', state.activePlayerFaction)
    console.log('pending', describePending(state))
    console.log('negate', state.negateWindow ? JSON.stringify(state.negateWindow) : 'none')
    console.log(
        'generals',
        state.generals
            .map(
                (g, i) =>
                    `${i}:${g.generalId}/${g.faction}/${g.seatRole}/hp${g.hp}/${g.hand.length}手/skills:${g.skillsUsedThisTurn.join(',')}`
            )
            .join(' | ')
    )
    console.log('hand', state.generals.map((g, i) => `${i}:${g.hand.map((c) => c.name).join(',')}`).join(' | '))
    console.log('equip', state.generals.map((g, i) => `${i}:${JSON.stringify(g.equip)}`).join(' | '))
    console.log('deck', state.deck.length, 'discard', state.discard.length)
    console.log('log tail:')
    for (const line of state.log.slice(-25)) console.log('  ', line)
}

/** 用固定种子跑一局全 AI 对局；同种子必须得到完全相同的过程与结果 */
export function runSelfPlayGame(
    seed: number,
    humanFaction: Faction,
    maxSteps = 60000,
    poolVersion?: GeneralPoolVersion,
): SelfPlayResult {
    const state = createLocalMatch(humanFaction, seed, false, poolVersion)
    let steps = 0
    for (; steps < maxSteps; steps++) {
        if (state.phase === GamePhase.PLAYING) {
            const over = checkGameOver(state)
            if (over.over) return { ok: true, winner: over.winnerFaction, steps, state, seed }
        }
        if (state.phase === GamePhase.GAME_OVER) return { ok: true, steps, state, seed }
        processAutoExecutePending(state)
        checkAndOpenNegateWindow(state)
        if (state.negateWindow) {
            const a = aiAct(state, HUMAN_PLAYER_ID)
            const b = aiAct(state, AI_PLAYER_ID)
            if (!a && !b) negateWindowTimeout(state)
            continue
        }
        let progressed = false
        if (state.phase === GamePhase.PLAYING && state.pendingResponseQueue.length > 0) {
            if (aiOwnsPending(state, HUMAN_PLAYER_ID)) progressed = aiRespond(state, HUMAN_PLAYER_ID)
            else if (aiOwnsPending(state, AI_PLAYER_ID)) progressed = aiRespond(state, AI_PLAYER_ID)
        } else {
            progressed = aiAct(state, HUMAN_PLAYER_ID) || aiAct(state, AI_PLAYER_ID)
        }
        if (!progressed) {
            // 回合已进入 TURN_END 且无待响应时，收尾技能（如神速的杀）结算完不会自己推进，
            // 浏览器端由 local-dispatch 兜底，自对弈需要同样处理，否则会误判为卡死。
            if (resumeStalledTurn(state)) continue
            dump(state, steps, seed)
            return { ok: false, steps, state, seed }
        }
    }
    dump(state, steps, seed)
    return { ok: false, steps, state, seed }
}
