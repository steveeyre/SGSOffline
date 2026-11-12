import { useEffect, useState } from 'react'
import { GeneralDefinition } from 'sgs3v3-shared'
import { GENERAL_IMAGE } from '../data/generalImages'
import { useTooltip, generalTooltipContent, TooltipBubble } from './Tooltip'
import './GeneralPicker.css'

interface GeneralPickerProps {
    open: boolean
    title: string
    pool: GeneralDefinition[]
    /** 场上已被选走的武将，置灰不可点 */
    usedIds: readonly string[]
    onPick: (generalId: string) => void
    onClose: () => void
}

/** 点将弹窗：按 generals.ts 定义顺序列出模式全池，支持按姓名检索 */
export function GeneralPicker({ open, title, pool, usedIds, onPick, onClose }: GeneralPickerProps) {
    const [query, setQuery] = useState('')
    const { tooltip, onEnter, onMove, onLeave } = useTooltip(400)

    useEffect(() => {
        if (!open) {
            setQuery('')
            return
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [open, onClose])

    if (!open) return null

    const used = new Set(usedIds)
    const keyword = query.trim()
    const list = keyword
        ? pool.filter((g) => g.name.includes(keyword) || g.id.includes(keyword))
        : pool

    return (
        <div className="gp-mask" onClick={onClose}>
            <div className="gp-panel" onClick={(e) => e.stopPropagation()}>
                <div className="gp-head">
                    <div className="gp-title">{title}</div>
                    <input
                        className="gp-search"
                        autoFocus
                        value={query}
                        placeholder="搜索武将姓名"
                        onChange={(e) => setQuery(e.target.value)}
                    />
                    <button className="btn btn-secondary gp-close" onClick={onClose}>关闭</button>
                </div>
                <div className="gp-grid">
                    {list.map((g) => {
                        const taken = used.has(g.id)
                        return (
                            <div
                                key={g.id}
                                className={`gp-card ${taken ? 'used' : 'selectable'}`}
                                onClick={() => {
                                    if (!taken) onPick(g.id)
                                }}
                                onMouseEnter={(e) => onEnter(e, generalTooltipContent(g))}
                                onMouseMove={onMove}
                                onMouseLeave={onLeave}
                            >
                                {GENERAL_IMAGE[g.id]
                                    ? <img
                                        src={GENERAL_IMAGE[g.id]}
                                        alt={g.name}
                                        className="gp-portrait" loading="lazy" decoding="async"
                                        onError={(e) => { e.currentTarget.style.display = 'none' }}
                                    />
                                    : <span className="gp-avatar">{g.name[0]}</span>}
                                <span className="gp-name">{g.name}</span>
                                <span className="gp-hp">{'♥'.repeat(Math.max(1, g.maxHp))}</span>
                                <span className="gp-skills">{g.skills.map((s) => s.name).join(' · ')}</span>
                                {taken && <span className="gp-taken">已被选</span>}
                            </div>
                        )
                    })}
                    {list.length === 0 && <div className="gp-empty">没有匹配的武将</div>}
                </div>
                <TooltipBubble tooltip={tooltip} />
            </div>
        </div>
    )
}
