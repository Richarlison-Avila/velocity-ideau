/**
 * Trilha sonora da corrida: rock, gerado na hora.
 *
 * Como o resto do som do jogo, nada de arquivo — a demonstração não pode
 * depender de asset nenhum. Bateria, baixo, guitarra base e guitarra solo saem
 * de osciladores e do mesmo ruído que faz o vento, passando por distorção e
 * caixa de som simuladas. É o que Top Gear fazia com o chip do Super Nintendo:
 * rock de corrida, pesado na base e com uma melodia que gruda.
 *
 * Este arquivo é a partitura, pura, testada sem navegador. Quem toca é a
 * banda de `banda.ts`, a mesma de todas as faixas da rádio.
 *
 * ## A música
 *
 * Mi menor, 150 batidas por minuto, em semicolcheias: cada compasso tem
 * dezesseis passos de um décimo de segundo. São quatro seções de oito
 * compassos — estrofe, refrão, estrofe e ponte —, 51 segundos no total, e a
 * prova de um minuto e pouco dá a volta uma vez e meia.
 *
 * - **Estrofe**: guitarra abafada em galope (colcheia e duas semicolcheias), o
 *   riff de rock de corrida por excelência.
 * - **Refrão**: acordes soltos, bumbo sincopado, chimbal em semicolcheias e a
 *   guitarra solo por cima.
 * - **Ponte**: bumbo nos quatro tempos, chimbal aberto no contratempo e a base
 *   metralhando semicolcheias até a virada de caixa que devolve à estrofe.
 */

import { Banda, frequenciaDaNota, VOLUME_DA_TRILHA, type HostDaTrilha, type Partitura } from './banda'

// A frequência das notas, o volume e o contexto moravam aqui: continuam
// saindo daqui para quem já os importava.
export { frequenciaDaNota, VOLUME_DA_TRILHA }
export type { HostDaTrilha }

// ---------------------------------------------------------------------------
// Composição
// ---------------------------------------------------------------------------

/** Andamento, em batidas por minuto. */
export const TRILHA_BPM = 150

/** Passos por compasso: semicolcheias num quatro por quatro. */
export const PASSOS_POR_COMPASSO = 16

/** Duração de um passo, em segundos. */
export const DURACAO_DO_PASSO = 60 / TRILHA_BPM / 4

/** Compassos de cada seção. */
export const COMPASSOS_POR_SECAO = 8

export type Secao = 'estrofe' | 'refrao' | 'ponte'

/** A ordem das seções. A trilha dá a volta nela. */
export const ROTEIRO: readonly Secao[] = ['estrofe', 'refrao', 'estrofe', 'ponte']

/** Passos da trilha inteira, antes de ela dar a volta. */
export const PASSOS_DA_TRILHA = ROTEIRO.length * COMPASSOS_POR_SECAO * PASSOS_POR_COMPASSO

/**
 * Notas MIDI, para a composição poder ser lida como partitura.
 *
 * As raízes da guitarra base ficam na terceira oitava: é a região de um power
 * chord de guitarra de verdade, e é também a que o alto-falante de um celular
 * ainda reproduz — o baixo, uma oitava abaixo, aparece de verdade em fone.
 */
const N = {
  C3: 48, D3: 50, E3: 52, G3: 55, A3: 57, B3: 59,
  A4: 69, B4: 71, C5: 72, D5: 74, Ds5: 75, E5: 76, Fs5: 78, G5: 79, A5: 81, B5: 83,
}

/** Raiz de cada compasso de cada seção. */
const HARMONIA: Record<Secao, readonly number[]> = {
  // Mi, dó, ré: a cadência de sempre do rock em mi menor, com o sol no fim
  // para a volta ao mi não soar igual à primeira.
  estrofe: [N.E3, N.E3, N.C3, N.D3, N.E3, N.E3, N.G3, N.D3],
  // O refrão anda mais: um acorde por compasso, e termina no si, a dominante,
  // que é o que puxa de volta para o mi da estrofe.
  refrao: [N.E3, N.C3, N.G3, N.D3, N.E3, N.C3, N.A3, N.B3],
  // A ponte sai do mi de propósito, e sobe de lá até o si.
  ponte: [N.A3, N.A3, N.C3, N.C3, N.D3, N.D3, N.B3, N.B3],
}

/**
 * Melodia do refrão, compasso a compasso: nota e duração em passos.
 *
 * Cada compasso soma dezesseis passos, e isso é conferido em teste. A escala é
 * a de mi menor natural, com uma exceção: o ré sustenido do último compasso,
 * sobre o si maior, é a sensível que resolve no mi da volta.
 */
const MELODIA_DO_REFRAO: readonly (readonly [number, number][])[] = [
  [[N.B4, 4], [N.E5, 4], [N.D5, 2], [N.E5, 2], [N.G5, 4]],
  [[N.E5, 6], [N.D5, 2], [N.C5, 4], [N.B4, 4]],
  [[N.D5, 4], [N.G5, 4], [N.Fs5, 2], [N.G5, 2], [N.A5, 4]],
  [[N.Fs5, 8], [N.D5, 4], [N.A4, 4]],
  [[N.B4, 4], [N.E5, 4], [N.D5, 2], [N.E5, 2], [N.G5, 4]],
  [[N.A5, 4], [N.G5, 4], [N.E5, 4], [N.G5, 4]],
  [[N.A5, 6], [N.B5, 2], [N.A5, 4], [N.G5, 4]],
  [[N.Fs5, 8], [N.Ds5, 4], [N.B4, 4]],
]

/** Passos do galope da estrofe: colcheia e duas semicolcheias, quatro vezes. */
const GALOPE = new Set([0, 2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15])

/** Onde o acorde do refrão é tocado, e por quantos passos ele soa. */
const ACORDES_DO_REFRAO = new Map([[0, 6], [6, 2], [8, 6], [14, 2]])

/** O que cada instrumento faz num passo. Zero é silêncio; o resto é intensidade. */
export type EventosDoPasso = {
  secao: Secao
  /** Compasso dentro da seção, de 0 a 7. */
  compasso: number
  bumbo: number
  caixa: number
  chimbal: number
  chimbalAberto: boolean
  prato: boolean
  baixo: { nota: number; passos: number } | null
  guitarra: { raiz: number; passos: number; abafada: boolean } | null
  solo: { nota: number; passos: number } | null
}

/**
 * O que toca num passo da trilha.
 *
 * Aceita qualquer número inteiro — o passo dá a volta na trilha —, e trata
 * lixo como o primeiro passo: o agendador conta passos para sempre, e uma
 * conta errada não pode virar silêncio nem exceção.
 */
export function eventosDoPasso(passoBruto: number): EventosDoPasso {
  const inteiro = Number.isFinite(passoBruto) ? Math.floor(passoBruto) : 0
  const passo = ((inteiro % PASSOS_DA_TRILHA) + PASSOS_DA_TRILHA) % PASSOS_DA_TRILHA
  const noCompasso = passo % PASSOS_POR_COMPASSO
  const compassoGeral = Math.floor(passo / PASSOS_POR_COMPASSO)
  const secao = ROTEIRO[Math.floor(compassoGeral / COMPASSOS_POR_SECAO)]
  const compasso = compassoGeral % COMPASSOS_POR_SECAO
  const raiz = HARMONIA[secao][compasso]
  const ultimo = compasso === COMPASSOS_POR_SECAO - 1

  const eventos: EventosDoPasso = {
    secao,
    compasso,
    bumbo: 0,
    caixa: 0,
    chimbal: 0,
    chimbalAberto: false,
    prato: compasso === 0 && noCompasso === 0,
    baixo: null,
    guitarra: null,
    solo: null,
  }

  // Bateria. A caixa nos tempos dois e quatro em toda seção: é o que faz o
  // pé do ouvinte achar o compasso sem pensar.
  if (noCompasso === 4 || noCompasso === 12) eventos.caixa = 1
  if (secao === 'estrofe') {
    if (noCompasso === 0 || noCompasso === 8 || noCompasso === 10) eventos.bumbo = noCompasso === 10 ? 0.75 : 1
    if (noCompasso % 2 === 0) eventos.chimbal = noCompasso % 4 === 0 ? 0.8 : 0.5
  } else if (secao === 'refrao') {
    if (noCompasso === 0 || noCompasso === 3 || noCompasso === 8 || noCompasso === 11) eventos.bumbo = noCompasso % 8 === 0 ? 1 : 0.8
    eventos.chimbal = noCompasso % 2 === 0 ? 0.6 : 0.3
  } else {
    if (noCompasso % 4 === 0) eventos.bumbo = 1
    if (noCompasso % 4 === 2) {
      eventos.chimbal = 0.7
      eventos.chimbalAberto = true
    }
  }

  // Virada no fim de cada seção: a caixa em semicolcheias, crescendo, e o
  // chimbal para. Na ponte a virada começa mais cedo — é ela que devolve a
  // música ao começo.
  const inicioDaVirada = secao === 'ponte' ? 8 : 12
  if (ultimo && noCompasso >= inicioDaVirada) {
    eventos.caixa = 0.5 + (0.5 * (noCompasso - inicioDaVirada)) / (15 - inicioDaVirada)
    eventos.chimbal = 0
    eventos.chimbalAberto = false
    if (noCompasso === inicioDaVirada) eventos.bumbo = 1
  }

  // Baixo: a raiz uma oitava abaixo da guitarra, em colcheias. No refrão ele
  // alterna com a oitava de cima, que é o que empurra a música para a frente.
  if (noCompasso % 2 === 0 && !(ultimo && secao === 'ponte' && noCompasso >= inicioDaVirada)) {
    const pulo = secao === 'refrao' && noCompasso % 4 === 2 ? 12 : 0
    eventos.baixo = { nota: raiz - 12 + pulo, passos: 2 }
  }

  // Guitarra base.
  if (secao === 'estrofe' && GALOPE.has(noCompasso)) {
    // O primeiro golpe do compasso soa aberto; o resto é abafado com a palma.
    eventos.guitarra = { raiz, passos: noCompasso === 0 ? 2 : 1, abafada: noCompasso !== 0 }
  } else if (secao === 'refrao' && ACORDES_DO_REFRAO.has(noCompasso)) {
    eventos.guitarra = { raiz, passos: ACORDES_DO_REFRAO.get(noCompasso)!, abafada: false }
  } else if (secao === 'ponte' && !(ultimo && noCompasso >= inicioDaVirada)) {
    eventos.guitarra = { raiz, passos: 1, abafada: noCompasso % 8 !== 0 }
  }

  // Guitarra solo: só no refrão, nota a nota da melodia.
  if (secao === 'refrao') {
    let inicio = 0
    for (const [nota, passos] of MELODIA_DO_REFRAO[compasso]) {
      if (inicio === noCompasso) eventos.solo = { nota, passos }
      inicio += passos
    }
  }

  return eventos
}

// ---------------------------------------------------------------------------
// Ligação com o Web Audio
// ---------------------------------------------------------------------------

/** A trilha de rock como partitura da banda. */
export const PARTITURA_ROCK: Partitura = {
  bpm: TRILHA_BPM,
  passos: PASSOS_DA_TRILHA,
  eventos: eventosDoPasso,
  volume: VOLUME_DA_TRILHA,
}

/** A trilha de rock tocada pela banda. */
export class TrilhaRock extends Banda {
  constructor(ctx: HostDaTrilha, destino: AudioNode, ruido: AudioBuffer) {
    super(ctx, destino, ruido, PARTITURA_ROCK)
  }
}
