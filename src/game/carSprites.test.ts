import { describe, expect, it } from 'vitest'
import { PIVO_DA_GUINADA, WHEEL_CENTERS, yawTransform } from './carModel'
import { CAR_FRAMES, frameForPose, poseOfFrame, precisaDaFolhaCheia } from './carSprites'
import { CAR_SPRITE_REFERENCE_WIDTH } from './track'

/** Onde um ponto do desenho vai parar com a camada girada. */
function aplicar(t: readonly number[], x: number, y: number) {
  return t[0] * x + t[2] * y + t[4]
}

describe('guinada do carro', () => {
  it('sem giro, nenhuma camada sai do lugar', () => {
    for (const part of ['asaDianteira', 'bico', 'lateral', 'piloto', 'traseira', 'asaTraseira'] as const) {
      expect(yawTransform(part, 0)).toEqual([1, 0, 0, 1, 0, 0])
    }
  })

  it('girando para a direita, o bico vai para a direita e a traseira escapa para a esquerda', () => {
    // O pivô fica à frente do eixo traseiro: é a leitura da derrapagem, com a
    // traseira saindo para fora da curva.
    expect(PIVO_DA_GUINADA).toBeGreaterThan(0)
    const giro = 0.2
    const [xf, yf] = WHEEL_CENTERS.dianteiraDireita
    const [xt, yt] = WHEEL_CENTERS.traseiraDireita
    expect(aplicar(yawTransform('dianteiraDireita', giro), xf, yf)).toBeGreaterThan(xf)
    expect(aplicar(yawTransform('traseiraDireita', giro), xt, yt)).toBeLessThan(xt)
  })

  it('quanto mais longe do pivô, mais a camada anda', () => {
    // A asa dianteira, na ponta do carro, anda mais que as rodas da frente, que
    // andam mais que o piloto, sentado perto do pivô. Medido no eixo do carro,
    // onde só sobra o deslize: a asa um pouco acima das rodas da frente na
    // tela, que é onde ela está.
    const giro = 0.2
    const [, yRoda] = WHEEL_CENTERS.dianteiraEsquerda
    const asa = aplicar(yawTransform('asaDianteira', giro), 0, yRoda - 6)
    const roda = aplicar(yawTransform('dianteiraEsquerda', giro), 0, yRoda)
    const piloto = aplicar(yawTransform('piloto', giro), 0, 0)
    expect(asa).toBeGreaterThan(roda)
    expect(roda).toBeGreaterThan(piloto)
    expect(piloto).toBeGreaterThan(0)
  })

  it('é simétrica: girar para a esquerda espelha o giro para a direita', () => {
    for (const part of ['asaDianteira', 'dianteiraEsquerda', 'bico', 'lateral', 'cockpit', 'traseiraDireita', 'asaTraseira'] as const) {
      const direita = yawTransform(part, 0.18)
      const esquerda = yawTransform(part, -0.18)
      expect(esquerda[0]).toBeCloseTo(direita[0], 12)
      expect(esquerda[2]).toBeCloseTo(-direita[2], 12)
      expect(esquerda[4]).toBeCloseTo(-direita[4], 12)
    }
  })
})

describe('quadros de curva da folha', () => {
  it('o carro reto fica no meio da tira, e as pontas são as derrapagens cheias', () => {
    const meio = (CAR_FRAMES - 1) / 2
    expect(frameForPose(0)).toBe(meio)
    expect(poseOfFrame(meio)).toBe(0)
    expect(poseOfFrame(0)).toBe(-2)
    expect(poseOfFrame(CAR_FRAMES - 1)).toBe(2)
    expect(frameForPose(2)).toBe(CAR_FRAMES - 1)
    expect(frameForPose(-2)).toBe(0)
  })

  it('a curva comum mantém os nove quadros de esterço de sempre', () => {
    const comuns = new Set<number>()
    for (let pose = -1; pose <= 1 + 1e-9; pose += 0.01) comuns.add(frameForPose(pose))
    expect(comuns.size).toBe(9)
  })

  it('a pose anda pela tira sem pular nem voltar: é isso que faz a troca virar movimento', () => {
    let anterior = frameForPose(-2)
    for (let pose = -2; pose <= 2 + 1e-9; pose += 0.01) {
      const quadro = frameForPose(pose)
      expect(quadro - anterior).toBeGreaterThanOrEqual(0)
      expect(quadro - anterior).toBeLessThanOrEqual(1)
      anterior = quadro
    }
  })

  it('o quadro escolhido é sempre o mais perto da pose pedida', () => {
    for (let pose = -2; pose <= 2 + 1e-9; pose += 0.013) {
      const escolhida = poseOfFrame(frameForPose(pose))
      // Meio passo da tira, no trecho mais espaçado dela, que é o da derrapagem.
      expect(Math.abs(escolhida - pose)).toBeLessThanOrEqual(1 / 6 + 1e-9)
    }
  })

  it('pose fora da faixa ou inválida não quebra a escolha', () => {
    expect(frameForPose(9)).toBe(CAR_FRAMES - 1)
    expect(frameForPose(-9)).toBe(0)
    expect(frameForPose(Number.NaN)).toBe((CAR_FRAMES - 1) / 2)
  })
})

describe('folha cheia', () => {
  /** O carro do jogador, o maior da tela, em pixels do aparelho. */
  const maiorCarro = (larguraCss: number, densidade: number) =>
    Math.max(0.76, larguraCss / CAR_SPRITE_REFERENCE_WIDTH) * densidade

  it('celular em pé nunca a escolhe, em nenhuma densidade até 2', () => {
    for (let largura = 320; largura <= 763; largura += 1) {
      for (const densidade of [1, 1.25, 1.5, 1.75, 2]) {
        expect(precisaDaFolhaCheia(maiorCarro(largura, densidade))).toBe(false)
      }
    }
  })

  it('tela grande com densidade alta ainda a usa', () => {
    expect(precisaDaFolhaCheia(maiorCarro(1280, 2))).toBe(true)
    expect(precisaDaFolhaCheia(maiorCarro(915, 2))).toBe(true)
  })
})
