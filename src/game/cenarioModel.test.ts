import { describe, expect, it } from 'vitest'
import {
  TONS,
  VARIANTES,
  objetoModelado,
  type Detalhe,
  type FamiliaModelada,
} from './cenarioModel'
import type { Flora } from './layout'
import type { Face } from './pincel'

const FAMILIAS = Object.keys(VARIANTES) as FamiliaModelada[]
const FLORAS: Flora[] = ['verde', 'seca']
const DETALHES: Detalhe[] = ['cheio', 'simples']

/** Toda combinação que a folha de sprites vai assar. */
function* todas() {
  for (const familia of FAMILIAS) {
    for (const flora of FLORAS) {
      for (let variante = 0; variante < VARIANTES[familia]; variante += 1) {
        for (let tom = 0; tom < TONS[familia]; tom += 1) {
          for (const detalhe of DETALHES) {
            yield { familia, flora, variante, tom, detalhe }
          }
        }
      }
    }
  }
}

/**
 * Contorno de um caminho, somando os números dele.
 *
 * Só funciona porque nenhuma face usa arco — retas e quadráticas têm todos os
 * pontos de controle dentro ou em cima do contorno, então a caixa medida assim
 * nunca é menor que a de verdade. É a mesma medida que `carModel.test.ts` usa,
 * e é o que deixa cobrar que o objeto caiba na célula sem abrir um canvas.
 */
function contorno(faces: Face<string>[]) {
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  for (const face of faces) {
    const partes = face.d.split(/(?=[MLHVQZ])/)
    let ultimoX = 0
    let ultimoY = 0
    for (const parte of partes) {
      const comando = parte[0]
      const numeros = parte.slice(1).trim().split(/[\s,]+/).filter(Boolean).map(Number)
      if (comando === 'H') {
        for (const valor of numeros) ultimoX = valor
        x1 = Math.min(x1, ultimoX)
        x2 = Math.max(x2, ultimoX)
        continue
      }
      if (comando === 'V') {
        for (const valor of numeros) ultimoY = valor
        y1 = Math.min(y1, ultimoY)
        y2 = Math.max(y2, ultimoY)
        continue
      }
      for (let i = 0; i + 1 < numeros.length; i += 2) {
        ultimoX = numeros[i]
        ultimoY = numeros[i + 1]
        x1 = Math.min(x1, ultimoX)
        x2 = Math.max(x2, ultimoX)
        y1 = Math.min(y1, ultimoY)
        y2 = Math.max(y2, ultimoY)
      }
    }
  }
  return { x1, y1, x2, y2 }
}

describe('molde do cenário', () => {
  it('toda combinação que a folha vai assar tem desenho', () => {
    for (const { familia, flora, variante, tom, detalhe } of todas()) {
      const modelo = objetoModelado(familia, flora, variante, tom, detalhe)
      expect(modelo.faces.length, `${familia}/${detalhe}`).toBeGreaterThan(0)
      expect(modelo.meiaLargura, familia).toBeGreaterThan(0)
    }
  })

  it('nenhuma face é translúcida', () => {
    // É a regra que impede o objeto de mudar de cor ao trocar de nível de
    // detalhe. Quem desenha o cenário aplica a névoa da distância com
    // `globalAlpha`: face a face isso dá uma cor, e aplicado ao objeto já
    // composto na folha, dá outra. Onde há face translúcida sobreposta, as
    // duas não coincidem. Por isso a sombra no chão mora fora do modelo.
    for (const { familia, flora, variante, tom, detalhe } of todas()) {
      const modelo = objetoModelado(familia, flora, variante, tom, detalhe)
      for (const face of modelo.faces) {
        expect(face.opacity, `${familia}/${variante}/${detalhe}`).toBeUndefined()
      }
    }
  })

  it('nenhuma face usa arco', () => {
    // Sem arco, o contorno de qualquer peça é mensurável somando os números do
    // caminho — é disso que vivem os testes de caixa abaixo.
    for (const { familia, flora, variante, tom, detalhe } of todas()) {
      for (const face of objetoModelado(familia, flora, variante, tom, detalhe).faces) {
        expect(face.d, `${familia}/${detalhe}`).not.toMatch(/[aA]/)
      }
    }
  })

  it('todo objeto cabe na caixa que ele mesmo declara', () => {
    // O que passar da caixa é recortado sem aviso pela célula da folha, e some
    // do jogo sem sumir da bancada.
    for (const { familia, flora, variante, tom, detalhe } of todas()) {
      const modelo = objetoModelado(familia, flora, variante, tom, detalhe)
      const caixa = contorno(modelo.faces)
      const rotulo = `${familia}/${flora}/${variante}/${detalhe}`
      expect(caixa.x1, rotulo).toBeGreaterThanOrEqual(-modelo.meiaLargura)
      expect(caixa.x2, rotulo).toBeLessThanOrEqual(modelo.meiaLargura)
      expect(caixa.y1, rotulo).toBeGreaterThanOrEqual(-1)
      expect(caixa.y2, rotulo).toBeLessThanOrEqual(0)
    }
  })

  it('todo objeto se apoia no chão e ocupa a altura que promete', () => {
    // A caixa vai do chão ao topo: um objeto que não chegue perto das duas
    // pontas aparece flutuando ou menor do que o traçado pediu.
    for (const { familia, flora, variante, tom, detalhe } of todas()) {
      const caixa = contorno(objetoModelado(familia, flora, variante, tom, detalhe).faces)
      const rotulo = `${familia}/${flora}/${variante}/${detalhe}`
      expect(caixa.y2, rotulo).toBeCloseTo(0, 1)
      expect(caixa.y1, rotulo).toBeLessThan(-0.9)
    }
  })

  it('o detalhe simples ocupa a mesma silhueta do cheio', () => {
    // O objeto troca de célula ao se aproximar. Se as duas versões tiverem
    // contornos diferentes, ele muda de tamanho no meio da pista — que é
    // exatamente o defeito que a conífera tinha, parando a um terço do chão
    // quando desenhada com duas saias em vez de quatro.
    for (const familia of FAMILIAS) {
      for (let variante = 0; variante < VARIANTES[familia]; variante += 1) {
        const cheio = contorno(objetoModelado(familia, 'verde', variante, 0, 'cheio').faces)
        const simples = contorno(objetoModelado(familia, 'verde', variante, 0, 'simples').faces)
        const rotulo = `${familia}/${variante}`
        expect(simples.y1, rotulo).toBeCloseTo(cheio.y1, 1)
        expect(simples.x2 - simples.x1, rotulo).toBeCloseTo(cheio.x2 - cheio.x1, 0)
      }
    }
  })

  it('nenhuma célula da folha sai igual a outra', () => {
    // A variante existe para o cenário não parecer carimbado. Duas iguais
    // gastariam célula na folha sem entregar variedade nenhuma. Na árvore e no
    // arbusto a diferença é de forma; na placa é só de cor, e vale igual — o
    // que não pode é a célula sair idêntica.
    for (const familia of FAMILIAS) {
      const assinaturas = new Set<string>()
      for (let variante = 0; variante < VARIANTES[familia]; variante += 1) {
        const modelo = objetoModelado(familia, 'verde', variante, 0, 'cheio')
        assinaturas.add(modelo.faces.map((f) => `${f.d}${f.fill}`).join())
      }
      expect(assinaturas.size, familia).toBe(VARIANTES[familia])
    }
  })

  it('os tons de uma família dão cores diferentes', () => {
    for (const familia of FAMILIAS) {
      if (TONS[familia] < 2) continue
      const assinaturas = new Set<string>()
      for (let tom = 0; tom < TONS[familia]; tom += 1) {
        assinaturas.add(objetoModelado(familia, 'verde', 1, tom, 'cheio').faces.map((f) => f.fill).join())
      }
      expect(assinaturas.size, familia).toBe(TONS[familia])
    }
  })

  it('o molde fica em cache: pedir duas vezes devolve o mesmo objeto', () => {
    expect(objetoModelado('tree', 'verde', 1, 0, 'cheio')).toBe(objetoModelado('tree', 'verde', 1, 0, 'cheio'))
  })

  it('a vegetação seca não usa as cores da verde', () => {
    // O ambiente escolhe a paleta inteira. Uma família que ignorasse a flora
    // poria mato verde no meio da travessia seca.
    for (const familia of ['tree', 'bush', 'grass'] as const) {
      const verde = objetoModelado(familia, 'verde', 1, 0, 'cheio').faces.map((f) => f.fill)
      const seca = objetoModelado(familia, 'seca', 1, 0, 'cheio').faces.map((f) => f.fill)
      expect(seca, familia).not.toEqual(verde)
    }
  })
})
