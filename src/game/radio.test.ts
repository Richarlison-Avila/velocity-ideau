import { describe, expect, it } from 'vitest'
import { faixaDaCorrida } from './audio'
import {
  PASSOS_DO_COMPASSO,
  duracaoDoPasso,
  notaDaFrase,
  passosDaFrase,
  pontoDaForma,
  type EventosDaBanda,
  type Frase,
  type Partitura,
} from './banda'
import { INTERVALO_ENTRE_FAIXAS, PROGRAMACAO, indiceDaFaixa, proximaDaProgramacao } from './radio'
import { FORMA_LARGADA, FRASES_LARGADA, PARTITURA_LARGADA, eventosLargada } from './trilhaLargada'
import { FORMA_MOTOR_QUENTE, FRASES_MOTOR_QUENTE, PARTITURA_MOTOR_QUENTE, eventosMotorQuente } from './trilhaMotorQuente'
import { FORMA_ULTIMA_VOLTA, FRASES_ULTIMA_VOLTA, PARTITURA_ULTIMA_VOLTA, eventosUltimaVolta } from './trilhaUltimaVolta'

const classe = (nota: number) => ((nota % 12) + 12) % 12

/** Todas as notas que soam num passo, de qualquer instrumento. */
function notasDoPasso(e: EventosDaBanda) {
  const notas: number[] = []
  if (e.baixo) notas.push(e.baixo.nota)
  if (e.solo) notas.push(e.solo.nota)
  if (e.dedilhado) notas.push(e.dedilhado.nota)
  if (e.flauta) notas.push(e.flauta.nota)
  if (e.teclado) notas.push(...e.teclado.notas)
  if (e.guitarra) for (const i of e.guitarra.intervalos ?? [0, 7, 12]) notas.push(e.guitarra.raiz + i)
  return notas
}

type Faixa = {
  nome: string
  partitura: Partitura
  eventos: (passo: number) => EventosDaBanda & { secao: string; compasso: number }
  frases: readonly Frase[]
  /** Classes de altura permitidas: a escala da faixa, com as notas de passagem que ela usa. */
  escala: ReadonlySet<number>
  duracao: [number, number]
  /** Seções em meio tempo: a caixa bate no três, e não no dois e no quatro. */
  meioTempo?: ReadonlySet<string>
}

const FAIXAS: Faixa[] = [
  {
    nome: 'Motor Quente',
    partitura: PARTITURA_MOTOR_QUENTE,
    eventos: eventosMotorQuente,
    frases: FRASES_MOTOR_QUENTE,
    // Lá mixolídio com a terça menor e a nota de blues: lá, si, dó, dó
    // sustenido, ré, ré sustenido, mi, fá sustenido, sol, sol sustenido.
    escala: new Set([9, 11, 0, 1, 2, 3, 4, 6, 7, 8]),
    duracao: [70, 100],
  },
  {
    nome: 'Última Volta',
    partitura: PARTITURA_ULTIMA_VOLTA,
    eventos: eventosUltimaVolta,
    frases: FRASES_ULTIMA_VOLTA,
    // Lá menor, com o fá sustenido do ré dórico e o sol sustenido da dominante.
    escala: new Set([9, 11, 0, 2, 4, 5, 6, 7, 8]),
    duracao: [70, 100],
    meioTempo: new Set(['subida', 'final']),
  },
  {
    nome: 'Largada Queimada',
    partitura: PARTITURA_LARGADA,
    eventos: eventosLargada,
    frases: FRASES_LARGADA,
    // Ré maior.
    escala: new Set([2, 4, 6, 7, 9, 11, 1]),
    duracao: [55, 75],
  },
]

describe('ferramentas de partitura', () => {
  it('acha a nota que começa em cada passo, e a pausa não soa', () => {
    const frase: Frase = [[60, 4], [null, 4], [64, 8]]
    expect(notaDaFrase(frase, 0)).toEqual({ nota: 60, passos: 4 })
    expect(notaDaFrase(frase, 4)).toBeNull()
    expect(notaDaFrase(frase, 8)).toEqual({ nota: 64, passos: 8 })
    expect(notaDaFrase(frase, 2)).toBeNull()
    expect(passosDaFrase(frase)).toBe(16)
  })

  it('localiza o compasso na forma, contando quantas vezes cada seção já veio', () => {
    const forma = [['a', 2], ['b', 1], ['a', 2]] as const
    expect(pontoDaForma(forma, 0)).toMatchObject({ secao: 'a', compasso: 0, vez: 0, noCompasso: 0 })
    expect(pontoDaForma(forma, 2 * 16 + 3)).toMatchObject({ secao: 'b', compasso: 0, vez: 0, noCompasso: 3 })
    expect(pontoDaForma(forma, 3 * 16)).toMatchObject({ secao: 'a', compasso: 0, vez: 1 })
    // Dá a volta, e lixo é o primeiro passo.
    expect(pontoDaForma(forma, 5 * 16)).toEqual(pontoDaForma(forma, 0))
    expect(pontoDaForma(forma, -1)).toEqual(pontoDaForma(forma, 5 * 16 - 1))
    expect(pontoDaForma(forma, Number.NaN)).toEqual(pontoDaForma(forma, 0))
  })
})

describe.each(FAIXAS)('faixa $nome', ({ partitura, eventos, frases, escala, duracao, meioTempo }) => {
  const passos = Array.from({ length: partitura.passos }, (_, passo) => ({ passo, e: eventos(passo) }))

  it('dura o que uma prova aguenta, tocada uma vez', () => {
    const segundos = partitura.passos * duracaoDoPasso(partitura.bpm)
    expect(segundos).toBeGreaterThan(duracao[0])
    expect(segundos).toBeLessThan(duracao[1])
    expect(partitura.passos % PASSOS_DO_COMPASSO).toBe(0)
  })

  it('dá a volta sem emenda e trata lixo como o primeiro passo', () => {
    for (const passo of [0, 1, 17, partitura.passos - 1]) {
      expect(eventos(passo + partitura.passos)).toEqual(eventos(passo))
    }
    expect(eventos(Number.NaN)).toEqual(eventos(0))
    expect(eventos(3.7)).toEqual(eventos(3))
  })

  it('cada compasso de melodia fecha em dezesseis passos', () => {
    for (const [i, frase] of frases.entries()) expect(passosDaFrase(frase), `frase ${i}`).toBe(PASSOS_DO_COMPASSO)
  })

  it('toda nota está na escala da faixa', () => {
    for (const { passo, e } of passos) {
      for (const nota of notasDoPasso(e)) {
        expect(escala.has(classe(nota)), `passo ${passo} (${e.secao}): nota ${nota}`).toBe(true)
      }
    }
  })

  it('as intensidades da bateria ficam entre zero e um', () => {
    for (const { e } of passos) {
      for (const valor of [e.bumbo, e.caixa, e.chimbal]) {
        expect(valor).toBeGreaterThanOrEqual(0)
        expect(valor).toBeLessThanOrEqual(1)
      }
    }
  })

  it('a caixa marca o dois e o quatro — ou o três, em meio tempo — onde a banda toca', () => {
    let conferidos = 0
    for (const { e, passo } of passos) {
      const noCompasso = passo % PASSOS_DO_COMPASSO
      // Um compasso em que a bateria está tocando a batida: bumbo no um e
      // chimbal marcando o tempo. Viradas e compassos parados ficam de fora.
      if (noCompasso !== 0 || e.bumbo === 0 || e.chimbal === 0) continue
      const compasso = passos.slice(passo, passo + PASSOS_DO_COMPASSO).map(({ e: x }) => x)
      // Toda virada cala o chimbal a partir do passo 12.
      if (compasso[12].chimbal === 0) continue
      if (meioTempo?.has(e.secao)) {
        expect(compasso[8].caixa, `passo ${passo} (${e.secao})`).toBeGreaterThan(0)
      } else {
        expect(compasso[4].caixa, `passo ${passo} (${e.secao})`).toBeGreaterThan(0)
        expect(compasso[12].caixa, `passo ${passo} (${e.secao})`).toBeGreaterThan(0)
      }
      conferidos += 1
    }
    expect(conferidos).toBeGreaterThan(10)
  })

  it('a melodia fica na região que o alto-falante de um celular reproduz', () => {
    for (const { e } of passos) {
      for (const nota of [e.solo?.nota, e.flauta?.nota].filter((n): n is number => typeof n === 'number')) {
        expect(nota).toBeGreaterThanOrEqual(60)
        expect(nota).toBeLessThanOrEqual(96)
      }
    }
  })

  it('o prato abre a faixa', () => {
    const abertura = passos.slice(0, PASSOS_DO_COMPASSO * 4).some(({ e }) => e.prato || e.dedilhado)
    expect(abertura).toBe(true)
  })
})

describe('formas', () => {
  it('a épica começa sem bateria e termina com o tema de volta', () => {
    const abertura = Array.from({ length: 16 * PASSOS_DO_COMPASSO }, (_, passo) => eventosUltimaVolta(passo))
    expect(abertura.every((e) => e.bumbo === 0 && e.caixa === 0 && !e.guitarra)).toBe(true)
    expect(abertura.some((e) => e.flauta)).toBe(true)
    const tempestade = Array.from({ length: 16 * PASSOS_DO_COMPASSO }, (_, i) => eventosUltimaVolta(24 * 16 + i))
    expect(tempestade.every((e) => e.secao === 'tempestade')).toBe(true)
    expect(tempestade.filter((e) => e.caixa > 0).length).toBeGreaterThan(30)
    expect(FORMA_ULTIMA_VOLTA.map(([s]) => s)).toEqual(['abertura', 'subida', 'tempestade', 'final'])
  })

  it('o boogie segue a forma de blues de doze compassos', () => {
    const estrofe = FORMA_MOTOR_QUENTE.find(([s]) => s === 'estrofe')
    expect(estrofe?.[1]).toBe(12)
  })

  it('na ponte do punk a banda só bate junto e se cala', () => {
    const inicio = FORMA_LARGADA.slice(0, FORMA_LARGADA.findIndex(([s]) => s === 'ponte')).reduce((s, [, c]) => s + c, 0)
    const ponte = Array.from({ length: 3 * PASSOS_DO_COMPASSO }, (_, i) => eventosLargada(inicio * 16 + i))
    const golpes = ponte.filter((e) => e.guitarra)
    expect(golpes.length).toBe(6)
    expect(golpes.every((e) => e.bumbo === 1 && e.prato)).toBe(true)
  })
})

describe('programação da rádio', () => {
  it('tem as cinco faixas, cada uma uma vez', () => {
    expect(PROGRAMACAO).toHaveLength(5)
    expect(new Set(PROGRAMACAO.map((f) => f.id)).size).toBe(5)
    for (const faixa of PROGRAMACAO) {
      expect(faixa.nome.length).toBeGreaterThan(2)
      expect(faixa.duracao * faixa.voltas).toBeGreaterThan(45)
      expect(faixa.duracao * faixa.voltas).toBeLessThan(120)
    }
  })

  it('a faixa de abertura da corrida está na programação, e a segunda é de outro estilo', () => {
    for (let semente = 0; semente < 20; semente += 1) {
      const abertura = indiceDaFaixa(faixaDaCorrida(semente))
      expect(PROGRAMACAO[abertura].id).toBe(faixaDaCorrida(semente))
      const segunda = PROGRAMACAO[proximaDaProgramacao(abertura)]
      expect(['rock', 'turbo']).not.toContain(segunda.id)
    }
  })

  it('dá a volta na programação, e o desconhecido abre na primeira', () => {
    expect(proximaDaProgramacao(PROGRAMACAO.length - 1)).toBe(0)
    expect(proximaDaProgramacao(Number.NaN)).toBe(1)
    expect(indiceDaFaixa('forro')).toBe(0)
    expect(INTERVALO_ENTRE_FAIXAS).toBeLessThan(2)
  })
})
