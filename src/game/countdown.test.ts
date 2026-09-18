import { describe, expect, it } from 'vitest'
import { countdownAt, lateBy, LIGHT_COUNT } from './countdown'

const COUNTDOWN = 5_400
const START = 100_000

describe('sequência das cinco luzes', () => {
  it('mostra o preparo antes da primeira luz', () => {
    const state = countdownAt(START - COUNTDOWN, START, COUNTDOWN)
    expect(state.phase).toBe('prepare')
    expect(state.lights).toBe(0)
  })

  it('acende uma luz a cada intervalo', () => {
    const interval = COUNTDOWN / (LIGHT_COUNT + 1)
    const acesas = [5, 4, 3, 2, 1].map((faltando) => countdownAt(START - faltando * interval, START, COUNTDOWN).lights)
    expect(acesas).toEqual([1, 2, 3, 4, 5])
  })

  it('mantém as cinco acesas até o instante da largada', () => {
    expect(countdownAt(START - 1, START, COUNTDOWN).lights).toBe(5)
    expect(countdownAt(START - 1, START, COUNTDOWN).phase).toBe('lights')
  })

  it('apaga tudo e libera a corrida no instante combinado', () => {
    const state = countdownAt(START, START, COUNTDOWN)
    expect(state.phase).toBe('go')
    expect(state.lights).toBe(0)
  })

  it('dois dispositivos com o mesmo relógio veem a mesma luz', () => {
    const interval = COUNTDOWN / (LIGHT_COUNT + 1)
    for (let passo = 0; passo <= 12; passo += 1) {
      const agora = START - COUNTDOWN + (passo * interval) / 2
      const pilotoA = countdownAt(agora, START, COUNTDOWN)
      const pilotoB = countdownAt(agora, START, COUNTDOWN)
      expect(pilotoA).toEqual(pilotoB)
    }
  })

  it('uma diferença de relógio menor que o intervalo altera no máximo uma luz', () => {
    const interval = COUNTDOWN / (LIGHT_COUNT + 1)
    for (let passo = 0; passo < 40; passo += 1) {
      const agora = START - COUNTDOWN + passo * 135
      const comAtraso = countdownAt(agora - interval * 0.9, START, COUNTDOWN)
      const semAtraso = countdownAt(agora, START, COUNTDOWN)
      expect(Math.abs(semAtraso.lights - comAtraso.lights)).toBeLessThanOrEqual(1)
    }
  })

  it('reconhece a largada perdida por quem chegou atrasado', () => {
    expect(lateBy(START + 2_500, START)).toBeCloseTo(2.5)
    expect(lateBy(START - 2_500, START)).toBe(0)
  })
})
