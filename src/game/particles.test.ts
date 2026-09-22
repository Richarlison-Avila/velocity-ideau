import { describe, expect, it } from 'vitest'
import { EmissionRate, MAX_PARTICLES, ParticleField, TRAIL_SETBACK, WHEEL_OFFSET } from './particles'
import {
  CAR_SCREEN_RATIO,
  CAR_SPRITE_HALF_WIDTH,
  CAR_VIEW_DISTANCE,
  lateralOffset,
  roadProjection,
  VIEW_DISTANCE,
} from './track'

describe('efeitos da pista', () => {
  it('guarda a partícula na distância onde nasceu', () => {
    const campo = new ParticleField()
    campo.spawn('dust', 500, -0.9)
    expect(campo.count).toBe(1)
    expect(campo.all[0]).toMatchObject({ kind: 'dust', distance: 500, lateral: -0.9 })
  })

  it('envelhece e descarta as partículas mortas', () => {
    const campo = new ParticleField()
    campo.spawn('spark', 500, 0, { life: 0.2 })
    campo.update(0.1, 400)
    expect(campo.count).toBe(1)
    campo.update(0.2, 400)
    expect(campo.count).toBe(0)
  })

  it('descarta o que já passou pela câmera', () => {
    const campo = new ParticleField()
    campo.spawn('skid', 500, 0)
    campo.update(0.016, 520)
    expect(campo.count).toBe(0)
  })

  it('aplica o deslocamento lateral ao longo do tempo', () => {
    const campo = new ParticleField()
    campo.spawn('dust', 500, 0, { drift: 0.5, life: 5 })
    campo.update(1, 400)
    expect(campo.all[0].lateral).toBeCloseTo(0.5, 5)
  })

  it('respeita o teto de partículas simultâneas', () => {
    const campo = new ParticleField()
    for (let index = 0; index < MAX_PARTICLES * 3; index += 1) campo.spawn('dust', 1_000 + index, 0)
    expect(campo.count).toBe(MAX_PARTICLES)
    // As mais antigas são as descartadas.
    expect(campo.all[0].distance).toBeGreaterThan(1_000)
  })

  it('cada tipo nasce com a cor dele, e quem emite pode trocar', () => {
    // A poeira da grama sai da cor do chão de cada lugar: a troca é o caminho
    // normal, não um caso raro.
    const campo = new ParticleField()
    campo.spawn('dust', 500, 0)
    campo.spawn('spark', 500, 0)
    campo.spawn('dust', 500, 0, { tint: '#123456' })
    const [poeira, faisca, trocada] = campo.all
    expect(poeira.tint).not.toBe(faisca.tint)
    expect(trocada.tint).toBe('#123456')
  })

  it('as faíscas giram para os dois lados, na mesma medida em que se espalham', () => {
    const campo = new ParticleField()
    campo.burst('spark', 7, 500, 0)
    const giros = campo.all.map((particle) => particle.spin)
    expect(giros[0]).toBeLessThan(0)
    expect(giros[giros.length - 1]).toBeGreaterThan(0)
    expect(giros[0]).toBeCloseTo(-giros[giros.length - 1], 6)
  })

  it('espalha a explosão de faíscas para os dois lados', () => {
    const campo = new ParticleField()
    campo.burst('spark', 8, 500, 0, { drift: 1 })
    const desvios = campo.all.map((particle) => particle.drift)
    expect(Math.min(...desvios)).toBeLessThan(0)
    expect(Math.max(...desvios)).toBeGreaterThan(0)
    expect(campo.count).toBe(8)
  })

  it('mostra só o que está no campo de visão, do fundo para a frente', () => {
    const campo = new ParticleField()
    campo.spawn('dust', 500, 0) // 100 m à frente
    campo.spawn('dust', 450, 0) // 50 m à frente
    campo.spawn('dust', 400 + VIEW_DISTANCE + 50, 0) // longe demais

    const visiveis = campo.visible(400)
    expect(visiveis).toHaveLength(2)
    expect(visiveis[0].distance - 400).toBe(100)
    expect(visiveis[1].distance - 400).toBe(50)
  })

  it('a listagem reaproveita o mesmo vetor entre quadros', () => {
    const campo = new ParticleField()
    campo.spawn('dust', 500, 0)
    // O mesmo vetor volta a cada chamada: nada é alocado no laço de render.
    expect(campo.visible(400)).toBe(campo.visible(400))
  })

  it('a partícula nasce onde o carro aparece na tela', () => {
    // O carro é desenhado perto da base, o que corresponde a uma distância
    // curta à frente da câmera: é dali que a poeira precisa sair.
    // Derivado da janela, e não um número fixo: o carro fica perto da base
    // da tela, o que corresponde a uma fração curta do campo de visão.
    expect(CAR_VIEW_DISTANCE).toBeGreaterThan(0)
    expect(CAR_VIEW_DISTANCE).toBeLessThan(VIEW_DISTANCE * 0.15)

    const campo = new ParticleField()
    campo.spawn('dust', 1_000 + CAR_VIEW_DISTANCE, 0)
    expect(campo.visible(1_000)).toHaveLength(1)
  })

  it('a distância do carro corresponde ao ponto onde ele é desenhado', () => {
    const altura = 900
    const projetado = roadProjection(CAR_VIEW_DISTANCE, 1_600, altura)
    expect(projetado.y).toBeCloseTo(altura * CAR_SCREEN_RATIO, 6)
  })

  it('o efeito nasce fora da silhueta do carro, senão fica escondido', () => {
    const largura = 800
    const { roadWidth } = roadProjection(CAR_VIEW_DISTANCE - TRAIL_SETBACK, largura, 450)
    const deslocamento = Math.abs(lateralOffset(WHEEL_OFFSET, roadWidth))

    // O carro ocupa meia largura de sprite para cada lado na escala base. A
    // medida vem de track.ts, que é quem define a geometria: uma cópia aqui
    // divergiria em silêncio no dia em que o desenho do carro mudasse.
    expect(deslocamento).toBeGreaterThan(CAR_SPRITE_HALF_WIDTH)
    // E não tanto a ponto de a poeira sair do asfalto.
    expect(deslocamento).toBeLessThan(roadWidth / 2)
  })

  it('o efeito nasce atrás do carro, não na frente do bico', () => {
    const altura = 450
    const carro = roadProjection(CAR_VIEW_DISTANCE, 800, altura).y
    const rastro = roadProjection(CAR_VIEW_DISTANCE - TRAIL_SETBACK, 800, altura).y
    // Mais perto da câmera significa mais para baixo na tela.
    expect(rastro).toBeGreaterThan(carro)
  })

  it('limpa tudo entre uma corrida e outra', () => {
    const campo = new ParticleField()
    campo.burst('spark', 10, 500, 0)
    campo.clear()
    expect(campo.count).toBe(0)
  })
})

describe('cadência de emissão', () => {
  it('não depende da taxa de quadros', () => {
    const rapido = new EmissionRate(30)
    let comSessenta = 0
    for (let quadro = 0; quadro < 60; quadro += 1) comSessenta += rapido.take(1 / 60, true)

    const lento = new EmissionRate(30)
    let comTrinta = 0
    for (let quadro = 0; quadro < 30; quadro += 1) comTrinta += lento.take(1 / 30, true)

    expect(comSessenta).toBe(30)
    expect(comTrinta).toBe(30)
  })

  it('não emite nada enquanto o efeito está desligado', () => {
    const cadencia = new EmissionRate(30)
    let total = 0
    for (let quadro = 0; quadro < 60; quadro += 1) total += cadencia.take(1 / 60, false)
    expect(total).toBe(0)
  })

  it('não acumula um estouro ao religar', () => {
    const cadencia = new EmissionRate(30)
    for (let quadro = 0; quadro < 60; quadro += 1) cadencia.take(1 / 60, false)
    expect(cadencia.take(1 / 60, true)).toBe(0)
  })

  it('a intensidade escala a quantidade de forma contínua', () => {
    const contar = (intensidade: number) => {
      const cadencia = new EmissionRate(40)
      let total = 0
      for (let quadro = 0; quadro < 60; quadro += 1) total += cadencia.take(1 / 60, true, intensidade)
      return total
    }

    // O acumulador trabalha com frações, então há um de folga no arredondamento.
    expect(contar(1)).toBeGreaterThanOrEqual(39)
    expect(contar(1)).toBeLessThanOrEqual(40)
    expect(contar(0.5)).toBeGreaterThanOrEqual(19)
    expect(contar(0.5)).toBeLessThanOrEqual(20)
    expect(contar(0.25)).toBeGreaterThanOrEqual(9)
    expect(contar(0.25)).toBeLessThanOrEqual(10)
  })

  it('intensidade zero não emite nada, mesmo ligada', () => {
    const cadencia = new EmissionRate(40)
    let total = 0
    for (let quadro = 0; quadro < 60; quadro += 1) total += cadencia.take(1 / 60, true, 0)
    expect(total).toBe(0)
  })
})
