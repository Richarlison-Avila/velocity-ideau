import { describe, expect, it } from 'vitest'
import {
  COMPASSOS_POR_SECAO,
  DURACAO_DO_PASSO,
  eventosDoPasso,
  frequenciaDaNota,
  PASSOS_DA_TRILHA,
  PASSOS_POR_COMPASSO,
  ROTEIRO,
  TRILHA_BPM,
} from './trilha'

/** Todos os passos da trilha, uma volta inteira. */
const TODOS = Array.from({ length: PASSOS_DA_TRILHA }, (_, passo) => ({ passo, e: eventosDoPasso(passo) }))

/** Classes de altura de mi menor natural: mi, fá sustenido, sol, lá, si, dó, ré. */
const MI_MENOR = new Set([4, 6, 7, 9, 11, 0, 2])

describe('trilha: forma', () => {
  it('é rock de corrida: 150 batidas por minuto, em semicolcheias', () => {
    expect(TRILHA_BPM).toBe(150)
    expect(DURACAO_DO_PASSO).toBeCloseTo(0.1, 9)
    expect(PASSOS_POR_COMPASSO).toBe(16)
  })

  it('tem quatro seções de oito compassos, e dura menos que uma prova', () => {
    expect(ROTEIRO).toEqual(['estrofe', 'refrao', 'estrofe', 'ponte'])
    expect(PASSOS_DA_TRILHA).toBe(ROTEIRO.length * COMPASSOS_POR_SECAO * PASSOS_POR_COMPASSO)
    // Cinquenta e um segundos: uma prova de um minuto e pouco ouve o refrão
    // pelo menos uma vez, e a volta da trilha não chega a cansar.
    expect(PASSOS_DA_TRILHA * DURACAO_DO_PASSO).toBeCloseTo(51.2, 6)
  })

  it('dá a volta sem emenda: o passo depois do último é o primeiro', () => {
    for (const passo of [0, 1, 17, 255, PASSOS_DA_TRILHA - 1]) {
      expect(eventosDoPasso(passo + PASSOS_DA_TRILHA)).toEqual(eventosDoPasso(passo))
      expect(eventosDoPasso(passo - PASSOS_DA_TRILHA)).toEqual(eventosDoPasso(passo))
    }
  })

  it('trata lixo como o primeiro passo, sem silêncio nem exceção', () => {
    expect(eventosDoPasso(Number.NaN)).toEqual(eventosDoPasso(0))
    expect(eventosDoPasso(Number.POSITIVE_INFINITY)).toEqual(eventosDoPasso(0))
    expect(eventosDoPasso(3.7)).toEqual(eventosDoPasso(3))
  })

  it('a frequência das notas é a do lá 440', () => {
    expect(frequenciaDaNota(69)).toBeCloseTo(440, 9)
    expect(frequenciaDaNota(81)).toBeCloseTo(880, 9)
    expect(frequenciaDaNota(52)).toBeCloseTo(164.81, 2)
  })
})

describe('trilha: bateria', () => {
  it('a caixa bate nos tempos dois e quatro de todo compasso', () => {
    for (const { passo, e } of TODOS) {
      const noCompasso = passo % PASSOS_POR_COMPASSO
      if (noCompasso === 4 || noCompasso === 12) expect(e.caixa, `passo ${passo}`).toBeGreaterThan(0)
    }
  })

  it('o bumbo marca o primeiro tempo de todo compasso', () => {
    for (const { passo, e } of TODOS) {
      if (passo % PASSOS_POR_COMPASSO === 0) expect(e.bumbo, `passo ${passo}`).toBeGreaterThan(0)
    }
  })

  it('o prato abre cada seção, e só elas', () => {
    const pratos = TODOS.filter(({ e }) => e.prato).map(({ passo }) => passo)
    expect(pratos).toEqual(ROTEIRO.map((_, i) => i * COMPASSOS_POR_SECAO * PASSOS_POR_COMPASSO))
  })

  it('toda seção termina numa virada de caixa que cresce', () => {
    for (let secao = 0; secao < ROTEIRO.length; secao += 1) {
      const fim = (secao + 1) * COMPASSOS_POR_SECAO * PASSOS_POR_COMPASSO
      const virada = [fim - 4, fim - 3, fim - 2, fim - 1].map((passo) => eventosDoPasso(passo).caixa)
      for (let i = 1; i < virada.length; i += 1) expect(virada[i]).toBeGreaterThan(virada[i - 1])
      expect(virada[3]).toBeCloseTo(1, 9)
    }
  })

  it('as intensidades ficam entre zero e um', () => {
    for (const { e } of TODOS) {
      for (const valor of [e.bumbo, e.caixa, e.chimbal]) {
        expect(valor).toBeGreaterThanOrEqual(0)
        expect(valor).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('trilha: harmonia e melodia', () => {
  it('toda nota está em mi menor, com o ré sustenido só sobre o si maior', () => {
    for (const { passo, e } of TODOS) {
      const notas = [e.baixo?.nota, e.guitarra?.raiz, e.solo?.nota].filter((nota): nota is number => nota !== undefined)
      for (const nota of notas) {
        const classe = ((nota % 12) + 12) % 12
        if (classe === 3) {
          // Ré sustenido: a sensível, e só no último compasso do refrão.
          expect(e.secao, `passo ${passo}`).toBe('refrao')
          expect(e.compasso, `passo ${passo}`).toBe(COMPASSOS_POR_SECAO - 1)
        } else {
          expect(MI_MENOR.has(classe), `passo ${passo}, nota ${nota}`).toBe(true)
        }
      }
    }
  })

  it('o baixo segue a raiz da guitarra, uma oitava abaixo ou na mesma nota', () => {
    for (const { passo, e } of TODOS) {
      if (!e.baixo || !e.guitarra) continue
      const diferenca = e.guitarra.raiz - e.baixo.nota
      expect([0, 12], `passo ${passo}`).toContain(diferenca)
    }
  })

  it('a estrofe galopa abafada, e o refrão deixa o acorde soar', () => {
    const estrofe = TODOS.filter(({ e }) => e.secao === 'estrofe' && e.guitarra)
    const refrao = TODOS.filter(({ e }) => e.secao === 'refrao' && e.guitarra)
    const abafadas = (lista: typeof TODOS) => lista.filter(({ e }) => e.guitarra!.abafada).length / lista.length
    expect(abafadas(estrofe)).toBeGreaterThan(0.8)
    expect(abafadas(refrao)).toBe(0)
    // O galope: colcheia e duas semicolcheias, doze golpes por compasso.
    expect(estrofe.filter(({ e }) => e.compasso === 0).length / 2).toBe(12)
  })

  it('o solo só toca no refrão, e cada compasso dele fecha em dezesseis passos', () => {
    for (const { passo, e } of TODOS) {
      if (e.solo) expect(e.secao, `passo ${passo}`).toBe('refrao')
    }
    const inicioDoRefrao = ROTEIRO.indexOf('refrao') * COMPASSOS_POR_SECAO * PASSOS_POR_COMPASSO
    for (let compasso = 0; compasso < COMPASSOS_POR_SECAO; compasso += 1) {
      let soma = 0
      for (let passo = 0; passo < PASSOS_POR_COMPASSO; passo += 1) {
        soma += eventosDoPasso(inicioDoRefrao + compasso * PASSOS_POR_COMPASSO + passo).solo?.passos ?? 0
      }
      expect(soma, `compasso ${compasso}`).toBe(PASSOS_POR_COMPASSO)
    }
  })

  it('o solo fica na região que o alto-falante de um celular reproduz', () => {
    for (const { e } of TODOS) {
      if (!e.solo) continue
      expect(frequenciaDaNota(e.solo.nota)).toBeGreaterThan(400)
      expect(frequenciaDaNota(e.solo.nota)).toBeLessThan(1_000)
    }
  })
})
