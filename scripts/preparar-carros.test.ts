import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CAR_ART, CARS } from '../src/game/cars.js'

/** Largura, altura e tipo de cor lidos do cabeçalho do PNG, sem decodificar a imagem. */
function cabecalho(id: string) {
  const bytes = readFileSync(resolve('public/carros', `${id}.png`))
  return { largura: bytes.readUInt32BE(16), altura: bytes.readUInt32BE(20), tipoDeCor: bytes[25] }
}

describe('sprites gerados por npm run carros', () => {
  it('todo carro da garagem tem sprite, com fundo transparente', () => {
    // Registrar um carro e esquecer de gerar o sprite deixaria o jogador
    // escolhê-lo na garagem e correr com o desenho provisório.
    for (const car of CARS) {
      // 6 é RGBA: sem canal de opacidade, o fundo preto voltaria à pista.
      expect(cabecalho(car.id).tipoDeCor, car.id).toBe(6)
    }
  })

  it('os sprites guardam a proporção do recorte do molde', () => {
    // A tela converte de volta para as coordenadas da arte pela razão entre
    // os dois; uma proporção diferente desalinharia as rodas recortadas.
    const proporcao = CAR_ART.crop.height / CAR_ART.crop.width
    for (const car of CARS) {
      const { largura, altura } = cabecalho(car.id)
      expect(Math.abs(altura - largura * proporcao), car.id).toBeLessThanOrEqual(1)
    }
  })
})
