@echo off
chcp 936 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

set "PORT_CLIENT=5174"
set "PORT_SERVER=3001"
set "OLLAMA_API=http://127.0.0.1:11434"
set "MODEL_FAST=qwen3.8-9b-distill"
set "MODEL_DEEP=qwen3.8-27b-ud-q3-k-xl"

echo ==================================================
echo   SGS3v3 本地模型对局启动器
echo ==================================================
echo.

rem ---------- 0. 环境检查 ----------
where node >nul 2>nul
if errorlevel 1 goto no_node
where npm >nul 2>nul
if errorlevel 1 goto no_npm

rem ---------- 1. Ollama ----------
set "OLLAMA_EXE="
for /f "delims=" %%i in ('where ollama 2^>nul') do if not defined OLLAMA_EXE set "OLLAMA_EXE=%%i"
if not defined OLLAMA_EXE if exist "%LOCALAPPDATA%\Programs\Ollama\ollama.exe" set "OLLAMA_EXE=%LOCALAPPDATA%\Programs\Ollama\ollama.exe"

curl -s -o nul --max-time 2 %OLLAMA_API%/api/tags
if not errorlevel 1 goto ollama_running

if not defined OLLAMA_EXE goto no_ollama
echo [1/4] 启动 Ollama 服务 ...
start "Ollama" /min "%OLLAMA_EXE%" serve
set /a __wait=0

:wait_ollama
curl -s -o nul --max-time 2 %OLLAMA_API%/api/tags
if not errorlevel 1 goto ollama_ready
set /a __wait+=1
if !__wait! geq 30 goto ollama_timeout
ping -n 2 127.0.0.1 >nul
goto wait_ollama

:ollama_running
echo [1/4] Ollama 已在运行。

:ollama_ready
rem ---------- 2. 模型检查 ----------
set "TAGS="
for /f "delims=" %%i in ('curl -s --max-time 10 %OLLAMA_API%/api/tags') do set "TAGS=%%i"
echo !TAGS! | findstr /c:"%MODEL_FAST%" >nul
if errorlevel 1 (
    echo [提示] 缺少模型 %MODEL_FAST%，正在拉取（体积较大，请耐心等待）...
    "%OLLAMA_EXE%" pull %MODEL_FAST%
)
echo !TAGS! | findstr /c:"%MODEL_DEEP%" >nul
if errorlevel 1 (
    echo [提示] 缺少模型 %MODEL_DEEP% ^(深度思考层，可选^)。
    echo        需要时执行：ollama pull %MODEL_DEEP%
)
echo [2/4] 模型就绪。

rem ---------- 3. 依赖 ----------
if exist "node_modules" goto deps_ready
echo [3/4] 首次运行，安装依赖 ...
call npm install
if errorlevel 1 goto npm_install_failed
goto deps_done

:deps_ready
echo [3/4] 依赖已存在。

:deps_done
netstat -ano | findstr /r /c:":%PORT_SERVER% .*LISTENING" >nul
if not errorlevel 1 echo [提示] 端口 %PORT_SERVER% 已被占用，若不是本项目旧进程请先关闭。
netstat -ano | findstr /r /c:":%PORT_CLIENT% .*LISTENING" >nul
if not errorlevel 1 echo [提示] 端口 %PORT_CLIENT% 已被占用，若已有游戏页面在跑可直接使用。

rem ---------- 4. 启动前后端 ----------
echo [4/4] 启动 server:%PORT_SERVER% 与 client:%PORT_CLIENT% ...
start "SGS3v3 dev" cmd /k npm run dev

set /a __tries=0

:wait_client
curl -s -o nul --max-time 2 http://localhost:%PORT_CLIENT%/
if not errorlevel 1 goto client_ready
set /a __tries+=1
if !__tries! geq 90 goto client_timeout
ping -n 2 127.0.0.1 >nul
goto wait_client

:client_ready
set /a __tries=0

:wait_server
curl -s -o nul --max-time 2 http://localhost:%PORT_SERVER%/api/ai/health
if not errorlevel 1 goto server_ready
set /a __tries+=1
if !__tries! geq 60 goto server_slow
ping -n 2 127.0.0.1 >nul
goto wait_server

:server_slow
echo [警告] 后端健康检查未通过，页面仍会打开，但本地模型不可用。
goto open_page

:server_ready
echo.
echo 后端健康检查：
curl -s --max-time 10 http://localhost:%PORT_SERVER%/api/ai/health
echo.
echo.

:open_page
if defined SGS3V3_NO_BROWSER goto no_browser
echo 正在打开 http://localhost:%PORT_CLIENT%/
start "" http://localhost:%PORT_CLIENT%/

:no_browser
echo.
echo 对局内点击日志栏右上角的「AI：规则」按钮，切换到「AI：本地模型」后即由本机模型操作。
echo 关闭 SGS3v3 dev 窗口即可停止服务。
exit /b 0

:no_node
echo [错误] 未找到 Node.js，请先安装 Node.js 18+ 并加入 PATH。
goto fail

:no_npm
echo [错误] 未找到 npm。
goto fail

:no_ollama
echo [错误] 未安装 Ollama，且 %OLLAMA_API% 无响应。
echo        请从 https://ollama.com/download 安装后重试。
goto fail

:ollama_timeout
echo [错误] Ollama 启动超时（30 秒）。
goto fail

:npm_install_failed
echo [错误] 依赖安装失败。
goto fail

:client_timeout
echo [警告] 等待前端就绪超时，请查看 SGS3v3 dev 窗口的报错。
goto fail

:fail
echo.
pause
exit /b 1
