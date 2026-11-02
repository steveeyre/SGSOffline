import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'
import { Faction, GameMode } from 'sgs3v3-shared'
import { exitLocalMatch, getLocalSeed, isLocalMatchActive } from '../engine/local-dispatch'

export default function GameOverPage() {
    const navigate = useNavigate()
    const { myFaction, winnerFaction, mode } = useGameStore()
    const [copied, setCopied] = useState(false)
    const seed = getLocalSeed()

    const isWin = winnerFaction != null && winnerFaction === myFaction

    async function copySeed(): Promise<void> {
        if (seed === null) return
        try {
            await navigator.clipboard.writeText(String(seed))
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
        } catch {
            window.prompt('复制本局种子', String(seed))
        }
    }

    return (
        <div style={{
            width: '100vw', height: '100vh',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: 24, background: 'var(--color-bg)',
        }}>
            <div className="page-title" style={{
                fontSize: 48,
                color: isWin ? '#ffd700' : '#ff4444',
            }}>
                {isWin ? '🎉 胜利！' : '💀 败北'}
            </div>
            <div style={{ color: 'var(--color-text-muted)', fontFamily: 'var(--font-ui)' }}>
                {mode === GameMode.DOUDIZHU
                    ? `${winnerFaction === Faction.WARM ? '地主' : '农民'}获得胜利`
                    : mode === GameMode.HUANLE_SHUANG
                        ? `${winnerFaction === Faction.WARM ? '暖色方' : '冷色方'}获得胜利（对方全员阵亡）`
                        : `${winnerFaction === Faction.WARM ? '暖色方' : '冷色方'}获得胜利`}
            </div>
            {seed !== null && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--color-text-muted)', fontFamily: 'var(--font-ui)' }}>
                    <span>本局种子：{seed}</span>
                    <button className="btn btn-secondary" onClick={copySeed}>{copied ? '已复制' : '复制种子'}</button>
                </div>
            )}
            <button className="btn btn-primary" onClick={() => {
                if (isLocalMatchActive()) exitLocalMatch()
                navigate('/')
            }}>
                创建新游戏
            </button>
        </div>
    )
}
