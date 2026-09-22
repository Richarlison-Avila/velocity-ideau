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
 * O relevo e o cenário são apresentação. A curvatura deixou de ser: ela entra
 * na simulação como força lateral, porque uma curva que não cobra nada não é
 * uma curva. Isso não abre brecha de justiça — a semente é estado oficial da
 * sala, os dois pilotos reconstroem o mesmo traçado, e curva só pode atrasar
 * um carro, nunca adiantá-lo, então o piso de tempo do servidor segue valendo.
 *
 * Os obstáculos, que são o layout competitivo, continuam fixos.
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
 *
 * **Canais em uso.** A lista mora aqui porque ela não existe em lugar nenhum
 * além da memória de quem escreveu, e reusar um canal por engano faz duas
 * decisões independentes andarem juntas — um defeito que não quebra nada e não
 * aparece em teste, só deixa a pista estranhamente regular.
 *
 * | Canal | Decisão |
 * | --- | --- |
 * | 1, 2 | rumo do trecho e sorteio de reta |
 * | 3, 4 | inclinação do trecho e sorteio de plano |
 * | 7, 8 | densidade e famílias da região |
 * | 11 a 16 | vaga do cenário: existe, família, afastamento, escala, tom, variante |
 * | 21 | ambiente da corrida |
 * | 22, 23 | pórtico: se existe naquele marco e qual faixa leva |
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

/**
 * Curvatura na escala com que a física trabalha: de -1 a 1.
 *
 * A simulação não conhece radianos por metro nem os comprimentos de onda do
 * traçado — e não deve, senão passaria a depender do gerador. Recebe esta
 * fração, e a conversão fica aqui, ao lado do número que a define, com nome e
 * teste próprios.
 */
export function curvatureLoad(curvature: number) {
  return clamp(curvature / MAX_CURVATURE, -1, 1)
}

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
 *
 * Caiu de 10 para 6 m com a perspectiva de verdade. Os primeiros 20 metros
 * passaram a ocupar 40% da tela, e a cada 10 m sobravam duas vagas para
 * preencher tudo isso — o campo perto ficava vazio justamente onde a
 * velocidade aparece.
 */
export const SCENERY_SPACING = 6

/** Quantas vagas formam um trecho com densidade e caráter próprios. */
export const SCENERY_REGION = 12

/** A partir daqui já é grama: nada de cenário invade a faixa jogável. */
export const ROADSIDE_MARGIN = 1.62

export type SceneryKind =
  | 'tree'
  | 'bush'
  | 'fence'
  | 'grass'
  | 'sign'
  | 'guardrail'
  | 'pneus'
  | 'poste'
  | 'arquibancada'
  | 'bandeira'
  | 'pedra'
  | 'cacto'
  | 'predio'

/**
 * Quantas variantes de forma o traçado sorteia por vaga.
 *
 * O número é do sorteio, não das famílias: cada família tem o próprio
 * repertório, e quem desenha reduz este valor ao que ela tem. Deixá-lo aqui
 * casado com o tamanho de um vetor de cores foi um erro que sobreviveu por
 * coincidência — três famílias tinham exatamente três entradas.
 */
export const VARIANTES_SORTEADAS = 3

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

/**
 * De quantas em quantas vagas de cenário cai um marco de pórtico.
 *
 * Dezesseis vagas de seis metros dão noventa e seis. Precisa ser múltiplo do
 * espaçamento do cenário porque o pórtico é emitido de **dentro** do mesmo
 * laço: é isso que o põe na ordem de profundidade certa, entre a árvore que
 * está atrás dele e a que está na frente. Num passe separado, um arco a
 * oitenta metros passaria por cima da copa que se debruça sobre a pista a
 * quarenta.
 */
export const GANTRY_EVERY = 16

/**
 * Um pórtico sobre a pista.
 *
 * É decoração, e só. Se ele virasse obstáculo, o layout competitivo passaria a
 * depender da semente e cairia a garantia de que os dois pilotos correm a
 * mesma prova — que é o motivo de os obstáculos serem uma lista fixa.
 */
export type Gantry = {
  /** Qual faixa de patrocínio o arco leva. */
  variant: number
}

export function createGantry(): Gantry {
  return { variant: 0 }
}

/**
 * Quanto de vaga cada família ocupa.
 *
 * Serve para uma coisa só: decidir se um objeto apaga o vizinho imediato do
 * mesmo lado. Antes a regra era "nada ao lado de uma árvore, exceto capim",
 * com os dois nomes escritos à mão — o que não sobrevive a uma família nova.
 * Agora duas famílias vizinhas só convivem se couberem juntas na soma.
 */
const ESTORVO: Record<SceneryKind, number> = {
  grass: 0,
  fence: 0,
  guardrail: 0,
  bandeira: 0.5,
  poste: 0.6,
  bush: 0.7,
  sign: 0.8,
  pneus: 0.8,
  pedra: 1.1,
  cacto: 1.2,
  tree: 1.6,
  predio: 2.2,
  arquibancada: 2.4,
}

/** Acima disso as duas não cabem lado a lado, e a segunda é suprimida. */
const ESTORVO_MAXIMO = 2

/** Famílias que acompanham a borda do asfalto em vez de se espalhar pela grama. */
const JUNTO_DA_BORDA: SceneryKind[] = ['fence', 'guardrail', 'pneus']

/**
 * O lugar em que a etapa acontece.
 *
 * É o que Top Gear fazia trocando de país a cada corrida: a mesma pista parece
 * outra com outro repertório de objeto na beira. Até aqui os quatro ambientes
 * trocavam só a cor do céu e da grama, e a diferença entre eles era de hora do
 * dia, não de lugar.
 */
export type Lugar = 'campo' | 'cidade' | 'montanha' | 'deserto'

/**
 * Famílias por trecho, próprias de cada lugar.
 *
 * A dominante dá caráter ao trecho e a secundária quebra a monotonia. Os
 * quatro conjuntos têm o mesmo número de entradas de propósito: o índice do
 * trecho é sorteado sobre o tamanho da lista, então listas de tamanhos
 * diferentes fariam a estrutura do traçado — onde estão os trechos densos,
 * onde estão as pausas — mudar junto com o lugar. Assim só muda o que aparece.
 */
const FAMILIAS_POR_LUGAR: Record<Lugar, SceneryKind[][]> = {
  campo: [
    ['tree', 'bush'],
    ['bush', 'grass'],
    ['tree', 'grass'],
    ['fence', 'bandeira'],
    // A arquibancada é sempre a secundária, e por isso cai em menos de 5% das
    // vagas: uma a cada trecho é o que diz "isto é um circuito"; duas seguidas
    // fecham a vista da pista.
    ['grass', 'arquibancada'],
    // A placa também é sempre a secundária: sinalização demais vira poluição.
    ['grass', 'sign'],
  ],
  cidade: [
    ['predio', 'poste'],
    ['poste', 'guardrail'],
    ['guardrail', 'pneus'],
    ['predio', 'bandeira'],
    ['grass', 'arquibancada'],
    ['grass', 'sign'],
  ],
  montanha: [
    ['tree', 'pedra'],
    ['pedra', 'guardrail'],
    ['tree', 'grass'],
    ['guardrail', 'pneus'],
    ['pedra', 'bush'],
    ['grass', 'sign'],
  ],
  deserto: [
    ['cacto', 'pedra'],
    ['pedra', 'grass'],
    ['cacto', 'grass'],
    ['fence', 'pedra'],
    ['grass', 'cacto'],
    ['grass', 'sign'],
  ],
}

// ---------------------------------------------------------------------------
// Ambiente
// ---------------------------------------------------------------------------

/** Conjunto de cores da vegetação. A pista seca não tem mato verde. */
export type Flora = 'verde' | 'seca'

/**
 * Identidade visual de uma corrida.
 *
 * É o que o Top Gear conseguia trocando de país a cada etapa: a mesma pista
 * parece outra com outro céu. Aqui sai da semente, então os dois pilotos
 * correm no mesmo lugar, e não custa asset nenhum.
 */
export type Ambient = {
  nome: string
  /** Onde a etapa acontece: é daqui que sai o repertório de objetos. */
  lugar: Lugar
  ceuTopo: string
  ceuMeio: string
  ceuBaixo: string
  serra: string
  chao: string
  gramaClara: string
  gramaEscura: string
  asfaltoClaro: string
  asfaltoEscuro: string
  /** Componentes da névoa do horizonte, para montar os dois extremos. */
  nevoaRGB: string
  flora: Flora
}

const AMBIENTES: Ambient[] = [
  {
    nome: 'entardecer',
    lugar: 'campo',
    ceuTopo: '#06101b',
    ceuMeio: '#173d4b',
    ceuBaixo: '#ff875f',
    serra: '#14222b',
    chao: '#183824',
    gramaClara: '#244b2c',
    gramaEscura: '#214329',
    asfaltoClaro: '#30343b',
    asfaltoEscuro: '#2b2f35',
    nevoaRGB: '255,135,95',
    flora: 'verde',
  },
  {
    nome: 'manhã',
    lugar: 'cidade',
    ceuTopo: '#0c2440',
    ceuMeio: '#3f7fa8',
    ceuBaixo: '#ffd9a3',
    serra: '#1b3242',
    chao: '#1d4429',
    gramaClara: '#2b5834',
    gramaEscura: '#264f30',
    asfaltoClaro: '#383d45',
    asfaltoEscuro: '#32363d',
    nevoaRGB: '255,217,163',
    flora: 'verde',
  },
  {
    nome: 'meio-dia',
    lugar: 'montanha',
    ceuTopo: '#12467a',
    ceuMeio: '#5c9fcf',
    ceuBaixo: '#cfe8f5',
    serra: '#2b4a5c',
    chao: '#245231',
    gramaClara: '#2f6338',
    gramaEscura: '#2a5a34',
    asfaltoClaro: '#3d434b',
    asfaltoEscuro: '#373c43',
    nevoaRGB: '207,232,245',
    flora: 'verde',
  },
  {
    nome: 'travessia seca',
    lugar: 'deserto',
    ceuTopo: '#2b1c14',
    ceuMeio: '#8a4a28',
    ceuBaixo: '#f0b978',
    serra: '#3a2a20',
    chao: '#4a3b21',
    gramaClara: '#5a4826',
    gramaEscura: '#514021',
    asfaltoClaro: '#413c33',
    asfaltoEscuro: '#3a352d',
    nevoaRGB: '240,185,120',
    flora: 'seca',
  },
]

/** Quantos ambientes existem, para os testes não dependerem do vetor. */
export const AMBIENT_COUNT = AMBIENTES.length

/** Ambiente daquela corrida. Função pura da semente, como todo o resto. */
export function ambientFor(seed: number): Ambient {
  return AMBIENTES[Math.floor(randomAt(seed, 0, 21) * AMBIENTES.length)]
}

export type TrackLayout = {
  seed: number
  /** Céu, terreno e vegetação desta corrida. */
  ambient: Ambient
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
  /**
   * Pórtico no marco daquele índice, se houver.
   *
   * Preenche o objeto do chamador, como `scenery`: isto roda dentro do laço de
   * quadro e não pode alocar.
   */
  gantry: (index: number, out: Gantry) => boolean
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

  const familias = FAMILIAS_POR_LUGAR[ambientFor(seed).lugar]

  /** Família da vaga antes da supressão, para o vizinho poder consultá-la. */
  function familiaBruta(index: number, side: -1 | 1): SceneryKind | null {
    if (index < 0) return null
    const vaga = index * 2 + (side > 0 ? 1 : 0)
    const regiao = Math.floor(index / SCENERY_REGION)
    const densidade = 0.24 + randomAt(seed, regiao, 7) * 0.58
    if (randomAt(seed, vaga, 11) > densidade) return null

    const trecho = familias[Math.floor(randomAt(seed, regiao, 8) * familias.length)]
    // A dominante aparece na maioria das vagas: é o que forma agrupamentos.
    return randomAt(seed, vaga, 12) < 0.72 ? trecho[0] : trecho[1]
  }

  return {
    seed,
    ambient: ambientFor(seed),
    centerOffset: offsetEm,
    heading: rumoEm,
    curvature: (distance) => rumoEm(distance + 0.5) - rumoEm(distance - 0.5),
    elevation: alturaEm,
    slope: inclinacaoEm,
    gantry(index, out) {
      if (index <= 0 || index % GANTRY_EVERY !== 0) return false
      // Nem todo marco recebe arco: em fila certinha o pórtico vira placa de
      // quilometragem, e o que se quer é que ele marque alguma coisa.
      if (randomAt(seed, index, 22) > 0.62) return false
      out.variant = Math.floor(randomAt(seed, index, 23) * 3)
      return true
    },

    scenery(index, side, out) {
      const familia = familiaBruta(index, side)
      if (familia === null) return false

      // Distância mínima: um objeto largo apaga o vizinho imediato do mesmo
      // lado, senão os dois se atropelam quando chegam perto da câmera.
      const anterior = familiaBruta(index - 1, side)
      if (anterior !== null && ESTORVO[anterior] + ESTORVO[familia] > ESTORVO_MAXIMO) return false

      const vaga = index * 2 + (side > 0 ? 1 : 0)
      // Cerca, guardrail e pilha de pneus acompanham a borda; o resto se
      // espalha pela grama.
      const naBorda = JUNTO_DA_BORDA.includes(familia)
      // O que é largo fica mais longe da pista, na proporção do estorvo que já
      // decide a supressão do vizinho. Um prédio na beira do asfalto tapa a
      // vista da curva; o mesmo prédio um pouco atrás compõe o fundo.
      const recuo = ESTORVO[familia] * 0.35
      const afastamento = naBorda ? 0.1 : 0.34 + recuo + randomAt(seed, vaga, 13) * 1.5
      out.kind = familia
      out.distance = index * SCENERY_SPACING
      out.lateral = side * (ROADSIDE_MARGIN + afastamento)
      out.scale = 0.72 + randomAt(seed, vaga, 14) * 0.85
      out.tone = randomAt(seed, vaga, 15)
      out.variant = Math.floor(randomAt(seed, vaga, 16) * VARIANTES_SORTEADAS)
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
