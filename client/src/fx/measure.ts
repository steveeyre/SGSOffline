export type Pt = { x: number; y: number }
export type Box = { left: number; top: number; width: number; height: number }

/**
 * 元素相对指定根节点的盒子。所有动效坐标都以 .game-main 为原点，
 * 避免同屏双界面（左右手对弈）时用视口坐标导致两边错位。
 */
export function boxIn(el: Element | null | undefined, root: Element | null | undefined): Box | null {
    if (!el) return null
    const r = el.getBoundingClientRect()
    const base = root ? root.getBoundingClientRect() : null
    return {
        left: base ? r.left - base.left : r.left,
        top: base ? r.top - base.top : r.top,
        width: r.width,
        height: r.height,
    }
}

export function centerIn(el: Element | null | undefined, root: Element | null | undefined): Pt | null {
    const b = boxIn(el, root)
    return b ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null
}

/** 二次贝塞尔：控制点沿法线外扩，避免连线穿过桌面正中 */
export function curve(a: Pt, b: Pt, bow = 0.18): { d: string; mid: Pt } {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    const c = {
        x: (a.x + b.x) / 2 + (-dy / len) * len * bow,
        y: (a.y + b.y) / 2 + (dx / len) * len * bow,
    }
    return {
        d: `M ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`,
        mid: { x: 0.25 * a.x + 0.5 * c.x + 0.25 * b.x, y: 0.25 * a.y + 0.5 * c.y + 0.25 * b.y },
    }
}
