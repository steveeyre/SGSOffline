import { Faction } from 'sgs3v3-shared'
import { takeRejectedActions } from './game-actions'
import { runSelfPlayGame } from './selfplay'

const games = Number(process.argv[2] ?? 5)
/** 每局允许的被拒绝动作数：20 局基线只出现 0~3 次，超过说明 AI 又在尝试规则不允许的操作 */
const REJECT_BUDGET_PER_GAME = 1

let warmWins = 0
let coolWins = 0
let failures = 0
let maxSteps = 0
let rejected = 0
const rejectedSamples = new Set<string>()

for (let i = 0; i < games; i++) {
    const humanFaction = i % 2 === 0 ? Faction.WARM : Faction.COOL
    const seed = 1000 + i
    takeRejectedActions()
    const result = runSelfPlayGame(seed, humanFaction)
    const rejects = takeRejectedActions()
    rejected += rejects.length
    for (const r of rejects) rejectedSamples.add(`${r.action}：${r.reason}`)
    maxSteps = Math.max(maxSteps, result.steps)
    if (!result.ok) {
        failures++
        console.log(`game ${i} seed=${seed} STUCK with human=${humanFaction} after ${result.steps} steps`)
    } else {
        if (result.winner === Faction.WARM) warmWins++
        else if (result.winner === Faction.COOL) coolWins++
        console.log(`game ${i} seed=${seed} ok winner=${result.winner} steps=${result.steps} rounds=${result.state.roundState.roundNumber} logLines=${result.state.log.length} rejected=${rejects.length}`)
    }
}

console.log(`\nsummary: games=${games} warmWins=${warmWins} coolWins=${coolWins} failures=${failures} maxSteps=${maxSteps} rejected=${rejected}`)

if (rejectedSamples.size > 0) {
    console.log('拒绝样本（AI 以为能打、引擎不认）：')
    for (const sample of [...rejectedSamples].slice(0, 12)) console.log('  ', sample)
}

const budget = games * REJECT_BUDGET_PER_GAME
if (rejected > budget) {
    console.error(`拒绝率回归：${rejected} 次 > 预算 ${budget} 次（${REJECT_BUDGET_PER_GAME}/局）`)
    process.exit(1)
}
