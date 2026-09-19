import { describe, expect, it } from 'vitest'
import {
  CENTRIFUGAL_REFERENCE_SPEED,
  CORNER_GRIP,
  createRaceState,
  LATERAL_LIMIT,
  OFF_ROAD_LIMIT,
  PENALTY_SECONDS,
  slipstreamFrom,
  SLIPSTREAM_RANGE_M,
  SLIPSTREAM_WIDTH,
  stepRace,
  type RaceEvent,
  type RaceInput,
  type RaceState,
} from './simulation'
import { noLimiteDoAsfalto, segurandoAFaixa, type Piloto } from './piloto'
import { obstacles, TRACK_LENGTH, trackCurvature } from './track'

const PARADO: RaceInput = { left: false, right: false, boost: false }
const SO_BOOST: RaceInput = { left: false, right: false, boost: true }

/** Piloto atento no meio da pista: o padrão de quem testa outra coisa. */
const NO_MEIO = segurandoAFaixa(0)
const NO_MEIO_COM_BOOST = segurandoAFaixa(0, true)

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

/** Como `avancar`, mas com alguém no volante reagindo ao estado do carro. */
function pilotar(state: RaceState, piloto: Piloto, segundos: number, dt = 1 / 60) {
  const events: RaceEvent[] = []
  for (let t = 0; t < segundos; t += dt) events.push(...stepRace(state, piloto(state), dt))
  return events
}

describe('física e progresso', () => {
  it('acelera sozinha: o piloto controla apenas direção e boost', () => {
    const state = createRaceState()
    pilotar(state, NO_MEIO, 2)
    expect(state.speed).toBeGreaterThan(50)
    expect(state.progress).toBeGreaterThan(0)
    // Quem segura a faixa continua nela: a aceleração não desvia o carro.
    expect(Math.abs(state.lateral)).toBeLessThan(0.1)
  })

  it('um piloto que mantém o carro no asfalto completa a prova entre 60 e 90 segundos', () => {
    // O piso de dificuldade é o menor esforço que ainda conta como dirigir:
    // corrigir apenas quando a curva já levou o carro para perto da grama.
    const { time, state } = correr((_t, estado) => noLimiteDoAsfalto()(estado))
    expect(state.finished).toBe(true)
    expect(time).toBeGreaterThan(60)
    expect(time).toBeLessThan(90)
  })

  it('mantém o mesmo resultado em 60, 30 e 20 quadros por segundo', () => {
    const rapido = correr((_t, estado) => NO_MEIO(estado), 1 / 60)
    const medio = correr((_t, estado) => NO_MEIO(estado), 1 / 30)
    const lento = correr((_t, estado) => NO_MEIO(estado), 0.05)
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
    const { state, events } = correr((_t, estado) => NO_MEIO(estado))
    const colisoes = events.filter((event) => event.type === 'collision')
    const ids = colisoes.map((event) => (event.type === 'collision' ? event.obstacleId : 0))
    expect(new Set(ids).size).toBe(ids.length)
    expect(state.collisions).toBe(ids.length)
  })

  it('quem vai pelo centro atinge apenas os obstáculos do centro', () => {
    const { events } = correr((_t, estado) => NO_MEIO(estado))
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
    pilotar(state, NO_MEIO, 5)
    state.penalty = PENALTY_SECONDS
    pilotar(state, NO_MEIO, 1)
    expect(state.speed).toBeLessThan(200)
    pilotar(state, NO_MEIO, 3)
    expect(state.speed).toBeGreaterThan(240)
  })
})

describe('boost', () => {
  it('consome enquanto ativo e recarrega quando solto', () => {
    const state = createRaceState()
    pilotar(state, NO_MEIO_COM_BOOST, 2)
    expect(state.boosting).toBe(true)
    expect(state.boost).toBeLessThan(100)

    const gasto = state.boost
    pilotar(state, NO_MEIO, 2)
    expect(state.boost).toBeGreaterThan(gasto)
  })

  it('esgota e fica bloqueado até recarregar, sem piscar a cada quadro', () => {
    const state = createRaceState()
    pilotar(state, NO_MEIO_COM_BOOST, 6)
    expect(state.boostLocked).toBe(true)
    expect(state.boosting).toBe(false)
    expect(state.speed).toBeLessThan(300)

    // Segurando o botão com o tanque vazio o boost permanece desligado.
    for (let t = 0; t < 2; t += 1 / 60) {
      stepRace(state, NO_MEIO_COM_BOOST(state), 1 / 60)
      expect(state.boosting).toBe(false)
    }
    expect(state.boost).toBeGreaterThan(5)

    // Só volta a funcionar depois de atingir a carga mínima.
    pilotar(state, NO_MEIO, 4)
    expect(state.boostLocked).toBe(false)
    pilotar(state, NO_MEIO_COM_BOOST, 0.2)
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
    const semBoost = correr((_t, estado) => NO_MEIO(estado))
    const comBoost = correr((_t, estado) => NO_MEIO_COM_BOOST(estado))
    const ganho = (semBoost.time - comBoost.time) / semBoost.time
    expect(ganho).toBeGreaterThan(0.02)
    expect(ganho).toBeLessThan(0.15)
  })
})

describe('a curva cobra velocidade', () => {
  /** Leva o carro a uma velocidade de cruzeiro sem sair do lugar na faixa. */
  function embalado(faixa = 0) {
    const state = createRaceState()
    pilotar(state, segurandoAFaixa(faixa), 6)
    return state
  }

  /**
   * Trechos de curvatura alta nos dois sentidos, conferidos aqui mesmo para o
   * teste não depender de um ponto escolhido a olho que um ajuste do traçado
   * poderia invalidar em silêncio.
   */
  const trechosDeCurva = [0, 867, 2_728, 3_711].filter(
    (distancia) => Math.abs(trackCurvature(distancia)) > 0.7,
  )

  it('a pista tem trechos exigentes nos dois sentidos', () => {
    expect(trechosDeCurva.length).toBeGreaterThan(2)
    expect(trechosDeCurva.some((d) => trackCurvature(d) > 0.7)).toBe(true)
    expect(trechosDeCurva.some((d) => trackCurvature(d) < -0.7)).toBe(true)
  })

  it('empurra o carro para fora da curva, e não para dentro', () => {
    for (const distancia of trechosDeCurva) {
      const state = createRaceState()
      state.progress = distancia
      state.speed = CENTRIFUGAL_REFERENCE_SPEED
      const antes = state.lateral
      avancar(state, PARADO, 0.5)

      // Curva à direita (curvatura positiva) joga o carro para a esquerda.
      expect(Math.sign(state.lateral - antes)).toBe(-Math.sign(trackCurvature(distancia)))
    }
  })

  it('a força cresce com o quadrado da velocidade', () => {
    const medir = (velocidade: number) => {
      const state = createRaceState()
      state.progress = 0
      state.speed = velocidade
      // Sem comando: o deslocamento no passo é só o que a curva impôs.
      avancar(state, PARADO, 1 / 60, 1 / 60)
      return Math.abs(state.lateral)
    }

    const normal = medir(CENTRIFUGAL_REFERENCE_SPEED)
    const rapido = medir(CENTRIFUGAL_REFERENCE_SPEED * 1.25)
    expect(rapido).toBeGreaterThan(normal * 1.5)
  })

  it('abaixo do limite de aderência o pneu segura sozinho', () => {
    // Velocidade em que a carga da curva iguala exatamente a aderência. Um
    // passo só: assim a velocidade do passo é a que foi escolhida aqui, e não
    // a que a aceleração automática teria alcançado depois.
    const noLimite =
      CENTRIFUGAL_REFERENCE_SPEED * Math.sqrt(CORNER_GRIP / Math.abs(trackCurvature(0)))

    const segurando = createRaceState()
    segurando.speed = noLimite * 0.95
    avancar(segurando, PARADO, 1 / 60, 1 / 60)
    expect(segurando.lateral).toBe(0)

    // E logo acima do limite o carro escapa: a aderência é um limiar, não um
    // muro — é o excedente que empurra.
    const escapando = createRaceState()
    escapando.speed = noLimite * 1.1
    avancar(escapando, PARADO, 1 / 60, 1 / 60)
    expect(escapando.lateral).not.toBe(0)
  })

  it('registra a carga lateral para a apresentação, sem passar de 1', () => {
    const state = embalado()
    for (let t = 0; t < 40; t += 1 / 60) {
      stepRace(state, segurandoAFaixa(0)(state), 1 / 60)
      expect(state.cornerLoad).toBeGreaterThanOrEqual(0)
      expect(state.cornerLoad).toBeLessThanOrEqual(1)
    }
  })

  it('quem não dirige é punido: a pista deixou de ser decorativa', () => {
    const passageiro = correr(() => PARADO)
    const piloto = correr((_t, estado) => noLimiteDoAsfalto()(estado))

    expect(piloto.time).toBeLessThan(passageiro.time)
    // A diferença precisa ser grande o bastante para o jogador perceber que
    // dirigir importa — não um detalhe de casas decimais.
    expect(passageiro.time - piloto.time).toBeGreaterThan(10)
  })
})

describe('vácuo do rival', () => {
  it('só existe para quem vem atrás, e some ao ultrapassar', () => {
    expect(slipstreamFrom(1_000, 0, 1_020, 0)).toBeGreaterThan(0)
    // Lado a lado ou à frente não há esteira para aproveitar.
    expect(slipstreamFrom(1_000, 0, 1_000, 0)).toBe(0)
    expect(slipstreamFrom(1_020, 0, 1_000, 0)).toBe(0)
  })

  it('enfraquece com a distância e acaba fora do alcance', () => {
    const colado = slipstreamFrom(1_000, 0, 1_002, 0)
    const longe = slipstreamFrom(1_000, 0, 1_030, 0)
    expect(colado).toBeGreaterThan(longe)
    expect(longe).toBeGreaterThan(0)
    expect(slipstreamFrom(1_000, 0, 1_000 + SLIPSTREAM_RANGE_M, 0)).toBe(0)
    expect(slipstreamFrom(1_000, 0, 1_500, 0)).toBe(0)
  })

  it('exige alinhamento: quem passa por outra faixa não pega esteira', () => {
    const atras = slipstreamFrom(1_000, 0, 1_010, 0)
    const deslocado = slipstreamFrom(1_000, 0, 1_010, SLIPSTREAM_WIDTH / 2)
    expect(deslocado).toBeGreaterThan(0)
    expect(deslocado).toBeLessThan(atras)
    expect(slipstreamFrom(1_000, 0, 1_010, SLIPSTREAM_WIDTH)).toBe(0)
    expect(slipstreamFrom(1_000, 0, 1_010, -SLIPSTREAM_WIDTH * 2)).toBe(0)
  })

  it('fica entre 0 e 1 em qualquer combinação, inclusive com valor inválido', () => {
    for (const progresso of [-100, 0, 1_000, Number.NaN]) {
      for (const lateral of [-2, 0, 1.4, Number.NaN]) {
        const forca = slipstreamFrom(1_000, 0, progresso, lateral)
        expect(forca).toBeGreaterThanOrEqual(0)
        expect(forca).toBeLessThanOrEqual(1)
      }
    }
  })

  it('rende velocidade de verdade: o carro no vácuo passa do teto sem boost', () => {
    const semVacuo = createRaceState()
    pilotar(semVacuo, segurandoAFaixa(0), 12)

    const comVacuo = createRaceState()
    for (let t = 0; t < 12; t += 1 / 60) stepRace(comVacuo, segurandoAFaixa(0)(comVacuo), 1 / 60, 1)

    expect(comVacuo.speed).toBeGreaterThan(semVacuo.speed)
    expect(comVacuo.progress).toBeGreaterThan(semVacuo.progress)
  })

  it('uma medição corrompida do rival não apaga a velocidade do carro', () => {
    const state = createRaceState()
    pilotar(state, segurandoAFaixa(0), 4)
    const antes = state.speed
    for (let t = 0; t < 1; t += 1 / 60) stepRace(state, segurandoAFaixa(0)(state), 1 / 60, Number.NaN)
    expect(Number.isFinite(state.speed)).toBe(true)
    expect(state.speed).toBeGreaterThan(antes * 0.9)
    expect(state.slipstream).toBe(0)
  })
})
