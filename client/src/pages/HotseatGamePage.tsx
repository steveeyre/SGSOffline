import { Faction } from 'sgs3v3-shared'
import { useGameStore } from '../store/gameStore'
import GamePage from './GamePage'
import HotseatSplit from './HotseatSplit'

/** 左右手对弈：同一窗口分成两屏，各自由本地玩家操作一方 */
export default function HotseatGamePage() {
    const views = useGameStore((s) => s.hotseatViews)
    if (!views?.warm || !views?.cool) return null
    const ddz = views.warm.mode === 'doudizhu'
    return (
        <HotseatSplit
            warmLabel={ddz ? '地主' : '暖方'}
            coolLabel={ddz ? '农民' : '冷方'}
            warm={<GamePage view={views.warm} faction={Faction.WARM} />}
            cool={<GamePage view={views.cool} faction={Faction.COOL} />}
        />
    )
}
