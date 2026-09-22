import { describe, expect, it } from 'vitest'
import { CARS, carById, DEFAULT_CAR, isCarId, toCarId } from './cars'

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
})
