/**
 * Som da corrida, gerado na hora.
 *
 * Nada de arquivo: a demonstração precisa funcionar sem depender de asset
 * nenhum, então motor, vento, rolamento e cascalho saem de osciladores e de
 * um buffer de ruído criado no próprio navegador.
 *
 * A parte que decide *o quê* tocar é pura e fica aqui em cima, separada da
 * parte que fala com o Web Audio. É o que permite testar a marcha, a rotação
 * e a mistura sem precisar de um navegador.
 *
 * A trilha de rock mora em `trilha.ts`, e toca pelo mesmo contexto e pelo
 * mesmo volume geral: desligar o som desliga a música junto.
 */
import { TrilhaRock } from './trilha'

/** O que a corrida informa ao som a cada quadro. */
export type AudioLevels = {
  /** Velocidade de 0 a 1, a mesma normalização de `feel`. */
  speed: number
  /** O quanto o boost está atuando, de 0 a 1. */
  boost: number
  /** O quanto o carro está fora do asfalto, de 0 a 1. */
  offRoad: number
  /** Falso antes da largada e depois da bandeirada: o motor fica em marcha lenta. */
  running: boolean
}

/**
 * Fim de cada marcha, em fração da velocidade máxima.
 *
 * O carro é de aceleração automática e o piloto não troca marcha — isto é
 * som, não regra. Mas é justamente a nota subindo, caindo e subindo de novo
 * que dá escala à velocidade: uma sirene que sobe uma vez só vira ruído de
 * fundo, e o ouvido deixa de medir o quanto o carro está rápido.
 */
export const GEAR_EDGES = [0.2, 0.36, 0.55, 0.78, 1.01]

/** Rotação em marcha lenta, para o motor nunca ficar mudo. */
export const IDLE_RPM = 0.18

/** Frequência do motor com o carro parado, em hertz. */
export const ENGINE_BASE_HZ = 58

/** Quanto a frequência sobe entre a marcha lenta e o corte. */
export const ENGINE_SWEEP_HZ = 210

/** Volume geral. Baixo de propósito: é um jogo de navegador, não um cinema. */
export const MASTER_GAIN = 0.34

export type EngineTone = {
  /** Índice da marcha, de 0 em diante. */
  gear: number
  /** Rotação dentro da marcha, de IDLE_RPM a 1. */
  rpm: number
  frequency: number
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

/** Marcha, rotação e frequência para uma dada fração da velocidade máxima. */
export function engineTone(speedRatio: number): EngineTone {
  const ratio = clamp(speedRatio, 0, 1)
  let gear = 0
  while (gear < GEAR_EDGES.length - 1 && ratio >= GEAR_EDGES[gear]) gear += 1

  const base = gear === 0 ? 0 : GEAR_EDGES[gear - 1]
  const topo = GEAR_EDGES[gear]
  const dentro = topo > base ? (ratio - base) / (topo - base) : 0
  const rpm = IDLE_RPM + (1 - IDLE_RPM) * clamp(dentro, 0, 1)

  return { gear, rpm, frequency: ENGINE_BASE_HZ + rpm * ENGINE_SWEEP_HZ }
}

export type AudioMix = {
  engine: number
  /** Ar batendo na carroceria: cresce com o quadrado da velocidade. */
  wind: number
  /** Pneu no asfalto. */
  roll: number
  /** Pneu na grama: mais áspero e mais alto que o asfalto. */
  gravel: number
  boost: number
  /** Corte do filtro do motor, em hertz. Abre com a rotação e com o boost. */
  cutoff: number
}

/** Volume de cada camada para um dado estado da corrida. */
export function mixFor(levels: AudioLevels, tone: EngineTone): AudioMix {
  const speed = clamp(levels.speed, 0, 1)
  const offRoad = clamp(levels.offRoad, 0, 1)
  const boost = clamp(levels.boost, 0, 1)

  return {
    engine: levels.running ? 0.42 + tone.rpm * 0.3 + boost * 0.2 : 0.22,
    // O arrasto do ar é quadrático, e é isso que faz a diferença entre 200 e
    // 250 km/h ser audível mesmo com a nota do motor parecida.
    wind: levels.running ? speed * speed * 0.6 : 0,
    roll: levels.running ? speed * 0.26 * (1 - offRoad) : 0,
    gravel: levels.running ? offRoad * (0.2 + speed * 0.55) : 0,
    boost: boost * 0.42,
    cutoff: 320 + tone.rpm * 2_400 + boost * 900,
  }
}

// ---------------------------------------------------------------------------
// Ligação com o Web Audio
// ---------------------------------------------------------------------------

/** Só o que este módulo usa de um AudioContext, para o teste poder fingir. */
export type AudioHost = Pick<
  AudioContext,
  | 'createOscillator'
  | 'createGain'
  | 'createBiquadFilter'
  | 'createBufferSource'
  | 'createBuffer'
  | 'createWaveShaper'
  | 'createDelay'
  | 'currentTime'
  | 'destination'
  | 'sampleRate'
  | 'state'
  | 'resume'
  | 'close'
>

/** Constante de tempo das rampas: curta para responder, longa para não chiar. */
const RAMPA = 0.06

export class RaceAudio {
  private readonly master: GainNode
  private readonly engineGain: GainNode
  private readonly engineFilter: BiquadFilterNode
  private readonly osciladores: OscillatorNode[] = []
  private readonly ruido: AudioBufferSourceNode
  private readonly windGain: GainNode
  private readonly rollGain: GainNode
  private readonly gravelGain: GainNode
  private readonly boostGain: GainNode
  private readonly trilha: TrilhaRock
  private silenciado = false
  private encerrado = false
  /** Marcha do quadro anterior, para marcar a troca. */
  private marcha = 0

  constructor(private readonly ctx: AudioHost) {
    const agora = ctx.currentTime

    this.master = ctx.createGain()
    this.master.gain.setValueAtTime(MASTER_GAIN, agora)
    this.master.connect(ctx.destination)

    // Motor: uma serra na fundamental e outra uma oitava abaixo, levemente
    // desafinadas. Duas vozes bastam para soar como motor em vez de apito.
    this.engineFilter = ctx.createBiquadFilter()
    this.engineFilter.type = 'lowpass'
    this.engineFilter.Q.setValueAtTime(3.2, agora)
    this.engineGain = ctx.createGain()
    this.engineGain.gain.setValueAtTime(0, agora)
    this.engineFilter.connect(this.engineGain).connect(this.master)

    for (const [tipo, desafinacao, ganho] of [
      ['sawtooth', 0, 1],
      ['sawtooth', -1_200, 0.7],
      ['square', 7, 0.25],
    ] as const) {
      const osc = ctx.createOscillator()
      osc.type = tipo
      osc.detune.setValueAtTime(desafinacao, agora)
      const voz = ctx.createGain()
      voz.gain.setValueAtTime(ganho, agora)
      osc.connect(voz).connect(this.engineFilter)
      osc.start()
      this.osciladores.push(osc)
    }

    // Uma única fonte de ruído alimenta vento, rolamento e cascalho. Três
    // fontes soariam igual e custariam três vezes mais.
    this.ruido = ctx.createBufferSource()
    this.ruido.buffer = ruidoBranco(ctx)
    this.ruido.loop = true

    this.windGain = this.camadaDeRuido(ctx, 'bandpass', 1_100, 0.8)
    this.rollGain = this.camadaDeRuido(ctx, 'lowpass', 420, 1)
    this.gravelGain = this.camadaDeRuido(ctx, 'bandpass', 1_900, 1.6)
    this.boostGain = this.camadaDeRuido(ctx, 'highpass', 2_600, 0.7)
    this.ruido.start()

    // A trilha usa o mesmo ruído para a bateria: é o mesmo chiado que vira
    // vento, só que cortado em golpes.
    this.trilha = new TrilhaRock(ctx, this.master, this.ruido.buffer!)
  }

  private camadaDeRuido(ctx: AudioHost, tipo: BiquadFilterType, frequencia: number, q: number) {
    const agora = ctx.currentTime
    const filtro = ctx.createBiquadFilter()
    filtro.type = tipo
    filtro.frequency.setValueAtTime(frequencia, agora)
    filtro.Q.setValueAtTime(q, agora)
    const ganho = ctx.createGain()
    ganho.gain.setValueAtTime(0, agora)
    this.ruido.connect(filtro).connect(ganho).connect(this.master)
    return ganho
  }

  /** Atualiza as camadas a partir do estado da corrida. Chamado por quadro. */
  update(levels: AudioLevels) {
    if (this.encerrado) return
    const agora = this.ctx.currentTime
    const tone = engineTone(levels.speed)
    const mix = mixFor(levels, tone)

    // A troca de marcha corta o som por um instante, como uma embreagem. É o
    // detalhe que faz o ouvido perceber que a escala recomeçou.
    const trocou = tone.gear !== this.marcha
    this.marcha = tone.gear

    this.osciladores[0].frequency.setTargetAtTime(tone.frequency, agora, RAMPA * 0.5)
    this.osciladores[1].frequency.setTargetAtTime(tone.frequency, agora, RAMPA * 0.5)
    this.osciladores[2].frequency.setTargetAtTime(tone.frequency * 2, agora, RAMPA * 0.5)
    this.engineFilter.frequency.setTargetAtTime(mix.cutoff, agora, RAMPA)

    this.engineGain.gain.setTargetAtTime(trocou ? mix.engine * 0.35 : mix.engine, agora, trocou ? 0.01 : RAMPA)
    this.windGain.gain.setTargetAtTime(mix.wind, agora, RAMPA)
    this.rollGain.gain.setTargetAtTime(mix.roll, agora, RAMPA)
    this.gravelGain.gain.setTargetAtTime(mix.gravel, agora, RAMPA)
    this.boostGain.gain.setTargetAtTime(mix.boost, agora, RAMPA)
  }

  /** Baque do impacto: um estouro grave que decai rápido. */
  impact(intensidade = 1) {
    if (this.encerrado) return
    const agora = this.ctx.currentTime
    const forca = clamp(intensidade, 0, 1)

    const osc = this.ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(190, agora)
    osc.frequency.exponentialRampToValueAtTime(46, agora + 0.26)
    const ganho = this.ctx.createGain()
    ganho.gain.setValueAtTime(0.5 * forca, agora)
    ganho.gain.exponentialRampToValueAtTime(0.001, agora + 0.3)
    osc.connect(ganho).connect(this.master)
    osc.start(agora)
    osc.stop(agora + 0.32)
  }

  /** Bipe das luzes da largada. Passa pelo mesmo contexto de todo o resto. */
  beep(frequencia: number, duracao = 0.12) {
    if (this.encerrado) return
    const agora = this.ctx.currentTime
    const osc = this.ctx.createOscillator()
    osc.type = 'square'
    osc.frequency.setValueAtTime(frequencia, agora)
    const ganho = this.ctx.createGain()
    ganho.gain.setValueAtTime(0.16, agora)
    ganho.gain.exponentialRampToValueAtTime(0.001, agora + duracao)
    osc.connect(ganho).connect(this.master)
    osc.start(agora)
    osc.stop(agora + duracao + 0.02)
  }

  /** Começa a trilha do primeiro compasso: é o "VAI!" da largada. */
  startMusic() {
    if (!this.encerrado) this.trilha.start()
  }

  /** A trilha some aos poucos, na bandeirada. */
  stopMusic() {
    if (!this.encerrado) this.trilha.stop()
  }

  /** Liga ou desliga só a música, deixando motor e efeitos como estão. */
  setMusicEnabled(ligada: boolean) {
    if (!this.encerrado) this.trilha.setEnabled(ligada)
  }

  get muted() {
    return this.silenciado
  }

  setMuted(silenciado: boolean) {
    if (this.encerrado) return
    this.silenciado = silenciado
    this.master.gain.setTargetAtTime(silenciado ? 0 : MASTER_GAIN, this.ctx.currentTime, 0.05)
  }

  /** O navegador começa suspenso até um gesto do usuário. */
  resume() {
    if (!this.encerrado && this.ctx.state === 'suspended') void this.ctx.resume()
  }

  close() {
    if (this.encerrado) return
    this.trilha.close()
    this.encerrado = true
    for (const osc of this.osciladores) {
      try {
        osc.stop()
      } catch {
        // Já parado: não há o que fazer.
      }
    }
    try {
      this.ruido.stop()
    } catch {
      // Idem.
    }
    void this.ctx.close()
  }
}

/** Dois segundos de ruído branco em laço: base do vento e do cascalho. */
function ruidoBranco(ctx: AudioHost) {
  const amostras = Math.floor(ctx.sampleRate * 2)
  const buffer = ctx.createBuffer(1, amostras, ctx.sampleRate)
  const canal = buffer.getChannelData(0)
  for (let i = 0; i < amostras; i += 1) canal[i] = Math.random() * 2 - 1
  return buffer
}
