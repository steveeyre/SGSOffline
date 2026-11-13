import { useEffect, useState, type ReactNode } from 'react'
import './HotseatSplit.css'

/**
 * 一个浏览器窗口跨两块拼接的显示器时，工具栏会把页面内容整体下移几十像素，
 * 两屏等分会让上半屏最底下的那一行（当前视角武将 + 技能按钮、手牌区）落到另一块屏幕上。
 * 这里按屏幕边界算出物理接缝，把分界线压到接缝上。
 */
function measureSplit(): number | null {
    const column = window.matchMedia('(max-aspect-ratio: 1/1)').matches
    const size = column ? window.innerHeight : window.innerWidth
    const scr = window.screen as Screen & { availTop?: number; availLeft?: number }
    const screenSize = column ? scr.height : scr.width
    const border = column ? window.outerHeight - window.innerHeight : window.outerWidth - window.innerWidth
    const windowStart = column ? window.screenY : window.screenX
    const screenStart = (column ? scr.availTop : scr.availLeft) ?? 0
    // 候选接缝：按窗口位置推算的屏幕边缘，以及「窗口正好跨两块等尺寸屏幕」时的值
    const seams = [screenStart + screenSize - windowStart - border, screenSize - border]
    for (const seam of seams) {
        // 接缝落在窗口中间才采用，单屏时（接缝贴着窗口边缘）保持等分
        if (seam > size * 0.3 && size - seam > size * 0.3) return Math.round(seam)
    }
    return null
}

/** 左右手对弈的双屏容器：暖方在上、冷方在下（或宽屏时左、右） */
export default function HotseatSplit({ warm, cool, warmLabel = '暖方', coolLabel = '冷方' }: {
    warm: ReactNode
    cool: ReactNode
    warmLabel?: string
    coolLabel?: string
}) {
    const [firstPaneSize, setFirstPaneSize] = useState<number | null>(() => measureSplit())

    useEffect(() => {
        const update = () => setFirstPaneSize(measureSplit())
        window.addEventListener('resize', update)
        return () => window.removeEventListener('resize', update)
    }, [])

    return (
        <div className="hotseat-split">
            <div className="hotseat-pane" style={firstPaneSize ? { flex: `0 0 ${firstPaneSize}px` } : undefined}>
                <div className="hotseat-pane-label warm">{warmLabel}<span className="hotseat-pane-side" /></div>
                {warm}
            </div>
            <div className="hotseat-pane">
                <div className="hotseat-pane-label cool">{coolLabel}<span className="hotseat-pane-side" /></div>
                {cool}
            </div>
        </div>
    )
}
