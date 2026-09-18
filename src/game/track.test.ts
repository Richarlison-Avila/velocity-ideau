import { describe, expect, it } from 'vitest'
import { firstSceneryIndex, lastSceneryIndex, SCENERY_SPACING } from './layout'
import {
  CAR_HALF_LATERAL,
  CAR_SCREEN_RATIO,
  CAR_VIEW_DISTANCE,
  formatTime,
  isTallMarker,
  LATERAL_LIMIT,
  lateralOffset,
  OFF_ROAD_LIMIT,
  roadProjection,
  ROADSIDE_LATERAL,
  ROADSIDE_SPACING,
  ROAD_EDGE,
  speedForState,
  VIEW_DISTANCE,
} from './track'

describe('regras básicas da corrida', () => {
  it('formata o cronômetro', () => {
    expect(formatTime(65.234)).toBe('1:05.234')
  })

  it('prioriza a redução de velocidade fora da pista', () => {
    expect(speedForState(true, 0, true)).toBe(132)
  })

  it('aplica boost quando o carro está livre', () => {
    expect(speedForState(false, 0, true)).toBe(314)
  })
})

describe('alinhamento entre o que o jogo desenha e o que ele cobra', () => {
  const LARGURA = 1_000
  const ALTURA = 600

  /** Posição na tela de um ponto da pista, do jeito que o render desenha. */
  function naTela(lateral: number, distancia: number) {
    const { roadWidth, y } = roadProjection(distancia, LARGURA, ALTURA)
    return { x: LARGURA / 2 + lateralOffset(lateral, roadWidth), y, meiaPista: roadWidth / 2 }
  }

  it('a borda do asfalto é a mesma em qualquer profundidade e em qualquer tela', () => {
    for (const distancia of [0, 40, 120, 300, VIEW_DISTANCE - 1]) {
      for (const largura of [360, 800, 1_920]) {
        const { roadWidth } = roadProjection(distancia, largura, ALTURA)
        // A posição lateral da borda é o mesmo número, por construção.
        expect(Math.abs(lateralOffset(ROAD_EDGE, roadWidth))).toBeCloseTo(roadWidth / 2, 6)
      }
    }
  })

  it('o carro é desenhado exatamente na distância que lhe foi atribuída', () => {
    expect(roadProjection(CAR_VIEW_DISTANCE, LARGURA, ALTURA).y).toBeCloseTo(ALTURA * CAR_SCREEN_RATIO, 6)
  })

  it('sair da pista acontece quando as rodas cruzam a borda, e não antes', () => {
    const noLimite = naTela(OFF_ROAD_LIMIT, CAR_VIEW_DISTANCE)
    const bordaExterna = Math.abs(noLimite.x - LARGURA / 2) + CAR_HALF_LATERAL * (noLimite.meiaPista / ROAD_EDGE)

    // A roda externa encosta na borda do asfalto no instante da punição.
    expect(bordaExterna).toBeCloseTo(noLimite.meiaPista, 6)
  })

  it('antes do limite o carro está inteiro sobre o asfalto', () => {
    const dentro = naTela(OFF_ROAD_LIMIT - 0.05, CAR_VIEW_DISTANCE)
    const bordaExterna = Math.abs(dentro.x - LARGURA / 2) + CAR_HALF_LATERAL * (dentro.meiaPista / ROAD_EDGE)
    expect(bordaExterna).toBeLessThan(dentro.meiaPista)
  })

  it('o limite físico deixa o carro visivelmente na grama, mas dentro da tela', () => {
    const noMaximo = naTela(LATERAL_LIMIT, CAR_VIEW_DISTANCE)
    expect(Math.abs(noMaximo.x - LARGURA / 2)).toBeGreaterThan(noMaximo.meiaPista)
    // Metade do sprite cabe entre o carro e a borda da tela.
    expect(noMaximo.x + LARGURA * 0.06).toBeLessThan(LARGURA)
  })

  it('carro e obstáculo na mesma faixa aparecem na mesma coluna da tela', () => {
    for (const faixa of [-0.52, -0.1, 0, 0.42, 0.56]) {
      const carro = naTela(faixa, CAR_VIEW_DISTANCE)
      // O obstáculo é desenhado com a mesma conta, só que na distância dele.
      const obstaculo = naTela(faixa, CAR_VIEW_DISTANCE)
      expect(obstaculo.x).toBeCloseTo(carro.x, 9)
    }
  })

  it('a faixa jogável continua acomodando todos os obstáculos', () => {
    expect(OFF_ROAD_LIMIT).toBeGreaterThan(0.6)
    expect(LATERAL_LIMIT).toBeGreaterThan(ROAD_EDGE)
  })
})

describe('marcadores laterais', () => {
  it('ficam fora do asfalto, sem invadir a faixa jogável', () => {
    expect(ROADSIDE_LATERAL).toBeGreaterThan(ROAD_EDGE)
    expect(ROADSIDE_LATERAL).toBeGreaterThan(LATERAL_LIMIT - 0.1)
  })

  it('cada marcador cai exatamente sobre uma vaga par do cenário', () => {
    // É o que permite desenhar cenário e marcadores no mesmo laço, em uma só
    // ordem de profundidade. Se este número mudar, o laço passa a mentir.
    expect(ROADSIDE_SPACING).toBe(SCENERY_SPACING * 2)

    for (let vaga = 0; vaga < 40; vaga += 2) {
      expect((vaga * SCENERY_SPACING) % ROADSIDE_SPACING).toBe(0)
    }
  })

  it('mantém uma quantidade estável na tela', () => {
    for (let progresso = 0; progresso < 4_800; progresso += 37) {
      const vagas = lastSceneryIndex(progresso) - firstSceneryIndex(progresso) + 1
      const marcadores = Math.floor(vagas / 2)
      expect(marcadores).toBeGreaterThanOrEqual(Math.floor(VIEW_DISTANCE / ROADSIDE_SPACING) - 1)
      expect(marcadores).toBeLessThanOrEqual(Math.ceil(VIEW_DISTANCE / ROADSIDE_SPACING) + 1)
    }
  })

  it('um marcador não muda de lugar nem de tipo entre quadros', () => {
    // O mesmo índice sempre descreve a mesma coisa, venha de onde vier.
    const vaga = 122
    expect(vaga % 2).toBe(0)
    expect(vaga * SCENERY_SPACING).toBe(1_220)
    expect(isTallMarker(vaga / 2)).toBe(isTallMarker(vaga / 2))

    // E ele continua sendo listado enquanto o carro se aproxima.
    for (const progresso of [800, 1_000, 1_100, 1_219]) {
      expect(firstSceneryIndex(progresso)).toBeLessThanOrEqual(vaga)
      expect(lastSceneryIndex(progresso)).toBeGreaterThanOrEqual(vaga)
    }
    // Depois de passar, some.
    expect(firstSceneryIndex(1_221)).toBeGreaterThan(vaga)
  })

  it('o marcador alto aparece no ritmo combinado', () => {
    const altos = []
    for (let i = 0; i < 20; i += 1) if (isTallMarker(i)) altos.push(i)
    expect(altos).toEqual([0, 5, 10, 15])
  })

  it('passam mais vezes por segundo do que as faixas da pista', () => {
    const metrosPorSegundo = speedForState(false, 0, false) / 3.6
    const marcadoresPorSegundo = (metrosPorSegundo / ROADSIDE_SPACING) * 2 // dois lados
    expect(marcadoresPorSegundo).toBeGreaterThan(metrosPorSegundo / 18)
  })
})
