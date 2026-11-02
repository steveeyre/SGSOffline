import express from 'express'
import http from 'http'
import path from 'path'
import { Server as SocketIOServer } from 'socket.io'
import { registerSocketHandlers } from './socket/handlers'
import { startCleanupTimer } from './rooms/room-manager'
import { handleAiDecision, handleAiHealth, warmupFastModel } from './ai/ollama'

const app = express()
const server = http.createServer(app)

const io = new SocketIOServer(server, {
    cors: {
        origin: process.env.NODE_ENV === 'production'
            ? '*'
            : ['http://localhost:5174', 'http://localhost:5173'],
        methods: ['GET', 'POST'],
    },
})

app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
})

app.use(express.json({ limit: '512kb' }))

// 本地大模型 AI：转发到本机 Ollama（单机模式的 AI 决策走这里）
app.post('/api/ai/decision', (req, res) => { void handleAiDecision(req, res) })
app.get('/api/ai/health', (req, res) => { void handleAiHealth(req, res) })

// 生产环境：托管前端静态文件
const clientDistPath = path.join(__dirname, '../../client/dist')
app.use(express.static(clientDistPath))

io.on('connection', (socket) => {
    console.log(`[Socket] Connected: ${socket.id}`)
    registerSocketHandlers(io, socket)
    socket.on('disconnect', () => {
        console.log(`[Socket] Disconnected: ${socket.id}`)
    })
})

// SPA 回退：所有未匹配路由返回 index.html
app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDistPath, 'index.html'))
})

const PORT = process.env.PORT || 3001
server.listen(PORT, () => {
    console.log(`[Server] Listening on http://localhost:${PORT}`)
    startCleanupTimer()
    void warmupFastModel()
})
