// A extensão .js é exigida pelo Node, que roda este módulo no servidor durante
// os testes de aceitação. O Vite resolve para o arquivo .ts normalmente.
import { rulesFor, type Difficulty, type RaceRules } from './rules.js'
import { HIT_HALF_WIDTH, HIT_PENALTY_SHARE, LATERAL_LIMIT, OFF_ROAD_LIMIT, TRACK_LENGTH } from './track.js'

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
  /**
   * Posição do volante, de -1 a 1. Persegue o comando com inércia em vez de
   * saltar para ele, e é o que move o carro de fato.
   */
  steerInput: number
  /**
   * Quanto o volante andou no passado recente, com esquecimento.
   *
   * Uma correção de curva mexe pouco e some; um zigue-zague sustentado
   * acumula. É daqui que sai a perda de aderência.
   */
  agitation: number
  /** Aderência de 0 a 1, derivada da agitação. Multiplica a velocidade-alvo. */
  grip: number
  finished: boolean
  hitObstacles: Set<number>
  /**
   * Regras da corrida, fixadas na largada.
   *
   * Viajam dentro do estado de propósito: a dificuldade é decidida pela sala
   * antes da prova começar e não muda no meio dela. Quem simula não precisa
   * receber a dificuldade por fora, e não há como um trecho do código usar um
   * conjunto de regras e outro trecho usar outro.
   */
  rules: RaceRules
}

export type RaceEvent = { type: 'collision'; obstacleId: number } | { type: 'finish' }

/** Maior passo de simulação aceito, protege contra abas em segundo plano. */
export const MAX_STEP_SECONDS = 0.05
/** Carga mínima para voltar a usar o boost depois de esgotá-lo. */
export const BOOST_UNLOCK = 25

/**
 * Passo fixo da integração, em segundos.
 *
 * A curva de tração não tem solução fechada, então ela é integrada em passos
 * curtos e sempre do mesmo tamanho. Sem isso, um aparelho de 20 quadros por
 * segundo chegaria a uma velocidade diferente de um de 60 — e num duelo isso
 * é vantagem de hardware. 60, 30 e 20 quadros por segundo são múltiplos
 * exatos deste passo, então os três percorrem a mesma sequência.
 */
export const PHYSICS_STEP = 1 / 120

/**
 * Aceleração com o carro parado, em km/h por segundo.
 *
 * A arrancada é forte, mas o ganho cede conforme a velocidade sobe — é o
 * oposto da aproximação exponencial anterior, que gastava quase tudo no
 * primeiro instante e colocava o carro perto de 200 km/h em menos de um
 * segundo, sem nenhuma progressão para o olho acompanhar.
 */
export const ACCELERATION_PEAK = 62

/**
 * Expoente da curva de tração.
 *
 * Com 4, a aceleração fica quase constante até dois terços da velocidade-alvo
 * e só então cede. É o que dá a sensação de ganho progressivo em vez de um
 * salto seguido de estagnação.
 */
export const ACCELERATION_SHAPE = 4

/**
 * Empurrão extra do boost sobre a tração.
 *
 * Sem ele o boost virava uma promessa: a velocidade-alvo subia para 314, mas
 * a carga acabava antes de o carro chegar perto disso. Com o empurrão, a
 * arrancada do boost é sentida na hora e a vantagem volta à faixa combinada.
 */
export const BOOST_TRACTION = 1.5

/** Perder velocidade é mais rápido que ganhar: a grama pesa. */
export const DECELERATION_RATE = 5

/** No impacto a queda é quase instantânea, e não uma frenagem suave. */
export const IMPACT_DECELERATION = 16

/** Deslocamento lateral por segundo com o volante todo virado, parado. */
export const STEER_RATE = 1.35

/** Inércia do volante, em segundos. Curto: não atrasa o comando, dá peso. */
export const STEER_TAU = 0.1

/** Tempo de esquecimento da agitação do volante, em segundos. */
export const AGITATION_TAU = 1

/**
 * Faixa de agitação entre a primeira perda e a perda máxima.
 *
 * A zona morta e a perda máxima mudam com a dificuldade; a largura da rampa
 * entre elas não, para o volante responder com a mesma forma nos três níveis.
 */
export const AGITATION_RANGE = 3.4

export function createRaceState(difficulty: Difficulty = 'normal'): RaceState {
  return {
    rules: rulesFor(difficulty),
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
    steerInput: 0,
    agitation: 0,
    grip: 1,
    finished: false,
    hitObstacles: new Set<number>(),
  }
}

/** Aderência disponível para uma dada agitação do volante. */
export function gripFor(agitation: number, rules: RaceRules) {
  const excesso = (agitation - rules.agitationDeadband) / AGITATION_RANGE
  return 1 - clamp(excesso, 0, 1) * rules.maxGripLoss
}

/**
 * Velocidade que o carro persegue neste instante.
 *
 * Parte da tabela de estados — que é o contrato com o servidor — e aplica
 * sobre ela as perdas contínuas: o quanto o carro se embrenhou na grama e o
 * quanto vem maltratando o volante.
 */
export function targetSpeedFor(state: RaceState) {
  const base = speedForState(state.offRoad, state.penalty, state.boosting, state.rules)
  if (!state.offRoad) return base * state.grip
  const profundidade = clamp((Math.abs(state.lateral) - OFF_ROAD_LIMIT) / (LATERAL_LIMIT - OFF_ROAD_LIMIT), 0, 1)
  return base * (1 - profundidade * state.rules.offRoadDepthLoss) * state.grip
}

/**
 * Velocidade que o carro persegue em cada estado, para um conjunto de regras.
 *
 * É o contrato que o servidor usa para saber o tempo mínimo plausível da
 * prova, e por isso mora junto das regras e não dentro do laço de simulação.
 */
export function speedForState(offRoad: boolean, penalty: number, boosting: boolean, rules: RaceRules) {
  if (offRoad) return rules.offRoadSpeed
  if (penalty > 0) return rules.penaltySpeed
  if (boosting) return rules.boostSpeed
  return rules.cruiseSpeed
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

  const comando = Number(input.right) - Number(input.left)

  let restante = step
  while (restante > 1e-9) {
    const h = Math.min(PHYSICS_STEP, restante)
    restante -= h

    // O volante tem inércia, e o esforço lateral é o quanto ele andou. Medir
    // o curso do volante — e não a posição do carro na pista — é o que separa
    // a correção necessária numa curva do zigue-zague deliberado.
    const antesDoGiro = state.steerInput
    state.steerInput += (comando - antesDoGiro) * (1 - Math.exp(-h / STEER_TAU))
    state.agitation = state.agitation * Math.exp(-h / AGITATION_TAU) + Math.abs(state.steerInput - antesDoGiro)
    state.grip = gripFor(state.agitation, state.rules)

    state.lateral = clamp(
      state.lateral + state.steerInput * h * (STEER_RATE + state.speed / 520),
      -LATERAL_LIMIT,
      LATERAL_LIMIT,
    )
    state.offRoad = Math.abs(state.lateral) > OFF_ROAD_LIMIT

    if (state.boostLocked && state.boost >= BOOST_UNLOCK) state.boostLocked = false
    state.boosting = input.boost && state.boost > 0 && !state.boostLocked && !state.offRoad && state.penalty <= 0
    state.boost = clamp(
      state.boost + (state.boosting ? -state.rules.boostDrain : state.rules.boostRecharge) * h,
      0,
      100,
    )
    if (state.boost <= 0) state.boostLocked = true
    state.penalty = Math.max(0, state.penalty - h)

    const alvo = targetSpeedFor(state)
    if (alvo > state.speed) {
      // Tração: forte na saída, cedendo perto do teto.
      const fracao = state.speed / Math.max(1, alvo)
      const tracao = ACCELERATION_PEAK * (state.boosting ? BOOST_TRACTION : 1)
      state.speed = Math.min(alvo, state.speed + tracao * (1 - Math.pow(fracao, ACCELERATION_SHAPE)) * h)
    } else {
      // A perda é exponencial, que é a forma certa para arrasto e frenagem —
      // e tem solução fechada, então não depende do tamanho do passo.
      const taxa = state.penalty > 0 ? IMPACT_DECELERATION : DECELERATION_RATE
      state.speed += (alvo - state.speed) * (1 - Math.exp(-h * taxa))
    }

    state.progress = Math.min(TRACK_LENGTH, state.progress + (state.speed / 3.6) * h)
  }

  state.topSpeed = Math.max(state.topSpeed, state.speed)

  for (const obstacle of state.rules.obstacles) {
    const delta = obstacle.distance - state.progress
    if (delta <= -5 || delta >= 8) continue
    if (Math.abs(state.lateral - obstacle.lane) >= HIT_HALF_WIDTH[obstacle.kind]) continue
    if (state.hitObstacles.has(obstacle.id)) continue
    state.hitObstacles.add(obstacle.id)
    state.collisions += 1
    // Nunca encurta uma penalidade em curso: cair num buraco logo depois de
    // bater numa barreira não pode virar alívio.
    state.penalty = Math.max(
      state.penalty,
      state.rules.penaltySeconds * HIT_PENALTY_SHARE[obstacle.kind],
    )
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
