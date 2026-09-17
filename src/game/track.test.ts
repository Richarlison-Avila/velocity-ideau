import { describe, expect, it } from 'vitest'
import { formatTime, speedForState } from './track'

describe('regras básicas da corrida', () => {
  it('formata o cronômetro', () => {
    expect(formatTime(65.234)).toBe('1:05.234')
  })

  it('prioriza a redução de velocidade fora da pista', () => {
    expect(speedForState(true, 0, true)).toBe(132)
  })

  it('aplica boost quando o carro está livre', () => {
    expect(speedForState(false, 0, true)).toBe(314)
  })
})
