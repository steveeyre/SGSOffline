import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { GamePhase } from 'sgs3v3-shared'
import { useGameStore } from '../../store/gameStore'
import { emit } from '../../actions'
import { GENERAL_IMAGE } from '../../data/generalImages'
import { useTooltip, generalTooltipContent, TooltipBubble } from '../../components/Tooltip'
import './LandlordPickPage.css'

const SEAT_LABELS = ['地主', '农民一', '农民二']

export default function LandlordPickPage() {
    const navigate = useNavigate()
    const gameState = useGameStore((s) => s.gameState)
    const pick = gameState?.landlordPick
    const humanSide = gameState?.landlordHumanSide ?? 'landlord'
    const phase = gameState?.phase
    // 第一次点击记候选（高亮），再点同一张才提交
    const [pendingPick, setPendingPick] = useState<Record<number, string>>({})
    const { tooltip, onEnter, onMove, onLeave } = useTooltip(400)

    useEffect(() => {
        if (phase === GamePhase.PLAYING) navigate('/game', { replace: true })
    }, [phase, navigate])

    if (!gameState || !pick) {
        return (
            <div className="landlord-pick-page">
                <div className="landlord-pick-empty">
                    没有进行中的斗地主选将
                    <button className="btn btn-secondary" onClick={() => navigate('/')}>返回首页</button>
                </div>
            </div>
        )
    }

    const isHumanSeat = (seat: number) => (seat === 0 ? humanSide === 'landlord' : humanSide === 'farmers')
    const allPicked = pick.picked.every((id) => id !== null)
    const pickedIds = pick.picked

    /** 一次点击高亮，二次点击确认 */
    function pickCard(seat: number, generalId: string): void {
        if (pendingPick[seat] !== generalId) {
            setPendingPick((prev) => ({ ...prev, [seat]: generalId }))
            return
        }
        setPendingPick((prev) => {
            const next = { ...prev }
            delete next[seat]
            return next
        })
        emit.landlordPick({ poolIndex: seat, generalId })
    }

    return (
        <div className="landlord-pick-page">
            <div className="landlord-pick-title">斗地主 · 选将</div>

            <div className="landlord-pick-columns">
                {pick.pools.map((pool, seat) => {
                    const mine = isHumanSeat(seat)
                    const pickedId = pick.picked[seat]
                    const pendingId = mine ? pendingPick[seat] : undefined
                    return (
                        <div
                            key={seat}
                            className={`landlord-pick-column ${seat === 0 ? 'landlord' : 'farmer'} ${mine ? 'mine' : 'rival'}`}
                        >
                            <div className="landlord-pick-seat">
                                {SEAT_LABELS[seat]}
                                <span className="landlord-pick-owner">{seat === 0 ? '地主方' : '农民方'}</span>
                            </div>
                            {mine ? (
                                <div className="landlord-pick-cards">
                                    {pool.map((g, i) => {
                                        const isPicked = pickedId === g.id
                                        const isPending = !pickedId && pendingId === g.id
                                        const selectable = !pickedId && !allPicked
                                        return (
                                            <div
                                                key={g.id}
                                                className={`landlord-pick-card ${isPicked ? 'picked' : ''} ${isPending ? 'pending' : ''} ${selectable ? 'selectable' : ''}`}
                                                style={{ animationDelay: `${Math.min(i, 8) * 0.03}s` }}
                                                onClick={() => {
                                                    if (!selectable) return
                                                    pickCard(seat, g.id)
                                                }}
                                                onMouseEnter={(e) => onEnter(e, generalTooltipContent(g))}
                                                onMouseMove={onMove}
                                                onMouseLeave={onLeave}
                                            >
                                                <div className="lpc-portrait">
                                                    {GENERAL_IMAGE[g.id]
                                                        ? <img src={GENERAL_IMAGE[g.id]} alt={g.name} className="lpc-portrait-img"
                                                            onError={(e) => { e.currentTarget.style.display = 'none' }} />
                                                        : <span className="lpc-avatar">{g.name[0]}</span>}
                                                    <span className="lpc-name">{g.name}</span>
                                                    <span className="lpc-hp">{'♥'.repeat(Math.max(1, g.maxHp))}</span>
                                                    {isPicked && <div className="landlord-pick-badge">已选</div>}
                                                    {isPending && <div className="landlord-pick-badge pending">再点确定</div>}
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            ) : (
                                <div className="landlord-pick-hidden">
                                    <div className="landlord-pick-hidden-mark">？</div>
                                    <div className="landlord-pick-hidden-text">
                                        {pickedId ? '对手已选定武将' : '对手正在选将…'}
                                    </div>
                                </div>
                            )}
                            <div className="landlord-pick-status">
                                {mine
                                    ? pickedId
                                        ? `已选：${pool.find((g) => g.id === pickedId)?.name ?? pickedId}`
                                        : pendingId
                                            ? `待确认：${pool.find((g) => g.id === pendingId)?.name ?? pendingId}（再点一次确定）`
                                            : '点一次高亮，再点一次确认'
                                    : pickedId ? '对手已锁定' : '等待对手选将…'}
                            </div>
                        </div>
                    )
                })}
            </div>

            <TooltipBubble tooltip={tooltip} />
        </div>
    )
}
