import { describe, expect, it } from 'vitest'
import { approach, createFeel, MAX_SPEED, registerImpact, updateFeel } from './feel'
import { createRaceState, MAX_GRIP_LOSS, stepRace, type RaceInput } from './simulation'
import { speedForState } from './track'

const PARADO: RaceInput = { left: false, right: false, boost: false }
const BOOST: RaceInput = { left: false, right: false, boost: true }
const DIREITA: RaceInput = { left: false, right: true, boost: false }
const ESQUERDA: RaceInput = { left: true, right: false, boost: false }

/** Roda corrida e apresentação juntas, como o quadro do jogo faz. */
function rodar(input: RaceInput, segundos: number, dt = 1 / 60, inicial?: ReturnType<typeof createRaceState>) {
  const race = inicial ?? createRaceState()
  const feel = createFeel()
  avancar(race, feel, input, segundos, dt)
  return { race, feel }
}

function avancar(
  race: ReturnType<typeof createRaceState>,
  feel: ReturnType<typeof createFeel>,
  input: RaceInput,
  segundos: number,
  dt = 1 / 60,
) {
  for (let t = 0; t < segundos; t += dt) {
    stepRace(race, input, dt)
    updateFeel(feel, race, dt)
  }
}

describe('aproximação suavizada', () => {
  it('não depende da taxa de quadros', () => {
    let rapido = 0
    for (let i = 0; i < 120; i += 1) rapido = approach(rapido, 1, 0.2, 1 / 60)

    let lento = 0
    for (let i = 0; i < 40; i += 1) lento = approach(lento, 1, 0.2, 1 / 20)

    expect(rapido).toBeCloseTo(lento, 6)
  })

  it('chega ao alvo e para nele', () => {
    let valor = 0
    for (let i = 0; i < 600; i += 1) valor = approach(valor, 0.7, 0.1, 1 / 60)
    expect(valor).toBeCloseTo(0.7, 6)
  })
})

describe('intensidades da apresentação', () => {
  it('normaliza a velocidade entre parado e o máximo do carro', () => {
    const { race, feel } = rodar(PARADO, 14)
    expect(feel.speed).toBeCloseTo(race.speed / MAX_SPEED, 6)
    // Em ritmo normal o carro não está no máximo: sobra espaço para o boost.
    expect(feel.speed).toBeGreaterThan(0.7)
    expect(feel.speed).toBeLessThan(0.9)
  })

  it('satura a aceleração na arrancada da largada', () => {
    const { feel } = rodar(PARADO, 0.35)
    expect(feel.accel).toBeGreaterThan(0.6)
  })

  it('a aceleração cede conforme a velocidade sobe', () => {
    const cedo = rodar(PARADO, 0.6).feel.accel
    const tarde = rodar(PARADO, 6).feel.accel
    expect(tarde).toBeLessThan(cedo)
    expect(tarde).toBeGreaterThan(0)
  })

  it('a aceleração volta a zero quando o ritmo estabiliza', () => {
    const { feel } = rodar(PARADO, 20)
    expect(Math.abs(feel.accel)).toBeLessThan(0.05)
  })

  it('a aceleração fica negativa ao perder velocidade', () => {
    const race = createRaceState()
    const feel = createFeel()
    avancar(race, feel, PARADO, 14)

    // Sair da pista derruba a velocidade-alvo de 252 para 132 ou menos.
    for (let t = 0; t < 3 && !race.offRoad; t += 1 / 60) {
      stepRace(race, DIREITA, 1 / 60)
      updateFeel(feel, race, 1 / 60)
    }
    expect(race.offRoad).toBe(true)

    avancar(race, feel, DIREITA, 0.5)
    expect(feel.accel).toBeLessThan(-0.05)
  })

  it('o volante aparente é o da simulação, sem uma segunda suavização', () => {
    const race = createRaceState()
    const feel = createFeel()
    for (let t = 0; t < 1; t += 1 / 60) {
      stepRace(race, DIREITA, 1 / 60)
      updateFeel(feel, race, 1 / 60)
      // Duas suavizações seriam duas verdades: a carroceria inclinaria para
      // um lado enquanto o carro anda para o outro.
      expect(feel.steer).toBe(race.steerInput)
    }
    expect(feel.steer).toBeGreaterThan(0.95)
  })

  it('o giro do volante sobe ao virar e cai ao manter o comando', () => {
    const race = createRaceState()
    const feel = createFeel()
    avancar(race, feel, DIREITA, 0.25)
    const virando = feel.steerRate
    expect(virando).toBeGreaterThan(0.15)

    // Com o volante no batente ele para de girar, mesmo com o botão preso.
    avancar(race, feel, DIREITA, 1.5)
    expect(feel.steerRate).toBeLessThan(virando * 0.2)
  })

  it('o esforço lateral acompanha a perda de aderência', () => {
    const race = createRaceState()
    const feel = createFeel()
    avancar(race, feel, PARADO, 6)
    expect(feel.strain).toBeCloseTo(0, 3)

    const alvos: number[] = []
    for (let t = 0; t < 8; t += 1 / 60) {
      stepRace(race, Math.floor(t / 0.35) % 2 === 0 ? DIREITA : ESQUERDA, 1 / 60)
      updateFeel(feel, race, 1 / 60)
      if (t > 6) alvos.push((1 - race.grip) / MAX_GRIP_LOSS)
    }

    // A agitação pulsa a cada inversão, então a aderência oscila dentro do
    // ciclo. O esforço aparente suaviza esses pulsos, e o que se pode exigir
    // dele é ficar dentro da faixa que a simulação percorreu — não colar no
    // valor instantâneo de um quadro qualquer.
    expect(race.grip).toBeLessThan(1)
    expect(feel.strain).toBeGreaterThanOrEqual(Math.min(...alvos) - 0.02)
    expect(feel.strain).toBeLessThanOrEqual(Math.max(...alvos) + 0.02)
    expect(feel.strain).toBeGreaterThan(0.2)
  })

  it('o boost sobe e desce sem degrau', () => {
    const race = createRaceState()
    const feel = createFeel()
    avancar(race, feel, BOOST, 3)
    expect(feel.boost).toBeGreaterThan(0.95)

    const meio: number[] = []
    for (let t = 0; t < 1; t += 1 / 60) {
      stepRace(race, PARADO, 1 / 60)
      updateFeel(feel, race, 1 / 60)
      meio.push(feel.boost)
    }
    // Passa por valores intermediários em vez de zerar de uma vez.
    expect(meio.some((valor) => valor > 0.2 && valor < 0.8)).toBe(true)
    expect(feel.boost).toBeLessThan(0.05)
  })

  it('fora da pista cresce conforme o carro se afasta da borda', () => {
    const race = createRaceState()
    const feel = createFeel()
    avancar(race, feel, PARADO, 4)
    expect(feel.offRoad).toBe(0)

    const amostras: number[] = []
    for (let t = 0; t < 3; t += 1 / 60) {
      stepRace(race, DIREITA, 1 / 60)
      updateFeel(feel, race, 1 / 60)
      amostras.push(feel.offRoad)
    }
    expect(amostras.some((valor) => valor > 0.1 && valor < 0.9)).toBe(true)
    expect(feel.offRoad).toBeGreaterThan(0.9)
  })

  it('o impacto decai sozinho depois de marcado', () => {
    const race = createRaceState()
    const feel = registerImpact(createFeel())
    expect(feel.impact).toBe(1)

    for (let t = 0; t < 0.3; t += 1 / 60) updateFeel(feel, race, 1 / 60)
    expect(feel.impact).toBeLessThan(0.6)
    expect(feel.impact).toBeGreaterThan(0.1)

    for (let t = 0; t < 2; t += 1 / 60) updateFeel(feel, race, 1 / 60)
    expect(feel.impact).toBeLessThan(0.02)
  })

  it('nunca modifica o estado da corrida', () => {
    const race = createRaceState()
    stepRace(race, PARADO, 1 / 60)
    const antes = JSON.stringify({ ...race, hitObstacles: [...race.hitObstacles] })
    updateFeel(createFeel(), race, 1 / 60)
    expect(JSON.stringify({ ...race, hitObstacles: [...race.hitObstacles] })).toBe(antes)
  })

  it('suaviza igual em 60, 30 e 20 quadros por segundo', () => {
    // Mesmo estado de corrida e o mesmo tempo total: só o passo muda.
    const parado = createRaceState()
    const resultado = [60, 30, 20].map((fps) => {
      const feel = registerImpact(createFeel())
      for (let passo = 0; passo < fps * 2; passo += 1) updateFeel(feel, parado, 1 / fps)
      return feel
    })

    for (const outro of resultado.slice(1)) {
      expect(outro.impact).toBeCloseTo(resultado[0].impact, 6)
      expect(outro.boost).toBeCloseTo(resultado[0].boost, 6)
    }
  })

  it('a velocidade converge para o mesmo valor em qualquer taxa de quadros', () => {
    const velocidades = [60, 30, 20].map((fps) => {
      const race = createRaceState()
      for (let passo = 0; passo < fps * 3; passo += 1) stepRace(race, PARADO, 1 / fps)
      return race.speed
    })

    for (const velocidade of velocidades.slice(1)) {
      expect(velocidade).toBeCloseTo(velocidades[0], 4)
    }
    // E durante a subida, não só no fim.
    expect(velocidades[0]).toBeLessThan(speedForState(false, 0, false))
  })
})
