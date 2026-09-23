/**
 * Molde dos carros e dos pilotos.
 *
 * A pintura que se vê no menu, na seleção, no lobby e na pista é a arte de
 * `public/carros`, gerada por `npm run carros` a partir de `arte/carros`. Este
 * molde é o carro por baixo dela, em dois papéis:
 *
 * - **Geometria.** A arte é uma imagem chapada, sem profundidade. Para girar o
 *   carro nas curvas e na derrapagem, a folha de sprites precisa saber onde
 *   cada peça mora em metros — o bico, longe do pivô, anda mais que a
 *   traseira —, e é daqui que isso sai, junto com a linha do chão.
 * - **Reserva.** Enquanto a imagem não chega, ou se ela não chegar, a corrida
 *   desenha o carro por este molde, com as cores da equipe: o jogo nunca espera
 *   um arquivo para largar.
 *
 * ## Por que vetor
 *
 * Descrito com as mesmas formas cheias e cores chapadas do cenário, o molde
 * fica no mesmo mundo que a pista, e um carro novo entra nele sem abrir editor
 * de imagem: basta a pintura em `PINTURAS`. É o que o deixa servir de reserva
 * para qualquer carro da garagem.
 *
 * ## Perspectiva
 *
 * O desenho não é uma silhueta achatada: cada ponto é dado em metros —
 * profundidade, largura e altura, com a origem no chão sob o eixo traseiro — e
 * projetado pela câmera de `CAMERA`. É daí que sai a leitura de carro visto de
 * trás e de cima: o eixo dianteiro nasce menor e mais estreito que o traseiro,
 * as tampas aparecem pelo lado de cima e a asa traseira, que é a peça mais
 * perto da câmera, domina a base do quadro. Mexer numa medida em metros
 * continua saindo coerente com o resto; mexer em pixel a esmo, não.
 *
 * A projeção não é fiel em um ponto, e de propósito: a altura entra achatada
 * por `ELEVACAO`. Três outras medidas também são desenho, e não engenharia —
 * a via dianteira é mais aberta que a real, o pneu é mais estreito e mais
 * esticado, e o capacete é maior do que caberia. Cada uma está comentada onde
 * mora, com o motivo. Fora essas quatro, tudo o mais sai da projeção.
 *
 * ## Sombreado
 *
 * Nada de degradê: cada volume é resolvido em faixas de cor chapada, como um
 * artista de pixel art resolve um cilindro. A luz vem de cima e da esquerda, a
 * mesma direção do realce das árvores e dos arbustos do cenário, e as rampas
 * de tom puxam a sombra para o frio e o brilho para o quente — é isso que faz
 * a peça parecer iluminada pelo mesmo sol da pista.
 */
import { carById, type CarId } from './cars'
import { LUZ, SOMBRA, misturar, rampa, type Rampa } from './paleta'
import {
  CILINDRO,
  LADOS,
  FIO,
  VINCO,
  pincel,
  vincoDoLado,
  type Borda,
  type Face as FaceDoPincel,
  type Label as LabelDoPincel,
  type Pincel,
  type Ponto,
} from './pincel'

/**
 * Camadas do desenho, da mais longe para a mais perto da câmera.
 *
 * A ordem é a ordem de desenho, e é por isso que ela é uma lista e não um
 * conjunto: a asa dianteira precisa sair atrás dos pneus da frente, e a asa
 * traseira por cima de tudo. As rodas são camadas próprias porque esterçam e
 * rodam por conta delas.
 */
export const PARTS = [
  'sombra',
  'asaDianteira',
  'dianteiraEsquerda',
  'dianteiraDireita',
  'bico',
  'lateral',
  'cockpit',
  'piloto',
  'motor',
  'traseiraEsquerda',
  'traseiraDireita',
  'traseira',
  'asaTraseira',
] as const

export type Part = (typeof PARTS)[number]

/** As quatro camadas que se movem sozinhas ao compor o quadro. */
export const RODAS = ['dianteiraEsquerda', 'dianteiraDireita', 'traseiraEsquerda', 'traseiraDireita'] as const

export type Roda = (typeof RODAS)[number]

/** Uma face cheia do desenho, já em unidades do desenho. */
export type Face = FaceDoPincel<Part>

/** Texto de patrocínio ou numeração, desenhado junto com a face. */
export type Label = LabelDoPincel<Part>

export type CarModel = {
  faces: Face[]
  labels: Label[]
  /** Centro da luz de chuva, que acende no boost. */
  luzDeChuva: { x: number; y: number; raio: number }
  /** Boca do escapamento, de onde sai o fogo do boost. */
  escapamento: { x: number; y: number; raio: number }
}

// ---------------------------------------------------------------------------
// Câmera e projeção
// ---------------------------------------------------------------------------

/**
 * Câmera da corrida, em metros: bem atrás e bem acima, com teleobjetiva.
 *
 * O ângulo é de vinte e seis graus, o que Top Gear e Horizon Chase usam: alto
 * o bastante para abrir as tampas do carro — sem isso não há onde pôr pintura
 * nenhuma, porque de um ponto de vista baixo o carro vira uma silhueta de
 * pneus e asa e toda a identidade da equipe fica no lado de cima que ninguém
 * vê. A distância grande é o que torna a projeção quase paralela: de perto, o
 * eixo dianteiro encolhe tanto que o carro perde as rodas da frente e a leitura
 * de quatro cantos que o faz parecer um carro de corrida.
 */
const CAMERA = { atras: 36, altura: 18 }

/**
 * Quanto a altura conta no desenho, comparada com a profundidade.
 *
 * Uma câmera de verdade projetaria os dois na mesma régua, e o carro sairia
 * alto e estreito: o capacete, que é a peça mais alta, subiria até a altura do
 * bico e o desenho perderia o empilhamento que o faz ler como carro. Achatar a
 * altura para pouco mais da metade é a convenção do desenho de corrida visto
 * de cima, e é o que as artes de referência fazem — nelas o pneu aparece com
 * pouco mais da metade da altura que teria de fato.
 */
const ELEVACAO = 0.6

/**
 * Unidades do desenho por metro, medidas no eixo traseiro.
 *
 * O carro tem dois metros de fora a fora dos pneus traseiros, então este
 * número é, por construção, `CAR_SPRITE_HALF_WIDTH`: o desenho ocupa na tela
 * exatamente a largura que a regra de saída de pista cobra.
 */
const UNIDADE = 31

const FOCO = UNIDADE * CAMERA.atras

/** Linha onde o pneu traseiro toca o asfalto, no sistema do desenho. */
export const LINHA_DO_CHAO = 20

const BASE = LINHA_DO_CHAO - CAMERA.altura * UNIDADE

/**
 * Uma fatia de profundidade, com a régua já resolvida.
 *
 * `x` e `y` convertem metros daquela distância para unidades do desenho. Duas
 * estações diferentes têm réguas diferentes — é exatamente isso que produz a
 * perspectiva, e é por isso que nenhuma medida do desenho é escrita à mão.
 */
type Estacao = {
  /** Metros à frente do eixo traseiro: a distância desta fatia. */
  z: number
  /** Metros de largura → unidades do desenho, do eixo do carro para fora. */
  x: (metros: number) => number
  /** Metros de altura → unidades do desenho, contando do chão para cima. */
  y: (altura: number) => number
  /** Unidades por metro nesta distância, para medir espessuras. */
  u: number
}

function estacao(z: number): Estacao {
  const u = FOCO / (CAMERA.atras + z)
  return { z, x: (metros) => metros * u, y: (altura) => BASE + (CAMERA.altura - ELEVACAO * altura) * u, u }
}

/**
 * Estações do carro, em metros à frente do eixo traseiro.
 *
 * Negativo é atrás do eixo, na direção da câmera. Toda peça é ancorada em uma
 * delas, e é essa ancoragem que garante que o desenho inteiro concorde com uma
 * única perspectiva.
 */
const Z = {
  /** Asa traseira: bordo de fuga e bordo de ataque, que é a corda do perfil. */
  asaFuga: estacao(-0.72),
  asaAtaque: estacao(-0.22),
  /** Flape: corda curta e à frente do plano, para sair acima dele na tela. */
  flapeFuga: estacao(-0.44),
  flapeAtaque: estacao(-0.28),
  /** Difusor, do bordo de saída até onde ele some debaixo do carro. */
  difusorSaida: estacao(-0.42),
  difusorEntrada: estacao(-0.02),
  caixa: estacao(-0.12),
  eixoTraseiro: estacao(0),
  motor: estacao(0.95),
  airbox: estacao(1.55),
  capacete: estacao(2.0),
  cockpit: estacao(2.35),
  pontao: estacao(1.4),
  entrada: estacao(2.55),
  tubo: estacao(3.1),
  eixoDianteiro: estacao(3.6),
  bico: estacao(4.15),
  asaDianteiraFuga: estacao(4.5),
  asaDianteiraAtaque: estacao(4.95),
}

/** Caixa do desenho do carro inteiro, com folga para a sombra e o fogo do boost. */
export const CAIXA_CARRO = { x: -34, y: -54, largura: 68, altura: 80 }

/**
 * Onde cada camada mora em profundidade, em metros à frente do eixo traseiro,
 * e a altura típica dela.
 *
 * É o que a guinada precisa saber. O molde é desenhado de trás, com as peças
 * simétricas em torno do eixo do carro, e girar ponto a ponto quebraria essa
 * simetria em cada uma das centenas de faces. Mas numa projeção de câmera alta
 * e distante, girar o carro sobre o eixo traseiro é, em boa aproximação,
 * deslizar cada peça de lado na proporção da distância dela ao pivô: o bico vai
 * para um lado, a traseira para o outro. As peças compridas — bico, pontões,
 * cockpit — deslizam mais numa ponta que na outra, e é por isso que cada uma
 * diz de onde a onde ela vai.
 */
const PROFUNDIDADE_DA_PARTE: Record<Part, { de: number; ate: number; altura: number }> = {
  sombra: { de: 0, ate: 3.6, altura: 0 },
  asaDianteira: { de: 4.5, ate: 4.95, altura: 0.26 },
  dianteiraEsquerda: { de: 3.6, ate: 3.6, altura: 0.31 },
  dianteiraDireita: { de: 3.6, ate: 3.6, altura: 0.31 },
  bico: { de: 3.1, ate: 4.5, altura: 0.34 },
  lateral: { de: 0, ate: 2.55, altura: 0.36 },
  cockpit: { de: 1.5, ate: 3.1, altura: 0.6 },
  piloto: { de: 2.0, ate: 2.0, altura: 0.95 },
  motor: { de: 0, ate: 1.55, altura: 0.75 },
  traseiraEsquerda: { de: 0, ate: 0, altura: 0.33 },
  traseiraDireita: { de: 0, ate: 0, altura: 0.33 },
  traseira: { de: -0.42, ate: 0, altura: 0.25 },
  asaTraseira: { de: -0.72, ate: -0.22, altura: 0.85 },
}

/**
 * Ponto em torno do qual o carro gira, em metros à frente do eixo traseiro.
 *
 * Pouco à frente do eixo, onde fica o centro de massa de um carro de motor
 * central. Girando ali, o bico vai para dentro da curva e a traseira escapa
 * para fora — que é a leitura da derrapagem. Girando no eixo traseiro, a
 * traseira ficaria parada e o carro pareceria só apontar para o lado.
 */
export const PIVO_DA_GUINADA = 1.4

/** Quanto um ponto a `z` metros do eixo traseiro anda de lado, em unidades, com o carro girado `guinada`. */
function deslizeDaGuinada(z: number, guinada: number) {
  const braco = z - PIVO_DA_GUINADA
  return braco * Math.sin(guinada) * estacao(PIVO_DA_GUINADA + braco * Math.cos(guinada)).u
}

/**
 * A guinada de uma camada, como transformação afim do desenho.
 *
 * Devolve `[a, b, c, d, e, f]` no formato de `CanvasRenderingContext2D.transform`:
 * x' = a·x + c·y + e, y' = y. A camada encolhe na largura pelo cosseno do
 * giro, desliza pelo que a profundidade dela manda e, se for comprida, é
 * cisalhada: a ponta de longe, mais alta na tela, anda mais que a de perto.
 * `guinada` positiva aponta o bico para a direita.
 */
export function yawTransform(part: Part, guinada: number): [number, number, number, number, number, number] {
  if (guinada === 0) return [1, 0, 0, 1, 0, 0]
  const { de, ate, altura } = PROFUNDIDADE_DA_PARTE[part]
  const escala = Math.cos(guinada)
  const yPerto = estacao(de).y(altura)
  const yLonge = estacao(ate).y(altura)
  const perto = deslizeDaGuinada(de, guinada)
  if (Math.abs(yPerto - yLonge) < 1e-6) return [escala, 0, 0, 1, perto, 0]
  const cisalhamento = (deslizeDaGuinada(ate, guinada) - perto) / (yLonge - yPerto)
  return [escala, 0, cisalhamento, 1, perto - cisalhamento * yPerto, 0]
}

/**
 * Medidas das rodas, em metros.
 *
 * Duas licenças de desenho moram aqui. O pneu é mais estreito que o de um
 * carro de verdade, porque na escala em que o carro é visto um pneu na largura
 * real come quase metade do quadro e não sobra carroceria para pintar. E a via
 * dianteira é mais aberta que a traseira, para a perspectiva não recolher as
 * rodas da frente para dentro da carroceria: com elas abertas o carro tem roda
 * nos quatro cantos, que é a silhueta que se reconhece de longe. As artes de
 * referência fazem as duas concessões pelo mesmo motivo.
 */
const PNEU = {
  traseiro: { largura: 0.36, diametro: 0.66, viaMeia: 0.82 },
  dianteiro: { largura: 0.34, diametro: 0.62, viaMeia: 0.92 },
}

/**
 * Contorno do pneu na tela: um pneu é um disco em pé, e o que a câmera vê dele
 * é a varredura da circunferência, não o retângulo entre o chão e o topo.
 *
 * O resultado é esticado por `PNEU_ESTICADO`. A projeção sozinha devolve um
 * pneu quase quadrado — consequência de achatar a altura —, e um pneu quadrado
 * não se lê como pneu em tamanho de corrida. As artes de referência esticam
 * pelo mesmo motivo.
 */
const PNEU_ESTICADO = 1.3

function silhuetaDoPneu(eixo: Estacao, diametro: number) {
  const raio = diametro / 2
  let alto = Infinity
  let baixo = -Infinity
  for (let i = 0; i < 72; i += 1) {
    const angulo = (i * Math.PI * 2) / 72
    const y = estacao(eixo.z + raio * Math.cos(angulo)).y(raio + raio * Math.sin(angulo))
    alto = Math.min(alto, y)
    baixo = Math.max(baixo, y)
  }
  // Ancorado no contato, não no meio do contorno: é a linha em que o pneu
  // toca o asfalto que precisa cair onde o resto do jogo espera o chão, porque
  // é dela que nascem a poeira e as marcas de borracha.
  const meiaAltura = ((baixo - alto) / 2) * PNEU_ESTICADO
  return { centro: eixo.y(0) - meiaAltura, meiaAltura }
}

function centroDaRoda(roda: Roda): [number, number] {
  const tras = roda.startsWith('traseira')
  const e = tras ? Z.eixoTraseiro : Z.eixoDianteiro
  const pneu = tras ? PNEU.traseiro : PNEU.dianteiro
  const lado = roda.endsWith('Esquerda') ? -1 : 1
  return [lado * e.x(pneu.viaMeia), silhuetaDoPneu(e, pneu.diametro).centro]
}

/**
 * Centro de cada roda no desenho, para a camada ser posicionada na hora de
 * compor o quadro. As dianteiras giram com o volante em torno deste ponto.
 */
export const WHEEL_CENTERS: Record<Roda, [number, number]> = {
  dianteiraEsquerda: centroDaRoda('dianteiraEsquerda'),
  dianteiraDireita: centroDaRoda('dianteiraDireita'),
  traseiraEsquerda: centroDaRoda('traseiraEsquerda'),
  traseiraDireita: centroDaRoda('traseiraDireita'),
}

/** Meia-largura e meia-altura de um pneu no desenho, em unidades. */
export type MedidaDoPneu = { meiaLargura: number; meiaAltura: number }

/** Uma mancha da sombra de contato, em unidades do desenho. */
export type ManchaDeSombra = {
  x: number
  y: number
  rx: number
  ry: number
  cor: string
  alpha: number
  /** A roda sob a qual a mancha fica; sem roda, é a sombra da carroceria. */
  roda?: Roda
}

/** Meia-largura e meia-altura de cada roda, em unidades do desenho. */
const RODA: { traseira: MedidaDoPneu; dianteira: MedidaDoPneu } = {
  traseira: {
    meiaLargura: Z.eixoTraseiro.x(PNEU.traseiro.largura / 2),
    meiaAltura: silhuetaDoPneu(Z.eixoTraseiro, PNEU.traseiro.diametro).meiaAltura,
  },
  dianteira: {
    meiaLargura: Z.eixoDianteiro.x(PNEU.dianteiro.largura / 2),
    meiaAltura: silhuetaDoPneu(Z.eixoDianteiro, PNEU.dianteiro.diametro).meiaAltura,
  },
}

/**
 * Sombra de contato do carro, em unidades do desenho.
 *
 * É uma lista, e não um punhado de chamadas dentro do molde, porque ela tem
 * dois consumidores que precisam da mesma geometria: o retrato da garagem, que
 * a assa junto com o resto e está certo assim — lá o carro está parado —, e a
 * corrida, que a desenha ao vivo em `drawCar`.
 *
 * Na corrida ela não pode ser assada. A folha inteira inclina com o volante e
 * é deslocada pela suspensão e pela trepidação; a sombra assada ia junto, e
 * uma sombra que rola com a carroceria não é sombra, é adesivo. Desenhada ao
 * vivo, ela fica no chão enquanto o carro se mexe por cima — que é o que
 * ancora a peça no asfalto.
 *
 * Cada mancha diz se é de roda, e de qual. A distinção importa na corrida: a
 * da carroceria fica no chão, mas a de cada pneu tem de acompanhar o pneu,
 * porque neste desenho a rolagem gira o quadro inteiro — rodas inclusive — em
 * torno da linha do chão. A roda da frente está sessenta unidades acima desse
 * pivô e anda nove para o lado no esterço máximo; uma sombra parada ali fica
 * sozinha no asfalto, ao lado do pneu.
 *
 * Sai de uma função das rodas porque a arte de cada carro não as tem no mesmo
 * lugar do molde — a via dianteira dela é mais fechada —, e a sombra tem de
 * ficar sob o pneu que está sendo desenhado.
 */
export function sombraDeContato(
  rodas: Record<Roda, readonly [number, number]>,
  pneus: { traseira: MedidaDoPneu; dianteira: MedidaDoPneu },
): readonly ManchaDeSombra[] {
  return [
    { x: 0, y: LINHA_DO_CHAO - 2, rx: 28, ry: 4.5, cor: '#0a1416', alpha: 0.26 },
    ...RODAS.map((roda) => {
      const [x, y] = rodas[roda]
      const tras = roda.startsWith('traseira')
      const { meiaLargura, meiaAltura } = tras ? pneus.traseira : pneus.dianteira
      return {
        x,
        y: y + meiaAltura - 0.6,
        rx: meiaLargura * 0.95,
        ry: tras ? 2 : 1.5,
        cor: '#081013',
        alpha: 0.35,
        roda,
      }
    }),
  ]
}

/** A sombra de contato do molde. */
export const SOMBRA_DE_CONTATO = sombraDeContato(WHEEL_CENTERS, RODA)

/**
 * Onde a terra gruda depois de uma passagem pela grama.
 *
 * As posições são medidas a partir do centro de cada pneu, porque é o pneu
 * que atira o barro. Mas o que ele atinge não é "o que estiver ao lado", e a
 * diferença apareceu no teste que cobra que toda mancha caia sobre o carro: a
 * primeira versão punha terra ao lado da roda dianteira, e num carro de roda
 * descoberta ao lado dela só há braço de suspensão e ar — as quatro manchas
 * da frente flutuavam no vazio, em todos os carros.
 *
 * Então cada eixo suja o que de fato fica no caminho do barro dele. A roda
 * traseira suja a si mesma, o canto de baixo da asa logo atrás e o pé do
 * pontão logo à frente. A dianteira atira para trás, e o barro dela cai no
 * pontão. A traseira suja mais porque é ela que traciona.
 *
 * Como a sombra, sai das rodas: a arte de cada carro põe as dela em outro
 * lugar, e o barro vai com o pneu que o atira.
 */
export function manchasDeTerra(rodas: Record<Roda, readonly [number, number]>): readonly ManchaDeTerra[] {
  return RODAS.flatMap((roda) => {
    const [x, y] = rodas[roda]
    const paraDentro = -Math.sign(x)
    const em = (dentro: number, abaixo: number, rx: number, ry: number) =>
      ({ x: x + paraDentro * dentro, y: y + abaixo, rx, ry })
    if (roda.startsWith('traseira')) {
      return [
        em(1.5, 4.2, 2.4, 1.4),
        em(2.5, -3, 1.8, 1.1),
        em(9.2, 5, 2.2, 1.1),
        em(10.5, -13, 2.4, 1.3),
      ]
    }
    return [em(11, 23, 2, 1.2), em(9.5, 29, 1.6, 1)]
  })
}

/** Uma mancha de terra, em unidades do desenho. */
export type ManchaDeTerra = { x: number; y: number; rx: number; ry: number }

/** A terra da grama no molde. */
export const MANCHAS_DE_TERRA = manchasDeTerra(WHEEL_CENTERS)

/** Cor da terra na carroceria. Barro seco, não lama preta. */
export const COR_DA_TERRA = '#7a6344'

// ---------------------------------------------------------------------------
// Materiais comuns
// ---------------------------------------------------------------------------

/** Borracha, fibra de carbono, metal e disco de freio são iguais em todo carro. */
const BORRACHA = rampa('#30373d')
const CARBONO = rampa('#39474f')
const METAL = rampa('#8a999b')
const FREIO = rampa('#4e4238')

// ---------------------------------------------------------------------------
// Pintura e marcas de cada carro
// ---------------------------------------------------------------------------

type Pintura = {
  /** Cor principal da carroceria. */
  corpo: string
  /** Cor de apoio: faixas, laterais da asa e detalhes da pintura. */
  detalhe: string
  /** Terceira cor, em fio fino, que separa as duas. */
  filete: string
  /** Cor do texto escrito sobre a carroceria. */
  tinta: string
  /** Cor do número do carro, que é a marca mais visível da pintura. */
  numero: string

  /** Faixa larga da asa traseira: é o painel de patrocínio do carro. */
  faixaAsa: string
  /** Texto dessa faixa e a cor com que ele é escrito. */
  patrocinio: string
  tintaAsa: string
  /** Blocos de cor nas duas pontas da faixa, como nas artes de referência. */
  pontaAsa: string

  /** Nome que se repete nos dois lados da asa dianteira. */
  asaDianteira: string
  /** Patrocínios que descem pela lateral, de fora para dentro. */
  laterais: [string, string]

  /** Casco, faixa e risca do capacete. */
  casco: string
  faixa: string
  risca: string
  /** Macacão do piloto. */
  macacao: string
}

/**
 * Pintura de cada carro da garagem.
 *
 * As cores são as da equipe, rebaixadas para o mesmo intervalo de luminância
 * do cenário: um vermelho de catálogo, puro, salta da cena como um adesivo,
 * porque nada na pista é tão saturado quanto ele. As marcas seguem a posição
 * das artes de referência — painel de patrocínio na asa traseira, nome da
 * equipe repetido na asa dianteira, dois patrocínios descendo cada lateral e o
 * número grande no bico —, que é a diagramação que se reconhece de longe.
 *
 * O capacete segue o desenho conhecido de cada piloto, reduzido ao que se lê a
 * esta distância: casco, faixa e uma risca.
 *
 * Na garagem e na pista vale a arte de cada carro. Esta é a pintura que o
 * molde veste quando a arte falta, e por isso segue as cores dela: quem
 * escolheu a Lotus preta e dourada não larga de repente num carro de outra
 * equipe.
 */
const PINTURAS: Record<CarId, Pintura> = {
  'senna-lotus': {
    corpo: '#24221f', detalhe: '#c9a444', filete: '#8c7334', tinta: '#d8b75a', numero: '#d8b75a',
    faixaAsa: '#24221f', patrocinio: 'JPS', tintaAsa: '#d8b75a', pontaAsa: '#c9a444',
    asaDianteira: 'JPS', laterais: ['JPS', 'ELF'],
    casco: '#e8c23a', faixa: '#2f8f57', risca: '#2b5f9c', macacao: '#2a2824',
  },
  senna: {
    corpo: '#e2e4de', detalhe: '#cf3b2c', filete: '#1d262c', tinta: '#242e34', numero: '#cf3b2c',
    faixaAsa: '#e7e4d6', patrocinio: 'MARLBORO', tintaAsa: '#1d262c', pontaAsa: '#cf3b2c',
    asaDianteira: 'MARLBORO', laterais: ['MARLBORO', 'HONDA'],
    casco: '#e8c23a', faixa: '#2f8f57', risca: '#2b5f9c', macacao: '#e2e4dd',
  },
  'barrichello-ferrari': {
    corpo: '#c4342a', detalhe: '#e7e4d6', filete: '#1d262c', tinta: '#f2eddc', numero: '#1d262c',
    faixaAsa: '#e7e4d6', patrocinio: 'MARLBORO', tintaAsa: '#c4342a', pontaAsa: '#1d262c',
    asaDianteira: 'FERRARI', laterais: ['VODAFONE', 'SHELL'],
    casco: '#e7e4d6', faixa: '#2b5f9c', risca: '#cf3b33', macacao: '#c4342a',
  },
  schumacher: {
    corpo: '#c2332a', detalhe: '#e7e4d6', filete: '#1d262c', tinta: '#f2eddc', numero: '#e6cf3c',
    faixaAsa: '#e7e4d6', patrocinio: 'MARLBORO', tintaAsa: '#1d262c', pontaAsa: '#c2332a',
    asaDianteira: 'MARLBORO', laterais: ['SHELL', 'VODAFONE'],
    casco: '#cf3b33', faixa: '#e7e4d6', risca: '#23303a', macacao: '#c2332a',
  },
  'barrichello-brawn': {
    corpo: '#e6e6df', detalhe: '#c8dc3c', filete: '#1d262c', tinta: '#1d262c', numero: '#1d262c',
    faixaAsa: '#e6e6df', patrocinio: 'BRAWN GP', tintaAsa: '#1d262c', pontaAsa: '#c8dc3c',
    asaDianteira: 'BRAWN GP', laterais: ['VIRGIN', 'MIG'],
    casco: '#e7e4d6', faixa: '#2b5f9c', risca: '#e8c23a', macacao: '#e6e6df',
  },
  'massa-ferrari': {
    corpo: '#be2f28', detalhe: '#e7e4d6', filete: '#e6cf3c', tinta: '#f2eddc', numero: '#f2eddc',
    faixaAsa: '#e7e4d6', patrocinio: 'SANTANDER', tintaAsa: '#be2f28', pontaAsa: '#be2f28',
    asaDianteira: 'SANTANDER', laterais: ['SHELL', 'V-POWER'],
    casco: '#2f6fb0', faixa: '#e8c23a', risca: '#2f8f57', macacao: '#be2f28',
  },
  'massa-williams': {
    corpo: '#e4e6e2', detalhe: '#1f3b6e', filete: '#3f86c8', tinta: '#1f3b6e', numero: '#1f3b6e',
    faixaAsa: '#1f3b6e', patrocinio: 'WILLIAMS', tintaAsa: '#e4e6e2', pontaAsa: '#c8352b',
    asaDianteira: 'REXONA', laterais: ['MARTINI', 'REXONA'],
    casco: '#2f6fb0', faixa: '#e8c23a', risca: '#2f8f57', macacao: '#e4e6e2',
  },
  'hamilton-mercedes': {
    corpo: '#41494c', detalhe: '#1f9e8f', filete: '#c9d0cb', tinta: '#e2e6dc', numero: '#e2e6dc',
    faixaAsa: '#e7e4d6', patrocinio: 'PETRONAS', tintaAsa: '#1b262c', pontaAsa: '#1f9e8f',
    asaDianteira: 'PETRONAS', laterais: ['PETRONAS', 'INEOS'],
    casco: '#e0c93f', faixa: '#7b56a6', risca: '#e2e6dc', macacao: '#26312f',
  },
  verstappen: {
    corpo: '#263a55', detalhe: '#d9483a', filete: '#dcb035', tinta: '#e8e4d4', numero: '#dcb035',
    faixaAsa: '#e7e4d6', patrocinio: 'ORACLE', tintaAsa: '#1d262c', pontaAsa: '#d9483a',
    asaDianteira: 'BYBIT', laterais: ['ORACLE', 'RED BULL'],
    casco: '#dc6a2c', faixa: '#1f3c6b', risca: '#e2e6dc', macacao: '#1f2c3e',
  },
  'hamilton-ferrari': {
    corpo: '#b72f27', detalhe: '#e6cf3c', filete: '#e7e4d6', tinta: '#f4ead4', numero: '#e6cf3c',
    faixaAsa: '#b72f27', patrocinio: 'V-POWER', tintaAsa: '#f4ead4', pontaAsa: '#e6cf3c',
    asaDianteira: 'FERRARI', laterais: ['SANTANDER', 'AWS'],
    casco: '#e0c93f', faixa: '#b72f27', risca: '#23303a', macacao: '#8f2a24',
  },
  'bortoleto-audi': {
    corpo: '#a7abab', detalhe: '#1c1f22', filete: '#c8302c', tinta: '#1c1f22', numero: '#e7e4d6',
    faixaAsa: '#1c1f22', patrocinio: 'AUDI', tintaAsa: '#e7e4d6', pontaAsa: '#c8302c',
    asaDianteira: 'AUDI', laterais: ['AUDI SPORT', 'AUDI'],
    casco: '#e8c23a', faixa: '#2f8f57', risca: '#1c1f22', macacao: '#1c1f22',
  },
  vettel: {
    corpo: '#1f2b4c', detalhe: '#c8352b', filete: '#dcb035', tinta: '#e8e4d4', numero: '#e8e4d4',
    faixaAsa: '#1f2b4c', patrocinio: 'RED BULL', tintaAsa: '#c8352b', pontaAsa: '#dcb035',
    asaDianteira: 'INFINITI', laterais: ['INFINITI', 'TOTAL'],
    casco: '#e8e4d4', faixa: '#c8352b', risca: '#1f2b4c', macacao: '#1f2b4c',
  },
  'raikkonen-mercedes': {
    corpo: '#b3b8b9', detalhe: '#1c2124', filete: '#1f9e8f', tinta: '#1c2124', numero: '#1f9e8f',
    faixaAsa: '#1c2124', patrocinio: 'PETRONAS', tintaAsa: '#e7e4d6', pontaAsa: '#1f9e8f',
    asaDianteira: 'AMG', laterais: ['PETRONAS', 'UBS'],
    casco: '#c8352b', faixa: '#e2e6dc', risca: '#1c2124', macacao: '#1c2124',
  },
  leclerc: {
    corpo: '#b8302a', detalhe: '#1d1d1f', filete: '#e6cf3c', tinta: '#f2eddc', numero: '#f2eddc',
    faixaAsa: '#1d1d1f', patrocinio: 'FERRARI', tintaAsa: '#e6cf3c', pontaAsa: '#b8302a',
    asaDianteira: 'SHELL', laterais: ['SANTANDER', 'SHELL'],
    casco: '#c8352b', faixa: '#1d1d1f', risca: '#e7e4d6', macacao: '#b8302a',
  },
  'alonso-aston-martin': {
    corpo: '#1d5a48', detalhe: '#b8d23c', filete: '#e7e4d6', tinta: '#e7e4d6', numero: '#e7e4d6',
    faixaAsa: '#1d5a48', patrocinio: 'ARAMCO', tintaAsa: '#e7e4d6', pontaAsa: '#b8d23c',
    asaDianteira: 'ARAMCO', laterais: ['COGNIZANT', 'ARAMCO'],
    casco: '#2b5f9c', faixa: '#e8c23a', risca: '#c8352b', macacao: '#1d5a48',
  },
  'alonso-renault': {
    corpo: '#2f6db2', detalhe: '#e3c23a', filete: '#1d262c', tinta: '#e8e4d4', numero: '#1d262c',
    faixaAsa: '#2f6db2', patrocinio: 'MILD SEVEN', tintaAsa: '#e8e4d4', pontaAsa: '#e3c23a',
    asaDianteira: 'TELEFONICA', laterais: ['MILD SEVEN', 'ELF'],
    casco: '#2b5f9c', faixa: '#e3c23a', risca: '#c8352b', macacao: '#2f6db2',
  },
}

// ---------------------------------------------------------------------------
// Peças
// ---------------------------------------------------------------------------

/**
 * Uma roda, no sistema local dela.
 *
 * Do alto se vê a banda de rodagem inteira e, do lado de dentro, uma nesga de
 * aro e de disco de freio. O volume vem de cinco faixas verticais, a mesma
 * receita da carroceria, e o ombro iluminado é o que impede a peça de virar um
 * retângulo preto no meio do quadro.
 */
function desenharRoda(p: Pincel<Part>, part: Roda, tinta: Pintura) {
  const tras = part.startsWith('traseira')
  const { meiaLargura: w, meiaAltura: h } = tras ? RODA.traseira : RODA.dianteira
  const dentro = part.endsWith('Esquerda') ? 1 : -1

  // Vulto escuro do pneu, que o descola da grama e do asfalto. Vai por dentro
  // do contorno, e não por fora: é o pneu que define a largura do carro, e a
  // regra de saída de pista cobra exatamente essa largura.
  p.caixa(part, '#0a1218', -w, -h, w * 2, h * 2, w * 0.5, 0.6)

  // Banda de rodagem em faixas: o pneu é um cilindro deitado, e a luz cai nele
  // no mesmo lugar em que cai na carroceria.
  p.volume(part, BORRACHA, { y: -h + 0.3, meia: w - 0.45 }, { y: h - 0.3, meia: w - 0.45 }, CILINDRO)
  // Os topos saem de fora do cilindro: escurecer os dois devolve a curvatura
  // que a faixa reta tira.
  p.poly(part, BORRACHA[0], [[-w, -h], [w, -h], [w - 0.8, -h + 1.4], [-w + 0.8, -h + 1.4]], 0.65)
  p.poly(part, BORRACHA[0], [[-w + 0.8, h - 1.5], [w - 0.8, h - 1.5], [w, h], [-w, h]], 0.5)
  // Ombro iluminado: o fio claro no alto à esquerda é o brilho de borracha
  // nova, sem precisar de reflexo pintado.
  p.poly(part, BORRACHA[4], [[-w + 0.15, -h + 0.8], [-w + 1.1, -h + 0.5], [-w + 1.1, h - 1.1], [-w + 0.15, h - 1.6]], 0.45)

  // Sulcos longitudinais, em número diferente na frente e atrás.
  const sulcos = tras ? 4 : 3
  for (let i = 1; i <= sulcos; i += 1) {
    const x = -w + (i * 2 * w) / (sulcos + 1)
    p.rect(part, BORRACHA[0], x - 0.1, -h + 1, 0.2, 2 * h - 2, 0.7)
    p.rect(part, BORRACHA[3], x + 0.12, -h + 1, 0.08, 2 * h - 2, 0.35)
  }

  // Faixa colorida do composto, como nos pneus de corrida: só aparece no
  // flanco de dentro, que é o único que a câmera alcança.
  p.rect(part, tinta.detalhe, dentro * (w - 0.7) - 0.14, -h * 0.5, 0.28, h, 0.9)

  // Aro, disco e pinça de freio, na nesga de lado que o ângulo deixa ver.
  const aro = dentro * (w - 0.2)
  p.elipse(part, '#0a1219', aro, 0, 0.5, h * 0.7)
  p.elipse(part, METAL[1], aro, 0, 0.32, h * 0.58)
  p.elipse(part, FREIO[2], aro, 0, 0.2, h * 0.4)
  p.elipse(part, FREIO[4], aro - dentro * 0.05, -h * 0.12, 0.1, h * 0.18, 0.7)
  p.caixa(part, tinta.detalhe, aro - 0.24, -h * 0.46, 0.48, h * 0.3, 0.16)

  // Achatamento no contato com o asfalto: sem ele o pneu tangencia o chão num
  // ponto só, e o carro flutua.
  p.poly(part, '#0a1017', [[-w + 1, h - 0.45], [w - 1, h - 0.45], [w - 1.4, h], [-w + 1.4, h]], 0.55)
}

/**
 * Asa dianteira.
 *
 * É a peça mais distante e a que fecha o desenho por cima. Do alto se vê a
 * face superior dos planos, e é nela que vai o nome que se repete dos dois
 * lados — a marca mais reconhecível de um carro de corrida visto de trás.
 */
function desenharAsaDianteira(p: Pincel<Part>, tinta: Pintura, corpo: Rampa) {
  const fuga = Z.asaDianteiraFuga
  const ataque = Z.asaDianteiraAtaque
  // Bem mais estreita que a traseira: é a peça mais distante do carro, e a
  // largura dela é o que informa isso antes de qualquer outra coisa.
  const meia = fuga.x(0.5)

  // Sombra que a asa projeta no asfalto, para ela não flutuar no horizonte.
  p.faixa('asaDianteira', '#0a1418',
    { y: ataque.y(0.02), meia: meia * 0.98 }, { y: fuga.y(0.02), meia }, 0.28)

  // Flape de trás, escuro, aparecendo atrás do plano principal.
  p.faixa('asaDianteira', CARBONO[1],
    { y: fuga.y(0.34), meia: meia * 0.64 }, { y: fuga.y(0.2), meia: meia * 0.66 })
  p.faixa('asaDianteira', CARBONO[4],
    { y: fuga.y(0.34), meia: meia * 0.64 }, { y: fuga.y(0.32), meia: meia * 0.645 }, 0.6)

  // Plano principal, visto de cima: um painel largo e raso, com a face de cima
  // clara e o bordo de fuga na sombra.
  p.volume('asaDianteira', corpo,
    { y: ataque.y(0.26), meia: meia * 0.98 }, { y: fuga.y(0.22), meia }, [2, 3, 4, 3, 1])
  p.faixa('asaDianteira', tinta.filete,
    { y: ataque.y(0.26), meia: meia * 0.98 }, { y: ataque.y(0.25), meia: meia * 0.983 })
  p.faixa('asaDianteira', CARBONO[0],
    { y: fuga.y(0.22), meia }, { y: fuga.y(0.2), meia }, 0.55)

  // Nome da equipe nos dois lados, como nas artes de referência.
  const meioDoPlano = (ataque.y(0.26) + fuga.y(0.22)) / 2
  for (const lado of LADOS) {
    p.texto('asaDianteira', tinta.asaDianteira, lado * meia * 0.5,
      meioDoPlano + fuga.u * 0.022, fuga.u * 0.055, tinta.tinta)
  }

  // Derivas laterais: as duas placas verticais que fecham a silhueta e levam a
  // cor da equipe até a ponta da asa.
  for (const lado of LADOS) {
    const x = lado * meia
    p.poly('asaDianteira', tinta.detalhe, [
      [x, ataque.y(0.3)], [x + lado * ataque.u * 0.042, ataque.y(0.3)],
      [x + lado * fuga.u * 0.042, fuga.y(0.08)], [x, fuga.y(0.08)],
    ])
    p.poly('asaDianteira', misturar(tinta.detalhe, SOMBRA, 0.45), [
      [x + lado * ataque.u * 0.024, ataque.y(0.3)], [x + lado * ataque.u * 0.042, ataque.y(0.3)],
      [x + lado * fuga.u * 0.042, fuga.y(0.08)], [x + lado * fuga.u * 0.024, fuga.y(0.08)],
    ])
    p.poly('asaDianteira', tinta.filete, [
      [x, ataque.y(0.3)], [x + lado * ataque.u * 0.042, ataque.y(0.3)],
      [x + lado * ataque.u * 0.042, ataque.y(0.285)], [x, ataque.y(0.285)],
    ])
  }
}

/** Bico, suspensão dianteira e o número do carro. */
function desenharBico(p: Pincel<Part>, tinta: Pintura, corpo: Rampa, numero: number) {
  const bico = Z.bico
  const ponta = Z.asaDianteiraFuga
  const tubo = Z.tubo
  const eixo = Z.eixoDianteiro

  // Braços da suspensão dianteira, do chassi ao cubo da roda. Saem antes do
  // bico para o bico passar por cima deles, como acontece no carro.
  for (const lado of LADOS) {
    for (const altura of [0.2, 0.46]) {
      p.risco('bico', CARBONO[1], lado * tubo.x(0.22), tubo.y(altura), lado * eixo.x(0.7), eixo.y(0.31), eixo.u * 0.03)
      p.risco('bico', CARBONO[4], lado * tubo.x(0.22), tubo.y(altura) - 0.1, lado * eixo.x(0.7), eixo.y(0.31) - 0.1, eixo.u * 0.009, 0.5)
    }
    p.risco('bico', METAL[1], lado * tubo.x(0.2), tubo.y(0.56), lado * eixo.x(0.62), eixo.y(0.24), eixo.u * 0.016)
  }

  // Pilares que penduram a asa dianteira no bico: sem eles a asa fica boiando
  // acima do carro, sem nada que a prenda.
  for (const lado of LADOS) {
    p.risco('bico', CARBONO[1],
      lado * ponta.x(0.08), ponta.y(0.26), lado * ponta.x(0.13), ponta.y(0.1), ponta.u * 0.03)
  }

  /**
   * Cone do bico: um tronco de cone estreito e comprido que desce da asa até a
   * boca do chassi.
   *
   * As arestas fazem aqui o mesmo trabalho que fazem na tampa do motor: sem o
   * vinco dos dois lados, o bico é um triângulo claro pousado na tela, e não
   * uma peça com lombo. O fio de luz fica só na quina esquerda, que é a que o
   * sol alcança.
   */
  const bicoTopo = { y: ponta.y(0.3), meia: ponta.x(0.1) }
  const bicoBase = { y: tubo.y(0.4), meia: tubo.x(0.26) }
  p.volume('bico', corpo, bicoTopo, bicoBase, CILINDRO)
  for (const lado of LADOS) {
    p.aresta('bico', SOMBRA, bicoTopo, bicoBase, lado, vincoDoLado(lado) * 0.75, 0.6)
    if (lado < 0) p.aresta('bico', corpo[4], bicoTopo, bicoBase, lado, -FIO * 0.8, 0.7)
  }
  // Ponta na cor de apoio, que fecha o bico contra a asa.
  p.faixa('bico', tinta.detalhe,
    { y: ponta.y(0.3), meia: ponta.x(0.1) },
    { y: bico.y(0.34), meia: bico.x(0.14) })
  p.faixa('bico', tinta.filete,
    { y: bico.y(0.34), meia: bico.x(0.14) },
    { y: bico.y(0.32), meia: bico.x(0.145) })

  // Número do carro no dorso do bico: é a marca que se lê primeiro.
  p.texto('bico', String(numero), 0, tubo.y(0.44) - tubo.u * 0.02, tubo.u * 0.2, tinta.numero)
}

/**
 * Laterais: pontões, assoalho e tudo que dá massa ao meio do carro.
 *
 * É a maior superfície pintada do desenho, e a que mais mostra a direção da
 * luz: o pontão da esquerda pega o sol, o da direita fica na sombra, e o
 * recorte escuro embaixo assenta o carro no asfalto. É também onde descem os
 * dois patrocínios da lateral, girados como nos carros de verdade.
 */
function desenharLateral(p: Pincel<Part>, tinta: Pintura, corpo: Rampa) {
  const frente = Z.entrada
  const meio = Z.pontao
  const tras = Z.eixoTraseiro

  /**
   * Contorno do pontão em três estações, do bico para a traseira.
   *
   * O convés é uma faixa fechada: tem borda de dentro e borda de fora ao longo
   * de todo o comprimento. Sem a borda de dentro o polígono fecharia por cima
   * do eixo do carro e a carroceria viraria uma chapa só, sem cockpit nem
   * tampa de motor visíveis.
   */
  const convesDentro = [0.26, 0.285, 0.3, 0.275, 0.24] as const
  const convesFora = [0.56, 0.69, 0.74, 0.63, 0.46] as const
  const convesAltura = [0.46, 0.4, 0.34, 0.31, 0.28] as const
  const assoalhoFora = [0.6, 0.75, 0.8, 0.69, 0.52] as const
  // Cinco estações em vez de três: com três, a cintura do pontão saía em
  // quinas, e o carro parecia recortado em cartolina.
  const estacoes = [frente, estacao(2.0), meio, estacao(0.75), tras] as const

  const borda = (lado: number, larguras: readonly number[], alturas: readonly number[]): Ponto[] =>
    estacoes.map((e, i) => [lado * e.x(larguras[i]), e.y(alturas[i])] as Ponto)

  /**
   * Contorno a meio caminho entre a borda de dentro e a de fora do convés.
   *
   * Tudo o que corre pelo comprimento do pontão — faixas de tom, faixa de cor,
   * filete — é pedido assim, e não em medidas próprias. Mexer na cintura do
   * carro passa a arrastar a pintura junto, em vez de deixá-la para trás.
   */
  const entreBordas = (passo: number) =>
    convesDentro.map((interno, i) => interno + (convesFora[i] - interno) * passo)

  // Assoalho: a placa que aparece por baixo e por trás do convés, e que é o que
  // assenta o carro no asfalto. A altura sai do próprio número de estações,
  // para não sobrar lista curta quando o contorno ganhar mais uma.
  const chao = estacoes.map(() => 0.05)
  p.poly('lateral', CARBONO[1], [
    ...borda(-1, assoalhoFora, chao),
    ...borda(1, assoalhoFora, chao).reverse(),
  ])
  p.poly('lateral', CARBONO[3], [
    [-frente.x(0.6), frente.y(0.05)], [frente.x(0.6), frente.y(0.05)],
    [meio.x(0.8), meio.y(0.075)], [-meio.x(0.8), meio.y(0.075)],
  ], 0.55)
  // Lábio escuro por fora do contorno do pontão: é o que descola a carroceria
  // do assoalho e, na pista, do que estiver passando atrás dela.
  for (const lado of LADOS) {
    p.costura('lateral', SOMBRA,
      borda(lado, convesFora, convesAltura),
      borda(lado, convesFora.map((v, i) => v + (VINCO.sombra * 0.7) / estacoes[i].u), convesAltura),
      0.6)
  }

  /**
   * Vale do eixo do carro: a fresta entre os dois pontões.
   *
   * A tampa do motor cobre o miolo dela; o que sobra de cada lado é a sombra
   * em que a tampa se apoia. Sem esse vale a tampa e os pontões são duas cores
   * encostadas, e o meio do carro sai chapado por mais faixa de tom que se
   * ponha nele.
   */
  p.poly('lateral', SOMBRA, [
    ...borda(-1, convesDentro.map((v) => v + 0.03), convesAltura),
    ...borda(1, convesDentro.map((v) => v + 0.03), convesAltura).reverse(),
  ], 0.6)

  for (const lado of LADOS) {
    const claro = lado < 0
    const dentro = borda(lado, convesDentro, convesAltura)
    const fora = borda(lado, convesFora, convesAltura)

    /**
     * Convés do pontão, em faixas que acompanham a cintura.
     *
     * É a maior face pintada do carro, e uma cor chapada nela achata o carro
     * inteiro. As quatro faixas fazem o pontão virar de dentro para fora como
     * um volume de verdade: o da esquerda pega o sol na quina de fora, o da
     * direita só recebe luz de raspão.
     */
    const PERFIL_CLARO = [2, 3, 4, 4, 3, 1] as const
    const PERFIL_ESCURO = [1, 2, 3, 3, 2, 0] as const
    const perfil = claro ? PERFIL_CLARO : PERFIL_ESCURO
    for (let faixa = 0; faixa < perfil.length; faixa += 1) {
      p.poly('lateral', corpo[perfil[faixa]], [
        ...borda(lado, entreBordas(faixa / perfil.length), convesAltura),
        ...[...borda(lado, entreBordas((faixa + 1) / perfil.length), convesAltura)].reverse(),
      ])
    }
    /**
     * Costuras do convés.
     *
     * São quatro, e é delas que vem quase todo o volume do meio do carro: o
     * vinco de dentro, onde a tampa do motor se encaixa no pontão; o fio de
     * luz na mesma quina, do lado que pega sol; o lábio de fora, que descola o
     * pontão do assoalho; e a junta de painel na cintura, que quebra o convés
     * em duas chapas em vez de uma só, grande e chapada.
     */
    const recuado = (quanto: number) => borda(lado, convesDentro.map((v) => v + quanto / meio.u), convesAltura)
    p.costura('lateral', SOMBRA, dentro, recuado(vincoDoLado(lado)), 0.72)
    if (claro) p.costura('lateral', corpo[4], recuado(vincoDoLado(lado)), recuado(vincoDoLado(lado) + FIO), 0.75)
    p.costura('lateral', SOMBRA,
      borda(lado, convesFora.map((v, i) => v - VINCO.luz / estacoes[i].u), convesAltura), fora, 0.5)
    if (claro) {
      p.costura('lateral', corpo[4],
        borda(lado, convesFora.map((v, i) => v - (VINCO.luz + FIO) / estacoes[i].u), convesAltura),
        borda(lado, convesFora.map((v, i) => v - VINCO.luz / estacoes[i].u), convesAltura), 0.55)
    }
    p.costura('lateral', SOMBRA, fora, borda(lado, assoalhoFora, chao), 0.45)
    p.risco('lateral', SOMBRA, dentro[2][0], dentro[2][1], fora[2][0], fora[2][1], VINCO.luz, 0.5)

    // Boca de refrigeração, aberta para dentro, com o lábio iluminado.
    const boca = estacao(2.72)
    p.poly('lateral', '#0b151d', [
      [lado * boca.x(0.3), boca.y(0.46)],
      [lado * boca.x(0.54), boca.y(0.44)],
      [lado * frente.x(0.52), frente.y(0.4)],
      [lado * frente.x(0.28), frente.y(0.42)],
    ])
    p.poly('lateral', METAL[0], [
      [lado * boca.x(0.31), boca.y(0.455)],
      [lado * boca.x(0.53), boca.y(0.435)],
      [lado * boca.x(0.525), boca.y(0.42)],
      [lado * boca.x(0.315), boca.y(0.44)],
    ], 0.7)

    // Venezianas de saída de calor, no ombro do convés.
    for (let n = 0; n < 5; n += 1) {
      const t = 0.3 - n * 0.012
      p.risco('lateral', corpo[0], lado * meio.x(0.38 + n * 0.05), meio.y(t), lado * meio.x(0.56 + n * 0.05), meio.y(t - 0.012), meio.u * 0.012, 0.75)
      p.risco('lateral', corpo[4], lado * meio.x(0.38 + n * 0.05), meio.y(t) - 0.14, lado * meio.x(0.56 + n * 0.05), meio.y(t - 0.012) - 0.14, meio.u * 0.005, 0.4)
    }

    // Faixa de cor acompanhando a cintura do convés: é o que identifica a
    // equipe de longe, quando nenhum texto ainda se lê.
    p.poly('lateral', tinta.detalhe, [
      ...borda(lado, entreBordas(0.58), convesAltura),
      ...[...borda(lado, entreBordas(0.84), convesAltura)].reverse(),
    ])
    p.poly('lateral', tinta.filete, [
      ...borda(lado, entreBordas(0.53), convesAltura),
      ...[...borda(lado, entreBordas(0.58), convesAltura)].reverse(),
    ])
    // A faixa é adesivo colado na carroceria, e por isso tem quina própria: um
    // fio escuro embaixo dela, que a descola do tom que corre por baixo.
    p.costura('lateral', SOMBRA,
      borda(lado, entreBordas(0.84), convesAltura),
      borda(lado, entreBordas(0.87), convesAltura), 0.35)

    // Aleta do assoalho, rente ao chão, logo à frente do pneu traseiro.
    p.poly('lateral', CARBONO[3], [
      [lado * meio.x(0.78), meio.y(0.06)],
      [lado * meio.x(0.9), meio.y(0.11)],
      [lado * tras.x(0.68), tras.y(0.1)],
      [lado * tras.x(0.58), tras.y(0.04)],
    ])

    // Os dois patrocínios da lateral: o de fora desce pela parte mais larga do
    // convés, o de dentro acompanha a borda junto do cockpit.
    p.texto('lateral', tinta.laterais[0], lado * meio.x(0.5), meio.y(0.31), meio.u * 0.07, tinta.tinta, lado * 66)
    p.texto('lateral', tinta.laterais[1], lado * meio.x(0.34), meio.y(0.3), meio.u * 0.052, tinta.tinta, lado * 74)
  }
}


/**
 * Cockpit, piloto e tampa do motor: a espinha do carro.
 *
 * Saem juntos porque são uma coisa só na leitura — o rasgo escuro do cockpit
 * existe para emoldurar o capacete, e a tomada de ar existe para fechá-lo por
 * trás. Separá-los em três funções deixava as três se desencontrarem a cada
 * ajuste de altura.
 *
 * O capacete é maior do que a projeção pediria. Achatar a altura, que é o que
 * dá a proporção certa ao carro, esmagaria a cabeça até virar uma pastilha, e
 * o piloto é justamente o que impede o carro de parecer um objeto. Top Gear e
 * Horizon Chase tomam a mesma licença, e pelo mesmo motivo.
 */
function desenharEspinha(p: Pincel<Part>, tinta: Pintura, corpo: Rampa, code: string, moderno: boolean) {
  const frente = Z.cockpit
  const c = Z.capacete
  const a = Z.airbox
  const m = Z.motor
  const t = Z.eixoTraseiro
  const longe = estacao(2.62)
  const perto = estacao(1.5)

  // Tampo do chassi, do bico até a borda do cockpit, com as mesmas arestas do
  // bico: as duas peças são o mesmo lombo, e precisam continuar uma na outra.
  const tampoTopo = { y: Z.tubo.y(0.42), meia: Z.tubo.x(0.26) }
  const tampoBase = { y: longe.y(0.6), meia: longe.x(0.42) }
  p.volume('cockpit', corpo, tampoTopo, tampoBase, CILINDRO)
  for (const lado of LADOS) {
    p.aresta('cockpit', SOMBRA, tampoTopo, tampoBase, lado, vincoDoLado(lado) * 0.75, 0.6)
    if (lado < 0) p.aresta('cockpit', corpo[4], tampoTopo, tampoBase, lado, -FIO * 0.8, 0.7)
  }

  // Borda do cockpit: uma moldura clara em volta de um vão escuro. É o vão que
  // faz o capacete existir; sem ele a cabeça ficaria pousada na carroceria.
  p.faixa('cockpit', corpo[1],
    { y: longe.y(0.62), meia: longe.x(0.42) },
    { y: perto.y(0.62), meia: perto.x(0.46) })
  p.faixa('cockpit', '#0a1219',
    { y: longe.y(0.6), meia: longe.x(0.25) },
    { y: perto.y(0.6), meia: perto.x(0.28) })
  // Espuma de proteção de cabeça, que emoldura o capacete dos dois lados.
  for (const lado of LADOS) {
    p.poly('cockpit', tinta.detalhe, [
      [lado * longe.x(0.42), longe.y(0.62)],
      [lado * longe.x(0.24), longe.y(0.62)],
      [lado * perto.x(0.27), perto.y(0.62)],
      [lado * perto.x(0.46), perto.y(0.62)],
    ])
    p.poly('cockpit', misturar(tinta.detalhe, LUZ, 0.3), [
      [lado * longe.x(0.42), longe.y(0.62)],
      [lado * longe.x(0.35), longe.y(0.62)],
      [lado * perto.x(0.39), perto.y(0.62)],
      [lado * perto.x(0.46), perto.y(0.62)],
    ], 0.6)
  }

  // Retrovisores, na haste, com o vidro virado para o piloto.
  for (const lado of LADOS) {
    p.risco('cockpit', CARBONO[1], lado * frente.x(0.36), frente.y(0.62), lado * frente.x(0.6), frente.y(0.64), frente.u * 0.02)
    p.caixa('cockpit', CARBONO[2], lado * frente.x(0.6) - frente.x(0.06), frente.y(0.64) - frente.u * 0.05, frente.x(0.12), frente.u * 0.08, frente.u * 0.02)
    p.rect('cockpit', '#7fb6c4', lado * frente.x(0.6) - frente.x(0.045), frente.y(0.64) - frente.u * 0.04, frente.x(0.09), frente.u * 0.045, 0.9)
    p.rect('cockpit', '#dcf2f0', lado * frente.x(0.6) - frente.x(0.045), frente.y(0.64) - frente.u * 0.04, frente.x(0.09), frente.u * 0.015, 0.7)
  }

  // ---- Piloto -------------------------------------------------------------
  const casco = rampa(tinta.casco)
  const meiaCabeca = c.x(0.19)
  const meiaAltura = meiaCabeca * 1.05
  const cabeca = (c.y(0.7) + perto.y(0.7)) / 2 - meiaAltura * 0.5

  // Ombros e cintos, atrás da cabeça em profundidade e portanto abaixo dela.
  p.faixa('piloto', misturar(tinta.macacao, SOMBRA, 0.4),
    { y: cabeca + meiaAltura * 0.3, meia: c.x(0.32) },
    { y: cabeca + meiaAltura * 1.6, meia: c.x(0.36) })
  p.faixa('piloto', tinta.macacao,
    { y: cabeca + meiaAltura * 0.4, meia: c.x(0.29) },
    { y: cabeca + meiaAltura * 1.55, meia: c.x(0.33) })
  for (const lado of LADOS) {
    p.risco('piloto', '#e4e7db',
      lado * c.x(0.22), cabeca + meiaAltura * 1.5, lado * c.x(0.12), cabeca + meiaAltura * 0.45, c.u * 0.026, 0.85)
  }
  // Braços indo para o volante, que fica à frente da cabeça.
  for (const lado of LADOS) {
    p.risco('piloto', misturar(tinta.macacao, SOMBRA, 0.12),
      lado * c.x(0.3), cabeca + meiaAltura * 0.9, lado * c.x(0.2), cabeca - meiaAltura * 0.9, c.u * 0.055)
    p.elipse('piloto', '#1b252c', lado * c.x(0.2), cabeca - meiaAltura * 0.95, c.x(0.055), c.u * 0.035)
  }
  p.caixa('piloto', '#141d24', -c.x(0.17), cabeca - meiaAltura * 1.2, c.x(0.34), c.u * 0.05, c.u * 0.02)

  // Capacete. `na` percorre o casco do alto da cabeça até o queixo, para faixa,
  // risca e viseira ficarem sempre na mesma proporção, seja qual for o tamanho.
  const na = (fracao: number) => cabeca - meiaAltura + fracao * meiaAltura * 2
  p.caixa('piloto', '#0e161c', -meiaCabeca - 0.35, cabeca - meiaAltura - 0.35,
    (meiaCabeca + 0.35) * 2, (meiaAltura + 0.35) * 2, meiaCabeca * 0.62, 0.85)
  p.caixa('piloto', casco[2], -meiaCabeca, cabeca - meiaAltura, meiaCabeca * 2, meiaAltura * 2, meiaCabeca * 0.58)
  p.volume('piloto', casco,
    { y: na(0.16), meia: meiaCabeca * 0.98 }, { y: na(0.9), meia: meiaCabeca * 0.98 }, CILINDRO)
  // Alto do casco, que é onde o sol bate em cheio.
  p.faixa('piloto', casco[4], { y: na(0.08), meia: meiaCabeca * 0.8 }, { y: na(0.3), meia: meiaCabeca * 0.95 }, 0.45)
  // Faixa do desenho do piloto, com a risca logo abaixo.
  p.faixa('piloto', tinta.faixa, { y: na(0.34), meia: meiaCabeca * 0.96 }, { y: na(0.5), meia: meiaCabeca })
  p.faixa('piloto', tinta.risca, { y: na(0.5), meia: meiaCabeca }, { y: na(0.56), meia: meiaCabeca })
  // Viseira: escura, com a linha de céu refletida na borda de cima.
  p.faixa('piloto', '#0c1920', { y: na(0.58), meia: meiaCabeca }, { y: na(0.88), meia: meiaCabeca * 0.9 })
  p.faixa('piloto', '#74aab4', { y: na(0.61), meia: meiaCabeca * 0.96 }, { y: na(0.68), meia: meiaCabeca * 0.94 }, 0.7)
  for (const lado of LADOS) {
    p.elipse('piloto', METAL[3], lado * meiaCabeca * 0.94, na(0.74), c.u * 0.014, c.u * 0.016)
  }
  p.texto('piloto', code, 0, na(0.28), c.u * 0.055, tinta.risca)

  // ---- Arco de proteção, tomada de ar e tampa do motor --------------------
  if (moderno) {
    // Halo: o arco que envolve a cabeça, com o pilar à frente dela.
    const arco = meiaAltura * 1.5
    for (const lado of LADOS) {
      p.risco('cockpit', CARBONO[0], lado * (meiaCabeca + arco * 0.45), cabeca + arco * 0.7, lado * meiaCabeca * 0.85, cabeca - arco * 0.8, c.u * 0.042)
      p.risco('cockpit', METAL[0], lado * (meiaCabeca + arco * 0.45) - 0.25, cabeca + arco * 0.7, lado * meiaCabeca * 0.85 - 0.25, cabeca - arco * 0.8, c.u * 0.012, 0.45)
    }
    p.faixa('cockpit', CARBONO[1],
      { y: cabeca - arco * 0.86, meia: meiaCabeca * 0.9 }, { y: cabeca - arco * 0.68, meia: meiaCabeca * 0.9 })
    p.risco('cockpit', CARBONO[1], 0, cabeca - arco * 0.74, 0, cabeca - arco * 1.25, c.u * 0.03)
  } else {
    // Santantônio da época: uma barra de metal atrás da cabeça.
    p.caixa('cockpit', METAL[1], -meiaCabeca * 0.8, cabeca + meiaAltura * 0.6, meiaCabeca * 1.6, c.u * 0.1, c.u * 0.03)
    p.rect('cockpit', METAL[4], -meiaCabeca * 0.72, cabeca + meiaAltura * 0.6, meiaCabeca * 1.44, c.u * 0.02, 0.6)
  }

  /**
   * Tomada de ar e tampa do motor.
   *
   * São a peça mais alta do meio do carro, e precisam parecer apoiadas sobre
   * os pontões em vez de pintadas neles. Quem faz isso são as arestas: um
   * vinco escuro de cada lado, largo no flanco da sombra e estreito no do sol,
   * o fio de luz na quina esquerda e a espinha clara no alto. Sem elas a tampa
   * some no convés, e o carro inteiro vira uma chapa.
   */
  const bocaTopo = { y: perto.y(0.98), meia: perto.x(0.2) }
  const bocaBase = { y: a.y(0.9), meia: a.x(0.26) }
  const tampaBase = { y: t.y(0.5), meia: t.x(0.21) }

  // Sombra que a tampa projeta no convés, por fora do contorno dela.
  for (const lado of LADOS) {
    p.aresta('motor', SOMBRA, bocaTopo, tampaBase, lado, -vincoDoLado(lado) * 0.9, 0.4)
  }

  p.volume('motor', corpo, bocaTopo, bocaBase, CILINDRO)
  p.faixa('motor', '#0a1218',
    { y: perto.y(0.96), meia: perto.x(0.15) }, { y: perto.y(0.9), meia: perto.x(0.17) })
  p.rect('motor', METAL[0], -perto.x(0.13), perto.y(0.96), perto.x(0.26), a.u * 0.012, 0.65)

  // Tampa do motor descendo da tomada de ar até a caixa de câmbio.
  p.volume('motor', corpo, bocaBase, tampaBase, CILINDRO)

  // Arestas da peça inteira, da boca da tomada de ar até o câmbio.
  for (const lado of LADOS) {
    p.aresta('motor', SOMBRA, bocaTopo, tampaBase, lado, vincoDoLado(lado), 0.66)
    if (lado < 0) p.aresta('motor', corpo[4], bocaTopo, tampaBase, lado, -FIO, 0.7)
  }
  // Espinha central: a quina de cima da tampa, onde o sol bate em cheio.
  p.poly('motor', corpo[4], [
    [-a.x(0.05), a.y(0.9)], [a.x(0.02), a.y(0.9)],
    [t.x(0.015), t.y(0.5)], [-t.x(0.04), t.y(0.5)],
  ], 0.55)
  p.poly('motor', SOMBRA, [
    [a.x(0.02), a.y(0.9)], [a.x(0.05), a.y(0.9)],
    [t.x(0.04), t.y(0.5)], [t.x(0.015), t.y(0.5)],
  ], 0.35)
  // Faixa da equipe pelo meio da tampa, com o filete de contraste ao lado.
  p.faixa('motor', tinta.detalhe, { y: a.y(0.89), meia: a.x(0.085) }, { y: t.y(0.5), meia: t.x(0.075) })
  p.poly('motor', tinta.filete, [
    [-a.x(0.09), a.y(0.89)], [-a.x(0.07), a.y(0.89)],
    [-t.x(0.06), t.y(0.5)], [-t.x(0.08), t.y(0.5)],
  ])

  // Venezianas do cofre do motor, nos dois flancos da tampa.
  for (const lado of LADOS) {
    for (let n = 0; n < 4; n += 1) {
      const y = m.y(0.78 - n * 0.06)
      p.risco('motor', corpo[0], lado * m.x(0.12), y, lado * m.x(0.25), y + m.u * 0.016, m.u * 0.02, 0.75)
      p.risco('motor', corpo[4], lado * m.x(0.12), y - 0.14, lado * m.x(0.25), y + m.u * 0.016 - 0.14, m.u * 0.006, 0.4)
    }
  }
}

/** Traseira: câmbio, difusor, escapamento, suspensão e a luz de chuva. */
function desenharTraseira(p: Pincel<Part>, tinta: Pintura, corpo: Rampa) {
  const t = Z.caixa
  const saida = Z.difusorSaida
  const entrada = Z.difusorEntrada
  const e = Z.eixoTraseiro

  // Difusor primeiro, porque tudo o mais na traseira passa por cima dele: é a
  // peça mais baixa do carro e o fundo escuro contra o qual a suspensão e o
  // escapamento aparecem.
  const meiaSaida = saida.x(0.58)
  const meiaEntrada = entrada.x(0.5)
  p.faixa('traseira', '#0b141b',
    { y: entrada.y(0.16), meia: meiaEntrada }, { y: saida.y(0.3), meia: meiaSaida })
  for (let n = -2; n <= 2; n += 1) {
    const dentro = n * 0.24
    p.poly('traseira', CARBONO[2], [
      [entrada.x(dentro - 0.02), entrada.y(0.16)], [entrada.x(dentro + 0.02), entrada.y(0.16)],
      [saida.x(dentro + 0.024), saida.y(0.3)], [saida.x(dentro - 0.024), saida.y(0.3)],
    ])
    p.poly('traseira', CARBONO[4], [
      [entrada.x(dentro - 0.02), entrada.y(0.16)], [entrada.x(dentro - 0.008), entrada.y(0.16)],
      [saida.x(dentro - 0.01), saida.y(0.3)], [saida.x(dentro - 0.024), saida.y(0.3)],
    ], 0.45)
  }
  // Bordo de saída do difusor, na cor da equipe: o fio que fecha o carro
  // embaixo e impede a peça de se dissolver no asfalto.
  p.faixa('traseira', tinta.detalhe,
    { y: saida.y(0.3), meia: meiaSaida }, { y: saida.y(0.26), meia: meiaSaida })
  p.faixa('traseira', SOMBRA,
    { y: saida.y(0.26), meia: meiaSaida }, { y: saida.y(0.24), meia: meiaSaida * 0.99 }, 0.5)

  // Caixa de câmbio e estrutura de impacto, o bloco central da traseira.
  p.volume('traseira', CARBONO,
    { y: e.y(0.5), meia: e.x(0.2) }, { y: t.y(0.3), meia: t.x(0.15) }, [2, 3, 3, 1, 0])
  p.faixa('traseira', CARBONO[0], { y: t.y(0.3), meia: t.x(0.15) }, { y: t.y(0.2), meia: t.x(0.12) })

  // Braços da suspensão traseira e semieixos, em metal claro sobre o escuro do
  // câmbio: é o que dá leitura mecânica à traseira em vez de um bloco chapado.
  for (const lado of LADOS) {
    for (const [dentro, fora] of [[0.5, 0.36], [0.26, 0.3]] as const) {
      p.risco('traseira', CARBONO[1], lado * e.x(0.2), e.y(dentro), lado * e.x(0.74), e.y(fora), e.u * 0.032)
      p.risco('traseira', METAL[3], lado * e.x(0.2), e.y(dentro) - 0.16, lado * e.x(0.74), e.y(fora) - 0.16, e.u * 0.011, 0.6)
    }
    p.risco('traseira', METAL[1], lado * e.x(0.15), e.y(0.33), lado * e.x(0.7), e.y(0.33), e.u * 0.042)
    p.risco('traseira', METAL[4], lado * e.x(0.15), e.y(0.33) - 0.2, lado * e.x(0.7), e.y(0.33) - 0.2, e.u * 0.012, 0.55)
    // Amortecedor deitado sobre o câmbio.
    p.risco('traseira', METAL[2], lado * e.x(0.06), e.y(0.52), lado * e.x(0.3), e.y(0.46), e.u * 0.022)
  }

  // Escapamento no alto do câmbio: tubo de metal quente, boca escura.
  p.elipse('traseira', METAL[0], 0, t.y(0.56), t.u * 0.052, t.u * 0.034)
  p.elipse('traseira', METAL[4], 0, t.y(0.56), t.u * 0.04, t.u * 0.025, 0.9)
  p.elipse('traseira', '#140e0b', 0, t.y(0.56), t.u * 0.026, t.u * 0.016)
}

/**
 * Luz de chuva: a matriz de nove pontos no centro da traseira.
 *
 * Fica em função própria porque o mesmo desenho é reaproveitado aceso, quando
 * o carro está no boost, e é dela que sai a posição usada pelo brilho.
 */
function pontosDaLuz(d: Estacao) {
  const centro = { x: 0, y: d.y(0.42) }
  const pontos: { x: number; y: number; largura: number; altura: number }[] = []
  for (let linha = 0; linha < 3; linha += 1) {
    for (const coluna of [-1, 0, 1]) {
      pontos.push({
        x: centro.x + coluna * d.u * 0.026 - d.u * 0.01,
        y: centro.y - d.u * 0.032 + linha * d.u * 0.026,
        largura: d.u * 0.02,
        altura: d.u * 0.018,
      })
    }
  }
  return { centro, pontos }
}

/**
 * Asa traseira.
 *
 * É a peça mais próxima da câmera e a que dá a identidade do carro de longe: é
 * nela que vai o painel de patrocínio, e é o contorno dela que o rival enxerga
 * primeiro. Por isso leva a maior parte do detalhe — dois planos, o vão entre
 * eles, as placas laterais e os dois pilares de sustentação.
 */
function desenharAsaTraseira(p: Pincel<Part>, tinta: Pintura, corpo: Rampa, car: { number: number }) {
  const fuga = Z.asaFuga
  const ataque = Z.asaAtaque
  /**
   * Meia-envergadura da asa traseira: vai até a borda de dentro do pneu.
   *
   * Ela precisa ser a barra mais larga e mais pesada do desenho, porque é a
   * peça mais perto da câmera. Quando a asa dianteira saía mais larga que
   * esta, o olho lia a barra de cima como a mais próxima e o carro parecia
   * vindo de frente — a perspectiva inteira invertia em cima de um número.
   */
  const meia = fuga.x(0.625)

  // Pilares em pescoço de cisne, da tampa do motor até o plano principal.
  for (const lado of LADOS) {
    p.poly('asaTraseira', CARBONO[1], [
      [lado * ataque.x(0.09), ataque.y(0.5)], [lado * ataque.x(0.15), ataque.y(0.5)],
      [lado * fuga.x(0.14), fuga.y(0.88)], [lado * fuga.x(0.08), fuga.y(0.88)],
    ])
    p.risco('asaTraseira', CARBONO[4],
      lado * ataque.x(0.1), ataque.y(0.5), lado * fuga.x(0.09), fuga.y(0.88), fuga.u * 0.012, 0.4)
  }

  /**
   * Plano principal.
   *
   * Tem corda: o bordo de ataque está quase trinta centímetros à frente do
   * bordo de fuga, e é essa profundidade que dá à asa uma face de cima larga
   * onde o painel de patrocínio cabe inteiro. Sem ela a asa seria um fio.
   */
  const ataqueY = ataque.y(0.92)
  const fugaY = fuga.y(0.88)
  p.faixa('asaTraseira', CARBONO[0],
    { y: fugaY, meia }, { y: fugaY + fuga.u * 0.045, meia }, 0.8)
  p.volume('asaTraseira', corpo,
    { y: ataqueY, meia: meia * 0.99 }, { y: fugaY, meia }, [2, 4, 3, 2, 1])
  p.faixa('asaTraseira', corpo[4],
    { y: ataqueY, meia: meia * 0.99 }, { y: ataqueY + fuga.u * 0.012, meia: meia * 0.992 }, 0.7)

  // Painel de patrocínio, que é a marca que se lê de mais longe no carro.
  const alturaFaixa = (fugaY - ataqueY) * 0.52
  const faixaTopo = ataqueY + (fugaY - ataqueY) * 0.26
  p.rect('asaTraseira', tinta.faixaAsa, -meia, faixaTopo, meia * 2, alturaFaixa)
  // Blocos de cor nas duas pontas da faixa, como nas artes de referência.
  for (const lado of LADOS) {
    const largura = meia * 0.28
    p.rect('asaTraseira', tinta.pontaAsa, lado < 0 ? -meia : meia - largura, faixaTopo, largura, alturaFaixa)
    p.poly('asaTraseira', tinta.faixaAsa, [
      [lado * (meia - largura), faixaTopo],
      [lado * (meia - largura * 0.3), faixaTopo],
      [lado * (meia - largura), faixaTopo + alturaFaixa],
    ])
  }
  p.texto('asaTraseira', tinta.patrocinio, 0, faixaTopo + alturaFaixa * 0.78, alturaFaixa * 0.82, tinta.tintaAsa)
  p.rect('asaTraseira', misturar(tinta.faixaAsa, SOMBRA, 0.5),
    -meia, faixaTopo + alturaFaixa, meia * 2, fuga.u * 0.009, 0.55)

  /**
   * Flape superior.
   *
   * Tem corda curta e fica à frente do plano principal, e é por isso que
   * aparece acima dele na tela em vez de cobri-lo. Com a corda do plano
   * inteiro, o flape virava um bloco escuro por cima do painel de patrocínio e
   * comia a peça que mais identifica o carro.
   */
  const flapeAtaqueY = Z.flapeAtaque.y(1.16)
  const flapeFugaY = Z.flapeFuga.y(1.12)
  p.faixa('asaTraseira', CARBONO[0], { y: flapeFugaY, meia: meia * 0.97 }, { y: flapeFugaY + fuga.u * 0.028, meia: meia * 0.97 }, 0.75)
  p.volume('asaTraseira', CARBONO,
    { y: flapeAtaqueY, meia: meia * 0.96 }, { y: flapeFugaY, meia: meia * 0.97 }, [2, 3, 3, 2, 1])
  p.faixa('asaTraseira', CARBONO[4],
    { y: flapeAtaqueY, meia: meia * 0.96 }, { y: flapeAtaqueY + fuga.u * 0.011, meia: meia * 0.962 }, 0.65)
  // Fenda do DRS: o rasgo escuro no meio do flape.
  p.rect('asaTraseira', '#0a1015', -meia * 0.3, (flapeAtaqueY + flapeFugaY) / 2, meia * 0.6, fuga.u * 0.012, 0.75)

  /**
   * Placas laterais.
   *
   * São chapas verticais: têm corda e altura, então no desenho viram um
   * quadrilátero entre as duas estações da asa. São elas que emolduram o carro
   * e fecham a silhueta pelos lados.
   */
  for (const lado of LADOS) {
    const placa = (dentro: number, alto: number, baixo: number): Ponto[] => [
      [lado * ataque.x(0.6 + dentro), ataque.y(alto)],
      [lado * fuga.x(0.6 + dentro), fuga.y(alto)],
      [lado * fuga.x(0.6 + dentro), fuga.y(baixo)],
      [lado * ataque.x(0.6 + dentro), ataque.y(baixo)],
    ]
    p.poly('asaTraseira', tinta.detalhe, placa(0.045, 1.2, 0.52))
    p.poly('asaTraseira', misturar(tinta.detalhe, SOMBRA, 0.4), placa(0.045, 0.86, 0.52))
    p.poly('asaTraseira', CARBONO[1], placa(0.045, 1.2, 1.12))
    p.poly('asaTraseira', tinta.filete, placa(0.045, 1.0, 0.96))
    // Rasgos de saída na parte de baixo da placa.
    for (let n = 0; n < 3; n += 1) {
      p.poly('asaTraseira', CARBONO[0], placa(0.045, 0.78 - n * 0.08, 0.75 - n * 0.08), 0.6)
    }
    p.texto('asaTraseira', String(car.number),
      lado * fuga.x(0.62), (fuga.y(0.92) + fuga.y(0.78)) / 2, fuga.u * 0.055, tinta.tinta, lado * 90)
  }
}

const cache = new Map<CarId, CarModel>()

/**
 * Molde pronto de um carro.
 *
 * Fica em cache porque montar o modelo é percorrer algumas centenas de faces,
 * e tanto o SVG da garagem quanto o sprite da corrida pedem o mesmo carro
 * várias vezes.
 */
export function carModel(id: CarId): CarModel {
  const guardado = cache.get(id)
  if (guardado) return guardado

  const faces: Face[] = []
  const labels: Label[] = []
  const p = pincel(faces, labels)
  const tinta = PINTURAS[id]
  const car = carById(id)
  const corpo = rampa(tinta.corpo)
  // Halo é peça de carro moderno; nos dois carros dos anos noventa o piloto
  // aparece atrás de uma barra simples, que é o que havia na época.
  const moderno = id !== 'senna' && id !== 'schumacher'

  // Sombra de contato, por baixo de tudo: uma mancha sob o carro e uma mais
  // fechada sob cada pneu, que é o que assenta a peça no asfalto.
  for (const m of SOMBRA_DE_CONTATO) p.elipse('sombra', m.cor, m.x, m.y, m.rx, m.ry, m.alpha)

  desenharAsaDianteira(p, tinta, corpo)
  desenharRoda(p, 'dianteiraEsquerda', tinta)
  desenharRoda(p, 'dianteiraDireita', tinta)
  desenharBico(p, tinta, corpo, car.number)
  desenharLateral(p, tinta, corpo)
  desenharEspinha(p, tinta, corpo, car.code, moderno)
  desenharRoda(p, 'traseiraEsquerda', tinta)
  desenharRoda(p, 'traseiraDireita', tinta)
  desenharTraseira(p, tinta, corpo)

  // A luz de chuva fica entre o difusor e a asa: desenhada depois da traseira
  // para a moldura escura dela não ser comida pelas lâminas do difusor.
  const luz = pontosDaLuz(Z.difusorSaida)
  p.caixa('traseira', '#0a1116', luz.centro.x - Z.difusorSaida.u * 0.046, luz.centro.y - Z.difusorSaida.u * 0.046,
    Z.difusorSaida.u * 0.092, Z.difusorSaida.u * 0.092, Z.difusorSaida.u * 0.018)
  for (const ponto of luz.pontos) p.rect('traseira', '#5c1d1e', ponto.x, ponto.y, ponto.largura, ponto.altura)

  desenharAsaTraseira(p, tinta, corpo, car)

  const modelo: CarModel = {
    faces,
    labels,
    luzDeChuva: { x: luz.centro.x, y: luz.centro.y, raio: Z.difusorSaida.u * 0.09 },
    escapamento: { x: 0, y: Z.caixa.y(0.56), raio: Z.caixa.u * 0.06 },
  }
  cache.set(id, modelo)
  return modelo
}
