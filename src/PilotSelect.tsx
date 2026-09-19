import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { CARS, carById, type CarId } from './game/cars'
import { carImageUrl } from './game/carSprites'

type PilotSelectProps = {
  /** Carro com que o piloto chegou à garagem. */
  selected: CarId
  /** Carro do rival, marcado na grade quando a escolha é feita dentro da sala. */
  rivalCar?: CarId | null
  /** O caminho de volta muda com a origem: paddock ou lobby. */
  backLabel: string
  onConfirm: (car: CarId) => void
  onBack: () => void
}

/** A cor de destaque do carro vira variável de CSS para brilhos e bordas. */
const destaque = (accent: string) => ({ '--accent': accent }) as CSSProperties

/** "Ayrton Senna" → ["Ayrton", "Senna"]: o sobrenome é o que ganha destaque. */
function separarNome(nome: string) {
  const espaco = nome.indexOf(' ')
  return espaco < 0 ? ['', nome] : [nome.slice(0, espaco), nome.slice(espaco + 1)]
}

/**
 * Garagem: onde o piloto escolhe com que carro vai correr.
 *
 * A escolha é só visual — todos os carros têm a mesma física — e a tela diz
 * isso com todas as letras, para ninguém achar que perdeu por ter escolhido
 * errado.
 */
function PilotSelect({ selected, rivalCar = null, backLabel, onConfirm, onBack }: PilotSelectProps) {
  const [preview, setPreview] = useState<CarId>(selected)
  const cartoes = useRef(new Map<CarId, HTMLButtonElement>())
  const previewRef = useRef(preview)
  previewRef.current = preview

  const indice = CARS.findIndex((item) => item.id === preview)
  const car = carById(preview)
  const [nome, sobrenome] = separarNome(car.driver)

  /**
   * Anda pela grade em círculo. Se o foco estava num cartão, ele acompanha,
   * como pede um grupo de opções operado pelo teclado.
   */
  const andar = useCallback((passo: number) => {
    const atual = CARS.findIndex((item) => item.id === previewRef.current)
    const proximo = CARS[(atual + passo + CARS.length) % CARS.length].id
    setPreview(proximo)
    if (document.activeElement instanceof HTMLElement && document.activeElement.classList.contains('garage-card')) {
      cartoes.current.get(proximo)?.focus()
    }
  }, [])

  // No celular o cartão do carro fica abaixo da dobra do menu, e a garagem
  // herdaria essa rolagem, abrindo com o título cortado. Entre chaves de
  // propósito: navegadores recentes devolvem uma Promise do `scrollTo`, e o
  // React a tomaria por função de limpeza.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  useEffect(() => {
    const tecla = (event: KeyboardEvent) => {
      if (event.code === 'ArrowLeft' || event.code === 'KeyA') {
        event.preventDefault()
        andar(-1)
      } else if (event.code === 'ArrowRight' || event.code === 'KeyD') {
        event.preventDefault()
        andar(1)
      } else if (event.code === 'Escape') {
        onBack()
      } else if ((event.code === 'Enter' || event.code === 'NumpadEnter') && !(event.target instanceof HTMLButtonElement)) {
        // Num botão focado o Enter já vira clique; tratar aqui confirmaria duas vezes.
        onConfirm(previewRef.current)
      }
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [andar, onBack, onConfirm])

  return (
    <main className="screen garage-screen" style={destaque(car.accent)}>
      <div className="ambient-grid" />

      <header className="garage-header">
        <div>
          <p className="eyebrow">GRID DE PILOTOS</p>
          <h1>ESCOLHA SEU <em>PILOTO.</em></h1>
        </div>
        <span className="garage-counter">
          {String(indice + 1).padStart(2, '0')} / {String(CARS.length).padStart(2, '0')}
        </span>
      </header>

      <section className="garage-stage" aria-label="Carro em destaque">
        <span className="garage-number" aria-hidden="true">{car.number}</span>
        <button type="button" className="garage-arrow" onClick={() => andar(-1)} aria-label="Piloto anterior">‹</button>
        {/* A chave troca junto com o carro para a entrada animar a cada escolha. */}
        <figure className="garage-car" key={car.id}>
          <img src={carImageUrl(car.id)} alt={`Carro de ${car.driver}, ${car.team} número ${car.number}`} />
        </figure>
        <button type="button" className="garage-arrow" onClick={() => andar(1)} aria-label="Próximo piloto">›</button>

        <div className="garage-info" key={`ficha-${car.id}`} aria-live="polite">
          <span className="garage-team">{car.team}</span>
          <h2>{nome}<b>{sobrenome}</b></h2>
          <dl>
            <div><dt>NÚMERO</dt><dd>#{car.number}</dd></div>
            <div><dt>SIGLA</dt><dd>{car.code}</dd></div>
            <div><dt>PAÍS</dt><dd>{car.country}</dd></div>
          </dl>
          <p className="garage-note">Mesmo desempenho em todos os carros: quem decide a corrida é o piloto.</p>
        </div>
      </section>

      <div className="garage-grid" role="radiogroup" aria-label="Pilotos">
        {CARS.map((item) => (
          <button
            key={item.id}
            ref={(elemento) => {
              if (elemento) cartoes.current.set(item.id, elemento)
              else cartoes.current.delete(item.id)
            }}
            type="button"
            role="radio"
            aria-checked={item.id === preview}
            tabIndex={item.id === preview ? 0 : -1}
            className={`garage-card ${item.id === preview ? 'on' : ''}`}
            style={destaque(item.accent)}
            onClick={() => setPreview(item.id)}
            onDoubleClick={() => onConfirm(item.id)}
          >
            <img src={carImageUrl(item.id)} alt="" />
            <span>{item.code} <i>#{item.number}</i></span>
            <strong>{item.team}</strong>
            {rivalCar === item.id && <em className="garage-rival">RIVAL</em>}
          </button>
        ))}
      </div>

      <footer className="garage-actions">
        <button type="button" className="text-button" onClick={onBack}>{backLabel}</button>
        <button type="button" className="primary-button" onClick={() => onConfirm(preview)}>
          CORRER COM {sobrenome.toUpperCase()} <span>↗</span>
        </button>
      </footer>
    </main>
  )
}

export default PilotSelect
