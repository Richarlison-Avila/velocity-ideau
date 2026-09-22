/**
 * Pincel: o vocabulário de traço com que tudo no jogo é desenhado.
 *
 * O carro e o cenário saem do mesmo conjunto de primitivas, e é por isso que
 * ele mora num módulo só. Duas peças desenhadas com vocabulários diferentes
 * nunca parecem pertencer à mesma cena, por mais que a paleta coincida: o que
 * denuncia é a forma — onde a quina é reta, onde ela é arredondada, quão largo
 * é o vinco entre duas superfícies encostadas.
 *
 * O pincel não desenha: ele descreve. Acumula faces e decalques em listas que
 * depois são rasterizadas numa folha de sprites ou servidas como SVG. Isso é o
 * que deixa o mesmo molde virar uma imagem de tamanho qualquer, e é o que
 * permite medir o contorno de uma peça num teste sem abrir um canvas.
 *
 * Por causa dessa medição, **nenhuma primitiva usa arco**. A elipse sai como
 * polígono de vinte lados — nesta escala é o mesmo desenho, e é o que deixa o
 * contorno ser conferido somando os números do caminho.
 */
import type { Rampa } from './paleta'

/** Um ponto do desenho, em unidades do molde. */
export type Ponto = readonly [number, number]

/** Uma borda horizontal: a altura na tela e a meia-largura naquela altura. */
export type Borda = { y: number; meia: number }

/**
 * Uma face cheia do desenho.
 *
 * `Camada` é o conjunto de camadas de quem está desenhando — as peças do carro,
 * as famílias do cenário —, e é o que mantém a ordem de desenho conferível em
 * tempo de compilação.
 */
export type Face<Camada extends string> = { part: Camada; d: string; fill: string; opacity?: number }

/** Texto de patrocínio ou numeração, desenhado junto com a face. */
export type Label<Camada extends string> = {
  part: Camada
  text: string
  x: number
  y: number
  size: number
  fill: string
  rotate?: number
}

/** Os dois lados de qualquer peça simétrica em torno do eixo. */
export const LADOS = [-1, 1] as const

/** Perfil de luz de um cilindro visto de trás, com o sol em cima e à esquerda. */
export const CILINDRO = [2, 4, 3, 1, 0] as const

/**
 * Largura do vinco entre duas peças encostadas, em unidades do desenho.
 *
 * Do lado do sol o vinco é só a quina da peça de cima. Do lado da sombra ele
 * acumula também a sombra que essa peça projeta na de baixo, e por isso é mais
 * do que o dobro. É essa assimetria que informa de que lado vem a luz — um
 * vinco igual dos dois lados lê como contorno de adesivo, não como volume.
 */
export const VINCO = { luz: 0.8, sombra: 2.1 }

/** Fio claro na quina que pega sol, do outro lado do vinco. */
export const FIO = 0.45

/** Vinco do lado que o sol alcança? A luz vem de cima e da esquerda. */
export function vincoDoLado(lado: number) {
  return lado < 0 ? VINCO.luz : VINCO.sombra
}

export type Pincel<Camada extends string> = {
  /** Polígono, o traço básico de tudo. */
  poly: (part: Camada, fill: string, pontos: readonly Ponto[], opacity?: number) => void
  rect: (part: Camada, fill: string, x: number, y: number, largura: number, altura: number, opacity?: number) => void
  /** Retângulo de cantos arredondados, para pneus e caixas. */
  caixa: (part: Camada, fill: string, x: number, y: number, largura: number, altura: number, raio: number, opacity?: number) => void
  elipse: (part: Camada, fill: string, x: number, y: number, rx: number, ry: number, opacity?: number) => void
  /** Segmento de espessura constante, para braços de suspensão e filetes. */
  risco: (part: Camada, fill: string, x1: number, y1: number, x2: number, y2: number, espessura: number, opacity?: number) => void
  /** Faixa horizontal entre duas bordas de meia-largura diferente. */
  faixa: (part: Camada, fill: string, topo: Borda, base: Borda, opacity?: number) => void
  /**
   * Volume cilíndrico resolvido em faixas verticais.
   *
   * `perfil` diz qual tom da rampa vai em cada faixa, da esquerda para a
   * direita. É o miolo do sombreado: quase toda carroceria do carro é um
   * tronco de cone visto de trás e de cima, e sai daqui.
   */
  volume: (part: Camada, tons: Rampa, topo: Borda, base: Borda, perfil: readonly number[], opacity?: number) => void
  /**
   * Aresta de um volume: a faixa fina na borda dele, de um lado só.
   *
   * É a ferramenta que dá volume a uma forma chapada. Duas cores vizinhas sem
   * nada entre elas viram uma mancha só; com um vinco escuro de um lado e um
   * fio claro do outro, a mesma forma passa a ter uma peça por cima da outra.
   * O vinco é mais largo no lado da sombra, porque ali ele acumula a sombra
   * que a peça de cima projeta na de baixo.
   */
  aresta: (part: Camada, fill: string, topo: Borda, base: Borda, lado: number, largura: number, opacity?: number) => void
  /**
   * O mesmo vinco, mas entre dois contornos quaisquer.
   *
   * Serve para as peças que não são simétricas em torno do eixo — o convés do
   * pontão, principalmente —, onde a borda já vem como lista de pontos em vez
   * de meia-largura.
   */
  costura: (part: Camada, fill: string, de: readonly Ponto[], para: readonly Ponto[], opacity?: number) => void
  texto: (part: Camada, valor: string, x: number, y: number, tamanho: number, cor: string, giro?: number) => void
}

/** Quantos lados tem a elipse. Vinte já é indistinguível de um arco nesta escala. */
const LADOS_DA_ELIPSE = 20

/** Um pincel que despeja o que desenha nas duas listas recebidas. */
export function pincel<Camada extends string>(
  faces: Face<Camada>[],
  labels: Label<Camada>[],
): Pincel<Camada> {
  type P = Pincel<Camada>

  const poly: P['poly'] = (part, fill, pontos, opacity) => {
    const d = pontos.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`).join('') + 'Z'
    faces.push({ part, fill, d, ...(opacity === undefined ? {} : { opacity }) })
  }
  const rect: P['rect'] = (part, fill, x, y, largura, altura, opacity) =>
    poly(part, fill, [[x, y], [x + largura, y], [x + largura, y + altura], [x, y + altura]], opacity)
  const caixa: P['caixa'] = (part, fill, x, y, largura, altura, raio, opacity) => {
    const r = Math.min(raio, largura / 2, altura / 2)
    const n = (v: number) => v.toFixed(2)
    const d =
      `M${n(x + r)} ${n(y)}H${n(x + largura - r)}Q${n(x + largura)} ${n(y)} ${n(x + largura)} ${n(y + r)}` +
      `V${n(y + altura - r)}Q${n(x + largura)} ${n(y + altura)} ${n(x + largura - r)} ${n(y + altura)}` +
      `H${n(x + r)}Q${n(x)} ${n(y + altura)} ${n(x)} ${n(y + altura - r)}` +
      `V${n(y + r)}Q${n(x)} ${n(y)} ${n(x + r)} ${n(y)}Z`
    faces.push({ part, fill, d, ...(opacity === undefined ? {} : { opacity }) })
  }
  const elipse: P['elipse'] = (part, fill, x, y, rx, ry, opacity) => {
    const pontos: Ponto[] = []
    for (let i = 0; i < LADOS_DA_ELIPSE; i += 1) {
      const angulo = (i * Math.PI * 2) / LADOS_DA_ELIPSE
      pontos.push([x + rx * Math.cos(angulo), y + ry * Math.sin(angulo)])
    }
    poly(part, fill, pontos, opacity)
  }
  const risco: P['risco'] = (part, fill, x1, y1, x2, y2, espessura, opacity) => {
    const comprimento = Math.hypot(x2 - x1, y2 - y1) || 1
    const dx = ((y2 - y1) / comprimento) * espessura / 2
    const dy = ((x1 - x2) / comprimento) * espessura / 2
    poly(part, fill, [[x1 - dx, y1 - dy], [x2 - dx, y2 - dy], [x2 + dx, y2 + dy], [x1 + dx, y1 + dy]], opacity)
  }
  const faixa: P['faixa'] = (part, fill, topo, base, opacity) =>
    poly(part, fill, [[-topo.meia, topo.y], [topo.meia, topo.y], [base.meia, base.y], [-base.meia, base.y]], opacity)
  const volume: P['volume'] = (part, tons, topo, base, perfil, opacity) => {
    for (let i = 0; i < perfil.length; i += 1) {
      const a = -1 + (2 * i) / perfil.length
      const b = -1 + (2 * (i + 1)) / perfil.length
      poly(part, tons[perfil[i]], [
        [a * topo.meia, topo.y], [b * topo.meia, topo.y],
        [b * base.meia, base.y], [a * base.meia, base.y],
      ], opacity)
    }
  }
  const aresta: P['aresta'] = (part, fill, topo, base, lado, largura, opacity) =>
    poly(part, fill, [
      [lado * topo.meia, topo.y],
      [lado * (topo.meia - largura), topo.y],
      [lado * (base.meia - largura), base.y],
      [lado * base.meia, base.y],
    ], opacity)
  const costura: P['costura'] = (part, fill, de, para, opacity) =>
    poly(part, fill, [...de, ...[...para].reverse()], opacity)
  const texto: P['texto'] = (part, valor, x, y, tamanho, cor, giro) =>
    labels.push({ part, text: valor, x, y, size: tamanho, fill: cor, ...(giro === undefined ? {} : { rotate: giro }) })

  return { poly, rect, caixa, elipse, risco, faixa, volume, aresta, costura, texto }
}
