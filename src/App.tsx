import { useCallback, useState } from 'react'
import RaceCanvas, { type RaceResult } from './game/RaceCanvas'
import { formatTime } from './game/track'

type Screen = 'menu' | 'race' | 'result'

function App() {
  const [screen, setScreen] = useState<Screen>('menu')
  const [pilotName, setPilotName] = useState('Piloto')
  const [draftName, setDraftName] = useState('')
  const [raceKey, setRaceKey] = useState(0)
  const [result, setResult] = useState<RaceResult | null>(null)

  const startRace = () => {
    const cleanName = draftName.trim().slice(0, 16)
    if (cleanName) setPilotName(cleanName)
    setResult(null)
    setRaceKey((value) => value + 1)
    setScreen('race')
  }

  const finishRace = useCallback((raceResult: RaceResult) => {
    setResult(raceResult)
    setScreen('result')
  }, [])

  if (screen === 'race') {
    return <RaceCanvas key={raceKey} pilotName={pilotName} onFinish={finishRace} />
  }

  if (screen === 'result' && result) {
    return (
      <main className="screen result-screen">
        <div className="ambient-grid" />
        <section className="result-card">
          <p className="eyebrow">BANDEIRA QUADRICULADA</p>
          <div className="result-mark">01</div>
          <h1>Prova concluída.</h1>
          <p className="result-pilot">{pilotName}</p>
          <div className="result-stats">
            <div><span>TEMPO TOTAL</span><strong>{formatTime(result.time)}</strong></div>
            <div><span>VELOCIDADE MÁX.</span><strong>{Math.round(result.topSpeed)} <small>KM/H</small></strong></div>
            <div><span>IMPACTOS</span><strong>{result.collisions}</strong></div>
          </div>
          <button className="primary-button" onClick={startRace}>CORRER NOVAMENTE <span>↗</span></button>
          <button className="text-button" onClick={() => setScreen('menu')}>VOLTAR AO PADDOCK</button>
        </section>
      </main>
    )
  }

  return (
    <main className="screen menu-screen">
      <div className="ambient-grid" />
      <header className="site-header">
        <div className="logo"><i /><span>CORRIDA<br /><b>FANTASMA</b></span></div>
        <span className="build-tag">PROTÓTIPO // 001</span>
      </header>

      <section className="hero">
        <p className="eyebrow">UMA VOLTA. UM PILOTO. NENHUMA DESCULPA.</p>
        <h1>DOMINE<br />O <em>ASFALTO.</em></h1>
        <p className="hero-copy">Teste os limites em uma corrida curta de alta velocidade. Esta é a primeira etapa rumo ao duelo fantasma para dois pilotos.</p>

        <form onSubmit={(event) => { event.preventDefault(); startRace() }} className="start-form">
          <label htmlFor="pilot-name">NOME DO PILOTO</label>
          <div className="input-row">
            <input
              id="pilot-name"
              value={draftName}
              maxLength={16}
              onChange={(event) => setDraftName(event.target.value)}
              placeholder="Digite seu nome"
              autoComplete="nickname"
            />
            <button className="primary-button" type="submit">INICIAR TREINO <span>↗</span></button>
          </div>
        </form>
      </section>

      <aside className="briefing-card">
        <span className="card-number">01</span>
        <p className="eyebrow">BRIEFING</p>
        <h2>4,8 KM<br />SETOR ÚNICO</h2>
        <dl>
          <div><dt>ACELERAÇÃO</dt><dd>AUTOMÁTICA</dd></div>
          <div><dt>DIREÇÃO</dt><dd>A / D OU TOQUE</dd></div>
          <div><dt>BOOST</dt><dd>ESPAÇO OU BOTÃO</dd></div>
        </dl>
        <p className="brief-note">Evite as barreiras e fique dentro dos limites da pista. O boost recarrega quando não está em uso.</p>
      </aside>

      <footer className="menu-footer">
        <span>FASE 1 // PROTÓTIPO OFFLINE</span>
        <span>PRÓXIMA ETAPA: SALAS PARA 2 PILOTOS</span>
      </footer>
    </main>
  )
}

export default App
