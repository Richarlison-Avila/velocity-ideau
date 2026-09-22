/**
 * Folha de sprites do cenário.
 *
 * Todo objeto da beira da pista é assado uma vez, numa folha só, e desenhado
 * com um `drawImage`. É a mesma troca que resolveu o carro, e pelo mesmo
 * motivo — mas com uma correção que só apareceu ao medir.
 *
 * A intuição diz que assar serve para o que está longe, onde há muitos objetos
 * pequenos, e que o objeto colado na câmera deveria ser desenhado ao vivo para
 * não borrar. É o contrário. Um objeto pequeno custa **chamadas**; um objeto
 * grande custa **área escrita**. Uma árvore de setecentos pixels com trinta
 * faces e alguma sobreposição escreve um milhão e meio de pixels — mais do que
 * todas as faixas de grama da pista somadas. A mesma árvore esticada de uma
 * célula de 256 escreve meio milhão. **A folha é o caminho rápido justamente
 * para o que está perto.**
 *
 * E o borrão ali custa pouco: a sessenta metros por segundo, um objeto a cinco
 * metros da câmera atravessa a tela em seis quadros. O orçamento de nitidez
 * rende entre trinta e oitenta metros, onde o objeto fica mais de um segundo
 * em cena.
 *
 * Duas famílias não passam por aqui. A **cerca** precisa que as travessas de
 * vagas vizinhas se encontrem, e isso depende das projeções das duas vagas —
 * assada por vaga, ela viraria uma fila de portõezinhos soltos. O **pórtico**
 * atravessa a pista e chega a dois mil pixels de largura, e é barato de
 * desenhar. Os dois continuam procedurais.
 */
import { SCENERY_SPACING, type Flora } from './layout'
import { rampa } from './paleta'
import { LADOS } from './pincel'
import {
  TONS,
  VARIANTES,
  objetoModelado,
  type Detalhe,
  type FamiliaModelada,
} from './cenarioModel'

/**
 * Altura da célula grande de cada família, em pixels.
 *
 * Não é um número só para todas: o capim aparece com quarenta e cinco pixels
 * na pior projeção e uma célula de duzentos ali seria memória jogada fora. A
 * régua é a pior altura que a família alcança na tela, dividida pela
 * ampliação que se aceita — duas vezes, fora a árvore, que é grande demais
 * para caber nessa conta sem inchar a folha.
 */
const ALTURA_CHEIA: Record<FamiliaModelada, number> = {
  tree: 256,
  bush: 128,
  grass: 48,
  sign: 128,
  marcador: 96,
  pneus: 80,
  poste: 224,
  arquibancada: 144,
  bandeira: 144,
  pedra: 96,
  cacto: 160,
  predio: 256,
}

/**
 * Abaixo desta altura na tela o objeto sai da célula pequena.
 *
 * Metade dos objetos visíveis num quadro tem menos de sessenta pixels: é
 * metade do trabalho de assar e da banda de leitura, por um detalhe que não
 * chega a existir nesse tamanho.
 */
const LIMIAR_SIMPLES = 64

/** A célula pequena é um quarto da grande, e leva um terço das faces. */
const REDUCAO_SIMPLES = 4

/**
 * Largura máxima da folha.
 *
 * Uma tira de uma linha só, como a do carro, daria vinte mil pixels de
 * largura — acima do limite de textura de quase todo aparelho móvel. A folha
 * é uma grade, e os dois eixos ficam abaixo de 4096.
 */
const LARGURA_MAXIMA = 2048

/**
 * Sombra que todo objeto deixa no chão.
 *
 * É o detalhe mais barato do cenário e o que mais rende: sem ela, tudo o que
 * fica na beira da pista paira alguns pixels acima da grama e a cena perde o
 * assentamento. Fica **fora** da célula, e não é preciosismo: ela é
 * translúcida, e uma face translúcida dentro do sprite daria uma cor quando
 * composta na folha e outra quando composta ao vivo — o objeto mudaria de cor
 * ao trocar de nível de detalhe. Deslocada para a direita, porque a luz vem
 * da esquerda em tudo no jogo.
 */
const SOMBRA_NO_CHAO = 'rgba(10,20,26,.3)'

/** Estrutura do pórtico e as faixas de patrocínio que ele carrega. */
const PORTICO = rampa('#98a2a8')
const FAIXAS_DO_PORTICO = ['#cf4436', '#2f6f8f', '#e6b325'].map(rampa)

/**
 * Por quantas vagas o pórtico continua sendo desenhado depois de a câmera
 * passar por baixo dele.
 *
 * `roadProjection` trava em `ahead = 0`: nada cresce além do tamanho que tem
 * ali. Uma árvore some pela lateral e ninguém nota, mas um arco que atravessa
 * a pista congelaria no tamanho máximo e apagaria de um quadro para o outro,
 * com a tela cheia dele. Estas vagas extras são o espaço em que ele sobe e se
 * dissolve, em vez de piscar.
 */
export const RECUO_DO_PORTICO = 5

type Celula = {
  x: number
  y: number
  largura: number
  altura: number
  /** Meia-largura do modelo, para converter altura pedida em largura na tela. */
  meiaLargura: number
}

type Folha = {
  tela: HTMLCanvasElement
  celulas: Map<string, Celula>
}

const chaveDaCelula = (familia: FamiliaModelada, variante: number, tom: number, detalhe: Detalhe) =>
  `${familia}|${variante}|${tom}|${detalhe}`

/** Toda combinação que a folha precisa guardar, na ordem em que será empacotada. */
function combinacoes() {
  const lista: { familia: FamiliaModelada; variante: number; tom: number; detalhe: Detalhe; altura: number }[] = []
  for (const familia of Object.keys(VARIANTES) as FamiliaModelada[]) {
    for (let variante = 0; variante < VARIANTES[familia]; variante += 1) {
      for (let tom = 0; tom < TONS[familia]; tom += 1) {
        for (const detalhe of ['cheio', 'simples'] as const) {
          const altura = detalhe === 'cheio'
            ? ALTURA_CHEIA[familia]
            : Math.max(12, Math.round(ALTURA_CHEIA[familia] / REDUCAO_SIMPLES))
          lista.push({ familia, variante, tom, detalhe, altura })
        }
      }
    }
  }
  // Da mais alta para a mais baixa: é o que faz o empacotamento por prateleiras
  // desperdiçar pouco, sem precisar de um empacotador de verdade.
  return lista.sort((a, b) => b.altura - a.altura)
}

/**
 * Banha a folha inteira na cor da névoa, só onde há desenho.
 *
 * É como a luz de ambiente entra no carro, em `carSprites.ts`, e é o que
 * mantém cenário e carro sob o mesmo sol — sem isso o objeto aparece recortado
 * de outra cena, por mais que a paleta coincida.
 */
function banhar(ctx: CanvasRenderingContext2D, largura: number, altura: number, nevoaRGB: string) {
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'source-atop'
  ctx.globalAlpha = 0.1
  ctx.fillStyle = `rgb(${nevoaRGB})`
  ctx.fillRect(0, 0, largura, altura)
  ctx.restore()
}

function assar(flora: Flora, nevoaRGB: string): Folha {
  const pedidos = combinacoes().map((pedido) => {
    const modelo = objetoModelado(pedido.familia, flora, pedido.variante, pedido.tom, pedido.detalhe)
    return {
      ...pedido,
      modelo,
      largura: Math.ceil(pedido.altura * modelo.meiaLargura * 2),
    }
  })

  // Empacotamento por prateleiras: cada linha tem a altura do primeiro objeto
  // que entrou nela, e quebra quando não cabe mais.
  const celulas = new Map<string, Celula>()
  let x = 0
  let y = 0
  let alturaDaLinha = 0
  let larguraUsada = 0
  for (const pedido of pedidos) {
    if (x + pedido.largura > LARGURA_MAXIMA) {
      x = 0
      y += alturaDaLinha
      alturaDaLinha = 0
    }
    celulas.set(chaveDaCelula(pedido.familia, pedido.variante, pedido.tom, pedido.detalhe), {
      x,
      y,
      largura: pedido.largura,
      altura: pedido.altura,
      meiaLargura: pedido.modelo.meiaLargura,
    })
    x += pedido.largura
    larguraUsada = Math.max(larguraUsada, x)
    alturaDaLinha = Math.max(alturaDaLinha, pedido.altura)
  }

  const tela = document.createElement('canvas')
  tela.width = Math.max(1, larguraUsada)
  tela.height = Math.max(1, y + alturaDaLinha)
  const ctx = tela.getContext('2d')!

  for (const pedido of pedidos) {
    const celula = celulas.get(chaveDaCelula(pedido.familia, pedido.variante, pedido.tom, pedido.detalhe))!
    ctx.save()
    // O modelo mede em alturas do objeto, com o chão em zero e o topo em -1:
    // levar a origem para o pé da célula e escalar pela altura dela põe o
    // desenho inteiro dentro do retângulo, sem conta nenhuma no modelo.
    ctx.translate(celula.x + celula.largura / 2, celula.y + celula.altura)
    ctx.scale(celula.altura, celula.altura)
    for (const face of pedido.modelo.faces) {
      ctx.fillStyle = face.fill
      ctx.fill(new Path2D(face.d))
    }
    ctx.restore()
  }

  if (nevoaRGB) banhar(ctx, tela.width, tela.height, nevoaRGB)
  return { tela, celulas }
}

/**
 * Folhas assadas, com teto.
 *
 * Duas bastam para uma corrida e a revanche; mais do que isso é memória
 * parada. O jogo é feito para um workshop, onde a mesma aba fica aberta a
 * tarde inteira sorteando ambiente.
 */
const MAX_FOLHAS = 2
const folhas = new Map<string, Folha>()

function folhaDe(flora: Flora, nevoaRGB: string) {
  const chave = `${flora}|${nevoaRGB}`
  const guardada = folhas.get(chave)
  if (guardada) {
    folhas.delete(chave)
    folhas.set(chave, guardada)
    return guardada
  }
  const folha = assar(flora, nevoaRGB)
  folhas.set(chave, folha)
  while (folhas.size > MAX_FOLHAS) {
    const maisVelha = folhas.keys().next()
    if (maisVelha.done) break
    folhas.get(maisVelha.value)!.tela.width = 0
    folhas.delete(maisVelha.value)
  }
  return folha
}

/** Folha da corrida em curso, escolhida uma vez e usada por todo o laço. */
let atual: Folha | null = null

/**
 * Assa a folha antes da largada.
 *
 * Feito no primeiro quadro da corrida, engasgaria na arrancada; feito durante
 * a contagem, não aparece.
 */
export function prepararCenario(flora: Flora, nevoaRGB: string) {
  atual = folhaDe(flora, nevoaRGB)
}

/** Quanto de memória a folha da corrida ocupa, para medir sem adivinhar. */
export function memoriaDaFolha() {
  if (!atual) return 0
  return atual.tela.width * atual.tela.height * 4
}

/**
 * Um objeto do cenário na pista.
 *
 * `chao` é a linha em que o objeto toca o chão e `altura` é quanto ele mede na
 * tela naquela distância. O arredondamento é só no eixo vertical: no
 * horizontal, o escorrimento lateral é a principal pista de velocidade do
 * jogo, e um passo de um pixel ali se nota mais do que a reamostragem.
 */
export function desenharObjeto(
  ctx: CanvasRenderingContext2D,
  familia: FamiliaModelada,
  variante: number,
  tom: number,
  x: number,
  chao: number,
  altura: number,
) {
  if (!atual || altura < 2) return
  const detalhe: Detalhe = altura >= LIMIAR_SIMPLES ? 'cheio' : 'simples'
  const celula =
    atual.celulas.get(chaveDaCelula(familia, variante % VARIANTES[familia], tom % TONS[familia], detalhe))
  if (!celula) return

  const largura = altura * celula.meiaLargura * 2
  const base = Math.round(chao)
  const topo = Math.round(chao - altura)

  ctx.fillStyle = SOMBRA_NO_CHAO
  ctx.beginPath()
  ctx.ellipse(x + altura * 0.06, base, largura * 0.42, Math.max(0.7, altura * 0.05), 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.drawImage(
    atual.tela,
    celula.x, celula.y, celula.largura, celula.altura,
    x - largura / 2, topo, largura, base - topo,
  )
}

/**
 * Um pórtico sobre a pista.
 *
 * Continua procedural, e de propósito: ele acompanha a largura do asfalto,
 * chega a dois mil pixels de dispositivo e não caberia em célula de folha
 * nenhuma. Em compensação é barato — uma dúzia de preenchimentos.
 *
 * `ahead` negativo significa que a câmera já passou por baixo. Aí ele sobe
 * e se dissolve, porque a projeção não o faz mais crescer e cortá-lo seco
 * seria um arco de tela cheia sumindo de um quadro para o outro.
 */
export function desenharPortico(
  ctx: CanvasRenderingContext2D,
  projetado: { center: number; y: number; roadWidth: number },
  variante: number,
  ahead: number,
  nitidez: number,
  chegada = false,
) {
  const largura = projetado.roadWidth
  const dissolucao = RECUO_DO_PORTICO * SCENERY_SPACING
  const opacidade = ahead >= 0 ? 1 : Math.max(0, 1 + ahead / dissolucao)
  if (opacidade <= 0.01) return
  // Sobe depressa: passar por baixo de um arco é um movimento de fração de
  // segundo, e uma subida lenta leria como o arco flutuando para cima.
  const subida = ahead >= 0 ? 0 : -ahead * largura * 0.045
  const base = projetado.y - subida
  const arco = largura * 0.44
  const perna = Math.max(1, largura * 0.032)
  const viga = Math.max(2, largura * 0.115)
  const meiaViga = largura * 0.63

  ctx.globalAlpha = nitidez * opacidade
  // Pernas, apoiadas fora do asfalto.
  for (const lado of LADOS) {
    const x = projetado.center + lado * largura * 0.58
    ctx.fillStyle = PORTICO[1]
    ctx.fillRect(x - perna / 2, base - arco, perna, arco)
    ctx.fillStyle = PORTICO[3]
    ctx.fillRect(x - perna / 2, base - arco, Math.max(1, perna * 0.36), arco)
    // Sapata: sem ela a perna parece enfiada na grama.
    ctx.fillStyle = PORTICO[0]
    ctx.fillRect(x - perna, base - Math.max(1, perna * 0.9), perna * 2, Math.max(1, perna * 0.9))
  }
  // Viga, com a aresta de cima acesa e a de baixo na sombra.
  ctx.fillStyle = PORTICO[2]
  ctx.fillRect(projetado.center - meiaViga, base - arco - viga, meiaViga * 2, viga)
  ctx.fillStyle = PORTICO[4]
  ctx.fillRect(projetado.center - meiaViga, base - arco - viga, meiaViga * 2, Math.max(1, viga * 0.16))
  ctx.fillStyle = PORTICO[0]
  ctx.fillRect(projetado.center - meiaViga, base - arco - Math.max(1, viga * 0.18), meiaViga * 2, Math.max(1, viga * 0.18))

  // Painel: faixa de patrocínio, ou o quadriculado da chegada.
  const painelTopo = base - arco - viga * 0.78
  const painelAltura = Math.max(1, viga * 0.5)
  if (chegada) {
    const casas = 16
    const passo = (meiaViga * 2) / casas
    for (let i = 0; i < casas; i += 1) {
      ctx.fillStyle = i % 2 === 0 ? '#f3f3ed' : '#11151a'
      ctx.fillRect(projetado.center - meiaViga + i * passo, painelTopo, passo + 1, painelAltura)
    }
  } else {
    const tinta = FAIXAS_DO_PORTICO[variante % FAIXAS_DO_PORTICO.length]
    ctx.fillStyle = tinta[2]
    ctx.fillRect(projetado.center - meiaViga * 0.92, painelTopo, meiaViga * 1.84, painelAltura)
    ctx.fillStyle = tinta[4]
    ctx.fillRect(projetado.center - meiaViga * 0.92, painelTopo, meiaViga * 1.84, Math.max(1, painelAltura * 0.22))
  }
  ctx.globalAlpha = nitidez
}
