import { describe, expect, it } from 'vitest'
import { RitmoDoQuadro, type Decisao } from './ritmoDoQuadro'

type Aparelho = {
  /** Densidade do canvas sem ajuste. */
  densidade: number
  /** Período da tela, em ms: 16,7 a 60 Hz, 8,3 a 120 Hz. */
  periodo: number
  /** Quanto o aparelho leva para fazer um quadro, nesta densidade. */
  trabalho: (densidade: number) => number
  segundos: number
  /** Engasgos: a cada tantos ms, um quadro que leva `duracao`. */
  engasgo?: { cada: number; duracao: number }
}

/**
 * Um aparelho de mentira. O navegador chama o quadro no ritmo da tela, mas só
 * quando o anterior já saiu; com o desenho em paralelo ao quadro seguinte, o
 * ritmo médio é o do trabalho, arredondado para as batidas da tela.
 */
function simular(aparelho: Aparelho) {
  const ritmo = new RitmoDoQuadro(aparelho.densidade)
  const decisoes: Decisao[] = []
  const desenhos: number[] = []
  let agora = 0
  let ultimoDesenho = 0
  let credito = 0
  let proximoEngasgo = aparelho.engasgo?.cada ?? Infinity
  while (agora < aparelho.segundos * 1000) {
    agora += aparelho.periodo
    if (agora >= proximoEngasgo) {
      agora += aparelho.engasgo!.duracao
      proximoEngasgo += aparelho.engasgo!.cada
    }
    const custo = aparelho.trabalho(ritmo.densidade)
    credito = Math.min(credito + aparelho.periodo, custo + aparelho.periodo)
    if (credito < custo) continue
    if (ritmo.pular(agora - ultimoDesenho)) continue
    credito -= custo
    const decisao = ritmo.registrar(agora - ultimoDesenho, agora)
    if (decisao !== 'nada') decisoes.push(decisao)
    ultimoDesenho = agora
    desenhos.push(agora)
  }
  // Quadros por segundo nos últimos cinco segundos.
  const fim = aparelho.segundos * 1000
  const fps = desenhos.filter((t) => t > fim - 5_000).length / 5
  return { ritmo, decisoes, fps }
}

/** Aparelho limitado pelos pixels: o trabalho cai com o quadrado da densidade. */
const pelosPixels = (msEmDensidade2: number) => (densidade: number) => msEmDensidade2 * (densidade / 2) ** 2

describe('ritmo e resolução do quadro', () => {
  it('o aparelho que fecha 60 quadros não muda nada', () => {
    const { ritmo, decisoes } = simular({ densidade: 2, periodo: 1000 / 60, trabalho: () => 10, segundos: 30 })
    expect(decisoes).toEqual([])
    expect(ritmo.densidade).toBe(2)
  })

  it('o de 120 Hz que fecha 120 também não', () => {
    const { ritmo, decisoes } = simular({ densidade: 2, periodo: 1000 / 120, trabalho: () => 6, segundos: 30 })
    expect(decisoes).toEqual([])
    expect(ritmo.densidade).toBe(2)
  })

  it('engasgos soltos não contam', () => {
    const { decisoes } = simular({
      densidade: 2,
      periodo: 1000 / 60,
      trabalho: () => 10,
      segundos: 30,
      engasgo: { cada: 2_500, duracao: 220 },
    })
    expect(decisoes).toEqual([])
  })

  it('o fraco limitado pelos pixels desce até fechar o quadro, e fica', () => {
    const { ritmo, decisoes, fps } = simular({ densidade: 2, periodo: 1000 / 60, trabalho: pelosPixels(28), segundos: 30 })
    expect(decisoes).toEqual(['densidade', 'densidade'])
    expect(ritmo.densidade).toBe(1.5)
    expect(fps).toBeGreaterThan(55)
  })

  it('o limitado pelo processador desce, não melhora, volta e trava', () => {
    const { ritmo, decisoes } = simular({ densidade: 2, periodo: 1000 / 60, trabalho: () => 30, segundos: 30 })
    expect(decisoes).toEqual(['densidade', 'densidade'])
    expect(ritmo.densidade).toBe(2)
  })

  it('preso em 30 Hz pela economia de bateria, volta à nitidez', () => {
    const { ritmo, decisoes } = simular({ densidade: 2, periodo: 1000 / 30, trabalho: () => 8, segundos: 30 })
    expect(decisoes).toEqual(['densidade', 'densidade'])
    expect(ritmo.densidade).toBe(2)
  })

  it('a tela de 120 Hz que não acompanha passa a 60 constantes, na mesma densidade', () => {
    const { ritmo, decisoes, fps } = simular({ densidade: 2, periodo: 1000 / 120, trabalho: () => 11, segundos: 30 })
    expect(decisoes).toEqual(['limitar'])
    expect(ritmo.densidade).toBe(2)
    expect(fps).toBeGreaterThan(58)
    expect(fps).toBeLessThan(62)
  })

  it('a tela de 90 Hz não é limitada: 60 ali não seria ritmo constante', () => {
    const { decisoes } = simular({ densidade: 2, periodo: 1000 / 90, trabalho: () => 14, segundos: 30 })
    expect(decisoes).not.toContain('limitar')
  })

  it('nunca desce abaixo de 1, nem de onde o aparelho já está', () => {
    const umPraUm = simular({ densidade: 1, periodo: 1000 / 60, trabalho: () => 40, segundos: 30 })
    expect(umPraUm.decisoes).toEqual([])
    expect(umPraUm.ritmo.densidade).toBe(1)

    const meio = simular({ densidade: 1.5, periodo: 1000 / 60, trabalho: pelosPixels(60), segundos: 60 })
    expect(meio.ritmo.densidade).toBeGreaterThanOrEqual(1)
    expect(meio.ritmo.densidade).toBeLessThan(1.5)
  })

  it('só pula quadro com a tela rápida limitada', () => {
    const ritmo = new RitmoDoQuadro(2)
    expect(ritmo.pular(8)).toBe(false)
  })
})
