import { describe, expect, it } from 'vitest'
import { CAR_ART, CARS, PILOTS, carById, DEFAULT_CAR, isCarId, toCarId } from './cars'

describe('garagem', () => {
  it('cada carro tem um identificador próprio', () => {
    const ids = CARS.map((car) => car.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(isCarId(DEFAULT_CAR)).toBe(true)
  })

  it('o que vem da rede só vira carro se estiver na garagem', () => {
    expect(toCarId('verstappen')).toBe('verstappen')
    // Um id desconhecido viraria um endereço de imagem inexistente na tela do rival.
    expect(toCarId('ferrari-f40')).toBe(DEFAULT_CAR)
    expect(toCarId('../../etc/passwd')).toBe(DEFAULT_CAR)
    expect(toCarId(undefined)).toBe(DEFAULT_CAR)
    expect(toCarId(null)).toBe(DEFAULT_CAR)
    expect(toCarId(12)).toBe(DEFAULT_CAR)
    // Nem herança de objeto passa por carro.
    expect(toCarId('toString')).toBe(DEFAULT_CAR)
  })

  it('a ficha de cada carro está completa', () => {
    for (const car of CARS) {
      expect(carById(car.id)).toBe(car)
      expect(car.driver).toContain(' ')
      expect(car.code).toMatch(/^[A-Z]{3}$/)
      expect(car.accent).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('mostra cada piloto uma vez e agrupa suas pinturas', () => {
    expect(new Set(PILOTS.map((pilot) => pilot.driver)).size).toBe(PILOTS.length)
    expect(PILOTS.flatMap((pilot) => pilot.cars)).toHaveLength(CARS.length)
    expect(PILOTS.find((pilot) => pilot.driver === 'Ayrton Senna')?.cars.map((car) => car.team)).toEqual([
      'Lotus',
      'McLaren',
    ])
    expect(PILOTS.find((pilot) => pilot.driver === 'Fernando Alonso')?.cars.map((car) => car.team)).toEqual([
      'Aston Martin',
      'Renault',
    ])
  })
})

describe('molde das artes', () => {
  it('é simétrico e cabe no recorte', () => {
    const { crop, centerX, groundY, tyreSpan, frontWheel, rearLight } = CAR_ART
    // O recorte é centrado no eixo do carro, senão a pintura sairia deslocada
    // da posição que a física usa.
    expect(crop.x + crop.width / 2).toBe(centerX)
    expect(centerX - tyreSpan / 2).toBeGreaterThanOrEqual(crop.x)
    expect(centerX + tyreSpan / 2).toBeLessThanOrEqual(crop.x + crop.width)
    expect(groundY).toBeLessThan(crop.y + crop.height)

    // As duas rodas dianteiras ficam dentro do recorte e sem se tocar.
    const espelho = 2 * centerX - frontWheel.x - frontWheel.width
    expect(frontWheel.x).toBeGreaterThanOrEqual(crop.x)
    expect(frontWheel.y).toBeGreaterThanOrEqual(crop.y)
    expect(espelho + frontWheel.width).toBeLessThanOrEqual(crop.x + crop.width)
    expect(frontWheel.x + frontWheel.width).toBeLessThan(espelho)

    expect(rearLight.x).toBe(centerX)
    expect(rearLight.y).toBeLessThan(groundY)
  })
})
