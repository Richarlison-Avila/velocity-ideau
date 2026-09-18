import { describe, expect, it } from 'vitest'
import {
  AGITATION_DEADBAND,
  createRaceState,
  gripFor,
  LATERAL_LIMIT,
  MAX_GRIP_LOSS,
  OFF_ROAD_LIMIT,
  PENALTY_SECONDS,
  stepRace,
  type RaceEvent,
  type RaceInput,
  type RaceState,
} from './simulation'
import { obstacles, speedForState, TRACK_LENGTH } from './track'

const PARADO: RaceInput = { left: false, right: false, boost: false }
const SO_BOOST: RaceInput = { left: false, right: false, boost: true }
const DIREITA: RaceInput = { left: false, right: true, boost: false }
const ESQUERDA: RaceInput = { left: true, right: false, boost: false }

/** Velocidade de cruzeiro em pista livre, sem boost. */
const CRUZEIRO = speedForState(false, 0, false)

/**
 * Marca todos os obstáculos como já atingidos.
 *
 * Serve aos testes que medem só a curva de velocidade: sem isso, vinte
 * segundos de prova atravessam obstáculos e a penalidade contamina a medida.
 */
function semObstaculos(state: RaceState) {
  for (const obstacle of obstacles) state.hitObstacles.add(obstacle.id)
  return state
}

/** Segundos até o carro cruzar uma velocidade, partindo do zero. */
function tempoAte(alvo: number, dt = 1 / 60) {
  const state = createRaceState()
  for (let t = 0; t < 40; t += dt) {
    stepRace(state, PARADO, dt)
    if (state.speed >= alvo) return t + dt
  }
  return Infinity
}

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
    avancar(state, PARADO, 12)
    state.penalty = PENALTY_SECONDS
    avancar(state, PARADO, 1)
    expect(state.speed).toBeLessThan(200)
    // A recuperação é a mesma curva de tração da largada, então recuperar os
    // últimos km/h leva tempo de propósito. O que importa é voltar perto do
    // ritmo: em 3 s o carro já está a 95% da velocidade de cruzeiro.
    avancar(state, PARADO, 3)
    expect(state.speed).toBeGreaterThan(CRUZEIRO * 0.95)
    avancar(state, PARADO, 4)
    expect(state.speed).toBeGreaterThan(CRUZEIRO * 0.995)
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

describe('curva de aceleração', () => {
  it('a arrancada é forte, mas não coloca o carro em 200 km/h de imediato', () => {
    // O problema medido na versão anterior: 0 a 200 km/h em 0,88 s, o que
    // fazia a corrida começar já em velocidade de cruzeiro.
    expect(tempoAte(100)).toBeGreaterThan(1.2)
    expect(tempoAte(200)).toBeGreaterThan(2.8)
  })

  it('mas também não é lenta a ponto de parecer que o carro não anda', () => {
    expect(tempoAte(50)).toBeLessThan(1.3)
    expect(tempoAte(100)).toBeLessThan(2.4)
    expect(tempoAte(200)).toBeLessThan(5)
  })

  it('o ganho é progressivo: as faixas altas custam mais que as baixas', () => {
    const marcos = [50, 100, 150, 200, 240].map((alvo) => tempoAte(alvo))
    const trechos = marcos.map((t, i) => (i === 0 ? t : t - marcos[i - 1]))

    // A tração é quase plana no começo — é isso que dá a arrancada — e só
    // cede perto do teto. Então nenhuma faixa é mais barata que a anterior,
    // e a última é bem mais cara que a primeira.
    for (let i = 1; i < trechos.length; i += 1) {
      expect(trechos[i]).toBeGreaterThan(trechos[i - 1] - 0.02)
    }
    expect(trechos[trechos.length - 1]).toBeGreaterThan(trechos[0] * 1.8)
  })

  it('chega à velocidade de cruzeiro e para nela', () => {
    const state = createRaceState()
    avancar(state, PARADO, 20)
    expect(state.speed).toBeCloseTo(CRUZEIRO, 3)
  })

  it('o boost é sentido na saída e some ao soltar', () => {
    const state = semObstaculos(createRaceState())
    avancar(state, PARADO, 20)
    const cruzeiro = state.speed

    avancar(state, SO_BOOST, 1)
    const comUmSegundo = state.speed
    expect(comUmSegundo).toBeGreaterThan(cruzeiro + 15)

    avancar(state, SO_BOOST, 2)
    expect(state.speed).toBeGreaterThan(comUmSegundo)
    expect(state.speed).toBeLessThanOrEqual(speedForState(false, 0, true))

    // Ao soltar, a queda é contínua: passa por valores intermediários.
    const descida: number[] = []
    for (let t = 0; t < 1.2; t += 1 / 60) {
      stepRace(state, PARADO, 1 / 60)
      descida.push(state.speed)
    }
    expect(descida.some((v) => v > cruzeiro + 5 && v < comUmSegundo)).toBe(true)
  })
})

describe('perdas de velocidade', () => {
  it('o impacto derruba a velocidade de imediato, não aos poucos', () => {
    const state = createRaceState()
    avancar(state, PARADO, 20)
    const antes = state.speed
    const alvo = obstacles.find((obstacle) => Math.abs(obstacle.lane) < 0.25)!
    state.progress = alvo.distance - 4
    state.lateral = alvo.lane

    const eventos = avancar(state, PARADO, 0.2)
    expect(eventos.some((event) => event.type === 'collision')).toBe(true)
    // Em dois décimos de segundo a maior parte da queda já aconteceu.
    expect(antes - state.speed).toBeGreaterThan((antes - speedForState(false, 1, false)) * 0.7)
  })

  it('a grama tira mais velocidade quanto mais fundo o carro entra', () => {
    const naBorda = createRaceState()
    avancar(naBorda, PARADO, 20)
    // Posiciona o carro logo depois da borda e deixa a velocidade assentar.
    naBorda.lateral = OFF_ROAD_LIMIT + 0.01
    avancar(naBorda, PARADO, 6)

    const fundo = createRaceState()
    avancar(fundo, PARADO, 20)
    fundo.lateral = LATERAL_LIMIT
    avancar(fundo, PARADO, 6)

    expect(naBorda.offRoad).toBe(true)
    expect(fundo.offRoad).toBe(true)
    expect(fundo.speed).toBeLessThan(naBorda.speed - 10)
  })

  it('a desaceleração fora da pista é contínua, sem degrau', () => {
    const state = semObstaculos(createRaceState())
    avancar(state, PARADO, 20)
    const partida = state.speed

    const amostras: number[] = []
    for (let t = 0; t < 1.5; t += 1 / 60) {
      stepRace(state, DIREITA, 1 / 60)
      if (state.offRoad) amostras.push(state.speed)
    }

    // Só perde velocidade, nunca recupera no meio da grama.
    for (let i = 1; i < amostras.length; i += 1) {
      expect(amostras[i]).toBeLessThanOrEqual(amostras[i - 1])
    }
    // E leva tempo: não é um degrau para o piso no primeiro quadro.
    const piso = amostras[amostras.length - 1]
    const meioCaminho = (partida + piso) / 2
    expect(amostras.findIndex((valor) => valor <= meioCaminho)).toBeGreaterThan(6)
    expect(piso).toBeLessThan(150)
  })

  it('penalidades somadas não deixam o carro irrecuperável', () => {
    const state = createRaceState()
    avancar(state, PARADO, 20)
    // O pior caso possível: fundo da grama, penalidade ativa e volante em pânico.
    state.lateral = LATERAL_LIMIT
    state.penalty = PENALTY_SECONDS
    for (let t = 0; t < 3; t += 1 / 60) {
      stepRace(state, Math.floor(t / 0.2) % 2 === 0 ? DIREITA : ESQUERDA, 1 / 60)
    }
    expect(state.speed).toBeGreaterThan(50)

    // E volta ao ritmo assim que o piloto endireita.
    for (let t = 0; t < 4 && state.offRoad; t += 1 / 60) stepRace(state, ESQUERDA, 1 / 60)
    expect(state.offRoad).toBe(false)
    avancar(state, PARADO, 6)
    expect(state.speed).toBeGreaterThan(CRUZEIRO * 0.95)
  })
})

describe('esforço lateral', () => {
  /**
   * Roda a prova inteira com uma política de direção e devolve o essencial.
   *
   * A política recebe o tempo e também o número do quadro: comparar taxas de
   * quadros exige que o comando seja idêntico nas três, e só o índice do
   * quadro garante isso.
   */
  function provaCom(policy: (t: number, quadro: number, dt: number) => RaceInput, dt = 1 / 60) {
    const state = createRaceState()
    let time = 0
    let quadro = 0
    let piorAderencia = 1
    let maiorAgitacao = 0
    while (!state.finished && time < 400) {
      stepRace(state, policy(time, quadro, dt), dt)
      time += dt
      quadro += 1
      piorAderencia = Math.min(piorAderencia, state.grip)
      maiorAgitacao = Math.max(maiorAgitacao, state.agitation)
    }
    return { time, piorAderencia, maiorAgitacao, state }
  }

  /**
   * Zigue-zague de meio período exato em quadros.
   *
   * Medir por tempo acumulado daria fases de tamanho diferente em cada taxa
   * — em 30 quadros por segundo, meio período de 0,35 s cai entre dois
   * quadros — e o comando assimétrico faria o carro derivar para um lado. O
   * teste mediria a amostragem do próprio teste, não a simulação.
   */
  const zigueZague = (meioPeriodo: number) => (_t: number, quadro: number, dt: number) => {
    const quadrosPorFase = Math.max(1, Math.round(meioPeriodo / dt))
    return Math.floor(quadro / quadrosPorFase) % 2 === 0 ? DIREITA : ESQUERDA
  }

  /** Correção de curva: um toque curto para cada lado, com folga entre eles. */
  const correcaoDeCurva = (t: number) => {
    const ciclo = t % 2.4
    if (ciclo < 0.25) return DIREITA
    if (ciclo >= 1.45 && ciclo < 1.7) return ESQUERDA
    return PARADO
  }

  it('a aderência só começa a cair depois da zona morta', () => {
    expect(gripFor(0)).toBe(1)
    expect(gripFor(AGITATION_DEADBAND)).toBe(1)
    expect(gripFor(AGITATION_DEADBAND + 0.5)).toBeLessThan(1)
    // E nunca passa da perda máxima, por mais que o piloto insista.
    expect(gripFor(1_000)).toBeCloseTo(1 - MAX_GRIP_LOSS, 9)
  })

  it('o zigue-zague sustentado custa tempo de prova', () => {
    const reto = provaCom(() => PARADO)
    const agitado = provaCom(zigueZague(0.3))
    expect(agitado.piorAderencia).toBeLessThan(0.9)
    expect(agitado.time).toBeGreaterThan(reto.time * 1.08)
  })

  it('a correção necessária numa curva não é punida', () => {
    const corrigindo = provaCom(correcaoDeCurva)
    expect(corrigindo.maiorAgitacao).toBeLessThan(AGITATION_DEADBAND)
    expect(corrigindo.piorAderencia).toBe(1)
  })

  it('a aderência volta sozinha quando o piloto para de serpentear', () => {
    const state = createRaceState()
    for (let t = 0; t < 6; t += 1 / 60) {
      stepRace(state, Math.floor(t / 0.35) % 2 === 0 ? DIREITA : ESQUERDA, 1 / 60)
    }
    expect(state.grip).toBeLessThan(0.95)
    avancar(state, PARADO, 4)
    expect(state.grip).toBe(1)
  })

  it('o volante tem inércia, mas não atrasa o comando a ponto de atrapalhar', () => {
    const state = createRaceState()
    stepRace(state, DIREITA, 1 / 60)
    // Já saiu do lugar no primeiro quadro: o comando não fica preso.
    expect(state.steerInput).toBeGreaterThan(0)
    expect(state.lateral).toBeGreaterThan(0)

    avancar(state, DIREITA, 0.4)
    expect(state.steerInput).toBeGreaterThan(0.95)
  })

  it('a punição por esforço é a mesma em 60, 30 e 20 quadros por segundo', () => {
    const tempos = [60, 30, 20].map((fps) => provaCom(zigueZague(0.3), 1 / fps).time)
    for (const tempo of tempos.slice(1)) {
      expect(Math.abs(tempo - tempos[0])).toBeLessThan(1)
    }
  })
})
