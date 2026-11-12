import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react'
import { DUR, EASE } from './ease'
import { fxEnabled, play, wait } from './track'
import { curve, type Pt } from './measure'

const SVG_NS = 'http://www.w3.org/2000/svg'

export type LineTone = 'slash' | 'trick' | 'skill' | 'equip'
export type TextTone = 'damage' | 'heal' | 'armor' | 'buff'

export type FxHandle = {
    /** 动效层的根节点，用作坐标原点 */
    root: () => HTMLDivElement | null
    flyCard: (opts: { from: Pt; to: Pt; label: string; sub?: string; delay?: number }) => Promise<void>
    drawLine: (opts: { from: Pt; to: Pt; tone: LineTone; label?: string }) => Promise<void>
    floatText: (at: Pt, text: string, tone: TextTone) => void
    /** 击杀/连斩/无双：向目标劈出刀光并震出命中特效 */
    killStrike: (opts: { from?: Pt | null; at: Pt; label?: string; tone?: 'kill' | 'wushuang' }) => Promise<void>
}

export const FxLayer = forwardRef<FxHandle, Record<string, unknown>>(function FxLayer(_props, ref) {
    const rootRef = useRef<HTMLDivElement | null>(null)
    const svgRef = useRef<SVGSVGElement | null>(null)
    const nodesRef = useRef<HTMLDivElement | null>(null)

    const flyCard = useCallback(async ({ from, to, label, sub, delay }: {
        from: Pt; to: Pt; label: string; sub?: string; delay?: number
    }) => {
        const host = nodesRef.current
        if (!host || !fxEnabled()) return

        const el = document.createElement('div')
        el.className = 'fx-fly-card'
        if (sub) {
            const head = document.createElement('span')
            head.className = 'fx-fly-sub'
            head.textContent = sub
            el.appendChild(head)
        }
        const name = document.createElement('span')
        name.className = 'fx-fly-label'
        name.textContent = label
        el.appendChild(name)
        el.style.left = `${from.x}px`
        el.style.top = `${from.y}px`
        host.appendChild(el)

        const dx = to.x - from.x
        const dy = to.y - from.y
        await play(el, [
            { transform: 'translate(-50%, -50%) scale(0.62) rotate(-8deg)', opacity: 0 },
            {
                transform: `translate(calc(-50% + ${dx * 0.55}px), calc(-50% + ${dy * 0.55}px)) scale(1.08) rotate(0deg)`,
                opacity: 1,
                offset: 0.55,
            },
            { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.94)`, opacity: 0.92 },
        ], { ms: DUR.card, delay, ease: EASE.deal, fill: 'forwards' })
        el.remove()
    }, [])

    const drawLine = useCallback(async ({ from, to, tone, label }: {
        from: Pt; to: Pt; tone: LineTone; label?: string
    }) => {
        const svg = svgRef.current
        const host = nodesRef.current
        if (!svg || !host || !fxEnabled()) return

        const { d, mid } = curve(from, to, 0.18)
        const path = document.createElementNS(SVG_NS, 'path')
        path.setAttribute('d', d)
        path.setAttribute('class', `fx-line fx-line-${tone}`)
        svg.appendChild(path)

        const len = Math.max(1, path.getTotalLength())
        path.style.strokeDasharray = `${len}`
        path.style.strokeDashoffset = `${len}`

        const arrow = document.createElement('div')
        arrow.className = `fx-arrow fx-arrow-${tone}`
        arrow.style.offsetPath = `path("${d}")`
        arrow.style.offsetDistance = '0%'
        host.appendChild(arrow)

        let tag: HTMLDivElement | null = null
        if (label) {
            tag = document.createElement('div')
            tag.className = 'fx-line-tag'
            tag.textContent = label
            tag.style.left = `${mid.x}px`
            tag.style.top = `${mid.y}px`
            host.appendChild(tag)
        }

        await Promise.all([
            play(path, [{ strokeDashoffset: `${len}` }, { strokeDashoffset: '0' }], {
                ms: DUR.lineGrow, ease: EASE.move, fill: 'forwards',
            }),
            play(arrow, [{ offsetDistance: '0%' }, { offsetDistance: '100%' }], {
                ms: DUR.lineGrow, ease: EASE.move, fill: 'forwards',
            }),
        ])

        if (tone === 'skill') path.style.strokeDasharray = '8 4'
        await wait(DUR.lineHold)

        path.style.strokeDasharray = `${len}`
        await play(path, [{ strokeDashoffset: '0' }, { strokeDashoffset: `${-len}` }], {
            ms: DUR.lineRetract, ease: EASE.out, fill: 'forwards',
        })

        path.remove()
        arrow.remove()
        tag?.remove()
    }, [])

    const floatText = useCallback((at: Pt, text: string, tone: TextTone) => {
        const host = nodesRef.current
        if (!host || !fxEnabled()) return
        const el = document.createElement('div')
        el.className = `fx-float fx-float-${tone}`
        el.textContent = text
        el.style.left = `${at.x}px`
        el.style.top = `${at.y}px`
        host.appendChild(el)
        void play(el, [
            { transform: 'translate(-50%, -50%) scale(0.7)', opacity: 0 },
            { transform: 'translate(-50%, calc(-50% - 10px)) scale(1.16)', opacity: 1, offset: 0.28 },
            { transform: 'translate(-50%, calc(-50% - 40px)) scale(1)', opacity: 0 },
        ], { ms: DUR.float, ease: EASE.out, fill: 'forwards' }).then(() => el.remove())
    }, [])

    const killStrike = useCallback(async ({ from, at, label, tone = 'kill' }: {
        from?: Pt | null; at: Pt; label?: string; tone?: 'kill' | 'wushuang'
    }) => {
        const svg = svgRef.current
        const host = nodesRef.current
        if (!svg || !host || !fxEnabled()) return
        const wushuang = tone === 'wushuang'

        const strokes: SVGPathElement[] = []
        // 有击杀者时从击杀者向目标劈出三道交错刀光；判定/失去体力等无来源阵亡只震出命中特效
        if (from) {
            for (let s = 0; s < 3; s++) {
                const spread = 12 + s * 13
                const to = {
                    x: at.x + (s === 1 ? spread : -spread),
                    y: at.y + (s === 0 ? -spread * 0.55 : spread * 0.55),
                }
                const { d } = curve(from, to, (s === 1 ? 1 : -1) * (0.06 + s * 0.035))
                const path = document.createElementNS(SVG_NS, 'path')
                path.setAttribute('d', d)
                path.setAttribute('class', wushuang ? 'fx-slash-stroke wushuang' : 'fx-slash-stroke')
                svg.appendChild(path)
                const len = Math.max(1, path.getTotalLength())
                path.style.strokeDasharray = `${len}`
                path.style.strokeDashoffset = `${len}`
                strokes.push(path)
                void play(path, [
                    { strokeDashoffset: `${len}` },
                    { strokeDashoffset: '0' },
                ], { ms: 170, delay: s * 45, ease: EASE.out, fill: 'forwards' })
            }
        }

        const burst = document.createElement('div')
        burst.className = wushuang ? 'fx-slash-burst wushuang' : 'fx-slash-burst'
        burst.style.left = `${at.x}px`
        burst.style.top = `${at.y}px`
        burst.appendChild(Object.assign(document.createElement('i'), { className: 'fx-slash-line a' }))
        burst.appendChild(Object.assign(document.createElement('i'), { className: 'fx-slash-line b' }))
        burst.appendChild(Object.assign(document.createElement('i'), { className: 'fx-slash-line c' }))
        host.appendChild(burst)
        void play(burst, [
            { transform: 'translate(-50%, -50%) scale(0.35)', opacity: 0 },
            { transform: 'translate(-50%, -50%) scale(1.15)', opacity: 1, offset: 0.3 },
            { transform: 'translate(-50%, -50%) scale(1.7)', opacity: 0 },
        ], { ms: wushuang ? 520 : 420, ease: EASE.out, fill: 'forwards' }).then(() => burst.remove())

        if (label) {
            const tag = document.createElement('div')
            tag.className = wushuang ? 'fx-combo-tag wushuang' : 'fx-combo-tag'
            tag.textContent = label
            tag.style.left = `${at.x}px`
            tag.style.top = `${at.y - 58}px`
            host.appendChild(tag)
            void play(tag, [
                { transform: 'translate(-50%, -50%) scale(0.55)', opacity: 0 },
                { transform: 'translate(-50%, -50%) scale(1.18)', opacity: 1, offset: 0.28 },
                { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.72 },
                { transform: 'translate(-50%, -62%) scale(1.08)', opacity: 0 },
            ], { ms: wushuang ? 1150 : 850, delay: 80, ease: EASE.out, fill: 'forwards' }).then(() => tag.remove())
        }

        await wait(260)
        for (const path of strokes) path.remove()
    }, [])

    useImperativeHandle(ref, () => ({
        root: () => rootRef.current,
        flyCard,
        drawLine,
        floatText,
        killStrike,
    }), [flyCard, drawLine, floatText, killStrike])

    return (
        <div className="fx-layer" ref={rootRef} aria-hidden="true">
            <svg className="fx-lines" ref={svgRef} />
            <div className="fx-nodes" ref={nodesRef} />
        </div>
    )
})
