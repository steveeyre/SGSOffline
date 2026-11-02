import { Faction, GameState } from 'sgs3v3-shared'
import { addLog, resetActedFlags } from '../../engine/game-state'

/** 欢乐成双：按存活座次找到下一个行动者；wrapped 表示一整轮结束 */
export function nextPairSeat(state: GameState): { index: number; wrapped: boolean } | null {
    const alive = state.generals
        .map((g, index) => ({ g, index }))
        .filter(({ g }) => g.alive)
    if (alive.length === 0) return null
    const cur = state.activeGeneralIndex
    const after = alive.find(({ index }) => index > cur)
    if (after) return { index: after.index, wrapped: false }
    return { index: alive[0].index, wrapped: true }
}

/** 欢乐成双：四名角色各走完一个回合后进入新的大回合 */
export function bumpPairRound(state: GameState): void {
    const rs = state.roundState
    rs.roundNumber++
    rs.currentActionStep = 0
    resetActedFlags(state, Faction.WARM)
    resetActedFlags(state, Faction.COOL)
    for (const g of state.generals) {
        if (g.loyaltyCard) {
            state.discard.push(g.loyaltyCard)
            g.loyaltyCard = undefined
        }
    }
    addLog(state, `═══ 第 ${rs.roundNumber} 大回合开始 ═══`)
}
