import { describe, expect, it } from 'vitest'
import {
  AMBIENT_COUNT,
  ambientFor,
  createSceneryItem,
  createTrackLayout,
  CURVE_SEGMENT,
  firstSceneryIndex,
  hash32,
  HEADING_LIMIT,
  lastSceneryIndex,
  MAX_CURVATURE,
  MAX_SLOPE_DELTA,
  randomAt,
  ROADSIDE_MARGIN,
  SCENERY_SPACING,
  SLOPE_LIMIT,
  SLOPE_SEGMENT,
  type SceneryItem,
} from './layout'
import { roadProjection, ROAD_EDGE, SLOPE_RISE_SCALE, TRACK_LENGTH, VIEW_DISTANCE } from './track'

/** Sementes variadas, para nenhuma conclusão depender de um sorteio feliz. */
const SEMENTES = [0, 1, 7, 42, 1_337, 99_991, 0x7fffffff, 0xdeadbeef]

/** Fotografia completa de um traçado, para comparar duas gerações. */
function fotografar(seed: number) {
  const layout = createTrackLayout(seed)
  const item = createSceneryItem()
  const linhas: string[] = []
  for (let d = 0; d <= TRACK_LENGTH; d += 25) linhas.push(layout.centerOffset(d).toFixed(9))
  for (let d = 0; d <= TRACK_LENGTH; d += 25) linhas.push(layout.elevation(d).toFixed(9))
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
      maior = Math.max(maior, Math.abs(a.centerOffset(d) - b.centerOffset(d)))
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

describe('limites da curva', () => {
  it('o rumo nunca passa do limite declarado', () => {
    for (const seed of SEMENTES) {
      const layout = createTrackLayout(seed)
      for (let d = 0; d <= TRACK_LENGTH + VIEW_DISTANCE; d += 3) {
        expect(Math.abs(layout.heading(d))).toBeLessThanOrEqual(HEADING_LIMIT + 1e-9)
      }
    }
  })

  it('nenhuma curva chega perto de 90 graus', () => {
    // O critério do projeto: a mudança de rumo entre dois pontos quaisquer.
    const limite = Math.PI / 2
    for (const seed of SEMENTES) {
      const layout = createTrackLayout(seed)
      let maior = 0
      for (let d = 0; d <= TRACK_LENGTH; d += 5) {
        for (const adiante of [50, 130, 260, 430]) {
          maior = Math.max(maior, Math.abs(layout.heading(d + adiante) - layout.heading(d)))
        }
      }
      expect(maior).toBeLessThan(limite)
      // E com folga larga: o pior caso é a inversão de um extremo ao outro.
      expect(maior).toBeLessThanOrEqual(2 * HEADING_LIMIT + 1e-9)
    }
  })

  it('a curvatura respeita o limite derivado da construção', () => {
    for (const seed of SEMENTES) {
      const layout = createTrackLayout(seed)
      for (let d = 1; d <= TRACK_LENGTH; d += 2) {
        expect(Math.abs(layout.curvature(d))).toBeLessThanOrEqual(MAX_CURVATURE + 1e-9)
      }
    }
  })

  it('não há quinas: a curvatura muda de forma contínua', () => {
    // Uma quina apareceria como um salto de curvatura entre dois pontos
    // vizinhos. O limite é o que a suavização permite em um metro.
    const saltoMaximo = MAX_CURVATURE / 20
    for (const seed of SEMENTES) {
      const layout = createTrackLayout(seed)
      let anterior = layout.curvature(1)
      for (let d = 2; d <= TRACK_LENGTH; d += 1) {
        const atual = layout.curvature(d)
        expect(Math.abs(atual - anterior)).toBeLessThan(saltoMaximo)
        anterior = atual
      }
    }
  })

  it('a linha central é contínua, sem degrau entre trechos', () => {
    for (const seed of SEMENTES) {
      const layout = createTrackLayout(seed)
      let anterior = layout.centerOffset(0)
      for (let d = 1; d <= TRACK_LENGTH + VIEW_DISTANCE; d += 1) {
        const atual = layout.centerOffset(d)
        // Um metro adiante desloca, no máximo, o que o rumo máximo permite.
        expect(Math.abs(atual - anterior)).toBeLessThanOrEqual(Math.tan(HEADING_LIMIT) + 1e-6)
        anterior = atual
      }
    }
  })

  it('a largada acontece em reta', () => {
    for (const seed of SEMENTES) {
      const layout = createTrackLayout(seed)
      // Os dois primeiros trechos são retos por construção: a arrancada
      // precisa de uma referência sem curva.
      for (let d = 0; d <= CURVE_SEGMENT * 2; d += 5) {
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
   * O invariante que sustenta todo o desenho do relevo.
   *
   * Se a altura de tela deixar de cair de forma monótona com a distância, a
   * pista se dobra sobre si mesma numa lomba: o trecho de trás da subida
   * aparece acima da crista, e aí seria preciso recortar geometria escondida
   * — árvores incluídas, que passariam a flutuar no céu. É este teste que
   * permite `drawRoad` continuar desenhando do fundo para a frente sem
   * recorte nenhum, e é ele que fixa o par SLOPE_LIMIT / SLOPE_RISE_SCALE.
   */
  it('a pista nunca se dobra sobre si mesma', () => {
    const telas: Array<[number, number]> = [
      [360, 640],
      [800, 450],
      [1280, 720],
      [375, 812],
    ]

    for (const seed of SEMENTES) {
      const layout = createTrackLayout(seed)
      for (const [largura, altura] of telas) {
        for (let progresso = 0; progresso <= TRACK_LENGTH; progresso += 231) {
          const alturaAqui = layout.elevation(progresso)
          let anterior = Infinity
          for (let i = 0; i <= 84; i += 1) {
            const d = (VIEW_DISTANCE * i) / 84
            const { y, perspective } = roadProjection(d, largura, altura)
            const rise = (layout.elevation(progresso + d) - alturaAqui) * altura * SLOPE_RISE_SCALE
            const telaY = y - rise * perspective
            if (anterior !== Infinity) expect(telaY).toBeLessThan(anterior)
            anterior = telaY
          }
        }
      }
    }
  })

  it('a escala de desenho respeita a folga que garante o invariante', () => {
    // O termo perigoso da derivada é proporcional a escala × desnível, e
    // precisa ficar abaixo da queda total da projeção, que é 0,63.
    const desnivelMaximo = SLOPE_LIMIT * VIEW_DISTANCE
    expect(SLOPE_RISE_SCALE * desnivelMaximo).toBeLessThan(0.63)
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
    layout.centerOffset(3_500)
    expect(layout.ambient).toBe(primeiro)
  })
})
