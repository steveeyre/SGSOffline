import { Faction } from 'sgs3v3-shared'
import { runSelfPlayGame } from './selfplay'

const games = Number(process.argv[2] ?? 5)
let warmWins = 0
let coolWins = 0
let failures = 0
let maxSteps = 0
for (let i = 0; i < games; i++) {
    const humanFaction = i % 2 === 0 ? Faction.WARM : Faction.COOL
    const seed = 1000 + i
    const result = runSelfPlayGame(seed, humanFaction)
    maxSteps = Math.max(maxSteps, result.steps)
    if (!result.ok) {
        failures++
        console.log(`game ${i} seed=${seed} STUCK with human=${humanFaction} after ${result.steps} steps`)
    } else {
        if (result.winner === Faction.WARM) warmWins++
        else if (result.winner === Faction.COOL) coolWins++
        console.log(`game ${i} seed=${seed} ok winner=${result.winner} steps=${result.steps} rounds=${result.state.roundState.roundNumber} logLines=${result.state.log.length}`)
    }
}
console.log(`\nsummary: games=${games} warmWins=${warmWins} coolWins=${coolWins} failures=${failures} maxSteps=${maxSteps}`)
