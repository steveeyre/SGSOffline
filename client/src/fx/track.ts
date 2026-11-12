import { getLocalPace } from '../engine/local-dispatch'

let reduced: boolean | null = null

function prefersReducedMotion(): boolean {
    if (reduced === null) {
        reduced = typeof window !== 'undefined'
            && typeof window.matchMedia === 'function'
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    }
    return reduced
}

/** pace 为 0（瞬时结算）或系统关闭动效时，一律不出动画 */
export function fxEnabled(): boolean {
    return getLocalPace() > 0 && !prefersReducedMotion()
}

function scaled(base: number): number {
    return fxEnabled() ? base : 0
}

type PlayOptions = {
    ms: number
    ease?: string
    delay?: number
    fill?: FillMode
}

/** 播放一段 WAAPI 动画并等待结束；被取消或被跳过都不会抛错 */
export async function play(
    el: Element,
    keyframes: Keyframe[] | PropertyIndexedKeyframes,
    opts: PlayOptions,
): Promise<void> {
    const duration = scaled(opts.ms)
    if (duration <= 0) return
    const anim = el.animate(keyframes, {
        duration,
        delay: opts.delay ? scaled(opts.delay) : 0,
        easing: opts.ease,
        fill: opts.fill ?? 'none',
    })
    try {
        await anim.finished
    } catch {
        // 元素被移除或动画被取消
    }
}

export function wait(base: number): Promise<void> {
    const d = scaled(base)
    if (d <= 0) return Promise.resolve()
    return new Promise((resolve) => window.setTimeout(resolve, d))
}

export function staggerDelay(index: number, base: number): number {
    return scaled(index * base)
}
