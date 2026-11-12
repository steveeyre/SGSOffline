import { Routes, Route, Navigate } from 'react-router-dom'
import { useGameStore } from './store/gameStore'
import { GamePhase } from 'sgs3v3-shared'
import LobbyPage from './pages/LobbyPage'
import GeneralPickPage from './pages/GeneralPickPage'
import LandlordPickPage from './modes/FightTheLandlord/LandlordPickPage'
import PairPickPage from './modes/HappyPair/PairPickPage'
import GamePage from './pages/GamePage'
import HotseatGamePage from './pages/HotseatGamePage'
import GameOverPage from './pages/GameOverPage'
import ReviewPage from './pages/ReviewPage'
import { hasResumeSave, isLocalMatchActive, resumeLocalMatch } from './engine/local-dispatch'

/** 当前路由：file:// 下是 hash 路由，开发服务器下是普通路径 */
function currentRoutePath(): string {
    const hash = window.location.hash
    if (hash.startsWith('#/')) return hash.slice(1)
    return window.location.pathname
}

/**
 * 刷新时仍停在 /pick 或 /game，说明用户是想接着打，直接恢复未完成的对局；
 * 从大厅进入则留给用户自己点「继续上次对局」，不会被强制拉回对局。
 */
function bootstrapLocalMatch(): void {
    if (typeof window === 'undefined' || isLocalMatchActive() || !hasResumeSave()) return
    const path = currentRoutePath()
    if (path.startsWith('/game') || path.startsWith('/pick')) resumeLocalMatch()
}

bootstrapLocalMatch()

export default function App() {
    const gameState = useGameStore((s) => s.gameState)
    const hotseat = useGameStore((s) => s.hotseat)

    // 根据游戏阶段自动路由
    const phase = gameState?.phase

    return (
        <Routes>
            <Route path="/" element={<LobbyPage />} />
            <Route
                path="/pick"
                element={
                    phase === GamePhase.GENERAL_PICK || phase === GamePhase.DEPLOY
                        ? (gameState?.mode === 'doudizhu' ? <LandlordPickPage />
                            : gameState?.mode === 'huanle_shuang' ? <PairPickPage />
                                : <GeneralPickPage />)
                        : phase === GamePhase.PLAYING
                            ? <Navigate to="/game" replace />
                            : <Navigate to="/" replace />
                }
            />
            <Route
                path="/game"
                element={
                    phase === GamePhase.PLAYING
                        ? (hotseat ? <HotseatGamePage /> : <GamePage />)
                        : phase === GamePhase.GAME_OVER
                            ? <Navigate to="/gameover" replace />
                            : <Navigate to="/" replace />
                }
            />
            <Route path="/gameover" element={<GameOverPage />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/review/:id" element={<ReviewPage />} />
        </Routes>
    )
}
