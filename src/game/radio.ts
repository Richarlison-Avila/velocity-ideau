/**
 * Rádio Fantasma: a programação musical da corrida.
 *
 * Cinco faixas, todas geradas na hora pela banda de `banda.ts` ou pelo chip de
 * `trilhaTurbo.ts`, tocando uma depois da outra com a vinheta da rádio entre
 * elas. O piloto pode pular para a próxima a qualquer momento.
 *
 * A primeira faixa de cada corrida sai da semente do traçado
 * (`faixaDaCorrida`), igual em todos os aparelhos da sala: todo mundo larga
 * ouvindo a mesma música. Dali em diante cada um anda na própria rádio.
 *
 * Só a faixa no ar existe no grafo de áudio. As outras nem são criadas: cinco
 * bandas paradas, cada uma com seus amplificadores simulados, custariam
 * processador do celular sem tocar nada.
 */
import { Banda, duracaoDoPasso, type HostDaTrilha, type Partitura } from './banda'
import { DURACAO_DO_PASSO, PASSOS_DA_TRILHA, TrilhaRock } from './trilha'
import { PARTITURA_LARGADA } from './trilhaLargada'
import { PARTITURA_MOTOR_QUENTE } from './trilhaMotorQuente'
import { TURBO_DURACAO_DO_PASSO, TURBO_PASSOS_DA_TRILHA, TrilhaTurbo } from './trilhaTurbo'
import { PARTITURA_ULTIMA_VOLTA } from './trilhaUltimaVolta'

/** O que a rádio precisa de uma faixa tocando. */
export type Tocador = {
  start(): void
  stop(queda?: number): void
  setEnabled(ligada: boolean): void
  readonly playing: boolean
  close(): void
}

export type IdDaFaixa = 'rock' | 'turbo' | 'motor-quente' | 'ultima-volta' | 'largada-queimada'

export type FaixaDaRadio = {
  id: IdDaFaixa
  nome: string
  estilo: string
  /** Segundos de uma volta da faixa. */
  duracao: number
  /** Quantas voltas a faixa toca antes de a rádio passar à próxima. */
  voltas: number
  criar(ctx: HostDaTrilha, destino: AudioNode, ruido: AudioBuffer): Tocador
}

function deBanda(partitura: Partitura) {
  return {
    duracao: partitura.passos * duracaoDoPasso(partitura.bpm),
    criar: (ctx: HostDaTrilha, destino: AudioNode, ruido: AudioBuffer) => new Banda(ctx, destino, ruido, partitura),
  }
}

/**
 * A programação, na ordem em que toca.
 *
 * As duas faixas que podem abrir a corrida — o rock e o Turbo — ficam
 * intercaladas com as outras: seja qual for a abertura, a segunda faixa é
 * sempre de outro estilo. As de um minuto tocam duas voltas; as longas, uma.
 */
export const PROGRAMACAO: readonly FaixaDaRadio[] = [
  {
    id: 'rock',
    nome: 'Pé Embaixo',
    estilo: 'rock de corrida',
    duracao: PASSOS_DA_TRILHA * DURACAO_DO_PASSO,
    voltas: 2,
    criar: (ctx, destino, ruido) => new TrilhaRock(ctx, destino, ruido),
  },
  { id: 'motor-quente', nome: 'Motor Quente', estilo: 'hard rock', voltas: 1, ...deBanda(PARTITURA_MOTOR_QUENTE) },
  {
    id: 'turbo',
    nome: 'Turbo',
    estilo: 'synth de 16 bits',
    duracao: TURBO_PASSOS_DA_TRILHA * TURBO_DURACAO_DO_PASSO,
    voltas: 2,
    criar: (ctx, destino, ruido) => new TrilhaTurbo(ctx, destino, ruido),
  },
  { id: 'ultima-volta', nome: 'Última Volta', estilo: 'rock épico', voltas: 1, ...deBanda(PARTITURA_ULTIMA_VOLTA) },
  { id: 'largada-queimada', nome: 'Largada Queimada', estilo: 'punk rock', voltas: 1, ...deBanda(PARTITURA_LARGADA) },
]

/** A faixa que vem depois de uma, dando a volta na programação. */
export function proximaDaProgramacao(indice: number) {
  const n = PROGRAMACAO.length
  const inteiro = Number.isFinite(indice) ? Math.floor(indice) : 0
  return (((inteiro + 1) % n) + n) % n
}

/** Posição de uma faixa na programação; o desconhecido cai na primeira. */
export function indiceDaFaixa(id: string) {
  const indice = PROGRAMACAO.findIndex((faixa) => faixa.id === id)
  return indice < 0 ? 0 : indice
}

/** Silêncio entre o fim de uma faixa e o começo da seguinte, com a vinheta no meio. */
export const INTERVALO_ENTRE_FAIXAS = 1.4

/** De quanto em quanto tempo a rádio confere se a faixa acabou, em milissegundos. */
const INTERVALO_DO_RELOGIO = 150

/** Volume da vinheta, sob o da música. */
const VOLUME_DA_VINHETA = 0.34

type NoAr = { faixa: FaixaDaRadio; tocador: Tocador; saida: GainNode; fim: number }

export class Radio {
  private indice: number
  private noAr: NoAr | null = null
  private relogio: ReturnType<typeof setInterval> | null = null
  /** Instante em que a próxima faixa entra, durante a vinheta. */
  private proximaEm: number | null = null
  private ligada = true
  private tocando = false
  private readonly ouvintes = new Set<(faixa: FaixaDaRadio) => void>()

  constructor(
    private readonly ctx: HostDaTrilha,
    private readonly destino: AudioNode,
    private readonly ruido: AudioBuffer,
    primeira: IdDaFaixa = 'rock',
  ) {
    this.indice = indiceDaFaixa(primeira)
  }

  /** A faixa no ar — ou a que vai entrar, antes da largada. */
  get faixa(): FaixaDaRadio {
    return PROGRAMACAO[this.indice]
  }

  get playing() {
    return this.tocando
  }

  /** Avisa a cada faixa que entra no ar. Devolve a função que cancela o aviso. */
  aoTrocar(ouvinte: (faixa: FaixaDaRadio) => void) {
    this.ouvintes.add(ouvinte)
    return () => {
      this.ouvintes.delete(ouvinte)
    }
  }

  /** A rádio entra no ar, na faixa da vez. É o "VAI!" da largada. */
  start() {
    if (this.tocando) return
    this.tocando = true
    this.proximaEm = null
    this.tocarAtual()
    this.relogio = setInterval(() => this.conferir(), INTERVALO_DO_RELOGIO)
  }

  /** Sai do ar aos poucos: a bandeirada não pode cortar a música no meio do golpe. */
  stop(queda = 1.4) {
    if (!this.tocando) return
    this.tocando = false
    this.proximaEm = null
    if (this.relogio !== null) clearInterval(this.relogio)
    this.relogio = null
    this.encerrarAtual(queda)
  }

  /** Liga ou desliga a música sem mexer no resto do som. */
  setEnabled(ligada: boolean) {
    this.ligada = ligada
    this.noAr?.tocador.setEnabled(ligada)
  }

  /**
   * Pula para a próxima faixa.
   *
   * No ar, a faixa atual some em um terço de segundo, a vinheta toca e a
   * próxima entra logo depois. Fora do ar — antes da largada —, só muda a
   * faixa que vai abrir.
   */
  proxima() {
    if (!this.tocando) {
      this.indice = proximaDaProgramacao(this.indice)
      return
    }
    if (this.proximaEm !== null) {
      // Já está na vinheta: a próxima entra agora, sem esperar.
      this.proximaEm = this.ctx.currentTime
      this.conferir()
      return
    }
    this.encerrarAtual(0.3)
    this.vinheta(this.ctx.currentTime + 0.15)
    this.proximaEm = this.ctx.currentTime + 0.9
  }

  close() {
    this.stop(0.05)
    this.ouvintes.clear()
  }

  private tocarAtual() {
    const faixa = PROGRAMACAO[this.indice]
    const saida = this.ctx.createGain()
    saida.gain.setValueAtTime(1, this.ctx.currentTime)
    saida.connect(this.destino)
    const tocador = faixa.criar(this.ctx, saida, this.ruido)
    tocador.setEnabled(this.ligada)
    tocador.start()
    // A faixa começa um vigésimo de segundo depois de pedida, como toda banda.
    this.noAr = { faixa, tocador, saida, fim: this.ctx.currentTime + 0.05 + faixa.duracao * faixa.voltas }
    for (const ouvinte of this.ouvintes) ouvinte(faixa)
  }

  /** Tira a faixa do ar e, depois da queda, a desliga do grafo de áudio. */
  private encerrarAtual(queda: number) {
    const velho = this.noAr
    if (!velho) return
    this.noAr = null
    velho.tocador.stop(queda)
    // Os ecos da faixa ainda soam um pouco depois do fim do volume: desligar
    // antes cortaria a cauda da última nota.
    setTimeout(() => {
      velho.tocador.close()
      velho.saida.disconnect()
    }, (queda + 1.2) * 1000)
  }

  private conferir() {
    if (!this.tocando) return
    const agora = this.ctx.currentTime
    if (this.proximaEm !== null) {
      if (agora < this.proximaEm) return
      this.proximaEm = null
      this.indice = proximaDaProgramacao(this.indice)
      this.tocarAtual()
      return
    }
    if (this.noAr && agora >= this.noAr.fim) {
      // A faixa acabou: a última nota some, a vinheta passa, e a próxima entra.
      this.encerrarAtual(0.8)
      this.vinheta(agora + 0.35)
      this.proximaEm = agora + INTERVALO_ENTRE_FAIXAS
    }
  }

  /**
   * A vinheta da Rádio Fantasma: um sopro de ruído subindo e quatro notas de
   * sino num arpejo maior, com eco. Pouco mais de um segundo — o bastante para
   * dizer que a rádio mudou de música, e não o bastante para atrapalhar.
   */
  private vinheta(t: number) {
    if (!this.ligada) return
    const saida = this.ctx.createGain()
    saida.gain.setValueAtTime(VOLUME_DA_VINHETA, t)
    saida.connect(this.destino)
    const eco = this.ctx.createDelay(1)
    eco.delayTime.setValueAtTime(0.19, t)
    const retorno = this.ctx.createGain()
    retorno.gain.setValueAtTime(0.32, t)
    eco.connect(retorno).connect(eco)
    retorno.connect(saida)

    // O sopro: ruído num filtro de banda que sobe de 300 a 3.500 Hz.
    const sopro = this.ctx.createBufferSource()
    sopro.buffer = this.ruido
    const filtro = this.ctx.createBiquadFilter()
    filtro.type = 'bandpass'
    filtro.Q.setValueAtTime(2.2, t)
    filtro.frequency.setValueAtTime(300, t)
    filtro.frequency.exponentialRampToValueAtTime(3_500, t + 0.45)
    const envelope = this.ctx.createGain()
    envelope.gain.setValueAtTime(0, t)
    envelope.gain.linearRampToValueAtTime(0.35, t + 0.3)
    envelope.gain.exponentialRampToValueAtTime(0.001, t + 0.55)
    sopro.connect(filtro).connect(envelope).connect(saida)
    sopro.start(t, Math.random() * Math.max(0, this.ruido.duration - 0.7))
    sopro.stop(t + 0.6)

    // O sino: sol, dó, mi e sol, subindo — a assinatura da rádio.
    ;[79, 84, 88, 91].forEach((nota, i) => {
      const inicio = t + 0.4 + i * 0.11
      const frequencia = 440 * 2 ** ((nota - 69) / 12)
      const ganho = this.ctx.createGain()
      ganho.gain.setValueAtTime(0, inicio)
      ganho.gain.linearRampToValueAtTime(0.4, inicio + 0.005)
      ganho.gain.exponentialRampToValueAtTime(0.001, inicio + 0.7)
      ganho.connect(saida)
      ganho.connect(eco)
      for (const [tipo, multiplo, volume] of [['sine', 1, 1], ['triangle', 2, 0.18], ['sine', 3.01, 0.08]] as const) {
        const osc = this.ctx.createOscillator()
        osc.type = tipo
        osc.frequency.setValueAtTime(frequencia * multiplo, inicio)
        const mistura = this.ctx.createGain()
        mistura.gain.setValueAtTime(volume, inicio)
        osc.connect(mistura).connect(ganho)
        osc.start(inicio)
        osc.stop(inicio + 0.75)
      }
    })
    setTimeout(() => saida.disconnect(), (t - this.ctx.currentTime + 2.5) * 1000)
  }
}
