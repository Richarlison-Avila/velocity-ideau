/**
 * Trilha "Turbo": synth de corrida de 16 bits, gerado na hora.
 *
 * A trilha de rock (`trilha.ts`) é a guitarra; esta é o outro lado de Top
 * Gear, o do chip do Super Nintendo: baixo pulando de oitava em semicolcheias,
 * arpejo de chip correndo por baixo, metais sintetizados nos contratempos e um
 * lead de onda quadrada com vibrato por cima. Tom maior, andamento alto — é a
 * música de quem está com o pé embaixo e o sol na cara.
 *
 * A composição é original. O que vem de Top Gear é a receita, não as notas.
 *
 * Como a de rock, é pura em cima (o que toca em cada passo) e Web Audio
 * embaixo (como soa), para a partitura poder ser conferida sem navegador.
 *
 * ## A música
 *
 * Lá maior, 160 batidas por minuto, em semicolcheias. Quatro seções de oito
 * compassos — tema, refrão, tema e ponte —, 48 segundos no total.
 *
 * - **Tema**: o lead conta a melodia, o baixo pula de oitava sem parar e o
 *   arpejo fica baixinho, de cama.
 * - **Refrão**: notas longas no lead, metais sincopados e o chimbal aberto.
 * - **Ponte**: o lead sai, o arpejo vem para a frente e a harmonia passa pelo
 *   sol natural — o sétimo grau abaixado, que é o sotaque de toda trilha de
 *   corrida da época — antes do mi que devolve ao tema.
 */
import { frequenciaDaNota, type HostDaTrilha } from './trilha'

// ---------------------------------------------------------------------------
// Composição
// ---------------------------------------------------------------------------

export const TURBO_BPM = 160

export const TURBO_PASSOS_POR_COMPASSO = 16

/** Duração de um passo (semicolcheia), em segundos. */
export const TURBO_DURACAO_DO_PASSO = 60 / TURBO_BPM / 4

export const TURBO_COMPASSOS_POR_SECAO = 8

export type SecaoTurbo = 'tema' | 'refrao' | 'ponte'

export const TURBO_ROTEIRO: readonly SecaoTurbo[] = ['tema', 'refrao', 'tema', 'ponte']

export const TURBO_PASSOS_DA_TRILHA = TURBO_ROTEIRO.length * TURBO_COMPASSOS_POR_SECAO * TURBO_PASSOS_POR_COMPASSO

/** Notas MIDI usadas, para a partitura poder ser lida. */
const N = {
  Fs2: 42, G2: 43, A2: 45, Cs3: 49, D3: 50, E3: 52,
  A4: 69, B4: 71, Cs5: 73, D5: 74, E5: 76, Fs5: 78, Gs5: 80, A5: 81, B5: 83, Cs6: 85,
}

/** Acorde de um compasso: raiz na oitava do baixo e se é maior ou menor. */
export type Acorde = { raiz: number; menor: boolean }

const M = (raiz: number): Acorde => ({ raiz, menor: false })
const m = (raiz: number): Acorde => ({ raiz, menor: true })

const HARMONIA: Record<SecaoTurbo, readonly Acorde[]> = {
  // I, vi, IV, V: o carrossel de todo tema de corrida alegre.
  tema: [M(N.A2), M(N.A2), m(N.Fs2), m(N.Fs2), M(N.D3), M(N.E3), M(N.A2), M(N.E3)],
  // O refrão começa fora da tônica, no ré, e só chega ao lá no sétimo
  // compasso — é essa demora que faz ele subir.
  refrao: [M(N.D3), M(N.E3), m(N.Cs3), m(N.Fs2), M(N.D3), M(N.E3), M(N.A2), M(N.E3)],
  // Fá sustenido menor, ré, sol natural e mi: a ponte sai do tom e volta.
  ponte: [m(N.Fs2), m(N.Fs2), M(N.D3), M(N.D3), M(N.G2), M(N.G2), M(N.E3), M(N.E3)],
}

type Frase = readonly (readonly [number, number])[]

/** Melodia do tema: nota e duração em passos; cada compasso soma dezesseis. */
const MELODIA_DO_TEMA: readonly Frase[] = [
  [[N.A4, 3], [N.Cs5, 3], [N.E5, 2], [N.A5, 4], [N.Gs5, 2], [N.E5, 2]],
  [[N.Fs5, 2], [N.E5, 2], [N.Cs5, 4], [N.B4, 2], [N.Cs5, 2], [N.E5, 4]],
  [[N.Fs5, 3], [N.E5, 3], [N.Cs5, 2], [N.Fs5, 4], [N.A5, 4]],
  [[N.Gs5, 6], [N.Fs5, 2], [N.E5, 4], [N.Cs5, 4]],
  [[N.D5, 2], [N.Fs5, 2], [N.A5, 4], [N.B5, 2], [N.A5, 2], [N.Fs5, 4]],
  [[N.E5, 2], [N.Gs5, 2], [N.B5, 4], [N.A5, 2], [N.Gs5, 2], [N.E5, 4]],
  [[N.Cs6, 4], [N.B5, 2], [N.A5, 2], [N.E5, 4], [N.Cs5, 4]],
  // Sobe pelo acorde de mi: é a escada de volta para o começo.
  [[N.B4, 4], [N.E5, 4], [N.Gs5, 4], [N.B5, 4]],
]

/** Melodia do refrão: notas longas, o gancho repetido dois compassos a dois. */
const MELODIA_DO_REFRAO: readonly Frase[] = [
  [[N.A5, 6], [N.Fs5, 2], [N.A5, 4], [N.B5, 4]],
  [[N.B5, 6], [N.Gs5, 2], [N.E5, 4], [N.B5, 4]],
  [[N.Cs6, 6], [N.B5, 2], [N.Gs5, 4], [N.E5, 4]],
  [[N.Fs5, 8], [N.A5, 4], [N.Cs6, 4]],
  [[N.A5, 6], [N.Fs5, 2], [N.A5, 4], [N.B5, 4]],
  [[N.B5, 6], [N.Gs5, 2], [N.B5, 4], [N.Cs6, 4]],
  [[N.Cs6, 8], [N.B5, 4], [N.A5, 4]],
  [[N.Gs5, 4], [N.A5, 2], [N.B5, 2], [N.E5, 8]],
]

/** Onde os metais atacam no refrão e na ponte: a síncope de todo tema de 16 bits. */
const METAIS = new Map([[0, 3], [3, 3], [6, 2], [10, 2], [12, 4]])

export type EventosTurbo = {
  secao: SecaoTurbo
  compasso: number
  bumbo: number
  caixa: number
  chimbal: number
  chimbalAberto: boolean
  prato: boolean
  /** Nota do baixo: o pulo de oitava é a assinatura. */
  baixo: number | null
  /** Nota do arpejo de chip, e o quanto ele aparece. */
  arpejo: { nota: number; volume: number } | null
  /** Acorde dos metais: três notas e a duração em passos. */
  metais: { notas: readonly number[]; passos: number } | null
  lead: { nota: number; passos: number } | null
}

/** As três notas de um acorde, a partir de uma raiz. */
export function triade(acorde: Acorde, oitavas = 0) {
  const raiz = acorde.raiz + 12 * oitavas
  return [raiz, raiz + (acorde.menor ? 3 : 4), raiz + 7]
}

function melodiaDoCompasso(frase: Frase, noCompasso: number) {
  let inicio = 0
  for (const [nota, passos] of frase) {
    if (inicio === noCompasso) return { nota, passos }
    inicio += passos
  }
  return null
}

/**
 * O que toca num passo da trilha. Aceita qualquer número — dá a volta — e
 * trata lixo como o primeiro passo, como a de rock.
 */
export function eventosTurbo(passoBruto: number): EventosTurbo {
  const inteiro = Number.isFinite(passoBruto) ? Math.floor(passoBruto) : 0
  const passo = ((inteiro % TURBO_PASSOS_DA_TRILHA) + TURBO_PASSOS_DA_TRILHA) % TURBO_PASSOS_DA_TRILHA
  const noCompasso = passo % TURBO_PASSOS_POR_COMPASSO
  const compassoGeral = Math.floor(passo / TURBO_PASSOS_POR_COMPASSO)
  const secao = TURBO_ROTEIRO[Math.floor(compassoGeral / TURBO_COMPASSOS_POR_SECAO)]
  const compasso = compassoGeral % TURBO_COMPASSOS_POR_SECAO
  const acorde = HARMONIA[secao][compasso]
  const ultimo = compasso === TURBO_COMPASSOS_POR_SECAO - 1
  const virada = ultimo && noCompasso >= 12

  const e: EventosTurbo = {
    secao,
    compasso,
    bumbo: 0,
    caixa: 0,
    chimbal: 0,
    chimbalAberto: false,
    prato: compasso === 0 && noCompasso === 0,
    baixo: null,
    arpejo: null,
    metais: null,
    lead: null,
  }

  // Bateria: bumbo em "um, e-do-dois, três", caixa no dois e no quatro,
  // chimbal em semicolcheias com acento na colcheia.
  if (noCompasso === 0 || noCompasso === 6 || noCompasso === 8) e.bumbo = noCompasso === 6 ? 0.7 : 1
  if (secao === 'refrao' && noCompasso === 11) e.bumbo = 0.7
  if (noCompasso === 4 || noCompasso === 12) e.caixa = 1
  if (secao === 'refrao' && noCompasso % 4 === 2) {
    e.chimbal = 0.7
    e.chimbalAberto = true
  } else {
    e.chimbal = noCompasso % 2 === 0 ? 0.6 : 0.3
  }

  // Virada: quatro caixas crescendo, o bumbo junto na primeira.
  if (virada) {
    e.caixa = 0.55 + (0.45 * (noCompasso - 12)) / 3
    e.chimbal = 0
    e.chimbalAberto = false
    if (noCompasso === 12) e.bumbo = 1
  }

  // Baixo: semicolcheias pulando entre a raiz e a oitava de cima. Na virada
  // ele fica só na raiz, e em colcheias, para dar espaço à caixa.
  if (!virada) e.baixo = acorde.raiz + (noCompasso % 2 === 1 ? 12 : 0)
  else if (noCompasso % 2 === 0) e.baixo = acorde.raiz

  // Arpejo: a tríade duas oitavas acima do baixo, subindo e descendo.
  const notas = triade(acorde, 2)
  const sobeDesce = [0, 1, 2, 1]
  e.arpejo = {
    nota: notas[sobeDesce[noCompasso % 4]] + (noCompasso % 8 >= 4 ? 12 : 0),
    volume: secao === 'ponte' ? 1 : 0.4,
  }

  // Metais: no refrão e na ponte, na síncope.
  if ((secao === 'refrao' || secao === 'ponte') && METAIS.has(noCompasso) && !virada) {
    e.metais = { notas: triade(acorde, 1), passos: METAIS.get(noCompasso)! }
  }

  if (secao === 'tema') e.lead = melodiaDoCompasso(MELODIA_DO_TEMA[compasso], noCompasso)
  else if (secao === 'refrao') e.lead = melodiaDoCompasso(MELODIA_DO_REFRAO[compasso], noCompasso)

  return e
}

// ---------------------------------------------------------------------------
// Ligação com o Web Audio
// ---------------------------------------------------------------------------

/** Volume da trilha, abaixo do motor como a de rock. */
export const VOLUME_DA_TURBO = 0.5

const ANTECEDENCIA = 0.14
const INTERVALO_DO_AGENDADOR = 25

export class TrilhaTurbo {
  private readonly saida: GainNode
  private readonly bateria: GainNode
  private readonly grave: GainNode
  private readonly chip: GainNode
  private readonly metal: GainNode
  private readonly lead: GainNode
  private relogio: ReturnType<typeof setInterval> | null = null
  private proximo = 0
  private passo = 0
  private tocando = false
  private ligada = true

  constructor(private readonly ctx: HostDaTrilha, destino: AudioNode, private readonly ruido: AudioBuffer) {
    const agora = ctx.currentTime
    this.saida = ctx.createGain()
    this.saida.gain.setValueAtTime(0, agora)
    this.saida.connect(destino)

    // Os faders saíram de medição, não de ouvido: a loudness (BS.1770) de
    // cada instrumento sozinho e da mistura, renderizada fora de tempo real.
    // A faixa inteira fica em −19 LUFS com pico de 0,62 no master, a um passo
    // da de rock (−17,5 LUFS, pico 0,58) — trocar de faixa entre uma prova e
    // outra não dá tombo de volume. O lead vai na frente, o baixo logo atrás,
    // e o arpejo é cama. A bateria vai acima de 1 porque cada golpe foi
    // desenhado baixo; não sobe mais porque o bumbo, quase todo grave, pesa
    // pouco no ouvido e muito no pico.
    this.bateria = this.barramento(2)
    this.grave = this.barramento(1.2)
    this.chip = this.barramento(0.47)

    // Metais: serras passando por um passa-baixa que o envelope abre e fecha
    // em cada ataque — o "bwaa" do sintetizador de 16 bits.
    this.metal = this.barramento(0.6)

    // Lead: quadrada e um eco pontuado, que é o que o faz soar num estádio.
    this.lead = ctx.createGain()
    this.lead.gain.setValueAtTime(1.1, agora)
    const brilho = ctx.createBiquadFilter()
    brilho.type = 'lowpass'
    brilho.frequency.setValueAtTime(4_200, agora)
    const eco = ctx.createDelay(1)
    eco.delayTime.setValueAtTime(TURBO_DURACAO_DO_PASSO * 3, agora)
    const retorno = ctx.createGain()
    retorno.gain.setValueAtTime(0.3, agora)
    this.lead.connect(brilho)
    brilho.connect(this.saida)
    brilho.connect(eco).connect(retorno).connect(eco)
    retorno.connect(this.saida)
  }

  private barramento(volume: number) {
    const ganho = this.ctx.createGain()
    ganho.gain.setValueAtTime(volume, this.ctx.currentTime)
    ganho.connect(this.saida)
    return ganho
  }

  start() {
    if (this.tocando) return
    this.tocando = true
    this.passo = 0
    this.proximo = this.ctx.currentTime + 0.05
    this.saida.gain.cancelScheduledValues(this.ctx.currentTime)
    this.saida.gain.setTargetAtTime(this.ligada ? VOLUME_DA_TURBO : 0, this.ctx.currentTime, 0.05)
    this.agendar()
    this.relogio = setInterval(() => this.agendar(), INTERVALO_DO_AGENDADOR)
  }

  stop(queda = 1.4) {
    if (!this.tocando) return
    this.tocando = false
    if (this.relogio !== null) clearInterval(this.relogio)
    this.relogio = null
    this.saida.gain.setTargetAtTime(0, this.ctx.currentTime, queda / 3)
  }

  setEnabled(ligada: boolean) {
    this.ligada = ligada
    if (this.tocando) this.saida.gain.setTargetAtTime(ligada ? VOLUME_DA_TURBO : 0, this.ctx.currentTime, 0.08)
  }

  get playing() {
    return this.tocando
  }

  private agendar() {
    if (!this.tocando) return
    const agora = this.ctx.currentTime
    // Voltando de uma aba em segundo plano, retoma do agora em vez de
    // despejar todas as notas atrasadas de uma vez.
    if (this.proximo < agora - 0.05) this.proximo = agora + 0.02
    while (this.proximo < agora + ANTECEDENCIA) {
      this.tocarPasso(eventosTurbo(this.passo), this.proximo)
      this.proximo += TURBO_DURACAO_DO_PASSO
      this.passo = (this.passo + 1) % TURBO_PASSOS_DA_TRILHA
    }
  }

  private tocarPasso(e: EventosTurbo, t: number) {
    const passo = TURBO_DURACAO_DO_PASSO
    if (e.prato) this.ruidoFiltrado(t, 'highpass', 5_600, 0.24, 1.1)
    if (e.bumbo > 0) this.bumbo(t, e.bumbo)
    if (e.caixa > 0) this.caixa(t, e.caixa)
    if (e.chimbal > 0) this.ruidoFiltrado(t, 'highpass', 8_000, 0.13 * e.chimbal, e.chimbalAberto ? 0.16 : 0.03)
    if (e.baixo !== null) this.tom(this.grave, 'square', e.baixo, t, passo * 0.85, 0.5, 1_100)
    if (e.arpejo) this.tom(this.chip, 'square', e.arpejo.nota, t, passo * 0.7, e.arpejo.volume, 6_000)
    if (e.metais) this.metais(e.metais.notas, t, e.metais.passos * passo)
    if (e.lead) this.voz(e.lead.nota, t, e.lead.passos * passo)
  }

  private ruidoFiltrado(t: number, tipo: BiquadFilterType, frequencia: number, volume: number, duracao: number, q = 0.7) {
    const fonte = this.ctx.createBufferSource()
    fonte.buffer = this.ruido
    const filtro = this.ctx.createBiquadFilter()
    filtro.type = tipo
    filtro.frequency.setValueAtTime(frequencia, t)
    filtro.Q.setValueAtTime(q, t)
    const ganho = this.ctx.createGain()
    ganho.gain.setValueAtTime(volume, t)
    ganho.gain.exponentialRampToValueAtTime(0.001, t + duracao)
    fonte.connect(filtro).connect(ganho).connect(this.bateria)
    const folga = Math.max(0, this.ruido.duration - duracao - 0.05)
    fonte.start(t, Math.random() * folga)
    fonte.stop(t + duracao + 0.02)
  }

  private bumbo(t: number, forca: number) {
    const osc = this.ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(170, t)
    osc.frequency.exponentialRampToValueAtTime(50, t + 0.09)
    const ganho = this.ctx.createGain()
    ganho.gain.setValueAtTime(0.9 * forca, t)
    ganho.gain.exponentialRampToValueAtTime(0.001, t + 0.22)
    osc.connect(ganho).connect(this.bateria)
    osc.start(t)
    osc.stop(t + 0.24)
  }

  /** Caixa de sampler antigo: ruído curto e um tom agudo que dá o estalo. */
  private caixa(t: number, forca: number) {
    this.ruidoFiltrado(t, 'bandpass', 2_600, 0.5 * forca, 0.13, 0.8)
    const corpo = this.ctx.createOscillator()
    corpo.type = 'triangle'
    corpo.frequency.setValueAtTime(260, t)
    corpo.frequency.exponentialRampToValueAtTime(180, t + 0.05)
    const ganho = this.ctx.createGain()
    ganho.gain.setValueAtTime(0.3 * forca, t)
    ganho.gain.exponentialRampToValueAtTime(0.001, t + 0.07)
    corpo.connect(ganho).connect(this.bateria)
    corpo.start(t)
    corpo.stop(t + 0.08)
  }

  /**
   * Nota de chip: ataque seco, um decaimento curto até o corpo da nota e a
   * soltura no fim. Decair até o silêncio dentro da semicolcheia, como um
   * pinçado, fazia do baixo um clique — medido, ele saía 15 dB abaixo da
   * bateria. A nota precisa durar o passo inteiro.
   */
  private tom(destino: AudioNode, tipo: OscillatorType, nota: number, t: number, duracao: number, volume: number, corte: number) {
    const osc = this.ctx.createOscillator()
    osc.type = tipo
    osc.frequency.setValueAtTime(frequenciaDaNota(nota), t)
    const filtro = this.ctx.createBiquadFilter()
    filtro.type = 'lowpass'
    filtro.frequency.setValueAtTime(corte, t)
    const ganho = this.ctx.createGain()
    ganho.gain.setValueAtTime(0, t)
    ganho.gain.linearRampToValueAtTime(volume, t + 0.004)
    ganho.gain.setTargetAtTime(volume * 0.6, t + 0.004, 0.04)
    ganho.gain.setTargetAtTime(0.0001, t + duracao, 0.01)
    osc.connect(filtro).connect(ganho).connect(destino)
    osc.start(t)
    osc.stop(t + duracao + 0.06)
  }

  private metais(notas: readonly number[], t: number, duracao: number) {
    const filtro = this.ctx.createBiquadFilter()
    filtro.type = 'lowpass'
    filtro.Q.setValueAtTime(4, t)
    filtro.frequency.setValueAtTime(500, t)
    filtro.frequency.exponentialRampToValueAtTime(3_200, t + 0.05)
    filtro.frequency.exponentialRampToValueAtTime(900, t + Math.max(0.08, duracao))
    const ganho = this.ctx.createGain()
    ganho.gain.setValueAtTime(0, t)
    ganho.gain.linearRampToValueAtTime(0.55, t + 0.012)
    ganho.gain.setTargetAtTime(0.45, t + 0.03, 0.08)
    ganho.gain.setTargetAtTime(0.0001, t + duracao * 0.9, 0.03)
    filtro.connect(ganho).connect(this.metal)
    // Seis serras largando juntas começam em fase e somam num estalo seis
    // vezes mais alto que o acorde. Um milímetro e meio de segundo entre uma
    // voz e outra — como um naipe de verdade, que nunca ataca em uníssono
    // perfeito — já as tira de fase, e o ouvido não percebe o atraso.
    let voz = 0
    for (const nota of notas) {
      for (const desafinacao of [-9, 9]) {
        const inicio = t + voz * 0.0015
        voz += 1
        const osc = this.ctx.createOscillator()
        osc.type = 'sawtooth'
        osc.frequency.setValueAtTime(frequenciaDaNota(nota), inicio)
        osc.detune.setValueAtTime(desafinacao, inicio)
        osc.connect(filtro)
        osc.start(inicio)
        osc.stop(t + duracao + 0.12)
      }
    }
  }

  /** Lead de onda quadrada, com o vibrato entrando só na nota longa. */
  private voz(nota: number, t: number, duracao: number) {
    const ganho = this.ctx.createGain()
    ganho.gain.setValueAtTime(0, t)
    ganho.gain.linearRampToValueAtTime(0.5, t + 0.008)
    ganho.gain.setTargetAtTime(0.38, t + 0.02, 0.12)
    ganho.gain.setTargetAtTime(0.0001, t + duracao * 0.9, 0.025)
    ganho.connect(this.lead)
    const vibrato = this.ctx.createOscillator()
    vibrato.frequency.setValueAtTime(6.2, t)
    const profundidade = this.ctx.createGain()
    profundidade.gain.setValueAtTime(0, t)
    profundidade.gain.linearRampToValueAtTime(duracao > 0.3 ? 18 : 0, t + Math.min(0.22, duracao))
    vibrato.connect(profundidade)
    for (const [tipo, desafinacao, volume] of [['square', 0, 1], ['square', 8, 0.5]] as const) {
      const osc = this.ctx.createOscillator()
      osc.type = tipo
      osc.frequency.setValueAtTime(frequenciaDaNota(nota), t)
      osc.detune.setValueAtTime(desafinacao, t)
      profundidade.connect(osc.detune)
      const mistura = this.ctx.createGain()
      mistura.gain.setValueAtTime(volume, t)
      osc.connect(mistura).connect(ganho)
      osc.start(t)
      osc.stop(t + duracao + 0.1)
    }
    vibrato.start(t)
    vibrato.stop(t + duracao + 0.1)
  }

  close() {
    this.stop(0.05)
  }
}
