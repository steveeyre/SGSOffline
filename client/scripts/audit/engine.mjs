/**
 * 引擎侧执行器：把 src/engine/_audit.ts 打成 CJS，按 spec 分片并行跑，再合并 JSONL。
 * 每个分片是独立进程，因此全局 RNG 互不干扰。
 */
import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import {
    existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const clientDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const repoRoot = resolve(clientDir, '..')
export const auditRoot = join(repoRoot, 'ai-review')
export const runsRoot = join(auditRoot, 'runs')
export const patchesRoot = join(auditRoot, 'patches')
export const promptsRoot = join(auditRoot, 'prompts')
export const hypothesesRoot = join(auditRoot, 'hypotheses')
export const stateRoot = join(auditRoot, 'state')

const BUNDLE = join(clientDir, 'node_modules', '.cache', '_audit.cjs')

export function ensureDirs() {
    for (const dir of [auditRoot, runsRoot, patchesRoot, promptsRoot, hypothesesRoot, stateRoot]) {
        mkdirSync(dir, { recursive: true })
    }
}

/**
 * 打包审计 bundle。
 *
 * 必须走「写临时文件 → 原子改名」：两条流水线（或多个 agent）同时跑时，直接写同一个
 * outfile 会让另一方的子进程读到写了一半的 CJS，报出 `SyntaxError: Invalid or unexpected
 * token` 或 `ReferenceError: xxx is not defined` 这类假崩溃，并把 failures 计进统计。
 */
export async function ensureBundle() {
    mkdirSync(dirname(BUNDLE), { recursive: true })
    const temp = `${BUNDLE}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`
    await build({
        entryPoints: [join(clientDir, 'src/engine/_audit.ts')],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        loader: { '.css': 'empty' },
        outfile: temp,
        logLevel: 'warning',
    })
    try {
        renameSync(temp, BUNDLE)
        return BUNDLE
    } catch {
        // Windows 上目标可能正被其他进程打开；临时文件本身是完整的，直接用它。
        return temp
    }
}

export function readJsonl(path) {
    if (!existsSync(path)) return []
    const text = readFileSync(path, 'utf8').trim()
    if (!text) return []
    const out = []
    for (const line of text.split('\n')) {
        if (!line.trim()) continue
        try {
            out.push(JSON.parse(line))
        } catch {
            // 崩溃残留的半行，跳过
        }
    }
    return out
}

export function writeJson(path, value) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

export function readJson(path, fallback = null) {
    if (!existsSync(path)) return fallback
    try {
        return JSON.parse(readFileSync(path, 'utf8'))
    } catch {
        return fallback
    }
}

export function appendJsonl(path, items) {
    mkdirSync(dirname(path), { recursive: true })
    const text = items.map((item) => JSON.stringify(item)).join('\n')
    writeFileSync(path, text + (text ? '\n' : ''), { flag: 'a' })
}

function runProcess(bundle, specPath, label) {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(process.execPath, [bundle, specPath], { stdio: ['ignore', 'pipe', 'pipe'] })
        let tail = ''
        child.stdout.on('data', (chunk) => {
            const text = chunk.toString()
            tail = (tail + text).slice(-4000)
            process.stdout.write(`[${label}] ${text}`)
        })
        child.stderr.on('data', (chunk) => {
            process.stderr.write(`[${label}] ${chunk}`)
        })
        child.on('error', rejectPromise)
        child.on('close', (code) => {
            if (code === 0) return resolvePromise()
            // 单局卡死会让 _audit 以非 0 退出，但 summary.json 已落盘；
            // 此时按批次完成处理，失败局计入 failures，而不是中止整批审计。
            try {
                const spec = JSON.parse(readFileSync(specPath, 'utf8'))
                if (spec.outDir && existsSync(join(spec.outDir, 'summary.json'))) return resolvePromise()
            } catch {
                // 读不到 spec 时按真正的进程失败处理
            }
            rejectPromise(new Error(`${label} 退出码 ${code}\n${tail}`))
        })
    })
}

function shardSeeds(seeds, count) {
    const shards = Array.from({ length: count }, () => [])
    seeds.forEach((seed, index) => shards[index % count].push(seed))
    return shards.filter((shard) => shard.length > 0)
}

const MERGED_FILES = ['games.jsonl', 'decisions.jsonl', 'ab.jsonl', 'counterfactual.jsonl']

/**
 * 按 spec 跑一批种子，结果合并进 runDir。
 * spec 里不要带 seeds/outDir，由本函数分配。
 */
export async function runEngineBatch({ runDir, spec, seeds, workers = 1, stage = 'run' }) {
    ensureDirs()
    mkdirSync(runDir, { recursive: true })
    const bundle = await ensureBundle()
    const shardDir = join(runDir, '_shards', stage)
    if (existsSync(shardDir)) rmSync(shardDir, { recursive: true, force: true })
    mkdirSync(shardDir, { recursive: true })
    const count = Math.max(1, Math.min(workers, seeds.length))
    const shards = shardSeeds(seeds, count)

    for (const name of MERGED_FILES) {
        const target = join(runDir, `${stage}-${name}`)
        if (existsSync(target)) rmSync(target, { force: true })
    }

    await Promise.all(shards.map(async (seedList, index) => {
        const label = `${stage}-${index}`
        const shardOut = join(shardDir, label)
        const specPath = join(shardDir, `${label}.json`)
        writeFileSync(specPath, JSON.stringify({
            ...spec,
            runId: `${spec.runId}-${label}`,
            seeds: seedList,
            outDir: shardOut,
        }, null, 2))
        await runProcess(bundle, specPath, label)
    }))

    const merged = {}
    for (const name of MERGED_FILES) {
        const base = name.replace(/\.jsonl$/, '')
        const target = join(runDir, `${stage}-${name}`)
        const rows = []
        shards.forEach((_, index) => {
            rows.push(...readJsonl(join(shardDir, `${stage}-${index}`, name)))
        })
        if (rows.length) {
            writeFileSync(target, rows.map((row) => JSON.stringify(row)).join('\n') + '\n')
        }
        merged[base] = target
    }

    const summaries = shards.map((_, index) => readJson(join(shardDir, `${stage}-${index}`, 'summary.json'), null))
        .filter(Boolean)
    const total = summaries.reduce((acc, item) => {
        for (const key of ['games', 'warmWins', 'coolWins', 'draws', 'failures', 'variantWins', 'variantLosses', 'variantDraws', 'flips']) {
            acc[key] = (acc[key] ?? 0) + (item[key] ?? 0)
        }
        acc.errors.push(...(item.errors ?? []))
        return acc
    }, { errors: [] })
    const variantStats = { rules: {}, thresholds: {} }
    for (const item of summaries) {
        for (const side of ['rules', 'thresholds']) {
            for (const [key, value] of Object.entries(item.variantStats?.[side] ?? {})) {
                variantStats[side][key] = (variantStats[side][key] ?? 0) + value
            }
        }
    }
    return { ...total, variantStats, summaries }
}

export async function fetchDescribe() {
    ensureDirs()
    const bundle = await ensureBundle()
    const specPath = join(stateRoot, '.describe-spec.json')
    writeJson(specPath, { mode: 'describe' })
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(process.execPath, [bundle, specPath], { stdio: ['ignore', 'pipe', 'pipe'] })
        let out = ''
        let err = ''
        child.stdout.on('data', (chunk) => { out += chunk.toString() })
        child.stderr.on('data', (chunk) => { err += chunk.toString() })
        child.on('error', rejectPromise)
        child.on('close', (code) => {
            if (code !== 0) rejectPromise(new Error(`describe 失败：${err || code}`))
            else {
                try {
                    resolvePromise(JSON.parse(out))
                } catch (error) {
                    rejectPromise(new Error(`describe 输出无法解析：${error.message}`))
                }
            }
        })
    })
}

export function branchStamp() {
    return new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
}

export function dirSize(path) {
    if (!existsSync(path)) return 0
    let total = 0
    for (const entry of readdirSync(path, { withFileTypes: true })) {
        const full = join(path, entry.name)
        total += entry.isDirectory() ? dirSize(full) : statSync(full).size
    }
    return total
}
