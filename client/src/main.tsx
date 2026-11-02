import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import App from './App'
import './index.css'

// 单文件版以 file:// 打开，BrowserRouter 无法解析本地路径，改用 hash 路由
const Router = window.location.protocol === 'file:' ? HashRouter : BrowserRouter

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <Router>
            <App />
        </Router>
    </React.StrictMode>
)
