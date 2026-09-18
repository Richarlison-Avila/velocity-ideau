import { describe, expect, it } from 'vitest'
import {
  createRaceState,
  LATERAL_LIMIT,
  OFF_ROAD_LIMIT,
  PENALTY_SECONDS,
  stepRace,
  type RaceEvent,
  type RaceInput,
  type RaceState,
} from './simulation'
import { obstacles, TRACK_LENGTH } from './track'

const PARADO: RaceInput = { left: false, right: false, boost: false }
const SO_BOOST: RaceInput = { left: false, right: false, boost: true }

type Corrida = { time: number; state: RaceState; events: RaceEvent[] }

function correr(policy: (t: number, state: RaceState) => RaceInput, dt = 1 / 60, limite = 300): Corrida {
  const state = createRaceState()
  const events: RaceEvent[] = []
  let time = 0
  while (!state.finished && time < limite) {
    events.push(...stepRace(state, policy(time, state), dt))
    time += dt
  }
  return { time, state, events }
}

function avancar(state: RaceState, input: RaceInput, segundos: number, dt = 1 / 60) {
  const events: RaceEvent[] = []
  for (let t = 0; t < segundos; t += dt) events.push(...stepRace(state, input, dt))
  return events
}

describe('física e progresso', () => {
  it('acelera sozinha: o piloto controla apenas direção e boost', () => {
    const state = createRaceState()
    avancar(state, PARADO, 2)
    expect(state.speed).toBeGreaterThan(50)
    expect(state.progress).toBeGreaterThan(0)
    expect(state.lateral).toBe(0)
  })

  it('um iniciante em linha reta completa a prova entre 60 e 90 segundos', () => {
    const { time, state } = correr(() => PARADO)
    expect(state.finished).toBe(true)
    expect(time).toBeGreaterThan(60)
    expect(time).toBeLessThan(90)
  })

  it('mantém o mesmo resultado em 60, 30 e 20 quadros por segundo', () => {
    const rapido = correr(() => PARADO, 1 / 60)
    const medio = correr(() => PARADO, 1 / 30)
    const lento = correr(() => PARADO, 0.05)
    expect(Math.abs(rapido.time - medio.time)).toBeLessThan(0.5)
    expect(Math.abs(rapido.time - lento.time)).toBeLessThan(0.5)
  })

  it('nunca ultrapassa a linha de chegada nem termina duas vezes', () => {
    const { state, events } = correr(() => SO_BOOST)
    expect(state.progress).toBe(TRACK_LENGTH)
    expect(events.filter((event) => event.type === 'finish')).toHaveLength(1)

    // Passos extras após a bandeirada não alteram mais nada.
    const antes = { ...state }
    expect(stepRace(state, SO_BOOST, 1 / 60)).toEqual([])
    expect(state.progress).toBe(antes.progress)
    expect(state.collisions).toBe(antes.collisions)
  })
})

describe('limites da pista', () => {
  it('respeita o limite lateral em qualquer velocidade', () => {
    const { state } = correr(() => ({ left: false, right: true, boost: true }))
    expect(state.lateral).toBeLessThanOrEqual(LATERAL_LIMIT)
    expect(state.lateral).toBeGreaterThanOrEqual(-LATERAL_LIMIT)
  })

  it('reduz a velocidade fora da pista sem destruir o carro', () => {
    const state = createRaceState()
    avancar(state, { left: false, right: true, boost: false }, 6)
    expect(state.offRoad).toBe(true)
    expect(state.speed).toBeLessThan(180)
    expect(state.finished).toBe(false)
  })

  it('o carro não fica preso fora da pista', () => {
    const state = createRaceState()
    avancar(state, { left: false, right: true, boost: false }, 6)
    expect(state.offRoad).toBe(true)

    // Corrige a direção até voltar ao asfalto e então segue reto.
    let tempoDeVolta = 0
    for (let t = 0; t < 4 && state.offRoad; t += 1 / 60) {
      stepRace(state, { left: true, right: false, boost: false }, 1 / 60)
      tempoDeVolta = t
    }
    expect(tempoDeVolta).toBeLessThan(1)
    expect(state.offRoad).toBe(false)
    expect(Math.abs(state.lateral)).toBeLessThan(OFF_ROAD_LIMIT)

    avancar(state, PARADO, 3)
    expect(state.speed).toBeGreaterThan(200)
  })

  it('mesmo correndo sempre fora da pista a prova termina', () => {
    const { state, time } = correr(() => ({ left: false, right: true, boost: false }), 1 / 60, 400)
    expect(state.finished).toBe(true)
    expect(time).toBeGreaterThan(90)
  })
})

describe('obstáculos e penalidades', () => {
  it('cada obstáculo aplica no máximo uma colisão', () => {
    const { state, events } = correr(() => PARADO)
    const colisoes = events.filter((event) => event.type === 'collision')
    const ids = colisoes.map((event) => (event.type === 'collision' ? event.obstacleId : 0))
    expect(new Set(ids).size).toBe(ids.length)
    expect(state.collisions).toBe(ids.length)
  })

  it('quem vai pelo centro atinge apenas os obstáculos do centro', () => {
    const { events } = correr(() => PARADO)
    const atingidos = events.flatMap((event) => (event.type === 'collision' ? [event.obstacleId] : []))
    const esperados = obstacles.filter((obstacle) => Math.abs(obstacle.lane) < 0.25).map((obstacle) => obstacle.id)
    expect(atingidos.sort()).toEqual(esperados.sort())
  })

  it('a penalidade tem duração previsível', () => {
    const state = createRaceState()
    avancar(state, PARADO, 3)
    state.penalty = 0
    state.hitObstacles.clear()

    // Posiciona o carro logo antes de um obstáculo central.
    const alvo = obstacles.find((obstacle) => Math.abs(obstacle.lane) < 0.25)!
    state.progress = alvo.distance - 4
    state.lateral = alvo.lane

    const eventos = avancar(state, PARADO, 1 / 30)
    expect(eventos.some((event) => event.type === 'collision')).toBe(true)
    expect(state.penalty).toBeGreaterThan(PENALTY_SECONDS - 0.1)

    avancar(state, PARADO, PENALTY_SECONDS - 0.2)
    expect(state.penalty).toBeGreaterThan(0)
    avancar(state, PARADO, 0.4)
    expect(state.penalty).toBe(0)
  })

  it('a velocidade volta ao normal quando a penalidade acaba', () => {
    const state = createRaceState()
    avancar(state, PARADO, 5)
    state.penalty = PENALTY_SECONDS
    avancar(state, PARADO, 1)
    expect(state.speed).toBeLessThan(200)
    avancar(state, PARADO, 3)
    expect(state.speed).toBeGreaterThan(240)
  })
})

describe('boost', () => {
  it('consome enquanto ativo e recarrega quando solto', () => {
    const state = createRaceState()
    avancar(state, SO_BOOST, 2)
    expect(state.boosting).toBe(true)
    expect(state.boost).toBeLessThan(100)

    const gasto = state.boost
    avancar(state, PARADO, 2)
    expect(state.boost).toBeGreaterThan(gasto)
  })

  it('esgota e fica bloqueado até recarregar, sem piscar a cada quadro', () => {
    const state = createRaceState()
    avancar(state, SO_BOOST, 6)
    expect(state.boostLocked).toBe(true)
    expect(state.boosting).toBe(false)
    expect(state.speed).toBeLessThan(300)

    // Segurando o botão com o tanque vazio o boost permanece desligado.
    for (let t = 0; t < 2; t += 1 / 60) {
      stepRace(state, SO_BOOST, 1 / 60)
      expect(state.boosting).toBe(false)
    }
    expect(state.boost).toBeGreaterThan(5)

    // Só volta a funcionar depois de atingir a carga mínima.
    avancar(state, PARADO, 4)
    expect(state.boostLocked).toBe(false)
    avancar(state, SO_BOOST, 0.2)
    expect(state.boosting).toBe(true)
  })

  it('não funciona fora da pista nem durante a penalidade', () => {
    const foraDaPista = createRaceState()
    avancar(foraDaPista, { left: false, right: true, boost: true }, 5)
    expect(foraDaPista.offRoad).toBe(true)
    expect(foraDaPista.boosting).toBe(false)

    const penalizado = createRaceState()
    avancar(penalizado, PARADO, 2)
    penalizado.penalty = PENALTY_SECONDS
    avancar(penalizado, SO_BOOST, 0.2)
    expect(penalizado.boosting).toBe(false)
  })

  it('não decide sozinho a corrida', () => {
    const semBoost = correr(() => PARADO)
    const comBoost = correr(() => SO_BOOST)
    const ganho = (semBoost.time - comBoost.time) / semBoost.time
    expect(ganho).toBeGreaterThan(0.02)
    expect(ganho).toBeLessThan(0.15)
  })
})
