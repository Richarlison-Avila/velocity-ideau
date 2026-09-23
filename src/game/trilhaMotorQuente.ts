/**
 * "Motor Quente": hard rock de boogie, para a rádio.
 *
 * É o rock de estrada dos anos setenta e oitenta — guitarra base de
 * amplificador aberto, bateria reta, baixo andando e um refrão de acordes
 * soltos que se canta de capacete. A composição é original: o que vem do
 * gênero é a receita — o boogie de quinta e sexta sobre a corda solta, a forma
 * de blues de doze compassos, a escala pentatônica do solo —, não as notas de
 * música nenhuma.
 *
 * ## A música
 *
 * Lá, 132 batidas por minuto, em semicolcheias. Introdução de quatro
 * compassos (a guitarra sozinha, depois a banda), estrofe de doze sobre o
 * blues em lá, refrão de oito, solo de doze, refrão de novo e um final de dois
 * com o acorde soando. Um minuto e vinte e poucos, tocado uma vez.
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

export const MOTOR_QUENTE_BPM = 132

export type SecaoMotorQuente = 'intro' | 'estrofe' | 'refrao' | 'solo' | 'final'

export const FORMA_MOTOR_QUENTE: Forma<SecaoMotorQuente> = [
  ['intro', 4],
  ['estrofe', 12],
  ['refrao', 8],
  ['solo', 12],
  ['refrao', 8],
  ['final', 2],
]

export const PASSOS_MOTOR_QUENTE = compassosDaForma(FORMA_MOTOR_QUENTE) * PASSOS_DO_COMPASSO

/** Notas MIDI usadas, para a partitura poder ser lida. */
const N = {
  E2: 40, G2: 43, A2: 45, D3: 50, E3: 52,
  G4: 67, A4: 69, B4: 71, C5: 72, Cs5: 73, D5: 74, Eb5: 75, E5: 76, Fs5: 78, G5: 79, Gs5: 80,
  A5: 81, B5: 83, C6: 84, D6: 86, E6: 88,
}

/** Acordes cheios do refrão e do final: tríade maior com a oitava. */
const MAIOR = [0, 7, 12, 16] as const
const MAIOR_COM_QUINTA = [0, 7, 12, 16, 19] as const
/** O boogie: quinta, sexta e sétima sobre a mesma raiz. */
const QUINTA = [0, 7, 12] as const
const SEXTA = [0, 9, 12] as const
const SETIMA = [0, 10, 12] as const

/** A forma de blues em lá: o carrossel de todo rock de estrada. */
const BLUES = [N.A2, N.A2, N.A2, N.A2, N.D3, N.D3, N.A2, N.A2, N.E3, N.D3, N.A2, N.E3]

/** Ré, lá, sol e mi, dois compassos cada: o refrão desce e volta pela dominante. */
const REFRAO = [N.D3, N.D3, N.A2, N.A2, N.G2, N.G2, N.E2, N.E2]

/** Onde a guitarra bate no refrão, e por quantos passos o acorde soa. */
const GOLPES_DO_REFRAO = new Map([[0, 4], [4, 2], [6, 2], [8, 4], [12, 2], [14, 2]])

/** Respostas da guitarra solo na estrofe: fim do quarto, do oitavo e do décimo segundo compasso. */
const RESPOSTAS: Record<number, Frase> = {
  3: [[null, 8], [N.E5, 1], [N.G5, 1], [N.A5, 2], [N.G5, 1], [N.E5, 1], [N.D5, 2]],
  7: [[null, 8], [N.C5, 2], [N.D5, 1], [N.Eb5, 1], [N.E5, 2], [N.G5, 2]],
  // A volta: sobe pelo mi com sétima, que puxa para o ré do refrão.
  11: [[N.B4, 2], [N.D5, 2], [N.E5, 2], [N.Gs5, 2], [N.B5, 4], [N.A5, 2], [N.Gs5, 2]],
}

/** O tema do refrão, um compasso por linha. */
const TEMA: readonly Frase[] = [
  [[N.Fs5, 4], [N.E5, 2], [N.D5, 2], [N.E5, 4], [N.Fs5, 4]],
  [[N.A5, 8], [N.Fs5, 4], [N.E5, 4]],
  [[N.E5, 4], [N.Cs5, 2], [N.A4, 2], [N.Cs5, 4], [N.E5, 4]],
  [[N.E5, 10], [null, 2], [N.A4, 2], [N.Cs5, 2]],
  [[N.D5, 4], [N.B4, 2], [N.G4, 2], [N.B4, 4], [N.D5, 4]],
  [[N.G5, 6], [N.Fs5, 2], [N.E5, 4], [N.D5, 4]],
  [[N.E5, 4], [N.Gs5, 4], [N.B5, 4], [N.Gs5, 4]],
  [[N.A5, 2], [N.Gs5, 2], [N.E5, 8], [null, 4]],
]

/** O solo: pentatônica de lá, com a terça maior e a nota de blues de passagem. */
const SOLO: readonly Frase[] = [
  [[N.A5, 2], [N.C6, 2], [N.A5, 1], [N.G5, 1], [N.E5, 2], [N.G5, 2], [N.A5, 4], [null, 2]],
  [[N.E5, 1], [N.G5, 1], [N.A5, 1], [N.C6, 1], [N.D6, 4], [N.C6, 2], [N.A5, 2], [N.G5, 4]],
  [[N.A5, 8], [N.G5, 2], [N.E5, 2], [N.D5, 2], [N.C5, 2]],
  [[N.A4, 2], [N.C5, 2], [N.D5, 2], [N.Eb5, 1], [N.E5, 1], [N.G5, 4], [N.E5, 4]],
  [[N.Fs5, 4], [N.A5, 2], [N.Fs5, 2], [N.D5, 4], [N.C5, 2], [N.A4, 2]],
  [[N.D5, 1], [N.Fs5, 1], [N.A5, 1], [N.C6, 1], [N.D6, 8], [N.C6, 2], [N.A5, 2]],
  [[N.A5, 2], [N.G5, 2], [N.E5, 2], [N.C5, 2], [N.E5, 4], [N.A5, 4]],
  [[N.C6, 2], [N.A5, 2], [N.G5, 2], [N.E5, 2], [N.G5, 8]],
  [[N.B5, 4], [N.Gs5, 2], [N.E5, 2], [N.D5, 2], [N.E5, 2], [N.Gs5, 4]],
  [[N.A5, 4], [N.Fs5, 2], [N.D5, 2], [N.C5, 2], [N.D5, 2], [N.Fs5, 4]],
  [[N.E5, 2], [N.A5, 2], [N.C6, 2], [N.E6, 6], [N.C6, 2], [N.A5, 2]],
  [[N.B5, 8], [N.Gs5, 4], [N.E5, 4]],
]

export type EventosMotorQuente = EventosDaBanda & { secao: SecaoMotorQuente; compasso: number }

/** Raiz da guitarra num compasso. */
function raizDoCompasso(secao: SecaoMotorQuente, compasso: number) {
  if (secao === 'refrao') return REFRAO[compasso]
  if (secao === 'intro' || secao === 'final') return N.A2
  return BLUES[compasso]
}

export function eventosMotorQuente(passo: number): EventosMotorQuente {
  const { secao, compasso, tamanho, noCompasso } = pontoDaForma(FORMA_MOTOR_QUENTE, passo)
  const e: EventosMotorQuente = { ...silencio(), secao, compasso }
  const raiz = raizDoCompasso(secao, compasso)
  const ultimo = compasso === tamanho - 1
  const virada = ultimo && secao !== 'final' && noCompasso >= 12
  // Na introdução, os dois primeiros compassos são da guitarra sozinha.
  const bandaEntrou = secao !== 'intro' || compasso >= 2

  // Bateria.
  if (bandaEntrou && secao !== 'final') {
    e.prato = noCompasso === 0 && (compasso === 0 || (secao === 'intro' && compasso === 2) || (secao === 'refrao' && compasso === 4))
    if (noCompasso === 4 || noCompasso === 12) e.caixa = 1
    if (secao === 'refrao') {
      if (noCompasso === 0 || noCompasso === 6 || noCompasso === 8) e.bumbo = noCompasso === 6 ? 0.75 : 1
      if (noCompasso % 2 === 0) {
        e.chimbal = noCompasso % 4 === 0 ? 0.7 : 0.6
        e.chimbalAberto = noCompasso % 4 === 2
      }
    } else {
      if (noCompasso === 0 || noCompasso === 8) e.bumbo = 1
      if (noCompasso === 10 && compasso % 4 === 3) e.bumbo = 0.7
      if (noCompasso % 2 === 0) {
        e.chimbal = noCompasso % 4 === 0 ? 0.7 : 0.45
        // No solo o chimbal abre no contratempo: a mesma batida, mais aberta.
        e.chimbalAberto = secao === 'solo' && noCompasso % 4 === 2
      }
    }
    if (virada) {
      e.caixa = 0.55 + (0.45 * (noCompasso - 12)) / 3
      e.chimbal = 0
      e.chimbalAberto = false
      e.bumbo = noCompasso === 12 ? 1 : 0
    }
  } else if (secao === 'intro' && compasso === 1 && noCompasso % 4 === 0) {
    // A contagem no chimbal, antes da banda entrar.
    e.chimbal = 0.8
  } else if (secao === 'final' && noCompasso === 0) {
    e.prato = true
    e.bumbo = 1
    e.caixa = compasso === 1 ? 1 : 0
  }

  // Guitarra base.
  if (secao === 'refrao') {
    const golpe = GOLPES_DO_REFRAO.get(noCompasso)
    if (golpe && !virada) e.guitarra = { raiz, passos: golpe, abafada: false, intervalos: MAIOR, crunch: true }
  } else if (secao === 'final') {
    if (noCompasso === 0) e.guitarra = { raiz, passos: 16, abafada: false, intervalos: MAIOR_COM_QUINTA, crunch: true }
  } else if (!virada || secao === 'intro') {
    // O boogie: quinta, sexta, quinta, sexta — e no fim de cada quatro
    // compassos a sétima no lugar da segunda quinta.
    const tempo = noCompasso % 4
    const golpe = Math.floor(noCompasso / 4)
    if (tempo === 0) {
      const intervalos = golpe % 2 === 1 ? SEXTA : golpe === 2 && compasso % 4 === 3 ? SETIMA : QUINTA
      e.guitarra = { raiz, passos: 2, abafada: false, intervalos, crunch: true }
    } else if (tempo === 2 || tempo === 3) {
      e.guitarra = { raiz, passos: 1, abafada: true, intervalos: QUINTA, crunch: true }
    }
  }

  // Baixo.
  if (bandaEntrou) {
    const b = raiz - 12
    if (secao === 'refrao') {
      if (noCompasso % 2 === 0 && !virada) e.baixo = { nota: b + (noCompasso % 8 === 6 ? 12 : 0), passos: 2 }
    } else if (secao === 'final') {
      if (noCompasso === 0) e.baixo = { nota: b, passos: 16 }
    } else if (noCompasso % 2 === 0 && !(virada && secao !== 'intro')) {
      // O baixo de boogie: sobe pelo acorde com a sexta e a sétima, e desce.
      const caminho = [0, 4, 7, 9, 10, 9, 7, 4]
      e.baixo = { nota: b + caminho[noCompasso / 2], passos: 2 }
    }
  }

  // Guitarra solo.
  if (secao === 'refrao') e.solo = notaDaFrase(TEMA[compasso], noCompasso)
  else if (secao === 'solo') e.solo = notaDaFrase(SOLO[compasso], noCompasso)
  else if (secao === 'estrofe' && RESPOSTAS[compasso]) e.solo = notaDaFrase(RESPOSTAS[compasso], noCompasso)
  else if (secao === 'final' && compasso === 0 && noCompasso === 0) e.solo = { nota: N.A5, passos: 16 }

  return e
}

export const PARTITURA_MOTOR_QUENTE: Partitura = {
  bpm: MOTOR_QUENTE_BPM,
  passos: PASSOS_MOTOR_QUENTE,
  eventos: eventosMotorQuente,
  // Medido: com 0,5 ela saía três decibéis e meio abaixo do rock.
  volume: 0.74,
}

/** Frases do tema, do solo e das respostas, para os testes conferirem a soma dos compassos. */
export const FRASES_MOTOR_QUENTE: readonly Frase[] = [...TEMA, ...SOLO, ...Object.values(RESPOSTAS)]
