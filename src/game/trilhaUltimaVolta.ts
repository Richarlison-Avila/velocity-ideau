/**
 * "Última Volta": a épica da rádio, que começa num violão e termina em
 * tempestade.
 *
 * É o arco das grandes faixas de rock dos anos setenta — violão dedilhado e
 * flauta, a banda chegando aos poucos, a virada para o dobro do andamento, o
 * solo e o tema voltando pesado no fim. A composição é original: o que vem
 * daquela época é o arco, e não as notas nem a harmonia de música nenhuma.
 *
 * ## A música
 *
 * Lá menor, 144 batidas por minuto contadas em semicolcheias — o que no
 * começo soa como 72, porque tudo ali anda na metade do passo.
 *
 * - **Abertura** (dezesseis compassos): violão de doze cordas dedilhando, a
 *   flauta entrando no quinto, o baixo e o teclado no nono. Sem bateria.
 * - **Subida** (oito): a bateria entra em meio tempo, a guitarra bate os
 *   acordes e a flauta sobe uma oitava.
 * - **Tempestade** (dezesseis): o andamento dobra — lá, sol, fá, sol na
 *   parede de guitarra — e o solo corre por cima.
 * - **Final** (oito): o tema da flauta volta na guitarra solo, uma oitava
 *   acima, e o último acorde fica soando.
 *
 * Um minuto e vinte, tocado uma vez.
 */
import {
  PASSOS_DO_COMPASSO,
  compassosDaForma,
  notaDaFrase,
  pontoDaForma,
  silencio,
  type EventosDaBanda,
  type Forma,
  type Frase,
  type Partitura,
} from './banda'

export const ULTIMA_VOLTA_BPM = 144

export type SecaoUltimaVolta = 'abertura' | 'subida' | 'tempestade' | 'final'

export const FORMA_ULTIMA_VOLTA: Forma<SecaoUltimaVolta> = [
  ['abertura', 16],
  ['subida', 8],
  ['tempestade', 16],
  ['final', 8],
]

export const PASSOS_ULTIMA_VOLTA = compassosDaForma(FORMA_ULTIMA_VOLTA) * PASSOS_DO_COMPASSO

type Acorde = 'Am' | 'C' | 'G' | 'D' | 'F' | 'E'

/**
 * Cada acorde como o violão o dedilha, do baixo para o agudo, e como o
 * teclado o segura. O mi maior é o único estrangeiro: é a dominante que puxa
 * de volta para o lá menor.
 */
const ACORDES: Record<Acorde, { violao: readonly number[]; teclado: readonly number[]; raiz: number; menor: boolean }> = {
  Am: { violao: [45, 52, 57, 60, 64], teclado: [57, 60, 64], raiz: 45, menor: true },
  C: { violao: [48, 55, 60, 64, 67], teclado: [55, 60, 64], raiz: 48, menor: false },
  G: { violao: [43, 50, 55, 59, 62], teclado: [55, 59, 62], raiz: 43, menor: false },
  D: { violao: [50, 57, 62, 66, 69], teclado: [57, 62, 66], raiz: 50, menor: false },
  F: { violao: [41, 48, 53, 57, 60], teclado: [57, 60, 65], raiz: 41, menor: false },
  E: { violao: [40, 47, 52, 56, 59], teclado: [56, 59, 64], raiz: 40, menor: false },
}

const HARMONIA: Record<SecaoUltimaVolta, readonly Acorde[]> = {
  // Lá menor, dó, sol e ré — o ré maior dá o sabor dórico, de música antiga —,
  // e depois lá menor, fá, dó e a dominante.
  abertura: ['Am', 'Am', 'C', 'C', 'G', 'G', 'D', 'D', 'Am', 'Am', 'F', 'F', 'C', 'E', 'Am', 'Am'],
  subida: ['Am', 'C', 'G', 'D', 'F', 'C', 'E', 'E'],
  // A escada do rock em menor: um, sete abaixado, seis abaixado, sete.
  tempestade: ['Am', 'G', 'F', 'G', 'Am', 'G', 'F', 'G', 'Am', 'G', 'F', 'G', 'Am', 'G', 'F', 'G'],
  final: ['Am', 'Am', 'F', 'F', 'C', 'E', 'Am', 'Am'],
}

/** A ordem do dedilhado em colcheias: baixo, agudos, a segunda corda grave, agudos. */
const DEDILHADO = [0, 2, 3, 4, 1, 3, 2, 4]

const N = {
  E4: 64, Gs4: 68, G4: 67, A4: 69, B4: 71, C5: 72, D5: 74, E5: 76, F5: 77, Fs5: 78, G5: 79, Gs5: 80,
  A5: 81, B5: 83, C6: 84, D6: 86, E6: 88, G6: 91, A6: 93,
}

/** A flauta da abertura, do quinto ao décimo sexto compasso. */
const FLAUTA: readonly Frase[] = [
  [[N.D5, 8], [N.B4, 4], [N.G4, 4]],
  [[N.A4, 4], [N.B4, 4], [N.D5, 8]],
  [[N.Fs5, 8], [N.E5, 4], [N.D5, 4]],
  [[N.E5, 12], [null, 4]],
  // O tema: é ele que volta pesado no final.
  [[N.E5, 8], [N.D5, 4], [N.C5, 4]],
  [[N.B4, 4], [N.C5, 4], [N.A4, 8]],
  [[N.A4, 4], [N.C5, 4], [N.F5, 8]],
  [[N.E5, 6], [N.D5, 2], [N.C5, 8]],
  [[N.E5, 4], [N.G5, 4], [N.E5, 4], [N.C5, 4]],
  [[N.B4, 8], [N.Gs4, 8]],
  [[N.A4, 16]],
  [[null, 8], [N.E4, 4], [N.A4, 4]],
]

/** Os oito compassos do tema, que a guitarra solo retoma no final. */
const TEMA = FLAUTA.slice(4)

/** A flauta da subida, uma oitava acima: a música já está subindo. */
const FLAUTA_DA_SUBIDA: readonly Frase[] = [
  [[N.A5, 8], [N.G5, 4], [N.E5, 4]],
  [[N.G5, 8], [N.E5, 4], [N.C5, 4]],
  [[N.D5, 8], [N.B4, 4], [N.D5, 4]],
  [[N.Fs5, 8], [N.A5, 8]],
  [[N.A5, 8], [N.C6, 4], [N.A5, 4]],
  [[N.G5, 8], [N.E5, 8]],
  [[N.Gs5, 8], [N.B5, 8]],
  [[N.E6, 12], [null, 4]],
]

/** O solo da tempestade: pentatônica de lá menor, e arpejos correndo no fim. */
const SOLO: readonly Frase[] = [
  [[N.E5, 2], [N.A5, 2], [N.C6, 2], [N.B5, 2], [N.A5, 4], [N.E5, 4]],
  [[N.D5, 2], [N.G5, 2], [N.B5, 2], [N.A5, 2], [N.G5, 8]],
  [[N.F5, 2], [N.A5, 2], [N.C6, 4], [N.A5, 2], [N.G5, 2], [N.F5, 4]],
  [[N.G5, 4], [N.A5, 2], [N.B5, 2], [N.D6, 8]],
  [[N.E6, 8], [N.D6, 2], [N.C6, 2], [N.B5, 2], [N.A5, 2]],
  [[N.B5, 4], [N.G5, 4], [N.D5, 4], [N.G5, 4]],
  [[N.A5, 2], [N.G5, 2], [N.F5, 2], [N.E5, 2], [N.F5, 4], [N.A5, 4]],
  [[N.G5, 12], [null, 4]],
  [[N.A5, 1], [N.C6, 1], [N.E6, 1], [N.C6, 1], [N.A5, 1], [N.C6, 1], [N.E6, 1], [N.C6, 1], [N.A5, 1], [N.C6, 1], [N.E6, 1], [N.C6, 1], [N.A5, 4]],
  [[N.G5, 1], [N.B5, 1], [N.D6, 1], [N.B5, 1], [N.G5, 1], [N.B5, 1], [N.D6, 1], [N.B5, 1], [N.G5, 1], [N.B5, 1], [N.D6, 1], [N.B5, 1], [N.G5, 4]],
  [[N.F5, 1], [N.A5, 1], [N.C6, 1], [N.A5, 1], [N.F5, 1], [N.A5, 1], [N.C6, 1], [N.A5, 1], [N.F5, 1], [N.A5, 1], [N.C6, 1], [N.A5, 1], [N.F5, 4]],
  [[N.G5, 2], [N.A5, 2], [N.B5, 2], [N.C6, 2], [N.D6, 4], [N.E6, 4]],
  [[N.E6, 4], [N.G6, 4], [N.A6, 8]],
  [[N.G6, 4], [N.E6, 4], [N.D6, 4], [N.B5, 4]],
  [[N.C6, 4], [N.A5, 4], [N.F5, 4], [N.A5, 4]],
  [[N.B5, 8], [N.D6, 4], [null, 4]],
]

export type EventosUltimaVolta = EventosDaBanda & { secao: SecaoUltimaVolta; compasso: number }

/** Sobe uma frase inteira uma oitava. */
function oitavaAcima(frase: Frase): Frase {
  return frase.map(([nota, passos]) => [nota === null ? null : nota + 12, passos] as const)
}

const TEMA_NO_FINAL = TEMA.map(oitavaAcima)

export function eventosUltimaVolta(passo: number): EventosUltimaVolta {
  const { secao, compasso, tamanho, noCompasso } = pontoDaForma(FORMA_ULTIMA_VOLTA, passo)
  const e: EventosUltimaVolta = { ...silencio(), secao, compasso }
  const acorde = ACORDES[HARMONIA[secao][compasso]]
  const ultimo = compasso === tamanho - 1
  const fimDaMusica = secao === 'final' && ultimo

  // Violão: dedilha a abertura e a subida inteiras, uma corda por colcheia.
  if ((secao === 'abertura' || secao === 'subida') && noCompasso % 2 === 0) {
    e.dedilhado = { nota: acorde.violao[DEDILHADO[noCompasso / 2]], passos: 4 }
  }

  // Flauta.
  if (secao === 'abertura' && compasso >= 4) e.flauta = notaDaFrase(FLAUTA[compasso - 4], noCompasso)
  if (secao === 'subida') e.flauta = notaDaFrase(FLAUTA_DA_SUBIDA[compasso], noCompasso)

  // Teclado: do meio da abertura em diante, e segurando o final.
  if (((secao === 'abertura' && compasso >= 8) || secao === 'subida' || secao === 'final') && noCompasso === 0) {
    e.teclado = { notas: acorde.teclado, passos: 16 }
  }

  // Baixo.
  const b = acorde.raiz - 12
  if (secao === 'abertura' && compasso >= 8 && noCompasso === 0) e.baixo = { nota: b, passos: 16 }
  if (secao === 'subida' && noCompasso % 4 === 0) e.baixo = { nota: b + [0, 0, 7, 12][noCompasso / 4], passos: 4 }
  if (secao === 'tempestade' && noCompasso % 2 === 0) e.baixo = { nota: b + (noCompasso % 8 === 6 ? 12 : 0), passos: 2 }
  if (secao === 'final' && noCompasso % 4 === 0 && !(fimDaMusica && noCompasso > 0)) {
    e.baixo = { nota: b, passos: fimDaMusica ? 16 : 4 }
  }

  // Guitarra base.
  const menor = acorde.menor ? [0, 7, 12, 15] : [0, 7, 12, 16]
  if (secao === 'subida' && noCompasso % 8 === 0) {
    e.guitarra = { raiz: acorde.raiz, passos: 8, abafada: false, intervalos: menor, crunch: true }
  }
  if (secao === 'tempestade' && noCompasso % 2 === 0 && !(ultimo && noCompasso >= 12)) {
    const aberta = noCompasso % 8 === 0
    e.guitarra = { raiz: acorde.raiz, passos: aberta ? 2 : 1, abafada: !aberta }
  }
  if (secao === 'final' && noCompasso % 8 === 0 && !(fimDaMusica && noCompasso > 0)) {
    e.guitarra = { raiz: acorde.raiz, passos: fimDaMusica ? 16 : 8, abafada: false }
  }

  // Guitarra solo.
  if (secao === 'tempestade') e.solo = notaDaFrase(SOLO[compasso], noCompasso)
  if (secao === 'final') e.solo = notaDaFrase(TEMA_NO_FINAL[compasso], noCompasso)

  // Bateria.
  if (secao === 'subida') {
    // Meio tempo: bumbo no um e no "e" do três, caixa no três.
    if (noCompasso === 0 || noCompasso === 10) e.bumbo = 1
    if (noCompasso === 8) e.caixa = 1
    if (noCompasso % 4 === 0) e.chimbal = 0.5
    e.prato = compasso === 0 && noCompasso === 0
    if (ultimo && noCompasso >= 8) {
      // A virada que acorda a tempestade: colcheias, depois semicolcheias.
      e.caixa = noCompasso < 12 ? (noCompasso % 2 === 0 ? 0.6 : 0) : 0.7 + (0.3 * (noCompasso - 12)) / 3
      e.chimbal = 0
      e.bumbo = noCompasso === 8 ? 1 : 0
    }
  } else if (secao === 'tempestade') {
    if (noCompasso === 0 || noCompasso === 8) e.bumbo = 1
    if (noCompasso === 6 || noCompasso === 11) e.bumbo = 0.7
    if (noCompasso === 4 || noCompasso === 12) e.caixa = 1
    if (noCompasso % 2 === 0) e.chimbal = noCompasso % 4 === 0 ? 0.7 : 0.45
    e.prato = compasso % 4 === 0 && noCompasso === 0
    if (ultimo && noCompasso >= 12) {
      e.caixa = 0.55 + (0.45 * (noCompasso - 12)) / 3
      e.chimbal = 0
      e.bumbo = noCompasso === 12 ? 1 : 0
    }
  } else if (secao === 'final') {
    if (fimDaMusica) {
      e.prato = noCompasso === 0
      e.bumbo = noCompasso === 0 ? 1 : 0
    } else {
      // Meio tempo de novo, largo, com o prato a cada dois compassos.
      if (noCompasso === 0 || noCompasso === 10) e.bumbo = 1
      if (noCompasso === 8) e.caixa = 1
      if (noCompasso % 2 === 0) {
        e.chimbal = 0.55
        e.chimbalAberto = noCompasso % 4 === 2
      }
      e.prato = compasso % 2 === 0 && noCompasso === 0
    }
  }

  return e
}

export const PARTITURA_ULTIMA_VOLTA: Partitura = {
  bpm: ULTIMA_VOLTA_BPM,
  passos: PASSOS_ULTIMA_VOLTA,
  eventos: eventosUltimaVolta,
  volume: 0.55,
}

/** Todas as frases, para os testes conferirem a soma dos compassos. */
export const FRASES_ULTIMA_VOLTA: readonly Frase[] = [...FLAUTA, ...FLAUTA_DA_SUBIDA, ...SOLO, ...TEMA_NO_FINAL]
