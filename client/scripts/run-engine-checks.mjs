import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const clientDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const entry = process.argv[2] ?? 'src/engine/_checks.ts'
const name = entry.split(/[\\/]/).pop().replace(/\.tsx?$/, '')
const outfile = join(clientDir, 'node_modules', '.cache', `${name}.cjs`)

mkdirSync(dirname(outfile), { recursive: true })
await build({
    entryPoints: [join(clientDir, entry)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    loader: { '.css': 'empty' },
    outfile,
    logLevel: 'warning',
})

const result = spawnSync(process.execPath, [outfile, ...process.argv.slice(3)], { stdio: 'inherit' })
process.exit(result.status ?? 1)
