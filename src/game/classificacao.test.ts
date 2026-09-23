import { describe, expect, it } from 'vitest'
import { classificar, diferencaEmSegundos, formatarDiferenca, liderEmProva, type CarroNaProva } from './classificacao'

const carro = (id: string, progress: number, extra: Partial<CarroNaProva> = {}): CarroNaProva => ({
  id,
  progress,
  speed: 252,
  state: 'racing',
  ...extra,
})

describe('classificação ao vivo', () => {
  it('ordena quem corre pelo progresso', () => {
    const ordem = classificar([carro('a', 100), carro('b', 300), carro('c', 200)])
    expect(ordem.map((c) => [c.id, c.posicao])).toEqual([['b', 1], ['c', 2], ['a', 3]])
  })

  it('quem chegou vem antes, pela ordem de chegada, mesmo com o mesmo progresso', () => {
    const ordem = classificar([
      carro('corre', 4_700),
      carro('segundo', 4_800, { state: 'finished', chegadaEm: 2_000 }),
      carro('primeiro', 4_800, { state: 'finished', chegadaEm: 1_000 }),
    ])
    expect(ordem.map((c) => c.id)).toEqual(['primeiro', 'segundo', 'corre'])
  })

  it('o empate não troca de ordem a cada quadro', () => {
    const uma = classificar([carro('b', 100), carro('a', 100)]).map((c) => c.id)
    const outra = classificar([carro('a', 100), carro('b', 100)]).map((c) => c.id)
    expect(uma).toEqual(outra)
  })

  it('não mexe na lista recebida', () => {
    const lista = [carro('a', 1), carro('b', 2)]
    classificar(lista)
    expect(lista.map((c) => c.id)).toEqual(['a', 'b'])
  })
})

describe('diferença entre dois carros', () => {
  it('70 m à frente a 252 km/h é um segundo', () => {
    expect(diferencaEmSegundos(carro('eu', 0), carro('ele', 70))).toBeCloseTo(1, 2)
    expect(diferencaEmSegundos(carro('eu', 70), carro('ele', 0))).toBeCloseTo(-1, 2)
  })

  it('entre dois que chegaram, vale a diferença de chegada', () => {
    const eu = carro('eu', 4_800, { state: 'finished', chegadaEm: 5_000 })
    const ele = carro('ele', 4_800, { state: 'finished', chegadaEm: 3_500 })
    expect(diferencaEmSegundos(eu, ele)).toBeCloseTo(1.5, 5)
  })

  it('não explode com os carros quase parados', () => {
    expect(Math.abs(diferencaEmSegundos(carro('eu', 0, { speed: 0 }), carro('ele', 30, { speed: 0 })))).toBeLessThan(3)
  })

  it('escreve com vírgula e sinal de menos de verdade', () => {
    expect(formatarDiferenca(1.24)).toBe('+1,2')
    expect(formatarDiferenca(-0.8)).toBe('−0,8')
    expect(formatarDiferenca(75)).toBe('+1:15')
  })
})

describe('câmera automática do espectador', () => {
  it('segue o líder entre quem ainda corre', () => {
    const ordem = classificar([
      carro('chegou', 4_800, { state: 'finished', chegadaEm: 1 }),
      carro('lider', 3_000),
      carro('segundo', 2_000),
    ])
    expect(liderEmProva(ordem)?.id).toBe('lider')
  })

  it('com todos na chegada, fica com o vencedor', () => {
    const ordem = classificar([
      carro('b', 4_800, { state: 'finished', chegadaEm: 2 }),
      carro('a', 4_800, { state: 'finished', chegadaEm: 1 }),
    ])
    expect(liderEmProva(ordem)?.id).toBe('a')
  })

  it('sem carros, sem câmera', () => {
    expect(liderEmProva([])).toBeNull()
  })
})
