// A extensão .js segue a convenção do módulo: o Vite resolve para o .ts.
import { TRACK_LENGTH, VIEW_DISTANCE } from './track.js'

/**
 * Traçado e cenário gerados a partir da semente oficial da corrida.
 *
 * Tudo aqui é função pura da semente e de um índice estável — nunca do
 * relógio, da taxa de quadros ou da ordem em que as coisas são desenhadas.
 * É o que garante que os dois pilotos corram na mesma pista: cada aparelho
 * reconstrói o traçado sozinho, a partir do mesmo número, e chega ao mesmo
 * resultado até o último dígito.
 *
 * O traçado é apresentação: ele não entra na simulação nem na validação do
 * servidor. Os obstáculos, que são o layout competitivo, continuam fixos.
 */

/** Mistura inteira de 32 bits. Mesma entrada, mesma saída, em qualquer aparelho. */
export function hash32(seed: number, index: number) {
  let h = (seed ^ 0x9e3779b9) >>> 0
  h = Math.imul(h ^ (index + 0x165667b1), 0x85ebca6b) >>> 0
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35) >>> 0
  h ^= h >>> 16
  return h >>> 0
}

/**
 * Número em [0, 1) a partir da semente, de um índice e de um canal.
 *
 * O canal permite tirar várias decisões independentes do mesmo índice — lado,
 * escala, tom — sem que uma contamine a outra.
 */
export function randomAt(seed: number, index: number, canal = 0) {
  return hash32(seed ^ Math.imul(canal + 1, 0x27d4eb2f), index) / 0x100000000
}

// ---------------------------------------------------------------------------
// Curvas
// ---------------------------------------------------------------------------

/** Comprimento de cada trecho de rumo constante, em metros. */
export const CURVE_SEGMENT = 130

/**
 * Rumo máximo da pista em relação ao eixo da câmera, em radianos.
 *
 * É o limite que substitui a ideia de "curva de 90 graus": numa projeção
 * pseudo-3D não existe malha para medir ângulo, mas existe o rumo da linha
 * central. Com 0,42 rad a pista nunca passa de 24° em relação à câmera, e a
 * maior inversão possível — de um extremo ao outro — dá 48°, longe dos 90.
 */
export const HEADING_LIMIT = 0.42

/** Maior mudança de rumo sorteada de um trecho para o seguinte. */
export const HEADING_STEP = 0.3

/** Puxão de volta ao eixo, para o traçado não fugir sempre para o mesmo lado. */
export const HEADING_RETURN = 0.34

/** Proporção de trechos que mantêm o rumo do anterior: as retas. */
export const STRAIGHT_SHARE = 0.28

/**
 * Maior mudança de rumo possível de um trecho para o seguinte.
 *
 * Não é só o sorteio: o termo de retorno soma quando o rumo anterior está no
 * extremo oposto ao sorteado. É esse o pior caso.
 */
export const MAX_HEADING_DELTA = HEADING_STEP + HEADING_RETURN * HEADING_LIMIT

/**
 * Maior curvatura possível, em radianos por metro.
 *
 * Sai da própria construção: o rumo varia por uma suavização cuja inclinação
 * máxima é 1,5, então a curvatura nunca passa de 1,5 × ΔRumo ÷ comprimento.
 * Corresponde a um raio de cerca de 195 m — uma curva rápida, não uma quina.
 */
export const MAX_CURVATURE = (1.5 * MAX_HEADING_DELTA) / CURVE_SEGMENT

// ---------------------------------------------------------------------------
// Relevo
// ---------------------------------------------------------------------------

/** Comprimento de cada trecho de inclinação constante, em metros. */
export const SLOPE_SEGMENT = 155

/**
 * Inclinação máxima da pista, em metros por metro — pouco mais de 4°.
 *
 * Parece modesto, e é de propósito. O limite não é estético: o produto desta
 * constante pela escala de desenho decide se a projeção se dobra sobre si
 * mesma numa lomba. Dobrada, a parte de trás da subida apareceria acima da
 * crista e seria preciso recortar geometria escondida — inclusive árvores,
 * que passariam a flutuar no céu. Com este par, a altura de tela cai de forma
 * estritamente monótona com a distância, e isso é garantido por teste.
 *
 * A conta: o termo perigoso da derivada é proporcional a
 * `SLOPE_RISE_SCALE × desnível na janela`, e ele precisa ficar abaixo de
 * `BOTTOM_RATIO − HORIZON_RATIO`, que vale 0,63. Com desnível máximo de
 * `SLOPE_LIMIT × VIEW_DISTANCE`, sobra 20% de folga.
 */
export const SLOPE_LIMIT = 0.075

/** Maior mudança de inclinação sorteada de um trecho para o seguinte. */
export const SLOPE_STEP = 0.055

/** Puxão de volta ao plano, para a pista não subir a prova inteira. */
export const SLOPE_RETURN = 0.36

/** Proporção de trechos planos. */
export const FLAT_SHARE = 0.26

/** Maior mudança de inclinação possível, somando sorteio e retorno. */
export const MAX_SLOPE_DELTA = SLOPE_STEP + SLOPE_RETURN * SLOPE_LIMIT

/** Espaçamento da tabela de posições da linha central, em metros. */
const SAMPLE_STEP = 8

/** Folga além da linha de chegada, porque a câmera enxerga adiante dela. */
const TAIL = VIEW_DISTANCE + 200

/** Suavização de entrada e saída: derivada nula nas pontas, sem quina. */
function smoothstep(t: number) {
  return t * t * (3 - 2 * t)
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

// ---------------------------------------------------------------------------
// Cenário
// ---------------------------------------------------------------------------

/**
 * Espaçamento das vagas de cenário, em metros.
 *
 * É metade do espaçamento dos marcadores de distância, então toda vaga par
 * cai exatamente sobre um marcador. Isso deixa cenário e marcadores no mesmo
 * laço e na mesma ordem de profundidade, sem precisar intercalar duas listas.
 */
export const SCENERY_SPACING = 10

/** Quantas vagas formam um trecho com densidade e caráter próprios. */
export const SCENERY_REGION = 12

/** A partir daqui já é grama: nada de cenário invade a faixa jogável. */
export const ROADSIDE_MARGIN = 1.62

export type SceneryKind = 'tree' | 'bush' | 'fence' | 'grass' | 'sign'

/**
 * Descrição de um objeto do cenário.
 *
 * É preenchida em um objeto que o chamador reaproveita, e não devolvida nova a
 * cada consulta: isto roda quase cem vezes por quadro e não pode alocar.
 */
export type SceneryItem = {
  kind: SceneryKind
  /** Distância absoluta na pista. */
  distance: number
  /** Posição lateral, sempre fora do asfalto. */
  lateral: number
  scale: number
  /** Variação de tonalidade, de 0 a 1. */
  tone: number
  /** Variação de forma dentro da mesma família. */
  variant: number
}

export function createSceneryItem(): SceneryItem {
  return { kind: 'grass', distance: 0, lateral: 0, scale: 1, tone: 0, variant: 0 }
}

/** Famílias por trecho: a dominante dá caráter, a secundária quebra a monotonia. */
const FAMILIES: SceneryKind[][] = [
  ['tree', 'bush'],
  ['bush', 'grass'],
  ['tree', 'grass'],
  ['fence', 'bush'],
  ['grass', 'tree'],
  // A placa é sempre a secundária: sinalização demais vira poluição visual.
  ['grass', 'sign'],
]

export type TrackLayout = {
  seed: number
  /** Deslocamento lateral da linha central, em metros. */
  centerOffset: (distance: number) => number
  /** Rumo da pista naquele ponto, em radianos. */
  heading: (distance: number) => number
  /** Curvatura naquele ponto, em radianos por metro. */
  curvature: (distance: number) => number
  /** Altura da linha central naquele ponto, em metros. */
  elevation: (distance: number) => number
  /** Inclinação naquele ponto, em metros por metro. Positiva na subida. */
  slope: (distance: number) => number
  /**
   * Preenche `out` com o objeto daquela vaga e devolve true; devolve false
   * quando a vaga é área de respiro.
   */
  scenery: (index: number, side: -1 | 1, out: SceneryItem) => boolean
}

export function createTrackLayout(seed: number): TrackLayout {
  const comprimento = TRACK_LENGTH + TAIL
  const trechos = Math.ceil(comprimento / CURVE_SEGMENT) + 2

  // Rumo alvo de cada trecho. Os três primeiros ficam em zero, o que mantém os
  // 260 m iniciais em linha reta: a arrancada sai de uma velocidade baixa e
  // precisa de uma referência sem curva para o ganho ser legível.
  const rumos = new Float64Array(trechos + 2)
  for (let i = 3; i < rumos.length; i += 1) {
    const reta = randomAt(seed, i, 2) < STRAIGHT_SHARE
    const bruto = reta ? 0 : (randomAt(seed, i, 1) * 2 - 1) * HEADING_STEP
    // O termo de retorno impede que o traçado derive sempre para o mesmo lado.
    const proposto = rumos[i - 1] * (1 - HEADING_RETURN) + bruto
    rumos[i] = clamp(proposto, -HEADING_LIMIT, HEADING_LIMIT)
  }

  function rumoEm(distance: number) {
    const bruto = clamp(distance, 0, comprimento) / CURVE_SEGMENT
    const trecho = Math.min(rumos.length - 2, Math.floor(bruto))
    const t = bruto - trecho
    return rumos[trecho] + (rumos[trecho + 1] - rumos[trecho]) * smoothstep(t)
  }

  // Posição da linha central, integrada uma única vez e depois consultada por
  // interpolação: o laço de quadro não pode integrar nada.
  const amostras = Math.ceil(comprimento / SAMPLE_STEP) + 2
  const offsets = new Float64Array(amostras)
  let acumulado = 0
  for (let i = 1; i < amostras; i += 1) {
    const anterior = Math.tan(rumoEm((i - 1) * SAMPLE_STEP))
    const atual = Math.tan(rumoEm(i * SAMPLE_STEP))
    acumulado += ((anterior + atual) / 2) * SAMPLE_STEP
    offsets[i] = acumulado
  }

  function offsetEm(distance: number) {
    const bruto = clamp(distance, 0, comprimento) / SAMPLE_STEP
    const indice = Math.min(amostras - 2, Math.floor(bruto))
    const t = bruto - indice
    return offsets[indice] + (offsets[indice + 1] - offsets[indice]) * t
  }

  // Relevo, construído pela mesma máquina do rumo: inclinação alvo por trecho,
  // suavização com derivada nula nas pontas — o que zera a curvatura vertical
  // na emenda e evita quebra — e integração feita uma vez.
  const inclinacoes = new Float64Array(Math.ceil(comprimento / SLOPE_SEGMENT) + 3)
  for (let i = 3; i < inclinacoes.length; i += 1) {
    const plano = randomAt(seed, i, 4) < FLAT_SHARE
    const bruto = plano ? 0 : (randomAt(seed, i, 3) * 2 - 1) * SLOPE_STEP
    inclinacoes[i] = clamp(inclinacoes[i - 1] * (1 - SLOPE_RETURN) + bruto, -SLOPE_LIMIT, SLOPE_LIMIT)
  }

  function inclinacaoEm(distance: number) {
    const bruto = clamp(distance, 0, comprimento) / SLOPE_SEGMENT
    const trecho = Math.min(inclinacoes.length - 2, Math.floor(bruto))
    const t = bruto - trecho
    return inclinacoes[trecho] + (inclinacoes[trecho + 1] - inclinacoes[trecho]) * smoothstep(t)
  }

  const alturas = new Float64Array(amostras)
  let subida = 0
  for (let i = 1; i < amostras; i += 1) {
    const anterior = inclinacaoEm((i - 1) * SAMPLE_STEP)
    const atual = inclinacaoEm(i * SAMPLE_STEP)
    subida += ((anterior + atual) / 2) * SAMPLE_STEP
    alturas[i] = subida
  }

  function alturaEm(distance: number) {
    const bruto = clamp(distance, 0, comprimento) / SAMPLE_STEP
    const indice = Math.min(amostras - 2, Math.floor(bruto))
    const t = bruto - indice
    return alturas[indice] + (alturas[indice + 1] - alturas[indice]) * t
  }

  /** Família da vaga antes da supressão, para o vizinho poder consultá-la. */
  function familiaBruta(index: number, side: -1 | 1): SceneryKind | null {
    if (index < 0) return null
    const vaga = index * 2 + (side > 0 ? 1 : 0)
    const regiao = Math.floor(index / SCENERY_REGION)
    const densidade = 0.24 + randomAt(seed, regiao, 7) * 0.58
    if (randomAt(seed, vaga, 11) > densidade) return null

    const familia = FAMILIES[Math.floor(randomAt(seed, regiao, 8) * FAMILIES.length)]
    // A dominante aparece na maioria das vagas: é o que forma agrupamentos.
    return randomAt(seed, vaga, 12) < 0.72 ? familia[0] : familia[1]
  }

  return {
    seed,
    centerOffset: offsetEm,
    heading: rumoEm,
    curvature: (distance) => rumoEm(distance + 0.5) - rumoEm(distance - 0.5),
    elevation: alturaEm,
    slope: inclinacaoEm,
    scenery(index, side, out) {
      const familia = familiaBruta(index, side)
      if (familia === null) return false

      // Distância mínima: uma árvore ocupa espaço e apaga o vizinho imediato do
      // mesmo lado, senão as copas se atropelam quando chegam perto da câmera.
      if (familia !== 'grass' && familiaBruta(index - 1, side) === 'tree') return false

      const vaga = index * 2 + (side > 0 ? 1 : 0)
      // A cerca acompanha a borda; o resto se espalha pela grama.
      const afastamento = familia === 'fence' ? 0.1 : 0.34 + randomAt(seed, vaga, 13) * 1.5
      out.kind = familia
      out.distance = index * SCENERY_SPACING
      out.lateral = side * (ROADSIDE_MARGIN + afastamento)
      out.scale = 0.72 + randomAt(seed, vaga, 14) * 0.85
      out.tone = randomAt(seed, vaga, 15)
      out.variant = Math.floor(randomAt(seed, vaga, 16) * 3)
      return true
    },
  }
}

/** Primeira vaga de cenário ainda à frente da câmera. */
export function firstSceneryIndex(progress: number) {
  return Math.ceil(progress / SCENERY_SPACING)
}

/** Última vaga dentro do campo de visão. */
export function lastSceneryIndex(progress: number) {
  return Math.floor((progress + VIEW_DISTANCE) / SCENERY_SPACING)
}
