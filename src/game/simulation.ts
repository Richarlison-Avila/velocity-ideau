// A extensão .js é exigida pelo Node, que roda este módulo no servidor durante
// os testes de aceitação. O Vite resolve para o arquivo .ts normalmente.
import {
  LATERAL_LIMIT,
  obstacles,
  OFF_ROAD_LIMIT,
  speedForState,
  trackCurvature,
  TRACK_LENGTH,
} from './track.js'

// Os limites laterais são geometria da pista, e ficam definidos junto dela para
// o desenho, a simulação e o servidor nunca divergirem.
export { LATERAL_LIMIT, OFF_ROAD_LIMIT } from './track.js'

export type RaceInput = { left: boolean; right: boolean; boost: boolean }

export type RaceState = {
  /** Distância percorrida no circuito, em metros. */
  progress: number
  /** Posição entre os limites da pista, de -1.28 a 1.28. */
  lateral: number
  speed: number
  boost: number
  penalty: number
  collisions: number
  topSpeed: number
  offRoad: boolean
  boosting: boolean
  /** Bloqueio após esgotar o boost: evita o liga-desliga a cada quadro. */
  boostLocked: boolean
  /** Força do vácuo aproveitada neste passo, de 0 a 1. */
  slipstream: number
  /** Carga lateral imposta pela curva neste passo, de 0 a 1. */
  cornerLoad: number
  finished: boolean
  hitObstacles: Set<number>
}

export type RaceEvent = { type: 'collision'; obstacleId: number } | { type: 'finish' }

/** Duração fixa da penalidade após um impacto, em segundos. */
export const PENALTY_SECONDS = 1.65
/** Maior passo de simulação aceito, protege contra abas em segundo plano. */
export const MAX_STEP_SECONDS = 0.05
/** Carga mínima para voltar a usar o boost depois de esgotá-lo. */
export const BOOST_UNLOCK = 25
/** Rapidez com que o carro ganha velocidade em direção ao alvo. */
export const ACCELERATION_RATE = 1.8
/** Perder velocidade é mais rápido que ganhar: impacto e grama pesam. */
export const DECELERATION_RATE = 5

/**
 * Velocidade em que a carga da curva é a própria curvatura da pista.
 *
 * Acima dela a mesma curva pesa mais, abaixo pesa menos, sempre ao quadrado da
 * razão. É a velocidade normal do carro, tirada da própria tabela de
 * velocidades para não virar um número solto que envelhece quando o carro é
 * reajustado.
 */
export const CENTRIFUGAL_REFERENCE_SPEED = speedForState(false, 0, false)

/**
 * Quanto do que escapa à aderência vira deslocamento, em unidades de posição
 * por segundo.
 *
 * Multiplica apenas o excedente, não a carga inteira — a parte que o pneu
 * segura não desloca o carro. Os percentuais de esterço que este valor produz
 * estão documentados em `CORNER_GRIP`, que é o limiar de onde o excedente sai.
 */
export const CORNER_PUSH = 1.15

/**
 * Aderência lateral dos pneus, na mesma escala da carga da curva.
 *
 * O pneu segura sozinho uma parte da curva: só o que passa deste limite
 * escapa e empurra o carro para fora. Sem isso qualquer curvatura, por menor
 * que fosse, arrastava o carro, e um piloto que não corrigisse a cada quadro
 * terminava a prova inteira na grama — o que é punição, não jogo.
 *
 * Com 0.55, na velocidade normal 41% do traçado pede correção e o pior ponto
 * consome 24% do esterço; com boost são 67% do traçado e 53% do esterço. Ou
 * seja: o traçado tem retas e curvas de verdade, e a velocidade escolhida é
 * que decide quanto do comando sobra para escolher a faixa.
 */
export const CORNER_GRIP = 0.55

/** Alcance do vácuo, em metros atrás do rival. */
export const SLIPSTREAM_RANGE_M = 42
/** Diferença lateral a partir da qual o vácuo deixa de existir. */
export const SLIPSTREAM_WIDTH = 0.55

/**
 * Força do vácuo deixado pelo rival, de 0 a 1.
 *
 * É o que dá sentido mecânico à presença do adversário: antes disso o fantasma
 * era só uma imagem, e uma corrida on-line era duas provas solo sobrepostas.
 * Agora colar no rival rende velocidade, e ultrapassá-lo custa esse ganho —
 * pois o vácuo desaparece no instante em que o carro passa à frente.
 *
 * Só é aproveitado por quem vem atrás, alinhado com quem vai na frente, e
 * cresce à medida que a distância diminui.
 */
export function slipstreamFrom(
  playerProgress: number,
  playerLateral: number,
  rivalProgress: number,
  rivalLateral: number,
) {
  const atras = rivalProgress - playerProgress
  // As comparações são escritas para que qualquer NaN caia no retorno zero.
  if (!(atras > 0) || !(atras < SLIPSTREAM_RANGE_M)) return 0
  const alinhamento = 1 - Math.abs(rivalLateral - playerLateral) / SLIPSTREAM_WIDTH
  if (!(alinhamento > 0)) return 0
  return (1 - atras / SLIPSTREAM_RANGE_M) * alinhamento
}

export function createRaceState(): RaceState {
  return {
    progress: 0,
    lateral: 0,
    speed: 0,
    boost: 100,
    penalty: 0,
    collisions: 0,
    topSpeed: 0,
    offRoad: false,
    boosting: false,
    boostLocked: false,
    slipstream: 0,
    cornerLoad: 0,
    finished: false,
    hitObstacles: new Set<number>(),
  }
}

/**
 * Avança a simulação em `dt` segundos e devolve os eventos ocorridos no passo.
 *
 * A aceleração é automática: o piloto controla apenas direção e boost. O
 * `slipstream` vem de fora, calculado com a posição do rival, porque a
 * simulação de cada carro não conhece o outro — quem sabe onde está o
 * adversário é a camada que recebe a telemetria.
 */
export function stepRace(
  state: RaceState,
  input: RaceInput,
  dt: number,
  slipstream = 0,
): RaceEvent[] {
  const events: RaceEvent[] = []
  if (state.finished) return events

  const step = Math.min(Math.max(0, dt), MAX_STEP_SECONDS)
  if (step === 0) return events

  const steer = Number(input.right) - Number(input.left)

  // Força lateral da curva.
  //
  // A curva deixou de ser enfeite: aqui a pista passa a cobrar. O carro é
  // jogado para fora, e segurá-lo gasta esterço que deixa de estar disponível
  // para escolher a faixa — é o que cria linha de corrida, erro de entrada e
  // diferença de ritmo entre dois pilotos. Cresce com o quadrado da
  // velocidade, como a força centrífuga real, então é a velocidade que decide
  // se a mesma curva é tranquila ou está no limite.
  const proporcao = state.speed / CENTRIFUGAL_REFERENCE_SPEED
  const carga = trackCurvature(state.progress) * proporcao * proporcao
  // O pneu segura a carga até o limite de aderência; o que passa disso é o que
  // de fato escapa. Curva à direita joga o carro para a esquerda, daí o sinal.
  const escapa = Math.max(0, Math.abs(carga) - CORNER_GRIP)
  const empurrao = -Math.sign(carga) * escapa * CORNER_PUSH
  state.cornerLoad = Math.min(1, Math.abs(carga))

  const esterco = steer * (1.35 + state.speed / 520)
  state.lateral = clamp(state.lateral + (esterco + empurrao) * step, -LATERAL_LIMIT, LATERAL_LIMIT)
  state.offRoad = Math.abs(state.lateral) > OFF_ROAD_LIMIT
  if (state.boostLocked && state.boost >= BOOST_UNLOCK) state.boostLocked = false
  state.boosting = input.boost && state.boost > 0 && !state.boostLocked && !state.offRoad && state.penalty <= 0
  state.boost = clamp(state.boost + (state.boosting ? -25 : 5.5) * step, 0, 100)
  if (state.boost <= 0) state.boostLocked = true
  state.penalty = Math.max(0, state.penalty - step)
  state.slipstream = Number.isFinite(slipstream) ? clamp(slipstream, 0, 1) : 0

  const targetSpeed = speedForState(state.offRoad, state.penalty, state.boosting, state.slipstream)
  // A aproximação exponencial dá o mesmo resultado em qualquer taxa de quadros.
  // Com o fator linear anterior, um aparelho de 20 quadros por segundo chegava
  // a uma velocidade 3% diferente de um de 60 durante as transições — e em um
  // duelo isso é vantagem de hardware.
  const taxa = targetSpeed < state.speed ? DECELERATION_RATE : ACCELERATION_RATE
  state.speed += (targetSpeed - state.speed) * (1 - Math.exp(-step * taxa))
  state.progress = Math.min(TRACK_LENGTH, state.progress + (state.speed / 3.6) * step)
  state.topSpeed = Math.max(state.topSpeed, state.speed)

  for (const obstacle of obstacles) {
    const delta = obstacle.distance - state.progress
    if (delta <= -5 || delta >= 8) continue
    if (Math.abs(state.lateral - obstacle.lane) >= 0.25) continue
    if (state.hitObstacles.has(obstacle.id)) continue
    state.hitObstacles.add(obstacle.id)
    state.collisions += 1
    state.penalty = PENALTY_SECONDS
    events.push({ type: 'collision', obstacleId: obstacle.id })
  }

  if (state.progress >= TRACK_LENGTH) {
    state.finished = true
    events.push({ type: 'finish' })
  }

  return events
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}
