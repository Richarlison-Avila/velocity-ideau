import { CAR_ART, type CarId } from './cars'
import { CAR_SPRITE_HALF_WIDTH } from './track'

/** Endereço do sprite, gerado por `npm run carros` a partir de `arte/carros`. */
export function carImageUrl(id: CarId) {
  return `/carros/${id}.png`
}

/**
 * Unidades do desenho por pixel da arte original.
 *
 * Sai da largura de pneu a pneu casada com `CAR_SPRITE_HALF_WIDTH`, a mesma
 * medida de onde vêm o limite de saída de pista e a posição da poeira: a
 * arte ocupa na tela exatamente a largura que a regra cobra.
 */
const UNIDADE = (CAR_SPRITE_HALF_WIDTH * 2) / CAR_ART.tyreSpan

/** Linha onde o carro toca o chão, a mesma da sombra de contato. */
export const LINHA_DO_CHAO = 20

/** Tinta do fantasma: o mesmo azul de sempre, por cima da pintura do rival. */
const TINTA_DO_FANTASMA = 'rgba(67,231,255,.4)'

type Peca = {
  imagem: HTMLCanvasElement
  /** Centro e tamanho da peça, nas unidades do desenho. */
  x: number
  y: number
  largura: number
  altura: number
}

/** Carroceria e rodas dianteiras de um carro, prontas para compor na tela. */
export type CarPaint = { corpo: Peca; rodaEsquerda: Peca; rodaDireita: Peca }

/** Nulas até a imagem chegar; até lá a tela desenha o carro vetorial. */
export type CarSprite = {
  jogador: CarPaint | null
  /** A mesma pintura tingida de azul, para o rival. */
  fantasma: CarPaint | null
}

/** Centro da luz traseira, nas unidades do desenho. É igual em todos: vem do molde. */
export const REAR_LIGHT_Y = (CAR_ART.rearLight.y - CAR_ART.groundY) * UNIDADE + LINHA_DO_CHAO

const cache = new Map<CarId, CarSprite>()

function tela(largura: number, altura: number) {
  const canvas = document.createElement('canvas')
  canvas.width = largura
  canvas.height = altura
  return canvas
}

/** Converte um retângulo em pixels do sprite para centro e tamanho em unidades do desenho. */
function emUnidades(escala: number, x: number, y: number, largura: number, altura: number) {
  const emArteX = x / escala + CAR_ART.crop.x
  const emArteY = y / escala + CAR_ART.crop.y
  return {
    x: (emArteX + largura / escala / 2 - CAR_ART.centerX) * UNIDADE,
    y: (emArteY + altura / escala / 2 - CAR_ART.groundY) * UNIDADE + LINHA_DO_CHAO,
    largura: (largura / escala) * UNIDADE,
    altura: (altura / escala) * UNIDADE,
  }
}

function tingir(origem: HTMLCanvasElement) {
  const destino = tela(origem.width, origem.height)
  const ctx = destino.getContext('2d')!
  ctx.drawImage(origem, 0, 0)
  // Só onde já há carro: o recorte transparente continua transparente.
  ctx.globalCompositeOperation = 'source-atop'
  ctx.fillStyle = TINTA_DO_FANTASMA
  ctx.fillRect(0, 0, destino.width, destino.height)
  return destino
}

/**
 * Separa o sprite em carroceria e rodas dianteiras.
 *
 * As rodas saem da carroceria para girar no próprio eixo com o volante, como
 * no carro vetorial. O recorte é feito uma vez, quando a imagem chega; o
 * laço de quadro só compõe as três peças.
 */
function montar(imagem: HTMLImageElement): CarPaint {
  const escala = imagem.naturalWidth / CAR_ART.crop.width
  const { frontWheel } = CAR_ART
  // Bordas inteiras, para o vão deixado na carroceria e a roda recortada
  // coincidirem pixel a pixel, sem fresta nem sobra.
  const topo = Math.floor((frontWheel.y - CAR_ART.crop.y) * escala)
  const base = Math.ceil((frontWheel.y + frontWheel.height - CAR_ART.crop.y) * escala)
  const esquerdaIni = Math.floor((frontWheel.x - CAR_ART.crop.x) * escala)
  const esquerdaFim = Math.ceil((frontWheel.x + frontWheel.width - CAR_ART.crop.x) * escala)
  const espelho = 2 * CAR_ART.centerX - frontWheel.x - frontWheel.width
  const direitaIni = Math.floor((espelho - CAR_ART.crop.x) * escala)
  const direitaFim = Math.ceil((espelho + frontWheel.width - CAR_ART.crop.x) * escala)

  const corpo = tela(imagem.naturalWidth, imagem.naturalHeight)
  const ctxCorpo = corpo.getContext('2d')!
  ctxCorpo.drawImage(imagem, 0, 0)
  ctxCorpo.clearRect(esquerdaIni, topo, esquerdaFim - esquerdaIni, base - topo)
  ctxCorpo.clearRect(direitaIni, topo, direitaFim - direitaIni, base - topo)

  const roda = (inicio: number, fim: number): Peca => {
    const imagemDaRoda = tela(fim - inicio, base - topo)
    imagemDaRoda.getContext('2d')!.drawImage(imagem, inicio, topo, fim - inicio, base - topo, 0, 0, fim - inicio, base - topo)
    return { imagem: imagemDaRoda, ...emUnidades(escala, inicio, topo, fim - inicio, base - topo) }
  }

  return {
    corpo: { imagem: corpo, ...emUnidades(escala, 0, 0, imagem.naturalWidth, imagem.naturalHeight) },
    rodaEsquerda: roda(esquerdaIni, esquerdaFim),
    rodaDireita: roda(direitaIni, direitaFim),
  }
}

function fantasmaDe(pintura: CarPaint): CarPaint {
  return {
    corpo: { ...pintura.corpo, imagem: tingir(pintura.corpo.imagem) },
    rodaEsquerda: { ...pintura.rodaEsquerda, imagem: tingir(pintura.rodaEsquerda.imagem) },
    rodaDireita: { ...pintura.rodaDireita, imagem: tingir(pintura.rodaDireita.imagem) },
  }
}

/**
 * Sprite do carro, carregado na primeira vez que é pedido.
 *
 * Devolve na hora um objeto que fica pronto quando a imagem chega. Pedir
 * durante a contagem da largada basta: são cinco segundos para uma imagem
 * que o menu quase sempre já deixou no cache do navegador.
 */
export function carSprite(id: CarId): CarSprite {
  const existente = cache.get(id)
  if (existente) return existente

  const sprite: CarSprite = { jogador: null, fantasma: null }
  cache.set(id, sprite)

  const imagem = new Image()
  imagem.decoding = 'async'
  imagem.onload = () => {
    const pintura = montar(imagem)
    sprite.fantasma = fantasmaDe(pintura)
    sprite.jogador = pintura
  }
  // Sem a imagem o carro vetorial continua valendo; na próxima corrida tenta de novo.
  imagem.onerror = () => cache.delete(id)
  imagem.src = carImageUrl(id)
  return sprite
}

/** A roda gira em torno do próprio centro; a carroceria vai com ângulo zero. */
function desenharPeca(ctx: CanvasRenderingContext2D, peca: Peca, angulo: number) {
  if (angulo === 0) {
    ctx.drawImage(peca.imagem, peca.x - peca.largura / 2, peca.y - peca.altura / 2, peca.largura, peca.altura)
    return
  }
  ctx.save()
  ctx.translate(peca.x, peca.y)
  ctx.rotate(angulo)
  ctx.drawImage(peca.imagem, -peca.largura / 2, -peca.altura / 2, peca.largura, peca.altura)
  ctx.restore()
}

/**
 * Desenha a pintura no contexto já posicionado e escalado nas unidades do
 * carro. A carroceria vem primeiro e as rodas dianteiras por cima, giradas
 * pelo esterço.
 */
export function drawCarPaint(ctx: CanvasRenderingContext2D, pintura: CarPaint, esterco: number) {
  desenharPeca(ctx, pintura.corpo, 0)
  desenharPeca(ctx, pintura.rodaEsquerda, esterco)
  desenharPeca(ctx, pintura.rodaDireita, esterco)
}
