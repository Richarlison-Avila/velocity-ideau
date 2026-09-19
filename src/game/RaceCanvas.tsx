import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { countdownAt, DEFAULT_COUNTDOWN_MS, LIGHT_COUNT, lateBy } from './countdown'
import {
  gapBetween,
  GhostTracker,
  offScreenNotice,
  positionNotice,
  rivalSide,
  TELEMETRY_INTERVAL_MS,
  type GhostSnapshot,
} from './ghost'
import { RaceAudio } from './audio'
import { createFeel, registerImpact, updateFeel } from './feel'
import {
  createSceneryItem,
  createTrackLayout,
  firstSceneryIndex,
  lastSceneryIndex,
  SCENERY_SPACING,
  type Flora,
} from './layout'
import { DIFFICULTY_LABELS, type Difficulty } from './rules'
import { createRaceState, MAX_STEP_SECONDS, stepRace, type RaceInput } from './simulation'
import { EmissionRate, ParticleField, TRAIL_SETBACK, WHEEL_OFFSET, type Particle } from './particles'
import {
  CAMERA_DEPTH,
  CAR_SPRITE_REFERENCE_WIDTH,
  CAR_VIEW_DISTANCE,
  CURVE_BEND_SCALE,
  formatTime,
  isTallMarker,
  lateralOffset,
  roadProjection,
  type ObstacleKind,
  HORIZON_RATIO,
  ROADSIDE_LATERAL,
  ROADSIDE_SPACING,
  SLOPE_RISE_SCALE,
  TRACK_LENGTH,
  VIEW_DISTANCE,
} from './track'

type RacePhase = 'countdown' | 'racing' | 'finished'

export type RaceResult = {
  time: number
  topSpeed: number
  collisions: number
  /** Atraso, em segundos, com que este dispositivo entrou na corrida. */
  lateStart: number
}

type RaceCanvasProps = {
  pilotName: string
  /** Instante oficial da largada, no relógio do servidor. */
  startAt: number
  /** Duração total da sequência de luzes enviada pelo servidor. */
  countdownMs?: number
  /**
   * Semente oficial do traçado. Vem do servidor no duelo e é sorteada
   * localmente no treino: a curva e o cenário saem inteiramente dela.
   */
  trackSeed: number
  /**
   * Dificuldade oficial da corrida. Vem do servidor no duelo e é escolhida no
   * menu no treino: toda a física sai dela.
   */
  difficulty: Difficulty
  /** Relógio sincronizado. No modo treino é o relógio local. */
  now?: () => number
  mode?: 'solo' | 'online'
  /** Aviso de conexão exibido sobre a pista sem interromper a corrida. */
  connectionNotice?: string | null
  /** Posições recentes do adversário, já tratadas contra atraso de rede. */
  ghost?: GhostTracker | null
  rivalName?: string
  /** Falso enquanto o rival está sem sinal. */
  rivalConnected?: boolean
  /** Chamado a cada medição para ser enviada ao servidor. */
  onTelemetry?: (snapshot: GhostSnapshot) => void
  /** Desistir da prova em andamento, entregando a vitória ao rival. */
  onAbandon?: () => void
  onFinish: (result: RaceResult) => void
}

/** O que o HUD mostra sobre o adversário. */
type RivalHud = {
  position: 'P1' | 'P2'
  headline: string
  offScreen: string | null
  stale: boolean
  finished: boolean
  /** Com o fantasma à vista, o painel encolhe para não tapar a pista. */
  onScreen: boolean
}

type Telemetry = {
  progress: number
  speed: number
  boost: number
  elapsed: number
  offRoad: boolean
  penalty: number
  boosting: boolean
  boostLocked: boolean
  /** Aderência de 0 a 1. Abaixo de 1, o piloto está maltratando o volante. */
  grip: number
}

const initialTelemetry: Telemetry = {
  progress: 0,
  speed: 0,
  boost: 100,
  elapsed: 0,
  offRoad: false,
  penalty: 0,
  boosting: false,
  boostLocked: false,
  grip: 1,
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  ctx.beginPath()
  ctx.roundRect(x, y, width, height, radius)
}

type CarPalette = {
  tyres: string
  /** Aro, para a roda não ser um retângulo preto chapado. */
  rim: string
  body: string
  /** Lado na sombra da carroceria, que é o que dá volume. */
  bodyDark: string
  /** Aresta iluminada por cima. */
  bodyLight: string
  stripe: string
  glass: string
  wings: string
  wingEdge: string
  /** Luz traseira, acesa no centro da asa. */
  light: string
  shadow: string
  alpha: number
}

/** Cores do carro do jogador. */
const PLAYER_PALETTE: CarPalette = {
  tyres: '#0b0d11',
  rim: '#2c3138',
  body: '#ff4b2b',
  bodyDark: '#a8280f',
  bodyLight: '#ff8a5c',
  stripe: '#ffb000',
  glass: '#c7f9ff',
  wings: '#151820',
  wingEdge: '#2b3038',
  light: '#ff2d2d',
  shadow: 'rgba(0,0,0,.42)',
  alpha: 1,
}

/** O fantasma usa azul e transparência para nunca ser confundido com o próprio carro. */
const GHOST_PALETTE: CarPalette = {
  tyres: '#16303a',
  rim: '#24444f',
  body: '#43e7ff',
  bodyDark: '#1d8ba3',
  bodyLight: '#a6f4ff',
  stripe: '#e8fbff',
  glass: '#0d2a33',
  wings: '#1d4854',
  wingEdge: '#2c5f6d',
  light: '#8ff0ff',
  shadow: 'rgba(67,231,255,.14)',
  alpha: 0.46,
}

/**
 * Deformações de apresentação do carro.
 *
 * Tudo aqui sai de `feel.ts`, que por sua vez só lê a simulação. Nada disso
 * volta para a corrida: não desloca a hitbox, não muda a posição competitiva
 * e não atrasa o comando.
 */
type CarPose = {
  /** Inclinação da carroceria, em radianos. */
  tilt: number
  /** Compressão vertical: negativo estica, positivo achata. */
  squash: number
  /** Esterço visual das rodas dianteiras, de -1 a 1. */
  steer: number
  /** Brilho do escapamento durante o boost, de 0 a 1. */
  boost: number
  /** Trepidação fora do asfalto, em pixels da escala base. */
  jitter: number
}

const POSE_NEUTRA: CarPose = { tilt: 0, squash: 0, steer: 0, boost: 0, jitter: 0 }

/** Preferência de som, guardada entre corridas e entre recargas da página. */
const SOM_KEY = 'ghost-racer-mudo'

function lerPreferencia() {
  try {
    return sessionStorage.getItem(SOM_KEY) === '1'
  } catch {
    // Navegação privada pode recusar o armazenamento; o som segue ligado.
    return false
  }
}

function guardarPreferencia(mudo: boolean) {
  try {
    sessionStorage.setItem(SOM_KEY, mudo ? '1' : '0')
  } catch {
    // Sem armazenamento só se perde a lembrança entre recargas.
  }
}

let somDesligado = lerPreferencia()

/**
 * Lados da pista, em constante de módulo.
 *
 * Parece exagero, mas este vetor seria recriado quase cem vezes por quadro se
 * ficasse dentro do laço do cenário.
 */
const LADOS: Array<-1 | 1> = [-1, 1]

/**
 * Paletas prontas do cenário, por tipo de vegetação.
 *
 * Montar a cor como texto a cada objeto alocaria centenas de strings por
 * quadro. O traçado sorteia um índice; aqui ele só vira uma cor já existente.
 * O ambiente da corrida escolhe o conjunto — numa travessia seca não há mato
 * verde na beira da pista.
 */
const VEGETACAO: Record<Flora, { copas: string[]; luz: string[]; troncos: string[]; arbustos: string[]; capins: string[] }> = {
  verde: {
    copas: ['#1d4b2a', '#236030', '#2a6d38', '#1a4325', '#2f7a40', '#265c33'],
    luz: ['#2d6f3c', '#33863f', '#3c944c', '#296437', '#45a657', '#377f47'],
    troncos: ['#3b2d23', '#46362b', '#31261e'],
    arbustos: ['#255c33', '#2d6b3a', '#1f5130'],
    capins: ['#357c46', '#3d8a4f', '#2e7040'],
  },
  seca: {
    copas: ['#5a5227', '#6b6130', '#4e4723', '#746a35', '#5f562a', '#665d2e'],
    luz: ['#7c7239', '#8a7f42', '#6e6533', '#93874a', '#7f7540', '#877c44'],
    troncos: ['#4a3722', '#55412a', '#3d2d1c'],
    arbustos: ['#5d5228', '#6a5f2f', '#514724'],
    capins: ['#8a7b3c', '#97883f', '#7d7036'],
  },
}
const PLACAS = ['#d8dee2', '#e6b325', '#cf4436']
const CERCA = '#6d7b7f'

/**
 * Uma roda, com aro e banda de rodagem.
 *
 * As dianteiras giram no próprio eixo conforme o volante. É o único elemento
 * do carro que roda por conta própria, e por isso recebe o ângulo em vez de
 * herdar a inclinação da carroceria.
 */
function drawWheel(
  ctx: CanvasRenderingContext2D,
  palette: CarPalette,
  x: number,
  y: number,
  largura: number,
  altura: number,
  angulo: number,
) {
  ctx.save()
  ctx.translate(x, y)
  if (angulo !== 0) ctx.rotate(angulo)
  ctx.fillStyle = palette.tyres
  roundedRect(ctx, -largura / 2, -altura / 2, largura, altura, largura * 0.35)
  ctx.fill()
  // O aro aparece como uma faixa clara no meio da banda.
  ctx.fillStyle = palette.rim
  roundedRect(ctx, -largura * 0.28, -altura * 0.22, largura * 0.56, altura * 0.44, largura * 0.2)
  ctx.fill()
  ctx.restore()
}

/**
 * O carro, visto de trás e um pouco de cima.
 *
 * O eixo vertical do desenho é profundidade: o topo é o bico, a base é a asa
 * traseira, que é a parte mais próxima da câmera. É por isso que a ordem de
 * desenho vai de cima para baixo — asa dianteira, rodas da frente,
 * carroceria, cockpit, rodas de trás e por último a asa traseira.
 *
 * A meia-largura do desenho é `CAR_SPRITE_HALF_WIDTH`, e daí saem o limite de
 * saída de pista e o alinhamento dos efeitos. Mexer na silhueta sem mexer
 * naquela constante faria o jogo cobrar uma coisa e mostrar outra.
 */
function drawCar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  palette: CarPalette = PLAYER_PALETTE,
  pose: CarPose = POSE_NEUTRA,
) {
  ctx.save()
  ctx.globalAlpha = palette.alpha
  ctx.translate(x, y)

  // A sombra de contato fica no chão: não acompanha nem a inclinação nem a
  // compressão da carroceria, senão o carro pareceria flutuar.
  ctx.fillStyle = palette.shadow
  ctx.beginPath()
  ctx.ellipse(0, 20 * scale, 30 * scale, 8 * scale, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.translate(pose.jitter * scale, 0)
  if (pose.tilt !== 0) ctx.rotate(pose.tilt)
  ctx.scale(scale * (1 + pose.squash * 0.5), scale * (1 - pose.squash))

  const esterco = pose.steer * 0.34

  // Asa dianteira: mais estreita e mais longe, quase escondida pelo bico.
  ctx.fillStyle = palette.wings
  roundedRect(ctx, -24, -38, 48, 5, 1.5)
  ctx.fill()
  ctx.fillStyle = palette.wingEdge
  ctx.fillRect(-24, -39, 4, 8)
  ctx.fillRect(20, -39, 4, 8)

  // Rodas dianteiras: menores, porque estão mais longe, e esterçadas.
  drawWheel(ctx, palette, -25, -24, 10, 19, esterco)
  drawWheel(ctx, palette, 25, -24, 10, 19, esterco)

  // Assoalho, que aparece por baixo da carroceria e a assenta no chão.
  ctx.fillStyle = palette.wings
  ctx.beginPath()
  ctx.moveTo(-22, 18)
  ctx.lineTo(-16, -18)
  ctx.lineTo(16, -18)
  ctx.lineTo(22, 18)
  ctx.closePath()
  ctx.fill()

  // Carroceria: larga atrás, afinando até o bico.
  ctx.fillStyle = palette.body
  ctx.beginPath()
  ctx.moveTo(-19, 17)
  ctx.lineTo(-13, -19)
  ctx.quadraticCurveTo(0, -33, 13, -19)
  ctx.lineTo(19, 17)
  ctx.closePath()
  ctx.fill()

  // Lado na sombra e aresta iluminada: é o que tira a silhueta do chapado.
  ctx.fillStyle = palette.bodyDark
  ctx.beginPath()
  ctx.moveTo(6, -26)
  ctx.lineTo(13, -19)
  ctx.lineTo(19, 17)
  ctx.lineTo(9, 17)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = palette.bodyLight
  ctx.beginPath()
  ctx.moveTo(-6, -26)
  ctx.lineTo(-13, -19)
  ctx.lineTo(-16, 0)
  ctx.lineTo(-9, 0)
  ctx.closePath()
  ctx.fill()

  // Entradas de ar dos sidepods.
  ctx.fillStyle = palette.wings
  roundedRect(ctx, -18, -6, 6, 13, 2)
  ctx.fill()
  roundedRect(ctx, 12, -6, 6, 13, 2)
  ctx.fill()

  // Faixa central, do bico à tampa do motor. Estreita de propósito: larga
  // demais, ela come a cor do carro e some a silhueta.
  ctx.fillStyle = palette.stripe
  ctx.beginPath()
  ctx.moveTo(-2, -30)
  ctx.lineTo(2, -30)
  ctx.lineTo(3.5, 17)
  ctx.lineTo(-3.5, 17)
  ctx.closePath()
  ctx.fill()

  // Cockpit e halo.
  ctx.fillStyle = palette.glass
  ctx.beginPath()
  ctx.moveTo(-8, -11)
  ctx.lineTo(0, -20)
  ctx.lineTo(8, -11)
  ctx.lineTo(6, -2)
  ctx.lineTo(-6, -2)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = palette.wings
  ctx.lineWidth = 2.4
  ctx.beginPath()
  ctx.arc(0, -10, 8.5, Math.PI, 0)
  ctx.stroke()

  // Rodas traseiras: largas, e é delas que saem poeira e marcas de pneu.
  drawWheel(ctx, palette, -25, 6, 12, 25, 0)
  drawWheel(ctx, palette, 25, 6, 12, 25, 0)

  // O escapamento acende no boost, logo acima da asa.
  if (pose.boost > 0.01) {
    ctx.save()
    ctx.globalAlpha = palette.alpha * pose.boost
    ctx.fillStyle = palette.light
    ctx.beginPath()
    ctx.ellipse(0, 19, 7 + pose.boost * 4, 3 + pose.boost * 2, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  // Asa traseira: é o elemento mais próximo da câmera e fecha o desenho. O
  // plano recebe um tom claro em cima: em preto sobre asfalto escuro, ela
  // simplesmente sumia.
  ctx.fillStyle = palette.wings
  ctx.fillRect(-8, 12, 16, 8)
  ctx.fillStyle = palette.wingEdge
  roundedRect(ctx, -30, 16, 60, 6, 2)
  ctx.fill()
  ctx.fillStyle = palette.stripe
  ctx.fillRect(-30, 16, 60, 1.6)
  ctx.fillStyle = palette.wings
  roundedRect(ctx, -30, 21.5, 60, 4, 1.5)
  ctx.fill()

  // Laterais da asa, na cor do carro: é o que identifica o piloto de longe.
  ctx.fillStyle = palette.body
  roundedRect(ctx, -30, 11, 5, 15, 1.5)
  ctx.fill()
  roundedRect(ctx, 25, 11, 5, 15, 1.5)
  ctx.fill()

  ctx.fillStyle = palette.light
  ctx.fillRect(-3, 22.5, 6, 3)

  ctx.restore()
}

function RaceCanvas({
  pilotName,
  startAt,
  countdownMs = DEFAULT_COUNTDOWN_MS,
  trackSeed,
  difficulty,
  now,
  mode = 'solo',
  connectionNotice = null,
  ghost = null,
  rivalName = 'RIVAL',
  rivalConnected = true,
  onTelemetry,
  onAbandon,
  onFinish,
}: RaceCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const inputRef = useRef<RaceInput>({ left: false, right: false, boost: false })
  const clockRef = useRef(now ?? Date.now)
  const finishRef = useRef(onFinish)
  const raceRef = useRef(createRaceState(difficulty))
  const startedRef = useRef(false)
  const doneRef = useRef(false)
  const ghostRef = useRef(ghost)
  const sendTelemetryRef = useRef(onTelemetry)
  const [telemetry, setTelemetry] = useState(initialTelemetry)
  const [rival, setRival] = useState<RivalHud | null>(null)
  const [phase, setPhase] = useState<RacePhase>('countdown')
  const [countdownLight, setCountdownLight] = useState(0)
  const [flash, setFlash] = useState<string | null>(null)
  const [lateStart, setLateStart] = useState(0)
  const audioRef = useRef<RaceAudio | null>(null)
  const [mudo, setMudo] = useState(somDesligado)

  clockRef.current = now ?? Date.now
  finishRef.current = onFinish
  ghostRef.current = ghost
  sendTelemetryRef.current = onTelemetry

  /**
   * Motor, vento e rolamento, criados na primeira vez que o som é pedido.
   *
   * O navegador só libera áudio depois de um gesto do usuário, e a primeira
   * luz da largada vem logo depois do clique que iniciou a corrida — então
   * é ali que o contexto nasce, já destravado.
   */
  const som = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.resume()
      return audioRef.current
    }
    const AudioContextClass = window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) return null
    try {
      const motor = new RaceAudio(new AudioContextClass())
      motor.setMuted(somDesligado)
      motor.resume()
      audioRef.current = motor
      return motor
    } catch {
      // Sem áudio o jogo segue igual: é reforço, não regra.
      return null
    }
  }, [])

  const beep = useCallback((frequency: number, duration = 0.12) => {
    som()?.beep(frequency, duration)
  }, [som])

  const alternarSom = useCallback(() => {
    const proximo = !somDesligado
    somDesligado = proximo
    guardarPreferencia(proximo)
    setMudo(proximo)
    audioRef.current?.setMuted(proximo)
  }, [])

  const setInput = (key: keyof RaceInput, active: boolean) => {
    inputRef.current[key] = active
  }

  /**
   * Controles de toque. O comando é registrado antes de capturar o ponteiro:
   * se a captura falhar no aparelho, o botão continua funcionando.
   */
  const holdControl = (key: keyof RaceInput) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
      setInput(key, true)
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // Sem captura o botão ainda responde ao soltar.
      }
    },
    onPointerUp: () => setInput(key, false),
    onPointerCancel: () => setInput(key, false),
    onLostPointerCapture: () => setInput(key, false),
  })

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (['ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault()
      if (event.code === 'ArrowLeft' || event.code === 'KeyA') setInput('left', true)
      if (event.code === 'ArrowRight' || event.code === 'KeyD') setInput('right', true)
      if (event.code === 'Space') setInput('boost', true)
    }
    const up = (event: KeyboardEvent) => {
      if (event.code === 'ArrowLeft' || event.code === 'KeyA') setInput('left', false)
      if (event.code === 'ArrowRight' || event.code === 'KeyD') setInput('right', false)
      if (event.code === 'Space') setInput('boost', false)
    }
    // Perder o foco solta todas as teclas, senão o carro segue virando sozinho.
    const release = () => {
      inputRef.current = { left: false, right: false, boost: false }
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', release)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', release)
    }
  }, [])

  useEffect(() => {
    // Quem abre a tela depois do instante combinado larga já em atraso.
    setLateStart(lateBy(clockRef.current(), startAt))
  }, [startAt])

  /**
   * Máquina de estados da largada.
   *
   * Roda em um temporizador, e não no ciclo de animação, porque o navegador
   * congela `requestAnimationFrame` em abas que não estão em primeiro plano.
   * Assim as luzes e o instante da largada continuam corretos nos dois
   * aparelhos mesmo que um deles esteja com a tela em segundo plano.
   */
  useEffect(() => {
    raceRef.current = createRaceState(difficulty)
    startedRef.current = false
    doneRef.current = false
    setPhase('countdown')
    setCountdownLight(0)
    setTelemetry(initialTelemetry)

    let timer = 0
    let lightsShown = -1

    const tick = () => {
      const state = countdownAt(clockRef.current(), startAt, countdownMs)

      if (state.phase !== 'go') {
        if (state.lights === lightsShown) return
        lightsShown = state.lights
        setCountdownLight(state.lights)
        if (state.lights > 0) beep(330 + state.lights * 24)
        return
      }

      if (!startedRef.current) {
        startedRef.current = true
        setCountdownLight(0)
        setPhase('racing')
        beep(740, 0.35)
      }
      if (timer) {
        window.clearInterval(timer)
        timer = 0
      }
    }

    tick()
    if (!startedRef.current) timer = window.setInterval(tick, 50)
    return () => {
      if (timer) window.clearInterval(timer)
    }
  }, [beep, countdownMs, difficulty, startAt])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const race = raceRef.current
    const lateAtStart = lateBy(clockRef.current(), startAt)

    // O traçado da prova, reconstruído a partir da semente oficial. O outro
    // piloto monta exatamente o mesmo a partir do mesmo número.
    const layout = createTrackLayout(trackSeed)
    // Céu, terreno e vegetação desta corrida, sorteados da mesma semente: os
    // dois pilotos correm no mesmo lugar, à mesma hora do dia.
    const ambiente = layout.ambient
    const flora = VEGETACAO[ambiente.flora]
    let width = 0
    let height = 0
    let previous = performance.now()
    let lastHudUpdate = 0
    let lastRivalHud = 0
    let animationFrame = 0
    const flashTimers: number[] = []

    // Intensidades contínuas para a apresentação, derivadas da corrida.
    const feel = createFeel()

    // Quem pede menos movimento no sistema recebe a cena sem tremor.
    const semTremor = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const forcaDoMovimento = semTremor ? 0.25 : 1
    const effects = new ParticleField()
    const dustRate = new EmissionRate(34)
    const boostRate = new EmissionRate(26)
    const skidRate = new EmissionRate(22)

    // Voltar do segundo plano não pode gerar um passo gigante de simulação.
    const resumeClock = () => {
      previous = performance.now()
    }
    document.addEventListener('visibilitychange', resumeClock)

    const resize = () => {
      const box = canvas.getBoundingClientRect()
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
      if (box.width === width && box.height === height) return
      width = box.width
      height = box.height
      canvas.width = Math.floor(width * pixelRatio)
      canvas.height = Math.floor(height * pixelRatio)
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    }
    resize()

    // A janela nem sempre muda de tamanho junto com a tela do jogo: em telas
    // divididas, ao girar o celular ou quando a barra do navegador some, só o
    // elemento muda. Observar o próprio canvas evita a pista fora de escala.
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    window.addEventListener('resize', resize)

    const announce = (message: string) => {
      setFlash(message)
      flashTimers.push(window.setTimeout(() => setFlash(null), 1_200))
    }

    /**
     * Deslocamentos de câmera do quadro. Não existe câmera 3D aqui: o efeito é
     * obtido movendo a projeção inteira. Como pista, marcadores, obstáculos,
     * partículas, fantasma, linha de chegada e carro passam todos por
     * `roadGeometry`, nada consegue descolar do resto — por construção.
     *
     * Tudo é multiplicado pela perspectiva, então o que está perto se move
     * mais do que o horizonte, como em um deslocamento real de câmera.
     */
    const camera = { lift: 0, shake: 0, roll: 0 }

    // A curva no ponto do carro é a mesma para todas as profundidades do
    // quadro, então é calculada uma vez em vez de a cada chamada.
    let curvaAqui = 0
    /** Rumo da pista sob o carro, usado pelo horizonte. */
    let rumoAqui = 0
    /** Altura e inclinação sob o carro, referência do relevo neste quadro. */
    let alturaAqui = 0
    let inclinacaoAqui = 0

    const roadGeometry = (distanceAhead: number) => {
      const { y, roadWidth, perspective } = roadProjection(distanceAhead, width, height)
      const bend = (layout.centerOffset(race.progress + distanceAhead) - curvaAqui) * width * CURVE_BEND_SCALE
      // O relevo entra pelo mesmo caminho da curva, só que na vertical: o
      // trecho mais alto que o ponto do carro sobe na tela, e a perspectiva
      // faz o efeito sumir no horizonte. Como tudo o que aparece na pista
      // passa por aqui, pista, cenário, obstáculos, partículas, fantasma,
      // chegada e carro sobem e descem juntos — por construção.
      const rise = (layout.elevation(race.progress + distanceAhead) - alturaAqui) * height * SLOPE_RISE_SCALE
      return {
        y: y + (camera.lift + camera.shake - rise) * perspective,
        roadWidth,
        perspective,
        center: width / 2 + bend * (1 - perspective * 0.25) + camera.roll * perspective,
      }
    }

    // O gradiente do céu só muda quando a tela muda de tamanho.
    let ceu: CanvasGradient | null = null
    let ceuAltura = -1
    const gradienteDoCeu = () => {
      if (ceu && ceuAltura === height) return ceu
      ceu = ctx.createLinearGradient(0, 0, 0, height * 0.5)
      ceu.addColorStop(0, ambiente.ceuTopo)
      ceu.addColorStop(0.58, ambiente.ceuMeio)
      ceu.addColorStop(1, ambiente.ceuBaixo)
      ceuAltura = height
      return ceu
    }

    // Névoa do horizonte. Out Run e Top Gear dissolvem o fundo na cor do céu:
    // é isso que separa uma projeção com profundidade de uma chapada, em que
    // o longe aparece nítido e minúsculo. O gradiente é montado uma vez por
    // tamanho de tela, não por quadro.
    let bruma: CanvasGradient | null = null
    let brumaAltura = -1
    const gradienteDaBruma = () => {
      if (bruma && brumaAltura === height) return bruma
      // Começa acima da linha do horizonte porque numa subida a pista passa
      // dela — e a faixa extra cai sobre o céu, que já é desta cor.
      bruma = ctx.createLinearGradient(0, height * (HORIZON_RATIO - 0.1), 0, height * 0.64)
      bruma.addColorStop(0, `rgba(${ambiente.nevoaRGB},.5)`)
      bruma.addColorStop(0.45, `rgba(${ambiente.nevoaRGB},.22)`)
      bruma.addColorStop(1, `rgba(${ambiente.nevoaRGB},0)`)
      brumaAltura = height
      return bruma
    }

    const drawBackdrop = () => {
      ctx.fillStyle = gradienteDoCeu()
      ctx.fillRect(0, 0, width, height * 0.44)

      // As montanhas correm para o lado contrário ao da curva. Elas estão
      // longe demais para acompanhar a pista, e é justamente esse
      // deslocamento em sentido oposto que faz a cena parecer virar.
      const desvio = -(layout.centerOffset(race.progress + VIEW_DISTANCE) - curvaAqui) * width * CURVE_BEND_SCALE * 0.42

      // E descem quando o carro sobe. A câmera acompanha a inclinação da
      // pista, então na subida ela aponta para cima e o que está longe cai na
      // tela — até ficar escondido atrás da própria lomba. É a regra clássica
      // do horizonte reagindo ao relevo.
      const subida = inclinacaoAqui * height * 0.75

      ctx.fillStyle = ambiente.serra
      ctx.beginPath()
      ctx.moveTo(0, height * 0.34 + subida)
      for (let x = 0; x <= width; x += 55) {
        const ridge = height * (0.3 + 0.035 * Math.sin((x + desvio) * 0.017 + race.progress * 0.0005)) + subida
        ctx.lineTo(x, ridge)
      }
      ctx.lineTo(width, height * 0.48)
      ctx.lineTo(0, height * 0.48)
      ctx.closePath()
      ctx.fill()

      ctx.fillStyle = ambiente.chao
      ctx.fillRect(0, height * 0.38, width, height)
    }

    /**
     * Distância da fatia, distribuída por escala de tela e não por distância.
     *
     * Com `1/z`, 84 fatias uniformes em distância dariam uma primeira faixa
     * ocupando 11% da altura da tela — e como a cor da listra é decidida por
     * fatia, a faixa junto à câmera saltaria de uma vez só, pulsando. Espaçar
     * por escala dá fatias de altura constante na tela.
     */
    const escalaMinima = CAMERA_DEPTH / (CAMERA_DEPTH + VIEW_DISTANCE)
    const distanciaDaFatia = (fracao: number) => {
      const escala = 1 - fracao * (1 - escalaMinima)
      return CAMERA_DEPTH * (1 / escala - 1)
    }

    /**
     * Quantas fatias a pista tem, e quais delas o recorte deixou visíveis.
     *
     * O vetor é reaproveitado entre quadros: ele é consultado pelo cenário,
     * pelos obstáculos e pelo fantasma para saber se aquela profundidade está
     * atrás de uma lomba.
     */
    const FATIAS = 84
    const fatiaVisivel = new Uint8Array(FATIAS + 1)

    /** Índice da fatia em que uma distância cai. */
    const fatiaDe = (distanceAhead: number) => {
      const escala = CAMERA_DEPTH / (CAMERA_DEPTH + Math.max(0, distanceAhead))
      const fracao = (1 - escala) / (1 - escalaMinima)
      return Math.min(FATIAS, Math.max(0, Math.round(fracao * FATIAS)))
    }

    /** Verdadeiro quando aquela profundidade está escondida atrás de uma lomba. */
    const atrasDaLomba = (distanceAhead: number) => fatiaVisivel[fatiaDe(distanceAhead)] === 0

    /** Faixas do tracejado central, em constante para o laço não alocar. */
    const FAIXAS = [-0.33, 0.33]

    const drawRoad = () => {
      fatiaVisivel.fill(0)
      fatiaVisivel[0] = 1

      // Do perto para o longe, guardando o ponto mais alto já desenhado. Uma
      // fatia que cairia abaixo dele está atrás de uma lomba e some. Sem esse
      // recorte a pista se desenha sobre si mesma na crista — e é ele que
      // permite ao relevo ter amplitude de verdade, em vez de ficar limitado
      // ao que a projeção aguenta sem dobrar.
      //
      // Como cada faixa ocupa a fatia entre a última desenhada e esta, e o
      // recorte garante que elas nunca se sobrepõem, desenhar do perto para o
      // longe não pinta uma por cima da outra.
      let perto = roadGeometry(0)
      let maxy = perto.y

      for (let j = 1; j <= FATIAS; j += 1) {
        const distancia = distanciaDaFatia(j / FATIAS)
        const longe = roadGeometry(distancia)
        if (longe.y >= maxy) continue
        fatiaVisivel[j] = 1

        // A cada 12 m, e não 18: são 5,8 faixas por segundo em cruzeiro em
        // vez de 3,9. É a referência mais barata que existe para o olho medir
        // o avanço, e ela decide também o zebrado e o tracejado das pistas.
        const stripe = Math.floor((race.progress + distancia) / 12) % 2 === 0

        ctx.fillStyle = stripe ? ambiente.gramaClara : ambiente.gramaEscura
        ctx.fillRect(0, longe.y, width, Math.max(1, perto.y - longe.y + 1))

        ctx.fillStyle = stripe ? ambiente.asfaltoClaro : ambiente.asfaltoEscuro
        ctx.beginPath()
        ctx.moveTo(longe.center - longe.roadWidth / 2, longe.y)
        ctx.lineTo(longe.center + longe.roadWidth / 2, longe.y)
        ctx.lineTo(perto.center + perto.roadWidth / 2, perto.y)
        ctx.lineTo(perto.center - perto.roadWidth / 2, perto.y)
        ctx.closePath()
        ctx.fill()

        ctx.strokeStyle = stripe ? '#f6f7ee' : '#e84037'
        ctx.lineWidth = Math.max(1, perto.roadWidth * 0.018)
        ctx.beginPath()
        ctx.moveTo(longe.center - longe.roadWidth / 2, longe.y)
        ctx.lineTo(perto.center - perto.roadWidth / 2, perto.y)
        ctx.moveTo(longe.center + longe.roadWidth / 2, longe.y)
        ctx.lineTo(perto.center + perto.roadWidth / 2, perto.y)
        ctx.stroke()

        if (stripe) {
          // As duas faixas da mesma fatia entram no mesmo traço: mesma cor,
          // mesma espessura e nunca se tocam, então o resultado é idêntico —
          // com metade das chamadas de traço, que são a operação mais cara
          // do quadro a 2,1 µs cada.
          ctx.strokeStyle = 'rgba(255,255,255,.5)'
          ctx.lineWidth = Math.max(1, perto.roadWidth * 0.008)
          ctx.beginPath()
          for (const lane of FAIXAS) {
            ctx.moveTo(longe.center + longe.roadWidth * lane, longe.y)
            ctx.lineTo(perto.center + perto.roadWidth * lane, perto.y)
          }
          ctx.stroke()
        }

        maxy = longe.y
        perto = longe
      }
    }

    /** Objeto reaproveitado pelo cenário: o laço não pode alocar. */
    const cenario = createSceneryItem()

    // Poses e paleta reaproveitadas entre quadros, pelo mesmo motivo.
    const poseDoJogador: CarPose = { tilt: 0, squash: 0, steer: 0, boost: 0, jitter: 0 }
    const poseDoFantasma: CarPose = { tilt: 0, squash: 0, steer: 0, boost: 0, jitter: 0 }
    const paletaDoFantasma: CarPalette = { ...GHOST_PALETTE }

    /** Última posição lateral conhecida do rival, para derivar o esterço dele. */
    let lateralDoFantasma = 0
    const aproximarFantasma = (alvo: number, dt: number) =>
      poseDoFantasma.steer + (alvo - poseDoFantasma.steer) * (1 - Math.exp(-Math.max(0, dt) / 0.18))

    /** Uma árvore, na família e no tom que o traçado sorteou para aquela vaga. */
    const desenharArvore = (x: number, chao: number, altura: number, tom: number, variante: number, perto: boolean) => {
      const tronco = Math.max(1, altura * 0.1)
      ctx.fillStyle = flora.troncos[variante]
      ctx.fillRect(x - tronco / 2, chao - altura * 0.46, tronco, altura * 0.46)

      ctx.fillStyle = flora.copas[tom]
      if (variante === 0) {
        // Conífera: duas saias sobrepostas, que é o que dá a silhueta de pinheiro.
        triangulo(x, chao - altura, altura * 0.3, altura * 0.44)
        triangulo(x, chao - altura * 0.72, altura * 0.35, altura * 0.42)
      } else {
        ctx.beginPath()
        ctx.ellipse(x, chao - altura * 0.68, altura * 0.34, altura * 0.37, 0, 0, Math.PI * 2)
        ctx.fill()
      }

      // O realce vem de cima e da esquerda, como o resto da cena.
      if (!perto) return
      ctx.fillStyle = flora.luz[tom]
      ctx.beginPath()
      ctx.ellipse(x - altura * 0.11, chao - altura * 0.8, altura * 0.14, altura * 0.16, 0, 0, Math.PI * 2)
      ctx.fill()
    }

    const triangulo = (x: number, topo: number, meiaBase: number, altura: number) => {
      ctx.beginPath()
      ctx.moveTo(x, topo)
      ctx.lineTo(x + meiaBase, topo + altura)
      ctx.lineTo(x - meiaBase, topo + altura)
      ctx.closePath()
      ctx.fill()
    }

    /**
     * Cenário e marcadores de distância, do fundo para a frente.
     *
     * Tudo sai do traçado, que é função pura da semente: o outro piloto vê
     * exatamente as mesmas árvores nos mesmos lugares. O laço percorre índices
     * e preenche sempre o mesmo objeto, sem montar lista nem alocar.
     */
    const drawScenery = () => {
      const ultimo = lastSceneryIndex(race.progress)
      const primeiro = firstSceneryIndex(race.progress)

      for (let indice = ultimo; indice >= primeiro; indice -= 1) {
        const ahead = indice * SCENERY_SPACING - race.progress
        const projetado = roadGeometry(ahead)
        const referencia = projetado.roadWidth
        // Longe demais para render qualquer coisa legível: sairia um pixel sujo.
        if (referencia < 6) continue
        // Atrás de uma lomba não há chão para apoiar nada, e um objeto
        // desenhado aqui flutuaria no céu acima da crista.
        if (atrasDaLomba(ahead)) continue

        // Névoa: o que está longe se dissolve no horizonte em vez de aparecer
        // nítido e minúsculo, que é justamente o que denuncia a projeção falsa.
        const nitidez = Math.min(1, 0.16 + projetado.perspective * 2.6)
        const perto = projetado.perspective > 0.16

        // A única coisa que muda de estado aqui é a opacidade, e ela é
        // reescrita em toda fatia — guardar e devolver o contexto inteiro a
        // cada uma seria pagar caro por nada. É reposta uma vez no fim.
        ctx.globalAlpha = nitidez

        for (const lado of LADOS) {
          if (!layout.scenery(indice, lado, cenario)) continue
          const x = projetado.center + lateralOffset(cenario.lateral, referencia)
          const tamanho = referencia * cenario.scale
          const tom = Math.min(flora.copas.length - 1, Math.floor(cenario.tone * flora.copas.length))

          if (cenario.kind === 'tree') {
            desenharArvore(x, projetado.y, tamanho * 0.52, tom, cenario.variant, perto)
          } else if (cenario.kind === 'bush') {
            const raio = tamanho * 0.07
            ctx.fillStyle = flora.arbustos[cenario.variant]
            ctx.beginPath()
            ctx.ellipse(x, projetado.y - raio * 0.7, raio * 1.4, raio, 0, 0, Math.PI * 2)
            ctx.fill()
            if (perto) {
              ctx.fillStyle = flora.luz[tom]
              ctx.beginPath()
              ctx.ellipse(x - raio * 0.4, projetado.y - raio, raio * 0.5, raio * 0.42, 0, 0, Math.PI * 2)
              ctx.fill()
            }
          } else if (cenario.kind === 'fence') {
            // O vão cobre metade do espaçamento para cada lado, então as
            // travessas de vagas vizinhas se encontram e a cerca fica contínua.
            const altura = tamanho * 0.058
            const vao = referencia * 0.055
            const travessa = Math.max(1, altura * 0.07)
            ctx.fillStyle = CERCA
            ctx.fillRect(x - Math.max(1, altura * 0.07), projetado.y - altura, Math.max(1, altura * 0.14), altura)
            ctx.fillRect(x - vao, projetado.y - altura * 0.94, vao * 2, travessa)
            ctx.fillRect(x - vao, projetado.y - altura * 0.52, vao * 2, travessa)
          } else if (cenario.kind === 'sign') {
            const altura = tamanho * 0.11
            const painel = altura * 0.42
            const poste = Math.max(1, altura * 0.07)
            ctx.fillStyle = CERCA
            ctx.fillRect(x - poste / 2, projetado.y - altura, poste, altura)
            // A moldura escura descola a placa da vegetação atrás dela.
            ctx.fillStyle = '#1b2228'
            ctx.fillRect(x - painel * 0.56, projetado.y - altura - painel * 0.42, painel * 1.12, painel * 0.84)
            ctx.fillStyle = PLACAS[cenario.variant]
            ctx.fillRect(x - painel / 2, projetado.y - altura - painel * 0.36, painel, painel * 0.72)
          } else {
            // Capim: talos afinando para a ponta, senão viram barras sólidas.
            const altura = Math.max(1, tamanho * 0.032)
            const talo = Math.max(1, altura * 0.16)
            ctx.fillStyle = flora.capins[cenario.variant]
            for (let folha = -2; folha <= 2; folha += 1) {
              const base = x + folha * talo * 1.9
              const ponta = base + folha * talo * 0.9
              const comprimento = altura * (1 - Math.abs(folha) * 0.17)
              ctx.beginPath()
              ctx.moveTo(base - talo / 2, projetado.y)
              ctx.lineTo(base + talo / 2, projetado.y)
              ctx.lineTo(ponta, projetado.y - comprimento)
              ctx.closePath()
              ctx.fill()
            }
          }
        }

        // Marcador de distância: cai em toda vaga par, porque o espaçamento do
        // cenário é metade do dele. Fica no mesmo laço para a ordem de
        // profundidade valer para tudo o que está na beira da pista.
        if (indice % 2 === 0) {
          const alto = isTallMarker(indice / 2)
          const altura = referencia * (alto ? 0.2 : 0.115)
          const largura = Math.max(1, referencia * 0.013)
          for (const lado of LADOS) {
            const x = projetado.center + lateralOffset(ROADSIDE_LATERAL * lado, referencia)
            // Sombra curta no chão ancora o poste na grama.
            ctx.fillStyle = 'rgba(0,0,0,.25)'
            ctx.fillRect(x - largura, projetado.y, largura * 2, Math.max(1, largura * 0.7))
            ctx.fillStyle = '#46606c'
            ctx.fillRect(x - largura / 2, projetado.y - altura, largura, altura)
            ctx.fillStyle = alto ? '#f2b52e' : '#c9d6dc'
            ctx.fillRect(x - largura, projetado.y - altura, largura * 2, Math.max(1, altura * 0.22))
          }
        }
      }

      // Opacidade reposta uma vez, e não 36 vezes por quadro.
      ctx.globalAlpha = 1
    }

    /**
     * Desenha o fantasma na mesma projeção e com o mesmo modelo do jogador.
     *
     * A pose dele não vem de `feel` — não temos a simulação do rival, só a
     * telemetria — mas sai da mesma grandeza: o quanto ele andou de lado
     * desde o quadro anterior. Cor e transparência continuam sendo dele.
     */
    const drawGhost = (distanceAhead: number, lateral: number, faded: boolean, dt: number) => {
      const projected = roadGeometry(distanceAhead)
      const x = projected.center + lateralOffset(lateral, projected.roadWidth)
      const scale = Math.max(0.76, width / CAR_SPRITE_REFERENCE_WIDTH) * Math.max(0.06, projected.perspective)

      const deriva = dt > 0 ? (lateral - lateralDoFantasma) / dt : 0
      lateralDoFantasma = lateral
      const volante = Math.max(-1, Math.min(1, deriva / 1.8))
      poseDoFantasma.steer = aproximarFantasma(volante, dt)
      poseDoFantasma.tilt = poseDoFantasma.steer * 0.075 * forcaDoMovimento

      paletaDoFantasma.alpha = GHOST_PALETTE.alpha * (faded ? 0.5 : 1)
      drawCar(ctx, x, projected.y, scale, paletaDoFantasma, poseDoFantasma)
    }

    /** Poeira, faíscas, rastro de boost e marcas de pneu, na projeção da pista. */
    const drawParticle = (particle: Particle, distanceAhead: number) => {
      const projected = roadGeometry(distanceAhead)
      const fade = Math.max(0, particle.life / particle.maxLife)
      const x = projected.center + lateralOffset(particle.lateral, projected.roadWidth)
      const scale = Math.max(0.2, projected.perspective)
      const size = particle.size * scale
      const y = projected.y - particle.lift * (1 - fade) * scale

      ctx.save()
      if (particle.kind === 'skid') {
        // A marca escurece o asfalto e vai sumindo, como borracha queimada.
        ctx.globalAlpha = 0.55 * fade
        ctx.fillStyle = '#0d0f12'
        ctx.fillRect(x - size / 2, projected.y, Math.max(1.5, size), Math.max(1.5, size * 0.8))
      } else if (particle.kind === 'spark') {
        ctx.globalAlpha = fade
        ctx.fillStyle = fade > 0.5 ? '#fff3c4' : '#ff8a00'
        ctx.fillRect(x - size / 2, y - size / 2, size, size)
      } else if (particle.kind === 'boost') {
        ctx.globalAlpha = 0.55 * fade
        ctx.fillStyle = '#43e7ff'
        ctx.fillRect(x - size / 2, y, size, Math.max(1, size * 1.6))
      } else {
        ctx.globalAlpha = 0.42 * fade
        ctx.fillStyle = '#c6b489'
        ctx.beginPath()
        ctx.arc(x, y, Math.max(1, size * (1.4 - fade * 0.6)), 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    }

    const drawObstacle = (distanceAhead: number, lane: number, kind: ObstacleKind) => {
      const projected = roadGeometry(distanceAhead)
      const closeness = Math.max(0, 1 - distanceAhead / VIEW_DISTANCE)
      const size = 5 + Math.pow(closeness, 1.5) * 48
      // Pela mesma conta de todo o resto. Antes era um 0,39 solto aqui, e o
      // obstáculo aparecia 8% mais para fora do que a colisão considerava.
      const x = projected.center + lateralOffset(lane, projected.roadWidth)
      const y = projected.y

      ctx.save()
      ctx.translate(x, y)
      if (kind === 'pothole') {
        // O buraco é do asfalto, não um objeto sobre ele: fica deitado no
        // chão, sem altura. A borda clara do lado de cá é o que o faz ler
        // como afundamento e não como mancha.
        ctx.fillStyle = 'rgba(210,214,206,.5)'
        ctx.beginPath()
        ctx.ellipse(0, -size * 0.02, size * 0.5, size * 0.19, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#15171b'
        ctx.beginPath()
        ctx.ellipse(0, -size * 0.05, size * 0.46, size * 0.16, 0, 0, Math.PI * 2)
        ctx.fill()
      } else if (kind === 'barrier') {
        ctx.fillStyle = '#eef1f2'
        roundedRect(ctx, -size * 0.65, -size * 0.42, size * 1.3, size * 0.48, size * 0.08)
        ctx.fill()
        ctx.fillStyle = '#ff4b37'
        ctx.fillRect(-size * 0.52, -size * 0.35, size * 0.35, size * 0.34)
        ctx.fillRect(size * 0.16, -size * 0.35, size * 0.35, size * 0.34)
      } else {
        ctx.fillStyle = '#ff8a00'
        ctx.beginPath()
        ctx.moveTo(0, -size * 0.72)
        ctx.lineTo(size * 0.42, 0)
        ctx.lineTo(-size * 0.42, 0)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = '#f5f6e9'
        ctx.fillRect(-size * 0.26, -size * 0.26, size * 0.52, size * 0.13)
      }
      ctx.restore()
    }

    const draw = (frame: number) => {
      const serverNow = clockRef.current()
      const dt = (frame - previous) / 1000
      previous = frame

      if (startedRef.current && !doneRef.current) {
        const elapsed = Math.max(0, (serverNow - startAt) / 1000)
        for (const event of stepRace(race, inputRef.current, dt)) {
          if (event.type === 'collision') {
            announce('IMPACTO — VELOCIDADE REDUZIDA')
            audioRef.current?.impact(0.6 + feel.speed * 0.4)
            // As faíscas saltam à frente do bico, onde a batida aconteceu.
            // Quanto mais rápido o carro estava, mais faíscas saltam.
            const faiscas = Math.round(8 + feel.speed * 10)
            effects.burst('spark', faiscas, race.progress + CAR_VIEW_DISTANCE + 5, race.lateral, {
              drift: 1.4 + feel.speed,
              life: 0.35 + feel.speed * 0.25,
            })
            registerImpact(feel)
          }
          if (event.type === 'finish') {
            doneRef.current = true
            setPhase('finished')
            audioRef.current?.update({ speed: 0, boost: 0, offRoad: 0, running: false })
            const result: RaceResult = {
              time: elapsed,
              topSpeed: race.topSpeed,
              collisions: race.collisions,
              lateStart: lateAtStart,
            }
            setTelemetry((current) => ({ ...current, progress: TRACK_LENGTH, elapsed, speed: 0 }))
            // O rival precisa saber imediatamente que o carro parou na chegada.
            sendTelemetryRef.current?.({
              t: serverNow,
              progress: race.progress,
              lateral: race.lateral,
              speed: 0,
              state: 'finished',
            })
            flashTimers.push(window.setTimeout(() => finishRef.current(result), 850))
          }
        }

        // Efeitos nascem onde o carro aparece na tela e descem junto com a pista.
        // A cadência segue o passo que a simulação aplicou, e não o tempo do
        // quadro: um quadro longo não pode virar uma rajada de poeira.
        const passo = Math.min(Math.max(0, dt), MAX_STEP_SECONDS)
        updateFeel(feel, race, passo)

        // O som lê as mesmas intensidades que a imagem: motor, vento e
        // cascalho saem de `feel`, não de uma segunda leitura da corrida.
        audioRef.current?.update({
          speed: feel.speed,
          boost: feel.boost,
          offRoad: feel.offRoad,
          running: true,
        })

        // A câmera baixa um pouco com a velocidade, inclina no esterço e leva
        // um tranco curto no impacto. Tudo contínuo, limitado e proporcional
        // à tela, para não atrapalhar a leitura nem os controles de toque.
        const segundos = frame / 1000
        const vibracao = Math.pow(feel.speed, 4) * Math.sin(segundos * 37) * height * 0.0022
        const tranco = feel.impact * Math.sin(segundos * 46) * height * 0.022
        camera.lift = feel.speed * height * 0.016 * forcaDoMovimento
        camera.shake = (vibracao + tranco) * forcaDoMovimento
        camera.roll = -feel.steer * width * 0.014 * forcaDoMovimento
        // Os efeitos saem de trás das rodas, e não do centro: nascendo sob o
        // carro, o próprio sprite os esconderia por toda a vida útil.
        const rastro = race.progress + CAR_VIEW_DISTANCE - TRAIL_SETBACK

        // A intensidade dos efeitos acompanha a velocidade e o quanto o carro
        // se afastou do asfalto, em vez de ligar e desligar por estado.
        const forcaPoeira = 0.3 + feel.speed * 0.9 + feel.offRoad * 0.4
        for (let i = dustRate.take(passo, race.offRoad, forcaPoeira); i > 0; i -= 1) {
          const roda = Math.random() < 0.5 ? -1 : 1
          effects.spawn('dust', rastro, race.lateral + roda * (WHEEL_OFFSET + Math.random() * 0.08), {
            drift: roda * (0.2 + Math.random() * 0.5) * (0.5 + feel.speed),
            size: (6 + Math.random() * 6) * (0.7 + feel.speed * 0.6),
            life: 0.5 + feel.speed * 0.35,
          })
        }

        for (let i = boostRate.take(passo, race.boosting, feel.boost); i > 0; i -= 1) {
          const roda = Math.random() < 0.5 ? -1 : 1
          effects.spawn('boost', rastro, race.lateral + roda * WHEEL_OFFSET, {
            size: 6 + feel.boost * 4,
            life: 0.25 + feel.boost * 0.2,
          })
        }

        // A marca de pneu acompanha o esforço lateral que a simulação mediu, e
        // não um "velocidade > X e lateral > Y" — que era justamente o tipo de
        // corte binário que fazia o efeito piscar ao cruzar o limite.
        const forcaDerrapagem = Math.max(feel.offRoad, feel.strain, race.penalty > 0 ? 1 : 0)
        for (let i = skidRate.take(passo, forcaDerrapagem > 0.05, forcaDerrapagem); i > 0; i -= 1) {
          for (const roda of [-1, 1]) {
            effects.spawn('skid', rastro, race.lateral + roda * WHEEL_OFFSET, {
              size: 5 + forcaDerrapagem * 3,
            })
          }
        }

        if (frame - lastHudUpdate > 80) {
          lastHudUpdate = frame
          setTelemetry({
            progress: race.progress,
            speed: race.speed,
            boost: race.boost,
            elapsed,
            offRoad: race.offRoad,
            penalty: race.penalty,
            boosting: race.boosting,
            boostLocked: race.boostLocked,
            grip: race.grip,
          })
        }
      }

      // A simulação já avançou: a partir daqui o quadro inteiro usa o mesmo
      // progresso, e portanto a mesma curva de referência.
      curvaAqui = layout.centerOffset(race.progress)
      rumoAqui = layout.heading(race.progress)
      alturaAqui = layout.elevation(race.progress)
      inclinacaoAqui = layout.slope(race.progress)

      drawBackdrop()
      drawRoad()
      drawScenery()

      // As marcas de pneu ficam no asfalto, abaixo de tudo o que corre na pista.
      effects.update(Math.min(Math.max(0, dt), MAX_STEP_SECONDS), race.progress)
      const efeitos = effects.visible(race.progress)
      for (const particula of efeitos) {
        if (particula.kind === 'skid') drawParticle(particula, particula.distance - race.progress)
      }

      // Posição do fantasma neste quadro, já interpolada.
      const rivalSample = ghostRef.current?.sample(serverNow) ?? null
      const rivalAhead = rivalSample ? rivalSample.progress - race.progress : 0
      const rivalVisible =
        Boolean(rivalSample) && rivalAhead > 0 && rivalAhead < VIEW_DISTANCE && !atrasDaLomba(rivalAhead)

      // Os obstáculos já estão em ordem de distância, então basta percorrer do
      // fim para o começo — do mais distante para o mais próximo — sem montar
      // lista nova a cada quadro. O fantasma entra na ordem de profundidade.
      let ghostDrawn = !rivalVisible
      const pedras = race.rules.obstacles
      for (let indice = pedras.length - 1; indice >= 0; indice -= 1) {
        const obstaculo = pedras[indice]
        const ahead = obstaculo.distance - race.progress
        if (ahead <= 0 || ahead >= VIEW_DISTANCE) continue
        if (atrasDaLomba(ahead)) continue

        if (!ghostDrawn && rivalAhead > ahead) {
          drawGhost(rivalAhead, rivalSample!.lateral, rivalSample!.stale, dt)
          ghostDrawn = true
        }
        drawObstacle(ahead, obstaculo.lane, obstaculo.kind)
      }
      if (!ghostDrawn) drawGhost(rivalAhead, rivalSample!.lateral, rivalSample!.stale, dt)

      if (rivalSample && frame - lastRivalHud > 100) {
        lastRivalHud = frame
        const gap = gapBetween(race.progress, rivalSample.progress, race.speed, rivalSample.speed)
        setRival({
          position: gap.position,
          headline: positionNotice(gap),
          offScreen: rivalVisible ? null : offScreenNotice(gap, rivalSide(race.lateral, rivalSample.lateral)),
          stale: rivalSample.stale,
          finished: rivalSample.state === 'finished',
          onScreen: rivalVisible,
        })
      }

      if (TRACK_LENGTH - race.progress < VIEW_DISTANCE && !atrasDaLomba(TRACK_LENGTH - race.progress)) {
        const finish = roadGeometry(TRACK_LENGTH - race.progress)
        const cells = 12
        for (let i = 0; i < cells; i += 1) {
          ctx.fillStyle = i % 2 === 0 ? '#f3f3ed' : '#11151a'
          const cellWidth = finish.roadWidth / cells
          ctx.fillRect(finish.center - finish.roadWidth / 2 + i * cellWidth, finish.y, cellWidth + 1, 5)
        }
      }

      // A bruma entra depois de tudo que tem profundidade — pista, cenário,
      // obstáculos, fantasma e chegada — e antes do carro e dos efeitos dele,
      // que estão sempre perto da câmera e continuam nítidos.
      ctx.fillStyle = gradienteDaBruma()
      ctx.fillRect(0, height * (HORIZON_RATIO - 0.1), width, height * 0.75 - height * HORIZON_RATIO)

      // Poeira, faíscas e rastro de boost passam por cima da pista e dos carros.
      for (const particula of efeitos) {
        if (particula.kind !== 'skid') drawParticle(particula, particula.distance - race.progress)
      }

      // O carro usa a mesma projeção da pista, dos obstáculos e do fantasma.
      // Assim ele acompanha a curva e a borda do asfalto significa a mesma
      // coisa para o desenho e para a regra de sair da pista.
      const ondeEstaOCarro = roadGeometry(CAR_VIEW_DISTANCE)
      const playerX = ondeEstaOCarro.center + lateralOffset(race.lateral, ondeEstaOCarro.roadWidth)
      if (!doneRef.current) {
        // A pose inteira sai de `feel`, que só lê a simulação: o corpo inclina
        // no esterço, comprime na arrancada e no impacto, as rodas da frente
        // seguem o volante e a carroceria treme na grama.
        poseDoJogador.tilt = feel.steer * 0.075 * forcaDoMovimento
        poseDoJogador.squash = (feel.accel * 0.05 - feel.impact * 0.1) * forcaDoMovimento
        poseDoJogador.steer = feel.steer
        poseDoJogador.boost = feel.boost
        poseDoJogador.jitter =
          feel.offRoad * Math.sin(frame * 0.055) * 1.6 * forcaDoMovimento +
          feel.impact * Math.sin(frame * 0.085) * 2.4 * forcaDoMovimento
        drawCar(
          ctx,
          playerX,
          ondeEstaOCarro.y,
          Math.max(0.76, width / CAR_SPRITE_REFERENCE_WIDTH),
          PLAYER_PALETTE,
          poseDoJogador,
        )
      }

      // O aviso de fora da pista cresce conforme o carro se afasta da borda,
      // em vez de aparecer inteiro de uma vez.
      if (feel.offRoad > 0.01 && startedRef.current && !doneRef.current) {
        ctx.fillStyle = `rgba(255, 87, 48, ${(0.11 * feel.offRoad).toFixed(3)})`
        ctx.fillRect(0, 0, width, height)
      }
      animationFrame = requestAnimationFrame(draw)
    }

    animationFrame = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(animationFrame)
      observer.disconnect()
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', resumeClock)
      for (const timer of flashTimers) window.clearTimeout(timer)
    }
  }, [beep, countdownMs, difficulty, startAt, trackSeed])

  /**
   * Envio da telemetria.
   *
   * Fica em um temporizador, e não no ciclo de animação, por dois motivos: a
   * frequência não pode depender da taxa de quadros do aparelho, e uma aba em
   * segundo plano precisa continuar dizendo ao rival onde o carro parou — o
   * fantasma congelado é a informação correta, melhor do que sumir do mapa.
   */
  useEffect(() => {
    if (!onTelemetry) return
    const timer = window.setInterval(() => {
      if (!startedRef.current || doneRef.current) return
      const race = raceRef.current
      sendTelemetryRef.current?.({
        t: clockRef.current(),
        progress: race.progress,
        lateral: race.lateral,
        speed: race.speed,
        state: 'racing',
      })
    }, TELEMETRY_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [onTelemetry, startAt])

  useEffect(() => () => {
    audioRef.current?.close()
    audioRef.current = null
  }, [])

  const progressPercent = Math.min(100, (telemetry.progress / TRACK_LENGTH) * 100)

  return (
    <main className="race-shell">
      <canvas ref={canvasRef} className="race-canvas" aria-label="Pista de corrida" />

      <div className="topbar">
        <div className="brand-mini"><i /> CORRIDA FANTASMA</div>
        <div className="topbar-actions">
          <button
            className={`sound-button ${mudo ? 'off' : ''}`}
            onClick={alternarSom}
            aria-pressed={!mudo}
            aria-label={mudo ? 'Ligar o som' : 'Desligar o som'}
          >
            {mudo ? 'SOM ✕' : 'SOM ♪'}
          </button>
          {onAbandon && phase === 'racing' && (
            <button className="abandon-button" onClick={onAbandon}>ABANDONAR</button>
          )}
        </div>
        <div className="pilot-tag"><span>PILOTO</span>{pilotName}</div>
      </div>

      <section className="hud" aria-label="Telemetria">
        <div className="position-block">
          <span>{mode === 'online' && rival ? 'POSIÇÃO' : 'MODO'}</span>
          <strong>{mode === 'online' ? (rival?.position ?? 'DUELO') : 'SOLO'}</strong>
          <em className="difficulty-tag">{DIFFICULTY_LABELS[difficulty]}</em>
        </div>
        <div className="timer-block">
          <span>TEMPO DE CORRIDA</span>
          <strong>{formatTime(telemetry.elapsed)}</strong>
        </div>
        <div className="speed-block">
          <strong>{Math.round(telemetry.speed)}</strong>
          <span>KM/H</span>
        </div>
      </section>

      <div className="progress-wrap">
        <div className="progress-copy">
          <span>SETOR ÚNICO</span>
          <strong>{progressPercent.toFixed(0)}%</strong>
        </div>
        <div className="progress-track"><i style={{ width: `${progressPercent}%` }} /></div>
      </div>

      <div className={`boost-meter ${telemetry.boosting ? 'active' : ''} ${telemetry.boostLocked ? 'empty' : ''}`}>
        <div className="boost-copy"><span>BOOST</span><b>{Math.round(telemetry.boost)}%</b></div>
        <div className="boost-track"><i style={{ width: `${telemetry.boost}%` }} /></div>
      </div>

      {mode === 'online' && phase !== 'countdown' && (
        <div
          className={`rival-panel ${rival?.stale || !rivalConnected ? 'stale' : ''} ${rival?.onScreen && rivalConnected ? 'compact' : ''}`}
          aria-live="polite"
        >
          <span>{rivalName}</span>
          {!rivalConnected ? (
            <strong>SEM SINAL — AGUARDANDO O RETORNO</strong>
          ) : !rival ? (
            <strong>AGUARDANDO TELEMETRIA</strong>
          ) : rival.finished ? (
            <strong>CRUZOU A LINHA DE CHEGADA</strong>
          ) : (
            <strong>{rival.headline}</strong>
          )}
          {rival?.offScreen && rivalConnected && !rival.finished && <em>{rival.offScreen}</em>}
        </div>
      )}

      {connectionNotice && <div className="connection-notice">{connectionNotice}</div>}
      {telemetry.offRoad && phase === 'racing' && <div className="warning">FORA DA PISTA</div>}
      {/* A perda por esforço lateral precisa ser vista para ser justa: uma
          punição que o piloto não percebe é só um bug do ponto de vista dele. */}
      {!telemetry.offRoad && telemetry.grip < 0.97 && phase === 'racing' && (
        <div className="warning grip">PERDENDO ADERÊNCIA</div>
      )}
      {flash && <div className="impact">{flash}</div>}

      {phase === 'countdown' && (
        <div className="countdown-layer">
          <div className="lights" aria-label={`${countdownLight} de ${LIGHT_COUNT} luzes`}>
            {[1, 2, 3, 4, 5].map((light) => (
              <i key={light} className={countdownLight >= light ? 'on' : ''} />
            ))}
          </div>
          <p>{countdownLight === 0 ? 'PREPARE-SE' : 'AGUARDE AS LUZES APAGAREM'}</p>
          {mode === 'online' && <p className="countdown-sync">LARGADA SINCRONIZADA PELO SERVIDOR</p>}
        </div>
      )}

      {phase === 'racing' && telemetry.elapsed < 1.1 && <div className="go-signal">VAI!</div>}
      {lateStart > 0.4 && phase !== 'finished' && (
        <div className="late-notice">LARGADA PERDIDA POR {lateStart.toFixed(1)} S — RECUPERANDO</div>
      )}

      <div className="touch-controls" aria-label="Controles de toque">
        <button className="steer left" aria-label="Virar à esquerda" {...holdControl('left')}>‹</button>
        <button className="steer right" aria-label="Virar à direita" {...holdControl('right')}>›</button>
        <button className="boost-button" aria-label="Ativar boost" {...holdControl('boost')}>
          <span>BOOST</span><small>SEGURE</small>
        </button>
      </div>

      <div className="keyboard-hint"><kbd>A</kbd><kbd>D</kbd> DIREÇÃO <kbd>ESPAÇO</kbd> BOOST</div>
    </main>
  )
}

export default RaceCanvas
