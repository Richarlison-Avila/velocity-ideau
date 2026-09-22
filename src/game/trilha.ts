/**
 * Trilha sonora da corrida: rock, gerado na hora.
 *
 * Como o resto do som do jogo, nada de arquivo — a demonstração não pode
 * depender de asset nenhum. Bateria, baixo, guitarra base e guitarra solo saem
 * de osciladores e do mesmo ruído que faz o vento, passando por distorção e
 * caixa de som simuladas. É o que Top Gear fazia com o chip do Super Nintendo:
 * rock de corrida, pesado na base e com uma melodia que gruda.
 *
 * A parte que decide *o quê* toca em cada passo é pura e fica aqui em cima,
 * separada da parte que fala com o Web Audio — é o que permite testar a
 * composição sem um navegador. A de baixo só obedece.
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

/** Frequência de uma nota MIDI, em hertz. Lá 440. */
export function frequenciaDaNota(nota: number) {
  return 440 * 2 ** ((nota - 69) / 12)
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

/** Só o que a trilha usa de um AudioContext. */
export type HostDaTrilha = Pick<
  AudioContext,
  | 'createOscillator'
  | 'createGain'
  | 'createBiquadFilter'
  | 'createBufferSource'
  | 'createWaveShaper'
  | 'createDelay'
  | 'currentTime'
>

/** Volume da trilha, sob o motor: a música acompanha, quem manda é o carro. */
export const VOLUME_DA_TRILHA = 0.55

/** Quanto adiante as notas são agendadas, em segundos. */
const ANTECEDENCIA = 0.14

/** De quanto em quanto tempo o agendador acorda, em milissegundos. */
const INTERVALO_DO_AGENDADOR = 25

/**
 * Curva de saturação da guitarra.
 *
 * Um `tanh` apertado: o sinal passa quase reto enquanto é baixo e achata perto
 * do teto, que é o que um amplificador valvulado forçado faz. É o achatamento
 * que gera os harmônicos — e são eles, e não a nota, que fazem um acorde de
 * dente de serra virar guitarra de rock.
 */
function curvaDeSaturacao(ganho: number) {
  const pontos = 2_048
  const curva = new Float32Array(pontos)
  const normal = Math.tanh(ganho)
  for (let i = 0; i < pontos; i += 1) {
    const x = (i / (pontos - 1)) * 2 - 1
    curva[i] = Math.tanh(ganho * x) / normal
  }
  return curva
}

export class TrilhaRock {
  private readonly saida: GainNode
  private readonly bateria: GainNode
  private readonly baixo: GainNode
  private readonly base: GainNode
  private readonly solo: GainNode
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

    this.bateria = this.barramento(0.9)
    this.baixo = this.barramento(0.5)

    // Guitarra base: saturação forte, e depois a caixa de som — um corte de
    // grave que tira a lama e um corte de agudo que tira o chiado digital.
    this.base = ctx.createGain()
    this.base.gain.setValueAtTime(0.34, agora)
    const saturacao = ctx.createWaveShaper()
    saturacao.curve = curvaDeSaturacao(9)
    // Duas vezes basta: com quatro o chiado de dobra some de vez, mas a trilha
    // passava a custar um sexto de um núcleo de computador de mesa — num
    // celular, a metade do tempo do processador de áudio, disputando com o motor.
    saturacao.oversample = '2x'
    const semLama = ctx.createBiquadFilter()
    semLama.type = 'highpass'
    semLama.frequency.setValueAtTime(95, agora)
    const caixaDeSom = ctx.createBiquadFilter()
    caixaDeSom.type = 'lowpass'
    caixaDeSom.frequency.setValueAtTime(3_400, agora)
    caixaDeSom.Q.setValueAtTime(0.9, agora)
    this.base.connect(saturacao).connect(semLama).connect(caixaDeSom).connect(this.saida)

    // Guitarra solo: menos saturada, mais brilhante, com um eco curto que a
    // espalha — é o que a faz soar por cima da base em vez de brigar com ela.
    this.solo = ctx.createGain()
    this.solo.gain.setValueAtTime(0.2, agora)
    const saturacaoDoSolo = ctx.createWaveShaper()
    saturacaoDoSolo.curve = curvaDeSaturacao(4)
    const brilho = ctx.createBiquadFilter()
    brilho.type = 'lowpass'
    brilho.frequency.setValueAtTime(5_200, agora)
    const eco = ctx.createDelay(1)
    eco.delayTime.setValueAtTime(DURACAO_DO_PASSO * 3, agora)
    const retorno = ctx.createGain()
    retorno.gain.setValueAtTime(0.28, agora)
    this.solo.connect(saturacaoDoSolo).connect(brilho)
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

  /** Começa do primeiro compasso, com o prato. */
  start() {
    if (this.tocando) return
    this.tocando = true
    this.passo = 0
    this.proximo = this.ctx.currentTime + 0.05
    this.saida.gain.cancelScheduledValues(this.ctx.currentTime)
    this.saida.gain.setTargetAtTime(this.ligada ? VOLUME_DA_TRILHA : 0, this.ctx.currentTime, 0.05)
    this.agendar()
    this.relogio = setInterval(() => this.agendar(), INTERVALO_DO_AGENDADOR)
  }

  /** Some aos poucos: a bandeirada não pode cortar a música no meio do golpe. */
  stop(queda = 1.4) {
    if (!this.tocando) return
    this.tocando = false
    if (this.relogio !== null) clearInterval(this.relogio)
    this.relogio = null
    this.saida.gain.setTargetAtTime(0, this.ctx.currentTime, queda / 3)
  }

  /** Liga ou desliga a trilha sem mexer no resto do som. */
  setEnabled(ligada: boolean) {
    this.ligada = ligada
    if (this.tocando) this.saida.gain.setTargetAtTime(ligada ? VOLUME_DA_TRILHA : 0, this.ctx.currentTime, 0.08)
  }

  get playing() {
    return this.tocando
  }

  private agendar() {
    if (!this.tocando) return
    const agora = this.ctx.currentTime
    // Uma aba em segundo plano acorda o agendador uma vez por segundo, se
    // tanto. Voltando dela, as notas atrasadas não saem todas de uma vez: a
    // música retoma do agora, como um rádio que ficou sem sinal.
    if (this.proximo < agora - 0.05) this.proximo = agora + 0.02
    while (this.proximo < agora + ANTECEDENCIA) {
      this.tocarPasso(eventosDoPasso(this.passo), this.proximo)
      this.proximo += DURACAO_DO_PASSO
      this.passo = (this.passo + 1) % PASSOS_DA_TRILHA
    }
  }

  private tocarPasso(e: EventosDoPasso, t: number) {
    if (e.prato) this.prato(t)
    if (e.bumbo > 0) this.bumbo(t, e.bumbo)
    if (e.caixa > 0) this.caixa(t, e.caixa)
    if (e.chimbal > 0) this.chimbal(t, e.chimbal, e.chimbalAberto)
    if (e.baixo) this.nota(this.baixo, 'sawtooth', e.baixo.nota, t, e.baixo.passos * DURACAO_DO_PASSO * 0.9, 0.55, 520)
    if (e.guitarra) this.acorde(e.guitarra.raiz, t, e.guitarra.passos, e.guitarra.abafada)
    if (e.solo) this.voz(e.solo.nota, t, e.solo.passos * DURACAO_DO_PASSO)
  }

  /** Um ruído filtrado com envelope curto: a matéria de caixa, chimbal e prato. */
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
    // O buffer é compartilhado: cada golpe começa num ponto diferente dele,
    // senão todos os chimbais seriam o mesmo chimbal — e cedo o bastante para
    // o golpe caber inteiro antes do fim do buffer.
    const folga = Math.max(0, this.ruido.duration - duracao - 0.05)
    fonte.start(t, Math.random() * folga)
    fonte.stop(t + duracao + 0.02)
  }

  private bumbo(t: number, forca: number) {
    // Um seno que despenca de 150 para 45 Hz: o soco no peito do bumbo.
    const osc = this.ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(150, t)
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.12)
    const ganho = this.ctx.createGain()
    ganho.gain.setValueAtTime(0.95 * forca, t)
    ganho.gain.exponentialRampToValueAtTime(0.001, t + 0.3)
    osc.connect(ganho).connect(this.bateria)
    osc.start(t)
    osc.stop(t + 0.32)
    // E o estalo da pele, que é o que se ouve num alto-falante pequeno.
    this.ruidoFiltrado(t, 'highpass', 3_000, 0.12 * forca, 0.018)
  }

  private caixa(t: number, forca: number) {
    this.ruidoFiltrado(t, 'bandpass', 1_900, 0.55 * forca, 0.17, 0.6)
    const corpo = this.ctx.createOscillator()
    corpo.type = 'triangle'
    corpo.frequency.setValueAtTime(190, t)
    corpo.frequency.exponentialRampToValueAtTime(150, t + 0.07)
    const ganho = this.ctx.createGain()
    ganho.gain.setValueAtTime(0.32 * forca, t)
    ganho.gain.exponentialRampToValueAtTime(0.001, t + 0.09)
    corpo.connect(ganho).connect(this.bateria)
    corpo.start(t)
    corpo.stop(t + 0.1)
  }

  private chimbal(t: number, forca: number, aberto: boolean) {
    this.ruidoFiltrado(t, 'highpass', 7_200, 0.16 * forca, aberto ? 0.2 : 0.035)
  }

  private prato(t: number) {
    this.ruidoFiltrado(t, 'highpass', 5_200, 0.26, 1.3)
  }

  /** Uma nota com filtro de corte que fecha junto com o volume. */
  private nota(destino: AudioNode, tipo: OscillatorType, nota: number, t: number, duracao: number, volume: number, corte: number) {
    const osc = this.ctx.createOscillator()
    osc.type = tipo
    osc.frequency.setValueAtTime(frequenciaDaNota(nota), t)
    const filtro = this.ctx.createBiquadFilter()
    filtro.type = 'lowpass'
    filtro.frequency.setValueAtTime(corte * 2.2, t)
    filtro.frequency.exponentialRampToValueAtTime(corte, t + duracao)
    const ganho = this.ctx.createGain()
    ganho.gain.setValueAtTime(0, t)
    ganho.gain.linearRampToValueAtTime(volume, t + 0.006)
    ganho.gain.exponentialRampToValueAtTime(0.001, t + duracao)
    osc.connect(filtro).connect(ganho).connect(destino)
    osc.start(t)
    osc.stop(t + duracao + 0.02)
  }

  /**
   * Power chord: raiz, quinta e oitava, cada uma com duas serras levemente
   * desafinadas, somadas antes da saturação. É a soma saturada que produz a
   * aspereza do acorde de rock — saturadas uma a uma, soariam como três
   * guitarras limpas tocando juntas.
   */
  private acorde(raiz: number, t: number, passos: number, abafada: boolean) {
    const duracao = abafada ? DURACAO_DO_PASSO * 0.85 : passos * DURACAO_DO_PASSO * 0.95
    // A palma abafando as cordas escurece o som antes do amplificador.
    const palma = this.ctx.createBiquadFilter()
    palma.type = 'lowpass'
    palma.frequency.setValueAtTime(abafada ? 900 : 3_200, t)
    const ganho = this.ctx.createGain()
    ganho.gain.setValueAtTime(0, t)
    ganho.gain.linearRampToValueAtTime(abafada ? 0.8 : 0.62, t + 0.004)
    ganho.gain.setTargetAtTime(abafada ? 0.001 : 0.42, t + 0.01, abafada ? duracao / 3 : duracao)
    ganho.gain.setTargetAtTime(0.0001, t + duracao, 0.03)
    palma.connect(ganho).connect(this.base)
    for (const intervalo of [0, 7, 12]) {
      for (const desafinacao of [-7, 7]) {
        const osc = this.ctx.createOscillator()
        osc.type = 'sawtooth'
        osc.frequency.setValueAtTime(frequenciaDaNota(raiz + intervalo), t)
        osc.detune.setValueAtTime(desafinacao, t)
        osc.connect(palma)
        osc.start(t)
        osc.stop(t + duracao + 0.15)
      }
    }
  }

  /** Voz da guitarra solo, com o vibrato entrando na nota longa. */
  private voz(nota: number, t: number, duracao: number) {
    const ganho = this.ctx.createGain()
    ganho.gain.setValueAtTime(0, t)
    ganho.gain.linearRampToValueAtTime(0.5, t + 0.01)
    ganho.gain.setTargetAtTime(0.36, t + 0.02, 0.15)
    ganho.gain.setTargetAtTime(0.0001, t + duracao * 0.92, 0.03)
    ganho.connect(this.solo)
    const vibrato = this.ctx.createOscillator()
    vibrato.frequency.setValueAtTime(5.6, t)
    const profundidade = this.ctx.createGain()
    // O vibrato só aparece depois do ataque, como o de um guitarrista.
    profundidade.gain.setValueAtTime(0, t)
    profundidade.gain.linearRampToValueAtTime(duracao > 0.35 ? 22 : 6, t + Math.min(0.25, duracao))
    vibrato.connect(profundidade)
    for (const [tipo, desafinacao] of [['sawtooth', 0], ['square', 1_200]] as const) {
      const osc = this.ctx.createOscillator()
      osc.type = tipo
      osc.frequency.setValueAtTime(frequenciaDaNota(nota), t)
      osc.detune.setValueAtTime(desafinacao, t)
      profundidade.connect(osc.detune)
      const mistura = this.ctx.createGain()
      mistura.gain.setValueAtTime(tipo === 'square' ? 0.35 : 1, t)
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
