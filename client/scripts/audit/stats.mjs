/**
 * 成对胜负统计：McNemar 精确检验 + 分层 bootstrap 置信区间。
 * 不引入第三方依赖；随机源是本地 mulberry32，避免污染引擎种子。
 */

export function mulberry32(seed) {
    let a = seed >>> 0
    return function next() {
        a = (a + 0x6d2b79f5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const LOG2 = Math.log(2)
const logFactCache = [0, 0]
function logFact(n) {
    for (let i = logFactCache.length; i <= n; i++) logFactCache[i] = logFactCache[i - 1] + Math.log(i)
    return logFactCache[n]
}

export function logChoose(n, k) {
    if (k < 0 || k > n) return -Infinity
    return logFact(n) - logFact(k) - logFact(n - k)
}

/** 二项分布双侧精确 p 值：2 * P(X <= min(k, n-k)) */
export function binomialTwoSided(k, n) {
    if (n <= 0) return 1
    const tail = Math.min(k, n - k)
    let sum = 0
    for (let i = 0; i <= tail; i++) {
        sum += Math.exp(logChoose(n, i) - n * LOG2)
    }
    return Math.min(1, 2 * sum)
}

/** McNemar 精确检验，b/c 为两个方向的失配对数 */
export function mcnemarExact(b, c) {
    return binomialTwoSided(Math.min(b, c), b + c)
}

export function wilson(success, total, z = 1.96) {
    if (total <= 0) return { p: 0, low: 0, high: 1 }
    const p = success / total
    const denom = 1 + (z * z) / total
    const centre = p + (z * z) / (2 * total)
    const spread = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))
    return {
        p,
        low: Math.max(0, (centre - spread) / denom),
        high: Math.min(1, (centre + spread) / denom),
    }
}

export function mean(values) {
    if (values.length === 0) return 0
    return values.reduce((sum, value) => sum + value, 0) / values.length
}

function percentile(sorted, q) {
    if (sorted.length === 0) return 0
    const pos = (sorted.length - 1) * q
    const low = Math.floor(pos)
    const high = Math.ceil(pos)
    if (low === high) return sorted[low]
    return sorted[low] + (sorted[high] - sorted[low]) * (pos - low)
}

/**
 * 按种子配对的胜率差：
 * treatBySeed/ctrlBySeed: Map<seed, 焦点方在该种子两局中的胜场数(0..2)>
 */
export function pairedComparison(treatBySeed, ctrlBySeed, { bootstrapIters = 4000, seed = 20260101 } = {}) {
    const seeds = [...treatBySeed.keys()].filter((s) => ctrlBySeed.has(s)).sort((a, b) => a - b)
    let treatWins = 0
    let ctrlWins = 0
    let games = 0
    const diffs = []
    let b = 0
    let c = 0
    for (const s of seeds) {
        const t = treatBySeed.get(s)
        const k = ctrlBySeed.get(s)
        treatWins += t
        ctrlWins += k
        games += 2
        diffs.push((t - k) / 2)
        if (t > k) b++
        else if (t < k) c++
    }
    const treatRate = games ? treatWins / games : 0
    const ctrlRate = games ? ctrlWins / games : 0
    const diff = treatRate - ctrlRate
    const random = mulberry32(seed)
    const samples = []
    for (let i = 0; i < bootstrapIters; i++) {
        let sum = 0
        for (let j = 0; j < diffs.length; j++) {
            sum += diffs[Math.floor(random() * diffs.length)]
        }
        samples.push(diffs.length ? sum / diffs.length : 0)
    }
    samples.sort((x, y) => x - y)
    return {
        seeds: seeds.length,
        games,
        treatWins,
        ctrlWins,
        treatRate,
        ctrlRate,
        diff,
        ci: [percentile(samples, 0.025), percentile(samples, 0.975)],
        discordant: { b, c },
        pValue: mcnemarExact(b, c),
        treatWilson: wilson(treatWins, games),
    }
}

/** 单组胜率（用于 veto 负对照） */
export function rateSummary(wins, games) {
    return { wins, games, rate: games ? wins / games : 0, ...wilson(wins, games) }
}

export function fmtPct(value) {
    return `${(value * 100).toFixed(1)}%`
}

export function verdictOf({ diff, ci, pValue, discordant }, { minGain = 0.02, alpha = 0.05 } = {}) {
    // 逐局结果完全相同：补丁没有改变任何一局胜负，不能算「观察」，也不能算「无效」
    if (discordant && discordant.b + discordant.c === 0) return 'inconclusive'
    if (pValue < alpha && diff <= -minGain) return 'reject'
    if (pValue < alpha && diff >= minGain && ci[0] > 0) return 'adopt'
    if (diff > 0) return 'observe'
    return 'observe'
}
