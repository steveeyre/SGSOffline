/**
 * 复盘收集：把界面上点中的日志 ID 复制到剪贴板，并记进本机复盘清单。
 * 清单只保存 ID，不复制对局数据；真正的上下文由导出的对局日志提供。
 */

import { readStorageItem, removeStorageItem } from './storage-keys'

const REVIEW_QUEUE_KEY = 'sgsoffline.reviewQueue.v1'
const MAX_QUEUE = 100

export interface ReviewMark {
    id: string
    at: number
}

function safeStorage(): Storage | null {
    try {
        return typeof localStorage !== 'undefined' ? localStorage : null
    } catch {
        return null
    }
}

export function getReviewQueue(): ReviewMark[] {
    const store = safeStorage()
    if (!store) return []
    try {
        const parsed = JSON.parse(readStorageItem(store, REVIEW_QUEUE_KEY) ?? '[]')
        if (!Array.isArray(parsed)) return []
        return parsed.filter((m): m is ReviewMark => typeof m?.id === 'string')
    } catch {
        return []
    }
}

/** 同一 ID 只保留最新一条，避免反复点击把清单撑满 */
export function pushReviewId(id: string): ReviewMark[] {
    const next = [{ id, at: Date.now() }, ...getReviewQueue().filter((m) => m.id !== id)].slice(0, MAX_QUEUE)
    try {
        safeStorage()?.setItem(REVIEW_QUEUE_KEY, JSON.stringify(next))
    } catch {
        // 存储不可用时仍然返回内存结果，界面上的计数照常更新
    }
    return next
}

export function clearReviewQueue(): void {
    const store = safeStorage()
    if (store) removeStorageItem(store, REVIEW_QUEUE_KEY)
}

/** 只保留属于本局的 ID：换局后旧清单不该再带进来 */
export function pruneReviewQueue(matchId: string): ReviewMark[] {
    const all = getReviewQueue()
    const keep = all.filter((m) => m.id === matchId || m.id.startsWith(`${matchId}.`))
    if (keep.length !== all.length) {
        try {
            safeStorage()?.setItem(REVIEW_QUEUE_KEY, JSON.stringify(keep))
        } catch {
            // 存储不可用时只影响本局清单，界面计数仍按返回值更新
        }
    }
    return keep
}

/** 优先用异步剪贴板 API；file:// 等非安全上下文回退到 execCommand */
export async function copyText(text: string): Promise<boolean> {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(text)
            return true
        } catch {
            // 落到下面的兜底
        }
    }
    if (typeof document === 'undefined') return false
    try {
        const area = document.createElement('textarea')
        area.value = text
        area.setAttribute('readonly', '')
        area.style.position = 'fixed'
        area.style.top = '-1000px'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(area)
        return ok
    } catch {
        return false
    }
}
