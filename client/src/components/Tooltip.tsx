import { useState, useRef, useCallback, useEffect } from 'react'
import { CARD_TOOLTIP, NO_TOOLTIP_CARDS } from '../data/tooltipData'
import { getGeneralById, getSkillDefById } from '../engine/generals'
import type { GeneralDefinition } from 'sgs3v3-shared'

// ── 通用 Tooltip state hook ──

interface TooltipState {
    visible: boolean
    x: number
    y: number
    /** 可用区域，提示坐标已换算到该区域左上角为原点 */
    maxX: number
    maxY: number
    content: { title: string; items: { name: string; desc: string }[] } | null
}

/**
 * 左右手对弈时同一窗口里有两个对局界面，提示跟随鼠标时必须减去所在界面的偏移，
 * 否则右（下）半屏的提示会跑到屏幕外或错位。
 */
function measureAnchor(el: Element | null, clientX: number, clientY: number) {
    // 左右手对弈的部署分屏里，提示也应落在自己这一屏的坐标系内
    const page = el?.closest('.hotseat-pane .pick-page') ?? el?.closest('.game-page')
    if (!page) return { x: clientX, y: clientY, maxX: window.innerWidth, maxY: window.innerHeight }
    const rect = page.getBoundingClientRect()
    return { x: clientX - rect.left, y: clientY - rect.top, maxX: rect.width, maxY: rect.height }
}

export function useTooltip(delay = 1500) {
    const [tooltip, setTooltip] = useState<TooltipState>({ visible: false, x: 0, y: 0, maxX: 0, maxY: 0, content: null })
    const timerRef = useRef<number | null>(null)
    const posRef = useRef({ x: 0, y: 0, maxX: 0, maxY: 0 })

    const clear = useCallback(() => {
        if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
        setTooltip(prev => prev.visible ? { ...prev, visible: false } : prev)
    }, [])

    const onEnter = useCallback((
        e: React.MouseEvent,
        content: { title: string; items: { name: string; desc: string }[] }
    ) => {
        posRef.current = measureAnchor(e.currentTarget, e.clientX, e.clientY)
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = window.setTimeout(() => {
            setTooltip({ visible: true, ...posRef.current, content })
        }, delay)
    }, [delay])

    const onMove = useCallback((e: React.MouseEvent) => {
        posRef.current = measureAnchor(e.currentTarget, e.clientX, e.clientY)
        // 如果已经显示则实时跟踪位置
        setTooltip(prev => prev.visible ? { ...prev, ...posRef.current } : prev)
    }, [])

    const onLeave = useCallback(() => { clear() }, [clear])

    // cleanup on unmount
    useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

    return { tooltip, onEnter, onMove, onLeave }
}

// ── 辅助函数 ──

/** 为武将生成 tooltip 内容（从 GeneralDefinition） */
export function generalTooltipContent(g: { name: string; skills: { name: string; description: string }[] }) {
    return {
        title: g.name,
        items: g.skills.map(s => ({ name: s.name, desc: s.description })),
    }
}

/** 按 generalId 查找武将技能生成 tooltip 内容（用于 GamePage） */
export function generalTooltipById(generalId: string, acquiredSkills: string[] = []) {
    // 觉醒后获得的技能不在原生技能列表里，需要追加展示
    const granted = acquiredSkills
        .map((id) => getSkillDefById(id))
        .filter((s): s is NonNullable<typeof s> => !!s)
        .map(s => ({ name: s.name, desc: s.description }))
    const withGranted = (items: { name: string; desc: string }[]) => [...items, ...granted]

    const def = getGeneralById(generalId)
    if (!def) return null
    return {
        title: def.name,
        items: withGranted(def.skills.map(s => ({ name: s.name, desc: s.description }))),
    }
}

/** 为游戏牌生成 tooltip 内容（基本牌返回 null） */
export function cardTooltipContent(cardName: string) {
    if (NO_TOOLTIP_CARDS.has(cardName)) return null
    const info = CARD_TOOLTIP[cardName]
    if (!info) return null
    return {
        title: info.name,
        items: [{ name: '', desc: info.desc }],
    }
}

// ── Tooltip 渲染组件 ──

export function TooltipBubble({ tooltip }: { tooltip: TooltipState }) {
    if (!tooltip.visible || !tooltip.content) return null

    // 计算位置：放在鼠标右上方，避免超出所在界面
    const style: React.CSSProperties = {
        position: 'fixed',
        left: Math.min(tooltip.x + 12, tooltip.maxX - 320),
        top: Math.max(tooltip.y - 20, 8),
        zIndex: 9999,
    }

    return (
        <div className="hover-tooltip" style={style}>
            <div className="hover-tooltip-title">{tooltip.content.title}</div>
            {tooltip.content.items.map((item, i) => (
                <div key={i} className="hover-tooltip-skill">
                    {item.name && <span className="hover-tooltip-skill-name">【{item.name}】</span>}
                    <span className="hover-tooltip-skill-desc">{item.desc}</span>
                </div>
            ))}
        </div>
    )
}
