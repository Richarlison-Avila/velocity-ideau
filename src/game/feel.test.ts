import { describe, expect, it } from 'vitest'
import { approach, createFeel, MAX_SPEED, registerImpact, updateFeel } from './feel'
import { segurandoAFaixa } from './piloto'
import { createRaceState, stepRace, type RaceInput } from './simulation'

const PARADO: RaceInput = { left: false, right: false, boost: false }
const BOOST: RaceInput = { left: false, right: false, boost: true }
const DIREITA: RaceInput = { left: false, right: true, boost: false }

/** Roda corrida e apresentação juntas, como o quadro do jogo faz. */
function rodar(input: RaceInput, segundos: number, dt = 1 / 60, inicial?: ReturnType<typeof createRaceState>) {
  const race = inicial ?? createRaceState()
  const feel = createFeel()
  for (let t = 0; t < segundos; t += dt) {
    stepRace(race, input, dt)
    updateFeel(feel, race, input, dt)
  }
  return { race, feel }
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
    const { race, feel } = rodar(PARADO, 6)
    expect(feel.speed).toBeCloseTo(race.speed / MAX_SPEED, 6)
    // Em ritmo normal o carro não está no máximo: sobra espaço para o boost.
    expect(feel.speed).toBeGreaterThan(0.7)
    expect(feel.speed).toBeLessThan(0.9)
  })

  it('satura a aceleração na arrancada da largada', () => {
    const { feel } = rodar(PARADO, 0.35)
    expect(feel.accel).toBeGreaterThan(0.6)
  })

  it('a aceleração volta a zero quando o ritmo estabiliza', () => {
    const { feel } = rodar(PARADO, 8)
    expect(Math.abs(feel.accel)).toBeLessThan(0.05)
  })

  it('a aceleração fica negativa ao perder velocidade', () => {
    const race = createRaceState()
    const feel = createFeel()
    for (let t = 0; t < 6; t += 1 / 60) {
      stepRace(race, PARADO, 1 / 60)
      updateFeel(feel, race, PARADO, 1 / 60)
    }
    // Sair da pista derruba a velocidade-alvo de 252 para 132.
    for (let t = 0; t < 3 && !race.offRoad; t += 1 / 60) {
      stepRace(race, DIREITA, 1 / 60)
      updateFeel(feel, race, DIREITA, 1 / 60)
    }
    expect(race.offRoad).toBe(true)

    for (let t = 0; t < 0.5; t += 1 / 60) {
      stepRace(race, DIREITA, 1 / 60)
      updateFeel(feel, race, DIREITA, 1 / 60)
    }
    expect(feel.accel).toBeLessThan(-0.05)
  })

  it('o esterço aparente atrasa em relação ao comando, mas chega lá', () => {
    const race = createRaceState()
    const feel = createFeel()
    updateFeel(feel, race, DIREITA, 1 / 60)
    const logoDepois = feel.steer
    expect(logoDepois).toBeGreaterThan(0)
    expect(logoDepois).toBeLessThan(0.3)

    for (let t = 0; t < 1; t += 1 / 60) updateFeel(feel, race, DIREITA, 1 / 60)
    expect(feel.steer).toBeGreaterThan(0.95)
  })

  it('o boost sobe e desce sem degrau', () => {
    const race = createRaceState()
    const feel = createFeel()
    // Com alguém no volante: o boost desliga fora da pista, e um carro que
    // ninguém corrige acaba na grama antes de o medidor chegar ao topo.
    const acelerando = segurandoAFaixa(0, true)
    const soltando = segurandoAFaixa(0)
    for (let t = 0; t < 3; t += 1 / 60) {
      const comando = acelerando(race)
      stepRace(race, comando, 1 / 60)
      updateFeel(feel, race, comando, 1 / 60)
    }
    expect(feel.boost).toBeGreaterThan(0.95)

    const meio: number[] = []
    for (let t = 0; t < 1; t += 1 / 60) {
      const comando = soltando(race)
      stepRace(race, comando, 1 / 60)
      updateFeel(feel, race, comando, 1 / 60)
      meio.push(feel.boost)
    }
    // Passa por valores intermediários em vez de zerar de uma vez.
    expect(meio.some((valor) => valor > 0.2 && valor < 0.8)).toBe(true)
    expect(feel.boost).toBeLessThan(0.05)
  })

  it('fora da pista cresce conforme o carro se afasta da borda', () => {
    const race = createRaceState()
    const feel = createFeel()
    for (let t = 0; t < 4; t += 1 / 60) {
      stepRace(race, PARADO, 1 / 60)
      updateFeel(feel, race, PARADO, 1 / 60)
    }
    expect(feel.offRoad).toBe(0)

    const amostras: number[] = []
    for (let t = 0; t < 3; t += 1 / 60) {
      stepRace(race, DIREITA, 1 / 60)
      updateFeel(feel, race, DIREITA, 1 / 60)
      amostras.push(feel.offRoad)
    }
    expect(amostras.some((valor) => valor > 0.1 && valor < 0.9)).toBe(true)
    expect(feel.offRoad).toBeGreaterThan(0.9)
  })

  it('o impacto decai sozinho depois de marcado', () => {
    const race = createRaceState()
    const feel = registerImpact(createFeel())
    expect(feel.impact).toBe(1)

    for (let t = 0; t < 0.3; t += 1 / 60) updateFeel(feel, race, PARADO, 1 / 60)
    expect(feel.impact).toBeLessThan(0.6)
    expect(feel.impact).toBeGreaterThan(0.1)

    for (let t = 0; t < 2; t += 1 / 60) updateFeel(feel, race, PARADO, 1 / 60)
    expect(feel.impact).toBeLessThan(0.02)
  })

  it('nunca modifica o estado da corrida', () => {
    const race = createRaceState()
    stepRace(race, PARADO, 1 / 60)
    const antes = JSON.stringify({ ...race, hitObstacles: [...race.hitObstacles] })
    updateFeel(createFeel(), race, PARADO, 1 / 60)
    expect(JSON.stringify({ ...race, hitObstacles: [...race.hitObstacles] })).toBe(antes)
  })

  it('suaviza igual em 60, 30 e 20 quadros por segundo', () => {
    // Mesmo estado de corrida e o mesmo tempo total: só o passo muda.
    const parado = createRaceState()
    const resultado = [60, 30, 20].map((fps) => {
      const feel = registerImpact(createFeel())
      for (let passo = 0; passo < fps * 2; passo += 1) updateFeel(feel, parado, DIREITA, 1 / fps)
      return feel
    })

    for (const outro of resultado.slice(1)) {
      expect(outro.steer).toBeCloseTo(resultado[0].steer, 6)
      expect(outro.impact).toBeCloseTo(resultado[0].impact, 6)
    }
  })

  it('a velocidade converge para o mesmo valor em qualquer taxa de quadros', () => {
    // Sem transições discretas no caminho: o alvo é o mesmo o tempo todo.
    const velocidades = [60, 30, 20].map((fps) => {
      const race = createRaceState()
      for (let passo = 0; passo < fps * 3; passo += 1) stepRace(race, PARADO, 1 / fps)
      return race.speed
    })

    for (const velocidade of velocidades.slice(1)) {
      expect(velocidade).toBeCloseTo(velocidades[0], 6)
    }
  })
})
