import { describe, expect, it } from 'vitest'
import { createRaceContext, createTrackLayout } from './layout'
import { desviando, tangenciando } from './piloto'
import { DIFFICULTIES } from './rules'
import { createRaceState, stepRace } from './simulation'

describe('pilotos de referência', () => {
  it('quem desvia escolhe um lado e fica nele, sem vai e vem', () => {
    // Um piloto que troca de lado a cada instante paga em aderência pelo
    // próprio zigue-zague, e o teste que o usa passa a medir o castigo do
    // volante em vez do desvio. Foi o que aconteceu: a primeira versão trocava
    // de lado até oito vezes por segundo e saía mais lenta do que quem batia
    // em tudo, o que fazia o reset parecer inútil.
    for (const nivel of DIFFICULTIES) {
      const state = createRaceState(nivel)
      const piloto = desviando()
      let trocas = 0
      let ultimo = 0
      let somaDaAderencia = 0
      let quadros = 0
      for (let t = 0; t < 300 && !state.finished; t += 1 / 60) {
        const input = piloto(state)
        const comando = Number(input.right) - Number(input.left)
        if (comando !== 0 && ultimo !== 0 && comando !== ultimo) trocas += 1
        if (comando !== 0) ultimo = comando
        stepRace(state, input, 1 / 60)
        somaDaAderencia += state.grip
        quadros += 1
      }
      expect(state.finished, nivel).toBe(true)
      expect(trocas, nivel).toBeLessThan(30)
      expect(somaDaAderencia / quadros, nivel).toBeGreaterThan(0.98)
      // E desvia de verdade: numa pista reta, quase nada o atinge.
      expect(state.collisions, nivel).toBeLessThanOrEqual(3)
    }
  })

  it('quem faz a tangência solta o boost antes da super curva e entra por dentro', () => {
    const layout = createTrackLayout(42)
    const state = createRaceState('normal')
    const piloto = tangenciando(layout.superCurves, true)
    const context = createRaceContext(layout)
    const curva = layout.superCurves[0]
    let boostNaEntrada = true
    let ladoNaEntrada = 0
    for (let t = 0; t < 300 && state.progress < curva.start; t += 1 / 60) {
      const input = piloto(state)
      if (state.progress > curva.start - 40) {
        boostNaEntrada = input.boost
        ladoNaEntrada = state.lateral * curva.side
      }
      stepRace(state, input, 1 / 60, context)
    }
    expect(boostNaEntrada).toBe(false)
    expect(ladoNaEntrada).toBeGreaterThan(0.8)
  })

  it('cada chamada devolve um piloto com a própria memória', () => {
    const a = desviando()
    const b = desviando()
    expect(a).not.toBe(b)
  })
})
