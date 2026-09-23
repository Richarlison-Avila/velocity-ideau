import { describe, expect, it } from 'vitest'
import { faixaDaCorrida } from './audio'
import { frequenciaDaNota } from './trilha'
import {
  eventosTurbo,
  TURBO_BPM,
  TURBO_COMPASSOS_POR_SECAO,
  TURBO_DURACAO_DO_PASSO,
  TURBO_PASSOS_DA_TRILHA,
  TURBO_PASSOS_POR_COMPASSO,
  TURBO_ROTEIRO,
} from './trilhaTurbo'

const TODOS = Array.from({ length: TURBO_PASSOS_DA_TRILHA }, (_, passo) => ({ passo, e: eventosTurbo(passo) }))

/** Classes de altura de lá maior: lá, si, dó sustenido, ré, mi, fá sustenido, sol sustenido. */
const LA_MAIOR = new Set([9, 11, 1, 2, 4, 6, 8])

const classe = (nota: number) => ((nota % 12) + 12) % 12

function notasDoPasso(e: ReturnType<typeof eventosTurbo>) {
  return [e.baixo, e.arpejo?.nota, e.lead?.nota, ...(e.metais?.notas ?? [])].filter(
    (nota): nota is number => typeof nota === 'number',
  )
}

describe('trilha turbo: forma', () => {
  it('é synth de corrida: 160 batidas por minuto, em semicolcheias', () => {
    expect(TURBO_BPM).toBe(160)
    expect(TURBO_DURACAO_DO_PASSO).toBeCloseTo(0.09375, 9)
    expect(TURBO_PASSOS_POR_COMPASSO).toBe(16)
  })

  it('tem quatro seções de oito compassos, 48 segundos', () => {
    expect(TURBO_ROTEIRO).toEqual(['tema', 'refrao', 'tema', 'ponte'])
    expect(TURBO_PASSOS_DA_TRILHA * TURBO_DURACAO_DO_PASSO).toBeCloseTo(48, 6)
  })

  it('dá a volta sem emenda e trata lixo como o primeiro passo', () => {
    for (const passo of [0, 5, 130, TURBO_PASSOS_DA_TRILHA - 1]) {
      expect(eventosTurbo(passo + TURBO_PASSOS_DA_TRILHA)).toEqual(eventosTurbo(passo))
      expect(eventosTurbo(passo - TURBO_PASSOS_DA_TRILHA)).toEqual(eventosTurbo(passo))
    }
    expect(eventosTurbo(Number.NaN)).toEqual(eventosTurbo(0))
    expect(eventosTurbo(7.9)).toEqual(eventosTurbo(7))
  })
})

describe('trilha turbo: bateria', () => {
  it('caixa no dois e no quatro, bumbo no um de todo compasso', () => {
    for (const { passo, e } of TODOS) {
      const noCompasso = passo % TURBO_PASSOS_POR_COMPASSO
      if (noCompasso === 4 || noCompasso === 12) expect(e.caixa, `passo ${passo}`).toBeGreaterThan(0)
      if (noCompasso === 0) expect(e.bumbo, `passo ${passo}`).toBeGreaterThan(0)
    }
  })

  it('o prato abre cada seção, e toda seção fecha numa virada que cresce', () => {
    const pratos = TODOS.filter(({ e }) => e.prato).map(({ passo }) => passo)
    expect(pratos).toEqual(TURBO_ROTEIRO.map((_, i) => i * TURBO_COMPASSOS_POR_SECAO * TURBO_PASSOS_POR_COMPASSO))
    for (let secao = 1; secao <= TURBO_ROTEIRO.length; secao += 1) {
      const fim = secao * TURBO_COMPASSOS_POR_SECAO * TURBO_PASSOS_POR_COMPASSO
      const virada = [fim - 4, fim - 3, fim - 2, fim - 1].map((passo) => eventosTurbo(passo).caixa)
      for (let i = 1; i < virada.length; i += 1) expect(virada[i]).toBeGreaterThan(virada[i - 1])
      expect(virada[3]).toBeCloseTo(1, 9)
    }
  })
})

describe('trilha turbo: harmonia e melodia', () => {
  it('tudo em lá maior, com o sol natural só nos compassos de sol da ponte', () => {
    for (const { passo, e } of TODOS) {
      for (const nota of notasDoPasso(e)) {
        if (classe(nota) === 7) {
          expect(e.secao, `passo ${passo}`).toBe('ponte')
          expect([4, 5], `passo ${passo}`).toContain(e.compasso)
        } else {
          expect(LA_MAIOR.has(classe(nota)), `passo ${passo}, nota ${nota}`).toBe(true)
        }
      }
    }
  })

  it('o baixo pula de oitava em semicolcheias fora das viradas', () => {
    for (const { passo, e } of TODOS) {
      const noCompasso = passo % TURBO_PASSOS_POR_COMPASSO
      if (e.compasso === TURBO_COMPASSOS_POR_SECAO - 1 && noCompasso >= 12) continue
      if (noCompasso % 2 === 1) {
        const antes = eventosTurbo(passo - 1).baixo!
        expect(e.baixo! - antes, `passo ${passo}`).toBe(12)
      }
    }
  })

  it('cada compasso de melodia fecha em dezesseis passos, e a ponte não tem lead', () => {
    for (const secao of ['tema', 'refrao'] as const) {
      const inicio = TURBO_ROTEIRO.indexOf(secao) * TURBO_COMPASSOS_POR_SECAO * TURBO_PASSOS_POR_COMPASSO
      for (let compasso = 0; compasso < TURBO_COMPASSOS_POR_SECAO; compasso += 1) {
        let soma = 0
        for (let passo = 0; passo < TURBO_PASSOS_POR_COMPASSO; passo += 1) {
          soma += eventosTurbo(inicio + compasso * TURBO_PASSOS_POR_COMPASSO + passo).lead?.passos ?? 0
        }
        expect(soma, `${secao}, compasso ${compasso}`).toBe(TURBO_PASSOS_POR_COMPASSO)
      }
    }
    for (const { e } of TODOS) if (e.secao === 'ponte') expect(e.lead).toBeNull()
  })

  it('o lead fica na faixa que um alto-falante de celular reproduz', () => {
    for (const { e } of TODOS) {
      if (!e.lead) continue
      expect(frequenciaDaNota(e.lead.nota)).toBeGreaterThan(400)
      expect(frequenciaDaNota(e.lead.nota)).toBeLessThan(1_200)
    }
  })
})

describe('faixa de cada corrida', () => {
  it('a semente escolhe, e as duas faixas aparecem', () => {
    expect(faixaDaCorrida(2)).toBe('rock')
    expect(faixaDaCorrida(3)).toBe('turbo')
    expect(faixaDaCorrida(Number.NaN)).toBe('rock')
    const faixas = new Set(Array.from({ length: 20 }, (_, i) => faixaDaCorrida(i * 7919)))
    expect(faixas).toEqual(new Set(['rock', 'turbo']))
  })
})
