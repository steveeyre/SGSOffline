import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { DecisionRecord, MatchLogAction, MatchLogRecord } from '../engine/match-log'
import {
    computeMatchStats, getMatchRecord, matchModeName, matchRecordWin,
} from '../engine/match-stats'
import './ReviewPage.css'

type TimelineItem =
    | { kind: 'decision'; at: number; data: DecisionRecord }
    | { kind: 'action'; at: number; data: MatchLogAction }

const KEY_EVENT_LABELS: Record<string, string> = {
    death: '阵亡',
    dying: '濒死',
    commander_hit: '主帅受击',
    negate: '无懈',
    awaken: '觉醒',
    limited_skill: '限定技',
    judge: '判定',
    lightning: '闪电',
    big_draw: '大摸牌',
    card_swing: '手牌剧变',
    hp_swing: '体力剧变',
}

function keyEventLabel(event: string): string {
    if (event.startsWith('trick:')) return event.slice(6)
    return KEY_EVENT_LABELS[event] ?? event
}

function timeLabel(at: number): string {
    const d = new Date(at)
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function winRate(wins: number, total: number): string {
    if (total <= 0) return '—'
    return `${Math.round((wins / total) * 100)}%`
}

function DecisionDetail({ record }: { record: DecisionRecord }) {
    const ranked = [...record.candidates].sort(
        (a, b) => (b.finalScore ?? b.score) - (a.finalScore ?? a.score),
    )
    const maxScore = Math.max(1, ...ranked.map((c) => c.finalScore ?? c.score))
    return (
        <div className="review-detail-block">
            <div className="review-detail-title">
                决策 #{record.seq} · {record.actor} · {record.kind}
                {record.plan ? ` · 计划 ${record.plan}` : ''}
            </div>
            <div className="review-chosen">
                实际选择：<b>{record.chosen?.label ?? '（无候选）'}</b>
            </div>
            {record.events.length > 0 && (
                <div className="review-tags">
                    {record.events.map((e) => <span key={e} className="review-tag">{keyEventLabel(e)}</span>)}
                </div>
            )}
            {ranked.length > 0 && (
                <div className="review-cands">
                    {ranked.slice(0, 12).map((c) => {
                        const score = c.finalScore ?? c.score
                        return (
                            <div key={c.id} className={`review-cand${c.chosen ? ' chosen' : ''}`}>
                                <span className="review-cand-label">{c.label}</span>
                                <span className="review-bar-wrap">
                                    <span className="review-bar" style={{ width: `${Math.max(2, (score / maxScore) * 100)}%` }} />
                                </span>
                                <span className="review-cand-score">{Math.round(score * 10) / 10}</span>
                            </div>
                        )
                    })}
                </div>
            )}
            <div className="review-seats">
                <div className="review-seats-head">
                    <span>座位</span><span>武将</span><span>体力</span><span>手牌</span><span>装备 / 判定</span>
                </div>
                {record.snapshot.seats.map((seat) => (
                    <div key={seat.seat} className={`review-seat${seat.alive ? '' : ' dead'}`}>
                        <span>{seat.seat + 1}</span>
                        <span>{seat.name}</span>
                        <span>{seat.hp}/{seat.maxHp}</span>
                        <span title={seat.hand.join('、')}>{seat.handCount}（明 {seat.hand.length}）</span>
                        <span className="review-seat-area">{[...seat.equip, ...seat.judge].join('、') || '—'}</span>
                    </div>
                ))}
            </div>
            <div className="review-deck-note">
                牌堆剩余 {record.snapshot.deckCount} · 弃牌顶 {record.snapshot.discardTop ?? '—'}
            </div>
        </div>
    )
}

function ActionDetail({ action }: { action: MatchLogAction }) {
    return (
        <div className="review-detail-block">
            <div className="review-detail-title">
                操作 #{action.seq} · {action.actor} · {action.kind}
            </div>
            <div className="review-meta">
                {action.phase} · 第 {action.round} 回合 · 座位 {action.seat + 1}
                {action.error ? ` · 被拒绝：${action.error}` : ''}
            </div>
            {action.payload !== undefined && action.payload !== null && (
                <pre className="review-payload">{JSON.stringify(action.payload, null, 2)}</pre>
            )}
            {action.logs.length > 0 && (
                <div className="review-logs">
                    {action.logs.map((line, i) => <div key={i} className="review-log-line">{line}</div>)}
                </div>
            )}
        </div>
    )
}

function MatchDetail({ record, onBack }: { record: MatchLogRecord; onBack: () => void }) {
    const [onlyKey, setOnlyKey] = useState(false)
    const timeline = useMemo<TimelineItem[]>(() => {
        const items: TimelineItem[] = [
            ...record.decisions.map((d) => ({ kind: 'decision' as const, at: d.at, data: d })),
            ...record.actions.map((a) => ({ kind: 'action' as const, at: a.at, data: a })),
        ]
        const sorted = items.sort((a, b) => a.at - b.at || (a.kind === b.kind ? 0 : a.kind === 'decision' ? -1 : 1))
        // 关键事件视图：只留带事件标记的决策，集中在可能打坏的那几手
        if (!onlyKey) return sorted
        return sorted.filter((entry) => entry.kind === 'decision' && entry.data.events.length > 0)
    }, [record, onlyKey])

    // 默认停在最后一手：复盘通常从“哪一步打坏了”倒着看
    const [selected, setSelected] = useState(Math.max(0, timeline.length - 1))
    useEffect(() => { setSelected(Math.max(0, timeline.length - 1)) }, [record.id, timeline.length])

    const win = matchRecordWin(record)
    const item = timeline[Math.min(selected, timeline.length - 1)]

    return (
        <div className="review-page">
            <div className="review-header">
                <button className="btn btn-secondary" onClick={onBack}>返回列表</button>
                <button className={`btn ${onlyKey ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setOnlyKey((v) => !v)}>
                    只看关键事件
                </button>
                <div className="review-title">
                    {matchModeName(record.mode)} · {win === true ? '胜' : win === false ? '负' : '本地对战'}
                    {record.seed !== null ? ` · 种子 ${record.seed}` : ''}
                </div>
                <div className="review-subtitle">
                    {timeLabel(record.startedAt)} · {record.decisions.length} 次决策 · {record.actions.length} 步操作
                </div>
            </div>
            <div className="review-grid">
                <div className="review-list">
                    {timeline.length === 0 && <div className="review-empty">这局没有记录到可回放的步骤</div>}
                    {timeline.map((entry, index) => {
                        const decision = entry.kind === 'decision' ? entry.data : null
                        const action = entry.kind === 'action' ? entry.data : null
                        return (
                            <button
                                key={`${entry.kind}-${decision?.id ?? action?.id}`}
                                className={`review-item${index === selected ? ' active' : ''}`}
                                onClick={() => setSelected(index)}
                            >
                                <span className="review-item-kind">{entry.kind === 'decision' ? '决' : '操'}</span>
                                <span className="review-item-text">
                                    <b>{decision?.actor ?? action?.actor}</b>
                                    <span>
                                        {decision
                                            ? decision.chosen?.label ?? `决策 ${decision.kind}`
                                            : action?.kind ?? ''}
                                    </span>
                                </span>
                                <span className="review-item-round">第{decision?.snapshot.round ?? action?.round ?? 0}回合</span>
                            </button>
                        )
                    }).slice(Math.max(0, timeline.length - 400))}
                </div>
                <div className="review-pane">
                    {!item && <div className="review-empty">选择左侧任意一步查看详情</div>}
                    {item?.kind === 'decision' && <DecisionDetail record={item.data} />}
                    {item?.kind === 'action' && <ActionDetail action={item.data} />}
                </div>
            </div>
        </div>
    )
}

export default function ReviewPage() {
    const navigate = useNavigate()
    const { id } = useParams()
    const stats = useMemo(() => computeMatchStats(), [])
    const record = useMemo(() => (id ? getMatchRecord(id) : null), [id])

    if (record) {
        return <MatchDetail record={record} onBack={() => navigate('/review')} />
    }

    return (
        <div className="review-page">
            <div className="review-header">
                <button className="btn btn-secondary" onClick={() => navigate('/')}>返回大厅</button>
                <div className="review-title">复盘与统计</div>
                <div className="review-subtitle">记录只存在本机，最多保留最近 100 局</div>
            </div>

            <div className="review-stats">
                <div className="review-stat">
                    <b>{stats.total}</b><span>总局数</span>
                </div>
                <div className="review-stat">
                    <b>{stats.wins}</b><span>胜</span>
                </div>
                <div className="review-stat">
                    <b>{stats.losses}</b><span>负</span>
                </div>
                <div className="review-stat">
                    <b>{winRate(stats.wins, stats.decided)}</b><span>胜率</span>
                </div>
            </div>

            {stats.byMode.length > 0 && (
                <div className="review-panel">
                    <div className="review-panel-title">分模式</div>
                    {stats.byMode.map((m) => (
                        <div key={m.mode} className="review-row">
                            <span>{matchModeName(m.mode)}</span>
                            <span>{m.total} 局</span>
                            <span>{m.wins} 胜 / {m.losses} 负</span>
                            <span>{winRate(m.wins, m.wins + m.losses)}</span>
                        </div>
                    ))}
                </div>
            )}

            {stats.generals.length > 0 && (
                <div className="review-panel">
                    <div className="review-panel-title">武将出场（仅统计你的武将）</div>
                    <div className="review-generals">
                        {stats.generals.slice(0, 18).map((g) => (
                            <div key={g.id} className="review-general">
                                <span>{g.name}</span>
                                <span>{g.games} 局 · {winRate(g.wins, g.games)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="review-panel">
                <div className="review-panel-title">最近对局</div>
                {stats.recent.length === 0 && (
                    <div className="review-empty">还没有保存的对局记录：打完一局后这里会出现可回放的步骤</div>
                )}
                {stats.recent.map((m) => (
                    <button key={m.id} className="review-row review-row-click" onClick={() => navigate(`/review/${m.id}`)}>
                        <span>{timeLabel(m.endedAt)}</span>
                        <span>{matchModeName(m.mode)}</span>
                        <span className={m.win === true ? 'review-win' : m.win === false ? 'review-loss' : ''}>
                            {m.win === true ? '胜' : m.win === false ? '负' : '本地'}
                        </span>
                        <span className="review-general-names">{m.generals.join('、')}</span>
                    </button>
                ))}
            </div>
        </div>
    )
}
