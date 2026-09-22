import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { PILOTS, carById, type CarId } from './game/cars'
import { carImageUrl } from './game/carSprites'

type PilotSelectProps = {
  /** Carro com que o piloto chegou à garagem. */
  selected: CarId
  /** Carros dos rivais, marcados na grade quando a escolha é feita na sala. */
  rivalCars?: CarId[]
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
function PilotSelect({ selected, rivalCars = [], backLabel, onConfirm, onBack }: PilotSelectProps) {
  const [preview, setPreview] = useState<CarId>(selected)
  const cartoes = useRef(new Map<string, HTMLButtonElement>())
  const pinturasPorPiloto = useRef(new Map([[carById(selected).driver, selected]]))
  const previewRef = useRef(preview)
  previewRef.current = preview

  const car = carById(preview)
  const indice = PILOTS.findIndex((item) => item.driver === car.driver)
  const pilot = PILOTS[indice]
  const [nome, sobrenome] = separarNome(car.driver)

  const selecionarPintura = useCallback((next: CarId) => {
    pinturasPorPiloto.current.set(carById(next).driver, next)
    setPreview(next)
  }, [])

  /**
   * Anda pela grade em círculo. Se o foco estava num cartão, ele acompanha,
   * como pede um grupo de opções operado pelo teclado.
   */
  const andar = useCallback((passo: number) => {
    const atual = PILOTS.findIndex((item) => item.driver === carById(previewRef.current).driver)
    const proximoPiloto = PILOTS[(atual + passo + PILOTS.length) % PILOTS.length]
    const proximo = pinturasPorPiloto.current.get(proximoPiloto.driver) ?? proximoPiloto.cars[0].id
    setPreview(proximo)
    if (document.activeElement instanceof HTMLElement && document.activeElement.classList.contains('garage-card')) {
      cartoes.current.get(proximoPiloto.driver)?.focus()
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
        <div className="garage-header-tools">
          {pilot.cars.length > 1 && (
            <fieldset className="garage-skins">
              <legend>TROCAR EQUIPE</legend>
              <div role="radiogroup" aria-label={`Equipe de ${pilot.driver}`}>
                {pilot.cars.map((skin) => (
                  <button
                    key={skin.id}
                    type="button"
                    role="radio"
                    aria-checked={skin.id === preview}
                    className={skin.id === preview ? 'on' : ''}
                    style={destaque(skin.accent)}
                    onClick={() => selecionarPintura(skin.id)}
                  >
                    <img src={carImageUrl(skin.id)} alt="" />
                    <span><small>EQUIPE</small>{skin.team}</span>
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          <span className="garage-counter">
            {String(indice + 1).padStart(2, '0')} / {String(PILOTS.length).padStart(2, '0')}
          </span>
        </div>
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
        {PILOTS.map((item) => {
          const itemCar = item.driver === car.driver
            ? car
            : carById(pinturasPorPiloto.current.get(item.driver) ?? item.cars[0].id)
          const idsDoPiloto = new Set(item.cars.map((skin) => skin.id))
          const rivaisNesteCarro = rivalCars.filter((rival) => idsDoPiloto.has(rival)).length
          return (
            <button
              key={item.driver}
              ref={(elemento) => {
                if (elemento) cartoes.current.set(item.driver, elemento)
                else cartoes.current.delete(item.driver)
              }}
              type="button"
              role="radio"
              aria-checked={item.driver === car.driver}
              tabIndex={item.driver === car.driver ? 0 : -1}
              className={`garage-card ${item.driver === car.driver ? 'on' : ''}`}
              style={destaque(itemCar.accent)}
              onClick={() => selecionarPintura(itemCar.id)}
              onDoubleClick={() => onConfirm(itemCar.id)}
            >
              <img src={carImageUrl(itemCar.id)} alt="" />
              <span>{item.code} <i>#{itemCar.number}</i></span>
              <strong>{item.driver}</strong>
              {item.cars.length > 1 && <small className="garage-skin-count">{item.cars.length} EQUIPES</small>}
              {rivaisNesteCarro > 0 && (
                <em className="garage-rival">{rivaisNesteCarro === 1 ? 'RIVAL' : `${rivaisNesteCarro} RIVAIS`}</em>
              )}
            </button>
          )
        })}
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
