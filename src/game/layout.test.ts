import { describe, expect, it } from 'vitest'
import {
  AMBIENT_COUNT,
  ambientFor,
  createGantry,
  createSceneryItem,
  createTrackLayout,
  curvatureLoad,
  firstSceneryIndex,
  GANTRY_EVERY,
  hash32,
  HEADING_LIMIT,
  lastSceneryIndex,
  MAX_CURVATURE,
  MAX_SLOPE_DELTA,
  randomAt,
  ROADSIDE_MARGIN,
  SCENERY_SPACING,
  SUPER_CURVE_APPROACH,
  SUPER_CURVE_COUNT,
  SUPER_CURVE_EXIT,
  SUPER_CURVE_FIRST,
  SUPER_CURVE_LAST,
  SUPER_CURVE_DRAW_EXAGGERATION,
  SUPER_CURVE_TYPES,
  SUPER_CURVE_UNITS,
  SUPER_CURVE_WALL_TAIL,
  SUPER_MAX_CURVATURE,
  VARIANTES_SORTEADAS,
  SLOPE_LIMIT,
  SLOPE_SEGMENT,
  START_STRAIGHT,
  type SceneryItem,
  type TrackLayout,
} from './layout'
import { rulesFor } from './rules'
import { MAX_CORNER_LOAD, type RaceContext } from './simulation'
import {
  CAMERA_DEPTH,
  roadProjection,
  ROAD_EDGE,
  SLOPE_RISE_SCALE,
  TRACK_LENGTH,
  VIEW_DISTANCE,
} from './track'

/** Sementes variadas, para nenhuma conclusão depender de um sorteio feliz. */
const SEMENTES = [0, 1, 7, 42, 1_337, 99_991, 0x7fffffff, 0xdeadbeef]

/** Fotografia completa de um traçado, para comparar duas gerações. */
function fotografar(seed: number) {
  const layout = createTrackLayout(seed)
  const item = createSceneryItem()
  const linhas: string[] = []
  for (let d = 0; d <= TRACK_LENGTH; d += 25) linhas.push(layout.heading(d).toFixed(9))
  for (let d = 0; d <= TRACK_LENGTH; d += 25) linhas.push(layout.lateralAhead(d, 120).toFixed(9))
  for (let d = 0; d <= TRACK_LENGTH; d += 25) linhas.push(layout.elevation(d).toFixed(9))
  for (const curva of layout.superCurves) linhas.push(`${curva.name}:${curva.start}:${curva.side}`)
  for (let i = 0; i < 400; i += 1) {
    for (const lado of [-1, 1] as const) {
      linhas.push(layout.scenery(i, lado, item) ? descrever(item) : '-')
    }
  }
  return linhas.join('|')
}

function descrever(item: SceneryItem) {
  return `${item.kind}:${item.lateral.toFixed(6)}:${item.scale.toFixed(6)}:${item.tone.toFixed(6)}:${item.variant}`
}

describe('mistura determinística', () => {
  it('a mesma entrada devolve sempre o mesmo número', () => {
    expect(hash32(123, 45)).toBe(hash32(123, 45))
    expect(randomAt(123, 45, 3)).toBe(randomAt(123, 45, 3))
  })

  it('índices vizinhos não produzem resultados parecidos', () => {
    const seguidos = []
    for (let i = 0; i < 64; i += 1) seguidos.push(randomAt(999, i))
    // Sem correlação visível: a diferença média entre vizinhos fica perto de 1/3,
    // que é o esperado de dois sorteios independentes.
    let soma = 0
    for (let i = 1; i < seguidos.length; i += 1) soma += Math.abs(seguidos[i] - seguidos[i - 1])
    expect(soma / (seguidos.length - 1)).toBeGreaterThan(0.22)
  })

  it('os canais são independentes entre si', () => {
    expect(randomAt(5, 5, 0)).not.toBe(randomAt(5, 5, 1))
    expect(randomAt(5, 5, 1)).not.toBe(randomAt(5, 5, 2))
  })

  it('devolve sempre um número entre 0 e 1', () => {
    for (let i = 0; i < 2_000; i += 1) {
      const valor = randomAt(i * 31, i, i % 5)
      expect(valor).toBeGreaterThanOrEqual(0)
      expect(valor).toBeLessThan(1)
    }
  })
})

describe('mesma semente, mesma pista', () => {
  it('duas gerações da mesma semente são idênticas', () => {
    for (const seed of SEMENTES) {
      expect(fotografar(seed)).toBe(fotografar(seed))
    }
  })

  it('sementes diferentes produzem traçados mensuravelmente diferentes', () => {
    const fotos = SEMENTES.map(fotografar)
    expect(new Set(fotos).size).toBe(SEMENTES.length)

    // E a diferença é grande, não um detalhe no terceiro decimal.
    const a = createTrackLayout(1)
    const b = createTrackLayout(2)
    let maior = 0
    for (let d = 0; d <= TRACK_LENGTH; d += 10) {
      maior = Math.max(maior, Math.abs(a.lateralAhead(d, 150) - b.lateralAhead(d, 150)))
    }
    expect(maior).toBeGreaterThan(20)
  })

  it('a ordem das consultas não altera o resultado', () => {
    const layout = createTrackLayout(4_242)
    const item = createSceneryItem()

    const direto: string[] = []
    for (let i = 0; i < 60; i += 1) direto.push(layout.scenery(i, 1, item) ? descrever(item) : '-')

    // As mesmas vagas, consultadas de trás para a frente e intercaladas com o
    // outro lado: o quadro desenha nessa ordem, e nada pode mudar por isso.
    const embaralhado: string[] = new Array(60)
    for (let i = 59; i >= 0; i -= 1) {
      layout.scenery(i, -1, item)
      embaralhado[i] = layout.scenery(i, 1, item) ? descrever(item) : '-'
    }
    expect(embaralhado).toEqual(direto)
  })
})

/** Quanto as super curvas que já terminaram viraram, até aquela distância. */
function viradaDasSuperCurvas(layout: TrackLayout, distancia: number) {
  let soma = 0
  for (const curva of layout.superCurves) if (curva.end <= distancia) soma += curva.side * curva.turn
  return soma
}

describe('limites da curva', () => {
  it('fora das super curvas, o rumo comum nunca passa do limite declarado', () => {
    // O rumo total soma as super curvas, e por isso não tem limite. O que é
    // do traçado comum continua preso a ±HEADING_LIMIT.
    for (const seed of SEMENTES) {
      const layout = createTrackLayout(seed)
      for (let d = 0; d <= TRACK_LENGTH + VIEW_DISTANCE; d += 3) {
        if (layout.superCurveAt(d)) continue
        const comum = layout.heading(d) - viradaDasSuperCurvas(layout, d)
        expect(Math.abs(comum)).toBeLessThanOrEqual(HEADING_LIMIT + 1e-9)
      }
    }
  })

  it('fora das super curvas, nenhuma curva chega perto de 90 graus', () => {
    // As curvas comuns fazem o ritmo, e o critério antigo continua valendo
    // para elas: a mudança de rumo entre dois pontos quaisquer.
    const limite = Math.PI / 2
    for (const seed of SEMENTES) {
      const layout = createTrackLayout(seed)
      let maior = 0
      for (let d = 0; d <= TRACK_LENGTH; d += 5) {
        for (const adiante of [50, 130, 260, 430]) {
          const cruza = layout.superCurves.some((curva) => d < curva.end && d + adiante > curva.start)
          if (cruza) continue
          maior = Math.max(maior, Math.abs(layout.heading(d + adiante) - layout.heading(d)))
        }
      }
      expect(maior).toBeLessThan(limite)
      // E com folga larga: o pior caso é a inversão de um extremo ao outro.
      expect(maior).toBeLessThanOrEqual(2 * HEADING_LIMIT + 1e-9)
    }
  })

  it('a curvatura respeita o limite de cada tipo de curva', () => {
    for (const seed of SEMENTES) {
      const layout = createTrackLayout(seed)
      for (let d = 1; d <= TRACK_LENGTH; d += 2) {
        const limite = layout.superCurveAt(d) ? SUPER_MAX_CURVATURE : MAX_CURVATURE
        expect(Math.abs(layout.curvature(d))).toBeLessThanOrEqual(limite + 1e-9)
      }
    }
  })

  it('não há quinas: a curvatura muda de forma contínua', () => {
    // Uma quina apareceria como um salto de curvatura entre dois pontos
    // vizinhos. O limite é o que a suavização permite em um metro: na super
    // curva, a derivada da curvatura vale no máximo 6·virada/comprimento², e é
    // o trecho mais curto e mais virado que dá o pior caso.
    const inclinacaoMaxima = Math.max(
      ...SUPER_CURVE_TYPES.flatMap((tipo) => tipo.trechos.map((trecho) => (6 * trecho.virada) / trecho.comprimento ** 2)),
    )
    for (const seed of SEMENTES) {
      const layout = createTrackLayout(seed)
      let anterior = layout.curvature(1)
      for (let d = 2; d <= TRACK_LENGTH; d += 1) {
        const atual = layout.curvature(d)
        const salto = layout.superCurveAt(d) || layout.superCurveAt(d - 1) ? inclinacaoMaxima * 1.01 : MAX_CURVATURE / 20
        expect(Math.abs(atual - anterior)).toBeLessThan(salto)
        anterior = atual
      }
    }
  })

  it('no referencial do carro, a pista sai reta à frente dele', () => {
    // É a câmera de perseguição: o rumo de referência é o da pista sob o
    // carro. Logo adiante, a pista ainda aponta para onde o carro aponta.
    for (const seed of SEMENTES) {
      const layout = createTrackLayout(seed)
      for (let p = 0; p <= TRACK_LENGTH; p += 7) {
        expect(layout.lateralAhead(p, 0)).toBeCloseTo(0, 9)
        // Três metros adiante, o desvio é o da curvatura: κ·d²/2, com folga
        // para a interpolação da tabela.
        expect(Math.abs(layout.lateralAhead(p, 3))).toBeLessThan(SUPER_MAX_CURVATURE * 4.5 + 0.05)
      }
    }
  })

  it('o desvio lateral é a integral de quanto a pista vira dali em diante', () => {
    for (const seed of [1, 42, 99_991]) {
      const layout = createTrackLayout(seed)
      for (let p = 300; p <= TRACK_LENGTH; p += 97) {
        let integral = 0
        const rumoAqui = layout.heading(p)
        for (let u = 0; u < 150; u += 0.25) integral += (layout.heading(p + u + 0.125) - rumoAqui) * 0.25
        expect(Math.abs(layout.lateralAhead(p, 150) - integral)).toBeLessThan(0.5)
      }
    }
  })

  it('a linha central é contínua, sem degrau entre um metro e o seguinte', () => {
    for (const seed of SEMENTES) {
      const layout = createTrackLayout(seed)
      for (let p = 0; p <= TRACK_LENGTH; p += 211) {
        let anterior = layout.lateralAhead(p, 0)
        for (let a = 1; a <= VIEW_DISTANCE; a += 1) {
          const atual = layout.lateralAhead(p, a)
          // Um metro adiante desloca, no máximo, o quanto a pista virou até ali.
          const virou = Math.abs(layout.heading(p + a) - layout.heading(p)) + Math.abs(layout.heading(p + a - 1) - layout.heading(p))
          expect(Math.abs(atual - anterior)).toBeLessThanOrEqual(virou / 2 + 0.05)
          anterior = atual
        }
      }
    }
  })

  it('o que não é reta vira de verdade, e ainda sobra reta para o boost', () => {
    // Com o sorteio uniforme, metade dos trechos com curva mal virava: nem
    // curva que cobrasse nada, nem reta onde soltar o boost. Medido em cinco
    // sementes: a curva forte e a reta limpa têm, as duas, espaço na prova.
    for (const semente of [1, 7, 42, 20_250, 99_999]) {
      const layout = createTrackLayout(semente)
      let forte = 0
      let limpa = 0
      let amostras = 0
      for (let d = START_STRAIGHT; d < TRACK_LENGTH; d += 5) {
        const carga = Math.abs(curvatureLoad(layout.curvature(d)))
        if (carga > 0.5) forte += 1
        if (carga < 0.1) limpa += 1
        amostras += 1
      }
      expect(forte / amostras, `semente ${semente}`).toBeGreaterThan(0.15)
      expect(limpa / amostras, `semente ${semente}`).toBeGreaterThan(0.08)
    }
  })

  it('a largada acontece em reta', () => {
    for (const seed of SEMENTES) {
      const layout = createTrackLayout(seed)
      // A largada é reta por construção: a arrancada precisa de uma
      // referência sem curva, e ninguém deve brigar com a curva antes de o
      // carro chegar ao ritmo.
      for (let d = 0; d <= START_STRAIGHT; d += 5) {
        expect(Math.abs(layout.heading(d))).toBeLessThan(1e-9)
      }
      // E logo depois a pista volta a ter vida.
      let temCurva = false
      for (let d = 0; d <= TRACK_LENGTH; d += 5) if (Math.abs(layout.heading(d)) > 0.05) temCurva = true
      expect(temCurva).toBe(true)
    }
  })
})

describe('cenário lateral', () => {
  it('nada invade o asfalto nem a faixa jogável', () => {
    const item = createSceneryItem()
    for (const seed of SEMENTES) {
      const layout = createTrackLayout(seed)
      for (let i = 0; i < 600; i += 1) {
        for (const lado of [-1, 1] as const) {
          if (!layout.scenery(i, lado, item)) continue
          expect(Math.abs(item.lateral)).toBeGreaterThan(ROAD_EDGE)
          expect(Math.sign(item.lateral)).toBe(lado)
        }
      }
    }
  })

  it('a margem de segurança fica fora da borda do asfalto', () => {
    expect(ROADSIDE_MARGIN).toBeGreaterThan(ROAD_EDGE)
  })

  it('deixa áreas de respiro e não enche todas as vagas', () => {
    const item = createSceneryItem()
    for (const seed of SEMENTES) {
      const layout = createTrackLayout(seed)
      let ocupadas = 0
      let total = 0
      for (let i = 0; i < 500; i += 1) {
        for (const lado of [-1, 1] as const) {
          total += 1
          if (layout.scenery(i, lado, item)) ocupadas += 1
        }
      }
      const ocupacao = ocupadas / total
      expect(ocupacao).toBeGreaterThan(0.15)
      expect(ocupacao).toBeLessThan(0.75)
    }
  })

  it('duas árvores nunca ocupam vagas vizinhas do mesmo lado', () => {
    const item = createSceneryItem()
    for (const seed of SEMENTES) {
      const layout = createTrackLayout(seed)
      for (const lado of [-1, 1] as const) {
        let anteriorEraArvore = false
        for (let i = 0; i < 500; i += 1) {
          const ocupada = layout.scenery(i, lado, item)
          const arvore = ocupada && item.kind === 'tree'
          if (anteriorEraArvore) expect(arvore).toBe(false)
          anteriorEraArvore = arvore
        }
      }
    }
  })

  it('trechos vizinhos não repetem a mesma sequência', () => {
    const item = createSceneryItem()
    const layout = createTrackLayout(20_250)
    const janelas: string[] = []
    for (let inicio = 0; inicio + 8 < 400; inicio += 8) {
      const janela: string[] = []
      for (let i = inicio; i < inicio + 8; i += 1) {
        for (const lado of [-1, 1] as const) {
          janela.push(layout.scenery(i, lado, item) ? item.kind : '-')
        }
      }
      janelas.push(janela.join(','))
    }
    for (let i = 1; i < janelas.length; i += 1) {
      expect(janelas[i]).not.toBe(janelas[i - 1])
    }
  })

  it('usa mais de uma família ao longo da prova', () => {
    const item = createSceneryItem()
    const layout = createTrackLayout(777)
    const familias = new Set<string>()
    for (let i = 0; i < 500; i += 1) {
      for (const lado of [-1, 1] as const) if (layout.scenery(i, lado, item)) familias.add(item.kind)
    }
    expect(familias.size).toBeGreaterThanOrEqual(3)
  })

  /** Todas as famílias que aparecem numa prova inteira, por semente. */
  function familiasDe(seed: number) {
    const layout = createTrackLayout(seed)
    const item = createSceneryItem()
    const familias = new Set<string>()
    for (let i = 0; i < 800; i += 1) {
      for (const lado of [-1, 1] as const) if (layout.scenery(i, lado, item)) familias.add(item.kind)
    }
    return { lugar: layout.ambient.lugar, familias }
  }

  it('cada lugar tem o próprio repertório de objetos', () => {
    // É o que Top Gear fazia trocando de país: a mesma pista parece outra com
    // outro repertório na beira. Sem isto os quatro ambientes voltam a ser a
    // mesma paisagem em horas diferentes do dia.
    const PROIBIDAS: Record<string, string[]> = {
      campo: ['predio', 'poste', 'cacto', 'pedra', 'guardrail'],
      cidade: ['tree', 'cacto', 'pedra', 'fence'],
      montanha: ['predio', 'cacto', 'poste'],
      deserto: ['tree', 'predio', 'poste', 'bush', 'guardrail'],
    }
    const vistos = new Set<string>()
    for (let seed = 1; seed <= 120; seed += 1) {
      const { lugar, familias } = familiasDe(seed)
      vistos.add(lugar)
      for (const proibida of PROIBIDAS[lugar]) {
        expect(familias.has(proibida), `${lugar} não devia ter ${proibida}`).toBe(false)
      }
    }
    // E os quatro lugares precisam sair do sorteio, senão o teste acima não
    // está cobrindo nada.
    expect(vistos.size).toBe(AMBIENT_COUNT)
  })

  it('a mesma semente dá a mesma sequência de famílias', () => {
    // Os dois pilotos reconstroem a pista sozinhos, cada um no seu aparelho.
    // Uma família que dependesse de qualquer coisa fora da semente poria os
    // dois em paisagens diferentes.
    for (const seed of [3, 41, 905]) {
      const a = createTrackLayout(seed)
      const b = createTrackLayout(seed)
      const ia = createSceneryItem()
      const ib = createSceneryItem()
      for (let i = 0; i < 400; i += 1) {
        for (const lado of [-1, 1] as const) {
          expect(a.scenery(i, lado, ia)).toBe(b.scenery(i, lado, ib))
          expect(ia.kind).toBe(ib.kind)
          expect(ia.lateral).toBe(ib.lateral)
          expect(ia.variant).toBe(ib.variant)
        }
      }
    }
  })

  it('a variante sorteada fica no intervalo que o desenho espera', () => {
    // Quem desenha reduz a variante ao repertório da própria família. Se o
    // sorteio passasse deste intervalo, a redução escolheria a forma errada em
    // vez de falhar — um defeito silencioso.
    const layout = createTrackLayout(52)
    const item = createSceneryItem()
    for (let i = 0; i < 400; i += 1) {
      for (const lado of [-1, 1] as const) {
        if (!layout.scenery(i, lado, item)) continue
        expect(item.variant).toBeGreaterThanOrEqual(0)
        expect(item.variant).toBeLessThan(VARIANTES_SORTEADAS)
        expect(Number.isInteger(item.variant)).toBe(true)
      }
    }
  })

  it('o pórtico cai em marcos espaçados e não em toda vaga', () => {
    // Ele é emitido de dentro do laço do cenário para entrar na ordem de
    // profundidade certa. Se caísse em qualquer índice, o arco apareceria
    // entre árvores da mesma vaga em vez de atrás delas.
    const layout = createTrackLayout(31)
    const portico = createGantry()
    let marcos = 0
    for (let i = 1; i < 800; i += 1) {
      if (!layout.gantry(i, portico)) continue
      expect(i % GANTRY_EVERY, `índice ${i}`).toBe(0)
      marcos += 1
    }
    // Nem todo marco recebe arco, mas a prova inteira não pode ficar sem.
    const possiveis = Math.floor(799 / GANTRY_EVERY)
    expect(marcos).toBeGreaterThan(possiveis * 0.3)
    expect(marcos).toBeLessThan(possiveis)
  })

  it('o pórtico é o mesmo nos dois aparelhos', () => {
    const a = createTrackLayout(88)
    const b = createTrackLayout(88)
    const pa = createGantry()
    const pb = createGantry()
    for (let i = 0; i < 600; i += 1) {
      expect(a.gantry(i, pa)).toBe(b.gantry(i, pb))
      expect(pa.variant).toBe(pb.variant)
    }
  })

  it('preenche o objeto do chamador em vez de alocar um novo', () => {
    const layout = createTrackLayout(3)
    const item = createSceneryItem()
    const antes = item
    for (let i = 0; i < 100; i += 1) layout.scenery(i, 1, item)
    // O mesmo objeto atravessa o quadro inteiro: nada é criado no laço.
    expect(item).toBe(antes)
  })

  it('só considera as vagas à frente e dentro do campo de visão', () => {
    const progresso = 1_234
    const primeiro = firstSceneryIndex(progresso)
    const ultimo = lastSceneryIndex(progresso)
    expect(primeiro * SCENERY_SPACING).toBeGreaterThanOrEqual(progresso)
    expect(ultimo * SCENERY_SPACING).toBeLessThanOrEqual(progresso + VIEW_DISTANCE)
    expect((primeiro - 1) * SCENERY_SPACING).toBeLessThan(progresso)
  })

  it('um objeto não muda de lugar nem de tipo enquanto o carro se aproxima', () => {
    const layout = createTrackLayout(8_888)
    const item = createSceneryItem()
    const indice = 61
    const esperado = layout.scenery(indice, 1, item) ? descrever(item) : '-'

    // A faixa de progresso em que essa vaga está à vista sai das constantes,
    // para o teste não quebrar se o espaçamento mudar de novo.
    const onde = indice * SCENERY_SPACING
    for (const progresso of [onde - VIEW_DISTANCE + 1, onde - 200, onde - 50, onde]) {
      expect(firstSceneryIndex(progresso)).toBeLessThanOrEqual(indice)
      expect(lastSceneryIndex(progresso)).toBeGreaterThanOrEqual(indice)
      const agora = layout.scenery(indice, 1, item) ? descrever(item) : '-'
      expect(agora).toBe(esperado)
    }
    // Depois de passar, some do campo de visão.
    expect(firstSceneryIndex(indice * SCENERY_SPACING + 1)).toBeGreaterThan(indice)
  })
})

describe('relevo', () => {
  it('a inclinação nunca passa do limite declarado', () => {
    for (const seed of SEMENTES) {
      const layout = createTrackLayout(seed)
      for (let d = 0; d <= TRACK_LENGTH + VIEW_DISTANCE; d += 3) {
        expect(Math.abs(layout.slope(d))).toBeLessThanOrEqual(SLOPE_LIMIT + 1e-9)
      }
    }
  })

  it('a inclinação muda de forma contínua, sem degrau', () => {
    // A suavização tem derivada nula nas pontas de cada trecho, então a
    // emenda entre dois trechos não produz quebra.
    const saltoMaximo = (2 * MAX_SLOPE_DELTA) / SLOPE_SEGMENT
    for (const seed of SEMENTES) {
      const layout = createTrackLayout(seed)
      let anterior = layout.slope(0)
      for (let d = 1; d <= TRACK_LENGTH; d += 1) {
        const atual = layout.slope(d)
        expect(Math.abs(atual - anterior)).toBeLessThan(saltoMaximo)
        anterior = atual
      }
    }
  })

  it('a altura é a integral da inclinação, e começa plana', () => {
    for (const seed of SEMENTES) {
      const layout = createTrackLayout(seed)
      // Os três primeiros trechos são planos: a arrancada não acontece numa
      // rampa. A margem de 20 m no fim existe porque a tabela de alturas é
      // amostrada a cada 8 m, e a última amostra do trecho plano já encosta
      // no primeiro trecho inclinado.
      for (let d = 0; d <= SLOPE_SEGMENT * 2 - 20; d += 5) {
        expect(Math.abs(layout.slope(d))).toBeLessThan(1e-9)
        expect(Math.abs(layout.elevation(d))).toBeLessThan(1e-9)
      }

      // E daí em diante a altura acompanha a inclinação. A tolerância é
      // larga de propósito: a tabela de alturas é interpolada em linha reta
      // entre amostras de 8 m, então a derivada dela é a inclinação *média*
      // do intervalo, não a instantânea do ponto.
      for (let d = 600; d <= TRACK_LENGTH; d += 97) {
        const derivada = (layout.elevation(d + 1) - layout.elevation(d - 1)) / 2
        expect(derivada).toBeCloseTo(layout.slope(d), 2)
      }
    }
  })

  it('a prova tem subidas e descidas de verdade', () => {
    for (const seed of SEMENTES) {
      const layout = createTrackLayout(seed)
      let sobe = false
      let desce = false
      for (let d = 0; d <= TRACK_LENGTH; d += 5) {
        if (layout.slope(d) > 0.02) sobe = true
        if (layout.slope(d) < -0.02) desce = true
      }
      expect(sobe).toBe(true)
      expect(desce).toBe(true)
    }
  })

  /**
   * O invariante que sustenta o desenho do relevo.
   *
   * A pista *pode* se dobrar sobre si mesma numa lomba — com a perspectiva
   * de verdade isso é inevitável se o relevo tiver amplitude. Quem trata é o
   * recorte no desenho, que descarta a fatia caída atrás da crista. O que não
   * pode acontecer é a crista engolir a pista: se metade das fatias sumisse,
   * o piloto perderia de vista os obstáculos.
   *
   * Este teste refaz exatamente o laço do render e mede o quanto some.
   */
  it('uma lomba nunca engole a pista', () => {
    const FATIAS = 84
    const escalaMinima = CAMERA_DEPTH / (CAMERA_DEPTH + VIEW_DISTANCE)
    const distanciaDaFatia = (fracao: number) =>
      CAMERA_DEPTH * (1 / (1 - fracao * (1 - escalaMinima)) - 1)

    const telas = [640, 720, 1015]
    let pior = 0

    for (const seed of SEMENTES) {
      const layout = createTrackLayout(seed)
      for (const altura of telas) {
        for (let progresso = 0; progresso <= TRACK_LENGTH; progresso += 97) {
          const alturaAqui = layout.elevation(progresso)
          const projetar = (d: number) => {
            const { y, perspective } = roadProjection(d, 1_000, altura)
            return y - (layout.elevation(progresso + d) - alturaAqui) * altura * SLOPE_RISE_SCALE * perspective
          }

          let maxy = projetar(0)
          let escondidas = 0
          for (let j = 1; j <= FATIAS; j += 1) {
            const y = projetar(distanciaDaFatia(j / FATIAS))
            if (y >= maxy) escondidas += 1
            else maxy = y
          }
          pior = Math.max(pior, escondidas / FATIAS)
        }
      }
    }

    expect(pior).toBeLessThan(0.15)
  })
})

describe('ambiente da corrida', () => {
  it('sai da semente, então os dois pilotos correm no mesmo lugar', () => {
    for (const seed of SEMENTES) {
      expect(ambientFor(seed)).toBe(ambientFor(seed))
      expect(createTrackLayout(seed).ambient).toBe(ambientFor(seed))
    }
  })

  it('todos os ambientes aparecem ao longo de muitas corridas', () => {
    const vistos = new Set<string>()
    for (let seed = 0; seed < 400; seed += 1) vistos.add(ambientFor(seed * 104_729).nome)
    expect(vistos.size).toBe(AMBIENT_COUNT)
  })

  it('cada ambiente traz a paleta completa', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const ambiente = ambientFor(seed * 7_919)
      for (const cor of [
        ambiente.ceuTopo,
        ambiente.ceuMeio,
        ambiente.ceuBaixo,
        ambiente.serra,
        ambiente.chao,
        ambiente.gramaClara,
        ambiente.gramaEscura,
        ambiente.asfaltoClaro,
        ambiente.asfaltoEscuro,
      ]) {
        expect(cor).toMatch(/^#[0-9a-f]{6}$/)
      }
      // A névoa é montada como texto no gradiente, então precisa ser só os
      // três componentes — um "#aabbcc" aqui geraria uma cor inválida.
      expect(ambiente.nevoaRGB).toMatch(/^\d{1,3},\d{1,3},\d{1,3}$/)
      expect(['verde', 'seca']).toContain(ambiente.flora)
    }
  })

  it('não muda de ambiente no meio da corrida', () => {
    const layout = createTrackLayout(4_242)
    const primeiro = layout.ambient
    layout.elevation(2_000)
    layout.lateralAhead(3_500, 100)
    expect(layout.ambient).toBe(primeiro)
  })
})

describe('curvatura na escala da física', () => {
  it('cabe entre -1 e 1 nas curvas comuns, e no teto da física nas super curvas', () => {
    for (const semente of [1, 7, 42, 1_234, 99_999]) {
      const layout = createTrackLayout(semente)
      for (let distancia = 0; distancia <= TRACK_LENGTH; distancia += 5) {
        const carga = Math.abs(curvatureLoad(layout.curvature(distancia)))
        expect(carga).toBeLessThanOrEqual(layout.superCurveAt(distancia) ? MAX_CORNER_LOAD : 1 + 1e-9)
      }
    }
  })

  it('acima da curva comum, a carga cresce mais devagar, mas sempre cresce', () => {
    // O que parece mais fechado empurra mais — a compressão não inverte a
    // ordem de duas curvas, só encurta a distância entre elas.
    let anterior = 0
    for (let fracao = 0; fracao <= 1; fracao += 0.01) {
      const carga = curvatureLoad(fracao * SUPER_MAX_CURVATURE)
      expect(carga).toBeGreaterThanOrEqual(anterior)
      anterior = carga
    }
    expect(curvatureLoad(MAX_CURVATURE)).toBeCloseTo(1, 9)
    // O grampo empurra mais do dobro da pior curva comum, sem estourar o teto.
    expect(curvatureLoad(SUPER_MAX_CURVATURE)).toBeGreaterThan(2)
    expect(curvatureLoad(SUPER_MAX_CURVATURE)).toBeLessThanOrEqual(MAX_CORNER_LOAD)
  })

  it('preserva o sinal: a normalização não inverte o lado da curva', () => {
    const layout = createTrackLayout(42)
    for (let distancia = 0; distancia <= TRACK_LENGTH; distancia += 17) {
      const bruta = layout.curvature(distancia)
      if (bruta === 0) continue
      expect(Math.sign(curvatureLoad(bruta))).toBe(Math.sign(bruta))
    }
  })

  it('a reta da largada não impõe carga nenhuma', () => {
    // Os três primeiros trechos ficam em rumo zero de propósito, para a
    // arrancada ter uma referência sem curva.
    const layout = createTrackLayout(42)
    expect(Math.abs(curvatureLoad(layout.curvature(0)))).toBeLessThan(0.001)
    expect(Math.abs(curvatureLoad(layout.curvature(100)))).toBeLessThan(0.001)
  })

  it('usa boa parte da faixa: o traçado tem curvas que a física sente', () => {
    // Não basta a curvatura existir: ela precisa passar da aderência do nível
    // em uma fração relevante da pista, senão a curva volta a ser enfeite.
    const limiar = rulesFor('normal').cornerGrip
    for (const semente of [1, 7, 42, 1_234, 99_999]) {
      const layout = createTrackLayout(semente)
      let exigentes = 0
      let amostras = 0
      for (let distancia = 0; distancia <= TRACK_LENGTH; distancia += 5) {
        amostras += 1
        if (Math.abs(curvatureLoad(layout.curvature(distancia))) > limiar) exigentes += 1
      }
      const fracao = exigentes / amostras
      expect(fracao).toBeGreaterThan(0.15)
      // E nem tanto que a pista inteira seja uma curva só.
      expect(fracao).toBeLessThan(0.75)
    }
  })
})

describe('super curvas', () => {
  /** Muitas sementes: o que se afirma aqui vale para qualquer prova. */
  const MUITAS = Array.from({ length: 60 }, (_, i) => i * 7_919 + 3)

  it('toda prova tem as quatro, uma de cada tipo, em ordem de distância', () => {
    for (const seed of MUITAS) {
      const curvas = createTrackLayout(seed).superCurves
      expect(curvas).toHaveLength(SUPER_CURVE_COUNT)
      expect(new Set(curvas.map((curva) => curva.name)).size).toBe(SUPER_CURVE_UNITS)
      for (let i = 1; i < curvas.length; i += 1) {
        // A segunda metade do S emenda na primeira; as outras têm reta entre si.
        if (curvas[i].linked) expect(curvas[i].start).toBe(curvas[i - 1].end)
        else expect(curvas[i].start).toBeGreaterThan(curvas[i - 1].end)
      }
    }
  })

  it('viram de verdade: de 90 a 270 graus, e para os dois lados', () => {
    for (const seed of MUITAS) {
      const layout = createTrackLayout(seed)
      for (const curva of layout.superCurves) {
        // Dentro da janela o traçado comum é reto, então a virada é toda dela.
        const virada = layout.heading(curva.end) - layout.heading(curva.start)
        expect(virada * curva.side).toBeCloseTo(curva.turn, 6)
        expect(curva.turn).toBeGreaterThanOrEqual(Math.PI / 2 - 1e-9)
        expect(curva.turn).toBeLessThanOrEqual((3 * Math.PI) / 2 + 1e-9)
      }
      // Todas para o mesmo lado deixariam um lado da pista sem uso.
      expect(new Set(layout.superCurves.map((curva) => curva.side)).size).toBe(2)
    }
  })

  it('o S são duas curvas de lados contrários, sem reta entre elas', () => {
    for (const seed of MUITAS) {
      const curvas = createTrackLayout(seed).superCurves
      const segunda = curvas.findIndex((curva) => curva.linked)
      expect(segunda).toBeGreaterThan(0)
      expect(curvas[segunda].name).toBe('S')
      expect(curvas[segunda - 1].name).toBe('S')
      expect(curvas[segunda].side).toBe(-curvas[segunda - 1].side)
      // Só o S emenda.
      expect(curvas.filter((curva) => curva.linked)).toHaveLength(1)
    }
  })

  it('o grampo é o mais fechado, e todas ficam entre 20 e 28 metros de raio no ápice', () => {
    for (const tipo of SUPER_CURVE_TYPES) {
      for (const trecho of tipo.trechos) {
        const raio = trecho.comprimento / (1.5 * trecho.virada)
        expect(raio, tipo.nome).toBeGreaterThan(20)
        expect(raio, tipo.nome).toBeLessThan(28)
      }
    }
    const raioDoGrampo = 1 / SUPER_MAX_CURVATURE
    const grampo = SUPER_CURVE_TYPES.find((tipo) => tipo.nome === 'GRAMPO')!.trechos[0]
    expect(grampo.comprimento / (1.5 * grampo.virada)).toBeCloseTo(raioDoGrampo, 9)
  })

  it('ficam longe da largada e da chegada', () => {
    for (const seed of MUITAS) {
      for (const curva of createTrackLayout(seed).superCurves) {
        expect(curva.start - SUPER_CURVE_APPROACH).toBeGreaterThanOrEqual(SUPER_CURVE_FIRST)
        expect(curva.end + SUPER_CURVE_EXIT).toBeLessThanOrEqual(SUPER_CURVE_LAST)
        expect(curva.start).toBeGreaterThan(START_STRAIGHT)
      }
    }
  })

  it('a aproximação e a saída são retas: nada esconde a curva', () => {
    for (const seed of MUITAS) {
      const layout = createTrackLayout(seed)
      const curvas = layout.superCurves
      curvas.forEach((curva, i) => {
        // A tolerância é de um centésimo da pior curva comum: na borda da
        // janela, o fim suavizado do trecho anterior ainda deixa um resto. As
        // metades do S não têm reta entre si, e só as pontas dele são cobradas.
        if (!curva.linked) {
          for (let d = curva.start - SUPER_CURVE_APPROACH; d <= curva.start; d += 2) {
            expect(Math.abs(layout.curvature(d))).toBeLessThan(MAX_CURVATURE / 100)
          }
        }
        if (!curvas[i + 1]?.linked) {
          for (let d = curva.end; d <= curva.end + SUPER_CURVE_EXIT; d += 2) {
            expect(Math.abs(layout.curvature(d))).toBeLessThan(MAX_CURVATURE / 100)
          }
        }
      })
    }
  })

  it('empurram mais que qualquer curva comum, e o grampo mais que todas', () => {
    for (const seed of [1, 42, 99_991]) {
      const layout = createTrackLayout(seed)
      for (const curva of layout.superCurves) {
        expect(Math.abs(curvatureLoad(layout.curvature(curva.apex)))).toBeCloseTo(curva.peakLoad, 3)
        expect(curva.peakLoad).toBeGreaterThan(1.5)
      }
      const grampo = layout.superCurves.find((curva) => curva.name === 'GRAMPO')!
      for (const curva of layout.superCurves) expect(grampo.peakLoad).toBeGreaterThanOrEqual(curva.peakLoad)
    }
  })

  it('a entrada e o miolo fogem dos obstáculos que todos os níveis têm', () => {
    // Uma barreira no ápice trancaria a única linha que passa — no primeiro
    // grampo que o visitante vê —, e um buraco na zebra de dentro puniria
    // justamente quem leu a nota de curva. Medido em sessenta sementes.
    const obstaculos = rulesFor('normal').obstacles
    let conflitos = 0
    for (const seed of MUITAS) {
      for (const curva of createTrackLayout(seed).superCurves) {
        const extensao = curva.end - curva.start
        for (const obstaculo of obstaculos) {
          const relativo = (obstaculo.distance - curva.start) / extensao
          // Nada no miolo, e nada do lado de dentro da entrada — dos 70 m antes
          // dela até a zebra, que é por onde a nota de curva manda passar.
          if (relativo > 0.15 && relativo < 0.85) conflitos += 1
          const naEntrada = obstaculo.distance > curva.start - 70 && relativo <= 0.15
          if (naEntrada && obstaculo.lane * curva.side > 0) conflitos += 1
        }
      }
    }
    expect(conflitos).toBe(0)
  })

  it('a zebra da tangência fica na entrada, do lado de dentro, e cabe um quadro lento', () => {
    for (const seed of MUITAS) {
      for (const curva of createTrackLayout(seed).superCurves) {
        expect(curva.kerbStart).toBeGreaterThan(curva.start)
        expect(curva.kerbEnd).toBeLessThan(curva.apex)
        // A vinte quadros por segundo, em cruzeiro, o carro anda 3,5 m por
        // quadro: a zebra precisa de vários quadros para não ser pulada.
        expect(curva.kerbEnd - curva.kerbStart).toBeGreaterThan(3.5 * 5)
      }
    }
  })

  it('por fora da super curva, o lugar é das placas: nenhum objeto de cenário', () => {
    const item = createSceneryItem()
    for (const seed of [1, 42, 99_991, 0xdeadbeef]) {
      const layout = createTrackLayout(seed)
      for (const curva of layout.superCurves) {
        const de = Math.ceil(curva.start / SCENERY_SPACING)
        const ate = Math.floor(curva.end / SCENERY_SPACING)
        for (let indice = de; indice <= ate; indice += 1) {
          expect(layout.scenery(indice, (-curva.side) as -1 | 1, item)).toBe(false)
        }
      }
    }
  })

  it('o contexto da física traz a carga, a linha e a zebra da tangência', () => {
    const layout = createTrackLayout(42)
    const context: RaceContext = { curvature: 0, slipstream: 0 }
    const curva = layout.superCurves[0]

    layout.fillContext(curva.apex, context)
    expect(Math.abs(context.curvature)).toBeGreaterThan(1)
    // Por dentro é do lado da curva: o ganho da linha tem o sinal dela.
    expect(Math.sign(context.lineGain!)).toBe(curva.side)
    expect(context.apexId).toBe(0)

    layout.fillContext((curva.kerbStart + curva.kerbEnd) / 2, context)
    expect(context.apexId).toBe(curva.id)
    expect(context.apexSide).toBe(curva.side)

    // Na reta da largada, nada.
    layout.fillContext(100, context)
    expect(context.curvature).toBeCloseTo(0, 9)
    expect(context.lineGain).toBeCloseTo(0, 9)
    expect(context.apexId).toBe(0)
    expect(context.apexSide).toBe(0)
  })

  it('o desenho exagera o giro das super curvas, e só delas', () => {
    const layout = createTrackLayout(42)
    // Numa reta longe de qualquer super curva, o desenho é o traçado.
    const primeira = layout.superCurves[0]
    for (let p = 0; p < primeira.start - SUPER_CURVE_APPROACH - VIEW_DISTANCE; p += 37) {
      expect(layout.bendAhead(p, 150)).toBeCloseTo(layout.lateralAhead(p, 150), 6)
    }
    // Na entrada de uma super curva, o desenho vira mais que o traçado.
    for (const curva of layout.superCurves.filter((c) => !c.linked)) {
      const desenhado = Math.abs(layout.bendAhead(curva.start - 20, 100))
      const tracado = Math.abs(layout.lateralAhead(curva.start - 20, 100))
      expect(desenhado).toBeGreaterThan(tracado * 1.3)
    }
    // E a paisagem gira com o rumo desenhado, que carrega o exagero.
    const curva = layout.superCurves[0]
    const giroDesenhado = layout.drawnHeading(curva.end) - layout.drawnHeading(curva.start)
    expect(giroDesenhado * curva.side).toBeCloseTo(curva.turn * SUPER_CURVE_DRAW_EXAGGERATION, 6)
  })

  it('o muro cobre o lado de fora da curva e um pouco da saída, menos na emenda do S', () => {
    for (const seed of MUITAS) {
      const layout = createTrackLayout(seed)
      const curvas = layout.superCurves
      curvas.forEach((curva, i) => {
        const context: RaceContext = { curvature: 0, slipstream: 0 }
        layout.fillContext((curva.start + curva.end) / 2, context)
        // O muro fica por fora: do lado contrário ao da curva.
        expect(context.wallSide).toBe(-curva.side)
        expect(context.wallId).toBe(curva.id)
        const emendada = curvas[i + 1]?.linked
        const fim = curva.end + (emendada ? 0 : SUPER_CURVE_WALL_TAIL)
        expect(layout.wallAt(fim - 0.5)?.id).toBe(curva.id)
        // Depois do resto da saída, o muro acaba — na emenda do S, é o muro da
        // segunda metade que começa, do outro lado.
        const depois = layout.wallAt(fim + 0.5)
        if (emendada) expect(depois?.id).toBe(curvas[i + 1].id)
        else expect(depois).toBeNull()
      })
      // Na reta da largada, nenhum muro.
      const context: RaceContext = { curvature: 0, slipstream: 0 }
      layout.fillContext(100, context)
      expect(context.wallSide).toBe(0)
      expect(context.wallId).toBe(0)
    }
  })

  it('a mesma semente dá as mesmas super curvas nos dois aparelhos', () => {
    for (const seed of SEMENTES) {
      expect(createTrackLayout(seed).superCurves).toEqual(createTrackLayout(seed).superCurves)
    }
  })
})
