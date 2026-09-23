/**
 * A banda que toca as trilhas da rádio.
 *
 * Bateria, baixo, guitarra base, guitarra solo e, para as faixas que pedem,
 * violão dedilhado, flauta e teclado. Tudo sai de osciladores e do mesmo
 * ruído que faz o vento, passando por distorção e caixa de som simuladas —
 * nada de arquivo, como no resto do som do jogo.
 *
 * A banda não compõe: ela lê uma `Partitura`, que diz o que cada instrumento
 * faz em cada semicolcheia, e obedece. É o que deixa cada faixa ser pura —
 * testada nota a nota sem navegador — e todas soarem como a mesma banda, no
 * mesmo estúdio.
 *
 * As notas são agendadas pouco adiante, no relógio do áudio, e não no de
 * animação: a música não atrasa quando o quadro engasga.
 */

/** Só o que a banda usa de um AudioContext. */
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

/** Frequência de uma nota MIDI, em hertz. Lá 440. */
export function frequenciaDaNota(nota: number) {
  return 440 * 2 ** ((nota - 69) / 12)
}

/** Volume da trilha, sob o motor: a música acompanha, quem manda é o carro. */
export const VOLUME_DA_TRILHA = 0.55

/** Uma nota que dura alguns passos. */
export type NotaDaBanda = { nota: number; passos: number }

/** O que cada instrumento faz num passo. Zero é silêncio; o resto é intensidade. */
export type EventosDaBanda = {
  bumbo: number
  caixa: number
  chimbal: number
  chimbalAberto: boolean
  prato: boolean
  baixo: NotaDaBanda | null
  /**
   * Guitarra base. Sem `intervalos` é o power chord de sempre — raiz, quinta e
   * oitava; com eles, qualquer acorde. `crunch` passa pela saturação leve, a
   * de amplificador no limite, e não pela de parede de som.
   */
  guitarra: { raiz: number; passos: number; abafada: boolean; intervalos?: readonly number[]; crunch?: boolean } | null
  solo: NotaDaBanda | null
  /** Violão dedilhado: corda solta, ataque de unha e decaimento natural. */
  dedilhado?: NotaDaBanda | null
  /** Flauta: sopro suave, com o ar da respiração por baixo. */
  flauta?: NotaDaBanda | null
  /** Teclado de fundo: um acorde que entra devagar e segura. */
  teclado?: { notas: readonly number[]; passos: number } | null
}

/** O que uma faixa precisa dizer à banda. */
export type Partitura = {
  bpm: number
  /** Passos (semicolcheias) de uma volta inteira da faixa. */
  passos: number
  eventos: (passo: number) => EventosDaBanda
  /** Volume da faixa na mistura, para todas soarem igualmente altas. */
  volume?: number
}

/** Duração de uma semicolcheia, em segundos, num andamento. */
export function duracaoDoPasso(bpm: number) {
  return 60 / bpm / 4
}

// ---------------------------------------------------------------------------
// Ferramentas de partitura
// ---------------------------------------------------------------------------

/** Passos de um compasso: semicolcheias num quatro por quatro. */
export const PASSOS_DO_COMPASSO = 16

/** Uma frase de um compasso: nota (ou `null`, pausa) e duração em passos. */
export type Frase = readonly (readonly [number | null, number])[]

/** A nota que começa num passo do compasso, se alguma começa ali. */
export function notaDaFrase(frase: Frase, noCompasso: number): NotaDaBanda | null {
  let inicio = 0
  for (const [nota, passos] of frase) {
    if (inicio === noCompasso) return nota === null ? null : { nota, passos }
    inicio += passos
  }
  return null
}

/** Passos que uma frase ocupa: todo compasso tem de somar dezesseis. */
export function passosDaFrase(frase: Frase) {
  return frase.reduce((soma, [, passos]) => soma + passos, 0)
}

/** A forma de uma faixa: cada seção e quantos compassos ela tem. */
export type Forma<S extends string> = readonly (readonly [S, number])[]

export function compassosDaForma<S extends string>(forma: Forma<S>) {
  return forma.reduce((soma, [, compassos]) => soma + compassos, 0)
}

export type PontoDaForma<S extends string> = {
  secao: S
  /** Compasso dentro da seção, de zero em diante. */
  compasso: number
  /** Quantos compassos a seção tem. */
  tamanho: number
  /** Quantas vezes essa seção já apareceu antes, na forma. */
  vez: number
  /** Passo dentro do compasso, de 0 a 15. */
  noCompasso: number
}

/**
 * Onde um passo cai na forma.
 *
 * Aceita qualquer número — a faixa dá a volta — e trata lixo como o primeiro
 * passo: o agendador conta passos para sempre, e uma conta errada não pode
 * virar silêncio nem exceção.
 */
export function pontoDaForma<S extends string>(forma: Forma<S>, passoBruto: number): PontoDaForma<S> {
  const total = compassosDaForma(forma) * PASSOS_DO_COMPASSO
  const inteiro = Number.isFinite(passoBruto) ? Math.floor(passoBruto) : 0
  const passo = ((inteiro % total) + total) % total
  let compasso = Math.floor(passo / PASSOS_DO_COMPASSO)
  const vezes = new Map<S, number>()
  for (const [secao, tamanho] of forma) {
    if (compasso < tamanho) {
      return { secao, compasso, tamanho, vez: vezes.get(secao) ?? 0, noCompasso: passo % PASSOS_DO_COMPASSO }
    }
    compasso -= tamanho
    vezes.set(secao, (vezes.get(secao) ?? 0) + 1)
  }
  // Inalcançável: o passo foi reduzido ao tamanho da forma.
  return { secao: forma[0][0], compasso: 0, tamanho: forma[0][1], vez: 0, noCompasso: 0 }
}

/** Um passo em que ninguém toca. */
export function silencio(): EventosDaBanda {
  return {
    bumbo: 0,
    caixa: 0,
    chimbal: 0,
    chimbalAberto: false,
    prato: false,
    baixo: null,
    guitarra: null,
    solo: null,
    dedilhado: null,
    flauta: null,
    teclado: null,
  }
}

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

/** Power chord: raiz, quinta e oitava. */
const POWER_CHORD = [0, 7, 12] as const

export class Banda {
  private readonly saida: GainNode
  private readonly bateria: GainNode
  private readonly baixo: GainNode
  /**
   * Os barramentos com amplificador simulado nascem na primeira nota que os
   * pede. Um amplificador parado ainda processa silêncio a cada bloco, e uma
   * faixa que não usa a guitarra pesada não tem por que pagar por ela.
   */
  private base: GainNode | null = null
  private solo: GainNode | null = null
  private crunch: GainNode | null = null
  private violao: GainNode | null = null
  private sopro: GainNode | null = null
  private teclas: GainNode | null = null
  private relogio: ReturnType<typeof setInterval> | null = null
  private proximo = 0
  private passo = 0
  private tocando = false
  private ligada = true
  private readonly duracaoDoPasso: number
  private readonly volume: number

  constructor(
    private readonly ctx: HostDaTrilha,
    destino: AudioNode,
    private readonly ruido: AudioBuffer,
    private readonly partitura: Partitura,
  ) {
    const agora = ctx.currentTime
    this.duracaoDoPasso = duracaoDoPasso(partitura.bpm)
    this.volume = partitura.volume ?? VOLUME_DA_TRILHA
    this.saida = ctx.createGain()
    this.saida.gain.setValueAtTime(0, agora)
    this.saida.connect(destino)

    this.bateria = this.barramento(0.9)
    this.baixo = this.barramento(0.5)
  }

  private barramento(volume: number) {
    const ganho = this.ctx.createGain()
    ganho.gain.setValueAtTime(volume, this.ctx.currentTime)
    ganho.connect(this.saida)
    return ganho
  }

  /**
   * Guitarra base: saturação forte, e depois a caixa de som — um corte de
   * grave que tira a lama e um corte de agudo que tira o chiado digital.
   */
  private barramentoBase() {
    if (this.base) return this.base
    const agora = this.ctx.currentTime
    this.base = this.ctx.createGain()
    this.base.gain.setValueAtTime(0.34, agora)
    const saturacao = this.ctx.createWaveShaper()
    saturacao.curve = curvaDeSaturacao(9)
    // Duas vezes basta: com quatro o chiado de dobra some de vez, mas a trilha
    // passava a custar um sexto de um núcleo de computador de mesa — num
    // celular, a metade do tempo do processador de áudio, disputando com o motor.
    saturacao.oversample = '2x'
    const semLama = this.ctx.createBiquadFilter()
    semLama.type = 'highpass'
    semLama.frequency.setValueAtTime(95, agora)
    const caixaDeSom = this.ctx.createBiquadFilter()
    caixaDeSom.type = 'lowpass'
    caixaDeSom.frequency.setValueAtTime(3_400, agora)
    caixaDeSom.Q.setValueAtTime(0.9, agora)
    this.base.connect(saturacao).connect(semLama).connect(caixaDeSom).connect(this.saida)
    return this.base
  }

  /**
   * Guitarra solo: menos saturada, mais brilhante, com um eco curto que a
   * espalha — é o que a faz soar por cima da base em vez de brigar com ela.
   */
  private barramentoSolo() {
    if (this.solo) return this.solo
    const agora = this.ctx.currentTime
    this.solo = this.ctx.createGain()
    this.solo.gain.setValueAtTime(0.2, agora)
    const saturacaoDoSolo = this.ctx.createWaveShaper()
    saturacaoDoSolo.curve = curvaDeSaturacao(4)
    const brilho = this.ctx.createBiquadFilter()
    brilho.type = 'lowpass'
    brilho.frequency.setValueAtTime(5_200, agora)
    const eco = this.ctx.createDelay(1)
    eco.delayTime.setValueAtTime(this.duracaoDoPasso * 3, agora)
    const retorno = this.ctx.createGain()
    retorno.gain.setValueAtTime(0.28, agora)
    this.solo.connect(saturacaoDoSolo).connect(brilho)
    brilho.connect(this.saida)
    brilho.connect(eco).connect(retorno).connect(eco)
    retorno.connect(this.saida)
    return this.solo
  }

  /**
   * Guitarra de saturação leve, criada na primeira nota que pede.
   *
   * É a guitarra de rock'n'roll de amplificador aberto: o acorde inteiro ainda
   * se ouve, nota por nota, em vez de virar a parede de som da base pesada.
   */
  private barramentoCrunch() {
    if (this.crunch) return this.crunch
    const agora = this.ctx.currentTime
    this.crunch = this.ctx.createGain()
    this.crunch.gain.setValueAtTime(0.3, agora)
    const saturacao = this.ctx.createWaveShaper()
    saturacao.curve = curvaDeSaturacao(3.2)
    saturacao.oversample = '2x'
    const semLama = this.ctx.createBiquadFilter()
    semLama.type = 'highpass'
    semLama.frequency.setValueAtTime(110, agora)
    const caixaDeSom = this.ctx.createBiquadFilter()
    caixaDeSom.type = 'lowpass'
    caixaDeSom.frequency.setValueAtTime(3_900, agora)
    caixaDeSom.Q.setValueAtTime(0.8, agora)
    this.crunch.connect(saturacao).connect(semLama).connect(caixaDeSom).connect(this.saida)
    return this.crunch
  }

  /**
   * Violão: sem saturação, com um eco curto que faz de sala.
   *
   * Alto para um violão, e de propósito: a faixa toca sob um V10 em cruzeiro.
   * Medida numa corrida, a abertura acústica a um terço disto ficava catorze
   * decibéis abaixo do motor — meio minuto de música que ninguém ouvia.
   */
  private barramentoViolao() {
    if (this.violao) return this.violao
    const agora = this.ctx.currentTime
    this.violao = this.ctx.createGain()
    this.violao.gain.setValueAtTime(1.1, agora)
    const sala = this.ctx.createDelay(1)
    sala.delayTime.setValueAtTime(0.09, agora)
    const retorno = this.ctx.createGain()
    retorno.gain.setValueAtTime(0.22, agora)
    this.violao.connect(this.saida)
    this.violao.connect(sala).connect(retorno).connect(sala)
    retorno.connect(this.saida)
    return this.violao
  }

  private barramentoSopro() {
    if (this.sopro) return this.sopro
    const agora = this.ctx.currentTime
    this.sopro = this.ctx.createGain()
    // Como o violão: a flauta precisa atravessar o motor.
    this.sopro.gain.setValueAtTime(0.9, agora)
    const eco = this.ctx.createDelay(1)
    eco.delayTime.setValueAtTime(this.duracaoDoPasso * 6, agora)
    const retorno = this.ctx.createGain()
    retorno.gain.setValueAtTime(0.25, agora)
    this.sopro.connect(this.saida)
    this.sopro.connect(eco).connect(retorno).connect(eco)
    retorno.connect(this.saida)
    return this.sopro
  }

  private barramentoTeclado() {
    if (this.teclas) return this.teclas
    const agora = this.ctx.currentTime
    this.teclas = this.ctx.createGain()
    this.teclas.gain.setValueAtTime(0.28, agora)
    const escuro = this.ctx.createBiquadFilter()
    escuro.type = 'lowpass'
    escuro.frequency.setValueAtTime(1_800, agora)
    this.teclas.connect(escuro).connect(this.saida)
    return this.teclas
  }

  /** Começa do primeiro compasso, com o prato. */
  start() {
    if (this.tocando) return
    this.tocando = true
    this.passo = 0
    this.proximo = this.ctx.currentTime + 0.05
    this.saida.gain.cancelScheduledValues(this.ctx.currentTime)
    this.saida.gain.setTargetAtTime(this.ligada ? this.volume : 0, this.ctx.currentTime, 0.05)
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
    if (this.tocando) this.saida.gain.setTargetAtTime(ligada ? this.volume : 0, this.ctx.currentTime, 0.08)
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
      this.tocarPasso(this.partitura.eventos(this.passo), this.proximo)
      this.proximo += this.duracaoDoPasso
      this.passo = (this.passo + 1) % this.partitura.passos
    }
  }

  private tocarPasso(e: EventosDaBanda, t: number) {
    const passo = this.duracaoDoPasso
    if (e.prato) this.prato(t)
    if (e.bumbo > 0) this.bumbo(t, e.bumbo)
    if (e.caixa > 0) this.caixa(t, e.caixa)
    if (e.chimbal > 0) this.chimbal(t, e.chimbal, e.chimbalAberto)
    if (e.baixo) this.nota(this.baixo, 'sawtooth', e.baixo.nota, t, e.baixo.passos * passo * 0.9, 0.55, 520)
    if (e.guitarra) this.acorde(e.guitarra, t)
    if (e.solo) this.voz(e.solo.nota, t, e.solo.passos * passo)
    if (e.dedilhado) this.corda(e.dedilhado.nota, t, e.dedilhado.passos * passo)
    if (e.flauta) this.flauta(e.flauta.nota, t, e.flauta.passos * passo)
    if (e.teclado) this.tecla(e.teclado.notas, t, e.teclado.passos * passo)
  }

  /** Um ruído filtrado com envelope curto: a matéria de caixa, chimbal e prato. */
  private ruidoFiltrado(
    t: number,
    tipo: BiquadFilterType,
    frequencia: number,
    volume: number,
    duracao: number,
    q = 0.7,
    destino: AudioNode = this.bateria,
  ) {
    const fonte = this.ctx.createBufferSource()
    fonte.buffer = this.ruido
    const filtro = this.ctx.createBiquadFilter()
    filtro.type = tipo
    filtro.frequency.setValueAtTime(frequencia, t)
    filtro.Q.setValueAtTime(q, t)
    const ganho = this.ctx.createGain()
    ganho.gain.setValueAtTime(volume, t)
    ganho.gain.exponentialRampToValueAtTime(0.001, t + duracao)
    fonte.connect(filtro).connect(ganho).connect(destino)
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
   * Acorde de guitarra: cada nota com duas serras levemente desafinadas,
   * somadas antes da saturação. É a soma saturada que produz a aspereza do
   * acorde de rock — saturadas uma a uma, soariam como três guitarras limpas
   * tocando juntas.
   */
  private acorde(g: NonNullable<EventosDaBanda['guitarra']>, t: number) {
    const { raiz, passos, abafada } = g
    const intervalos = g.intervalos ?? POWER_CHORD
    const duracao = abafada ? this.duracaoDoPasso * 0.85 : passos * this.duracaoDoPasso * 0.95
    // A palma abafando as cordas escurece o som antes do amplificador.
    const palma = this.ctx.createBiquadFilter()
    palma.type = 'lowpass'
    palma.frequency.setValueAtTime(abafada ? 900 : 3_200, t)
    const ganho = this.ctx.createGain()
    // Um acorde cheio tem mais cordas: cada uma entra um pouco mais baixa, para
    // o total bater no amplificador com a mesma força de um power chord.
    const cordas = intervalos.length / POWER_CHORD.length
    ganho.gain.setValueAtTime(0, t)
    ganho.gain.linearRampToValueAtTime((abafada ? 0.8 : 0.62) / cordas, t + 0.004)
    ganho.gain.setTargetAtTime((abafada ? 0.001 : 0.42) / cordas, t + 0.01, abafada ? duracao / 3 : duracao)
    ganho.gain.setTargetAtTime(0.0001, t + duracao, 0.03)
    palma.connect(ganho).connect(g.crunch ? this.barramentoCrunch() : this.barramentoBase())
    // A nota abafada da guitarra leve é um estalo escuro de um oitavo de
    // segundo: o par de serras desafinadas, que dá corpo ao acorde aberto, ali
    // só dobraria o custo sem se ouvir. E ela já está calada oitenta
    // milésimos depois do fim — o acorde aberto ainda soa, e leva a cauda
    // inteira.
    const vozes = g.crunch && abafada ? [0] : [-7, 7]
    const fim = t + duracao + (abafada ? 0.08 : 0.15)
    for (const [i, intervalo] of intervalos.entries()) {
      // Numa palhetada para baixo, as cordas soam uma depois da outra.
      const corda = t + (g.crunch && !abafada ? i * 0.006 : 0)
      for (const desafinacao of vozes) {
        const osc = this.ctx.createOscillator()
        osc.type = 'sawtooth'
        osc.frequency.setValueAtTime(frequenciaDaNota(raiz + intervalo), corda)
        osc.detune.setValueAtTime(desafinacao, corda)
        osc.connect(palma)
        osc.start(corda)
        osc.stop(fim)
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
    ganho.connect(this.barramentoSolo())
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

  /**
   * Uma corda de violão dedilhada.
   *
   * Triângulo e serra juntos, com o filtro fechando mais depressa que o
   * volume: a unha acende os harmônicos, e eles se apagam antes da nota — é
   * isso que distingue corda de teclado. Duas vozes levemente desafinadas
   * fazem o violão de doze cordas.
   */
  private corda(nota: number, t: number, duracao: number) {
    const soa = Math.max(duracao, 0.5) * 1.6
    const filtro = this.ctx.createBiquadFilter()
    filtro.type = 'lowpass'
    filtro.frequency.setValueAtTime(4_200, t)
    filtro.frequency.exponentialRampToValueAtTime(700, t + Math.min(0.5, soa))
    const ganho = this.ctx.createGain()
    ganho.gain.setValueAtTime(0, t)
    ganho.gain.linearRampToValueAtTime(0.5, t + 0.003)
    ganho.gain.exponentialRampToValueAtTime(0.001, t + soa)
    filtro.connect(ganho).connect(this.barramentoViolao())
    for (const [tipo, desafinacao, volume] of [['triangle', 0, 1], ['sawtooth', 9, 0.28], ['triangle', 1_200 - 6, 0.3]] as const) {
      const osc = this.ctx.createOscillator()
      osc.type = tipo
      osc.frequency.setValueAtTime(frequenciaDaNota(nota), t)
      osc.detune.setValueAtTime(desafinacao, t)
      const mistura = this.ctx.createGain()
      mistura.gain.setValueAtTime(volume, t)
      osc.connect(mistura).connect(filtro)
      osc.start(t)
      osc.stop(t + soa + 0.05)
    }
  }

  /** A flauta: seno com um pouco de triângulo, o ar do sopro e vibrato tardio. */
  private flauta(nota: number, t: number, duracao: number) {
    const destino = this.barramentoSopro()
    const ganho = this.ctx.createGain()
    ganho.gain.setValueAtTime(0, t)
    ganho.gain.linearRampToValueAtTime(0.42, t + 0.06)
    ganho.gain.setTargetAtTime(0.34, t + 0.08, 0.2)
    ganho.gain.setTargetAtTime(0.0001, t + duracao * 0.9, 0.05)
    ganho.connect(destino)
    const vibrato = this.ctx.createOscillator()
    vibrato.frequency.setValueAtTime(5, t)
    const profundidade = this.ctx.createGain()
    profundidade.gain.setValueAtTime(0, t)
    profundidade.gain.linearRampToValueAtTime(duracao > 0.5 ? 14 : 0, t + Math.min(0.5, duracao))
    vibrato.connect(profundidade)
    for (const [tipo, volume] of [['sine', 1], ['triangle', 0.25]] as const) {
      const osc = this.ctx.createOscillator()
      osc.type = tipo
      osc.frequency.setValueAtTime(frequenciaDaNota(nota), t)
      profundidade.connect(osc.detune)
      const mistura = this.ctx.createGain()
      mistura.gain.setValueAtTime(volume, t)
      osc.connect(mistura).connect(ganho)
      osc.start(t)
      osc.stop(t + duracao + 0.2)
    }
    vibrato.start(t)
    vibrato.stop(t + duracao + 0.2)
    // O ar: um chiado na altura da nota, bem baixo, só no começo do sopro.
    this.ruidoFiltrado(t, 'bandpass', frequenciaDaNota(nota) * 2, 0.05, Math.min(0.25, duracao), 2, destino)
  }

  /** Teclado de fundo: serras desafinadas, entrando devagar e saindo devagar. */
  private tecla(notas: readonly number[], t: number, duracao: number) {
    const ganho = this.ctx.createGain()
    ganho.gain.setValueAtTime(0, t)
    ganho.gain.linearRampToValueAtTime(0.3 / Math.max(1, notas.length / 3), t + Math.min(0.4, duracao / 2))
    ganho.gain.setTargetAtTime(0.0001, t + duracao * 0.95, 0.12)
    ganho.connect(this.barramentoTeclado())
    for (const nota of notas) {
      for (const desafinacao of [-10, 10]) {
        const osc = this.ctx.createOscillator()
        osc.type = 'sawtooth'
        osc.frequency.setValueAtTime(frequenciaDaNota(nota), t)
        osc.detune.setValueAtTime(desafinacao, t)
        osc.connect(ganho)
        osc.start(t)
        osc.stop(t + duracao + 0.6)
      }
    }
  }

  close() {
    this.stop(0.05)
  }
}
