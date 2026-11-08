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
        </Routes>
    )
}
