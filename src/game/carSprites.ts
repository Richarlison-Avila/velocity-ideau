/**
 * Folha de sprites do carro.
 *
 * O molde de `carModel.ts` tem algumas centenas de faces. Percorrê-las a cada
 * quadro, para dois carros, custaria caro num celular — e não haveria nenhum
 * ganho, porque entre um quadro e o outro quase nada muda no desenho. Então o
 * carro é assado uma vez numa folha de sprites, do jeito que um jogo de pista
 * sempre fez: uma tira de quadros de esterço, do volante todo à esquerda ao
 * volante todo à direita. O laço de corrida escolhe o quadro e faz um
 * `drawImage`.
 *
 * O que sobra para a hora do desenho é o que varia continuamente e não caberia
 * em quadro nenhum: a posição, a escala com a distância, a inclinação da
 * carroceria, a trepidação fora do asfalto e o brilho do boost.
 *
 * A garagem não usa a folha: usa o SVG do mesmo molde, que amplia sem perder
 * nada e não gasta memória de textura enquanto o jogador escolhe o carro.
 */
import { carById, type CarId } from './cars'
import {
  CAIXA_CARRO,
  COR_DA_TERRA,
  LINHA_DO_CHAO,
  MANCHAS_DE_TERRA,
  PARTS,
  SOMBRA_DE_CONTATO,
  WHEEL_CENTERS,
  carModel,
  type CarModel,
  type Part,
} from './carModel'

const RODA_ESQUERDA = 'dianteiraEsquerda'
const RODA_DIREITA = 'dianteiraDireita'

function ehRoda(part: Part): part is keyof typeof WHEEL_CENTERS {
  return part in WHEEL_CENTERS
}

const escapar = (texto: string) => texto.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')

/** Tipografia dos decalques, a mesma da interface do jogo. */
const FONTE = "'Barlow Condensed', 'Arial Narrow', Arial, sans-serif"

const svgs = new Map<CarId, string>()

/**
 * Endereço do carro para a garagem, o lobby e o resultado.
 *
 * É o mesmo molde da corrida, servido como SVG: uma imagem de verdade, que o
 * navegador escala como quiser, sem nenhum arquivo para baixar.
 */
export function carImageUrl(id: CarId) {
  const guardado = svgs.get(id)
  if (guardado) return guardado

  const modelo = carModel(id)
  const corpo = PARTS.map((part) => {
    const centro = ehRoda(part) ? ` transform="translate(${WHEEL_CENTERS[part].map((n) => n.toFixed(2)).join(' ')})"` : ''
    const faces = modelo.faces
      .filter((face) => face.part === part)
      .map((face) => `<path fill="${face.fill}" d="${face.d}"${face.opacity === undefined ? '' : ` opacity="${face.opacity}"`}/>`)
      .join('')
    const textos = modelo.labels
      .filter((label) => label.part === part)
      .map((label) =>
        `<text x="${label.x.toFixed(2)}" y="${label.y.toFixed(2)}" text-anchor="middle" font-family="${FONTE.replaceAll("'", '')}"` +
        ` font-weight="700" font-size="${label.size.toFixed(2)}" fill="${label.fill}"` +
        ` transform="rotate(${label.rotate ?? 0} ${label.x.toFixed(2)} ${label.y.toFixed(2)})">${escapar(label.text)}</text>`)
      .join('')
    return `<g${centro}>${faces}${textos}</g>`
  }).join('')

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CAIXA_CARRO.largura * 10}" height="${CAIXA_CARRO.altura * 10}"` +
    ` viewBox="${CAIXA_CARRO.x} ${CAIXA_CARRO.y} ${CAIXA_CARRO.largura} ${CAIXA_CARRO.altura}">` +
    `<title>${escapar(carById(id).driver)}</title>${corpo}</svg>`
  const url = `data:image/svg+xml,${encodeURIComponent(svg)}`
  svgs.set(id, url)
  return url
}

/**
 * Deformações de apresentação do carro.
 *
 * Tudo aqui sai de `feel.ts`, que por sua vez só lê a simulação. Nada disso
 * volta para a corrida: não desloca a hitbox, não muda a posição competitiva e
 * não atrasa o comando.
 */
export type CarPose = {
  /** Inclinação da carroceria, em radianos. */
  tilt: number
  /** Curso da suspensão: negativo estica, positivo afunda. */
  suspension: number
  /** Esterço visual das rodas dianteiras, de -1 a 1. */
  steer: number
  /** Brilho da luz de chuva e do escapamento durante o boost, de 0 a 1. */
  boost: number
  /** Trepidação fora do asfalto, em unidades do desenho. */
  jitter: number
  /** Terra na carroceria depois da grama, de 0 a 1. */
  dirt: number
  /** Distância percorrida: é dela que sai a fase do rolamento dos pneus. */
  travel: number
}

/**
 * Quantos quadros de esterço a folha guarda.
 *
 * Nove é o menor número em que a passagem de um quadro ao seguinte não se nota
 * a olho na velocidade em que o volante se move. Com cinco, a roda pula; com
 * quinze, a folha dobra de tamanho sem que ninguém veja diferença.
 */
const QUADROS = 9

/**
 * Pixels por unidade do desenho na folha.
 *
 * O carro do jogador chega a ocupar umas três vezes a escala base numa tela
 * larga. Quatro deixa margem para isso sem a folha virar uma textura enorme.
 */
const RESOLUCAO = 4

/**
 * Quanto a sombra responde ao curso da suspensão.
 *
 * O curso é pequeno — centésimos —, e a sombra precisa de um movimento que se
 * veja. Seis é o fator em que afundar na arrancada fecha a mancha o bastante
 * para se notar sem que o topo de uma lomba a faça sumir.
 */
const SOMBRA_POR_CURSO = 6

/**
 * Quanto a sombra escorrega para o lado quando a carroceria rola.
 *
 * A carroceria gira em torno da linha do chão, então o ponto de apoio não sai
 * do lugar — o que escorrega é o vulto projetado pelo sol, que vem de cima e
 * da esquerda. Daí o valor ser pequeno: é um vulto se deslocando, não o carro.
 */
const SOMBRA_POR_INCLINACAO = 16

/** Inclinação da carroceria no esterço máximo, em radianos. */
const INCLINACAO = 0.055
/** Quanto a roda dianteira deita no esterço máximo. */
const ESTERCO_DA_RODA = 0.3
/** Quanto o piloto se joga para dentro da curva, em unidades do desenho. */
const PILOTO_NA_CURVA = 1.4

const LARGURA_QUADRO = Math.ceil(CAIXA_CARRO.largura * RESOLUCAO)
const ALTURA_QUADRO = Math.ceil(CAIXA_CARRO.altura * RESOLUCAO)

type Desenho = {
  faces: { caminho: Path2D; fill: string; opacity: number }[]
  labels: CarModel['labels']
}

type Folha = { tela: HTMLCanvasElement }

const desenhos = new Map<CarId, Map<Part, Desenho>>()

/**
 * Folhas assadas, com teto.
 *
 * Cada folha são uns três megabytes de textura, e a chave junta carro,
 * ambiente e fantasma: cinco carros em quatro ambientes dariam quarenta
 * folhas, mais de cem megabytes. Numa corrida solta isso nunca aparece — mas
 * o jogo é feito para um workshop, onde a mesma aba fica aberta a tarde
 * inteira trocando de carro e sorteando ambiente. Quatro é o que uma corrida
 * usa: a folha do jogador e a do rival, e mais um par de folga para a
 * revanche não reassar tudo.
 */
const MAX_FOLHAS = 4
const folhas = new Map<string, Folha>()

/** As faces viram `Path2D` uma vez só: a folha as percorre nove vezes. */
function desenhoDe(id: CarId) {
  const guardado = desenhos.get(id)
  if (guardado) return guardado

  const modelo = carModel(id)
  const porParte = new Map<Part, Desenho>()
  for (const part of PARTS) porParte.set(part, { faces: [], labels: [] })
  for (const face of modelo.faces) {
    porParte.get(face.part)!.faces.push({ caminho: new Path2D(face.d), fill: face.fill, opacity: face.opacity ?? 1 })
  }
  for (const label of modelo.labels) porParte.get(label.part)!.labels.push(label)
  desenhos.set(id, porParte)
  return porParte
}

function desenharParte(ctx: CanvasRenderingContext2D, desenho: Desenho) {
  for (const face of desenho.faces) {
    ctx.globalAlpha = face.opacity
    ctx.fillStyle = face.fill
    ctx.fill(face.caminho)
  }
  ctx.globalAlpha = 1
  for (const label of desenho.labels) {
    ctx.save()
    ctx.translate(label.x, label.y)
    if (label.rotate) ctx.rotate((label.rotate * Math.PI) / 180)
    ctx.font = `700 ${label.size}px ${FONTE}`
    ctx.fillStyle = label.fill
    ctx.fillText(label.text, 0, 0)
    ctx.restore()
  }
}

/**
 * Um quadro da folha, com o volante numa posição.
 *
 * São três pistas de leitura, e nenhuma delas mexe na posição do carro na
 * pista: a roda dianteira deita para o lado do comando, a carroceria rola
 * sobre a suspensão e o piloto se joga para dentro da curva. Juntas, dão a
 * impressão de um carro que está virando mesmo parado no meio da tela.
 */
function desenharQuadro(ctx: CanvasRenderingContext2D, desenho: Map<Part, Desenho>, esterco: number) {
  ctx.save()
  ctx.translate(0, LINHA_DO_CHAO)
  ctx.rotate(esterco * INCLINACAO)
  ctx.translate(0, -LINHA_DO_CHAO)
  for (const part of PARTS) {
    // A sombra fica de fora da folha: ela é desenhada ao vivo em `drawCar`,
    // no chão, enquanto o resto do carro rola e treme por cima. O retrato da
    // garagem continua assando a dele, e ali isso é o certo — o carro está
    // parado e nada tem por que se descolar dele.
    if (part === 'sombra') continue
    ctx.save()
    if (ehRoda(part)) {
      const [x, y] = WHEEL_CENTERS[part]
      ctx.translate(x, y)
      if (part === RODA_ESQUERDA || part === RODA_DIREITA) {
        ctx.transform(1, 0, esterco * ESTERCO_DA_RODA, 1, 0, 0)
      }
    } else if (part === 'piloto') {
      ctx.translate(-esterco * PILOTO_NA_CURVA, 0)
    }
    desenharParte(ctx, desenho.get(part)!)
    ctx.restore()
  }
  ctx.restore()
}

/** Esterço do quadro `indice`, de -1 (todo à esquerda) a 1 (todo à direita). */
function estercoDoQuadro(indice: number) {
  return (indice / (QUADROS - 1)) * 2 - 1
}

/**
 * Cobre a folha inteira com uma cor, só onde já há carro.
 *
 * É como entra a luz de ambiente da corrida — o mesmo tom da névoa do
 * horizonte, muito fraco, para o carro não parecer recortado de outra cena — e
 * como o rival ganha o azul que o distingue do carro do próprio jogador.
 */
function banhar(ctx: CanvasRenderingContext2D, cor: string, opacidade: number) {
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'source-atop'
  ctx.globalAlpha = opacidade
  ctx.fillStyle = cor
  ctx.fillRect(0, 0, LARGURA_QUADRO * QUADROS, ALTURA_QUADRO)
  ctx.restore()
}

function assar(id: CarId, ambiente: string, fantasma: boolean): Folha {
  const desenho = desenhoDe(id)
  const tela = document.createElement('canvas')
  tela.width = LARGURA_QUADRO * QUADROS
  tela.height = ALTURA_QUADRO
  const ctx = tela.getContext('2d')!
  ctx.textAlign = 'center'

  for (let indice = 0; indice < QUADROS; indice += 1) {
    ctx.save()
    // Cada quadro é recortado no próprio retângulo: sem isso a asa de um
    // quadro vazaria para dentro do vizinho quando a inclinação a joga para
    // fora da caixa.
    ctx.beginPath()
    ctx.rect(indice * LARGURA_QUADRO, 0, LARGURA_QUADRO, ALTURA_QUADRO)
    ctx.clip()
    ctx.translate(indice * LARGURA_QUADRO, 0)
    ctx.scale(RESOLUCAO, RESOLUCAO)
    ctx.translate(-CAIXA_CARRO.x, -CAIXA_CARRO.y)
    desenharQuadro(ctx, desenho, estercoDoQuadro(indice))
    ctx.restore()
  }

  if (ambiente) banhar(ctx, `rgb(${ambiente})`, 0.1)
  if (fantasma) banhar(ctx, '#68cfda', 0.3)
  return { tela }
}

function folhaDe(id: CarId, ambiente: string, fantasma: boolean) {
  const chave = `${id}|${ambiente}|${fantasma ? 'f' : 'j'}`
  const guardada = folhas.get(chave)
  if (guardada) {
    // Reinserir põe a chave no fim da ordem de iteração do `Map`, que é a
    // ordem de inserção: é o que transforma o teto em "descarta a menos usada"
    // em vez de "descarta a mais antiga".
    folhas.delete(chave)
    folhas.set(chave, guardada)
    return guardada
  }
  const folha = assar(id, ambiente, fantasma)
  folhas.set(chave, folha)
  while (folhas.size > MAX_FOLHAS) {
    const maisVelha = folhas.keys().next()
    if (maisVelha.done) break
    const despejada = folhas.get(maisVelha.value)
    // Zerar o tamanho devolve a textura na hora, em vez de esperar o coletor.
    if (despejada) despejada.tela.width = 0
    folhas.delete(maisVelha.value)
  }
  return folha
}

/**
 * Assa a folha antes da largada.
 *
 * Assar custa alguns milissegundos e uns três megabytes de textura por carro.
 * Feito no primeiro quadro da corrida, engasgaria justamente na arrancada;
 * feito durante a contagem, não aparece. `fantasma` diz qual das duas folhas
 * aquele carro precisa: no modo treino não existe rival, e assar a azulada
 * seria dobrar a memória por nada.
 */
export function prepareCar(id: CarId, ambiente: string, fantasma = false) {
  folhaDe(id, ambiente, fantasma)
}

/**
 * Marcas de rolamento sobre os pneus traseiros.
 *
 * Não cabem na folha: a fase vem dos metros percorridos, e assar um quadro
 * para cada posição da banda custaria mais do que desenhar duas barras. Ligar
 * a fase à distância, e não ao número do quadro, é o que faz o pneu parar
 * quando o carro para e não acelerar quando a taxa de quadros muda.
 */
function desenharRolamento(ctx: CanvasRenderingContext2D, travel: number) {
  ctx.fillStyle = 'rgba(190,206,198,.12)'
  const fase = ((travel * 0.9) % 4 + 4) % 4
  for (const roda of ['traseiraEsquerda', 'traseiraDireita'] as const) {
    const [x, y] = WHEEL_CENTERS[roda]
    for (let passo = -9 + fase; passo < 9; passo += 4) {
      ctx.fillRect(x - 5.2, y + passo, 10.4, 0.5)
    }
  }
}

/**
 * O carro na pista.
 *
 * `scale` é a escala da projeção naquela distância, e é ela que faz o rival
 * encolher quando abre vantagem. `ghostAlpha` abaixo de 1 escolhe a folha
 * azulada do rival — é por isso que os dois nunca se confundem, mesmo quando
 * os dois pilotos escolhem o mesmo carro.
 */
export function drawCar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  id: CarId,
  pose: CarPose,
  ghostAlpha = 1,
  ambiente = '',
) {
  const folha = folhaDe(id, ambiente, ghostAlpha < 1)
  const esterco = Math.max(-1, Math.min(1, pose.steer))
  const quadro = Math.round(((esterco + 1) / 2) * (QUADROS - 1))
  // Cada quadro da folha já traz o carro rolado pelo esterço dele, assado. O
  // que se desenha por cima dele depois — terra, sombra dos pneus — precisa
  // do mesmo giro para continuar no mesmo lugar do desenho.
  const giroDoQuadro = ((quadro / (QUADROS - 1)) * 2 - 1) * INCLINACAO

  ctx.save()
  ctx.globalAlpha *= ghostAlpha
  ctx.translate(x, y)
  ctx.scale(scale, scale)

  /**
   * A sombra, antes de tudo, e no chão.
   *
   * É a diferença entre uma peça apoiada no asfalto e um adesivo colado nele.
   * O carro afunda, estica e treme por cima dela; a sombra não. O que muda de
   * verdade a mancha no chão é a altura: afundando, ela fecha e escurece;
   * esticando — no topo de uma lomba, ou no quadro em que o carro bate —,
   * abre e clareia, e é ela que anuncia que o carro está leve antes de
   * qualquer outra coisa na tela.
   */
  const leveza = Math.max(-1, Math.min(1, -pose.suspension * SOMBRA_POR_CURSO))
  const abertura = 1 + leveza * 0.45
  const forca = Math.min(1, 1 - leveza * 0.45)
  const opacidadeBase = ctx.globalAlpha
  // A carroceria rola; o apoio dela escorrega de leve para o lado oposto. As
  // rodas rolam junto com o quadro, e a sombra de cada uma vai atrás do pneu:
  // o centro dela gira com ele, mas a elipse continua deitada no chão.
  const giro = pose.tilt + giroDoQuadro
  const cosseno = Math.cos(giro)
  const seno = Math.sin(giro)
  for (const m of SOMBRA_DE_CONTATO) {
    let cx = m.x - pose.tilt * SOMBRA_POR_INCLINACAO
    let cy = m.y
    if (m.roda) {
      const acima = m.y - LINHA_DO_CHAO
      cx = m.x * cosseno - acima * seno
      cy = m.x * seno + acima * cosseno + LINHA_DO_CHAO
    }
    ctx.globalAlpha = opacidadeBase * m.alpha * forca
    ctx.fillStyle = m.cor
    ctx.beginPath()
    ctx.ellipse(cx, cy, m.rx * abertura, m.ry * abertura, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = opacidadeBase

  ctx.translate(pose.jitter, pose.suspension * 8)
  if (pose.tilt !== 0) {
    ctx.translate(0, LINHA_DO_CHAO)
    ctx.rotate(pose.tilt)
    ctx.translate(0, -LINHA_DO_CHAO)
  }
  ctx.drawImage(
    folha.tela,
    quadro * LARGURA_QUADRO, 0, LARGURA_QUADRO, ALTURA_QUADRO,
    CAIXA_CARRO.x, CAIXA_CARRO.y, CAIXA_CARRO.largura, CAIXA_CARRO.altura,
  )
  desenharRolamento(ctx, pose.travel)

  /**
   * Terra da grama, por cima da pintura.
   *
   * Um punhado de manchas em vez de um banho na carroceria inteira, e por dois
   * motivos. O barato é que tingir a folha exigiria uma tela de apoio e uma
   * volta a mais por quadro, justamente no objeto maior da tela. O bom é que
   * fica melhor: barro atirado por pneu é respingo, e respingo tem borda — um
   * véu uniforme leria como o carro ter mudado de cor.
   */
  if (pose.dirt > 0.02) {
    ctx.save()
    // O giro do quadro, de novo: sem ele, no esterço máximo a terra do pontão
    // escorrega três unidades para o lado e sai da carroceria justamente no
    // meio da curva.
    ctx.translate(0, LINHA_DO_CHAO)
    ctx.rotate(giroDoQuadro)
    ctx.translate(0, -LINHA_DO_CHAO)
    ctx.globalAlpha = opacidadeBase * Math.min(1, pose.dirt) * 0.72
    ctx.fillStyle = COR_DA_TERRA
    for (const m of MANCHAS_DE_TERRA) {
      ctx.beginPath()
      ctx.ellipse(m.x, m.y, m.rx, m.ry, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  // No boost a luz de chuva acende e o escapamento transborda. Vai por cima da
  // folha e em modo aditivo: soma luz à pintura em vez de cobri-la.
  if (pose.boost > 0.01) {
    const modelo = carModel(id)
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = '#ff3a2a'
    ctx.globalAlpha *= pose.boost
    ctx.beginPath()
    ctx.ellipse(modelo.luzDeChuva.x, modelo.luzDeChuva.y, modelo.luzDeChuva.raio * 1.6, modelo.luzDeChuva.raio * 1.6, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ffc56a'
    ctx.beginPath()
    ctx.ellipse(modelo.escapamento.x, modelo.escapamento.y, modelo.escapamento.raio * (1.4 + pose.boost), modelo.escapamento.raio * (1 + pose.boost), 0, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}
