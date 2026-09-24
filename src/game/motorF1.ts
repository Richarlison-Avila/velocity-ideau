/**
 * Motor de Fórmula 1 por amostras de gravações de verdade.
 *
 * O som do carro saía de três osciladores — uma serra, a oitava abaixo e uma
 * quadrada —, e é isso que continua tocando enquanto as amostras não chegam,
 * ou se elas não chegarem: a corrida nunca espera um arquivo para largar. Com
 * elas, cada carro ganha a voz do motor da época dele: o V6 turbo dos anos
 * oitenta, o V10, o V8 e o V6 turbo híbrido.
 *
 * Cada voz é um punhado de laços de rotação constante, cortados de gravações
 * (ver o README): camadas a plena carga em rotações diferentes e, quando a
 * gravação tem, uma sem carga — o pé fora, com os estalos do escapamento.
 * Cada laço foi reamostrado até o motor girar sempre na mesma rotação, e fecha
 * num múltiplo exato do ciclo de quatro tempos, então pode tocar para sempre
 * sem pulsar.
 *
 * Em cada instante tocam as duas camadas vizinhas da rotação pedida, cada uma
 * acelerada ou retardada até ela e cruzadas com potência constante — a
 * técnica de todo jogo de corrida com motor gravado. A rotação sai do câmbio
 * de cada voz, com o número de marchas e a queda de cada troca da época.
 *
 * A parte pura — vozes, câmbio, rotação, pesos — fica em cima e é testada sem
 * navegador; a de Web Audio, embaixo.
 */
import type { AudioHost, AudioLevels } from './audio'
import type { CarId } from './cars'

// ---------------------------------------------------------------------------
// Vozes
// ---------------------------------------------------------------------------

export type CamadaDoMotor = {
  nome: string
  /** Rotação em que o laço foi gravado. */
  rpm: number
  arquivo: string
}

export type IdDaVoz =
  | 'mercedes-v10'
  | 'honda-v6-turbo'
  | 'tag-v6-turbo'
  | 'renault-v10'
  | 'cosworth-v10'
  | 'ferrari-v8'
  | 'mercedes-v8'
  | 'renault-v8'
  | 'hibrido-v6'

export type EspecificacaoDoMotor = {
  id: IdDaVoz
  /** Como a voz aparece para quem lê: o motor e o carro da gravação. */
  nome: string
  /** Rotação da troca para cima, pouco abaixo do corte. */
  troca: number
  /** Corte de giro: acima disto o motor não vai, nem de boost. */
  corte: number
  /** Na largada a embreagem patina: o motor não cai abaixo disto em primeira. */
  largada: number
  /** Antes da luz apagar, o piloto segura o giro em volta disto. */
  segurando: number
  /**
   * Queda de rotação em cada troca para cima, em fração da rotação da troca,
   * da primeira para a segunda em diante. O número de marchas é um a mais.
   */
  quedas: readonly number[]
  /** As camadas a plena carga, em ordem de rotação. */
  camadas: readonly CamadaDoMotor[]
  /** O motor sem carga, se a gravação tem esse trecho. */
  alivio: CamadaDoMotor | null
}

const PASTA = '/audio/motor/'

function camada(nome: string, rpm: number, arquivo: string): CamadaDoMotor {
  return { nome, rpm, arquivo: PASTA + arquivo }
}

/**
 * Câmbio de corrida tem marchas próximas, e mais próximas quanto mais alta a
 * marcha: da primeira para a segunda o motor cai quase um terço; da última
 * troca, pouco mais de um décimo. É essa escada que o ouvido lê como câmbio de
 * Fórmula 1, e não de carro de rua. Os câmbios manuais dos anos oitenta tinham
 * menos marchas, mais espaçadas; os de hoje, oito.
 */
const QUEDAS_DE_SETE = [0.72, 0.78, 0.82, 0.855, 0.88, 0.861]
const QUEDAS_DE_SEIS = [0.68, 0.74, 0.79, 0.83, 0.86]
const QUEDAS_DE_SEIS_JUNTAS = [0.74, 0.78, 0.82, 0.855, 0.88]
const QUEDAS_DE_CINCO = [0.72, 0.76, 0.81, 0.85]
const QUEDAS_V8 = [0.75, 0.78, 0.82, 0.855, 0.88, 0.9]
const QUEDAS_DE_OITO = [0.7, 0.76, 0.8, 0.84, 0.865, 0.885, 0.9]

/**
 * As vozes do motor, uma por família de carro da garagem.
 *
 * As rotações das camadas saem da medição de cada gravação; as de troca, corte
 * e largada foram postas para a camada que domina o som nunca ser esticada
 * mais de um quinto — a gravação esticada demais vira desenho animado —, e a
 * primeira troca nunca derruba o motor abaixo do giro da largada.
 */
export const VOZES: Record<IdDaVoz, EspecificacaoDoMotor> = {
  'mercedes-v10': {
    id: 'mercedes-v10',
    nome: 'Mercedes V10 — McLaren MP4-16 (2001)',
    troca: 18_300,
    corte: 18_600,
    largada: 11_000,
    segurando: 10_500,
    quedas: QUEDAS_DE_SETE,
    camadas: [
      camada('baixa', 10_500, 'v10-baixa.wav'),
      camada('media', 13_500, 'v10-media.wav'),
      camada('alta', 16_300, 'v10-alta.wav'),
      camada('grito', 18_400, 'v10-grito.wav'),
    ],
    alivio: camada('alivio', 14_000, 'v10-alivio.wav'),
  },
  'honda-v6-turbo': {
    id: 'honda-v6-turbo',
    nome: 'Honda V6 turbo — McLaren MP4/4 (1988)',
    troca: 12_500,
    corte: 12_800,
    largada: 8_000,
    segurando: 8_500,
    quedas: QUEDAS_DE_SEIS,
    camadas: [
      camada('baixa', 8_150, 'honda-v6-turbo-baixa.wav'),
      camada('media', 10_100, 'honda-v6-turbo-media.wav'),
      camada('alta', 12_650, 'honda-v6-turbo-alta.wav'),
    ],
    alivio: null,
  },
  'tag-v6-turbo': {
    id: 'tag-v6-turbo',
    nome: 'TAG-Porsche V6 turbo — McLaren MP4/2C (1986)',
    troca: 11_400,
    corte: 11_600,
    largada: 8_000,
    segurando: 8_500,
    quedas: QUEDAS_DE_CINCO,
    camadas: [camada('media', 9_700, 'tag-v6-turbo-media.wav')],
    alivio: null,
  },
  'renault-v10': {
    id: 'renault-v10',
    nome: 'Renault V10 — Williams FW18 (1996)',
    troca: 16_600,
    corte: 16_900,
    largada: 12_000,
    segurando: 12_500,
    quedas: QUEDAS_DE_SEIS_JUNTAS,
    camadas: [camada('media', 14_700, 'renault-v10-media.wav'), camada('alta', 16_450, 'renault-v10-alta.wav')],
    alivio: null,
  },
  'cosworth-v10': {
    id: 'cosworth-v10',
    nome: 'Cosworth V10 — Red Bull RB1 (2005)',
    troca: 17_900,
    corte: 18_200,
    largada: 11_000,
    segurando: 12_000,
    quedas: QUEDAS_DE_SETE,
    camadas: [camada('baixa', 12_050, 'cosworth-v10-baixa.wav'), camada('alta', 15_200, 'cosworth-v10-alta.wav')],
    alivio: null,
  },
  'ferrari-v8': {
    id: 'ferrari-v8',
    nome: 'Ferrari V8 — Ferrari F60 (2009)',
    troca: 17_800,
    corte: 18_000,
    largada: 11_500,
    segurando: 12_000,
    quedas: QUEDAS_V8,
    camadas: [camada('media', 13_850, 'ferrari-v8-media.wav'), camada('alta', 15_900, 'ferrari-v8-alta.wav')],
    alivio: null,
  },
  'mercedes-v8': {
    id: 'mercedes-v8',
    nome: 'Mercedes V8 — Brawn BGP 001 (2009)',
    troca: 17_800,
    corte: 18_000,
    largada: 13_300,
    segurando: 14_000,
    quedas: QUEDAS_V8,
    camadas: [camada('alta', 16_400, 'mercedes-v8-alta.wav'), camada('grito', 17_200, 'mercedes-v8-grito.wav')],
    alivio: camada('alivio', 12_900, 'mercedes-v8-alivio.wav'),
  },
  'renault-v8': {
    id: 'renault-v8',
    nome: 'Renault V8 — Red Bull RB5 (2009) e RB8 (2012)',
    troca: 17_800,
    corte: 18_000,
    largada: 10_500,
    segurando: 11_000,
    quedas: QUEDAS_V8,
    camadas: [
      camada('baixa', 11_500, 'renault-v8-baixa.wav'),
      camada('media', 14_500, 'renault-v8-media.wav'),
      camada('alta', 15_550, 'renault-v8-alta.wav'),
    ],
    alivio: null,
  },
  'hibrido-v6': {
    id: 'hibrido-v6',
    nome: 'V6 turbo híbrido (2024)',
    troca: 14_600,
    corte: 15_000,
    largada: 9_500,
    segurando: 10_000,
    quedas: QUEDAS_DE_OITO,
    camadas: [
      camada('baixa', 10_200, 'hibrido-v6-baixa.wav'),
      camada('media', 12_600, 'hibrido-v6-media.wav'),
      camada('alta', 14_350, 'hibrido-v6-alta.wav'),
    ],
    alivio: null,
  },
}

/** A voz padrão: o V10 da primeira gravação, o de quem ainda não escolheu. */
export const MOTOR_PADRAO = VOZES['mercedes-v10']

/**
 * O motor de cada carro da garagem, pela época e pela fábrica da pintura.
 *
 * Quando a gravação da fábrica certa não existe, entra a da mesma época: a
 * Lotus de 1985 ganha o V6 turbo TAG de 1986, e as duas Ferrari de V10, o
 * Mercedes de 2001 e o Cosworth de 2005 — uma cada, para as duas não soarem
 * iguais. Toda a era híbrida divide a mesma voz.
 */
const VOZ_DO_CARRO: Record<CarId, IdDaVoz> = {
  'senna-lotus': 'tag-v6-turbo',
  senna: 'honda-v6-turbo',
  'barrichello-ferrari': 'cosworth-v10',
  schumacher: 'mercedes-v10',
  'barrichello-brawn': 'mercedes-v8',
  'massa-ferrari': 'ferrari-v8',
  'massa-williams': 'hibrido-v6',
  'hamilton-mercedes': 'hibrido-v6',
  verstappen: 'hibrido-v6',
  'hamilton-ferrari': 'hibrido-v6',
  'bortoleto-audi': 'hibrido-v6',
  vettel: 'renault-v8',
  'raikkonen-mercedes': 'hibrido-v6',
  leclerc: 'hibrido-v6',
  'alonso-aston-martin': 'hibrido-v6',
  'alonso-renault': 'renault-v10',
}

/** A voz do motor de um carro; o desconhecido anda com a padrão. */
export function vozDoCarro(id: CarId | null | undefined): EspecificacaoDoMotor {
  const voz = id ? VOZ_DO_CARRO[id] : undefined
  return voz ? VOZES[voz] : MOTOR_PADRAO
}

// ---------------------------------------------------------------------------
// Câmbio e rotação
// ---------------------------------------------------------------------------

function limitar(valor: number, min: number, max: number) {
  return Math.max(min, Math.min(max, valor))
}

const marchasCalculadas = new Map<IdDaVoz, readonly number[]>()

/**
 * Rotação por unidade de velocidade em cada marcha de uma voz.
 *
 * A velocidade é a fração da de boost, a mesma de `feel`. A última marcha leva
 * o carro à rotação da troca no topo do boost, e as outras saem das quedas, de
 * cima para baixo. Com elas, o cruzeiro — perto de 0,8 — cai na penúltima,
 * a uns nove décimos da troca: o grito de uma reta, e não o ronco de volta de
 * apresentação.
 */
export function marchasDoMotor(voz: EspecificacaoDoMotor = MOTOR_PADRAO): readonly number[] {
  const guardadas = marchasCalculadas.get(voz.id)
  if (guardadas) return guardadas
  const marchas = [voz.troca]
  for (let i = voz.quedas.length - 1; i >= 0; i -= 1) marchas.unshift(marchas[0] / voz.quedas[i])
  marchasCalculadas.set(voz.id, marchas)
  return marchas
}

/** Velocidade em que cada marcha, exceto a última, troca para a seguinte. */
export function trocasDoMotor(voz: EspecificacaoDoMotor = MOTOR_PADRAO): readonly number[] {
  return marchasDoMotor(voz).slice(0, -1).map((k) => voz.troca / k)
}

/**
 * Folga para descer uma marcha, em fração da velocidade.
 *
 * Sem ela, um carro que anda justo na velocidade de uma troca — na grama, ou
 * encostado num obstáculo — sobe e desce de marcha a cada quadro, e o motor
 * gagueja.
 */
export const HISTERESE = 0.015

export type EstadoDoMotor = {
  /** Índice da marcha, de 0 (primeira) em diante. */
  marcha: number
  rpm: number
}

/**
 * Marcha e rotação para uma velocidade, lembrando a marcha anterior.
 *
 * Sobe de marcha na velocidade da troca e só desce um pouco abaixo dela. Em
 * primeira, a embreagem segura a rotação da largada até o carro alcançá-la.
 */
export function rotacaoF1(velocidade: number, marchaAnterior = 0, voz: EspecificacaoDoMotor = MOTOR_PADRAO): EstadoDoMotor {
  const marchas = marchasDoMotor(voz)
  const trocas = trocasDoMotor(voz)
  const v = Number.isFinite(velocidade) ? limitar(velocidade, 0, 1.2) : 0
  let marcha = Number.isInteger(marchaAnterior) ? limitar(marchaAnterior, 0, marchas.length - 1) : 0
  while (marcha < trocas.length && v >= trocas[marcha]) marcha += 1
  while (marcha > 0 && v < trocas[marcha - 1] - HISTERESE) marcha -= 1
  let rpm = v * marchas[marcha]
  if (marcha === 0) rpm = Math.max(voz.largada, rpm)
  return { marcha, rpm: Math.min(voz.corte, rpm) }
}

// A voz padrão, pelos nomes de sempre.
export const RPM_DA_TROCA = MOTOR_PADRAO.troca
export const RPM_DO_CORTE = MOTOR_PADRAO.corte
export const RPM_DA_LARGADA = MOTOR_PADRAO.largada
export const RPM_SEGURANDO = MOTOR_PADRAO.segurando
export const MARCHAS = marchasDoMotor(MOTOR_PADRAO)
export const TROCAS = trocasDoMotor(MOTOR_PADRAO)
export const CAMADAS_CHEIAS = MOTOR_PADRAO.camadas
export const CAMADA_DO_ALIVIO = MOTOR_PADRAO.alivio!

/** Todas as camadas de uma voz, na ordem em que a mistura as pesa: as cheias e o alívio. */
export function camadasDaVoz(voz: EspecificacaoDoMotor = MOTOR_PADRAO): readonly CamadaDoMotor[] {
  return voz.alivio ? [...voz.camadas, voz.alivio] : voz.camadas
}

export const CAMADAS = camadasDaVoz(MOTOR_PADRAO)

// ---------------------------------------------------------------------------
// Mistura
// ---------------------------------------------------------------------------

/**
 * Peso de cada camada para uma rotação e uma carga.
 *
 * A plena carga, tocam as duas camadas vizinhas da rotação, cruzadas com
 * potência constante: no meio do caminho entre duas, cada uma entra com
 * 0,71, e a soma de energia é sempre a mesma. O caminho é medido em escala
 * logarítmica, que é como o ouvido mede altura: no meio dele, as duas camadas
 * estão esticadas por igual, uma para cima e a outra para baixo, e nenhuma
 * passa da raiz da distância entre elas. Abaixo da primeira e acima da
 * última, toca só a da ponta, esticada até a rotação. `carga` de 0 a 1 passa
 * a mistura para o laço sem carga, também com potência constante; a voz que
 * não tem esse laço segue nas cheias, e quem abaixa o volume é o motor.
 *
 * Devolve um peso por camada de `camadasDaVoz`, na mesma ordem.
 */
export function pesosDasCamadas(rpm: number, carga = 1, voz: EspecificacaoDoMotor = MOTOR_PADRAO): number[] {
  const r = Number.isFinite(rpm) ? rpm : voz.segurando
  const c = Number.isFinite(carga) ? limitar(carga, 0, 1) : 1
  const cheias = voz.camadas
  const pesos = camadasDaVoz(voz).map(() => 0)
  if (r <= cheias[0].rpm) {
    pesos[0] = 1
  } else if (r >= cheias[cheias.length - 1].rpm) {
    pesos[cheias.length - 1] = 1
  } else {
    let i = 0
    while (r > cheias[i + 1].rpm) i += 1
    const t = Math.log(r / cheias[i].rpm) / Math.log(cheias[i + 1].rpm / cheias[i].rpm)
    pesos[i] = Math.cos((t * Math.PI) / 2)
    pesos[i + 1] = Math.sin((t * Math.PI) / 2)
  }
  if (!voz.alivio) return pesos
  const cheia = Math.sin((c * Math.PI) / 2)
  for (let i = 0; i < cheias.length; i += 1) pesos[i] *= cheia
  pesos[pesos.length - 1] = Math.cos((c * Math.PI) / 2)
  return pesos
}

/**
 * Velocidade de leitura de uma camada para soar numa rotação.
 *
 * Limitada a meia oitava para cada lado: além disso a gravação vira desenho
 * animado. As camadas estão perto o bastante umas das outras para isso nunca
 * acontecer dentro da faixa do motor.
 */
export function taxaDaCamada(camada: CamadaDoMotor, rpm: number) {
  return limitar(rpm / camada.rpm, 0.7, 1.42)
}

/**
 * Ganho que casa o volume das amostras com o dos osciladores.
 *
 * Medido numa corrida renderizada fora de tempo real, com vento e rolamento
 * iguais nas duas: sem ele, o V10 gravado saía sete decibéis abaixo da serra
 * dos osciladores, e trocar de um para o outro no meio da contagem soava como
 * o carro se afastando. Todas as camadas foram gravadas no mesmo volume
 * eficaz, então o ganho vale para todas as vozes.
 */
const GANHO_DAS_AMOSTRAS = 2.1

/**
 * Volume do motor para o estado da corrida.
 *
 * Sobe com a rotação e com o boost, como o dos osciladores. Antes da largada e
 * depois da bandeirada o carro está parado, com o giro segurado, e o motor
 * fica mais baixo para deixar ouvir as luzes.
 */
export function volumeDoMotor(levels: AudioLevels, rpm: number, voz: EspecificacaoDoMotor = MOTOR_PADRAO) {
  const giro = limitar((rpm - voz.segurando) / (voz.corte - voz.segurando), 0, 1)
  if (!levels.running) return 0.55 * GANHO_DAS_AMOSTRAS
  return (0.8 + giro * 0.35 + limitar(levels.boost, 0, 1) * 0.2) * GANHO_DAS_AMOSTRAS
}

// ---------------------------------------------------------------------------
// Ligação com o Web Audio
// ---------------------------------------------------------------------------

/**
 * Laços já decodificados, compartilhados entre corridas.
 *
 * Cada corrida abre um contexto de áudio novo, mas um `AudioBuffer` pode tocar
 * em qualquer contexto: baixar e decodificar uma vez basta para a tarde toda.
 */
const lacos = new Map<string, Promise<AudioBuffer | null>>()

/**
 * Bytes da voz baixados antes da corrida, ainda por decodificar: decodificar
 * pede um contexto de áudio, e o da corrida só nasce na tela da corrida. Até
 * lá, o que dá para adiantar é o download.
 */
const bytesAdiantados = new Map<string, Promise<ArrayBuffer | null>>()

/**
 * Começa a baixar os arquivos da voz — no menu, na garagem, no lobby.
 *
 * A largada da sala é a mesma para todos: sem isso, os seis celulares pedem
 * os mesmos arquivos no mesmo segundo, pelo mesmo Wi-Fi, e a prova larga no
 * sintetizador. Guarda uma voz de cada vez: trocar de carro na garagem
 * descarta o que foi adiantado para a anterior.
 */
export function precarregarVoz(voz: EspecificacaoDoMotor) {
  if (typeof fetch === 'undefined') return
  const arquivos = camadasDaVoz(voz).map((camada) => camada.arquivo)
  for (const arquivo of [...bytesAdiantados.keys()]) {
    if (!arquivos.includes(arquivo)) bytesAdiantados.delete(arquivo)
  }
  for (const arquivo of arquivos) {
    if (lacos.has(arquivo) || bytesAdiantados.has(arquivo)) continue
    const bytes = fetch(arquivo)
      .then((resposta) => (resposta.ok ? resposta.arrayBuffer() : null))
      .catch(() => null)
    bytesAdiantados.set(arquivo, bytes)
  }
}

function laco(ctx: AudioHost, arquivo: string) {
  const guardado = lacos.get(arquivo)
  if (guardado) return guardado
  const decodificar = (ctx as Partial<Pick<AudioContext, 'decodeAudioData'>>).decodeAudioData
  if (typeof fetch === 'undefined' || typeof decodificar !== 'function') return Promise.resolve(null)
  // Os bytes adiantados servem uma vez só: decodificar consome o buffer.
  const adiantado = bytesAdiantados.get(arquivo) ?? Promise.resolve(null)
  bytesAdiantados.delete(arquivo)
  const baixar = () =>
    fetch(arquivo).then((resposta) =>
      resposta.ok ? resposta.arrayBuffer() : Promise.reject(new Error(`${resposta.status}`)),
    )
  const promessa = adiantado
    .then((bytes) => bytes ?? baixar())
    .then((bytes) => decodificar.call(ctx, bytes))
    .catch(() => {
      // Sem a amostra, o sintetizador segue valendo; na próxima corrida tenta de novo.
      lacos.delete(arquivo)
      return null
    })
  lacos.set(arquivo, promessa)
  return promessa
}

/** Constante de tempo das rampas de volume e de rotação. */
const RAMPA = 0.05

/** Desaceleração, em fração da velocidade por segundo, que tira o pé do motor. */
const DESACELERACAO_SEM_CARGA = 0.05

/** Quanto o motor abaixa com o pé fora, na voz que não tem o laço sem carga. */
const PE_FORA_SEM_LACO = 0.45

export class MotorF1 {
  private readonly saida: GainNode
  private readonly fontes: AudioBufferSourceNode[] = []
  private readonly ganhos: GainNode[] = []
  private readonly camadas: readonly CamadaDoMotor[]
  private ativo = false
  private encerrado = false
  private marcha = 0
  private carga = 1
  private velocidadeAnterior = 0
  private tempoAnterior: number | null = null
  private oscilacao = 0

  constructor(
    private readonly ctx: AudioHost,
    destino: AudioNode,
    private readonly voz: EspecificacaoDoMotor = MOTOR_PADRAO,
  ) {
    this.camadas = camadasDaVoz(voz)
    this.saida = ctx.createGain()
    this.saida.gain.setValueAtTime(0, ctx.currentTime)
    this.saida.connect(destino)
    void this.carregar()
  }

  /** Verdadeiro depois que todas as camadas da voz chegaram e estão tocando. */
  get pronto() {
    return this.ativo
  }

  private async carregar() {
    const buffers = await Promise.all(this.camadas.map((camada) => laco(this.ctx, camada.arquivo)))
    if (this.encerrado || buffers.some((buffer) => !buffer)) return
    const agora = this.ctx.currentTime
    buffers.forEach((buffer, i) => {
      const fonte = this.ctx.createBufferSource()
      fonte.buffer = buffer
      fonte.loop = true
      const ganho = this.ctx.createGain()
      ganho.gain.setValueAtTime(0, agora)
      fonte.connect(ganho).connect(this.saida)
      // Cada laço começa num ponto diferente: se as voltas coincidissem, a
      // emenda de todas cairia no mesmo instante.
      fonte.start(agora, (buffer!.duration * (i + 1)) / (this.camadas.length + 1))
      this.fontes.push(fonte)
      this.ganhos.push(ganho)
    })
    this.ativo = true
  }

  /**
   * Atualiza rotação e mistura. Devolve verdadeiro quando as amostras estão
   * tocando — é a deixa para o sintetizador se calar.
   */
  update(levels: AudioLevels): boolean {
    if (this.encerrado || !this.ativo) return false
    const agora = this.ctx.currentTime
    const dt = this.tempoAnterior === null ? 0 : Math.max(0, agora - this.tempoAnterior)
    this.tempoAnterior = agora

    let estado: EstadoDoMotor
    if (levels.running) {
      estado = rotacaoF1(levels.speed, this.marcha, this.voz)
    } else {
      // Parado no grid, o piloto brinca com o acelerador em volta do giro da
      // largada: uma onda lenta, para o motor não soar como gravação em laço.
      this.oscilacao += dt
      const brinca = Math.sin(this.oscilacao * 2.3) * 0.5 + Math.sin(this.oscilacao * 5.1) * 0.25
      estado = { marcha: 0, rpm: this.voz.segurando + brinca * 900 }
    }
    const trocouParaCima = estado.marcha > this.marcha
    this.marcha = estado.marcha

    // Pé fora quando o carro perde velocidade: batida, grama, reset.
    const desacelerando = dt > 0 && (levels.speed - this.velocidadeAnterior) / dt < -DESACELERACAO_SEM_CARGA
    this.velocidadeAnterior = levels.speed
    const cargaAlvo = levels.running && desacelerando ? 0 : 1
    const tempo = cargaAlvo < this.carga ? 0.06 : 0.22
    this.carga += (cargaAlvo - this.carga) * (1 - Math.exp(-dt / tempo))

    const pesos = pesosDasCamadas(estado.rpm, this.carga, this.voz)
    const peFora = this.voz.alivio ? 1 : 1 - PE_FORA_SEM_LACO * (1 - this.carga)
    const volume = volumeDoMotor(levels, estado.rpm, this.voz) * peFora
    this.camadas.forEach((camada, i) => {
      this.fontes[i].playbackRate.setTargetAtTime(taxaDaCamada(camada, estado.rpm), agora, RAMPA * 0.4)
      this.ganhos[i].gain.setTargetAtTime(pesos[i], agora, RAMPA)
    })
    // Na troca para cima a ignição corta por um instante: o soluço que marca
    // cada marcha.
    if (trocouParaCima) {
      this.saida.gain.cancelScheduledValues(agora)
      this.saida.gain.setTargetAtTime(volume * 0.3, agora, 0.008)
      this.saida.gain.setTargetAtTime(volume, agora + 0.045, 0.02)
    } else {
      this.saida.gain.setTargetAtTime(volume, agora, RAMPA)
    }
    return true
  }

  close() {
    if (this.encerrado) return
    this.encerrado = true
    for (const fonte of this.fontes) {
      try {
        fonte.stop()
      } catch {
        // Já parada.
      }
    }
  }
}
