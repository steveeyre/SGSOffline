import { Faction, GamePhase, GameState } from 'sgs3v3-shared'
import {
    checkAndOpenNegateWindow, negateWindowTimeout, processAutoExecutePending,
} from '../../engine/game-actions'
import { checkGameOver } from '../../engine/game-state'
import { aiAct, aiOwnsPending, aiRespond, takePlayTrace, type PlayTrace } from '../../engine/local-ai'
import { AI_PLAYER_ID, HUMAN_PLAYER_ID } from '../../engine/local-match'
import { resumeStalledTurn } from '../../engine/turn-manager'
import { aiLandlordDraft } from './landlord-draft'
import { createLandlordMatch, landlordPickGeneral, type LandlordSide } from './landlord-match'

export interface DdzSelfPlayResult {
    ok: boolean
    winner?: Faction
    steps: number
    state: GameState
    seed: number
    side: LandlordSide
}

/** 一步出牌决策的轻量快照，供回归/失误统计使用 */
export interface DdzSelfPlayTrace {
    seed: number
    step: number
    round: number
    faction?: Faction
    activeIndex: number
    play: PlayTrace
}

/** 让人类席位也按 AI 的思路选将，使自对弈能完整跑完 */
function finishDraft(state: GameState): void {
    for (let i = 0; i < 3; i++) {
        const pick = state.landlordPick
        if (!pick) return
        const seat = pick.picked.findIndex((id) => id === null)
        if (seat < 0) break
        aiLandlordDraft(state)
        if (state.landlordPick!.picked[seat] === null) {
            const def = state.landlordPick!.pools[seat][0]
            landlordPickGeneral(state, seat, def.id)
        }
    }
}

/** 用固定种子跑一局斗地主全 AI 对局；side 只决定人类席位，双方都由 AI 决策 */
export function runDdzSelfPlay(
    side: LandlordSide,
    seed: number,
    maxSteps = 60000,
    onDecision?: (trace: DdzSelfPlayTrace) => void,
): DdzSelfPlayResult {
    const state = createLandlordMatch(side, seed)
    finishDraft(state)
    let steps = 0
    for (; steps < maxSteps; steps++) {
        if (state.phase === GamePhase.PLAYING) {
            const over = checkGameOver(state)
            if (over.over) return { ok: true, winner: over.winnerFaction, steps, state, seed, side }
        }
        if (state.phase === GamePhase.GAME_OVER) return { ok: true, steps, state, seed, side }
        processAutoExecutePending(state)
        if (resumeStalledTurn(state)) continue
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
        if (!progressed) return { ok: false, steps, state, seed, side }
        const play = takePlayTrace()
        if (play && onDecision) {
            onDecision({
                seed,
                step: steps,
                round: state.roundState?.roundNumber ?? 0,
                faction: state.activePlayerFaction,
                activeIndex: state.activeGeneralIndex,
                play,
            })
        }
    }
    return { ok: false, steps, state, seed, side }
}

const isCli = process.argv[1]?.includes('selfplay-ddz')
if (isCli) {
    const games = Number(process.argv[2] ?? 20)
    for (const side of ['landlord', 'farmers'] as const) {
        let wins = 0
        let failures = 0
        let maxSteps = 0
        for (let i = 0; i < games; i++) {
            const seed = 8000 + i
            const result = runDdzSelfPlay(side, seed)
            maxSteps = Math.max(maxSteps, result.steps)
            if (!result.ok) {
                failures++
                console.log(`${side} seed=${seed} STUCK steps=${result.steps}`)
                continue
            }
            const won = side === 'landlord' ? result.winner === Faction.WARM : result.winner === Faction.COOL
            if (won) wins++
            console.log(`${side} seed=${seed} ok winner=${result.winner} steps=${result.steps} rounds=${result.state.roundState.roundNumber}`)
        }
        const rate = games > 0 ? ((wins / games) * 100).toFixed(1) : '0.0'
        console.log(`summary ${side}: ${wins}/${games} 胜 (${rate}%) failures=${failures} maxSteps=${maxSteps}`)
    }
}
