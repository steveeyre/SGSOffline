/**
 * 无头审计入口：读取 spec.json，批量自对弈 / 成对 A/B / 反事实重放，结果写 JSONL。
 *
 * 用法：node scripts/run-engine-checks.mjs src/engine/_audit.ts <spec.json>
 * 该文件只在 Node 下运行，浏览器端不引用。
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Faction } from 'sgs3v3-shared'
import { runSelfPlayGame, type SelfPlayResult } from './selfplay'
import {
    featureTable, finishAuditGame, forcedAppliedCount, interventionHitCount, startAudit, startAuditGame, stopAudit,
    type AuditIntervention,
} from './ai-audit'
import { THRESHOLD_DEFAULTS, THRESHOLD_NAMES, loadPatchBank, resetVariantStats, variantStats, type PatchBank, type PatchSet } from './ai-variant'

type AuditMode = 'describe' | 'selfplay' | 'ab' | 'counterfactual' | 'fingerprint'
type FactionMode = 'warm' | 'cool' | 'alternate'

export interface AuditSpec {
    runId: string
    mode: AuditMode
    outDir: string
    seeds?: number[]
    games?: number
    startSeed?: number
    maxSteps?: number
    faction?: FactionMode
    patchBank?: PatchBank | null
    patchId?: string
    /** A/B 批量座位：一次进程内把处理组与对照组都跑完，避免每轮重启一批子进程 */
    abSeats?: Array<{ label: string; bank: PatchBank | null; variantFaction?: Faction | null }>
    intervention?: AuditIntervention | null
    /** 批量反事实：一次进程内对每个种子依次跑多个干预，避免每簇重启一批子进程 */
    interventions?: Array<{ id: string; intervention: AuditIntervention }>
    record?: boolean
    playStride?: number
    maxDecisionsPerGame?: number
}

function readSpec(path: string): AuditSpec {
    const spec = JSON.parse(readFileSync(path, 'utf8')) as AuditSpec
    if (!spec.mode) throw new Error('spec.mode 缺失')
    if (spec.mode !== 'describe' && !spec.outDir) throw new Error('spec.outDir 缺失')
    return spec
}

function seedsOf(spec: AuditSpec): number[] {
    if (spec.seeds?.length) return spec.seeds
    const count = spec.games ?? 20
    const start = spec.startSeed ?? 1000
    return Array.from({ length: count }, (_, i) => start + i)
}

function factionFor(spec: AuditSpec, index: number): Faction {
    const mode = spec.faction ?? 'alternate'
    if (mode === 'warm') return Faction.WARM
    if (mode === 'cool') return Faction.COOL
    return index % 2 === 0 ? Faction.WARM : Faction.COOL
}

function appendJsonl(path: string, value: unknown): void {
    appendFileSync(path, `${JSON.stringify(value)}\n`)
}

function fingerprint(result: SelfPlayResult): string {
    return [result.ok, result.winner ?? '-', result.steps, result.state.log.length, result.state.deck.length].join('|')
}

function main(): void {
    const specPath = process.argv[2]
    if (!specPath) {
        console.error('用法：node <bundle> <spec.json>')
        process.exit(2)
    }
    const spec = readSpec(specPath)

    if (spec.mode === 'describe') {
        console.log(JSON.stringify({
            features: featureTable(),
            thresholds: THRESHOLD_NAMES.map((name) => ({ name, value: THRESHOLD_DEFAULTS[name] })),
        }, null, 2))
        return
    }

    mkdirSync(spec.outDir, { recursive: true })
    const seeds = seedsOf(spec)
    const startedAt = Date.now()
    const gamesPath = join(spec.outDir, 'games.jsonl')
    const decisionsPath = join(spec.outDir, 'decisions.jsonl')
    const abPath = join(spec.outDir, 'ab.jsonl')
    const cfPath = join(spec.outDir, 'counterfactual.jsonl')
    writeFileSync(gamesPath, '')
    writeFileSync(decisionsPath, '')
    writeFileSync(abPath, '')
    writeFileSync(cfPath, '')

    const patchErrors = loadPatchBank(spec.patchBank ?? null)
    if (patchErrors.length) {
        console.error('补丁校验失败：')
        for (const error of patchErrors) console.error(`  - ${error}`)
        process.exit(2)
    }

    const summary = {
        runId: spec.runId,
        mode: spec.mode,
        patchId: spec.patchId ?? null,
        games: 0,
        warmWins: 0,
        coolWins: 0,
        draws: 0,
        failures: 0,
        variantWins: 0,
        variantLosses: 0,
        variantDraws: 0,
        flips: 0,
        errors: [] as string[],
    }

    if (spec.mode === 'selfplay' || spec.mode === 'ab' || spec.mode === 'counterfactual') {
        const record = spec.mode === 'selfplay' && spec.record !== false
        if (record) {
            startAudit({
                runId: spec.runId,
                record: true,
                playStride: spec.playStride ?? 8,
                maxDecisionsPerGame: spec.maxDecisionsPerGame ?? 400,
                intervention: spec.intervention ?? null,
                sink: (item) => appendJsonl(decisionsPath, item),
            })
        }
    }

    const runOne = (seed: number, gameIndex: number): SelfPlayResult => {
        startAuditGame({ seed, game: gameIndex })
        const result = runSelfPlayGame(seed, Faction.WARM, spec.maxSteps)
        return result
    }

    if (spec.mode === 'selfplay') {
        for (let i = 0; i < seeds.length; i++) {
            const seed = seeds[i]
            const faction = factionFor(spec, i)
            if (spec.record === false) {
                startAudit({ runId: spec.runId, record: false, intervention: spec.intervention ?? null })
            }
            const result = runOne(seed, i)
            const winner = result.winner ?? null
            const decisions = spec.record === false ? 0 : finishAuditGame({ winner, steps: result.steps, ok: result.ok })
            if (spec.record === false) finishAuditGame({ winner, steps: result.steps, ok: result.ok })
            summary.games++
            if (!result.ok) summary.failures++
            if (winner === Faction.WARM) summary.warmWins++
            else if (winner === Faction.COOL) summary.coolWins++
            else summary.draws++
            appendJsonl(gamesPath, {
                seed, game: i, faction, ok: result.ok, winner, steps: result.steps,
                rounds: result.state.roundState?.roundNumber ?? 0,
                logLines: result.state.log.length,
                decisions,
            })
            process.stdout.write(`game ${i + 1}/${seeds.length} seed=${seed} winner=${winner ?? '-'} steps=${result.steps} decisions=${decisions}\n`)
        }
    }

    let abVariantStats: { rules: Record<string, number>; thresholds: Record<string, number> } | null = null

    if (spec.mode === 'ab') {
        // 同一初始状态跑多局，补丁在暖/冷之间对调，抵消先手与座位偏差。
        // 处理组与对照组可在同一次进程里跑完（abSeats），避免每轮重启一批子进程。
        const base = spec.patchBank ?? {}
        const preset: Array<{ label: string; bank: PatchBank; variantFaction: Faction | null }> = [
            {
                label: 'warm-patched',
                bank: { warm: base.warm ?? null, cool: base.cool ?? null },
                variantFaction: base.warm ? Faction.WARM : base.cool ? Faction.COOL : null,
            },
            {
                label: 'seat-swapped',
                bank: { warm: base.cool ?? null, cool: base.warm ?? null },
                variantFaction: base.warm ? Faction.COOL : base.cool ? Faction.WARM : null,
            },
        ]
        const seats = spec.abSeats
            ? spec.abSeats.map((seat) => ({
                label: seat.label,
                bank: (seat.bank ?? { warm: null, cool: null }) as PatchBank,
                variantFaction: (seat.variantFaction ?? null) as Faction | null,
            }))
            : preset
        let gameIndex = 0
        // 每个座位单独统计补丁命中，混合批次里也能算出处理组专属的 fires
        const aggStats = { rules: {} as Record<string, number>, thresholds: {} as Record<string, number> }
        for (const seed of seeds) {
            for (const seat of seats) {
                loadPatchBank(seat.bank)
                resetVariantStats()
                startAudit({ runId: spec.runId, record: false, intervention: spec.intervention ?? null })
                const result = runOne(seed, gameIndex)
                const winner = result.winner ?? null
                finishAuditGame({ winner, steps: result.steps, ok: result.ok })
                const stats = variantStats()
                for (const side of ['rules', 'thresholds'] as const) {
                    for (const [key, value] of Object.entries(stats[side] ?? {})) {
                        aggStats[side][key] = (aggStats[side][key] ?? 0) + value
                    }
                }
                summary.games++
                if (!result.ok) summary.failures++
                if (winner === Faction.WARM) summary.warmWins++
                else if (winner === Faction.COOL) summary.coolWins++
                else summary.draws++
                if (seat.variantFaction) {
                    if (winner === seat.variantFaction) summary.variantWins++
                    else if (winner) summary.variantLosses++
                    else summary.variantDraws++
                }
                appendJsonl(abPath, {
                    seed, seatGame: gameIndex, label: seat.label,
                    variantFaction: seat.variantFaction, winner, steps: result.steps, ok: result.ok,
                    variantStats: stats,
                })
                gameIndex++
            }
            process.stdout.write(`seed ${seed} done (${seeds.indexOf(seed) + 1}/${seeds.length})\n`)
        }
        abVariantStats = aggStats
    }

    if (spec.mode === 'counterfactual') {
        const batch = spec.interventions ?? []
        if (batch.length) {
            let solved = 0
            for (let i = 0; i < seeds.length; i++) {
                const seed = seeds[i]
                startAudit({ runId: spec.runId, record: false, intervention: null })
                const plain = runOne(seed, i)
                finishAuditGame({ winner: plain.winner ?? null, steps: plain.steps, ok: plain.ok })
                summary.games++
                if (!plain.ok) summary.failures++
                for (const item of batch) {
                    startAudit({ runId: spec.runId, record: false, intervention: item.intervention })
                    const forced = runOne(seed, i)
                    finishAuditGame({ winner: forced.winner ?? null, steps: forced.steps, ok: forced.ok })
                    summary.games++
                    if (!forced.ok) summary.failures++
                    const flipped = (plain.winner ?? null) !== (forced.winner ?? null)
                    if (flipped) summary.flips++
                    const forcedFaction = item.intervention.onlyFaction ?? null
                    appendJsonl(cfPath, {
                        seed,
                        interventionId: item.id,
                        forcedFaction,
                        forcedRule: item.intervention.forceRuleId ?? null,
                        hits: interventionHitCount(),
                        applied: forcedAppliedCount(),
                        plain: { winner: plain.winner ?? null, steps: plain.steps, ok: plain.ok },
                        forced: { winner: forced.winner ?? null, steps: forced.steps, ok: forced.ok },
                        wonPlain: forcedFaction ? plain.winner === forcedFaction : null,
                        wonForced: forcedFaction ? forced.winner === forcedFaction : null,
                        flipped,
                    })
                }
                solved++
                process.stdout.write(`cf ${solved}/${seeds.length} seed=${seed} ${plain.winner ?? '-'} ×${batch.length} 干预\n`)
            }
        } else {
            for (let i = 0; i < seeds.length; i++) {
                const seed = seeds[i]
                startAudit({ runId: spec.runId, record: false, intervention: null })
                const plain = runOne(seed, i)
                finishAuditGame({ winner: plain.winner ?? null, steps: plain.steps, ok: plain.ok })
                startAudit({ runId: spec.runId, record: false, intervention: spec.intervention ?? null })
                const forced = runOne(seed, i)
                finishAuditGame({ winner: forced.winner ?? null, steps: forced.steps, ok: forced.ok })
                summary.games += 2
                if (!plain.ok) summary.failures++
                if (!forced.ok) summary.failures++
                const flipped = (plain.winner ?? null) !== (forced.winner ?? null)
                if (flipped) summary.flips++
                const forcedFaction = spec.intervention?.onlyFaction ?? null
                const forcedApplied = forcedAppliedCount()
                appendJsonl(cfPath, {
                    seed,
                    forcedFaction,
                    forcedRule: spec.intervention?.forceRuleId ?? null,
                    hits: interventionHitCount(),
                    applied: forcedApplied,
                    plain: { winner: plain.winner ?? null, steps: plain.steps, ok: plain.ok },
                    forced: { winner: forced.winner ?? null, steps: forced.steps, ok: forced.ok },
                    wonPlain: forcedFaction ? plain.winner === forcedFaction : null,
                    wonForced: forcedFaction ? forced.winner === forcedFaction : null,
                    flipped,
                })
                process.stdout.write(`cf ${i + 1}/${seeds.length} seed=${seed} ${plain.winner ?? '-'} -> ${forced.winner ?? '-'}\n`)
            }
        }
    }

    if (spec.mode === 'fingerprint') {
        for (const seed of seeds) {
            startAudit({ runId: spec.runId, record: false })
            const a = runOne(seed, 0)
            finishAuditGame({ winner: a.winner ?? null, steps: a.steps, ok: a.ok })
            const b = runOne(seed, 0)
            finishAuditGame({ winner: b.winner ?? null, steps: b.steps, ok: b.ok })
            const same = fingerprint(a) === fingerprint(b)
            summary.games += 2
            if (!same) {
                summary.errors.push(`seed ${seed} 重放不一致：${fingerprint(a)} vs ${fingerprint(b)}`)
            }
            appendJsonl(gamesPath, { seed, kind: 'fingerprint', same, a: fingerprint(a), b: fingerprint(b) })
        }
    }

    stopAudit()
    const elapsedMs = Date.now() - startedAt
    writeFileSync(join(spec.outDir, 'summary.json'), JSON.stringify({
        ...summary,
        variantStats: abVariantStats ?? variantStats(),
        elapsedMs,
    }, null, 2))
    console.log(`summary: mode=${spec.mode} games=${summary.games} warm=${summary.warmWins} cool=${summary.coolWins} draws=${summary.draws} failures=${summary.failures} variantWins=${summary.variantWins} flips=${summary.flips} ms=${elapsedMs}`)
    if (summary.failures > 0 || summary.errors.length > 0) process.exitCode = 1
}

main()
