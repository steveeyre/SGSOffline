/**
 * 本地 LLM 复盘客户端（Ollama）。
 * 只负责：拼提示词、调用 /api/chat、解析并校验规则假设。
 */

export const llmConfig = {
    url: process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434',
    model: process.env.OLLAMA_MODEL_REVIEW ?? process.env.OLLAMA_MODEL_DEEP ?? 'qwen3.8-27b-ud-q3-k-xl:latest',
    timeoutMs: Number(process.env.OLLAMA_REVIEW_TIMEOUT_MS ?? 900000),
    // 复盘提示词含词表+簇数据，实测约 6k token；上下文给小了 Ollama 会直接 400，给太大可能撑爆显存
    numCtx: Number(process.env.OLLAMA_REVIEW_NUM_CTX ?? 8192),
    numPredict: Number(process.env.OLLAMA_REVIEW_NUM_PREDICT ?? 800),
    // 批处理会连续发多次请求，让模型常驻显存，避免每批重新加载
    keepAlive: process.env.OLLAMA_REVIEW_KEEP_ALIVE ?? '20m',
}

export async function pingOllama() {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 4000)
    try {
        const response = await fetch(`${llmConfig.url}/api/tags`, { signal: controller.signal })
        if (!response.ok) return { ok: false, reason: `HTTP ${response.status}`, models: [] }
        const data = await response.json()
        return { ok: true, models: (data.models ?? []).map((item) => item.name) }
    } catch (error) {
        return { ok: false, reason: error.message, models: [] }
    } finally {
        clearTimeout(timer)
    }
}

export function estimateTokens(text) {
    // 中文约 1.6 字/token，JSON 与英文约 3.5 字符/token，取偏保守的混合估法
    return Math.ceil(String(text ?? '').length / 2.2)
}

export async function chatJson({ system, prompt, model = llmConfig.model, numPredict = llmConfig.numPredict, temperature = 0.2, numCtx = llmConfig.numCtx }) {
    const ctxLadder = [numCtx, Math.max(4096, Math.floor(numCtx / 2))]
    const fatal = (message) => Object.assign(new Error(message), { fatal: true })
    let lastError
    outer: for (const ctx of ctxLadder) {
        const body = {
            model,
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: prompt },
            ],
            stream: false,
            format: 'json',
            keep_alive: llmConfig.keepAlive,
            options: { temperature, top_p: 0.9, num_predict: numPredict, num_ctx: ctx },
        }
        for (let attempt = 0; attempt < 2; attempt++) {
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), llmConfig.timeoutMs)
            try {
                const response = await fetch(`${llmConfig.url}/api/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                    signal: controller.signal,
                })
                if (!response.ok) {
                    const detail = (await response.text().catch(() => '')).slice(0, 300)
                    // 上下文不够时重试无意义，直接交给上层报错
                    if (/context size/i.test(detail)) throw fatal(`HTTP ${response.status} ${detail}`)
                    throw new Error(`HTTP ${response.status} ${detail}`)
                }
                const data = await response.json()
                const content = data.message?.content ?? ''
                if (data.done_reason === 'length') {
                    throw fatal(`模型输出被 max-tokens 截断（当前 ${numPredict}），调大 --max-tokens 后重试`)
                }
                return content
            } catch (error) {
                lastError = error
                if (error.fatal) break outer
                await new Promise((resolve) => setTimeout(resolve, 800))
            } finally {
                clearTimeout(timer)
            }
        }
    }
    const hint = /context size/i.test(lastError?.message ?? '')
        ? '（提示：模型上下文不够。改用 --compact 精简提示词，或换支持更大上下文的模型）'
        : /fetch failed/i.test(lastError?.message ?? '')
            ? '（提示：Ollama 进程可能在加载大上下文时退出。用 --num-ctx 4096 --max-tokens 600 重试，或换更小的模型）'
            : ''
    throw new Error(`本地模型调用失败：${lastError?.message ?? '未知错误'}${hint}`)
}

const SYSTEM_PROMPT = `你是《三国杀》3v3 单机 AI 的复盘器。你的输出会直接转成规则补丁，因此必须严格、可执行、可验证。
只输出一个 JSON 对象，不要解释、不要 Markdown、不要代码围栏。`

function trimCandidates(candidates = [], limit = 6) {
    return [...candidates]
        .sort((a, b) => (b.final ?? b.score ?? 0) - (a.final ?? a.score ?? 0))
        .slice(0, limit)
        .map((candidate) => ({
            ruleId: candidate.ruleId,
            score: candidate.score,
            final: candidate.final ?? null,
            chosen: !!candidate.chosen,
        }))
}

const PROMPT_FEATURES = ['my_hp', 'cmd_hp', 'enemy_cmd_hp', 'enemy_cmd_hand', 'enemy_cmd_armor', 'slash', 'dodge', 'peach', 'deck_left', 'under_threat', 'kill_window', 'round']

function trimExample(example, compact = false) {
    const feats = {}
    for (const name of PROMPT_FEATURES) feats[name] = example.feats?.[name] ?? null
    return {
        seed: example.seed,
        decisionIndex: example.decisionIndex,
        ruleId: example.ruleId,
        generalId: example.generalId,
        candidates: compact
            ? trimCandidates(example.candidates, 4).filter((item) => item.chosen || item.score > 0)
            : trimCandidates(example.candidates),
        feats,
        outcome: example.outcome?.winner ?? null,
    }
}

/** 收集谓词里引用到的特征名，用于只解释本批次真正用到的字段 */
export function featureNamesIn(predicate, acc = new Set()) {
    if (!predicate || typeof predicate !== 'object') return acc
    if (Array.isArray(predicate.all)) {
        for (const item of predicate.all) featureNamesIn(item, acc)
        return acc
    }
    if (Array.isArray(predicate.any)) {
        for (const item of predicate.any) featureNamesIn(item, acc)
        return acc
    }
    if (predicate.not !== undefined) {
        if (typeof predicate.not === 'string') acc.add(predicate.not)
        else featureNamesIn(predicate.not, acc)
        return acc
    }
    if (Array.isArray(predicate.cmp)) acc.add(predicate.cmp[0])
    if (Array.isArray(predicate.in)) acc.add(predicate.in[0])
    return acc
}

/** 反事实证据只保留判断所需的字段，避免整块 JSON 撑大提示词 */
function briefEvidence(evidence) {
    if (!evidence) return null
    return {
        supported: !!evidence.supported,
        alternative: evidence.alternative ?? null,
        delta: evidence.delta ?? null,
        pValue: evidence.pValue ?? null,
        flips: evidence.flips ?? null,
        appliedSeeds: evidence.appliedSeeds ?? evidence.seeds ?? null,
        reason: evidence.supported ? undefined : evidence.reason,
    }
}

/** 单个簇送进提示词的最小载荷；批处理估算 token 时复用同一函数 */
export function clusterPayloadOf(cluster, { compact = false, exampleLimit = null, withEvidence = true } = {}) {
    const limit = exampleLimit ?? (compact ? 1 : 2)
    return {
        key: cluster.key,
        kind: cluster.kind,
        ruleId: cluster.ruleId,
        faction: cluster.faction,
        size: cluster.size,
        lossShare: cluster.lossShare,
        candidatePredicate: cluster.predicate,
        alternatives: (cluster.alternatives ?? []).slice(0, compact ? 2 : 3),
        ...(withEvidence ? { counterfactual: briefEvidence(cluster.evidence) } : {}),
        examples: (cluster.examples ?? []).slice(0, limit).map((example) => trimExample(example, compact)),
    }
}

export function buildReviewPrompt({
    runId, clusters, features, thresholds, thresholdSpecs = null, ruleIds, negatives = [], ruleStats = [], budget, minGain = 0.02, compact = false,
}) {
    // 只解释本批次谓词真正用到的字段 + 复盘常用的几个，词表从 30+ 行压到 10 行左右
    const usedFeatures = new Set(PROMPT_FEATURES)
    for (const cluster of clusters) featureNamesIn(cluster.predicate, usedFeatures)
    const vocabulary = features
        .filter((spec) => !compact || usedFeatures.has(spec.name))
        .map((spec) => `${spec.name}(${spec.type})${spec.desc ? `：${spec.desc}` : ''}`)
        .join('；')
    const clusterPayload = clusters.map((cluster) => clusterPayloadOf(cluster, {
        compact,
        exampleLimit: compact ? 1 : 2,
    }))
    const negativeText = negatives.length
        ? negatives.slice(-8).map((item) => `- ${item.id}: ${item.triggerText ?? ''} → ${item.note ?? '已验证为负收益'}`).join('\n')
        : '（暂无）'
    const nonPlay = new Set(['respond', 'negate', 'unit', 'discard', 'draft', 'skill', 'unknown'])
    const ruleValueText = !compact && ruleStats.length
        ? ruleStats
            .filter((stat) => !nonPlay.has(stat.site) && !String(stat.site).includes(':'))
            .slice(0, 20)
            .map((stat) => `- ${stat.ruleId}: n=${stat.n} 败率=${(stat.lossRate * 100).toFixed(1)}% 相对基线败率差=${(stat.delta * 100).toFixed(1)}%`)
            .join('\n') || '（暂无）'
        : '（暂无）'
    const prompt = `## 任务
输入是规则式 PC 自对弈 + 统计筛选 + 反事实重放得到的「高嫌疑错手簇」。每个簇给一条可转成代码的规则假设；证据不足就标 confidence=low，只有该簇明确与规则无关时才跳过。宁可给低置信度假设交给 A/B 淘汰，也不要空手。

## 局面谓词词表（只能用这些字段）
${vocabulary}

## 谓词语法
- {"cmp":["特征","<="|">="|"<"|">"|"=="|"!=",数值或布尔]}
- {"all":[谓词...]} / {"any":[谓词...]} / {"not":谓词}；布尔特征可简写 {"not":"enemy_cmd_armor"}
- 布尔只与 true/false 比较，数值只与数字比较

## 可用规则 id
${ruleIds.join(',')}

## 修改类型
- guard：规则在某条件下有害 → 加前置否定（需 when）
- priority：两规则冲突/摇摆 → 调分数权重（需 target、delta，可选 when）
- fallback：所有规则都不适用 → 低分兜底（需 target、baseScore、when）
- threshold：阈值不准 → 调整具名阈值的绝对值（当前 ${(thresholdSpecs ?? thresholds.map((name) => ({ name, value: '?' }))).map((item) => `${item.name}=${item.value}`).join('，')}）。PASS_SCORE 调小=更愿出低分牌（治空过），调大=更易空过；NEGATE_THRESHOLD 调小=更愿无懈
- veto：规则整体为负 → 停用（需 target）

## 示例
{"hypotheses":[{"id":"h1","cluster":"play/PASS/low|low|noarmor|threat|nokill|fewcards","trigger":{"all":[{"cmp":["enemy_cmd_hp","<=",2]},{"not":"enemy_cmd_armor"}]},"currentBehavior":"规则 PASS 导致空过","suggestedBehavior":"优先借刀杀人","currentRule":"PASS","suggestedRule":"borrow_sword","evidence":["cf:seed=1003 Δ=+5%"],"confidence":"low","patch":{"type":"fallback","target":"borrow_sword","baseScore":24,"when":{"all":[{"cmp":["enemy_cmd_hp","<=",2]},{"not":"enemy_cmd_armor"}]}},"rationale":"空过等于让出节奏"}]}

## 硬性约束
1. 优先调参数/加否定条件；新增规则须在某高嫌疑簇上胜率提升 ≥ ${(minGain * 100).toFixed(0)}%。
2. 规则预算：基线 ${budget.baselineRules}、上限 ${budget.cap}、已新增 ${budget.adoptedNewRules}。
3. 只能引用输入里的反事实数值，不得编造。delta=改选后该阵营胜率变化；pValue=配对符号检验；flips=胜负翻转局数；appliedSeeds=改选真正生效局数。
4. 只有 kind=play 能被补丁验证，其他类别不要生成 patch。
5. delta=0 且 flips=0 不代表原动作正确；passCut 类簇仍可提 fallback，但 confidence 只能 low。
6. 已确认负收益，不要再提：
${negativeText}

## 输出（严格 JSON，无解释无围栏）
{"hypotheses":[{"id":"h1","cluster":"<输入 key>","trigger":{...},"currentBehavior":"规则 X 导致选择 A","suggestedBehavior":"应优先 B","currentRule":"X","suggestedRule":"Y","evidence":["cf:seed=1000 delta=+0.12"],"confidence":"high|medium|low","patch":{"type":"guard|veto|priority|fallback|threshold","target":"<ruleId>","when":{...},"delta":0,"baseScore":0,"name":"PASS_SCORE","value":0},"rationale":"一句话"}]}
patch 只填该类型需要的字段；target 不能是 PASS（PASS 不是规则）。「该动却空过」用 fallback + suggestedRule + baseScore(约 24) 表达。

## 输入（runId=${runId}）
${JSON.stringify({ clusters: clusterPayload })}${compact ? '' : `

## 出牌规则价值参考
${ruleValueText}`}`
    const tokens = estimateTokens(SYSTEM_PROMPT) + estimateTokens(prompt)
    return { system: SYSTEM_PROMPT, prompt, tokens }
}

export function parseHypotheses(text) {
    let raw = String(text ?? '').trim()
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (fence) raw = fence[1].trim()
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start < 0 || end <= start) throw new Error('模型输出里没有 JSON 对象')
    const parsed = JSON.parse(raw.slice(start, end + 1))
    const list = Array.isArray(parsed) ? parsed : parsed.hypotheses
    if (!Array.isArray(list)) throw new Error('模型输出缺少 hypotheses 数组')
    return list
}

const OPS = ['<=', '>=', '<', '>', '==', '!=']

export function validatePredicateJs(pred, features, path = 'trigger') {
    if (!pred || typeof pred !== 'object') return [`${path} 不是对象`]
    const keys = Object.keys(pred)
    if (keys.length !== 1) return [`${path} 必须恰好含一个操作符`]
    const op = keys[0]
    if (op === 'all' || op === 'any') {
        if (!Array.isArray(pred[op])) return [`${path}.${op} 必须是数组`]
        return pred[op].flatMap((item, index) => validatePredicateJs(item, features, `${path}.${op}[${index}]`))
    }
    if (op === 'not') {
        if (typeof pred.not === 'string') {
            return features.get(pred.not) === 'boolean' ? [] : [`${path}.not 引用了非布尔特征 ${pred.not}`]
        }
        return validatePredicateJs(pred.not, features, `${path}.not`)
    }
    if (op === 'cmp') {
        const [name, operator, value] = pred.cmp ?? []
        const type = features.get(name)
        const errors = []
        if (!type) return [`${path} 含未知特征 ${name}`]
        if (!OPS.includes(operator)) errors.push(`${path} 比较符非法 ${operator}`)
        if (type === 'boolean' && typeof value !== 'boolean') errors.push(`${path}.${name} 是布尔特征`)
        if (type === 'number' && typeof value !== 'number') errors.push(`${path}.${name} 是数值特征`)
        if ((pred.cmp ?? []).length !== 3) errors.push(`${path}.cmp 必须是三元组`)
        return errors
    }
    if (op === 'in') {
        const [name, values] = pred.in ?? []
        if (!features.get(name)) return [`${path} 含未知特征 ${name}`]
        if (!Array.isArray(values) || values.length === 0) return [`${path}.in 必须是非空数组`]
        return []
    }
    return [`${path} 含未知操作符 ${op}`]
}

/** 返回 { valid, errors }；errors 非空表示整条假设必须丢弃 */
export function validateHypothesis(hypothesis, { features, ruleIds, patchTargets = null, thresholds, minGain = 0.02 }) {
    const errors = []
    if (!hypothesis || typeof hypothesis !== 'object') return { valid: false, errors: ['假设不是对象'] }
    if (!hypothesis.id) errors.push('缺少 id')
    if (!hypothesis.cluster) errors.push('缺少 cluster')
    if (!['high', 'medium', 'low'].includes(hypothesis.confidence)) errors.push('confidence 必须是 high/medium/low')
    errors.push(...validatePredicateJs(hypothesis.trigger, features, 'trigger'))
    if (!ruleIds.includes(hypothesis.currentRule)) errors.push(`currentRule 不在规则表内：${hypothesis.currentRule}`)
    if (hypothesis.suggestedRule && !ruleIds.includes(hypothesis.suggestedRule)) {
        errors.push(`suggestedRule 不在规则表内：${hypothesis.suggestedRule}`)
    }
    const patch = hypothesis.patch
    if (!patch || typeof patch !== 'object') {
        errors.push('缺少 patch')
        return { valid: false, errors }
    }
    if (!['guard', 'veto', 'priority', 'fallback', 'threshold'].includes(patch.type)) {
        errors.push(`patch.type 非法：${patch.type}`)
    }
    if (patch.type === 'threshold') {
        if (!thresholds.includes(patch.name)) errors.push(`threshold.name 非法：${patch.name}`)
        if (typeof patch.value !== 'number') errors.push('threshold.value 必须是数字')
    } else {
        const targets = patchTargets ?? ruleIds
        if (!targets.includes(patch.target)) {
            errors.push(patch.target === 'PASS'
                ? 'patch.target 不能是 PASS：PASS 不是一条可打补丁的规则。若问题是「该动却空过」，请用 fallback 指定具体备选规则（如 suggestedRule）并给 baseScore'
                : `patch.target 不在可打补丁的出牌规则表内：${patch.target}`)
        }
        if (patch.type === 'priority' && typeof patch.delta !== 'number') errors.push('priority.delta 必须是数字')
        if (patch.type === 'fallback' && typeof patch.baseScore !== 'number') errors.push('fallback.baseScore 必须是数字')
        if ((patch.type === 'guard' || patch.type === 'fallback')) {
            errors.push(...validatePredicateJs(patch.when, features, 'patch.when'))
        }
        if (patch.type === 'priority' && patch.when) {
            errors.push(...validatePredicateJs(patch.when, features, 'patch.when'))
        }
    }
    const evidence = hypothesis.evidence
    if (!Array.isArray(evidence)) errors.push('evidence 必须是数组')
    return { valid: errors.length === 0, errors }
}

const CONFIDENCE_CN = { high: '高', medium: '中', low: '低' }

export function hypothesesMarkdown(hypotheses, meta) {
    const lines = [
        `# 规则假设 ${meta.runId ?? ''}`,
        '',
        `生成时间：${new Date().toISOString()}　模型：${meta.model ?? 'n/a'}　输入簇：${meta.clusterCount ?? hypotheses.length}`,
        '',
    ]
    for (const item of hypotheses) {
        const h = item.hypothesis
        const status = item.valid ? '通过校验' : `校验失败：${item.errors.join('；')}`
        lines.push(`## ${h.id}　${status}`)
        lines.push('')
        lines.push(`- **触发条件**：${meta.describePredicate ? meta.describePredicate(h.trigger) : JSON.stringify(h.trigger)}`)
        lines.push(`- **当前 PC 行为**：${h.currentBehavior ?? '（未填写）'}（规则 ${h.currentRule ?? '?'}）`)
        lines.push(`- **建议行为**：${h.suggestedBehavior ?? '（未填写）'}（建议规则 ${h.suggestedRule ?? '?'}）`)
        lines.push(`- **证据**：${(h.evidence ?? []).join('；') || '（未提供）'}`)
        lines.push(`- **置信度**：${CONFIDENCE_CN[h.confidence] ?? h.confidence ?? '?'}`)
        if (h.patch) {
            lines.push(`- **补丁**：${h.patch.type} → ${h.patch.target ?? h.patch.name}` +
                (h.patch.delta !== undefined ? `，delta=${h.patch.delta}` : '') +
                (h.patch.baseScore !== undefined ? `，baseScore=${h.patch.baseScore}` : '') +
                (h.patch.value !== undefined ? `，value=${h.patch.value}` : ''))
        }
        if (h.rationale) lines.push(`- **理由**：${h.rationale}`)
        lines.push('')
    }
    return lines.join('\n')
}
