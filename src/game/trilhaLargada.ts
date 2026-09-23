/**
 * "Largada Queimada": punk rock rápido, para a rádio.
 *
 * Três acordes e a verdade: guitarra em colcheias palhetadas para baixo,
 * bateria correndo, baixo colado na guitarra e um refrão de estádio. A
 * composição é original — o que vem do gênero é a receita, não as notas.
 *
 * ## A música
 *
 * Ré maior, 184 batidas por minuto, em semicolcheias. Introdução de quatro
 * compassos (a caixa chamando, depois a banda), estrofe e refrão duas vezes,
 * uma ponte parada — a banda inteira bate junto e se cala — e o último
 * refrão. Pouco mais de um minuto, tocado uma vez.
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

export const LARGADA_BPM = 184

export type SecaoLargada = 'intro' | 'estrofe' | 'refrao' | 'ponte' | 'final'

export const FORMA_LARGADA: Forma<SecaoLargada> = [
  ['intro', 4],
  ['estrofe', 8],
  ['refrao', 8],
  ['estrofe', 8],
  ['refrao', 8],
  ['ponte', 4],
  ['refrao', 8],
  ['final', 1],
]

export const PASSOS_LARGADA = compassosDaForma(FORMA_LARGADA) * PASSOS_DO_COMPASSO

const N = {
  G2: 43, A2: 45, B2: 47, D3: 50,
  Fs4: 66, A4: 69, B4: 71, Cs5: 73, D5: 74, E5: 76, Fs5: 78, G5: 79, A5: 81,
}

/** Raiz do power chord de cada compasso. */
const HARMONIA: Record<SecaoLargada, readonly number[]> = {
  intro: [N.D3, N.D3, N.D3, N.A2],
  // Ré, lá, si menor e sol: o carrossel do punk, com o lá no fim para voltar.
  estrofe: [N.D3, N.D3, N.A2, N.A2, N.B2, N.B2, N.G2, N.A2],
  // O refrão começa no sol, o quarto grau, e é essa entrada fora da tônica
  // que faz ele explodir.
  refrao: [N.G2, N.D3, N.A2, N.B2, N.G2, N.D3, N.A2, N.A2],
  ponte: [N.B2, N.G2, N.D3, N.A2],
  final: [N.D3],
}

const ESTROFE: readonly Frase[] = [
  [[N.A4, 2], [N.D5, 2], [N.D5, 2], [N.E5, 2], [N.Fs5, 4], [N.E5, 4]],
  [[N.D5, 8], [N.A4, 8]],
  [[N.Cs5, 2], [N.E5, 2], [N.E5, 2], [N.Fs5, 2], [N.E5, 4], [N.Cs5, 4]],
  [[N.A4, 12], [null, 4]],
  [[N.B4, 2], [N.D5, 2], [N.Fs5, 4], [N.E5, 2], [N.D5, 2], [N.B4, 4]],
  [[N.Fs5, 8], [N.D5, 8]],
  [[N.G5, 4], [N.Fs5, 4], [N.E5, 4], [N.D5, 4]],
  [[N.E5, 8], [N.Cs5, 4], [N.A4, 4]],
]

const REFRAO: readonly Frase[] = [
  [[N.D5, 2], [N.D5, 2], [N.B4, 2], [N.D5, 2], [N.E5, 4], [N.D5, 4]],
  [[N.Fs5, 4], [N.E5, 2], [N.D5, 2], [N.A4, 8]],
  [[N.Cs5, 2], [N.Cs5, 2], [N.A4, 2], [N.Cs5, 2], [N.E5, 4], [N.Cs5, 4]],
  [[N.D5, 4], [N.Cs5, 2], [N.B4, 2], [N.Fs4, 8]],
  [[N.D5, 2], [N.D5, 2], [N.B4, 2], [N.D5, 2], [N.G5, 4], [N.Fs5, 4]],
  [[N.Fs5, 4], [N.A5, 4], [N.Fs5, 4], [N.D5, 4]],
  [[N.E5, 8], [N.Cs5, 4], [N.E5, 4]],
  [[N.A5, 12], [null, 4]],
]

/** Na ponte, a banda inteira só bate no um e no "e" do três. */
const GOLPES_DA_PONTE = new Set([0, 10])

export type EventosLargada = EventosDaBanda & { secao: SecaoLargada; compasso: number }

export function eventosLargada(passo: number): EventosLargada {
  const { secao, compasso, tamanho, noCompasso } = pontoDaForma(FORMA_LARGADA, passo)
  const e: EventosLargada = { ...silencio(), secao, compasso }
  const raiz = HARMONIA[secao][compasso]
  const ultimo = compasso === tamanho - 1
  const virada = ultimo && (secao === 'estrofe' || secao === 'refrao') && noCompasso >= 12
  const chamada = secao === 'intro' && compasso === 0

  // Bateria.
  if (chamada) {
    // A caixa chamando a banda: colcheias crescendo, semicolcheias no fim.
    if (noCompasso % 4 === 0) e.bumbo = 1
    if (noCompasso < 8 ? noCompasso % 2 === 0 : true) e.caixa = 0.35 + (0.65 * noCompasso) / 15
  } else if (secao === 'ponte') {
    if (GOLPES_DA_PONTE.has(noCompasso) && !(ultimo && noCompasso > 8)) {
      e.bumbo = 1
      e.prato = true
    }
    if (ultimo && noCompasso >= 8) e.caixa = 0.5 + (0.5 * (noCompasso - 8)) / 7
  } else if (secao === 'final') {
    e.prato = noCompasso === 0
    e.bumbo = noCompasso === 0 ? 1 : 0
  } else {
    e.prato = noCompasso === 0 && (compasso === 0 || (secao === 'intro' && compasso === 1) || (secao === 'refrao' && compasso === 4))
    if (noCompasso === 4 || noCompasso === 12) e.caixa = 1
    if (secao === 'refrao') {
      // O refrão corre: bumbo em todo tempo, chimbal aberto no contratempo.
      if (noCompasso % 4 === 0) e.bumbo = 1
      if (noCompasso % 2 === 0) {
        e.chimbal = 0.6
        e.chimbalAberto = noCompasso % 4 === 2
      }
    } else {
      if (noCompasso === 0 || noCompasso === 8) e.bumbo = 1
      if (noCompasso === 6 || noCompasso === 14) e.bumbo = 0.75
      if (noCompasso % 2 === 0) e.chimbal = noCompasso % 4 === 0 ? 0.7 : 0.5
    }
    if (virada) {
      e.caixa = 0.55 + (0.45 * (noCompasso - 12)) / 3
      e.chimbal = 0
      e.chimbalAberto = false
      e.bumbo = noCompasso === 12 ? 1 : 0
    }
  }

  // Guitarra e baixo.
  const b = raiz - 12
  if (secao === 'ponte') {
    if (GOLPES_DA_PONTE.has(noCompasso) && !(ultimo && noCompasso > 8)) {
      e.guitarra = { raiz, passos: noCompasso === 0 ? 6 : 4, abafada: false }
      e.baixo = { nota: b, passos: noCompasso === 0 ? 6 : 4 }
    }
  } else if (secao === 'final') {
    if (noCompasso === 0) {
      e.guitarra = { raiz, passos: 16, abafada: false }
      e.baixo = { nota: b, passos: 16 }
    }
  } else if (!chamada && noCompasso % 2 === 0 && !virada) {
    // Colcheias palhetadas para baixo. Na estrofe a palma abafa as cordas
    // fora do um e do três, e a guitarra só abre no refrão — é o contraste que
    // faz o refrão explodir.
    const aberta = secao === 'refrao' || noCompasso % 8 === 0
    e.guitarra = { raiz, passos: secao === 'refrao' ? 2 : 1, abafada: !aberta }
    e.baixo = { nota: b + (secao === 'refrao' && noCompasso % 8 === 6 ? 12 : 0), passos: 2 }
  }

  // Guitarra solo.
  if (secao === 'estrofe') e.solo = notaDaFrase(ESTROFE[compasso], noCompasso)
  if (secao === 'refrao') e.solo = notaDaFrase(REFRAO[compasso], noCompasso)
  if (secao === 'final' && noCompasso === 0) e.solo = { nota: N.D5, passos: 16 }

  return e
}

export const PARTITURA_LARGADA: Partitura = {
  bpm: LARGADA_BPM,
  passos: PASSOS_LARGADA,
  eventos: eventosLargada,
  volume: 0.47,
}

export const FRASES_LARGADA: readonly Frase[] = [...ESTROFE, ...REFRAO]
