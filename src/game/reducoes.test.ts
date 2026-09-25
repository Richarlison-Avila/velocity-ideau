import { describe, expect, it } from 'vitest'
import { nivelDaReducao } from './reducoes'

describe('escolha da redução da folha', () => {
  it('ampliando, ou do mesmo tamanho, fica a folha cheia', () => {
    expect(nivelDaReducao(0.4, 5)).toBe(0)
    expect(nivelDaReducao(1, 5)).toBe(0)
  })

  it('a redução que sobra para a suavização comum fica entre 0,81 e 1,62 vez', () => {
    for (let reducao = 1.01; reducao < 40; reducao *= 1.07) {
      const nivel = nivelDaReducao(reducao, 12)
      const sobra = reducao / 2 ** nivel
      expect(sobra).toBeGreaterThan(0.8)
      expect(sobra).toBeLessThan(1.63)
    }
  })

  it('não passa da menor redução que a folha tem', () => {
    expect(nivelDaReducao(1_000, 5)).toBe(4)
    expect(nivelDaReducao(1_000, 1)).toBe(0)
  })

  it('número estragado não quebra a escolha', () => {
    expect(nivelDaReducao(Number.NaN, 5)).toBe(0)
    expect(nivelDaReducao(Infinity, 5)).toBe(4)
  })
})
