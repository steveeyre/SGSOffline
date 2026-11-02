#!/usr/bin/env node
/**
 * 规则式 PC 的复盘流水线。
 *
 *   run      批量自对弈产局（固定种子、决策点录制）
 *   screen   统计筛选 5%-10% 高嫌疑决策点并聚簇
 *   review   对簇做反事实重放，交给本地 LLM 出规则假设
 *   apply    假设 → 可回滚补丁 + 可直接落地的代码片段
 *   ab       旧 PC vs 新 PC 成对成座位自对弈，统计胜率与显著性
 *   adopt / observe / reject   按验证结论写入知识库
 *   report   汇总报告
 */
import { cpus } from 'node:os'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
    auditRoot, branchStamp, ensureDirs, fetchDescribe, hypothesesRoot, patchesRoot, promptsRoot,
    readJson, readJsonl, repoRoot, runEngineBatch, runsRoot, writeJson,
} from './engine.mjs'
import { screenRun, printScreening } from './screen.mjs'
import { binomialTwoSided, fmtPct, pairedComparison, verdictOf } from './stats.mjs'
import {
    buildReviewPrompt, chatJson, hypothesesMarkdown, llmConfig, parseHypotheses, pingOllama,
    validateHypothesis,
} from './llm.mjs'
import {
    describePredicate, patchFromHypothesis, renderPatchSnippet, summarizePatch, writePatchFile,
} from './patch.mjs'
import {
    KB_FILES, loadBudget, loadRuleSites, patchCost, readKnowledge, readNegatives, readObservations,
    pushRecord,
} from './kb.mjs'

const COMMANDS = ['run', 'screen', 'review', 'apply', 'ab', 'adopt', 'observe', 'reject', 'report', 'status']

function parseFlags(argv) {
    const flags = {}
    for (let i = 0; i < argv.length; i++) {
        const token = argv[i]
        if (!token.startsWith('--')) continue
        const key = token.slice(2)
        const next = argv[i + 1]
        if (next === undefined || next.startsWith('--')) flags[key] = true
        else {
            flags[key] = next
            i++
        }
    }
    return flags
}

function num(value, fallback) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
}

function fail(message) {
    console.error(`错误：${message}`)
    process.exit(2)
}

function resolveRunDir(flags) {
    const name = flags.run
    if (!name) fail('需要 --run <runId|目录>')
    const direct = resolve(name)
    if (name.includes('/') || name.includes('\\')) return direct
    return join(runsRoot, name)
}

function latestDirWith(root, marker) {
    const candidates = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(root, entry.name))
        .filter((dir) => existsSync(join(dir, marker)))
    if (!candidates.length) return null
    return candidates.sort((a, b) => (a < b ? -1 : 1)).at(-1)
}

function sanitize(value) {
    return String(value).replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 80)
}

async function commandRun(flags) {
    const games = num(flags.games, 200)
    const workers = Math.max(1, num(flags.workers, Math.min(4, cpus().length)))
    const startSeed = num(flags.seed, 1000)
    const runId = typeof flags.run === 'string' ? flags.run : `run-${branchStamp()}`
    const runDir = join(runsRoot, runId)
    const seeds = Array.from({ length: games }, (_, index) => startSeed + index)
    const spec = {
        runId,
        mode: 'selfplay',
        faction: 'alternate',
        record: true,
        playStride: num(flags.stride, 8),
        maxDecisionsPerGame: num(flags['max-decisions'], 400),
        maxSteps: 60000,
    }
    console.log(`产出 ${games} 局（种子 ${startSeed}..${startSeed + games - 1}，${workers} 进程）→ ${runDir}`)
    const summary = await runEngineBatch({ runDir, spec, seeds, workers, stage: 'run' })
    const meta = {
        runId,
        createdAt: new Date().toISOString(),
        runDir,
        config: { games, workers, startSeed, ...spec },
        seeds,
        summary,
    }
    writeJson(join(runDir, 'run.json'), meta)
    console.log(`\n完成：${summary.games} 局，暖方 ${summary.warmWins} / 冷方 ${summary.coolWins} / 无胜者 ${summary.draws}，卡死 ${summary.failures}`)
    if (summary.failures > Math.max(1, summary.games * 0.02)) {
        console.error('卡死比例超过 2%，先修引擎再复盘。')
        process.exitCode = 1
    }
}

async function commandScreen(flags) {
    const runDir = resolveRunDir(flags)
    const screening = screenRun(runDir, {
        ratio: num(flags.ratio, 0.07),
        maxSelect: num(flags.max, 20000),
        maxClusters: num(flags.clusters, 8),
        maxExamples: num(flags.examples, 6),
    })
    printScreening(screening)
    const actual = screening.population.decisions ? screening.population.selected / screening.population.decisions : 0
    if (actual < 0.05) {
        console.warn(`\n注意：实际只筛到 ${(actual * 100).toFixed(2)}%，低于目标 5%-10%。可调大 --ratio 或 --max（当前上限 ${num(flags.max, 20000)}）。`)
    }
    console.log(`\n已写入 ${join(runDir, 'screening.json')}`)
}

/** 把一簇的备选动作按票数+胜率排好序，供批量干预使用 */
function rankedAlternatives(cluster, ruleStats, limit = 3) {
    const votes = new Map((cluster.alternatives ?? []).map((item) => [item.ruleId, item.count]))
    return [...votes.keys()]
        .filter((ruleId) => ruleId && ruleId !== 'PASS')
        .map((ruleId) => ({ ruleId, votes: votes.get(ruleId) ?? 0, pWin: ruleStats?.get(ruleId)?.pWin ?? 0.5 }))
        .sort((a, b) => b.votes - a.votes)
        .slice(0, limit)
}

function interventionIdOf(clusterKey, ruleId) {
    return `${clusterKey}#${ruleId}`
}

/**
 * 反事实批量归因：把多个簇 × 多个备选动作合并成同一批种子的一次运行。
 * 每个种子先跑一局基线，再依次跑所有干预，避免「每簇启动一批子进程」。
 */
async function collectEvidence({ candidates, seedsFor, workers, runId, ruleStats, maxHits = 12 }) {
    const plan = new Map()
    const batch = []
    for (const cluster of candidates) {
        const ranked = rankedAlternatives(cluster, ruleStats)
        if (cluster.kind !== 'play') {
            plan.set(cluster.key, {
                skip: cluster.ruleId === 'PASS'
                    ? '该局面没有任何候选动作（规则缺失），无法用强制改选验证；只能验证既有规则的兜底提分'
                    : '该簇没有可强制改选的备选动作（仅出牌阶段支持反事实干预）',
                gap: cluster.ruleId === 'PASS',
            })
            continue
        }
        if (!ranked.length) {
            plan.set(cluster.key, {
                skip: cluster.ruleId === 'PASS'
                    ? '该局面没有任何候选动作（规则缺失），无法用强制改选验证；只能验证既有规则的兜底提分'
                    : '该簇没有可强制改选的备选动作（仅出牌阶段支持反事实干预）',
                gap: cluster.ruleId === 'PASS',
            })
            continue
        }
        plan.set(cluster.key, { ranked })
        for (const item of ranked) {
            batch.push({
                id: interventionIdOf(cluster.key, item.ruleId),
                intervention: {
                    when: cluster.predicate,
                    forceRuleId: item.ruleId,
                    onlyFaction: cluster.faction,
                    maxHits,
                },
            })
        }
    }

    const skipped = new Map()
    for (const [key, entry] of plan) {
        if (entry.ranked) continue
        skipped.set(key, {
            supported: false,
            gap: entry.gap ?? false,
            reason: entry.skip ?? '该簇不适合反事实归因',
        })
    }
    if (!batch.length) return { evidence: skipped, batchSize: 0, seeds: 0 }
    const seedSet = new Set()
    for (const cluster of candidates) {
        if (!plan.get(cluster.key)?.ranked) continue
        for (const seed of seedsFor(cluster) ?? []) seedSet.add(seed)
    }
    const seeds = [...seedSet]
    const dir = join(auditRoot, 'runs', runId, 'evidence')
    console.log(`反事实批量：${batch.length} 个干预（${candidates.filter((c) => plan.get(c.key)?.ranked).length} 簇）× ${seeds.length} 个种子，单进程内一次跑完`)
    await runEngineBatch({
        runDir: dir,
        spec: {
            runId: `${runId}-ev`,
            mode: 'counterfactual',
            interventions: batch,
            maxSteps: 60000,
        },
        seeds,
        workers,
        stage: 'ev',
    })

    const rows = readJsonl(join(dir, 'ev-counterfactual.jsonl'))
    const byIntervention = new Map()
    for (const row of rows) {
        if (!row.interventionId || typeof row.wonPlain !== 'boolean') continue
        if (!byIntervention.has(row.interventionId)) byIntervention.set(row.interventionId, [])
        byIntervention.get(row.interventionId).push(row)
    }

    const evidence = new Map(skipped)
    for (const cluster of candidates) {
        const entry = plan.get(cluster.key)
        if (!entry?.ranked) continue
        const attempts = []
        let best = null
        for (const candidate of entry.ranked) {
            const rowsOf = byIntervention.get(interventionIdOf(cluster.key, candidate.ruleId)) ?? []
            const applied = rowsOf.filter((row) => (row.applied ?? 0) > 0)
            if (!rowsOf.length) {
                attempts.push(`${candidate.ruleId}(无产出)`)
                continue
            }
            if (!applied.length) {
                attempts.push(`${candidate.ruleId}(命中 ${rowsOf.filter((row) => (row.hits ?? 0) > 0).length} 局但未执行)`)
                continue
            }
            best = summarizeEvidence(cluster, candidate.ruleId, rowsOf, applied)
            break
        }
        evidence.set(cluster.key, best ?? {
            supported: false,
            alternative: entry.ranked[0]?.ruleId,
            attemptedSeeds: seeds.length,
            reason: `前 ${attempts.length} 个备选动作在该局面都执行不了，无法用强制改选归因：${attempts.join('、')}`,
        })
    }
    return { evidence, batchSize: batch.length, seeds: seeds.length }
}

function summarizeEvidence(cluster, alternative, rowsOf, applied) {
    const wonPlain = applied.filter((row) => row.wonPlain).length
    const wonForced = applied.filter((row) => row.wonForced).length
    const b = applied.filter((row) => row.wonForced && !row.wonPlain).length
    const c = applied.filter((row) => !row.wonForced && row.wonPlain).length
    const delta = (wonForced - wonPlain) / applied.length
    return {
        supported: true,
        cluster: cluster.key,
        alternative,
        seeds: applied.length,
        attemptedSeeds: rowsOf.length,
        hitSeeds: rowsOf.filter((row) => (row.hits ?? 0) > 0).length,
        appliedSeeds: applied.length,
        wonPlain,
        wonForced,
        delta: Number(delta.toFixed(4)),
        pValue: Number(binomialTwoSided(Math.min(b, c), b + c).toFixed(4)),
        flips: applied.filter((row) => row.flipped).length,
        note: '同一初始状态下，把该簇命中的决策统一改选为 alternative，只统计改选真正生效的对局',
        examples: applied.filter((row) => row.flipped).slice(0, 3).map((row) => ({
            seed: row.seed,
            plainWinner: row.plain?.winner ?? null,
            forcedWinner: row.forced?.winner ?? null,
        })),
    }
}


async function commandReview(flags) {
    const runDir = resolveRunDir(flags)
    let screening = readJson(join(runDir, 'screening.json'), null)
    if (!screening) screening = screenRun(runDir, {})
    const runMeta = readJson(join(runDir, 'run.json'), {})
    const runSeeds = runMeta.seeds ?? []
    if (!runSeeds.length) fail('run.json 里没有种子列表')
    const evidenceBudget = num(flags['evidence-games'], 200)
    const clusterSeeds = new Map()
    for (const item of screening.selectedKeys ?? []) {
        if (!item.cluster) continue
        if (!clusterSeeds.has(item.cluster)) clusterSeeds.set(item.cluster, new Set())
        clusterSeeds.get(item.cluster).add(item.seed)
    }
    const workers = Math.max(1, num(flags.workers, 4))
    const sites = loadRuleSites()
    const described = await fetchDescribe()
    const features = new Map(described.features.map((spec) => [spec.name, spec.type]))
    const thresholdSpecs = described.thresholds
    const thresholds = thresholdSpecs.map((item) => item.name)
    const ruleIds = [...Object.keys(sites.rules), ...Object.keys(sites.synthetic), 'PASS']
    const budget = loadBudget(sites)
    const negatives = readNegatives().items

    const playClusters = screening.clusters.filter((cluster) => cluster.kind === 'play')
    const actionable = playClusters.filter((cluster) =>
        (cluster.alternatives?.length ?? 0) > 0 && cluster.size >= 3)
    const gaps = playClusters.filter((cluster) =>
        (cluster.alternatives?.length ?? 0) === 0 && cluster.gap && cluster.size >= 3).slice(0, 2)
    const candidates = [...actionable, ...gaps].slice(0, num(flags.clusters, 6))
    if (!candidates.length) fail('没有可复盘的出牌簇（要求：出牌阶段、有备选动作、簇规模 ≥3）')
    console.log(`反事实归因 ${candidates.length} 个簇，每簇最多 ${evidenceBudget} 个种子（优先该簇出现过的对局）`)
    const ruleStats = new Map(screening.ruleStats.map((stat) => [stat.ruleId, stat]))
    const seedsFor = (cluster) => [
        ...(clusterSeeds.get(cluster.key) ?? []),
        ...runSeeds.filter((seed) => !clusterSeeds.get(cluster.key)?.has(seed)),
    ].slice(0, evidenceBudget)
    const evidenceRun = await collectEvidence({
        candidates,
        seedsFor,
        workers,
        runId: runMeta.runId ?? 'run',
        ruleStats,
        maxHits: num(flags['max-hits'], 12),
    })
    const clusters = candidates.map((cluster) => ({ ...cluster, evidence: evidenceRun.evidence.get(cluster.key) }))
    for (const cluster of clusters) {
        const item = cluster.evidence
        const line = item?.supported
            ? `Δ=${fmtPct(item.delta)} p=${item.pValue} 翻转=${item.flips}/${item.seeds}（改选 ${item.alternative}）`
            : `跳过：${item?.reason ?? '无数据'}`
        console.log(`  ${cluster.key} → ${line}`)
    }
    writeJson(join(runDir, 'evidence.json'), {
        runId: runMeta.runId,
        clusters,
        batch: { interventions: evidenceRun.batchSize, seeds: evidenceRun.seeds },
    })

    // 批处理：只把「可疑度高且证据充分」的簇送进提示词，直接减少 token
    const minClusters = 1
    const llmClusters = clusters
        .filter((cluster) => cluster.evidence?.supported || cluster.gap)
        .slice(0, Math.max(minClusters, num(flags['llm-clusters'], 4)))
    const dropped = clusters.length - llmClusters.length
    if (dropped > 0) console.log(`\n跳过 ${dropped} 个无有效证据的簇，只把 ${llmClusters.length} 个簇送给模型。`)

    const ctx = num(flags['num-ctx'], llmConfig.numCtx)
    const predict = num(flags['max-tokens'], llmConfig.numPredict)
    const promptArgs = {
        runId: runMeta.runId ?? 'run',
        clusters: llmClusters,
        features: described.features,
        thresholds,
        thresholdSpecs,
        ruleIds,
        negatives,
        ruleStats: screening.ruleStats,
        budget,
        minGain: 0.02,
    }
    const build = (list, compact) => buildReviewPrompt({ ...promptArgs, clusters: list, compact })
    let batchClusters = llmClusters
    let compact = !!flags.compact
    let built = build(batchClusters, compact)
    if (!compact && built.tokens + predict > ctx * 0.9) {
        compact = true
        built = build(batchClusters, compact)
        console.log(`提示词约 ${built.tokens} token，超出上下文 ${ctx}，已自动切到精简模式。`)
    }
    mkdirSync(promptsRoot, { recursive: true })
    const stamp = branchStamp()
    const promptPath = join(promptsRoot, `${runMeta.runId ?? 'run'}-${stamp}.txt`)
    writeFileSync(promptPath, `${built.system}\n\n${built.prompt}\n`)
    console.log(`\n提示词已写入 ${promptPath}（约 ${built.tokens} token，${batchClusters.length} 个簇）`)

    const llmMode = flags.llm === 'off' ? 'off' : 'on'
    if (llmMode === 'off') {
        console.log('已按要求跳过 LLM（--llm=off）。把上面的提示词喂给本地模型即可。')
        return
    }
    const ping = await pingOllama()
    if (!ping.ok) {
        console.error(`本地 Ollama 不可用（${ping.reason}）。可先启动 ollama，或用 --llm=off 导出提示词。`)
        process.exitCode = 1
        return
    }
    const model = flags.model ?? llmConfig.model
    if (ping.models.length && !ping.models.includes(model)) {
        console.warn(`警告：模型 ${model} 不在已安装列表里，仍按配置尝试。`)
    }
    console.log(`调用本地模型 ${model} …（上下文 ${ctx}，最多 ${predict} 输出 token，首次跑会较慢）`)
    if (built.tokens + predict > ctx) {
        console.warn(`警告：提示词约 ${built.tokens} token，加上输出上限 ${predict} 超过上下文 ${ctx}，会被截断或返回 400。可减少 --llm-clusters，或换上下文更大的模型。`)
    }
    // 解析/校验失败时二分重试：只补发没拿到有效假设的簇，避免整批重跑白烧 token
    const askBatch = async (list) => {
        const payload = build(list, compact)
        if (payload.tokens + predict > ctx) {
            compact = true
        }
        const text = await chatJson({ system: payload.system, prompt: payload.prompt, model, numPredict: predict, numCtx: ctx })
        if (!String(text ?? '').trim()) throw new Error('模型返回空内容')
        return text
    }
    const collected = []
    const rawChunks = []
    const queue = [batchClusters]
    while (queue.length) {
        const list = queue.shift()
        let text
        try {
            text = await askBatch(list)
        } catch (error) {
            if (list.length > 1) {
                const mid = Math.ceil(list.length / 2)
                console.warn(`模型调用失败（${error.message}），拆成两批重试：${list.length} → ${mid}+${list.length - mid}`)
                queue.unshift(list.slice(0, mid), list.slice(mid))
                continue
            }
            console.error(`模型调用失败：${error.message}`)
            process.exitCode = 1
            continue
        }
        rawChunks.push(text)
        let parsed
        try {
            parsed = parseHypotheses(text)
        } catch (error) {
            if (list.length > 1) {
                const mid = Math.ceil(list.length / 2)
                console.warn(`输出无法解析（${error.message}），拆成两批重试：${list.length} → ${mid}+${list.length - mid}`)
                queue.unshift(list.slice(0, mid), list.slice(mid))
                continue
            }
            console.error(`输出无法解析：${error.message}`)
            process.exitCode = 1
            continue
        }
        collected.push(...parsed)
    }
    if (!collected.length) {
        console.error('没有得到任何假设。用 --max-tokens 调大或减少 --llm-clusters 后重试。')
        process.exitCode = 1
        return
    }
    const text = rawChunks.join('\n')
    writeFileSync(join(hypothesesRoot, `${runMeta.runId ?? 'run'}-${stamp}.raw.txt`), text)
    const parsed = collected
    const checked = parsed.map((hypothesis) => {
        const result = validateHypothesis(hypothesis, {
            features,
            ruleIds,
            patchTargets: Object.keys(sites.rules),
            thresholds,
        })
        return { hypothesis, valid: result.valid, errors: result.errors }
    })
    const output = {
        runId: runMeta.runId ?? 'run',
        generatedAt: new Date().toISOString(),
        model,
        clusterCount: llmClusters.length,
        hypotheses: checked,
        rejected: checked.filter((item) => !item.valid),
    }
    const hypPath = join(hypothesesRoot, `${runMeta.runId ?? 'run'}-${stamp}.json`)
    writeJson(hypPath, output)
    const md = hypothesesMarkdown(checked, { runId: runMeta.runId, model, clusterCount: llmClusters.length, describePredicate })
    writeFileSync(hypPath.replace(/\.json$/, '.md'), md)
    const valid = checked.filter((item) => item.valid).length
    console.log(`\n得到假设 ${checked.length} 条，通过校验 ${valid} 条。`)
    for (const item of checked) {
        console.log(`  ${item.valid ? 'ok  ' : 'DROP'} ${item.hypothesis.id} ${item.hypothesis.cluster}` +
            (item.valid ? ` → ${item.hypothesis.patch?.type} ${item.hypothesis.patch?.target ?? item.hypothesis.patch?.name}` : ` :: ${item.errors.join('；')}`))
    }
    console.log(`\n假设文件：${hypPath}`)
}

async function commandApply(flags) {
    const explicit = typeof flags.hypotheses === 'string' ? resolve(flags.hypotheses) : null
    const file = explicit ?? latestDirWithFile(hypothesesRoot, '.json')
    if (!file) fail('没有可用的假设文件（先跑 review）')
    const data = readJson(file, null)
    if (!data) fail(`无法读取 ${file}`)
    const sites = loadRuleSites()
    const dryRun = !!flags['dry-run']
    const minConfidence = flags.confidence ?? 'medium'
    const rank = { low: 0, medium: 1, high: 2 }
    const created = []
    for (const item of data.hypotheses ?? []) {
        if (!item.valid) continue
        const hypothesis = item.hypothesis
        if (rank[hypothesis.confidence] < rank[minConfidence]) {
            console.log(`跳过 ${hypothesis.id}：置信度 ${hypothesis.confidence} 低于 ${minConfidence}`)
            continue
        }
        const patch = patchFromHypothesis(hypothesis, { runId: data.runId })
        const info = summarizePatch(patch, sites)
        if (!info.budget.ok) {
            console.log(`跳过 ${hypothesis.id}：${info.budget.reason}`)
            continue
        }
        const path = writePatchFile(patch, { dryRun })
        const snippet = renderPatchSnippet(patch, sites)
        if (!dryRun) writeFileSync(join(patchesRoot, `${patch.id}.ts`), snippet)
        created.push({ patch, info, snippet, path })
        console.log(`\n[${dryRun ? 'dry-run' : '写入'}] ${patch.id}　${info.type} → ${info.target}` +
            `　锚点 ${info.site?.line ?? '?'}　预算 ${info.budget.reason}`)
        console.log(snippet)
    }
    if (!created.length) {
        console.log('没有生成任何补丁。')
        return
    }
    console.log(`\n共 ${created.length} 个补丁。下一步：node scripts/audit/pipeline.mjs ab --patch <id>`)
}

function latestDirWithFile(root, suffix) {
    const entries = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
        .map((entry) => join(root, entry.name))
    if (!entries.length) return null
    return entries.sort((a, b) => (a < b ? -1 : 1)).at(-1)
}

async function commandAb(flags) {
    let patch
    let label
    if (typeof flags.veto === 'string') {
        label = `veto-${sanitize(flags.veto)}`
        patch = {
            id: `${label}-${branchStamp()}`,
            note: `规则价值量化：停用 ${flags.veto}`,
            rules: [{ id: 'v1', type: 'veto', target: flags.veto }],
            meta: { kind: 'veto-control', triggerText: '恒真', currentBehavior: `使用 ${flags.veto}`, suggestedBehavior: '不使用', confidence: 'high', evidence: [] },
        }
    } else {
        if (typeof flags.patch !== 'string') fail('需要 --patch <patchId> 或 --veto <ruleId>')
        const path = join(patchesRoot, `${flags.patch}.json`)
        patch = readJson(path, null)
        if (!patch) fail(`找不到补丁 ${path}`)
        label = sanitize(flags.patch)
    }
    const games = num(flags.games, 500)
    const workers = Math.max(1, num(flags.workers, Math.min(4, cpus().length)))
    const startSeed = num(flags.seed, 1000)
    const seeds = Array.from({ length: games }, (_, index) => startSeed + index)
    const abId = typeof flags.run === 'string' ? flags.run : `ab-${label}-${branchStamp()}`
    const abDir = join(runsRoot, abId)

    // 处理组与对照组放在同一批座位里跑：每种子 4 局，但只启动一轮子进程
    const seats = [
        { label: 'treat', bank: { warm: patch, cool: null }, variantFaction: 'warm', side: 'treat', focus: 'warm' },
        { label: 'treat-swapped', bank: { warm: null, cool: patch }, variantFaction: 'cool', side: 'treat', focus: 'cool' },
        { label: 'control', bank: { warm: null, cool: null }, variantFaction: null, side: 'control', focus: 'warm' },
        { label: 'control-swapped', bank: { warm: null, cool: null }, variantFaction: null, side: 'control', focus: 'cool' },
    ]
    console.log(`A/B：${patch.id}　${games} 个种子 × ${seats.length} 座位（处理 + 对照同批，${workers} 进程）`)
    const summary = await runEngineBatch({
        runDir: abDir,
        spec: { runId: abId, mode: 'ab', patchId: patch.id, abSeats: seats.map(({ side, focus, ...rest }) => rest), maxSteps: 60000 },
        seeds,
        workers,
        stage: 'ab',
    })

    const rows = readJsonl(join(abDir, 'ab-ab.jsonl'))
    if (!rows.length) fail('A/B 批次没有产出结果')
    const sideOf = new Map(seats.map((seat) => [seat.label, seat]))
    const treatBySeed = new Map()
    const controlBySeed = new Map()
    for (const row of rows) {
        const seat = sideOf.get(row.label)
        if (!seat) continue
        const won = row.winner === seat.focus ? 1 : 0
        const bag = seat.side === 'treat' ? treatBySeed : controlBySeed
        bag.set(row.seed, (bag.get(row.seed) ?? 0) + won)
    }
    const comparison = pairedComparison(treatBySeed, controlBySeed)
    const sumStats = (bag) => Object.values(bag ?? {}).reduce((sum, value) => sum + value, 0)
    const totalFires = sumStats(summary.variantStats?.rules) + sumStats(summary.variantStats?.thresholds)
    const verdict = totalFires === 0 ? 'inconclusive' : verdictOf(comparison)
    const failures = summary.failures
    const draws = summary.draws
    const report = {
        abId,
        patchId: patch.id,
        patch,
        createdAt: new Date().toISOString(),
        config: { games, seeds: seeds.length, startSeed, workers, seats: seats.map((seat) => seat.label) },
        comparison,
        variantStats: summary.variantStats ?? { rules: {}, thresholds: {} },
        fires: totalFires,
        failures,
        draws,
        verdict,
        minGain: 0.02,
        alpha: 0.05,
    }
    writeJson(join(abDir, 'ab-report.json'), report)

    console.log('\n结果')
    console.log(`  处理方胜率 ${fmtPct(comparison.treatRate)}（${comparison.treatWins}/${comparison.games}）`)
    console.log(`  对照方胜率 ${fmtPct(comparison.ctrlRate)}（${comparison.ctrlWins}/${comparison.games}）`)
    console.log(`  差值 ${comparison.diff >= 0 ? '+' : ''}${(comparison.diff * 100).toFixed(2)}%　95% CI [${(comparison.ci[0] * 100).toFixed(2)}%, ${(comparison.ci[1] * 100).toFixed(2)}%]`)
    console.log(`  McNemar 失配 b/c = ${comparison.discordant.b}/${comparison.discordant.c}　p = ${comparison.pValue.toFixed(4)}`)
    console.log(`  卡死 ${failures}，无胜者 ${draws}`)
    console.log(`  补丁生效次数 ${totalFires}${totalFires === 0 ? '（补丁一次都没命中，A/B 无诊断意义）' : ''}`)
    console.log(`  结论：${verdict}`)
    console.log(`\n报告：${join(abDir, 'ab-report.json')}`)
    if (totalFires === 0) {
        console.error('补丁从未生效：谓词在该批次里没有命中，或改动没有影响排序。')
    }
    if (failures > Math.max(1, comparison.games * 0.02)) {
        console.error('卡死比例过高，结论不可用。')
        process.exitCode = 1
    }
}

function latestAbReport() {
    const dir = latestDirWith(runsRoot, 'ab-report.json')
    if (!dir) return null
    return { dir, report: readJson(join(dir, 'ab-report.json'), null) }
}

async function commandKb(action, flags) {
    let report
    if (typeof flags.report === 'string') {
        const dir = resolve(flags.report)
        report = readJson(join(dir, 'ab-report.json'), null)
        if (!report) fail(`找不到 ${join(dir, 'ab-report.json')}`)
    } else {
        const found = latestAbReport()
        if (!found) fail('还没有 A/B 报告，先跑 ab')
        report = found.report
    }
    const sites = loadRuleSites()
    // 判定按当前策略重算，避免旧报告里的结论与规则变化脱节
    const verdict = report.fires === 0 ? 'inconclusive' : verdictOf(report.comparison)
    const record = {
        patchId: report.patchId,
        abId: report.abId,
        verdict,
        diff: report.comparison.diff,
        ci: report.comparison.ci,
        pValue: report.comparison.pValue,
        seeds: report.comparison.seeds,
        games: report.comparison.games,
        fires: report.fires ?? null,
        at: new Date().toISOString(),
        note: report.patch.note ?? null,
        patch: report.patch,
    }
    if (action === 'adopt') {
        if (verdict === 'inconclusive' && !flags.force) {
            console.error('补丁在该批次里一次都没生效，不能采纳。先确认谓词是否命中，或扩大 --games。')
            process.exitCode = 2
            return
        }
        if (verdict !== 'adopt' && !flags.force) {
            console.error(`报告结论是 ${verdict}，不满足采纳条件（Δ≥2% 且 p<0.05 且 CI 不含 0）。加 --force 可强制采纳。`)
            process.exitCode = 2
            return
        }
        pushRecord(KB_FILES.KNOWLEDGE, record)
        const budget = loadBudget(sites)
        const cost = patchCost(report.patch, sites)
        if (cost.added > 0) {
            budget.adoptedNewRules += cost.added
            budget.updatedAt = new Date().toISOString()
            writeJson(KB_FILES.BUDGET, budget)
        }
        console.log(`已采纳 ${report.patchId}（Δ=${fmtPct(report.comparison.diff)}，p=${report.comparison.pValue}）`)
        console.log('源码落地：把 patches/' + report.patchId + '.ts 里的片段按锚点写进 local-ai.ts，再跑 npm run check && npm run check:audit。')
    } else if (action === 'observe') {
        if (verdict === 'inconclusive' && !flags.force) {
            console.error('处理组与对照组逐局结果完全相同，没有可观察的差异；加大 --games 或调整补丁后再试。')
            process.exitCode = 2
            return
        }
        pushRecord(KB_FILES.OBSERVATIONS, record)
        console.log(`已加入观察列表 ${report.patchId}（Δ=${fmtPct(report.comparison.diff)}，p=${report.comparison.pValue}）`)
    } else {
        if (verdict !== 'reject' && !flags.force) {
            console.error(`报告结论是 ${verdict}，不是显著负收益，不能当反例入库。加 --force 可强制记录。`)
            process.exitCode = 2
            return
        }
        pushRecord(KB_FILES.NEGATIVES, { ...record, reason: '显著负收益或已回滚' })
        console.log(`已记入负样本 ${report.patchId}，下一轮提示词会自动排除同类假设。`)
    }
}

async function commandReport(flags) {
    const runDir = resolveRunDir(flags)
    const screening = readJson(join(runDir, 'screening.json'), null)
    if (!screening) fail('还没有 screening.json，先跑 screen')
    const runMeta = readJson(join(runDir, 'run.json'), {})
    const negatives = readNegatives()
    const cell = (text) => String(text).replaceAll('|', '\\|')
    const knowledge = readKnowledge()
    const observations = readObservations()
    const lines = [
        `# 复盘报告 ${runMeta.runId ?? ''}`,
        '',
        `- 对局数：${runMeta.summary?.games ?? screening.population.games}`,
        `- 决策点：${screening.population.decisions}，筛选：${screening.population.selected}（${(screening.population.ratio * 100).toFixed(2)}%）`,
        `- 全局败率：${(screening.globalLossRate * 100).toFixed(1)}%`,
        `- 已采纳补丁：${knowledge.adopted.length}　观察中：${observations.items.length}　负样本：${negatives.items.length}`,
        '',
        '## 规则价值可疑度',
        '',
        '| 规则 | 样本 | 败率 | 与全局差 |',
        '| --- | --- | --- | --- |',
        ...screening.ruleStats.slice(0, 15).map((stat) =>
            `| ${cell(stat.ruleId)} | ${stat.n} | ${(stat.lossRate * 100).toFixed(1)}% | ${(stat.delta * 100).toFixed(1)}% |`),
        '',
        '## 高嫌疑错手簇',
        '',
        '| 簇 | 规模 | 败率 | 首选备选 |',
        '| --- | --- | --- | --- |',
        ...screening.clusters.map((cluster) => {
            const alt = cluster.alternatives?.[0]
            return `| ${cell(`${cluster.kind}/${cluster.ruleId}@${cluster.bucket}`)} | ${cluster.size} | ${(cluster.lossShare * 100).toFixed(0)}% | ${alt ? alt.ruleId : '-'} |`
        }),
    ]
    const evidence = readJson(join(runDir, 'evidence.json'), null)
    if (evidence) {
        lines.push('', '## 反事实证据', '', '| 簇 | 改选 | Δ | p | 翻转 |', '| --- | --- | --- | --- | --- |')
        for (const cluster of evidence.clusters) {
            const item = cluster.evidence
            if (!item?.supported) continue
            lines.push(`| ${cell(cluster.key)} | ${item.alternative} | ${(item.delta * 100).toFixed(1)}% | ${item.pValue} | ${item.flips}/${item.seeds} |`)
        }
        for (const cluster of evidence.clusters) {
            const item = cluster.evidence
            if (!item || item.supported) continue
            lines.push(`| ${cell(cluster.key)} | - | 无可用备选：${item.reason} | - | - |`)
        }
    }
    lines.push('', '## 知识库', '')
    for (const item of knowledge.adopted.slice(-8)) {
        lines.push(`- 采纳 ${item.patchId}：Δ=${(item.diff * 100).toFixed(2)}%，p=${item.pValue}，种子 ${item.seeds}`)
    }
    for (const item of observations.items.slice(-8)) {
        lines.push(`- 观察 ${item.patchId}：Δ=${(item.diff * 100).toFixed(2)}%，p=${item.pValue}`)
    }
    for (const item of negatives.items.slice(-8)) {
        lines.push(`- 负样本 ${item.patchId}：Δ=${(item.diff * 100).toFixed(2)}%，p=${item.pValue}`)
    }
    const text = lines.join('\n')
    writeFileSync(join(runDir, 'REPORT.md'), `${text}\n`)
    console.log(text)
    console.log(`\n已写入 ${join(runDir, 'REPORT.md')}`)
}

function commandStatus() {
    const sites = loadRuleSites()
    const budget = loadBudget(sites)
    const knowledge = readKnowledge()
    const observations = readObservations()
    const negatives = readNegatives()
    console.log(`仓库：${repoRoot}`)
    console.log(`数据：${auditRoot}`)
    console.log(`规则锚点：${sites.ruleCount} 条 offer 规则 + ${Object.keys(sites.synthetic).length} 个钩子（${sites.generatedAt}）`)
    console.log(`规则预算：基线 ${budget.baselineRules}，上限 ${budget.cap}，已新增 ${budget.adoptedNewRules}`)
    console.log(`已采纳 ${knowledge.adopted.length}，观察中 ${observations.items.length}，负样本 ${negatives.items.length}`)
    const runs = readdirSync(runsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length
    console.log(`运行目录：${runs} 个（${runsRoot}）`)
}

function help() {
    console.log(`用法：node scripts/audit/pipeline.mjs <命令> [参数]

  run       --games 200 --workers 4 [--seed 1000] [--stride 8] [--run <id>]
  screen    --run <id> [--ratio 0.07] [--max 20000] [--clusters 8]
  review    --run <id> [--clusters 6] [--evidence-games 200] [--workers 4] [--max-hits 12]
            [--llm-clusters 4] [--llm on|off] [--compact] [--model <name>] [--num-ctx 8192] [--max-tokens 800]
  apply     [--hypotheses <file>] [--dry-run] [--confidence medium]
  ab        --patch <patchId> | --veto <ruleId> [--games 500] [--workers 4] [--seed 1000]
  adopt     [--report <abDir>] [--force]
  observe   [--report <abDir>]
  reject    [--report <abDir>]
  report    --run <id>
  status

批处理说明：反事实归因把「多个簇 × 多个备选动作」合成一次子进程运行（每种子跑一局基线 + N 个干预），
不再按簇分批复跑；A/B 的处理组与对照组也合并到同一批座位里跑完，
送给模型的簇会被压到 --llm-clusters（默认 4）并裁剪示例，减少 token 消耗。

典型流程：
  node scripts/audit/pipeline.mjs run --games 200 --workers 4
  node scripts/audit/pipeline.mjs screen --run <id> --ratio 0.07
  node scripts/audit/pipeline.mjs review --run <id> --llm on
  node scripts/audit/pipeline.mjs apply --hypotheses ai-review/hypotheses/<file>.json
  node scripts/audit/pipeline.mjs ab --patch <patchId> --games 500
  node scripts/audit/pipeline.mjs adopt
  node scripts/audit/pipeline.mjs report --run <id>`)
}

async function main() {
    const [command, ...rest] = process.argv.slice(2)
    const flags = parseFlags(rest)
    if (!command || command === 'help' || command === '--help') {
        help()
        return
    }
    if (!COMMANDS.includes(command)) fail(`未知命令 ${command}`)
    ensureDirs()
    if (command === 'status') return commandStatus()
    if (command === 'run') return commandRun(flags)
    if (command === 'screen') return commandScreen(flags)
    if (command === 'review') return commandReview(flags)
    if (command === 'apply') return commandApply(flags)
    if (command === 'ab') return commandAb(flags)
    if (command === 'adopt' || command === 'observe' || command === 'reject') return commandKb(command, flags)
    if (command === 'report') return commandReport(flags)
}

main().catch((error) => {
    console.error(error.stack ?? error.message)
    process.exit(1)
})
