import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const clientDir = resolve(scriptDir, '..')
const repoRoot = resolve(clientDir, '..')
const distDir = join(clientDir, 'dist')
const publicDir = join(clientDir, 'public')
const outDir = repoRoot
const outFile = join(outDir, 'SGSOffline.html')

const viteBin = [
    join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js'),
    join(clientDir, 'node_modules', 'vite', 'bin', 'vite.js'),
].find(existsSync)
if (!viteBin) throw new Error('找不到 vite，请先安装依赖')

const build = spawnSync(process.execPath, [viteBin, 'build', '--base', './'], {
    cwd: clientDir,
    stdio: 'inherit',
})
if (build.status !== 0) process.exit(build.status ?? 1)

let html = readFileSync(join(distDir, 'index.html'), 'utf8')

const scriptMatch = html.match(/<script[^>]*src="([^"]+)"[^>]*><\/script>/)
const styleMatch = html.match(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/)
if (!scriptMatch || !styleMatch) throw new Error('dist/index.html 结构与预期不符')

let js = readFileSync(join(distDir, scriptMatch[1]), 'utf8')
let css = readFileSync(join(distDir, styleMatch[1]), 'utf8')

const imageDir = join(publicDir, 'generals')
// 部分原画扩展名为 .jpg，实际是 PNG/WebP 数据，按文件头决定 data URI 的 MIME
function imageMime(buf) {
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
    if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp'
    return null
}
for (const file of readdirSync(imageDir)) {
    const buf = readFileSync(join(imageDir, file))
    const mime = imageMime(buf)
    if (!mime) continue
    const dataUri = `data:${mime};base64,${buf.toString('base64')}`
    js = js.split(`/generals/${file}`).join(dataUri)
}

// 单文件不内嵌 24MB 音乐；把 bgm.flac 放在 html 旁边即可恢复
js = js.split('/bgm.flac').join('bgm.flac')

if (js.includes('</script')) js = js.split('</script').join('<\\/script')
if (css.includes('</style')) css = css.split('</style').join('<\\/style')

html = html
    .replace(styleMatch[0], () => `<style>${css}</style>`)
    .replace(scriptMatch[0], () => '')
    .replace('</body>', () => `<script>${js}</script>\n  </body>`)
    .replace(/<link[^>]*rel="modulepreload"[^>]*>/g, '')

mkdirSync(outDir, { recursive: true })
writeFileSync(outFile, html)

if (process.argv.includes('--music') && existsSync(join(publicDir, 'bgm.flac'))) {
    copyFileSync(join(publicDir, 'bgm.flac'), join(outDir, 'bgm.flac'))
}

console.log(`\n单文件输出: ${outFile}`)
console.log(`大小: ${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB`)
