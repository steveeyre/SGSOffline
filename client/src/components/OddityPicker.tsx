import { useEffect, useState } from 'react'
import { OddityOption } from 'sgs3v3-shared'
import './GeneralPicker.css'
import './OddityPicker.css'

interface OddityPickerProps {
    open: boolean
    title: string
    pool: OddityOption[]
    /** 已被其他席位选走的奇技 */
    usedIds: readonly string[]
    onPick: (skillId: string) => void
    onClose: () => void
}

/** 奇技任选弹窗：列出全部奇技，支持按技能名或来源武将检索 */
export function OddityPicker({ open, title, pool, usedIds, onPick, onClose }: OddityPickerProps) {
    const [query, setQuery] = useState('')

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
        ? pool.filter((o) => o.skillName.includes(keyword) || o.sourceGeneralName.includes(keyword))
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
                        placeholder="搜索技能名或武将名"
                        onChange={(e) => setQuery(e.target.value)}
                    />
                    <button className="btn btn-secondary gp-close" onClick={onClose}>关闭</button>
                </div>
                <div className="gp-grid op-grid">
                    {list.map((o) => {
                        const taken = used.has(o.skillId)
                        return (
                            <div
                                key={o.skillId}
                                className={`op-card ${taken ? 'used' : 'selectable'}`}
                                onClick={() => {
                                    if (!taken) onPick(o.skillId)
                                }}
                            >
                                <div className="op-head">
                                    <span className="op-name">{o.skillName}</span>
                                    <span className="op-source">{o.sourceGeneralName}</span>
                                </div>
                                <div className="op-desc">{o.description}</div>
                                {taken && <span className="gp-taken">已被选</span>}
                            </div>
                        )
                    })}
                    {list.length === 0 && <div className="gp-empty">没有匹配的技能</div>}
                </div>
            </div>
        </div>
    )
}
