/**
 * 固定种子回归：保存一组典型局面，每次改动后跑同一批种子，
 * 对比胜负、选将、首个出牌与失误分类是否向预期方向变化。
 *
 * 用法：
 *   node scripts/run-engine-checks.mjs src/engine/_regression.ts            # 打印当前结果
 *   node scripts/run-engine-checks.mjs src/engine/_regression.ts --write    # 写入基线
 *   node scripts/run-engine-checks.mjs src/engine/_regression.ts --check    # 对比基线
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Faction, GameState } from 'sgs3v3-shared'
import { runSelfPlayGame } from './selfplay'
import { runPairSelfPlay } from '../modes/HappyPair/selfplay-pair'
import { runDdzSelfPlay } from '../modes/FightTheLandlord/selfplay-ddz'
import { classifyMistake, summarizeMistakes, type DecisionTrace, type Mistake } from './_mistakes'

type Mode = '3v3' | 'pair' | 'ddz-landlord' | 'ddz-farmers'

interface RegressionCase {
    id: string
    mode: Mode
    seed: number
    human?: Faction
}

interface CaseResult {
    id: string
    mode: Mode
    seed: number
    winner: string | null
    steps: number
    draft: Array<string | null> | null
    firstPlay: { key: string | null; objective: string | null; reason: string | null } | null
    mistakes: Record<string, number>
}

const CASES: RegressionCase[] = [
    { id: '3v3-warm', mode: '3v3', seed: 1000, human: Faction.WARM },
    { id: '3v3-cool', mode: '3v3', seed: 1001, human: Faction.COOL },
    { id: 'pair-warm', mode: 'pair', seed: 7000, human: Faction.WARM },
    { id: 'pair-cool', mode: 'pair', seed: 7001, human: Faction.COOL },
    { id: 'ddz-landlord', mode: 'ddz-landlord', seed: 8000 },
    { id: 'ddz-farmers', mode: 'ddz-farmers', seed: 8000 },
]

const BASELINE = join(process.cwd(), 'scripts', 'baselines', 'selfplay.json')

function draftOf(state: GameState, mode: Mode): Array<string | null> | null {
    if (mode === '3v3') {
        return [
            ...(state.pickState?.warmPicked ?? []).map((g) => g.id),
            ...(state.pickState?.coolPicked ?? []).map((g) => g.id),
        ]
    }
    if (mode === 'pair') return state.pairPick?.picked ?? null
    return state.landlordPick?.picked ?? null
}

function firstPlayOf(traces: DecisionTrace[]): CaseResult['firstPlay'] {
    const first = traces[0]
    if (!first) return null
    return {
        key: first.play.candidates.find((candidate) => candidate.chosen)?.key ?? null,
        objective: first.play.objective?.kind ?? null,
        reason: first.play.objective?.reason ?? null,
    }
}

function runCase(testCase: RegressionCase): CaseResult {
    const traces: DecisionTrace[] = []
    const collect = (trace: DecisionTrace) => traces.push(trace)
    let winner: Faction | undefined
    let steps = 0
    let state: GameState

    if (testCase.mode === '3v3') {
        const result = runSelfPlayGame(testCase.seed, testCase.human ?? Faction.WARM, 60000, undefined, collect)
        winner = result.winner
        steps = result.steps
        state = result.state
    } else if (testCase.mode === 'pair') {
        const result = runPairSelfPlay(testCase.seed, testCase.human ?? Faction.WARM, 60000, collect)
        winner = result.winner
        steps = result.steps
        state = result.state
    } else {
        const side = testCase.mode === 'ddz-landlord' ? 'landlord' : 'farmers'
        const result = runDdzSelfPlay(side, testCase.seed, 60000, collect)
        winner = result.winner
        steps = result.steps
        state = result.state
    }

    const seenTurns = new Set<string>()
    const mistakes = traces
        .map((trace) => {
            const turnKey = `${trace.round}:${trace.activeIndex}:${trace.faction}`
            const firstOfTurn = !seenTurns.has(turnKey)
            seenTurns.add(turnKey)
            return classifyMistake(trace, { firstOfTurn })
        })
        .filter((mistake): mistake is Mistake => !!mistake)

    return {
        id: testCase.id,
        mode: testCase.mode,
        seed: testCase.seed,
        winner: winner ?? null,
        steps,
        draft: draftOf(state, testCase.mode),
        firstPlay: firstPlayOf(traces),
        mistakes: summarizeMistakes(mistakes),
    }
}

function compare(baseline: CaseResult[], current: CaseResult[]): string[] {
    const diffs: string[] = []
    for (const now of current) {
        const before = baseline.find((item) => item.id === now.id)
        if (!before) {
            diffs.push(`${now.id}: 基线中没有这个局面`)
            continue
        }
        if (before.winner !== now.winner) {
            diffs.push(`${now.id}: 胜方 ${before.winner} → ${now.winner}`)
        }
        if (JSON.stringify(before.draft) !== JSON.stringify(now.draft)) {
            diffs.push(`${now.id}: 选将 ${JSON.stringify(before.draft)} → ${JSON.stringify(now.draft)}`)
        }
        if (JSON.stringify(before.firstPlay) !== JSON.stringify(now.firstPlay)) {
            diffs.push(`${now.id}: 首个出牌 ${JSON.stringify(before.firstPlay)} → ${JSON.stringify(now.firstPlay)}`)
        }
        if (JSON.stringify(before.mistakes) !== JSON.stringify(now.mistakes)) {
            diffs.push(`${now.id}: 失误 ${JSON.stringify(before.mistakes)} → ${JSON.stringify(now.mistakes)}`)
        }
    }
    return diffs
}

const args = process.argv.slice(2)
const results = CASES.map(runCase)

if (args.includes('--write')) {
    mkdirSync(dirname(BASELINE), { recursive: true })
    writeFileSync(BASELINE, `${JSON.stringify(results, null, 2)}\n`, 'utf8')
    console.log(`已写入基线：${BASELINE}`)
} else if (args.includes('--check')) {
    const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as CaseResult[]
    const diffs = compare(baseline, results)
    if (diffs.length === 0) {
        console.log('固定种子回归：与基线一致')
    } else {
        console.log('固定种子回归：发现差异')
        for (const diff of diffs) console.log(`  ${diff}`)
        process.exitCode = 1
    }
} else {
    console.log(JSON.stringify(results, null, 2))
}
