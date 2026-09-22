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
import { DEFAULT_CAR, carById, type CarId } from './cars'
import { drawCar, prepareCar, type CarPose } from './carSprites'
import { createFeel, registerImpact, updateFeel } from './feel'
import { LUZ, misturar, rampa } from './paleta'
import {
  desenharBuraco,
  desenharFaixaDeFundo,
  desenharObjeto,
  desenharOleo,
  desenharPoca,
  desenharPortico,
  prepararCenario,
} from './cenarioSprites'
import type { FamiliaDeVaga } from './cenarioModel'
import {
  createGantry,
  createSceneryItem,
  createTrackLayout,
  curvatureLoad,
  firstSceneryIndex,
  lastSceneryIndex,
  GANTRY_EVERY,
  SCENERY_SPACING,
  type Flora,
} from './layout'
import { DIFFICULTY_LABELS, rulesFor, type Difficulty } from './rules'
import {
  createRaceState,
  MAX_STEP_SECONDS,
  slipstreamFrom,
  stepRace,
  type RaceContext,
  type RaceInput,
} from './simulation'
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
  /** Carro escolhido na garagem. Só muda a pintura; a física é a mesma. */
  car: CarId
  /** Carro do rival, desenhado como fantasma. */
  rivalCar?: CarId | null
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
  /** Vácuo aproveitado, já suavizado, de 0 a 1. */
  slipstream: number
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
  slipstream: 0,
}


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
 * Ângulos das rajadas de velocidade, em torno do ponto de fuga.
 *
 * Vão de pouco acima do horizonte à esquerda até pouco acima dele à direita,
 * passando por baixo: rajada no céu não diz nada, e o que se quer é a sensação
 * de o chão fugir pelos cantos. O empurrãozinho de `sin` tira o leque regular
 * demais, e como a lista é constante ela é sempre a mesma corrida após corrida.
 */
const ANGULOS_DE_RAJADA = Array.from({ length: 18 }, (_, i) => {
  const passo = -0.18 * Math.PI + (i / 17) * 1.36 * Math.PI
  return passo + Math.sin(i * 12.9898) * 0.09
})

/**
 * Cerca e guardrail: as duas famílias que seguem procedurais.
 *
 * As duas são contínuas ao longo da pista, e o vão de cada vaga cobre metade
 * do espaçamento para os dois lados para as travessas se encontrarem. Isso
 * depende das projeções de duas vagas vizinhas, que diferem — assadas numa
 * célula por vaga, virariam uma fila de portõezinhos soltos.
 */
/** Tom para onde a poeira clareia ao subir do chão. */
const POEIRA_CLARA = '#c6b489'

/** A faísca nasce nesta cor e esfria para a cor dela. */
const FAISCA_QUENTE = '#fff3c4'

const CERCA = rampa('#6d7b7f')
const GUARDRAIL = rampa('#aeb6ba')

/**
 * Altura na tela de cada família, em frações da largura da pista.
 *
 * São os mesmos números de quando cada objeto era desenhado à mão aqui: o
 * que mudou foi de onde vem o desenho, não o tamanho que ele ocupa.
 */
const ALTURA_DA_FAMILIA: Record<FamiliaDeVaga, number> = {
  tree: 0.52,
  bush: 0.16,
  grass: 0.038,
  // A placa nova tem painel largo, então ela precisa ser mais baixa que a
  // antiga para ocupar a mesma mancha na beira da pista.
  sign: 0.085,
  pneus: 0.075,
  poste: 0.42,
  arquibancada: 0.26,
  bandeira: 0.3,
  pedra: 0.1,
  cacto: 0.34,
  predio: 0.52,
}

/**
 * Sombra que todo objeto deixa no chão.
 *
 * É o detalhe mais barato e o que mais rende: sem ela, árvore, arbusto, poste
 * e placa pairam alguns pixels acima da grama e a cena inteira perde o
 * assentamento. Deslocada para a direita, porque a luz vem da esquerda — a
 * mesma direção da face iluminada do carro.
 */
const SOMBRA_NO_CHAO = 'rgba(10,20,26,.3)'

function RaceCanvas({
  pilotName,
  car,
  rivalCar = null,
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
  // Os carros entram por referência: o laço de quadro não é refeito por eles.
  const carRef = useRef(car)
  const rivalCarRef = useRef(rivalCar)
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
  carRef.current = car
  rivalCarRef.current = rivalCar
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
    // Rampas do fundo, montadas uma vez por corrida: a serra de perto em tom
    // cheio, a de longe já misturada com o céu, que é o que a afasta.
    const serra = rampa(ambiente.serra)
    const serraLonge = rampa(misturar(ambiente.serra, ambiente.ceuMeio, 0.42))
    const nuvem = rampa(misturar(ambiente.ceuMeio, LUZ, 0.3))
    // A faixa de meio-campo fica entre a serra e a grama, e a cor dela também:
    // mais fechada que a montanha lavada pelo céu, mais aberta que o chão.
    const corDaFaixa = misturar(ambiente.serra, ambiente.chao, 0.38)
    // O buraco é a única peça que continua sendo pintada ao vivo, e a única
    // cuja cor vem do chão em que ela está: asfalto quebrado é asfalto, e uma
    // borda de cinza fixo apareceria clara demais ao entardecer e escura
    // demais ao meio-dia.
    const buraco = rampa(ambiente.asfaltoClaro)
    // Poeira da grama, da cor do chão daquele lugar. Clareada, porque poeira
    // no ar pega luz que o chão não pega — mas puxada para o tom dele, senão
    // a mesma nuvem bege subiria do campo verde e da duna.
    const poeira = misturar(ambiente.chao, POEIRA_CLARA, 0.55)
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
      // Mudar o tamanho do canvas zera o contexto, e com ele a qualidade da
      // redução: no padrão, a pintura do carro sai serrilhada ao encolher.
      ctx.imageSmoothingQuality = 'high'
    }
    resize()
    prepareCar(carRef.current, ambiente.nevoaRGB)
    if (rivalCarRef.current) prepareCar(rivalCarRef.current, ambiente.nevoaRGB, true)
    prepararCenario(ambiente.flora, ambiente.nevoaRGB)

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

    // Curva e esteira do quadro, entregues à simulação. É um objeto só,
    // reaproveitado, e não um novo a cada quadro: este laço não aloca.
    const raceContext: RaceContext = { curvature: 0, slipstream: 0 }

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

    /**
     * Uma cordilheira, do topo da crista até a base do quadro.
     *
     * `onda` e `passo` dão o perfil, `desvio` corre com a curva e `queda`
     * desloca a mesma crista para baixo e para a direita — é desenhando a
     * serra duas vezes, uma clara e outra deslocada por cima, que sobra a
     * lasca acesa na encosta voltada para o sol. Duas chamadas de preenchimento
     * para uma montanha com duas faces.
     */
    const desenharSerra = (
      cor: string, base: number, onda: number, passo: number, fase: number, desvio: number, queda: number,
    ) => {
      ctx.fillStyle = cor
      ctx.beginPath()
      ctx.moveTo(0, height * base + queda)
      for (let x = 0; x <= width; x += 40) {
        const crista = height * (base + onda * Math.sin((x + desvio) * passo + fase)) + queda
        ctx.lineTo(x, crista)
      }
      ctx.lineTo(width, height * 0.52)
      ctx.lineTo(0, height * 0.52)
      ctx.closePath()
      ctx.fill()
    }

    /** Uma nuvem chapada: três bossas e uma aresta acesa em cima. */
    const desenharNuvem = (x: number, y: number, escala: number) => {
      const largura = width * 0.036 * escala
      const altura = largura * 0.34
      ctx.fillStyle = nuvem[2]
      elipse(x, y, largura, altura)
      elipse(x - largura * 0.72, y + altura * 0.22, largura * 0.52, altura * 0.62)
      elipse(x + largura * 0.66, y + altura * 0.26, largura * 0.58, altura * 0.58)
      ctx.fillStyle = nuvem[4]
      elipse(x - largura * 0.16, y - altura * 0.24, largura * 0.62, altura * 0.5)
    }

    /**
     * Posição das nuvens no céu, em fração da tela.
     *
     * Ficam em constante de módulo pelo mesmo motivo de todo o resto: o laço
     * de quadro não pode alocar.
     */
    const NUVENS: readonly (readonly [number, number, number])[] = [
      [0.1, 0.09, 1.1], [0.38, 0.16, 0.7], [0.66, 0.07, 0.95], [0.88, 0.18, 0.8],
    ]

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

      // Sol baixo à esquerda, que é de onde vem a luz de tudo o mais no jogo.
      // Três discos de opacidade decrescente no lugar de um degradê: é o mesmo
      // halo em degraus que o resto do desenho usa.
      const solX = width * 0.26 + desvio * 0.35
      const solY = height * 0.23 + subida * 0.5
      ctx.fillStyle = `rgba(${ambiente.nevoaRGB},.05)`
      elipse(solX, solY, height * 0.115, height * 0.115)
      ctx.fillStyle = `rgba(${ambiente.nevoaRGB},.09)`
      elipse(solX, solY, height * 0.068, height * 0.068)
      ctx.fillStyle = `rgba(${ambiente.nevoaRGB},.3)`
      elipse(solX, solY, height * 0.034, height * 0.034)

      // As nuvens correm com a curva, mais devagar que a serra por estarem
      // ainda mais longe.
      for (const [fx, fy, escala] of NUVENS) {
        desenharNuvem(width * fx + desvio * 0.22, height * fy + subida * 0.4, escala)
      }

      // Duas cordilheiras: a de trás mais alta, já lavada pela cor do céu, e a
      // da frente em tom cheio. É a diferença entre as duas que dá fundo ao
      // fundo, em vez de uma silhueta só recortada contra o azul.
      desenharSerra(serraLonge[3], 0.27, 0.05, 0.008, 1.9, desvio * 0.5, subida)
      desenharSerra(serraLonge[1], 0.27, 0.05, 0.008, 1.9, desvio * 0.5, subida + height * 0.018)
      desenharSerra(serra[3], 0.31, 0.035, 0.017, race.progress * 0.0005, desvio, subida)
      desenharSerra(serra[1], 0.31, 0.035, 0.017, race.progress * 0.0005, desvio, subida + height * 0.014)

      ctx.fillStyle = ambiente.chao
      ctx.fillRect(0, height * 0.38, width, height)

      // A faixa de meio-campo vem por último, apoiada no chão distante: é o
      // degrau que faltava entre a montanha e a grama. Corre mais depressa que
      // a serra e mais devagar que as árvores da beira, e é essa diferença de
      // velocidade que dá a leitura de camadas.
      desenharFaixaDeFundo(
        ctx, ambiente.lugar, corDaFaixa,
        width, height * 0.4 + subida * 0.8, height * 0.1, desvio * 1.7,
      )
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

    /** Objetos reaproveitados pelo cenário: o laço não pode alocar. */
    const cenario = createSceneryItem()
    const portico = createGantry()

    // Poses reaproveitadas entre quadros, pelo mesmo motivo.
    const poseDoJogador: CarPose = { tilt: 0, suspension: 0, steer: 0, boost: 0, jitter: 0, travel: 0, dirt: 0 }
    const poseDoFantasma: CarPose = { tilt: 0, suspension: 0, steer: 0, boost: 0, jitter: 0, travel: 0, dirt: 0 }

    /** Última posição lateral conhecida do rival, para derivar o esterço dele. */
    let lateralDoFantasma = 0
    const aproximarFantasma = (alvo: number, dt: number) =>
      poseDoFantasma.steer + (alvo - poseDoFantasma.steer) * (1 - Math.exp(-Math.max(0, dt) / 0.18))

    const elipse = (x: number, y: number, rx: number, ry: number) => {
      ctx.beginPath()
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
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
        // Longe demais para render qualquer coisa legível: sairia um pixel
        // sujo, e sob a bruma nem isso. O corte era 6, e deixava passar
        // objetos de três pixels que custavam a passada inteira do laço.
        if (referencia < 14) continue
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

        // O pórtico vem antes do que fica na beira desta mesma vaga: ele está
        // atravessando a pista, atrás da árvore que cresce ao lado dela.
        if (indice % GANTRY_EVERY === 0 && layout.gantry(indice, portico)) {
          // A crista esconde o arco inteiro um pouco antes de escondê-lo pela
          // base. Sem a folga, um arco de largura de tela pisca na lomba.
          if (!atrasDaLomba(Math.min(VIEW_DISTANCE - 1, ahead + 8))) {
            desenharPortico(ctx, projetado, portico.variant, nitidez)
          }
        }

        for (const lado of LADOS) {
          if (!layout.scenery(indice, lado, cenario)) continue
          const x = projetado.center + lateralOffset(cenario.lateral, referencia)
          const tamanho = referencia * cenario.scale

          if (cenario.kind === 'fence' || cenario.kind === 'guardrail') {
            /**
             * A cerca é a única família que continua procedural.
             *
             * O vão cobre metade do espaçamento para cada lado, e é assim que
             * as travessas de vagas vizinhas se encontram e a cerca sai
             * contínua. Isso depende das projeções das **duas** vagas, que
             * diferem: assada numa célula por vaga, ela viraria uma fila de
             * portõezinhos soltos.
             */
            const metal = cenario.kind === 'guardrail'
            const tons = metal ? GUARDRAIL : CERCA
            // O guardrail é mais baixo que a cerca e tem uma lâmina só, larga.
            const altura = tamanho * (metal ? 0.042 : 0.058)
            const vao = referencia * 0.055
            const travessa = Math.max(1, altura * (metal ? 0.22 : 0.07))
            const poste = Math.max(1, altura * 0.14)
            ctx.fillStyle = SOMBRA_NO_CHAO
            ctx.fillRect(x - poste * 0.6, projetado.y, poste * 1.8, Math.max(1, travessa * 0.5))
            // As travessas primeiro e o mourão por cima: é assim que o mourão
            // parece estar deste lado da cerca, e não embutido nela.
            const alturas = metal ? [0.86] : [0.94, 0.52]
            for (const parte of alturas) {
              ctx.fillStyle = tons[1]
              ctx.fillRect(x - vao, projetado.y - altura * parte, vao * 2, travessa)
              ctx.fillStyle = tons[3]
              ctx.fillRect(x - vao, projetado.y - altura * parte, vao * 2, Math.max(1, travessa * 0.35))
              if (!metal) continue
              // Vinco central da lâmina, que é o que faz o perfil em W.
              ctx.fillStyle = tons[0]
              ctx.fillRect(x - vao, projetado.y - altura * parte + travessa * 0.45, vao * 2, Math.max(1, travessa * 0.2))
            }
            ctx.fillStyle = tons[2]
            ctx.fillRect(x - poste / 2, projetado.y - altura, poste, altura)
            ctx.fillStyle = tons[4]
            ctx.fillRect(x - poste / 2, projetado.y - altura, Math.max(1, poste * 0.35), altura)
            continue
          }

          // Todo o resto sai da folha, com uma chamada só. A altura de cada
          // família é a mesma de antes; o que mudou é de onde vem o desenho.
          desenharObjeto(
            ctx, cenario.kind, cenario.variant, Math.floor(cenario.tone * 3),
            x, projetado.y, tamanho * ALTURA_DA_FAMILIA[cenario.kind],
          )
        }

        // Marcador de distância: cai em toda vaga par, porque o espaçamento do
        // cenário é metade do dele. Fica no mesmo laço para a ordem de
        // profundidade valer para tudo o que está na beira da pista.
        if (indice % 2 === 0) {
          const alto = isTallMarker(indice / 2)
          // A caixa do modelo vai do chão ao alto da cabeça, e o poste ocupa
          // 78% dela: dividir devolve ao poste a mesma altura de antes.
          const altura = (referencia * (alto ? 0.2 : 0.115)) / 0.78
          for (const lado of LADOS) {
            const x = projetado.center + lateralOffset(ROADSIDE_LATERAL * lado, referencia)
            desenharObjeto(ctx, 'marcador', alto ? 1 : 0, 0, x, projetado.y, altura)
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
      poseDoFantasma.travel = race.progress + distanceAhead
      poseDoFantasma.tilt = poseDoFantasma.steer * 0.075 * forcaDoMovimento

      drawCar(ctx, x, projected.y, scale, rivalCarRef.current ?? DEFAULT_CAR, poseDoFantasma, faded ? 0.23 : 0.46, ambiente.nevoaRGB)
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
      // Um caso por tipo, sem saída padrão. A versão anterior era uma cadeia
      // de `if` com a poeira no `else` do fim: um tipo novo cairia calado em
      // poeira e ninguém ia notar até ver nuvem bege onde devia haver outra
      // coisa. Aqui ele para o compilador.
      switch (particle.kind) {
        case 'skid':
          // A marca escurece o asfalto e vai sumindo, como borracha queimada.
          ctx.globalAlpha = 0.55 * fade
          ctx.fillStyle = particle.tint
          ctx.fillRect(x - size / 2, projected.y, Math.max(1.5, size), Math.max(1.5, size * 0.8))
          break
        case 'spark':
          ctx.globalAlpha = fade
          ctx.fillStyle = fade > 0.5 ? FAISCA_QUENTE : particle.tint
          ctx.translate(x, y)
          ctx.rotate(particle.spin * (particle.maxLife - particle.life))
          ctx.fillRect(-size / 2, -size / 2, size, size)
          break
        case 'boost':
          ctx.globalAlpha = 0.55 * fade
          ctx.fillStyle = particle.tint
          ctx.fillRect(x - size / 2, y, size, Math.max(1, size * 1.6))
          break
        case 'dust':
          ctx.globalAlpha = 0.42 * fade
          ctx.fillStyle = particle.tint
          ctx.beginPath()
          ctx.arc(x, y, Math.max(1, size * (1.4 - fade * 0.6)), 0, Math.PI * 2)
          ctx.fill()
          break
        default:
          particle.kind satisfies never
      }
      ctx.restore()
    }

    /**
     * Rajadas de velocidade no boost.
     *
     * Riscos correndo para fora a partir do ponto de fuga: é o recurso de
     * arcade de sempre para dizer "rápido" sem mexer em nada da física. Só
     * aparecem no boost, nunca no meio da tela — ali tapariam a pista —, e a
     * fase vem dos metros percorridos, não do número do quadro, para a rajada
     * parar quando o carro para e não acelerar quando a taxa de quadros varia.
     */
    const desenharRajadas = (forca: number, percorrido: number) => {
      if (forca <= 0.02) return
      const centroX = width / 2
      const centroY = height * HORIZON_RATIO
      const alcance = Math.hypot(width, height) * 0.62
      const fase = ((percorrido * 0.35) % 1 + 1) % 1
      ctx.save()
      ctx.strokeStyle = '#e9f3ff'
      ctx.lineWidth = Math.max(1, width * 0.002)
      ctx.globalAlpha = 0.2 * forca
      ctx.beginPath()
      for (let i = 0; i < ANGULOS_DE_RAJADA.length; i += 1) {
        const angulo = ANGULOS_DE_RAJADA[i]
        const avanco = (i / ANGULOS_DE_RAJADA.length + fase) % 1
        const dentro = alcance * (0.34 + avanco * 0.58)
        const fora = dentro + alcance * (0.04 + avanco * 0.1)
        const cosseno = Math.cos(angulo)
        const seno = Math.sin(angulo)
        ctx.moveTo(centroX + cosseno * dentro, centroY + seno * dentro)
        ctx.lineTo(centroX + cosseno * fora, centroY + seno * fora)
      }
      ctx.stroke()
      ctx.restore()
    }

    /** Escala de tela do carro, que é a régua de tudo que anda sobre o asfalto. */
    const escalaDoCarro = () => Math.max(0.76, width / CAR_SPRITE_REFERENCE_WIDTH)

    /**
     * Carga vertical do relevo, para a suspensão.
     *
     * Não é a inclinação: subida constante não empurra ninguém para baixo. O
     * que carrega ou alivia a suspensão é a **mudança** de inclinação — o
     * fundo de uma depressão, onde a pista para de descer e começa a subir,
     * comprime; a crista de uma lomba alivia. É por isso que a conta é uma
     * diferença entre dois pontos em volta do carro, e não `layout.slope`
     * lido direto, que já alimenta o fundo e não serviria aqui.
     *
     * A janela é de doze metros para cada lado porque o relevo é montado em
     * trechos de cento e cinquenta e cinco: menor que isso a conta só pega
     * ruído da interpolação, e muito maior atravessa a lomba inteira e sai
     * quase zero justamente onde o efeito deveria ser máximo.
     */
    const JANELA_DO_RELEVO = 12
    const RELEVO_NA_SUSPENSAO = 34
    const cargaDoRelevo = () => {
      const atras = layout.slope(Math.max(0, race.progress - JANELA_DO_RELEVO))
      const adiante = layout.slope(race.progress + JANELA_DO_RELEVO)
      return ((adiante - atras) / (JANELA_DO_RELEVO * 2)) * RELEVO_NA_SUSPENSAO
    }

    const drawObstacle = (distanceAhead: number, lane: number, kind: ObstacleKind, id: number) => {
      const projected = roadGeometry(distanceAhead)
      const closeness = Math.max(0, 1 - distanceAhead / VIEW_DISTANCE)
      // A mesma escala de tela do carro. Sem ela o obstáculo tinha teto fixo
      // de 53 px enquanto o carro crescia com a largura da janela: numa tela
      // larga a barreira ficava minúscula ao lado do carro que ela para.
      const size = (5 + Math.pow(closeness, 1.5) * 48) * escalaDoCarro()
      // Pela mesma conta de todo o resto. Antes era um 0,39 solto aqui, e o
      // obstáculo aparecia 8% mais para fora do que a colisão considerava.
      const x = projected.center + lateralOffset(lane, projected.roadWidth)
      const y = projected.y

      /**
       * Um caso por tipo, e nenhuma saída padrão.
       *
       * As duas peças que ficam de pé saem da folha, como o resto do cenário:
       * eram os últimos desenhos ao vivo sobre o chão e os únicos que
       * escapavam do banho de névoa da folha, e em cor cheia apareciam
       * recortados de outra cena à medida que a pista escurecia. As três que
       * ficam deitadas continuam procedurais, porque a convenção de caixa da
       * folha — chão em zero, topo em menos um — não descreve peça sem altura.
       *
       * O tamanho de cada uma sai de `size`, na proporção da meia-largura de
       * colisão do tipo: a mancha de óleo pega o dobro de pista que um buraco,
       * e precisa parecer que pega.
       *
       * A variante da barreira sai do identificador do obstáculo, que é
       * literal em `track.ts`: os dois pilotos veem a mesma no mesmo lugar.
       */
      switch (kind) {
        case 'barrier':
          desenharObjeto(ctx, 'barreira', id, 0, x, y, size * 0.52)
          break
        case 'debris':
          desenharObjeto(ctx, 'cone', 0, 0, x, y, size * 1.08)
          break
        case 'pothole':
          desenharBuraco(ctx, x, y, size, buraco)
          break
        case 'oleo':
          desenharOleo(ctx, x, y, size)
          break
        case 'poca':
          desenharPoca(ctx, x, y, size, buraco, ambiente.ceuBaixo)
          break
        default:
          // Sem isto, um tipo novo cairia calado no ramo de outro. Aqui ele
          // para o compilador, que é onde se quer que pare.
          kind satisfies never
      }
    }

    const draw = (frame: number) => {
      const serverNow = clockRef.current()
      const dt = (frame - previous) / 1000
      previous = frame

      // Posição do fantasma neste quadro, já interpolada. É lida antes da
      // simulação porque agora o rival não é só desenho: a esteira dele entra
      // no passo de física como ganho de velocidade.
      const rivalSample = ghostRef.current?.sample(serverNow) ?? null

      if (startedRef.current && !doneRef.current) {
        const elapsed = Math.max(0, (serverNow - startAt) / 1000)
        // O que o carro não sabe por si: a curva sob ele e a esteira do rival.
        // A curvatura vem do mesmo traçado que está sendo desenhado, então o
        // empurrão que o piloto sente é o da curva que ele está vendo. Quem já
        // chegou está parado na linha e não deixa mais esteira.
        raceContext.curvature = curvatureLoad(layout.curvature(race.progress))
        raceContext.slipstream =
          rivalSample && rivalSample.state === 'racing'
            ? slipstreamFrom(race.progress, race.lateral, rivalSample.progress, rivalSample.lateral)
            : 0
        for (const event of stepRace(race, inputRef.current, dt, raceContext)) {
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
            tint: poeira,
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
        // A carga da curva entra junto: no limite de aderência o pneu raspa, e
        // é esse o retorno visual de que a curva está cobrando a velocidade
        // escolhida. Começa onde o pneu começa a escapar, não antes.
        const limiar = race.rules.cornerGrip
        const raspagem = Math.max(0, (feel.corner - limiar) / (1 - limiar))
        const forcaDerrapagem = Math.max(feel.offRoad, feel.strain, raspagem, race.penalty > 0 ? 1 : 0)
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
            slipstream: feel.slipstream,
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
        drawObstacle(ahead, obstaculo.lane, obstaculo.kind, obstaculo.id)
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

      /**
       * A linha de chegada.
       *
       * Era doze células num retângulo de cinco pixels — a superfície mais
       * pobre do jogo, no momento que mais importa dele. Agora é uma
       * estrutura: duas fileiras de quadriculado com espessura no asfalto, e o
       * pórtico por cima, que é o que se enxerga de longe e o que diz onde a
       * prova acaba.
       */
      const ateAChegada = TRACK_LENGTH - race.progress
      if (ateAChegada < VIEW_DISTANCE && !atrasDaLomba(ateAChegada)) {
        const finish = roadGeometry(ateAChegada)
        const espessura = Math.max(3, finish.roadWidth * 0.026)
        const casas = 14
        const passo = finish.roadWidth / casas
        const esquerda = finish.center - finish.roadWidth / 2
        // Duas fileiras defasadas: é a espessura que tira a chegada de uma
        // listra pintada e a põe deitada no asfalto.
        for (let fileira = 0; fileira < 2; fileira += 1) {
          for (let i = 0; i < casas; i += 1) {
            ctx.fillStyle = (i + fileira) % 2 === 0 ? '#f3f3ed' : '#11151a'
            ctx.fillRect(esquerda + i * passo, finish.y + fileira * espessura, passo + 1, espessura + 1)
          }
        }
        desenharPortico(ctx, finish, 0, 1, true)
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
        // no esterço, a suspensão reage à arrancada e ao impacto, as rodas da
        // frente seguem o volante e a carroceria treme na grama. Quem pediu
        // menos movimento recebe tudo isso — inclusive o rolamento do pneu —
        // no quarto da intensidade.
        // A rolagem tem duas parcelas: a de regime, que segue o volante, e a
        // transferência de peso do giro — quando o volante é jogado depressa,
        // a carroceria passa do ponto antes de assentar. `steerRate` traz a
        // pressa e `steer` traz o lado, e é por isso que os dois se
        // multiplicam em vez de somar.
        poseDoJogador.tilt =
          (feel.steer * 0.075 + feel.steer * feel.steerRate * 0.02) * forcaDoMovimento
        poseDoJogador.suspension =
          (feel.accel * 0.05 - feel.impact * 0.1 + cargaDoRelevo() * feel.speed) * forcaDoMovimento
        poseDoJogador.steer = feel.steer * forcaDoMovimento
        poseDoJogador.boost = feel.boost
        poseDoJogador.travel = race.progress * forcaDoMovimento
        poseDoJogador.dirt = feel.dirt
        // Três tremores, com frequências separadas para não virarem um só: a
        // grama, o tranco da batida e o carro no limite de aderência. O do
        // limite é o mais rápido e o menor — é vibração, não solavanco.
        poseDoJogador.jitter =
          (feel.offRoad * Math.sin(frame * 0.055) * 1.6 +
            feel.impact * Math.sin(frame * 0.085) * 2.4 +
            feel.strain * Math.sin(frame * 0.21) * 0.7) *
          forcaDoMovimento
        drawCar(
          ctx,
          playerX,
          ondeEstaOCarro.y,
          escalaDoCarro(),
          carRef.current,
          poseDoJogador,
          1,
          ambiente.nevoaRGB,
        )
      }

      desenharRajadas(feel.boost * forcaDoMovimento, race.progress)

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
  /** Ganho máximo do vácuo nesta dificuldade, para o HUD mostrar em km/h. */
  const bonusDoVacuo = rulesFor(difficulty).slipstreamBonus

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
        <div className="pilot-tag">
          <span>PILOTO</span>
          {pilotName}
          <em style={{ color: carById(car).accent }}>{carById(car).team} #{carById(car).number}</em>
        </div>
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

      {/* O vácuo só existe com rival na pista, e só aparece quando rende algo:
          um medidor parado em zero durante toda a prova seria ruído no HUD. */}
      {mode === 'online' && phase === 'racing' && telemetry.slipstream > 0.04 && (
        <div className="slipstream-meter">
          <div className="boost-copy">
            <span>VÁCUO</span>
            <b>+{Math.round(telemetry.slipstream * bonusDoVacuo)} KM/H</b>
          </div>
          <div className="boost-track">
            <i style={{ width: `${Math.round(telemetry.slipstream * 100)}%` }} />
          </div>
        </div>
      )}

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
