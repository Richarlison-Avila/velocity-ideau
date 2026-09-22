import { describe, expect, it } from 'vitest'
import { ACHATAMENTO_MINIMO, TAMANHO_DO_OBSTACULO, medidasDoObstaculo } from './cenarioSprites'
import { CAR_VIEW_DISTANCE, roadProjection, VIEW_DISTANCE } from './track'

/** Uma tela 16:9 e uma pista reta: a projeção da corrida, sem curva nem relevo. */
const LARGURA = 1240
const ALTURA = 698
const pistaEm = (distancia: number) => ({ ...roadProjection(distancia, LARGURA, ALTURA), center: LARGURA / 2 })

/** Do carro até o fundo da vista. */
const DISTANCIAS = [CAR_VIEW_DISTANCE, 8, 16, 30, 60, 100, 150, VIEW_DISTANCE - 1]

const DE_PE = ['barrier', 'debris'] as const
const DEITADAS = ['pothole', 'oleo', 'poca'] as const

describe('obstáculos na régua da pista', () => {
  it('as peças de pé encolhem exatamente como a pista', () => {
    // O defeito que isto cobra: a régua própria dos obstáculos encolhia bem
    // menos que a pista, e a cem metros uma barreira cobria dois terços do
    // asfalto que, na altura do carro, ela cobre um quinto.
    for (const kind of DE_PE) {
      const proporcoes = DISTANCIAS.map((distancia) => {
        const medidas = medidasDoObstaculo(kind, 0, distancia, pistaEm)
        if (medidas.kind !== 'barrier' && medidas.kind !== 'debris') throw new Error(kind)
        return medidas.altura / pistaEm(distancia).roadWidth
      })
      for (const proporcao of proporcoes) expect(proporcao, kind).toBeCloseTo(proporcoes[0], 9)
    }
  })

  it('as peças deitadas ficam na largura da pista e achatam com a distância, como as faixas', () => {
    for (const kind of DEITADAS) {
      let anterior = Infinity
      let largura = NaN
      for (const distancia of DISTANCIAS) {
        const medidas = medidasDoObstaculo(kind, 0, distancia, pistaEm)
        if (medidas.kind !== kind) throw new Error(kind)
        const proporcao = medidas.rx / pistaEm(distancia).roadWidth
        if (Number.isNaN(largura)) largura = proporcao
        expect(proporcao, `${kind} a ${distancia} m`).toBeCloseTo(largura, 9)

        const achatamento = medidas.ry / medidas.rx
        expect(achatamento, `${kind} a ${distancia} m`).toBeLessThanOrEqual(anterior + 1e-9)
        // O piso existe para a mancha não sumir a cem metros: deitada, mas
        // ainda um traço que se vê.
        expect(achatamento, `${kind} a ${distancia} m`).toBeGreaterThanOrEqual(ACHATAMENTO_MINIMO - 1e-9)
        anterior = achatamento
      }
      // E achatam de verdade: ao fundo, bem mais que na altura do carro.
      const perto = medidasDoObstaculo(kind, 0, CAR_VIEW_DISTANCE, pistaEm)
      const longe = medidasDoObstaculo(kind, 0, 100, pistaEm)
      if (perto.kind !== kind || longe.kind !== kind) throw new Error(kind)
      expect(longe.ry / longe.rx, kind).toBeLessThan((perto.ry / perto.rx) / 2)
    }
  })

  it('na altura do carro, cada obstáculo tem o tamanho que sempre teve', () => {
    // É ali que a colisão foi calibrada contra o desenho. A régua nova tinha de
    // mudar o caminho até o carro, não o tamanho no carro — senão o que o
    // piloto vê bater deixaria de ser o que bate.
    const perto = Math.max(0, 1 - CAR_VIEW_DISTANCE / VIEW_DISTANCE)
    const antigo = (5 + perto ** 1.5 * 48) * (LARGURA / 620)
    expect(TAMANHO_DO_OBSTACULO * pistaEm(CAR_VIEW_DISTANCE).roadWidth).toBeCloseTo(antigo, 0)
  })

  it('na altura do carro, as deitadas têm o achatamento que tinham', () => {
    // O comprimento de cada mancha, em metros, foi escolhido para reproduzir
    // ali — numa tela 16:9 — a proporção fixa de antes, 0,34.
    for (const kind of DEITADAS) {
      const medidas = medidasDoObstaculo(kind, 0, CAR_VIEW_DISTANCE, pistaEm)
      if (medidas.kind !== kind) throw new Error(kind)
      expect(medidas.ry / medidas.rx, kind).toBeGreaterThan(0.31)
      expect(medidas.ry / medidas.rx, kind).toBeLessThan(0.37)
    }
  })

  it('a mancha deitada fica entre as bordas projetadas dela', () => {
    // O centro vertical é o meio das duas bordas na tela, e não a projeção do
    // meio: a projeção não é linear, e o centro projetado deixaria a mancha
    // mais comprida para o lado de lá do que para o de cá.
    const medidas = medidasDoObstaculo('oleo', 0, 40, pistaEm)
    if (medidas.kind !== 'oleo') throw new Error('oleo')
    const bordaDeCa = pistaEm(40 - 1.25).y
    const bordaDeLa = pistaEm(40 + 1.25).y
    expect(medidas.chao).toBeCloseTo((bordaDeCa + bordaDeLa) / 2, 9)
  })
})
