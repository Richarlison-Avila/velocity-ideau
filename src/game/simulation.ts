// A extensão .js é exigida pelo Node, que roda este módulo no servidor durante
// os testes de aceitação. O Vite resolve para o arquivo .ts normalmente.
import { LATERAL_LIMIT, obstacles, OFF_ROAD_LIMIT, speedForState, TRACK_LENGTH } from './track.js'

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
    finished: false,
    hitObstacles: new Set<number>(),
  }
}

/**
 * Avança a simulação em `dt` segundos e devolve os eventos ocorridos no passo.
 * A aceleração é automática: o piloto controla apenas direção e boost.
 */
export function stepRace(state: RaceState, input: RaceInput, dt: number): RaceEvent[] {
  const events: RaceEvent[] = []
  if (state.finished) return events

  const step = Math.min(Math.max(0, dt), MAX_STEP_SECONDS)
  if (step === 0) return events

  const steer = Number(input.right) - Number(input.left)
  state.lateral = clamp(state.lateral + steer * step * (1.35 + state.speed / 520), -LATERAL_LIMIT, LATERAL_LIMIT)
  state.offRoad = Math.abs(state.lateral) > OFF_ROAD_LIMIT
  if (state.boostLocked && state.boost >= BOOST_UNLOCK) state.boostLocked = false
  state.boosting = input.boost && state.boost > 0 && !state.boostLocked && !state.offRoad && state.penalty <= 0
  state.boost = clamp(state.boost + (state.boosting ? -25 : 5.5) * step, 0, 100)
  if (state.boost <= 0) state.boostLocked = true
  state.penalty = Math.max(0, state.penalty - step)

  const targetSpeed = speedForState(state.offRoad, state.penalty, state.boosting)
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
