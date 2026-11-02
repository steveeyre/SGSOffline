/**
 * 统计筛选：把决策点按“错手嫌疑”排序，取出 5%-10% 并聚成簇。
 * 只做统计，不调用 LLM；输出 screening.json 供复盘阶段使用。
 */
import { join } from 'node:path'
import { readJsonl, writeJson } from './engine.mjs'
import { loadRuleSites, normalizeRuleId } from './kb.mjs'

export const PASS_SCORE = 20
const MARGIN_EPSILON = 6
const NUMERIC_FEATURES = ['my_hp', 'cmd_hp', 'enemy_cmd_hp', 'enemy_cmd_hand', 'slash', 'dodge', 'peach', 'deck_left', 'round', 'hp_gap']
const BOOL_FEATURES = ['enemy_cmd_armor', 'under_threat', 'kill_window', 'is_first_mover']

function hpBucket(hp) {
    if (hp <= 1) return 'low'
    if (hp <= 2) return '2'
    if (hp <= 3) return '3'
    return 'high'
}

function bucketOf(decision) {
    const feats = decision.feats ?? {}
    return [
        hpBucket(feats.enemy_cmd_hp ?? 9),
        hpBucket(feats.cmd_hp ?? 9),
        feats.enemy_cmd_armor ? 'armor' : 'noarmor',
        feats.under_threat ? 'threat' : 'calm',
        feats.kill_window ? 'kill' : 'nokill',
        (feats.enemy_cmd_hand ?? 0) <= 2 ? 'fewcards' : 'cards',
    ].join('|')
}

/** 把分桶条件翻译成谓词 DSL，作为反事实干预的触发条件 */
export function predicateFromDecision(decision) {
    const feats = decision.feats ?? {}
    const parts = []
    const enemyHp = feats.enemy_cmd_hp ?? 9
    if (enemyHp <= 1) parts.push({ cmp: ['enemy_cmd_hp', '<=', 1] })
    else if (enemyHp <= 2) parts.push({ cmp: ['enemy_cmd_hp', '<=', 2] })
    else if (enemyHp <= 3) parts.push({ cmp: ['enemy_cmd_hp', '<=', 3] })
    const cmdHp = feats.cmd_hp ?? 9
    if (cmdHp <= 1) parts.push({ cmp: ['cmd_hp', '<=', 1] })
    else if (cmdHp <= 2) parts.push({ cmp: ['cmd_hp', '<=', 2] })
    else if (cmdHp <= 3) parts.push({ cmp: ['cmd_hp', '<=', 3] })
    if (feats.enemy_cmd_armor) parts.push({ cmp: ['enemy_cmd_armor', '==', true] })
    else parts.push({ not: { cmp: ['enemy_cmd_armor', '==', true] } })
    if (feats.under_threat) parts.push({ cmp: ['under_threat', '==', true] })
    if (feats.kill_window) parts.push({ cmp: ['kill_window', '==', true] })
    return parts.length === 1 ? parts[0] : { all: parts }
}

function annotate(decision, ruleStats, globalLossRate) {
    const chosen = decision.candidates?.find((candidate) => candidate.chosen)
    const others = (decision.candidates ?? []).filter((candidate) => !candidate.chosen && (candidate.score ?? 0) > 0)
    const bestOther = [...others].sort((a, b) =>
        (b.final ?? b.score ?? 0) - (a.final ?? a.score ?? 0))[0]
    const bestScore = Math.max(0, ...(decision.candidates ?? []).map((candidate) => candidate.score ?? 0))
    const won = decision.outcome?.winner === decision.faction
    const flags = {
        passCut: decision.ruleId === 'PASS' || (decision.candidates?.length > 0 && bestScore < PASS_SCORE),
        nearMiss: !!chosen && !!bestOther &&
            Math.abs((chosen.final ?? chosen.score ?? 0) - (bestOther.final ?? bestOther.score ?? 0)) < MARGIN_EPSILON,
        conflict: !!chosen && others.some((other) =>
            (other.score ?? 0) > (chosen.score ?? 0) && (other.final ?? 0) < (chosen.final ?? 0)),
        lossContext: !won && decision.kind === 'play' &&
            ((decision.feats?.cmd_hp ?? 9) <= 2 || (decision.feats?.my_hp ?? 9) <= 1),
    }
    const stat = ruleStats.get(decision.ruleId)
    const anomaly = stat && stat.n >= 20 ? Math.abs(stat.lossRate - globalLossRate) : 0
    // 无任何候选的 PASS 属于「规则缺失」，无法用强制改选验证，权重压到行动类之下
    const gap = decision.ruleId === 'PASS' && (decision.candidates?.length ?? 0) === 0
    const emptyHanded = gap && (decision.feats?.my_hand ?? 0) === 0
    let suspicion = 0
    if (flags.passCut) suspicion += gap ? 1.5 : 3
    if (flags.conflict) suspicion += 3
    if (flags.nearMiss) suspicion += 2
    if (flags.lossContext) suspicion += emptyHanded ? 0.5 : 2
    suspicion += Math.min(3, anomaly * 10)
    // 只有势均力敌的局面才值得复盘：一边倒的残局里任何单步都翻不回来
    const balance = 1 - Math.min(1, Math.abs(decision.feats?.hp_gap ?? 0) / 8)
    suspicion += balance * 1.5
    if ((decision.feats?.ally_alive ?? 3) < (decision.feats?.enemy_alive ?? 3)) suspicion -= 1
    if (decision.kind !== 'play') suspicion *= 0.5
    if ((decision.candidates?.length ?? 0) > 2) suspicion += 0.5
    if (emptyHanded) suspicion -= 1
    return { flags, suspicion, chosen, bestOther, bestScore, won, anomaly, gap, balance }
}

function featureSummary(decs) {
    const numeric = {}
    for (const name of NUMERIC_FEATURES) {
        const values = decs.map((d) => d.feats?.[name]).filter((v) => typeof v === 'number')
        if (!values.length) continue
        numeric[name] = {
            avg: Number((values.reduce((s, v) => s + v, 0) / values.length).toFixed(2)),
            min: Math.min(...values),
            max: Math.max(...values),
        }
    }
    const bools = {}
    for (const name of BOOL_FEATURES) {
        const values = decs.map((d) => d.feats?.[name]).filter((v) => typeof v === 'boolean')
        if (!values.length) continue
        bools[name] = {
            trueCount: values.filter(Boolean).length,
            share: Number((values.filter(Boolean).length / values.length).toFixed(2)),
        }
    }
    return { numeric, bools }
}

export function screenRun(runDir, {
    ratio = 0.07,
    maxSelect = 20000,
    maxClusters = 8,
    maxExamples = 6,
} = {}) {
    const decisions = readJsonl(join(runDir, 'run-decisions.jsonl'))
    const games = readJsonl(join(runDir, 'run-games.jsonl'))
    if (decisions.length === 0) {
        throw new Error(`${runDir} 里没有 run-decisions.jsonl，先执行 run`)
    }
    const sites = loadRuleSites()
    const ruleStats = new Map()
    let wins = 0
    let losses = 0
    for (const decision of decisions) {
        const outcome = decision.outcome
        if (!outcome?.winner) continue
        const won = outcome.winner === decision.faction
        const key = decision.ruleId
        const stat = ruleStats.get(key) ?? { ruleId: key, site: normalizeRuleId(key, sites), n: 0, wins: 0, losses: 0 }
        stat.n++
        if (won) {
            stat.wins++
            wins++
        } else {
            stat.losses++
            losses++
        }
        ruleStats.set(key, stat)
    }
    const globalLossRate = wins + losses > 0 ? losses / (wins + losses) : 0
    for (const stat of ruleStats.values()) {
        stat.lossRate = stat.n ? stat.losses / stat.n : 0
        stat.pWin = stat.n ? stat.wins / stat.n : 0
        stat.delta = stat.lossRate - globalLossRate
    }

    const annotated = decisions.map((decision) => ({ decision, ...annotate(decision, ruleStats, globalLossRate) }))
    annotated.sort((a, b) => b.suspicion - a.suspicion)

    const limit = Math.min(maxSelect, Math.max(1, Math.ceil(annotated.length * ratio)))
    const perRuleCap = Math.max(4, Math.ceil(limit * 0.25))
    const perRuleCount = new Map()
    const selected = []
    for (const item of annotated) {
        if (selected.length >= limit) break
        if (item.suspicion <= 0) break
        const used = perRuleCount.get(item.decision.ruleId) ?? 0
        if (used >= perRuleCap) continue
        perRuleCount.set(item.decision.ruleId, used + 1)
        selected.push(item)
    }

    const clusters = new Map()
    for (const item of selected) {
        const decision = item.decision
        const bucket = bucketOf(decision)
        const key = `${decision.kind}/${decision.ruleId}/${bucket}`
        const cluster = clusters.get(key) ?? {
            key,
            kind: decision.kind,
            ruleId: decision.ruleId,
            site: normalizeRuleId(decision.ruleId, sites),
            bucket,
            factionVotes: {},
            size: 0,
            suspicion: 0,
            lossCount: 0,
            winCount: 0,
            decisions: [],
            alternativeVotes: {},
        }
        cluster.size++
        cluster.suspicion += item.suspicion
        cluster.decisions.push(decision)
        cluster.factionVotes[decision.faction] = (cluster.factionVotes[decision.faction] ?? 0) + 1
        if (decision.outcome?.winner === decision.faction) cluster.winCount++
        else if (decision.outcome?.winner) cluster.lossCount++
        for (const candidate of decision.candidates ?? []) {
            if (candidate.chosen) continue
            if ((candidate.score ?? 0) <= 0) continue
            cluster.alternativeVotes[candidate.ruleId] = (cluster.alternativeVotes[candidate.ruleId] ?? 0) + 1
        }
        clusters.set(key, cluster)
    }

    const clusterList = [...clusters.values()]
        .map((cluster) => {
            const decs = [...cluster.decisions].sort((a, b) =>
                (b.candidates?.length ?? 0) - (a.candidates?.length ?? 0))
            const dominant = Object.entries(cluster.factionVotes).sort((a, b) => b[1] - a[1])[0]
            const alternatives = Object.entries(cluster.alternativeVotes)
                .sort((a, b) => b[1] - a[1])
                .map(([ruleId, count]) => ({ ruleId, count }))
            return {
                key: cluster.key,
                kind: cluster.kind,
                ruleId: cluster.ruleId,
                site: cluster.site,
                bucket: cluster.bucket,
                faction: dominant?.[0] ?? null,
                size: cluster.size,
                suspicion: Number(cluster.suspicion.toFixed(2)),
                winShare: cluster.size ? Number((cluster.winCount / cluster.size).toFixed(2)) : 0,
                lossShare: cluster.size ? Number((cluster.lossCount / cluster.size).toFixed(2)) : 0,
                alternatives,
                gap: alternatives.length === 0 && cluster.ruleId === 'PASS',
                predicate: predicateFromDecision(decs[0]),
                featureSummary: featureSummary(decs),
                examples: decs.slice(0, maxExamples).map((decision) => ({
                    seed: decision.seed,
                    game: decision.game,
                    decisionIndex: decision.decisionIndex,
                    kind: decision.kind,
                    ruleId: decision.ruleId,
                    faction: decision.faction,
                    generalId: decision.generalId,
                    seatRole: decision.seatRole,
                    feats: decision.feats,
                    candidates: decision.candidates,
                    meta: decision.meta,
                    outcome: decision.outcome,
                })),
            }
        })
        .sort((a, b) => b.suspicion - a.suspicion)
        .slice(0, maxClusters)

    const screening = {
        runId: decisions[0]?.runId ?? null,
        generatedAt: new Date().toISOString(),
        population: {
            games: games.length,
            decisions: decisions.length,
            selected: selected.length,
            ratio: decisions.length ? Number((selected.length / decisions.length).toFixed(4)) : 0,
            requestedRatio: ratio,
        },
        globalLossRate: Number(globalLossRate.toFixed(4)),
        ruleStats: [...ruleStats.values()]
            .sort((a, b) => b.n - a.n)
            .map((stat) => ({
                ...stat,
                lossRate: Number(stat.lossRate.toFixed(4)),
                pWin: Number(stat.pWin.toFixed(4)),
                delta: Number(stat.delta.toFixed(4)),
            })),
        clusters: clusterList,
        selectedKeys: selected.map((item) => ({
            seed: item.decision.seed,
            game: item.decision.game,
            decisionIndex: item.decision.decisionIndex,
            ruleId: item.decision.ruleId,
            cluster: `${item.decision.kind}/${item.decision.ruleId}/${bucketOf(item.decision)}`,
            suspicion: Number(item.suspicion.toFixed(2)),
            flags: item.flags,
        })),
    }
    writeJson(join(runDir, 'screening.json'), screening)
    return screening
}

export function printScreening(screening) {
    const pop = screening.population
    console.log(`决策点 ${pop.decisions} 个，筛选 ${pop.selected} 个（${(pop.ratio * 100).toFixed(2)}%，目标 ${(pop.requestedRatio * 100).toFixed(0)}%）`)
    console.log('\n规则价值可疑度（按出现次数）:')
    for (const stat of screening.ruleStats.slice(0, 12)) {
        console.log(`  ${stat.ruleId.padEnd(26)} n=${String(stat.n).padStart(5)} 败率=${(stat.lossRate * 100).toFixed(1)}% Δ=${(stat.delta * 100).toFixed(1)}%`)
    }
    console.log('\nTop 错手簇:')
    for (const cluster of screening.clusters) {
        const alt = cluster.alternatives[0]
        console.log(`  [${cluster.suspicion}] ${cluster.kind}/${cluster.ruleId} @ ${cluster.bucket} n=${cluster.size} 败率=${(cluster.lossShare * 100).toFixed(0)}%` +
            (alt ? ` 备选=${alt.ruleId}(${alt.count})` : ''))
    }
}
