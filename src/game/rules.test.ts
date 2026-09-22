import { describe, expect, it } from 'vitest'
import {
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  isDifficulty,
  rulesFor,
  toDifficulty,
  TOP_SPEED_OF_ALL,
  type Difficulty,
} from './rules'
import { createRaceState, speedForState, stepRace, type RaceInput, type RaceState } from './simulation'
import { HIT_HALF_WIDTH, obstacles, OFF_ROAD_LIMIT, TRACK_LENGTH, VIEW_DISTANCE } from './track'

const PARADO: RaceInput = { left: false, right: false, boost: false }
const dt = 1 / 60

/** Meia-largura da colisão, a mesma que a simulação usa. */
const ALCANCE = 0.25

/**
 * Piloto competente: desvia do obstáculo mais próximo que estiver na sua
 * faixa, para o lado que couber dentro da pista. Sem reflexo sobre-humano —
 * ele só reage ao que já entrou no campo de visão.
 */
function competente(state: RaceState): RaceInput {
  let alvo = 0
  for (const o of state.rules.obstacles) {
    const adiante = o.distance - state.progress
    if (adiante <= 0 || adiante > VIEW_DISTANCE) continue
    if (Math.abs(state.lateral - o.lane) >= ALCANCE + 0.06) continue
    const paraDireita = o.lane + ALCANCE + 0.12
    const paraEsquerda = o.lane - ALCANCE - 0.12
    const cabeDireita = Math.abs(paraDireita) < OFF_ROAD_LIMIT
    alvo =
      cabeDireita && (Math.abs(paraDireita) <= Math.abs(paraEsquerda) || Math.abs(paraEsquerda) >= OFF_ROAD_LIMIT)
        ? paraDireita
        : paraEsquerda
    break
  }
  const erro = alvo - state.lateral
  const virar = Math.abs(erro) > 0.03
  return { left: virar && erro < 0, right: virar && erro > 0, boost: false }
}

function correr(difficulty: Difficulty, politica: (s: RaceState) => RaceInput, passo = dt) {
  const state = createRaceState(difficulty)
  let time = 0
  while (!state.finished && time < 400) {
    stepRace(state, politica(state), passo)
    time += passo
  }
  return { time, state }
}

describe('contrato da dificuldade', () => {
  it('só existem três níveis, e não há fácil', () => {
    expect([...DIFFICULTIES]).toEqual(['normal', 'dificil', 'profissional'])
    for (const nivel of DIFFICULTIES) expect(DIFFICULTY_LABELS[nivel]).toBeTruthy()
  })

  it('o que vem da rede é normalizado, nunca aceito às cegas', () => {
    expect(toDifficulty('profissional')).toBe('profissional')
    // Um cliente adulterado não escolhe uma regra que não existe.
    expect(toDifficulty('facil')).toBe('normal')
    expect(toDifficulty(null)).toBe('normal')
    expect(toDifficulty(7)).toBe('normal')
    expect(isDifficulty('dificil')).toBe(true)
    expect(isDifficulty('lendario')).toBe(false)
  })

  it('a corrida nasce no nível de referência quando ninguém escolhe', () => {
    expect(createRaceState().rules.difficulty).toBe('normal')
  })

  it('o normal é exatamente a corrida que o projeto já entregava', () => {
    const regras = rulesFor('normal')
    expect(regras.cruiseSpeed).toBe(252)
    expect(regras.boostSpeed).toBe(314)
    expect(regras.penaltySeconds).toBeCloseTo(1.65, 6)
    // As dez barreiras e destroços originais seguem intactos.
    //
    // Conferir contra a lista de `track.ts` diz isso sem depender de qual
    // tipo entrou depois. A versão anterior contava os que não eram buraco, o
    // que dava no mesmo enquanto o buraco era a única adição — e passou a
    // mentir na segunda, quando as manchas chegaram.
    expect(obstacles).toHaveLength(10)
    for (const original of obstacles) expect(regras.obstacles).toContainEqual(original)
  })

  it('cada nível aperta o anterior em todas as frentes', () => {
    const [normal, dificil, profissional] = DIFFICULTIES.map(rulesFor)
    for (const [menor, maior] of [
      [normal, dificil],
      [dificil, profissional],
    ]) {
      expect(maior.cruiseSpeed).toBeGreaterThan(menor.cruiseSpeed)
      expect(maior.boostSpeed).toBeGreaterThan(menor.boostSpeed)
      expect(maior.penaltySeconds).toBeGreaterThan(menor.penaltySeconds)
      expect(maior.maxGripLoss).toBeGreaterThan(menor.maxGripLoss)
      expect(maior.agitationDeadband).toBeLessThan(menor.agitationDeadband)
      expect(maior.offRoadDepthLoss).toBeGreaterThan(menor.offRoadDepthLoss)
      expect(maior.boostDrain).toBeGreaterThan(menor.boostDrain)
      expect(maior.boostRecharge).toBeLessThan(menor.boostRecharge)
      expect(maior.obstacles.length).toBeGreaterThan(menor.obstacles.length)
    }
  })

  it('o teto geral cobre o nível mais rápido', () => {
    for (const nivel of DIFFICULTIES) {
      expect(rulesFor(nivel).boostSpeed).toBeLessThanOrEqual(TOP_SPEED_OF_ALL)
    }
  })

  it('os obstáculos de cada nível contêm os do anterior', () => {
    const ids = (nivel: Difficulty) => new Set(rulesFor(nivel).obstacles.map((o) => o.id))
    const normal = ids('normal')
    const dificil = ids('dificil')
    const profissional = ids('profissional')
    for (const id of normal) expect(dificil.has(id)).toBe(true)
    for (const id of dificil) expect(profissional.has(id)).toBe(true)
  })

  it('nenhum obstáculo tem identificador repetido nem sai da pista', () => {
    for (const nivel of DIFFICULTIES) {
      const lista = rulesFor(nivel).obstacles
      expect(new Set(lista.map((o) => o.id)).size).toBe(lista.length)
      for (const o of lista) {
        expect(Math.abs(o.lane)).toBeLessThan(OFF_ROAD_LIMIT)
        expect(o.distance).toBeGreaterThan(0)
        expect(o.distance).toBeLessThan(TRACK_LENGTH)
      }
      // Vêm em ordem de distância: o desenho percorre a lista de trás para a
      // frente contando com isso para respeitar a profundidade.
      for (let i = 1; i < lista.length; i += 1) {
        expect(lista[i].distance).toBeGreaterThan(lista[i - 1].distance)
      }
    }
  })
})

describe('o profissional continua jogável', () => {
  it('nunca há dois obstáculos ao alcance ao mesmo tempo', () => {
    // A janela de colisão vai de -5 a +8 m. Dois obstáculos dentro dela em
    // faixas opostas fariam uma parede: não haveria desvio possível.
    for (const nivel of DIFFICULTIES) {
      const lista = rulesFor(nivel).obstacles
      for (let i = 1; i < lista.length; i += 1) {
        expect(lista[i].distance - lista[i - 1].distance).toBeGreaterThan(20)
      }
    }
  })

  it('sempre sobra tempo para o desvio mais apertado', () => {
    for (const nivel of DIFFICULTIES) {
      const regras = rulesFor(nivel)
      const ritmo = regras.cruiseSpeed / 3.6
      const lateralPorSegundo = 1.35 + regras.cruiseSpeed / 520

      let piorSobra = Infinity
      for (let i = 1; i < regras.obstacles.length; i += 1) {
        const segundos = (regras.obstacles[i].distance - regras.obstacles[i - 1].distance) / ritmo
        const precisa = Math.abs(regras.obstacles[i].lane - regras.obstacles[i - 1].lane) / lateralPorSegundo
        piorSobra = Math.min(piorSobra, segundos - precisa)
      }

      // Meio segundo de sobra depois do movimento físico já cobre um tempo de
      // reação humano; abaixo disso a prova deixaria de ser jogável.
      expect(piorSobra).toBeGreaterThan(0.5)
    }
  })

  /**
   * O buraco que o jogo tinha: nenhum obstáculo passava de |0,56|, e a pista
   * jogável vai até 1,153. Sobrava um corredor contínuo de 0,380 de largura
   * em cada beirada — 32% da pista — onde nada nunca encostava, igual nos
   * três níveis. Encostar na guia deixava o profissional tão vazio quanto uma
   * pista limpa, e os 19 obstáculos extras dele não mudavam nada.
   */
  it('não existe linha permanentemente segura', () => {
    for (const nivel of DIFFICULTIES) {
      const lista = rulesFor(nivel).obstacles

      let seguras = 0
      let corredor = 0
      let atual = 0
      for (let lateral = -OFF_ROAD_LIMIT; lateral <= OFF_ROAD_LIMIT; lateral += 0.005) {
        const livre = lista.every((o) => Math.abs(lateral - o.lane) >= HIT_HALF_WIDTH[o.kind])
        if (livre) {
          seguras += 1
          atual += 0.005
          corredor = Math.max(corredor, atual)
        } else {
          atual = 0
        }
      }

      // Uma fresta é aceitável — ela exige precisão e qualquer deriva joga o
      // carro na grama. Um corredor é outra coisa: dá para morar nele.
      expect(corredor).toBeLessThan(0.1)
      expect((seguras * 0.005) / (2 * OFF_ROAD_LIMIT)).toBeLessThan(0.05)
    }
  })

  it('as duas beiradas são ameaçadas, não só uma', () => {
    for (const nivel of DIFFICULTIES) {
      const beirada = rulesFor(nivel).obstacles.filter((o) => Math.abs(o.lane) > 0.7)
      expect(beirada.some((o) => o.lane > 0)).toBe(true)
      expect(beirada.some((o) => o.lane < 0)).toBe(true)
    }
  })

  it('um piloto competente completa os três níveis', () => {
    for (const nivel of DIFFICULTIES) {
      const { state, time } = correr(nivel, competente)
      expect(state.finished).toBe(true)
      // A duração de todos continua na faixa que o projeto definiu.
      expect(time).toBeGreaterThan(60)
      expect(time).toBeLessThan(90)
    }
  })

  it('quem não desvia termina a prova mesmo no profissional', () => {
    // Bater não pode virar uma parede: a prova precisa acabar de qualquer jeito.
    const { state, time } = correr('profissional', () => PARADO)
    expect(state.finished).toBe(true)
    expect(state.collisions).toBeGreaterThan(5)
    expect(time).toBeLessThan(90)
  })

  it('subir de nível custa tempo a quem não desvia', () => {
    const impactos = DIFFICULTIES.map((nivel) => correr(nivel, () => PARADO).state.collisions)
    for (let i = 1; i < impactos.length; i += 1) {
      expect(impactos[i]).toBeGreaterThan(impactos[i - 1])
    }
  })

  it('a física continua igual em 60, 30 e 20 quadros por segundo', () => {
    for (const nivel of DIFFICULTIES) {
      const tempos = [60, 30, 20].map((fps) => correr(nivel, () => PARADO, 1 / fps).time)
      for (const tempo of tempos.slice(1)) {
        expect(Math.abs(tempo - tempos[0])).toBeLessThan(0.5)
      }
    }
  })

  it('a velocidade-alvo sai das regras do próprio nível', () => {
    for (const nivel of DIFFICULTIES) {
      const regras = rulesFor(nivel)
      expect(speedForState(false, 0, false, regras)).toBe(regras.cruiseSpeed)
      expect(speedForState(false, 0, true, regras)).toBe(regras.boostSpeed)
      expect(speedForState(false, 1, false, regras)).toBe(regras.penaltySpeed)
      expect(speedForState(true, 0, true, regras)).toBe(regras.offRoadSpeed)
    }
  })
})
