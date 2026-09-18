import { describe, expect, it } from 'vitest'
import { CAR_HALF_WIDTH, EmissionRate, MAX_PARTICLES, ParticleField, TRAIL_SETBACK, WHEEL_OFFSET } from './particles'
import { CAR_SCREEN_RATIO, CAR_VIEW_DISTANCE, lateralOffset, roadProjection, VIEW_DISTANCE } from './track'

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
    expect(visiveis[0].ahead).toBe(100)
    expect(visiveis[1].ahead).toBe(50)
  })

  it('a partícula nasce onde o carro aparece na tela', () => {
    // O carro é desenhado perto da base, o que corresponde a uma distância
    // curta à frente da câmera: é dali que a poeira precisa sair.
    expect(CAR_VIEW_DISTANCE).toBeGreaterThan(20)
    expect(CAR_VIEW_DISTANCE).toBeLessThan(60)

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

    // O carro ocupa CAR_HALF_WIDTH pixels para cada lado na escala base.
    expect(deslocamento).toBeGreaterThan(CAR_HALF_WIDTH)
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
})
