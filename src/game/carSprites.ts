/**
 * Folha de sprites do carro.
 *
 * O molde de `carModel.ts` tem algumas centenas de faces. Percorrê-las a cada
 * quadro, para dois carros, custaria caro num celular — e não haveria nenhum
 * ganho, porque entre um quadro e o outro quase nada muda no desenho. Então o
 * carro é assado uma vez numa folha de sprites, do jeito que um jogo de pista
 * sempre fez: uma tira de quadros de curva, da derrapagem toda à esquerda à
 * derrapagem toda à direita, passando pelo carro reto no meio. O laço de
 * corrida escolhe o quadro e faz um `drawImage`.
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
  yawTransform,
  type CarModel,
  type Part,
} from './carModel'

const RODAS_TRASEIRAS = ['traseiraEsquerda', 'traseiraDireita'] as const
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
  /**
   * Derrapagem, de -1 a 1, com o sinal do lado para onde o carro gira.
   *
   * Soma ao esterço no eixo de poses da folha: com o volante todo virado e a
   * derrapagem cheia, o carro está atravessado, com as rodas contraesterçando.
   */
  drift: number
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
 * As poses da folha, num eixo só: de -2 a 2.
 *
 * De -1 a 1 é a curva comum, e são os nove quadros de sempre: nove é o menor
 * número em que a passagem de um ao seguinte não se nota na velocidade em que
 * o volante anda. Além de 1 é a derrapagem, em três quadros de cada lado: o
 * carro gira mais do que a curva pede, a traseira escapa e as rodas da frente
 * voltam para o outro lado. Três bastam porque a derrapagem entra e sai em
 * dois décimos de segundo, e ninguém conta quadros nesse tempo.
 */
const POSES = [-2, -5 / 3, -4 / 3, -1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1, 4 / 3, 5 / 3, 2]
const QUADROS = POSES.length
/** Índice do quadro reto, no meio da tira. */
const QUADRO_RETO = POSES.indexOf(0)

/** Guinada do carro no esterço máximo da curva comum: sete graus. */
const GUINADA_NA_CURVA = 0.122

/** Guinada a mais na derrapagem cheia: o carro chega a treze graus atravessado. */
const GUINADA_NA_DERRAPAGEM = 0.105

/**
 * Quanto as rodas da frente contraesterçam na derrapagem cheia, em frações do
 * esterço máximo. É o detalhe que diz "o piloto está segurando o carro" e não
 * "o carro está só virando mais".
 */
const CONTRAESTERCO = 0.65

/** Rolagem a mais na derrapagem cheia, em frações da rolagem do esterço máximo. */
const ROLAGEM_NA_DERRAPAGEM = 0.6

/** Guinada de uma pose, em radianos: positiva com o bico para a direita. */
function guinadaDaPose(pose: number) {
  const a = Math.min(2, Math.abs(pose))
  return Math.sign(pose) * (a <= 1 ? a * GUINADA_NA_CURVA : GUINADA_NA_CURVA + (a - 1) * GUINADA_NA_DERRAPAGEM)
}

/** Esterço das rodas da frente em relação à carroceria, de -1 a 1. */
function estercoDaPose(pose: number) {
  const a = Math.min(2, Math.abs(pose))
  return Math.sign(pose) * (a <= 1 ? a : 1 - (a - 1) * (1 + CONTRAESTERCO))
}

/** Rolagem da carroceria sobre a suspensão, em radianos. */
function rolagemDaPose(pose: number) {
  const a = Math.min(2, Math.abs(pose))
  return Math.sign(pose) * INCLINACAO * (a <= 1 ? a : 1 + (a - 1) * ROLAGEM_NA_DERRAPAGEM)
}

/** Quadro da folha mais perto de uma pose contínua. */
export function frameForPose(pose: number) {
  const valida = Number.isFinite(pose) ? pose : 0
  const a = Math.min(2, Math.abs(valida))
  const passos = a <= 1 ? Math.round(a * 4) : 4 + Math.round((a - 1) * 3)
  return QUADRO_RETO + Math.sign(valida) * passos
}

/** A pose que um quadro da folha guarda. */
export function poseOfFrame(quadro: number) {
  return POSES[quadro]
}

/** Quantos quadros a folha tem. */
export const CAR_FRAMES = QUADROS

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

/**
 * Caixa de cada quadro da folha, mais larga que a do retrato.
 *
 * Atravessado, o carro sai da caixa da garagem: o bico vai para um lado e a
 * traseira para o outro. A folga é medida, e não chutada — é a roda de fora,
 * a peça mais larga do carro, no quadro mais girado.
 */
const MEIA_LARGURA_DA_FOLHA = (() => {
  let maior = -CAIXA_CARRO.x
  for (const pose of POSES) {
    const guinada = guinadaDaPose(pose)
    for (const roda of ['dianteiraEsquerda', 'dianteiraDireita', 'traseiraEsquerda', 'traseiraDireita'] as const) {
      const [a, , c, , e] = yawTransform(roda, guinada)
      const [x, y] = WHEEL_CENTERS[roda]
      const fora = x + Math.sign(x) * 7
      maior = Math.max(maior, Math.abs(a * fora + c * y + e))
    }
  }
  return Math.ceil(maior + 2)
})()
const CAIXA_DA_FOLHA = { x: -MEIA_LARGURA_DA_FOLHA, y: CAIXA_CARRO.y, largura: MEIA_LARGURA_DA_FOLHA * 2, altura: CAIXA_CARRO.altura }

const LARGURA_QUADRO = Math.ceil(CAIXA_DA_FOLHA.largura * RESOLUCAO)
const ALTURA_QUADRO = Math.ceil(CAIXA_DA_FOLHA.altura * RESOLUCAO)

/**
 * Quadros por fileira da folha.
 *
 * Em fileira única, os quinze quadros davam uma tela de quase seis mil pixels
 * de largura — dentro do limite de área de qualquer celular, mas acima do de
 * largura de alguns navegadores antigos, que é de quatro mil e poucos. Em duas
 * fileiras de oito, ela fica com pouco mais de três mil.
 */
const COLUNAS = 8
const LINHAS = Math.ceil(QUADROS / COLUNAS)

/** Canto de cima à esquerda de um quadro dentro da folha, em pixels. */
function origemDoQuadro(indice: number): [number, number] {
  return [(indice % COLUNAS) * LARGURA_QUADRO, Math.floor(indice / COLUNAS) * ALTURA_QUADRO]
}

type Afim = readonly [number, number, number, number, number, number]

/**
 * A guinada de cada camada em cada quadro, e a origem de cada quadro na folha,
 * calculadas uma vez. O carro é desenhado duas vezes por quadro de jogo, e o
 * laço de quadro não aloca: a sombra de cada roda, as marcas de rolamento, a
 * terra e o brilho do boost leem daqui.
 */
const GUINADAS: readonly Record<Part, Afim>[] = POSES.map((pose) => {
  const guinada = guinadaDaPose(pose)
  const porParte = {} as Record<Part, Afim>
  for (const part of PARTS) porParte[part] = yawTransform(part, guinada)
  return porParte
})
const ORIGENS: readonly (readonly [number, number])[] = POSES.map((_, indice) => origemDoQuadro(indice))

type Desenho = {
  faces: { caminho: Path2D; fill: string; opacity: number }[]
  labels: CarModel['labels']
}

type Folha = { tela: HTMLCanvasElement }

const desenhos = new Map<CarId, Map<Part, Desenho>>()

/**
 * Folhas assadas, com teto.
 *
 * Cada folha são uns sete megabytes de textura, e a chave junta carro,
 * ambiente e fantasma: cinco carros em quatro ambientes dariam quarenta
 * folhas, perto de trezentos megabytes. Numa corrida solta isso nunca aparece — mas
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
 * Um quadro da folha, numa pose do eixo de curva.
 *
 * São quatro pistas de leitura, e nenhuma delas mexe na posição do carro na
 * pista: o carro gira no próprio eixo, a roda dianteira deita para o lado do
 * comando — ou para o lado contrário, na derrapagem —, a carroceria rola sobre
 * a suspensão e o piloto se joga para dentro da curva. Juntas, dão a impressão
 * de um carro que está virando mesmo parado no meio da tela.
 */
function desenharQuadro(ctx: CanvasRenderingContext2D, desenho: Map<Part, Desenho>, pose: number) {
  const guinada = guinadaDaPose(pose)
  const esterco = estercoDaPose(pose)
  const piloto = Math.max(-1, Math.min(1, pose))
  ctx.save()
  ctx.translate(0, LINHA_DO_CHAO)
  ctx.rotate(rolagemDaPose(pose))
  ctx.translate(0, -LINHA_DO_CHAO)
  for (const part of PARTS) {
    // A sombra fica de fora da folha: ela é desenhada ao vivo em `drawCar`,
    // no chão, enquanto o resto do carro rola e treme por cima. O retrato da
    // garagem continua assando a dele, e ali isso é o certo — o carro está
    // parado e nada tem por que se descolar dele.
    if (part === 'sombra') continue
    ctx.save()
    // A guinada vem antes de tudo: é ela que põe a peça no lugar em que o carro
    // girado a deixa, e o que vier depois — o centro da roda, o esterço, o
    // piloto se jogando — acontece dentro desse lugar.
    if (guinada !== 0) ctx.transform(...yawTransform(part, guinada))
    if (ehRoda(part)) {
      const [x, y] = WHEEL_CENTERS[part]
      ctx.translate(x, y)
      if (part === RODA_ESQUERDA || part === RODA_DIREITA) {
        ctx.transform(1, 0, esterco * ESTERCO_DA_RODA, 1, 0, 0)
      }
    } else if (part === 'piloto') {
      ctx.translate(-piloto * PILOTO_NA_CURVA, 0)
    }
    desenharParte(ctx, desenho.get(part)!)
    ctx.restore()
  }
  ctx.restore()
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
  ctx.fillRect(0, 0, LARGURA_QUADRO * COLUNAS, ALTURA_QUADRO * LINHAS)
  ctx.restore()
}

function assar(id: CarId, ambiente: string, fantasma: boolean): Folha {
  const desenho = desenhoDe(id)
  const tela = document.createElement('canvas')
  tela.width = LARGURA_QUADRO * COLUNAS
  tela.height = ALTURA_QUADRO * LINHAS
  const ctx = tela.getContext('2d')!
  ctx.textAlign = 'center'

  for (let indice = 0; indice < QUADROS; indice += 1) {
    ctx.save()
    // Cada quadro é recortado no próprio retângulo: sem isso a asa de um
    // quadro vazaria para dentro do vizinho quando a inclinação a joga para
    // fora da caixa.
    ctx.beginPath()
    const [x, y] = origemDoQuadro(indice)
    ctx.rect(x, y, LARGURA_QUADRO, ALTURA_QUADRO)
    ctx.clip()
    ctx.translate(x, y)
    ctx.scale(RESOLUCAO, RESOLUCAO)
    ctx.translate(-CAIXA_DA_FOLHA.x, -CAIXA_DA_FOLHA.y)
    desenharQuadro(ctx, desenho, POSES[indice])
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
 * Assar custa alguns milissegundos e uns sete megabytes de textura por carro.
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
function desenharRolamento(ctx: CanvasRenderingContext2D, travel: number, guinadas: Record<Part, Afim>) {
  ctx.fillStyle = 'rgba(190,206,198,.12)'
  const fase = ((travel * 0.9) % 4 + 4) % 4
  for (const roda of RODAS_TRASEIRAS) {
    // A roda de trás também escorrega quando o carro atravessa: a marca vai com ela.
    const t = guinadas[roda]
    const [cx, y] = WHEEL_CENTERS[roda]
    const x = t[0] * cx + t[2] * y + t[4]
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
  // O esterço e a derrapagem se somam num eixo só: com o volante todo virado e
  // a traseira escapando, o carro está atravessado.
  const esterco = Math.max(-1, Math.min(1, pose.steer))
  const quadro = frameForPose(esterco + Math.max(-1, Math.min(1, pose.drift)))
  const poseDoQuadro = POSES[quadro]
  // Cada quadro da folha já traz o carro rolado e girado, assado. O que se
  // desenha por cima dele depois — terra, sombra dos pneus — precisa do mesmo
  // giro e do mesmo deslize para continuar no mesmo lugar do desenho.
  const giroDoQuadro = rolagemDaPose(poseDoQuadro)
  const guinadas = GUINADAS[quadro]
  const deslizeDoMeio = guinadas.lateral

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
    // A mancha vai para onde a guinada leva a peça dela: a de cada roda com a
    // roda, a do assoalho com o meio do carro.
    const t = m.roda ? guinadas[m.roda] : deslizeDoMeio
    const gx = t[0] * m.x + t[2] * m.y + t[4]
    let cx = gx - pose.tilt * SOMBRA_POR_INCLINACAO
    let cy = m.y
    if (m.roda) {
      const acima = m.y - LINHA_DO_CHAO
      cx = gx * cosseno - acima * seno
      cy = gx * seno + acima * cosseno + LINHA_DO_CHAO
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
    ORIGENS[quadro][0], ORIGENS[quadro][1], LARGURA_QUADRO, ALTURA_QUADRO,
    CAIXA_DA_FOLHA.x, CAIXA_DA_FOLHA.y, CAIXA_DA_FOLHA.largura, CAIXA_DA_FOLHA.altura,
  )
  desenharRolamento(ctx, pose.travel, guinadas)

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
    // E a guinada: as manchas moram nos pontões, que deslizam com o meio do carro.
    ctx.transform(deslizeDoMeio[0], deslizeDoMeio[1], deslizeDoMeio[2], deslizeDoMeio[3], deslizeDoMeio[4], deslizeDoMeio[5])
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
    // A traseira desliza com a guinada, e a luz e o fogo moram nela.
    const traseira = guinadas.traseira
    ctx.transform(traseira[0], traseira[1], traseira[2], traseira[3], traseira[4], traseira[5])
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
