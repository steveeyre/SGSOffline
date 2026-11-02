import type { Request, Response } from 'express'

// 用 IPv4 回环地址：Node 的 fetch 解析 localhost 时可能走 ::1，而 Ollama 默认只监听 127.0.0.1
const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434'

const MODELS = {
    fast: process.env.OLLAMA_MODEL_FAST ?? 'qwen3.8-9b-distill:latest',
    deep: process.env.OLLAMA_MODEL_DEEP ?? 'qwen3.8-27b-ud-q3-k-xl:latest',
} as const

export type ModelTier = keyof typeof MODELS

const TIMEOUT_MS: Record<ModelTier, number> = { fast: 35000, deep: 60000 }
/** 让模型在内存里多留一会儿，避开每次首次调用的加载开销 */
const KEEP_ALIVE = '30m'

interface DecisionBody {
    tier?: string
    system?: string
    prompt?: string
}

export interface OllamaChatResult {
    tier: ModelTier
    model: string
    content: string
}

function pickTier(raw: unknown): ModelTier {
    return raw === 'deep' ? 'deep' : 'fast'
}

/** 调一次本地 Ollama 对话接口，要求模型输出单段 JSON */
export async function chatJson(tier: ModelTier, system: string, prompt: string): Promise<OllamaChatResult> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS[tier])
    try {
        const res = await fetch(`${OLLAMA_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
                model: MODELS[tier],
                stream: false,
                think: false,
                keep_alive: KEEP_ALIVE,
                format: 'json',
                options: { temperature: 0.2, top_p: 0.9, num_predict: 160 },
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: prompt },
                ],
            }),
        })
        if (!res.ok) throw new Error(`ollama http ${res.status}`)
        const data = await res.json() as { message?: { content?: string } }
        return { tier, model: MODELS[tier], content: data.message?.content ?? '' }
    } finally {
        clearTimeout(timer)
    }
}

/** 服务启动后异步把快模型加载进内存，避免开局第一次决策撞上冷启动 */
export async function warmupFastModel(): Promise<void> {
    try {
        await fetch(`${OLLAMA_URL}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: MODELS.fast, prompt: 'ping', stream: false, keep_alive: KEEP_ALIVE, options: { num_predict: 1 } }),
        })
        console.log(`[AI] warmed up ${MODELS.fast}`)
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.warn(`[AI] warmup skipped: ${message}`)
    }
}

/** POST /api/ai/decision：把局面摘要转给本地模型，返回它的决策 JSON 文本 */
export async function handleAiDecision(req: Request, res: Response): Promise<void> {
    const body = (req.body ?? {}) as DecisionBody
    const system = typeof body.system === 'string' ? body.system : ''
    const prompt = typeof body.prompt === 'string' ? body.prompt : ''
    if (!prompt) {
        res.status(400).json({ ok: false, error: 'missing prompt' })
        return
    }
    const tier = pickTier(body.tier)
    try {
        const result = await chatJson(tier, system, prompt)
        res.json({ ok: true, ...result })
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        res.status(502).json({ ok: false, tier, error: message })
    }
}

/** GET /api/ai/health：报告 Ollama 是否可达以及可用模型 */
export async function handleAiHealth(_req: Request, res: Response): Promise<void> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 2500)
    try {
        const upstream = await fetch(`${OLLAMA_URL}/api/tags`, { signal: controller.signal })
        if (!upstream.ok) throw new Error(`ollama http ${upstream.status}`)
        const data = await upstream.json() as { models?: Array<{ name?: string }> }
        const installed = (data.models ?? []).map(m => m.name ?? '').filter(Boolean)
        const missing = Object.values(MODELS).filter(m => !installed.includes(m))
        res.json({ ok: missing.length === 0, models: MODELS, installed, missing })
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        res.status(502).json({ ok: false, models: MODELS, error: message })
    } finally {
        clearTimeout(timer)
    }
}
