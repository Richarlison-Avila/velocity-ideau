/**
 * Molde dos objetos da beira da pista.
 *
 * É para o cenário o que `carModel.ts` é para o carro: cada objeto descrito
 * uma vez, com o mesmo pincel e a mesma regra de luz, para depois ser assado
 * numa folha e desenhado com uma chamada só. Sem isso o cenário fica preso ao
 * detalhe que cabe em três a dez preenchimentos por objeto — que é onde ele
 * estava — enquanto o carro passa de trezentas faces.
 *
 * ## Sistema de coordenadas
 *
 * Cada objeto é desenhado numa caixa própria, medida na **altura dele**:
 * `y = 0` é o chão, `y = -1` é o topo, e `x = 0` é o eixo. `meiaLargura` diz
 * quanto o objeto se abre para os lados, também em alturas. Quem desenha na
 * pista só precisa dizer onde fica o chão e que altura o objeto tem naquela
 * distância — a projeção da pista já resolveu isso.
 *
 * Não há câmera aqui, e é deliberado. A câmera de `carModel.ts` é uma
 * teleobjetiva longa, escolhida para achatar um objeto comprido visto de
 * trás; a corrida usa uma grande-angular de doze metros de profundidade. Um
 * objeto de beira de pista é alto e curto, quase um quadro em pé, então ele é
 * desenhado em elevação, com só uma insinuação de face de cima — que é o que
 * a linha do horizonte a 29% da tela autoriza a ver.
 *
 * ## Duas regras que não são estéticas
 *
 * **Nenhuma face pode ter opacidade menor que 1.** Quem desenha o cenário
 * aplica a névoa da distância com `globalAlpha`; face a face, isso dá uma cor,
 * e aplicado ao objeto já composto na folha, dá outra. Um objeto com face
 * translúcida mudaria de cor ao trocar de caminho de desenho. A regra vira
 * teste, e é por isso que a sombra do objeto no chão **não** mora aqui: ela é
 * translúcida por natureza, e continua sendo desenhada na pista.
 *
 * **Os gomos ladrilham a silhueta, não se empilham sobre ela.** O carro pode
 * empilhar volume, aresta e costura no mesmo lugar porque é assado uma vez e
 * visto pequeno. Um objeto de cenário chega a ocupar meia tela, e aí o que
 * pesa não é o número de chamadas, é a área escrita: sobreposição de três
 * contra um e pouco é a diferença entre um milhão e meio e seiscentos mil
 * pixels por árvore.
 */
import { misturar, rampa, SOMBRA, type Rampa } from './paleta'
import { CILINDRO, pincel, type Face, type Pincel } from './pincel'
import type { Flora, SceneryKind } from './layout'

/**
 * O cenário não tem camadas.
 *
 * No carro elas existem porque roda e carroceria se movem por conta própria.
 * Aqui cada objeto é assado inteiro e desenhado de uma vez, então a ordem de
 * chamada já é a ordem de desenho, e uma camada só basta.
 */
type Camada = 'objeto'

/**
 * Famílias que ganham modelo.
 *
 * Cerca e guardrail ficam de fora, e pelo mesmo motivo: são contínuos. O vão
 * de cada um cobre metade do espaçamento para os dois lados, para as travessas
 * de vagas vizinhas se encontrarem — e isso depende das projeções das duas
 * vagas, que diferem. Assados numa célula por vaga, virariam uma fila de
 * portõezinhos soltos.
 */
export type FamiliaModelada = Exclude<SceneryKind, 'fence' | 'guardrail'> | 'marcador'

/** Quantas variantes de forma cada família tem. */
export const VARIANTES: Record<FamiliaModelada, number> = {
  tree: 3,
  bush: 3,
  grass: 3,
  sign: 3,
  marcador: 2,
  pneus: 2,
  poste: 2,
  arquibancada: 2,
  bandeira: 3,
  pedra: 3,
  cacto: 3,
  predio: 3,
}

/** Quais famílias mudam de cor com o tom sorteado pelo traçado. */
export const TONS: Record<FamiliaModelada, number> = {
  tree: 3,
  bush: 3,
  grass: 3,
  // Tudo o que é construído tem cor de material, não tom de vegetação: o tom
  // sorteado pelo traçado não muda uma placa de metal nem um muro de tijolo.
  sign: 1,
  marcador: 1,
  pneus: 1,
  poste: 1,
  arquibancada: 1,
  bandeira: 1,
  predio: 1,
  // A rocha é a exceção construída: ela muda de cor com a flora, porque num
  // deserto é arenito e numa montanha é granito.
  pedra: 1,
  cacto: 2,
}

/**
 * Nível de detalhe.
 *
 * `cheio` é para a célula grande, que serve o campo perto; `simples` é para a
 * pequena. Metade dos objetos visíveis tem menos de sessenta pixels de altura,
 * e trinta faces ali dariam seis pixels por detalhe — gasto que não aparece e
 * que dobra o tempo de assar.
 */
export type Detalhe = 'cheio' | 'simples'

export type ObjetoModelado = {
  /** Meia-largura do objeto, medida em alturas dele. */
  meiaLargura: number
  faces: Face<Camada>[]
}

// ---------------------------------------------------------------------------
// Paleta da vegetação
// ---------------------------------------------------------------------------

/**
 * Cores do cenário, por tipo de vegetação.
 *
 * Cada tom é uma rampa de cinco, a mesma do carro: sem rampa não há como dar
 * face iluminada e face na sombra a uma copa. O ambiente da corrida escolhe o
 * conjunto — numa travessia seca não há mato verde na beira da pista.
 */
export const VEGETACAO: Record<Flora, { copas: Rampa[]; troncos: Rampa[]; arbustos: Rampa[]; capins: Rampa[] }> = {
  verde: {
    copas: ['#236030', '#2a6d38', '#1d4b2a'].map(rampa),
    troncos: ['#3b2d23', '#46362b', '#31261e'].map(rampa),
    arbustos: ['#2d6b3a', '#255c33', '#1f5130'].map(rampa),
    capins: ['#3d8a4f', '#357c46', '#2e7040'].map(rampa),
  },
  seca: {
    copas: ['#6b6130', '#746a35', '#5a5227'].map(rampa),
    troncos: ['#4a3722', '#55412a', '#3d2d1c'].map(rampa),
    arbustos: ['#6a5f2f', '#5d5228', '#514724'].map(rampa),
    capins: ['#97883f', '#8a7b3c', '#7d7036'].map(rampa),
  },
}

/** Cor das placas de sinalização, e do poste que as segura. */
const PLACAS = ['#d8dee2', '#e6b325', '#cf4436'].map(rampa)
const POSTE = rampa('#6d7b7f')
const MARCADOR = [rampa('#c9d6dc'), rampa('#f2b52e')]

/** Materiais do que é construído: não mudam com a flora nem com o tom. */
const BORRACHA = rampa('#3a4046')
const METAL = rampa('#889297')
const CONCRETO = rampa('#8d9299')
const VIDRO = rampa('#2b3d4a')
const VIDRO_ACESO = rampa('#d9c77a')
const PAREDES = ['#9a5f4a', '#6f7a84', '#8a8f78'].map(rampa)
const PANOS = ['#cf4436', '#e6b325', '#3f7fa8'].map(rampa)
const ARQUIBANCADA = rampa('#b9beb6')
const TORCIDA = ['#e05a3d', '#f0d15a', '#5fa8d8', '#e8e5d6', '#4d5a63'].map(rampa)
/** A rocha muda com a flora: granito na montanha, arenito no deserto. */
const ROCHAS: Record<Flora, Rampa> = { verde: rampa('#6e736d'), seca: rampa('#9a7a52') }
const CACTOS = [rampa('#3f7a4e'), rampa('#4a8a58')]

// ---------------------------------------------------------------------------
// Ferramentas de forma
// ---------------------------------------------------------------------------

/** Perfil de luz de um gomo de copa: o sol bate em cima e à esquerda. */
const COPA_ALTA = [2, 3, 4, 3, 1] as const
const COPA_MEIO = [1, 2, 3, 2, 0] as const
const COPA_BAIXA = [0, 1, 2, 1, 0] as const

/**
 * Uma faixa da silhueta, em gomos verticais.
 *
 * É o `volume` do pincel, com os dois lados dados em meia-largura. Empilhar
 * três destas resolve uma copa inteira: os gomos ladrilham a área sem
 * sobreposição, e o degrau de tom entre eles é o que faz a massa ler como
 * volume em vez de mancha.
 */
function faixa(p: Pincel<Camada>, tons: Rampa, cima: number, meiaCima: number, baixo: number, meiaBaixo: number, perfil: readonly number[]) {
  p.volume('objeto', tons, { y: cima, meia: meiaCima }, { y: baixo, meia: meiaBaixo }, perfil)
}

/** Tronco: três faixas verticais, a da esquerda acesa. */
function tronco(p: Pincel<Camada>, casca: Rampa, meia: number, deY: number, ateY: number, detalhe: Detalhe) {
  p.volume('objeto', casca, { y: deY, meia }, { y: ateY, meia: meia * 1.15 }, detalhe === 'cheio' ? [3, 2, 1] : [2, 1])
  if (detalhe === 'simples') return
  // Raiz: o alargamento que assenta o tronco no chão em vez de plantá-lo como
  // um poste.
  p.poly('objeto', casca[0], [
    [-meia * 1.15, ateY], [meia * 1.15, ateY], [meia * 2.1, 0], [-meia * 2.1, 0],
  ])
  p.poly('objeto', casca[2], [
    [-meia * 1.15, ateY], [-meia * 0.2, ateY], [-meia * 0.9, 0], [-meia * 2.1, 0],
  ])
}

// ---------------------------------------------------------------------------
// Famílias
// ---------------------------------------------------------------------------

/**
 * Conífera: saias empilhadas, cada uma em gomos.
 *
 * A silhueta de pinheiro sai do número de saias e da forma como cada uma
 * avança sobre a de baixo. A costura escura sob cada saia é o que separa uma
 * da outra — sem ela, quatro trapézios empilhados leem como um cone só.
 */
function conifera(p: Pincel<Camada>, copa: Rampa, casca: Rampa, detalhe: Detalhe) {
  tronco(p, casca, 0.035, -0.3, 0, detalhe)
  const saias: number = detalhe === 'cheio' ? 4 : 2
  // De baixo para cima. A saia de cima tem de cair **sobre** a de baixo para o
  // degrau aparecer — desenhando de cima para baixo, cada saia cobria a aba da
  // anterior e o pinheiro saía um cone liso.
  for (let i = saias - 1; i >= 0; i -= 1) {
    // Denominador `saias - 1`: é o que faz a saia mais baixa fechar no mesmo
    // ponto com duas ou com quatro. Com `saias`, a versão simples parava a um
    // terço do chão e a árvore saía um espeto.
    const t = i / (saias - 1)
    // A saia mais baixa fecha exatamente na linha do chão. Com 0,62 ela
    // passava quatro centésimos da altura para baixo e a árvore afundava na
    // grama — de pé no desenho, enterrada na pista.
    const cima = -1 + t * 0.58
    const baixo = cima + 0.42
    const meiaCima = 0.03 + t * 0.09
    const meiaBaixo = 0.14 + t * 0.2
    const perfil = i === 0 ? COPA_ALTA : i === saias - 1 ? COPA_BAIXA : COPA_MEIO
    // Sombra que esta saia joga na de baixo, posta antes dela: a de baixo já
    // está desenhada, e esta cai por cima das duas.
    if (i < saias - 1 && detalhe === 'cheio') {
      p.poly('objeto', copa[0], [
        [-meiaBaixo, baixo], [meiaBaixo, baixo],
        [meiaBaixo * 0.93, baixo + 0.045], [-meiaBaixo * 0.93, baixo + 0.045],
      ])
    }
    faixa(p, copa, cima, meiaCima, baixo, meiaBaixo, perfil)
  }
}

/**
 * Frondosa: três faixas empilhadas que abrem e fecham.
 *
 * A copa inteira são quinze gomos que ladrilham a silhueta — nenhum se
 * sobrepõe a outro. As meias-larguras variam com a variante, para duas
 * árvores vizinhas não saírem com o mesmo contorno.
 */
function frondosa(p: Pincel<Camada>, copa: Rampa, casca: Rampa, variante: number, detalhe: Detalhe) {
  /**
   * Cada variante tem forma própria, não só largura.
   *
   * Duas árvores que diferem em 12% de gordura leem como a mesma árvore
   * repetida, e repetição é o que mais denuncia cenário gerado. Aqui uma é
   * alta e fechada e a outra é baixa e aberta, o que se reconhece de longe.
   */
  const alta = variante === 1
  const meia = alta ? 0.3 : 0.4
  // O tronco fica com pouco menos de um terço da altura. Com metade, a árvore
  // lia como pirulito.
  const pe = alta ? -0.32 : -0.24
  tronco(p, casca, 0.04, pe - 0.04, 0, detalhe)

  const perfilDaCopa = [
    { t: 0, largura: 0.4 },
    { t: 0.3, largura: alta ? 0.86 : 0.96 },
    { t: 0.62, largura: 1 },
    { t: 1, largura: alta ? 0.72 : 0.58 },
  ]
  const emY = (t: number) => -1 + t * (1 + pe)
  // No detalhe simples a copa vira uma faixa só, do topo ao pé: o contorno é o
  // mesmo, com um terço das faces.
  const paradas = detalhe === 'cheio'
    ? perfilDaCopa
    : [perfilDaCopa[0], perfilDaCopa[perfilDaCopa.length - 1]]
  for (let i = 0; i < paradas.length - 1; i += 1) {
    const de = paradas[i]
    const ate = paradas[i + 1]
    const perfil = i === 0 ? COPA_ALTA : ate.t >= 1 ? COPA_BAIXA : COPA_MEIO
    faixa(p, copa, emY(de.t), meia * de.largura, emY(ate.t), meia * ate.largura, perfil)
  }
}

/** Arbusto: duas faixas baixas e largas, com uma bossa acesa em cima. */
function arbusto(p: Pincel<Camada>, mato: Rampa, variante: number, detalhe: Detalhe) {
  // Variante 0 é rasteiro e largo, 2 é alto e fechado: a diferença de forma
  // vale mais que a de tamanho para o mato não parecer carimbado.
  const meia = [0.74, 0.62, 0.52][variante % 3]
  if (detalhe === 'simples') {
    faixa(p, mato, -1, meia * 0.66, 0, meia, COPA_MEIO)
    return
  }
  faixa(p, mato, -1, meia * 0.44, -0.72, meia * 0.88, COPA_ALTA)
  faixa(p, mato, -0.72, meia * 0.88, -0.3, meia, COPA_MEIO)
  faixa(p, mato, -0.3, meia, 0, meia * 0.92, COPA_BAIXA)
}

/** Capim: talos afinando para a ponta, cada um com a metade do sol acesa. */
function capim(p: Pincel<Camada>, tons: Rampa, variante: number, detalhe: Detalhe) {
  const talos: number = detalhe === 'cheio' ? 7 : 3
  const abertura = 0.78 + (variante - 1) * 0.14
  for (let i = 0; i < talos; i += 1) {
    const t = (i / (talos - 1)) * 2 - 1
    const base = t * abertura * 0.36
    // A ponta abre menos do que o pé para o tufo não virar uma estrela.
    const ponta = base + t * abertura * 0.2
    const altura = 1 - Math.abs(t) * 0.34
    const largura = 0.095
    // O talo do meio é o mais claro, os das pontas ficam na sombra do tufo.
    p.poly('objeto', tons[Math.abs(t) > 0.6 ? 0 : 1], [
      [base - largura, 0], [base + largura, 0], [ponta, -altura],
    ])
    if (detalhe === 'simples') continue
    // Meia lâmina acesa, do lado do sol — um terço da largura, não quatro
    // quintos: com quatro quintos o tufo saía branco.
    p.poly('objeto', tons[3], [
      [base - largura, 0], [base - largura * 0.35, 0], [ponta, -altura],
    ])
  }
}

/** Placa: painel emoldurado sobre um poste, com a aresta de cima acesa. */
function placa(p: Pincel<Camada>, tinta: Rampa, detalhe: Detalhe) {
  const meiaPoste = 0.045
  p.volume('objeto', POSTE, { y: -0.58, meia: meiaPoste }, { y: 0, meia: meiaPoste }, detalhe === 'cheio' ? [4, 2, 1] : [2, 1])
  // Moldura escura: é ela que descola a placa da vegetação atrás.
  p.poly('objeto', misturar(POSTE[0], SOMBRA, 0.5), [
    [-0.5, -1], [0.5, -1], [0.5, -0.52], [-0.5, -0.52],
  ])
  p.poly('objeto', tinta[2], [
    [-0.42, -0.95], [0.42, -0.95], [0.42, -0.57], [-0.42, -0.57],
  ])
  if (detalhe === 'simples') return
  p.poly('objeto', tinta[4], [[-0.42, -0.95], [0.42, -0.95], [0.42, -0.88], [-0.42, -0.88]])
  p.poly('objeto', tinta[0], [[-0.42, -0.64], [0.42, -0.64], [0.42, -0.57], [-0.42, -0.57]])
  // Seta, que é o que uma placa de beira de pista diz de verdade.
  p.poly('objeto', tinta[0], [[-0.22, -0.82], [0.1, -0.82], [0.1, -0.7], [-0.22, -0.7]])
  p.poly('objeto', tinta[0], [[0.06, -0.88], [0.28, -0.76], [0.06, -0.64]])
}

/** Marcador de distância: poste fino com a cabeça pintada. */
function marcador(p: Pincel<Camada>, alto: boolean, detalhe: Detalhe) {
  // O marcador é um espeto: a cabeça tem sete centésimos da altura dele de
  // meia-largura. Com qualquer coisa mais gorda ele vira um pilar na beira da
  // pista e rouba a cena da vegetação.
  const meia = 0.034
  const cabeca = MARCADOR[alto ? 1 : 0]
  p.volume('objeto', POSTE, { y: -0.78, meia }, { y: 0, meia }, detalhe === 'cheio' ? [4, 2, 1] : [2, 1])
  p.volume('objeto', cabeca, { y: -1, meia: meia * 1.9 }, { y: -0.76, meia: meia * 1.9 }, detalhe === 'cheio' ? [4, 2, 1] : [2, 1])
  if (detalhe === 'simples') return
  p.poly('objeto', cabeca[4], [[-meia * 1.9, -1], [meia * 1.9, -1], [meia * 1.9, -0.94], [-meia * 1.9, -0.94]])
  p.poly('objeto', misturar(POSTE[0], SOMBRA, 0.4), [
    [-meia * 1.9, -0.79], [meia * 1.9, -0.79], [meia * 1.9, -0.76], [-meia * 1.9, -0.76],
  ])
}

/**
 * Pilha de pneus: a proteção de curva de todo autódromo.
 *
 * De baixo para cima, para o pneu de cima cair sobre o de baixo e o degrau
 * aparecer. O de cima leva capa clara, que é o que a torna visível contra a
 * grama de longe.
 */
function pilhaDePneus(p: Pincel<Camada>, variante: number, detalhe: Detalhe) {
  const camadas = variante === 0 ? 3 : 4
  const meia = 0.5
  const passo = 1 / camadas
  for (let i = camadas - 1; i >= 0; i -= 1) {
    const cima = -1 + i * passo
    const baixo = Math.min(0, cima + passo * 1.06)
    if (i < camadas - 1 && detalhe === 'cheio') {
      p.poly('objeto', BORRACHA[0], [
        [-meia, baixo - passo * 0.12], [meia, baixo - passo * 0.12],
        [meia * 0.94, baixo], [-meia * 0.94, baixo],
      ])
    }
    faixa(p, i === 0 ? ARQUIBANCADA : BORRACHA, cima, meia * 0.94, baixo, meia,
      detalhe === 'cheio' ? CILINDRO : [2, 3, 1])
    if (detalhe === 'simples') continue
    // Furo do meio: é ele que diz que aquilo é um pneu, e não um tambor.
    p.poly('objeto', BORRACHA[0], [
      [-meia * 0.24, cima + passo * 0.26], [meia * 0.24, cima + passo * 0.26],
      [meia * 0.24, cima + passo * 0.74], [-meia * 0.24, cima + passo * 0.74],
    ])
  }
}

/**
 * Poste de iluminação: mastro fino com a luminária no alto.
 *
 * A luminária fica centrada, sem braço para um dos lados. O mesmo desenho
 * serve às duas beiras da pista, e um braço apontando sempre para o mesmo lado
 * ficaria virado para fora em metade das vagas.
 */
function posteDeLuz(p: Pincel<Camada>, variante: number, detalhe: Detalhe) {
  const meia = 0.038
  const cabeca = variante === 0 ? 0.12 : 0.16
  p.volume('objeto', METAL, { y: -0.86, meia }, { y: 0, meia: meia * 1.4 },
    detalhe === 'cheio' ? [4, 2, 1] : [3, 1])
  if (detalhe === 'cheio') {
    // Base alargada, que planta o mastro em vez de enfiá-lo na grama.
    p.poly('objeto', METAL[1], [
      [-meia * 1.4, -0.07], [meia * 1.4, -0.07], [meia * 3.4, 0], [-meia * 3.4, 0],
    ])
  }
  p.volume('objeto', CONCRETO, { y: -1, meia: cabeca * 0.86 }, { y: -0.86, meia: cabeca },
    detalhe === 'cheio' ? [4, 3, 2, 1] : [3, 1])
  if (detalhe === 'simples') return
  p.poly('objeto', VIDRO_ACESO[4], [
    [-cabeca * 0.94, -0.9], [cabeca * 0.94, -0.9], [cabeca, -0.86], [-cabeca, -0.86],
  ])
}

/**
 * Arquibancada: degraus e público.
 *
 * O público é o que a faz ler como corrida em vez de muro, e sai barato —
 * cada torcedor são dois retângulos. As cores vêm da posição, não de sorteio:
 * o modelo tem de ser função pura da variante, como tudo o mais.
 */
function arquibancada(p: Pincel<Camada>, variante: number, detalhe: Detalhe) {
  const meia = 1.08
  const degraus = variante === 0 ? 5 : 6
  // Estrutura sob a bancada, que a levanta do chão.
  p.poly('objeto', misturar(CONCRETO[0], SOMBRA, 0.4), [
    [-meia, -0.17], [meia, -0.17], [meia * 0.94, 0], [-meia * 0.94, 0],
  ])
  for (let i = degraus - 1; i >= 0; i -= 1) {
    const cima = -1 + (i / degraus) * 0.83
    const baixo = cima + 0.83 / degraus
    const recuo = 1 - (i / degraus) * 0.1
    faixa(p, ARQUIBANCADA, cima, meia * recuo, baixo, meia * recuo,
      i % 2 === 0 ? [3, 4, 3, 2] : [2, 3, 2, 1])
    if (detalhe === 'simples') continue
    p.poly('objeto', misturar(ARQUIBANCADA[0], SOMBRA, 0.25), [
      [-meia * recuo, baixo - 0.02], [meia * recuo, baixo - 0.02],
      [meia * recuo, baixo], [-meia * recuo, baixo],
    ])
    const gente = 11
    for (let n = 0; n < gente; n += 1) {
      // Uma falha a cada sete, para a fileira não sair de régua.
      if ((n * 5 + i * 3) % 7 === 0) continue
      const x = (-1 + (2 * n) / (gente - 1)) * meia * recuo * 0.88
      const cor = TORCIDA[(n + i * 2) % TORCIDA.length]
      p.poly('objeto', cor[2], [
        [x - 0.035, cima + 0.012], [x + 0.035, cima + 0.012],
        [x + 0.035, cima + 0.082], [x - 0.035, cima + 0.082],
      ])
      p.poly('objeto', cor[4], [
        [x - 0.035, cima + 0.012], [x - 0.008, cima + 0.012],
        [x - 0.008, cima + 0.082], [x - 0.035, cima + 0.082],
      ])
    }
  }
}

/** Bandeira: mastro e pano, com a metade do sol acesa. */
function bandeira(p: Pincel<Camada>, variante: number, detalhe: Detalhe) {
  const pano = PANOS[variante % PANOS.length]
  const meia = 0.03
  p.volume('objeto', METAL, { y: -1, meia }, { y: 0, meia: meia * 1.3 },
    detalhe === 'cheio' ? [4, 2, 1] : [3, 1])
  p.poly('objeto', pano[2], [
    [meia, -0.98], [0.32, -0.92], [0.3, -0.62], [meia, -0.6],
  ])
  if (detalhe === 'simples') return
  p.poly('objeto', pano[4], [
    [meia, -0.98], [0.15, -0.95], [0.14, -0.61], [meia, -0.6],
  ])
  p.poly('objeto', pano[0], [
    [0.24, -0.935], [0.32, -0.92], [0.3, -0.62], [0.23, -0.615],
  ])
}

/** Rocha: um bloco facetado, com a face do sol partindo a silhueta. */
function rocha(p: Pincel<Camada>, tons: Rampa, variante: number, detalhe: Detalhe) {
  // O topo é sempre -1: a caixa do objeto é o contorno dele, e uma rocha que
  // parasse antes deixaria a célula da folha meio vazia e sairia menor do que
  // o traçado pediu. A variante muda a forma, não a altura.
  const largo = [0.7, 0.55, 0.64][variante % 3]
  const ombro = [0.42, 0.66, 0.28][variante % 3]
  const cintura = [-0.42, -0.3, -0.54][variante % 3]
  faixa(p, tons, -1, largo * ombro, cintura, largo * 0.94, [2, 3, 2, 1])
  faixa(p, tons, cintura, largo * 0.94, 0, largo, [1, 2, 1, 0])
  if (detalhe === 'simples') return
  // Face voltada para o sol, cortada na diagonal: é o que tira a rocha do
  // contorno de bolha e a faz parecer partida.
  p.poly('objeto', tons[4], [
    [-largo * ombro, -1], [0, -1], [-largo * 0.2, cintura], [-largo * 0.84, cintura],
  ])
  p.poly('objeto', tons[0], [
    [largo * 0.2, cintura], [largo * 0.94, cintura], [largo, 0], [largo * 0.34, 0],
  ])
  p.poly('objeto', tons[1], [
    [-largo, 0], [-largo * 0.74, -0.13], [-largo * 0.5, 0],
  ])
}

/** Cacto: coluna com braços, e as costelas verticais que o identificam. */
function cacto(p: Pincel<Camada>, tons: Rampa, variante: number, detalhe: Detalhe) {
  const meia = 0.13
  p.volume('objeto', tons, { y: -1, meia: meia * 0.9 }, { y: 0, meia },
    detalhe === 'cheio' ? CILINDRO : [2, 3, 1])
  /**
   * Braços por variante, e não um vetor comum cortado em dois.
   *
   * Com um vetor comum, as variantes 0 e 1 pegavam os dois primeiros braços e
   * saíam idênticas — duas células iguais na folha, gastas por nada.
   */
  const BRACOS: [number, number, number][][] = [
    [[-1, -0.62, -0.34]],
    [[1, -0.54, -0.26], [-1, -0.74, -0.48]],
    [[-1, -0.66, -0.38], [1, -0.48, -0.2], [-1, -0.86, -0.64]],
  ]
  for (const [lado, alto, junta] of BRACOS[variante % BRACOS.length]) {
    const braco = meia * 0.72
    const ponta = 0.34
    // Ombro na horizontal e depois a subida: é esse cotovelo que faz um cacto.
    p.poly('objeto', tons[lado < 0 ? 3 : 1], [
      [lado * meia * 0.7, junta], [lado * ponta, junta],
      [lado * ponta, junta - braco * 1.3], [lado * meia * 0.7, junta - braco * 1.3],
    ])
    p.poly('objeto', tons[lado < 0 ? 3 : 1], [
      [lado * (ponta - braco * 1.8), alto], [lado * ponta, alto],
      [lado * ponta, junta], [lado * (ponta - braco * 1.8), junta],
    ])
    if (detalhe === 'simples') continue
    p.poly('objeto', tons[lado < 0 ? 4 : 2], [
      [lado * (ponta - braco * 1.8), alto], [lado * (ponta - braco * 1.2), alto],
      [lado * (ponta - braco * 1.2), junta], [lado * (ponta - braco * 1.8), junta],
    ])
  }
  if (detalhe === 'simples') return

  for (const costela of [-0.4, 0.2]) {
    p.poly('objeto', tons[0], [
      [meia * costela - 0.013, -0.95], [meia * costela + 0.013, -0.95],
      [meia * costela + 0.013, -0.07], [meia * costela - 0.013, -0.07],
    ])
  }
}

/** Prédio: bloco com janelas, algumas acesas. */
function predio(p: Pincel<Camada>, variante: number, detalhe: Detalhe) {
  const parede = PAREDES[variante % PAREDES.length]
  const meia = 0.58
  const andares = [4, 5, 3][variante % 3]
  faixa(p, parede, -1, meia * 0.96, 0, meia, [2, 3, 4, 2, 1])
  // Platibanda: a faixa de concreto que fecha o prédio em cima.
  p.poly('objeto', CONCRETO[3], [
    [-meia * 0.96, -1], [meia * 0.96, -1], [meia * 0.97, -0.94], [-meia * 0.97, -0.94],
  ])
  if (detalhe === 'simples') return
  p.poly('objeto', CONCRETO[0], [
    [-meia * 0.97, -0.94], [meia * 0.97, -0.94], [meia * 0.97, -0.915], [-meia * 0.97, -0.915],
  ])
  const colunas = 4
  for (let andar = 0; andar < andares; andar += 1) {
    const cima = -0.86 + (andar / andares) * 0.76
    for (let coluna = 0; coluna < colunas; coluna += 1) {
      const x = (-1 + (2 * coluna + 1) / colunas) * meia * 0.74
      // A janela acesa vem da posição, não de sorteio: o modelo é puro.
      const aceso = (andar * 3 + coluna * 5) % 7 < 2
      const vidro = aceso ? VIDRO_ACESO : VIDRO
      p.poly('objeto', vidro[2], [
        [x - 0.085, cima], [x + 0.085, cima],
        [x + 0.085, cima + 0.115], [x - 0.085, cima + 0.115],
      ])
      p.poly('objeto', vidro[aceso ? 4 : 0], [
        [x - 0.085, cima], [x - 0.03, cima],
        [x - 0.03, cima + 0.115], [x - 0.085, cima + 0.115],
      ])
    }
  }
  // Porta no térreo, para o prédio ter escala humana.
  p.poly('objeto', VIDRO[0], [[-0.09, -0.17], [0.09, -0.17], [0.09, 0], [-0.09, 0]])
}

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------

/** Meia-largura de cada família, em alturas do objeto. */
const MEIA_LARGURA: Record<FamiliaModelada, number> = {
  tree: 0.44,
  bush: 0.78,
  grass: 0.82,
  sign: 0.52,
  marcador: 0.07,
  pneus: 0.52,
  poste: 0.17,
  arquibancada: 1.1,
  bandeira: 0.34,
  pedra: 0.72,
  cacto: 0.42,
  predio: 0.62,
}

const cache = new Map<string, ObjetoModelado>()

/**
 * Molde de um objeto do cenário.
 *
 * Fica em cache pela mesma razão do carro: o assador pede cada combinação uma
 * vez, mas a bancada de desenvolvimento e os testes pedem várias.
 */
export function objetoModelado(
  familia: FamiliaModelada,
  flora: Flora,
  variante: number,
  tom: number,
  detalhe: Detalhe,
): ObjetoModelado {
  const chave = `${familia}|${flora}|${variante}|${tom}|${detalhe}`
  const guardado = cache.get(chave)
  if (guardado) return guardado

  const faces: Face<Camada>[] = []
  const p = pincel<Camada>(faces, [])
  const paleta = VEGETACAO[flora]
  const v = variante % VARIANTES[familia]
  const t = tom % TONS[familia]

  if (familia === 'tree') {
    const copa = paleta.copas[t]
    const casca = paleta.troncos[v]
    if (v === 0) conifera(p, copa, casca, detalhe)
    else frondosa(p, copa, casca, v, detalhe)
  } else if (familia === 'bush') {
    arbusto(p, paleta.arbustos[t], v, detalhe)
  } else if (familia === 'grass') {
    capim(p, paleta.capins[t], v, detalhe)
  } else if (familia === 'sign') {
    placa(p, PLACAS[v], detalhe)
  } else if (familia === 'marcador') {
    marcador(p, v === 1, detalhe)
  } else if (familia === 'pneus') {
    pilhaDePneus(p, v, detalhe)
  } else if (familia === 'poste') {
    posteDeLuz(p, v, detalhe)
  } else if (familia === 'arquibancada') {
    arquibancada(p, v, detalhe)
  } else if (familia === 'bandeira') {
    bandeira(p, v, detalhe)
  } else if (familia === 'pedra') {
    rocha(p, ROCHAS[flora], v, detalhe)
  } else if (familia === 'cacto') {
    cacto(p, CACTOS[t % CACTOS.length], v, detalhe)
  } else {
    predio(p, v, detalhe)
  }

  const modelo: ObjetoModelado = { meiaLargura: MEIA_LARGURA[familia], faces }
  cache.set(chave, modelo)
  return modelo
}
