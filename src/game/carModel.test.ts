import { describe, expect, it } from 'vitest'
import { CARS } from './cars'
import {
  CAIXA_CARRO,
  LINHA_DO_CHAO,
  MANCHAS_DE_TERRA,
  PARTS,
  RODAS,
  SOMBRA_DE_CONTATO,
  WHEEL_CENTERS,
  carModel,
  type Face,
} from './carModel'
import { CAR_SPRITE_HALF_WIDTH } from './track'

/**
 * Contorno de um caminho, somando os números dele.
 *
 * Só funciona porque nenhuma face usa arco: retas, `H`, `V` e quadráticas têm
 * todos os pontos de controle dentro ou em cima do contorno, então a caixa
 * medida assim nunca é menor que a de verdade. É o que basta para cobrar que o
 * desenho caiba onde promete — e é por isso que as elipses do molde são
 * polígonos.
 */
/**
 * Os polígonos de um caminho, um por subcaminho.
 *
 * As quadráticas entram pelo ponto de controle e pelo ponto final. Num canto
 * arredondado isso devolve o canto vivo — um pouco maior que o de verdade —,
 * o que só importaria para um ponto encostado exatamente num canto.
 */
function poligonos(d: string): [number, number][][] {
  const saida: [number, number][][] = []
  let atual: [number, number][] = []
  let x = 0
  let y = 0
  for (const parte of d.split(/(?=[MLHVQZ])/)) {
    const comando = parte[0]
    const n = parte.slice(1).trim().split(/[\s,]+/).filter(Boolean).map(Number)
    if (comando === 'M') {
      if (atual.length) saida.push(atual)
      atual = []
    }
    if (comando === 'Z') {
      if (atual.length) saida.push(atual)
      atual = []
      continue
    }
    if (comando === 'H') {
      for (const v of n) atual.push([(x = v), y])
      continue
    }
    if (comando === 'V') {
      for (const v of n) atual.push([x, (y = v)])
      continue
    }
    for (let i = 0; i + 1 < n.length; i += 2) atual.push([(x = n[i]), (y = n[i + 1])])
  }
  if (atual.length) saida.push(atual)
  return saida
}

/** Ponto dentro de polígono, pelo número de cruzamentos de um raio horizontal. */
function dentro(poligono: [number, number][], px: number, py: number) {
  let cruza = false
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i, i += 1) {
    const [xi, yi] = poligono[i]
    const [xj, yj] = poligono[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) cruza = !cruza
  }
  return cruza
}

function contorno(faces: Face[]) {
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  for (const face of faces) {
    expect(face.d, 'nenhuma face pode usar arco, senão a medida deixa de valer').not.toMatch(/[aA]/)
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

describe('molde dos carros', () => {
  it('todo carro da garagem tem desenho', () => {
    for (const car of CARS) {
      const modelo = carModel(car.id)
      expect(modelo.faces.length, car.id).toBeGreaterThan(100)
      expect(modelo.labels.length, car.id).toBeGreaterThan(0)
    }
  })

  it('o molde fica em cache: pedir duas vezes devolve o mesmo objeto', () => {
    // O SVG da garagem e a folha de sprites pedem o mesmo carro várias vezes.
    expect(carModel('senna')).toBe(carModel('senna'))
  })

  it('toda face e todo decalque pertencem a uma camada conhecida', () => {
    // Uma camada com nome errado sumiria do desenho sem erro nenhum, porque a
    // composição percorre `PARTS` e não as faces.
    const camadas = new Set<string>(PARTS)
    for (const car of CARS) {
      const modelo = carModel(car.id)
      for (const face of modelo.faces) expect(camadas.has(face.part), `${car.id}/${face.part}`).toBe(true)
      for (const label of modelo.labels) expect(camadas.has(label.part), `${car.id}/${label.part}`).toBe(true)
    }
  })

  it('a parte mais larga do carro é o pneu traseiro, na largura que a regra cobra', () => {
    // É o contrato entre desenho e regra: `OFF_ROAD_LIMIT` sai de
    // `CAR_SPRITE_HALF_WIDTH`, então o carro precisa ocupar na tela exatamente
    // essa meia-largura. Desenhar mais largo cobraria saída de pista com o
    // carro ainda no asfalto; mais estreito, o contrário.
    for (const car of CARS) {
      const modelo = carModel(car.id)
      const roda = contorno(modelo.faces.filter((face) => face.part === 'traseiraEsquerda'))
      const centro = WHEEL_CENTERS.traseiraEsquerda[0]
      expect(Math.abs(centro + roda.x1), car.id).toBeCloseTo(CAR_SPRITE_HALF_WIDTH, 1)
    }
  })

  it('nenhuma peça do meio do carro passa da largura dos pneus', () => {
    for (const car of CARS) {
      const modelo = carModel(car.id)
      const meio = contorno(modelo.faces.filter((face) => !RODAS.includes(face.part as never)))
      expect(Math.max(-meio.x1, meio.x2), car.id).toBeLessThanOrEqual(CAR_SPRITE_HALF_WIDTH)
    }
  })

  it('o desenho inteiro cabe na caixa que a folha de sprites recorta', () => {
    // O que passar da caixa é recortado sem aviso na hora de assar a folha, e
    // some do jogo sem sumir da garagem.
    for (const car of CARS) {
      const modelo = carModel(car.id)
      const caixa = contorno(modelo.faces.filter((face) => !RODAS.includes(face.part as never)))
      expect(caixa.x1, car.id).toBeGreaterThanOrEqual(CAIXA_CARRO.x)
      expect(caixa.x2, car.id).toBeLessThanOrEqual(CAIXA_CARRO.x + CAIXA_CARRO.largura)
      expect(caixa.y1, car.id).toBeGreaterThanOrEqual(CAIXA_CARRO.y)
      expect(caixa.y2, car.id).toBeLessThanOrEqual(CAIXA_CARRO.y + CAIXA_CARRO.altura)

      for (const roda of RODAS) {
        const local = contorno(modelo.faces.filter((face) => face.part === roda))
        const [centroX, centroY] = WHEEL_CENTERS[roda]
        expect(centroX + local.x1, `${car.id}/${roda}`).toBeGreaterThanOrEqual(CAIXA_CARRO.x)
        expect(centroX + local.x2, `${car.id}/${roda}`).toBeLessThanOrEqual(CAIXA_CARRO.x + CAIXA_CARRO.largura)
        expect(centroY + local.y1, `${car.id}/${roda}`).toBeGreaterThanOrEqual(CAIXA_CARRO.y)
        expect(centroY + local.y2, `${car.id}/${roda}`).toBeLessThanOrEqual(CAIXA_CARRO.y + CAIXA_CARRO.altura)
      }
    }
  })

  it('os quatro pneus encostam no chão na mesma linha da sombra', () => {
    // A linha do chão é onde os efeitos da pista nascem. Um pneu traseiro que
    // não a encoste deixa o carro flutuando sobre a própria poeira.
    const modelo = carModel('senna')
    for (const roda of ['traseiraEsquerda', 'traseiraDireita'] as const) {
      const local = contorno(modelo.faces.filter((face) => face.part === roda))
      expect(WHEEL_CENTERS[roda][1] + local.y2, roda).toBeCloseTo(LINHA_DO_CHAO, 0)
    }
    // As rodas dianteiras tocam o chão mais acima na tela, porque estão mais
    // longe: é a perspectiva, não um erro de apoio.
    for (const roda of ['dianteiraEsquerda', 'dianteiraDireita'] as const) {
      const local = contorno(modelo.faces.filter((face) => face.part === roda))
      expect(WHEEL_CENTERS[roda][1] + local.y2, roda).toBeLessThan(LINHA_DO_CHAO)
    }
  })

  it('a sombra de contato atravessa a linha do chão', () => {
    // A corrida desenha a sombra ao vivo, fora da folha, e a garagem a assa
    // junto com o carro. As duas saem desta lista — e se ela descolar da linha
    // do chão, o carro passa a flutuar nos dois lugares ao mesmo tempo.
    const corpo = SOMBRA_DE_CONTATO.filter((m) => !m.roda)
    expect(corpo).toHaveLength(1)
    expect(corpo[0].y - corpo[0].ry).toBeLessThan(LINHA_DO_CHAO)
    expect(corpo[0].y + corpo[0].ry).toBeGreaterThan(LINHA_DO_CHAO)
    // Uma por pneu, cada uma sob o pneu dela — é o que deixa a corrida girar
    // a sombra junto com a roda sem precisar adivinhar qual é qual.
    for (const roda of RODAS) {
      const sob = SOMBRA_DE_CONTATO.filter((m) => m.roda === roda)
      expect(sob, roda).toHaveLength(1)
      expect(sob[0].x, roda).toBeCloseTo(WHEEL_CENTERS[roda][0], 6)
      if (!roda.startsWith('traseira')) continue
      expect(sob[0].y - sob[0].ry, roda).toBeLessThan(LINHA_DO_CHAO)
      expect(sob[0].y + sob[0].ry, roda).toBeGreaterThan(LINHA_DO_CHAO)
    }
    // E é a mesma sombra que a garagem assa, não uma cópia.
    for (const car of CARS) {
      const assadas = carModel(car.id).faces.filter((face) => face.part === 'sombra')
      expect(assadas, car.id).toHaveLength(SOMBRA_DE_CONTATO.length)
    }
  })

  it('a terra da grama cai sobre o carro, e não no asfalto em volta dele', () => {
    // As manchas saem da posição dos pneus justamente para cair na carroceria
    // de qualquer carro. Uma que sobrasse para fora apareceria como barro
    // flutuando ao lado do carro — pior do que carro limpo. Cobra-se a mancha
    // inteira, e não só o centro dela.
    for (const car of CARS) {
      const modelo = carModel(car.id)
      const pecas = modelo.faces
        .filter((face) => face.part !== 'sombra')
        .flatMap((face) => {
          const [dx, dy] = (RODAS as readonly string[]).includes(face.part)
            ? WHEEL_CENTERS[face.part as (typeof RODAS)[number]]
            : [0, 0]
          return poligonos(face.d).map((poligono) => poligono.map(([x, y]) => [x + dx, y + dy] as [number, number]))
        })
      for (const m of MANCHAS_DE_TERRA) {
        const pontos: [number, number][] = [
          [m.x, m.y], [m.x - m.rx, m.y], [m.x + m.rx, m.y], [m.x, m.y - m.ry], [m.x, m.y + m.ry],
        ]
        for (const [px, py] of pontos) {
          const coberto = pecas.some((poligono) => dentro(poligono, px, py))
          expect(coberto, `${car.id}: terra em (${px.toFixed(1)}, ${py.toFixed(1)})`).toBe(true)
        }
      }
    }
  })

  it('a luz de chuva e o escapamento ficam no eixo do carro e acima do chão', () => {
    for (const car of CARS) {
      const { luzDeChuva, escapamento } = carModel(car.id)
      expect(luzDeChuva.x, car.id).toBe(0)
      expect(escapamento.x, car.id).toBe(0)
      expect(luzDeChuva.y, car.id).toBeLessThan(LINHA_DO_CHAO)
      expect(escapamento.y, car.id).toBeLessThan(luzDeChuva.y)
    }
  })

  it('cada carro tem a própria pintura: dois não saem iguais', () => {
    // A escolha do carro só existe para ser vista. Duas pinturas iguais fariam
    // a garagem oferecer uma decisão que não muda nada na tela.
    const assinaturas = CARS.map((car) => carModel(car.id).faces.map((face) => face.fill).join())
    expect(new Set(assinaturas).size).toBe(CARS.length)
  })
})
