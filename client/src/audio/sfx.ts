/**
 * 程序化音效：不引入音频素材，用 Web Audio 直接合成。
 * 音量刻意压得低，只做操作反馈，不抢背景音乐。
 */
export type SfxKind = 'draw' | 'play' | 'damage' | 'heal' | 'judge' | 'skill'

let ctx: AudioContext | null = null
let noise: AudioBuffer | null = null
let lastAt = 0

function ensure(): AudioContext | null {
    if (typeof window === 'undefined') return null
    if (!ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!Ctor) return null
        ctx = new Ctor()
    }
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
}

function noiseBuffer(ac: AudioContext): AudioBuffer {
    if (noise) return noise
    const len = Math.floor(ac.sampleRate * 0.4)
    const buf = ac.createBuffer(1, len, ac.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1
    noise = buf
    return buf
}

function burst(ac: AudioContext, at: number, dur: number, freq: number, gain: number, type: BiquadFilterType): void {
    const src = ac.createBufferSource()
    src.buffer = noiseBuffer(ac)
    const filter = ac.createBiquadFilter()
    filter.type = type
    filter.frequency.value = freq
    const amp = ac.createGain()
    amp.gain.setValueAtTime(0.0001, at)
    amp.gain.exponentialRampToValueAtTime(gain, at + 0.012)
    amp.gain.exponentialRampToValueAtTime(0.0001, at + dur)
    src.connect(filter).connect(amp).connect(ac.destination)
    src.start(at)
    src.stop(at + dur + 0.02)
}

function tone(
    ac: AudioContext,
    at: number,
    dur: number,
    from: number,
    to: number,
    gain: number,
    type: OscillatorType,
): void {
    const osc = ac.createOscillator()
    const amp = ac.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(from, at)
    osc.frequency.exponentialRampToValueAtTime(to, at + dur)
    amp.gain.setValueAtTime(0.0001, at)
    amp.gain.exponentialRampToValueAtTime(gain, at + 0.015)
    amp.gain.exponentialRampToValueAtTime(0.0001, at + dur)
    osc.connect(amp).connect(ac.destination)
    osc.start(at)
    osc.stop(at + dur + 0.02)
}

export function playSfx(kind: SfxKind): void {
    const ac = ensure()
    if (!ac) return
    // 同一瞬间只播一次，避免多目标连线时叠成噪音
    const now = ac.currentTime
    if (now - lastAt < 0.06) return
    lastAt = now
    const t = now + 0.005

    switch (kind) {
        case 'draw':
            burst(ac, t, 0.09, 2200, 0.05, 'bandpass')
            break
        case 'play':
            burst(ac, t, 0.12, 1400, 0.06, 'lowpass')
            break
        case 'skill':
            tone(ac, t, 0.18, 620, 880, 0.05, 'triangle')
            break
        case 'damage':
            tone(ac, t, 0.2, 150, 68, 0.11, 'sine')
            burst(ac, t, 0.1, 700, 0.05, 'lowpass')
            break
        case 'heal':
            tone(ac, t, 0.24, 520, 760, 0.045, 'triangle')
            break
        case 'judge':
            tone(ac, t, 0.14, 900, 880, 0.04, 'square')
            break
        default:
            break
    }
}
