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
import { createFeel, registerImpact, updateFeel } from './feel'
import { createRaceState, MAX_STEP_SECONDS, stepRace, type RaceInput } from './simulation'
import { EmissionRate, ParticleField, TRAIL_SETBACK, WHEEL_OFFSET, type Particle } from './particles'
import {
  CAR_SPRITE_REFERENCE_WIDTH,
  CAR_VIEW_DISTANCE,
  firstRoadsideIndex,
  formatTime,
  isTallMarker,
  lastRoadsideIndex,
  lateralOffset,
  obstacles,
  roadProjection,
  ROADSIDE_LATERAL,
  ROADSIDE_SPACING,
  TRACK_LENGTH,
  trackCurve,
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
  body: string
  stripe: string
  glass: string
  wings: string
  shadow: string
  alpha: number
}

/** Cores do carro do jogador. */
const PLAYER_PALETTE: CarPalette = {
  tyres: '#0b0d11',
  body: '#ff4b2b',
  stripe: '#ffb000',
  glass: '#c7f9ff',
  wings: '#151820',
  shadow: 'rgba(0,0,0,.42)',
  alpha: 1,
}

/** O fantasma usa azul e transparência para nunca ser confundido com o próprio carro. */
const GHOST_PALETTE: CarPalette = {
  tyres: '#16303a',
  body: '#43e7ff',
  stripe: '#e8fbff',
  glass: '#0d2a33',
  wings: '#1d4854',
  shadow: 'rgba(67,231,255,.14)',
  alpha: 0.46,
}

/** Deformações de apresentação do carro. Nada disso afeta a corrida. */
type CarPose = {
  /** Inclinação da carroceria, em radianos. */
  tilt: number
  /** Compressão vertical: negativo estica, positivo achata. */
  squash: number
}

const POSE_NEUTRA: CarPose = { tilt: 0, squash: 0 }

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
  if (pose.tilt !== 0) ctx.rotate(pose.tilt)
  ctx.scale(scale * (1 + pose.squash * 0.5), scale * (1 - pose.squash))

  ctx.fillStyle = palette.shadow
  ctx.beginPath()
  ctx.ellipse(0, 10, 34, 14, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = palette.tyres
  roundedRect(ctx, -31, -3, 13, 32, 4)
  ctx.fill()
  roundedRect(ctx, 18, -3, 13, 32, 4)
  ctx.fill()

  ctx.fillStyle = palette.body
  ctx.beginPath()
  ctx.moveTo(-23, 25)
  ctx.lineTo(-17, -25)
  ctx.quadraticCurveTo(0, -38, 17, -25)
  ctx.lineTo(23, 25)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = palette.stripe
  ctx.fillRect(-4, -31, 8, 57)
  ctx.fillStyle = palette.glass
  ctx.beginPath()
  ctx.moveTo(-10, -13)
  ctx.lineTo(0, -23)
  ctx.lineTo(10, -13)
  ctx.lineTo(7, 0)
  ctx.lineTo(-7, 0)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = palette.wings
  ctx.fillRect(-30, 20, 60, 7)
  ctx.fillRect(-27, -28, 54, 6)
  ctx.restore()
}

function RaceCanvas({
  pilotName,
  startAt,
  countdownMs = DEFAULT_COUNTDOWN_MS,
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
  const raceRef = useRef(createRaceState())
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
  const audioRef = useRef<AudioContext | null>(null)

  clockRef.current = now ?? Date.now
  finishRef.current = onFinish
  ghostRef.current = ghost
  sendTelemetryRef.current = onTelemetry

  const beep = useCallback((frequency: number, duration = 0.12) => {
    const AudioContextClass = window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) return
    const audio = audioRef.current ?? new AudioContextClass()
    audioRef.current = audio
    if (audio.state === 'suspended') void audio.resume()
    const oscillator = audio.createOscillator()
    const gain = audio.createGain()
    oscillator.type = 'square'
    oscillator.frequency.value = frequency
    gain.gain.setValueAtTime(0.045, audio.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duration)
    oscillator.connect(gain).connect(audio.destination)
    oscillator.start()
    oscillator.stop(audio.currentTime + duration)
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
    raceRef.current = createRaceState()
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
  }, [beep, countdownMs, startAt])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const race = raceRef.current
    const lateAtStart = lateBy(clockRef.current(), startAt)
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

    const roadGeometry = (distanceAhead: number) => {
      const { y, roadWidth, perspective } = roadProjection(distanceAhead, width, height)
      const bend = (trackCurve(race.progress + distanceAhead) - trackCurve(race.progress)) * width * 0.31
      return {
        y: y + (camera.lift + camera.shake) * perspective,
        roadWidth,
        perspective,
        center: width / 2 + bend * (1 - perspective * 0.25) + camera.roll * perspective,
      }
    }

    const drawBackdrop = () => {
      const sky = ctx.createLinearGradient(0, 0, 0, height * 0.5)
      sky.addColorStop(0, '#06101b')
      sky.addColorStop(0.58, '#173d4b')
      sky.addColorStop(1, '#ff875f')
      ctx.fillStyle = sky
      ctx.fillRect(0, 0, width, height * 0.44)

      ctx.fillStyle = '#14222b'
      ctx.beginPath()
      ctx.moveTo(0, height * 0.34)
      for (let x = 0; x <= width; x += 55) {
        const ridge = height * (0.3 + 0.035 * Math.sin(x * 0.017 + race.progress * 0.0005))
        ctx.lineTo(x, ridge)
      }
      ctx.lineTo(width, height * 0.48)
      ctx.lineTo(0, height * 0.48)
      ctx.closePath()
      ctx.fill()

      ctx.fillStyle = '#183824'
      ctx.fillRect(0, height * 0.38, width, height)
    }

    const drawRoad = () => {
      const slices = 84
      for (let i = 0; i < slices; i += 1) {
        const farDistance = VIEW_DISTANCE * (1 - i / slices)
        const nearDistance = VIEW_DISTANCE * (1 - (i + 1) / slices)
        const far = roadGeometry(farDistance)
        const near = roadGeometry(nearDistance)
        const stripe = Math.floor((race.progress + nearDistance) / 18) % 2 === 0

        ctx.fillStyle = stripe ? '#244b2c' : '#214329'
        ctx.fillRect(0, far.y, width, Math.max(1, near.y - far.y + 1))

        ctx.fillStyle = stripe ? '#30343b' : '#2b2f35'
        ctx.beginPath()
        ctx.moveTo(far.center - far.roadWidth / 2, far.y)
        ctx.lineTo(far.center + far.roadWidth / 2, far.y)
        ctx.lineTo(near.center + near.roadWidth / 2, near.y)
        ctx.lineTo(near.center - near.roadWidth / 2, near.y)
        ctx.closePath()
        ctx.fill()

        ctx.strokeStyle = stripe ? '#f6f7ee' : '#e84037'
        ctx.lineWidth = Math.max(1, near.roadWidth * 0.018)
        ctx.beginPath()
        ctx.moveTo(far.center - far.roadWidth / 2, far.y)
        ctx.lineTo(near.center - near.roadWidth / 2, near.y)
        ctx.moveTo(far.center + far.roadWidth / 2, far.y)
        ctx.lineTo(near.center + near.roadWidth / 2, near.y)
        ctx.stroke()

        if (stripe) {
          ctx.strokeStyle = 'rgba(255,255,255,.5)'
          ctx.lineWidth = Math.max(1, near.roadWidth * 0.008)
          for (const lane of [-0.33, 0.33]) {
            ctx.beginPath()
            ctx.moveTo(far.center + far.roadWidth * lane, far.y)
            ctx.lineTo(near.center + near.roadWidth * lane, near.y)
            ctx.stroke()
          }
        }
      }
    }

    /**
     * Marcadores das laterais. São a referência que dá velocidade à cena: por
     * estarem longe do centro, varrem a tela muito mais rápido do que a pista
     * ao longe. O laço vai do mais distante para o mais próximo e não monta
     * lista nenhuma, para não alocar a cada quadro.
     */
    const drawRoadside = () => {
      const ultimo = lastRoadsideIndex(race.progress)
      const primeiro = firstRoadsideIndex(race.progress)
      for (let indice = ultimo; indice >= primeiro; indice -= 1) {
        const ahead = indice * ROADSIDE_SPACING - race.progress
        const projetado = roadGeometry(ahead)
        const alto = isTallMarker(indice)
        const altura = projetado.roadWidth * (alto ? 0.2 : 0.115)
        const largura = Math.max(1, projetado.roadWidth * 0.013)

        for (const lado of [-1, 1]) {
          const x = projetado.center + lateralOffset(ROADSIDE_LATERAL * lado, projetado.roadWidth)
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

    /**
     * Desenha o fantasma na mesma projeção usada pela pista. O fator 0.36
     * faz a faixa do rival coincidir com a do jogador quando estão lado a lado.
     */
    const drawGhost = (distanceAhead: number, lateral: number, faded: boolean) => {
      const projected = roadGeometry(distanceAhead)
      const x = projected.center + lateralOffset(lateral, projected.roadWidth)
      const scale = Math.max(0.76, width / 620) * Math.max(0.06, projected.perspective)

      drawCar(ctx, x, projected.y, scale, {
        ...GHOST_PALETTE,
        alpha: GHOST_PALETTE.alpha * (faded ? 0.5 : 1),
      })
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

    const drawObstacle = (distanceAhead: number, lane: number, kind: 'barrier' | 'debris') => {
      const projected = roadGeometry(distanceAhead)
      const closeness = Math.max(0, 1 - distanceAhead / VIEW_DISTANCE)
      const size = 5 + Math.pow(closeness, 1.5) * 48
      const x = projected.center + projected.roadWidth * lane * 0.39
      const y = projected.y

      ctx.save()
      ctx.translate(x, y)
      if (kind === 'barrier') {
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
            beep(105, 0.24)
            // As faíscas saltam à frente do bico, onde a batida aconteceu.
            effects.burst('spark', 12, race.progress + CAR_VIEW_DISTANCE + 5, race.lateral, { drift: 1.8 })
            registerImpact(feel)
          }
          if (event.type === 'finish') {
            doneRef.current = true
            setPhase('finished')
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
        updateFeel(feel, race, inputRef.current, passo)

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
        const derrapando = Math.abs(race.lateral) > 0.6 && race.speed > 120

        for (let i = dustRate.take(passo, race.offRoad); i > 0; i -= 1) {
          const roda = Math.random() < 0.5 ? -1 : 1
          effects.spawn('dust', rastro, race.lateral + roda * (WHEEL_OFFSET + Math.random() * 0.08), {
            drift: roda * (0.2 + Math.random() * 0.5),
            size: 7 + Math.random() * 6,
          })
        }
        for (let i = boostRate.take(passo, race.boosting); i > 0; i -= 1) {
          const roda = Math.random() < 0.5 ? -1 : 1
          effects.spawn('boost', rastro, race.lateral + roda * WHEEL_OFFSET)
        }
        for (let i = skidRate.take(passo, race.offRoad || derrapando || race.penalty > 0); i > 0; i -= 1) {
          for (const roda of [-1, 1]) effects.spawn('skid', rastro, race.lateral + roda * WHEEL_OFFSET)
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
          })
        }
      }

      drawBackdrop()
      drawRoad()
      drawRoadside()

      // As marcas de pneu ficam no asfalto, abaixo de tudo o que corre na pista.
      effects.update(Math.min(Math.max(0, dt), MAX_STEP_SECONDS), race.progress)
      const efeitos = effects.visible(race.progress)
      for (const item of efeitos) {
        if (item.particle.kind === 'skid') drawParticle(item.particle, item.ahead)
      }

      // Posição do fantasma neste quadro, já interpolada.
      const rivalSample = ghostRef.current?.sample(serverNow) ?? null
      const rivalAhead = rivalSample ? rivalSample.progress - race.progress : 0
      const rivalVisible = Boolean(rivalSample) && rivalAhead > 0 && rivalAhead < VIEW_DISTANCE

      const visibleObstacles = obstacles
        .map((obstacle) => ({ ...obstacle, ahead: obstacle.distance - race.progress }))
        .filter((obstacle) => obstacle.ahead > 0 && obstacle.ahead < VIEW_DISTANCE)
        .sort((a, b) => b.ahead - a.ahead)

      // O fantasma entra na ordem de profundidade dos obstáculos.
      let ghostDrawn = !rivalVisible
      for (const obstacle of visibleObstacles) {
        if (!ghostDrawn && rivalAhead > obstacle.ahead) {
          drawGhost(rivalAhead, rivalSample!.lateral, rivalSample!.stale)
          ghostDrawn = true
        }
        drawObstacle(obstacle.ahead, obstacle.lane, obstacle.kind)
      }
      if (!ghostDrawn) drawGhost(rivalAhead, rivalSample!.lateral, rivalSample!.stale)

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

      if (TRACK_LENGTH - race.progress < VIEW_DISTANCE) {
        const finish = roadGeometry(TRACK_LENGTH - race.progress)
        const cells = 12
        for (let i = 0; i < cells; i += 1) {
          ctx.fillStyle = i % 2 === 0 ? '#f3f3ed' : '#11151a'
          const cellWidth = finish.roadWidth / cells
          ctx.fillRect(finish.center - finish.roadWidth / 2 + i * cellWidth, finish.y, cellWidth + 1, 5)
        }
      }

      // Poeira, faíscas e rastro de boost passam por cima da pista e dos carros.
      for (const item of efeitos) {
        if (item.particle.kind !== 'skid') drawParticle(item.particle, item.ahead)
      }

      // O carro usa a mesma projeção da pista, dos obstáculos e do fantasma.
      // Assim ele acompanha a curva e a borda do asfalto significa a mesma
      // coisa para o desenho e para a regra de sair da pista.
      const ondeEstaOCarro = roadGeometry(CAR_VIEW_DISTANCE)
      const playerX = ondeEstaOCarro.center + lateralOffset(race.lateral, ondeEstaOCarro.roadWidth)
      if (!doneRef.current) {
        // O corpo inclina no esterço e comprime na arrancada e no impacto.
        const pose = {
          tilt: feel.steer * 0.075 * forcaDoMovimento,
          squash: (feel.accel * 0.05 - feel.impact * 0.1) * forcaDoMovimento,
        }
        drawCar(ctx, playerX, ondeEstaOCarro.y, Math.max(0.76, width / CAR_SPRITE_REFERENCE_WIDTH), PLAYER_PALETTE, pose)
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
  }, [beep, countdownMs, startAt])

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

  useEffect(() => () => { void audioRef.current?.close() }, [])

  const progressPercent = Math.min(100, (telemetry.progress / TRACK_LENGTH) * 100)

  return (
    <main className="race-shell">
      <canvas ref={canvasRef} className="race-canvas" aria-label="Pista de corrida" />

      <div className="topbar">
        <div className="brand-mini"><i /> CORRIDA FANTASMA</div>
        {onAbandon && phase === 'racing' && (
          <button className="abandon-button" onClick={onAbandon}>ABANDONAR</button>
        )}
        <div className="pilot-tag"><span>PILOTO</span>{pilotName}</div>
      </div>

      <section className="hud" aria-label="Telemetria">
        <div className="position-block">
          <span>{mode === 'online' && rival ? 'POSIÇÃO' : 'MODO'}</span>
          <strong>{mode === 'online' ? (rival?.position ?? 'DUELO') : 'SOLO'}</strong>
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
