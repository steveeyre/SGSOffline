import { Faction, GamePhase, GameState } from 'sgs3v3-shared'
import { checkAndOpenNegateWindow, negateWindowTimeout, processAutoExecutePending } from '../../engine/game-actions'
import { checkGameOver } from '../../engine/game-state'
import { aiAct, aiOwnsPending, aiRespond } from '../../engine/local-ai'
import { AI_PLAYER_ID, HUMAN_PLAYER_ID } from '../../engine/local-match'
import { resumeStalledTurn } from '../../engine/turn-manager'
import { pickBestForPool } from './pair-draft'
import { createPairMatch, pairPickGeneral, setupPairPlay } from './pair-match'

export type PairSelfPlayResult = {
    ok: boolean
    winner?: Faction
    steps: number
    state: GameState
    seed: number
}

/** 让人类席位也按 AI 的思路选将，使自对弈能完整跑完 */
function finishDraft(state: GameState): void {
    for (let guard = 0; guard < 6 && state.phase === GamePhase.GENERAL_PICK; guard++) {
        const pick = state.pairPick
        if (!pick) return
        const seat = pick.picked.findIndex((id) => id === null)
        if (seat < 0) {
            setupPairPlay(state)
            return
        }
        const allyPicked = pick.picked
            .map((id, i) => (id ? pick.pools[i].find((g) => g.id === id) : undefined))
            .filter((g): g is NonNullable<typeof g> => !!g)
        const def = pickBestForPool(pick.pools[seat], allyPicked)
        pairPickGeneral(state, seat, def.id)
    }
}

function describePending(state: GameState): string {
    const p = state.pendingResponseQueue[0]
    if (!p) return 'none'
    return `${p.type}@${p.targetGeneralIndex} ${JSON.stringify(p.context ?? {})}`
}

function dump(state: GameState, steps: number, seed: number): void {
    console.log('--- STUCK (pair) ---')
    console.log('seed', seed, 'steps', steps, 'phase', state.phase, 'turnPhase', state.turnPhase)
    console.log('round', JSON.stringify(state.roundState), 'active', state.activeGeneralIndex, 'faction', state.activePlayerFaction)
    console.log('pending', describePending(state))
    console.log('generals', state.generals
        .map((g, i) => `${i}:${g.generalId}/${g.faction}/hp${g.hp}/${g.hand.length}手`)
        .join(' | '))
    console.log('log tail:')
    for (const line of state.log.slice(-40).map((l) => l.text)) console.log('  ', line)
}

/** 用固定种子跑一局欢乐成双全 AI 对局 */
export function runPairSelfPlay(seed: number, humanFaction: Faction, maxSteps = 60000): PairSelfPlayResult {
    const state = createPairMatch(humanFaction, seed)
    finishDraft(state)
    let steps = 0
    for (; steps < maxSteps; steps++) {
        if (state.phase === GamePhase.PLAYING) {
            const over = checkGameOver(state)
            if (over.over) return { ok: true, winner: over.winnerFaction, steps, state, seed }
        }
        if (state.phase === GamePhase.GAME_OVER) return { ok: true, steps, state, seed }
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
        if (!progressed) {
            dump(state, steps, seed)
            return { ok: false, steps, state, seed }
        }
    }
    dump(state, steps, seed)
    return { ok: false, steps, state, seed }
}

const games = Number(process.argv[2] ?? 5)
let warmWins = 0
let coolWins = 0
let failures = 0
let maxSteps = 0
for (let i = 0; i < games; i++) {
    const humanFaction = i % 2 === 0 ? Faction.COOL : Faction.WARM
    const seed = 7000 + i
    const result = runPairSelfPlay(seed, humanFaction)
    maxSteps = Math.max(maxSteps, result.steps)
    if (!result.ok) {
        failures++
        console.log(`game ${i} seed=${seed} STUCK as ${humanFaction} after ${result.steps} steps`)
    } else {
        if (result.winner === Faction.WARM) warmWins++
        else if (result.winner === Faction.COOL) coolWins++
        console.log(`game ${i} seed=${seed} ok winner=${result.winner} steps=${result.steps} rounds=${result.state.roundState.roundNumber} logLines=${result.state.log.length}`)
    }
}
console.log(`\nsummary: games=${games} warmWins=${warmWins} coolWins=${coolWins} failures=${failures} maxSteps=${maxSteps}`)
