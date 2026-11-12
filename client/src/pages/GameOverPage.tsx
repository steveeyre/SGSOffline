import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'
import { BattleSideStats, Faction, GameMode } from 'sgs3v3-shared'
import { exitLocalMatch, getLocalSeed, getLocalState, isLocalMatchActive, rematchLocalMatch } from '../engine/local-dispatch'
import { ensureBattleStats } from '../engine/combat-stats'
import './GameOverPage.css'

const STAT_ROWS: Array<{ key: keyof BattleSideStats; label: string; hint?: string }> = [
    { key: 'skillUses', label: '技能发动', hint: '技能实际发动的次数' },
    { key: 'draws', label: '补牌', hint: '从牌堆摸到手的牌数' },
    { key: 'damageDealt', label: '总伤害', hint: '对全场造成的伤害总量' },
    { key: 'damageToEnemy', label: '对敌伤害', hint: '对敌方阵营造成的伤害' },
    { key: 'kills', label: '击杀', hint: '直接击杀的敌方角色数' },
    { key: 'damageTaken', label: '承伤', hint: '己方承受的伤害总量' },
    { key: 'healing', label: '回复', hint: '己方实际回复的体力' },
]

export default function GameOverPage() {
    const navigate = useNavigate()
    const { myFaction, winnerFaction, mode, hotseat } = useGameStore()
    const [copied, setCopied] = useState(false)
    const seed = getLocalSeed()
    // 刷新结算页后引擎侧已无对局，再战按钮无处可依，只留返回大厅
    const matchAlive = isLocalMatchActive()

    const isWin = winnerFaction != null && winnerFaction === myFaction

    const statsState = getLocalState()
    const stats = statsState ? ensureBattleStats(statsState) : null
    const myStats = stats && myFaction ? (myFaction === Faction.WARM ? stats.warm : stats.cool) : null
    const foeStats = stats && myFaction ? (myFaction === Faction.WARM ? stats.cool : stats.warm) : null

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

    function startRematch(opts: { seed?: number; swapSide?: boolean } = {}): void {
        rematchLocalMatch(opts)
        navigate('/pick')
    }

    function mySideLabel(): string {
        if (mode === GameMode.DOUDIZHU) return myFaction === Faction.WARM ? '地主' : '农民'
        return myFaction === Faction.COOL ? '冷色方' : '暖色方'
    }

    function foeSideLabel(): string {
        if (mode === GameMode.DOUDIZHU) return myFaction === Faction.WARM ? '农民' : '地主'
        return myFaction === Faction.WARM ? '冷色方' : '暖色方'
    }

    return (
        <div className="gameover-page">
            <div className="page-title gameover-title" style={{
                color: isWin ? 'var(--color-gold-light)' : 'var(--color-red)',
            }}>
                {isWin ? '🎉 胜利！' : '💀 败北'}
            </div>
            <div className="gameover-subtitle">
                {mode === GameMode.DOUDIZHU
                    ? `${winnerFaction === Faction.WARM ? '地主' : '农民'}获得胜利`
                    : mode === GameMode.HUANLE_SHUANG
                        ? `${winnerFaction === Faction.WARM ? '暖色方' : '冷色方'}获得胜利（对方全员阵亡）`
                        : `${winnerFaction === Faction.WARM ? '暖色方' : '冷色方'}获得胜利`}
            </div>
            <div className="gameover-side">
                你执{mySideLabel()}{hotseat ? '（本地对战）' : ''}
            </div>

            {myStats && foeStats && (
                <div className="battle-stats">
                    <div className="battle-stats-title">本局统计</div>
                    <table className="battle-stats-table">
                        <thead>
                            <tr>
                                <th className="stat-label">项目</th>
                                <th className={isWin ? 'mine win' : 'mine'}>{mySideLabel()}</th>
                                <th>{foeSideLabel()}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {STAT_ROWS.map((row) => (
                                <tr key={row.key}>
                                    <td className="stat-label" title={row.hint}>{row.label}</td>
                                    <td className={`stat-value ${isWin ? 'win' : ''}`}>{myStats[row.key]}</td>
                                    <td className="stat-value foe">{foeStats[row.key]}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {seed !== null && (
                <div className="gameover-seed">
                    <span>本局种子：{seed}</span>
                    <button className="btn btn-secondary" onClick={copySeed}>{copied ? '已复制' : '复制种子'}</button>
                </div>
            )}
            <div className="gameover-actions">
                {matchAlive && (
                    <button className="btn btn-primary" onClick={() => startRematch()}>再战一局</button>
                )}
                {matchAlive && !hotseat && (
                    <button className="btn btn-secondary" onClick={() => startRematch({ swapSide: true })}>换边再战</button>
                )}
                {matchAlive && seed !== null && (
                    <button className="btn btn-secondary" title="用本局种子重开，过程与结果与本局完全相同"
                        onClick={() => startRematch({ seed })}>同种子复现</button>
                )}
                <button className="btn btn-secondary" onClick={() => {
                    if (isLocalMatchActive()) exitLocalMatch()
                    navigate('/')
                }}>
                    返回大厅
                </button>
            </div>
        </div>
    )
}
