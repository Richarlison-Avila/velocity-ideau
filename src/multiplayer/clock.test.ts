import { describe, expect, it } from 'vitest'
import { estimateOffset, guardCorrection, pickBestSample } from './clock'

describe('sincronização de relógio', () => {
  it('estima a diferença descontando metade da ida e volta', () => {
    // O servidor está 10 s à frente e a viagem levou 100 ms (50 ms em cada sentido).
    const clientSentAt = 1_000
    const clientReceivedAt = 1_100
    const serverTime = 11_050

    const sample = estimateOffset(clientSentAt, serverTime, clientReceivedAt)
    expect(sample.offset).toBe(10_000)
    expect(sample.roundTrip).toBe(100)
  })

  it('não aponta diferença quando os relógios estão iguais', () => {
    const sample = estimateOffset(5_000, 5_040, 5_080)
    expect(sample.offset).toBe(0)
  })

  it('protege contra horários fora de ordem', () => {
    const sample = estimateOffset(2_000, 2_000, 1_900)
    expect(sample.roundTrip).toBe(0)
  })

  it('escolhe a amostra com menor ida e volta', () => {
    const best = pickBestSample([
      { offset: 120, roundTrip: 400 },
      { offset: 98, roundTrip: 60 },
      { offset: 140, roundTrip: 220 },
    ])
    expect(best?.offset).toBe(98)
  })

  it('devolve nulo sem amostras', () => {
    expect(pickBestSample([])).toBeNull()
  })

  it('corrige o relógio quando a estimativa está atrás do servidor', () => {
    // O servidor já marcava 9.000 quando enviou; estimar 8.700 atrasaria a largada.
    expect(guardCorrection(8_700, 9_000)).toBe(300)
  })

  it('não adianta o relógio quando a estimativa já está à frente', () => {
    expect(guardCorrection(9_400, 9_000)).toBe(0)
  })
})
