import type { Socket } from 'socket.io-client'

export type ClockSample = {
  /** Diferença estimada entre o relógio do servidor e o relógio local, em ms. */
  offset: number
  /** Tempo de ida e volta da amostra, em ms. */
  roundTrip: number
}

export type ClockState = ClockSample & { synced: boolean; samples: number }

/**
 * Estima a diferença entre os relógios assumindo que a ida e a volta
 * levaram o mesmo tempo (algoritmo usado pelo NTP em sua forma simples).
 */
export function estimateOffset(clientSentAt: number, serverTime: number, clientReceivedAt: number): ClockSample {
  const roundTrip = Math.max(0, clientReceivedAt - clientSentAt)
  return { offset: serverTime + roundTrip / 2 - clientReceivedAt, roundTrip }
}

/**
 * Quanto o relógio estimado precisa avançar para não ficar atrás de um horário
 * que o servidor já havia registrado quando enviou a mensagem.
 */
export function guardCorrection(estimatedServerNow: number, serverTime: number) {
  return Math.max(0, serverTime - estimatedServerNow)
}

/** A amostra mais confiável é a que teve o menor tempo de ida e volta. */
export function pickBestSample(samples: ClockSample[]): ClockSample | null {
  if (samples.length === 0) return null
  return samples.reduce((best, sample) => (sample.roundTrip < best.roundTrip ? sample : best))
}

const SYNC_SAMPLES = 5
const SYNC_INTERVAL_MS = 120
const SYNC_TIMEOUT_MS = 2_000

export class ServerClock {
  private state: ClockState = { offset: 0, roundTrip: 0, synced: false, samples: 0 }
  private listeners = new Set<(state: ClockState) => void>()
  private running = false

  /** Horário estimado do servidor, usado para a largada e o cronômetro. */
  now = () => Date.now() + this.state.offset

  get snapshot() {
    return this.state
  }

  subscribe(listener: (state: ClockState) => void) {
    this.listeners.add(listener)
    listener(this.state)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Correção de segurança a partir de uma mensagem enviada pelo servidor.
   * Se o servidor já marcava `serverTime` quando enviou, o relógio estimado
   * nunca pode estar atrás disso — caso esteja, a largada sairia atrasada.
   */
  guard(serverTime: number) {
    const correction = guardCorrection(this.now(), serverTime)
    if (correction === 0) return
    this.apply({ offset: this.state.offset + correction, roundTrip: this.state.roundTrip }, this.state.samples)
  }

  async sync(socket: Socket, samples = SYNC_SAMPLES) {
    if (this.running) return this.state
    this.running = true
    const collected: ClockSample[] = []

    try {
      for (let index = 0; index < samples; index += 1) {
        const sample = await this.requestSample(socket)
        if (sample) collected.push(sample)
        if (index < samples - 1) await delay(SYNC_INTERVAL_MS)
      }
    } finally {
      this.running = false
    }

    const best = pickBestSample(collected)
    if (best) this.apply(best, collected.length)
    return this.state
  }

  reset() {
    this.state = { offset: 0, roundTrip: 0, synced: false, samples: 0 }
    this.emit()
  }

  private apply(sample: ClockSample, samples: number) {
    this.state = { ...sample, synced: true, samples }
    this.emit()
  }

  private emit() {
    for (const listener of this.listeners) listener(this.state)
  }

  private requestSample(socket: Socket) {
    return new Promise<ClockSample | null>((resolve) => {
      if (!socket.connected) return resolve(null)
      const clientSentAt = Date.now()
      let settled = false
      const timer = window.setTimeout(() => {
        if (settled) return
        settled = true
        resolve(null)
      }, SYNC_TIMEOUT_MS)

      socket.emit('time:sync', { clientSentAt }, (response: { serverTime: number } | undefined) => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        if (!response?.serverTime) return resolve(null)
        resolve(estimateOffset(clientSentAt, response.serverTime, Date.now()))
      })
    })
  }
}

function delay(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms))
}

export const serverClock = new ServerClock()
