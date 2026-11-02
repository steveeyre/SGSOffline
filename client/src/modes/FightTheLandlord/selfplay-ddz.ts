import { Faction, GamePhase, GameState } from 'sgs3v3-shared'
import { checkAndOpenNegateWindow, negateWindowTimeout, processAutoExecutePending } from '../../engine/game-actions'
import { checkGameOver } from '../../engine/game-state'
import { aiAct, aiOwnsPending, aiRespond } from '../../engine/local-ai'
import { AI_PLAYER_ID, HUMAN_PLAYER_ID } from '../../engine/local-match'
import { resumeStalledTurn } from '../../engine/turn-manager'
import { pickBestForPool } from './landlord-draft'
import { createLandlordMatch, landlordPickGeneral, setupLandlordPlay, type LandlordSide } from './landlord-match'

export type LandlordSelfPlayResult = {
    ok: boolean
    winner?: Faction
    steps: number
    state: GameState
    seed: number
}

/** 让人类席位也按 AI 的思路选将，使自对弈能完整跑完 */
function finishDraft(state: GameState): void {
    for (let guard = 0; guard < 6 && state.phase === GamePhase.GENERAL_PICK; guard++) {
        const pick = state.landlordPick
        if (!pick) return
        const seat = pick.picked.findIndex((id) => id === null)
        if (seat < 0) {
            setupLandlordPlay(state)
            return
        }
        const allyPicked = pick.picked
            .map((id, i) => (id ? pick.pools[i].find((g) => g.id === id) : undefined))
            .filter((g): g is NonNullable<typeof g> => !!g)
        const def = pickBestForPool(pick.pools[seat], allyPicked)
        landlordPickGeneral(state, seat, def.id)
    }
}

function describePending(state: GameState): string {
    const p = state.pendingResponseQueue[0]
    if (!p) return 'none'
    return `${p.type}@${p.targetGeneralIndex} ${JSON.stringify(p.context ?? {})}`
}

function dump(state: GameState, steps: number, seed: number): void {
    console.log('--- STUCK (ddz) ---')
    console.log('seed', seed, 'steps', steps, 'phase', state.phase, 'turnPhase', state.turnPhase)
    console.log('round', JSON.stringify(state.roundState), 'active', state.activeGeneralIndex, 'faction', state.activePlayerFaction)
    console.log('pending', describePending(state))
    console.log('generals', state.generals
        .map((g, i) => `${i}:${g.generalId}/${g.faction}/${g.seatRole}/hp${g.hp}/${g.hand.length}手`)
        .join(' | '))
    console.log('log tail:')
    for (const line of state.log.slice(-40).map((l) => l.text)) console.log('  ', line)
}

/** 用固定种子跑一局斗地主全 AI 对局 */
export function runLandlordSelfPlay(seed: number, side: LandlordSide, maxSteps = 60000): LandlordSelfPlayResult {
    const state = createLandlordMatch(side, seed)
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
let landlordWins = 0
let farmerWins = 0
let failures = 0
let maxSteps = 0
for (let i = 0; i < games; i++) {
    const side: LandlordSide = i % 2 === 0 ? 'landlord' : 'farmers'
    const seed = 5000 + i
    const result = runLandlordSelfPlay(seed, side)
    maxSteps = Math.max(maxSteps, result.steps)
    if (!result.ok) {
        failures++
        console.log(`game ${i} seed=${seed} STUCK as ${side} after ${result.steps} steps`)
    } else {
        if (result.winner === Faction.WARM) landlordWins++
        else if (result.winner === Faction.COOL) farmerWins++
        console.log(`game ${i} seed=${seed} ok winner=${result.winner} steps=${result.steps} rounds=${result.state.roundState.roundNumber} logLines=${result.state.log.length}`)
    }
}
console.log(`\nsummary: games=${games} landlordWins=${landlordWins} farmerWins=${farmerWins} failures=${failures} maxSteps=${maxSteps}`)
