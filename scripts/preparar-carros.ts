/**
 * Transforma as artes dos carros em sprites do jogo.
 *
 * As artes originais ficam em `arte/carros`, uma por carro, com o nome do
 * identificador da garagem (`senna.png`, `verstappen.png`…). Elas chegam com
 * fundo preto opaco e mais de 1 MB cada: na pista, o preto viraria um
 * retângulo sobre o asfalto, e o peso atrasaria a largada no celular. Cada uma
 * sai daqui em `public/carros` com o fundo transparente, recortada no molde
 * comum e reduzida ao tamanho que a tela de fato usa.
 *
 * Para acrescentar um carro: desenhe sobre o mesmo chassi, salve em
 * `arte/carros/<id>.png`, registre o id em `src/game/cars.ts` e rode
 *
 *   npm run carros
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PNG } from 'pngjs'
import { CAR_ART, CARS } from '../src/game/cars.js'

const ORIGEM = resolve('arte/carros')
const DESTINO = resolve('public/carros')

/**
 * Largura do sprite, em pixels.
 *
 * Na pista o carro chega a uns 390 pixels físicos (tela cheia com densidade
 * 2); na seleção ele aparece maior. Com 520 os dois ficam nítidos, e cada
 * arquivo cai para uma fração do original.
 */
const LARGURA = 520

/**
 * Brilho máximo que ainda conta como fundo.
 *
 * O fundo das artes é preto quase puro (no máximo 3). Com folga até 12, o
 * contorno serrilhado sai junto, mas a carroceria preta da Mercedes, que tem
 * reflexos acima disso, fica inteira.
 */
const LIMIAR_DO_FUNDO = 12

/** Quanto a arte pode escapar do molde antes de ser recusada, em pixels. */
const TOLERANCIA = 8

type Imagem = { largura: number; altura: number; dados: Buffer }

/**
 * Apaga o fundo a partir das bordas.
 *
 * Só some o preto que se liga à borda da imagem. Um limiar aplicado à imagem
 * inteira levaria também o que é preto dentro do carro — o cockpit, as letras
 * da asa, a caixa da luz traseira. Os vãos entre os braços da suspensão
 * saem, porque se abrem para fora.
 */
function apagarFundo({ largura, altura, dados }: Imagem) {
  const fundo = new Uint8Array(largura * altura)
  const escuro = (p: number) => Math.max(dados[p * 4], dados[p * 4 + 1], dados[p * 4 + 2]) <= LIMIAR_DO_FUNDO
  const pilha: number[] = []
  for (let x = 0; x < largura; x += 1) pilha.push(x, (altura - 1) * largura + x)
  for (let y = 0; y < altura; y += 1) pilha.push(y * largura, y * largura + largura - 1)

  while (pilha.length > 0) {
    const p = pilha.pop()!
    if (fundo[p] || !escuro(p)) continue
    fundo[p] = 1
    const x = p % largura
    if (x > 0) pilha.push(p - 1)
    if (x < largura - 1) pilha.push(p + 1)
    if (p >= largura) pilha.push(p - largura)
    if (p < largura * (altura - 1)) pilha.push(p + largura)
  }
  return fundo
}

/** Retângulo ocupado pelo carro depois de apagado o fundo. */
function contorno(largura: number, altura: number, fundo: Uint8Array) {
  let x0 = largura
  let y0 = altura
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < altura; y += 1) {
    for (let x = 0; x < largura; x += 1) {
      if (fundo[y * largura + x]) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return { x0, y0, x1, y1 }
}

/**
 * Confere que a arte foi desenhada no molde.
 *
 * O jogo recorta as rodas dianteiras e acende a luz traseira em coordenadas
 * fixas; uma arte deslocada teria rodas girando no lugar errado e uma largura
 * diferente da que a regra de saída de pista cobra.
 */
function conferirMolde(id: string, caixa: ReturnType<typeof contorno>) {
  const esperadoEsquerda = CAR_ART.centerX - CAR_ART.tyreSpan / 2
  const esperadoDireita = CAR_ART.centerX + CAR_ART.tyreSpan / 2
  const desvios = [
    ['borda esquerda dos pneus', caixa.x0, esperadoEsquerda],
    ['borda direita dos pneus', caixa.x1, esperadoDireita],
    ['base dos pneus', caixa.y1, CAR_ART.groundY],
  ] as const
  for (const [parte, medido, esperado] of desvios) {
    if (Math.abs(medido - esperado) > TOLERANCIA) {
      throw new Error(`${id}: ${parte} em ${medido}, o molde espera ${esperado}. A arte precisa usar o mesmo chassi.`)
    }
  }
  const { crop } = CAR_ART
  if (caixa.x0 < crop.x || caixa.y0 < crop.y || caixa.x1 >= crop.x + crop.width || caixa.y1 >= crop.y + crop.height) {
    throw new Error(`${id}: parte do carro fica fora do recorte do molde.`)
  }
}

/** Para cada pixel de destino, quais pixels de origem ele cobre e com que peso. */
function pesos(origem: number, destino: number) {
  const razao = origem / destino
  const lista: Array<Array<[number, number]>> = []
  for (let d = 0; d < destino; d += 1) {
    const inicio = d * razao
    const fim = (d + 1) * razao
    const itens: Array<[number, number]> = []
    for (let o = Math.floor(inicio); o < Math.ceil(fim); o += 1) {
      const cobre = Math.min(fim, o + 1) - Math.max(inicio, o)
      if (cobre > 0) itens.push([o, cobre / razao])
    }
    lista.push(itens)
  }
  return lista
}

/**
 * Recorta e reduz por média de área.
 *
 * A média é feita com a cor multiplicada pela opacidade: sem isso o preto do
 * fundo apagado vazaria para a borda do carro como um halo escuro.
 */
function recortarEReduzir(imagem: Imagem, fundo: Uint8Array, largura: number) {
  const { crop } = CAR_ART
  const altura = Math.round((crop.height * largura) / crop.width)

  const origem = new Float32Array(crop.width * crop.height * 4)
  for (let y = 0; y < crop.height; y += 1) {
    for (let x = 0; x < crop.width; x += 1) {
      const p = (crop.y + y) * imagem.largura + crop.x + x
      const alfa = fundo[p] ? 0 : 1
      const i = (y * crop.width + x) * 4
      origem[i] = imagem.dados[p * 4] * alfa
      origem[i + 1] = imagem.dados[p * 4 + 1] * alfa
      origem[i + 2] = imagem.dados[p * 4 + 2] * alfa
      origem[i + 3] = alfa
    }
  }

  // Em duas passadas, primeiro na horizontal e depois na vertical.
  const colunas = pesos(crop.width, largura)
  const meio = new Float32Array(largura * crop.height * 4)
  for (let y = 0; y < crop.height; y += 1) {
    for (let x = 0; x < largura; x += 1) {
      const o = (y * largura + x) * 4
      for (const [ox, peso] of colunas[x]) {
        const i = (y * crop.width + ox) * 4
        for (let c = 0; c < 4; c += 1) meio[o + c] += origem[i + c] * peso
      }
    }
  }

  const linhas = pesos(crop.height, altura)
  const saida = new PNG({ width: largura, height: altura })
  for (let y = 0; y < altura; y += 1) {
    for (let x = 0; x < largura; x += 1) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (const [oy, peso] of linhas[y]) {
        const i = (oy * largura + x) * 4
        r += meio[i] * peso
        g += meio[i + 1] * peso
        b += meio[i + 2] * peso
        a += meio[i + 3] * peso
      }
      const o = (y * largura + x) * 4
      // De volta da cor multiplicada para a cor pura.
      saida.data[o] = a > 0 ? Math.round(r / a) : 0
      saida.data[o + 1] = a > 0 ? Math.round(g / a) : 0
      saida.data[o + 2] = a > 0 ? Math.round(b / a) : 0
      saida.data[o + 3] = Math.round(a * 255)
    }
  }
  return saida
}

async function main() {
  await mkdir(DESTINO, { recursive: true })

  const faltando = CARS.filter((car) => !existsSync(resolve(ORIGEM, `${car.id}.png`)))
  if (faltando.length > 0) {
    throw new Error(`Falta a arte de: ${faltando.map((car) => `arte/carros/${car.id}.png`).join(', ')}`)
  }

  for (const car of CARS) {
    const bruto = await readFile(resolve(ORIGEM, `${car.id}.png`))
    const png = PNG.sync.read(bruto)
    const imagem: Imagem = { largura: png.width, altura: png.height, dados: png.data }

    const fundo = apagarFundo(imagem)
    conferirMolde(car.id, contorno(imagem.largura, imagem.altura, fundo))

    const sprite = recortarEReduzir(imagem, fundo, LARGURA)
    const arquivo = PNG.sync.write(sprite, { colorType: 6, deflateLevel: 9 })
    await writeFile(resolve(DESTINO, `${car.id}.png`), arquivo)

    const kb = (bytes: number) => `${Math.round(bytes / 1024)} KB`
    console.log(`${car.id.padEnd(18)} ${sprite.width}×${sprite.height}  ${kb(bruto.length)} → ${kb(arquivo.length)}`)
  }
}

main().catch((erro: unknown) => {
  console.error(erro instanceof Error ? erro.message : erro)
  process.exit(1)
})
