/**
 * Fantasma do adversário.
 *
 * Cada navegador envia poucas atualizações por segundo. Para o carro do rival
 * não andar aos saltos, guardamos as medições recentes e desenhamos sempre um
 * pouco no passado, interpolando entre duas medições conhecidas. Isso absorve
 * a variação do tempo de rede sem inventar posições.
 */

export type RivalState = 'racing' | 'finished'

export type GhostSnapshot = {
  /** Instante da medição, no relógio do servidor. */
  t: number
  progress: number
  lateral: number
  speed: number
  state: RivalState
}

export type GhostSample = {
  progress: number
  lateral: number
  speed: number
  state: RivalState
  /** Verdadeiro quando não chega telemetria nova há tempo demais. */
  stale: boolean
}

/** Atraso de renderização: desenhamos o fantasma neste passado recente. */
export const INTERPOLATION_DELAY_MS = 160
/** Tempo máximo que aceitamos projetar o movimento sem dados novos. */
export const MAX_EXTRAPOLATION_MS = 600
/** Quantas medições guardamos para interpolar. */
export const BUFFER_SIZE = 24
/** Intervalo de envio da telemetria. */
export const TELEMETRY_INTERVAL_MS = 100

export class GhostTracker {
  private buffer: GhostSnapshot[] = []
  /** O progresso mostrado nunca recua: medições atrasadas não puxam o carro para trás. */
  private shownProgress = 0

  /** Guarda uma medição, aceitando chegada fora de ordem. */
  push(snapshot: GhostSnapshot) {
    if (!Number.isFinite(snapshot.t) || !Number.isFinite(snapshot.progress)) return
    if (this.buffer.some((item) => item.t === snapshot.t)) return

    let index = this.buffer.length
    while (index > 0 && this.buffer[index - 1].t > snapshot.t) index -= 1
    this.buffer.splice(index, 0, snapshot)
    if (this.buffer.length > BUFFER_SIZE) this.buffer.splice(0, this.buffer.length - BUFFER_SIZE)
  }

  /** Posição do fantasma no instante pedido, já suavizada. */
  sample(now: number): GhostSample | null {
    if (this.buffer.length === 0) return null
    const target = now - INTERPOLATION_DELAY_MS
    const newest = this.buffer[this.buffer.length - 1]
    const oldest = this.buffer[0]

    let raw: GhostSample
    if (target <= oldest.t) {
      raw = { ...toSample(oldest), stale: false }
    } else if (target >= newest.t) {
      const ahead = target - newest.t
      const projected = Math.min(ahead, MAX_EXTRAPOLATION_MS)
      raw = {
        progress: newest.progress + (newest.state === 'finished' ? 0 : (newest.speed / 3.6) * (projected / 1000)),
        lateral: newest.lateral,
        speed: newest.speed,
        state: newest.state,
        stale: ahead > MAX_EXTRAPOLATION_MS,
      }
    } else {
      raw = { ...this.interpolate(target), stale: false }
    }

    this.shownProgress = Math.max(this.shownProgress, raw.progress)
    return { ...raw, progress: this.shownProgress }
  }

  get latest() {
    return this.buffer.length > 0 ? this.buffer[this.buffer.length - 1] : null
  }

  reset() {
    this.buffer = []
    this.shownProgress = 0
  }

  private interpolate(target: number): Omit<GhostSample, 'stale'> {
    let after = this.buffer.length - 1
    while (after > 0 && this.buffer[after - 1].t > target) after -= 1
    const next = this.buffer[after]
    const previous = this.buffer[after - 1] ?? next
    const span = next.t - previous.t
    const ratio = span > 0 ? (target - previous.t) / span : 1

    return {
      progress: previous.progress + (next.progress - previous.progress) * ratio,
      lateral: previous.lateral + (next.lateral - previous.lateral) * ratio,
      speed: previous.speed + (next.speed - previous.speed) * ratio,
      state: ratio >= 1 ? next.state : previous.state,
    }
  }
}

function toSample(snapshot: GhostSnapshot): Omit<GhostSample, 'stale'> {
  return {
    progress: snapshot.progress,
    lateral: snapshot.lateral,
    speed: snapshot.speed,
    state: snapshot.state,
  }
}

export type RivalGap = {
  /** Positivo quando o rival está à frente. */
  meters: number
  seconds: number
  ahead: boolean
  /** P1 quando o jogador lidera. */
  position: 'P1' | 'P2'
}

/**
 * Diferença entre os dois carros. Os segundos usam o ritmo médio da dupla,
 * com um piso para o número não explodir quando alguém está quase parado.
 */
export function gapBetween(
  playerProgress: number,
  rivalProgress: number,
  playerSpeed: number,
  rivalSpeed: number,
): RivalGap {
  const meters = rivalProgress - playerProgress
  const pace = Math.max(15, (playerSpeed + rivalSpeed) / 2 / 3.6)
  return {
    meters,
    seconds: Math.abs(meters) / pace,
    ahead: meters > 0,
    position: meters > 0 ? 'P2' : 'P1',
  }
}

export type RivalSide = 'esquerda' | 'direita' | 'mesma faixa'

export function rivalSide(playerLateral: number, rivalLateral: number): RivalSide {
  const difference = rivalLateral - playerLateral
  if (Math.abs(difference) < 0.12) return 'mesma faixa'
  return difference < 0 ? 'esquerda' : 'direita'
}

/** Texto do indicador usado quando o rival não aparece na tela. */
export function offScreenNotice(gap: RivalGap, side: RivalSide) {
  const direction = gap.ahead ? 'à frente' : 'atrás'
  const distance = `${Math.round(Math.abs(gap.meters))} m`
  return side === 'mesma faixa'
    ? `Adversário ${direction} — ${distance}`
    : `Adversário ${direction} — lado ${side} — ${distance}`
}

/** Texto da posição, no formato dos exemplos do plano. */
export function positionNotice(gap: RivalGap) {
  const direction = gap.ahead ? 'à frente' : 'atrás'
  return `${gap.position} — Rival ${gap.seconds.toFixed(1).replace('.', ',')} s ${direction}`
}
