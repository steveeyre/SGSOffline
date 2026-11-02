import { GameState } from 'sgs3v3-shared'
import { shuffleInPlace } from './rng'

/** 牌堆用尽时把弃牌堆洗回牌堆；返回牌堆是否有牌可摸/可判 */
export function ensureDeck(state: GameState): boolean {
    if (state.deck.length === 0 && state.discard.length > 0) {
        state.deck = shuffleInPlace([...state.discard])
        state.discard = []
    }
    return state.deck.length > 0
}

/** 本地摸牌：牌堆空时用 Fisher-Yates 重洗弃牌堆 */
export function drawCards(state: GameState, count: number) {
    const drawn = []
    for (let i = 0; i < count; i++) {
        if (!ensureDeck(state)) break
        drawn.push(state.deck.shift()!)
    }
    return drawn
}
