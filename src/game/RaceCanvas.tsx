import { useCallback, useEffect, useRef, useState } from 'react'
import {
  formatTime,
  obstacles,
  speedForState,
  TRACK_LENGTH,
  trackCurve,
  VIEW_DISTANCE,
} from './track'

type RacePhase = 'countdown' | 'racing' | 'finished'

export type RaceResult = {
  time: number
  topSpeed: number
  collisions: number
}

type RaceCanvasProps = {
  pilotName: string
  onFinish: (result: RaceResult) => void
}

type Telemetry = {
  progress: number
  speed: number
  boost: number
  elapsed: number
  offRoad: boolean
  penalty: number
}

type InputState = { left: boolean; right: boolean; boost: boolean }

const initialTelemetry: Telemetry = {
  progress: 0,
  speed: 0,
  boost: 100,
  elapsed: 0,
  offRoad: false,
  penalty: 0,
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  ctx.beginPath()
  ctx.roundRect(x, y, width, height, radius)
}

function drawCar(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(scale, scale)

  ctx.fillStyle = 'rgba(0,0,0,.42)'
  ctx.beginPath()
  ctx.ellipse(0, 10, 34, 14, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#0b0d11'
  roundedRect(ctx, -31, -3, 13, 32, 4)
  ctx.fill()
  roundedRect(ctx, 18, -3, 13, 32, 4)
  ctx.fill()

  ctx.fillStyle = '#ff4b2b'
  ctx.beginPath()
  ctx.moveTo(-23, 25)
  ctx.lineTo(-17, -25)
  ctx.quadraticCurveTo(0, -38, 17, -25)
  ctx.lineTo(23, 25)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = '#ffb000'
  ctx.fillRect(-4, -31, 8, 57)
  ctx.fillStyle = '#c7f9ff'
  ctx.beginPath()
  ctx.moveTo(-10, -13)
  ctx.lineTo(0, -23)
  ctx.lineTo(10, -13)
  ctx.lineTo(7, 0)
  ctx.lineTo(-7, 0)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = '#151820'
  ctx.fillRect(-30, 20, 60, 7)
  ctx.fillRect(-27, -28, 54, 6)
  ctx.restore()
}

function RaceCanvas({ pilotName, onFinish }: RaceCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const inputRef = useRef<InputState>({ left: false, right: false, boost: false })
  const [telemetry, setTelemetry] = useState(initialTelemetry)
  const [phase, setPhase] = useState<RacePhase>('countdown')
  const [countdownLight, setCountdownLight] = useState(0)
  const [flash, setFlash] = useState<string | null>(null)
  const audioRef = useRef<AudioContext | null>(null)

  const beep = useCallback((frequency: number, duration = 0.12) => {
    const AudioContextClass = window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) return
    const audio = audioRef.current ?? new AudioContextClass()
    audioRef.current = audio
    const oscillator = audio.createOscillator()
    const gain = audio.createGain()
    oscillator.type = 'square'
    oscillator.frequency.value = frequency
    gain.gain.setValueAtTime(0.045, audio.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duration)
    oscillator.connect(gain).connect(audio.destination)
    oscillator.start()
    oscillator.stop(audio.currentTime + duration)
  }, [])

  const setInput = (key: keyof InputState, active: boolean) => {
    inputRef.current[key] = active
  }

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (['ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault()
      if (event.code === 'ArrowLeft' || event.code === 'KeyA') setInput('left', true)
      if (event.code === 'ArrowRight' || event.code === 'KeyD') setInput('right', true)
      if (event.code === 'Space') setInput('boost', true)
    }
    const up = (event: KeyboardEvent) => {
      if (event.code === 'ArrowLeft' || event.code === 'KeyA') setInput('left', false)
      if (event.code === 'ArrowRight' || event.code === 'KeyD') setInput('right', false)
      if (event.code === 'Space') setInput('boost', false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  useEffect(() => {
    let light = 0
    const startedAt = performance.now()
    const countdown = window.setInterval(() => {
      light += 1
      if (light <= 5) {
        setCountdownLight(light)
        beep(330 + light * 24)
      }
      if (light === 6) {
        window.clearInterval(countdown)
        setCountdownLight(0)
        setPhase('racing')
        beep(740, 0.35)
      }
    }, 600)
    return () => {
      window.clearInterval(countdown)
      // Avoid retaining a stale countdown when React remounts in development.
      if (performance.now() - startedAt < 3_700) setCountdownLight(0)
    }
  }, [beep])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let width = 0
    let height = 0
    let progress = 0
    let lateral = 0
    let speed = 0
    let boost = 100
    let penalty = 0
    let collisions = 0
    let topSpeed = 0
    let raceStartedAt = 0
    let previous = performance.now()
    let lastHudUpdate = 0
    let animationFrame = 0
    let finished = false
    const hitObstacles = new Set<number>()

    const resize = () => {
      const box = canvas.getBoundingClientRect()
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
      width = box.width
      height = box.height
      canvas.width = Math.floor(width * pixelRatio)
      canvas.height = Math.floor(height * pixelRatio)
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const roadGeometry = (distanceAhead: number) => {
      const closeness = 1 - distanceAhead / VIEW_DISTANCE
      const perspective = Math.pow(Math.max(0, closeness), 1.72)
      const horizon = height * 0.29
      const bottom = height * 0.92
      const y = horizon + perspective * (bottom - horizon)
      const roadWidth = width * (0.09 + perspective * 0.8)
      const bend = (trackCurve(progress + distanceAhead) - trackCurve(progress)) * width * 0.31
      return { y, roadWidth, center: width / 2 + bend * (1 - perspective * 0.25) }
    }

    const drawBackdrop = () => {
      const sky = ctx.createLinearGradient(0, 0, 0, height * 0.5)
      sky.addColorStop(0, '#06101b')
      sky.addColorStop(0.58, '#173d4b')
      sky.addColorStop(1, '#ff875f')
      ctx.fillStyle = sky
      ctx.fillRect(0, 0, width, height * 0.44)

      ctx.fillStyle = '#14222b'
      ctx.beginPath()
      ctx.moveTo(0, height * 0.34)
      for (let x = 0; x <= width; x += 55) {
        const ridge = height * (0.3 + 0.035 * Math.sin(x * 0.017 + progress * 0.0005))
        ctx.lineTo(x, ridge)
      }
      ctx.lineTo(width, height * 0.48)
      ctx.lineTo(0, height * 0.48)
      ctx.closePath()
      ctx.fill()

      ctx.fillStyle = '#183824'
      ctx.fillRect(0, height * 0.38, width, height)
    }

    const drawRoad = () => {
      const slices = 84
      for (let i = 0; i < slices; i += 1) {
        const farDistance = VIEW_DISTANCE * (1 - i / slices)
        const nearDistance = VIEW_DISTANCE * (1 - (i + 1) / slices)
        const far = roadGeometry(farDistance)
        const near = roadGeometry(nearDistance)
        const stripe = Math.floor((progress + nearDistance) / 18) % 2 === 0

        ctx.fillStyle = stripe ? '#244b2c' : '#214329'
        ctx.fillRect(0, far.y, width, Math.max(1, near.y - far.y + 1))

        ctx.fillStyle = stripe ? '#30343b' : '#2b2f35'
        ctx.beginPath()
        ctx.moveTo(far.center - far.roadWidth / 2, far.y)
        ctx.lineTo(far.center + far.roadWidth / 2, far.y)
        ctx.lineTo(near.center + near.roadWidth / 2, near.y)
        ctx.lineTo(near.center - near.roadWidth / 2, near.y)
        ctx.closePath()
        ctx.fill()

        ctx.strokeStyle = stripe ? '#f6f7ee' : '#e84037'
        ctx.lineWidth = Math.max(1, near.roadWidth * 0.018)
        ctx.beginPath()
        ctx.moveTo(far.center - far.roadWidth / 2, far.y)
        ctx.lineTo(near.center - near.roadWidth / 2, near.y)
        ctx.moveTo(far.center + far.roadWidth / 2, far.y)
        ctx.lineTo(near.center + near.roadWidth / 2, near.y)
        ctx.stroke()

        if (stripe) {
          ctx.strokeStyle = 'rgba(255,255,255,.5)'
          ctx.lineWidth = Math.max(1, near.roadWidth * 0.008)
          for (const lane of [-0.33, 0.33]) {
            ctx.beginPath()
            ctx.moveTo(far.center + far.roadWidth * lane, far.y)
            ctx.lineTo(near.center + near.roadWidth * lane, near.y)
            ctx.stroke()
          }
        }
      }
    }

    const drawObstacle = (distanceAhead: number, lane: number, kind: 'barrier' | 'debris') => {
      const projected = roadGeometry(distanceAhead)
      const closeness = Math.max(0, 1 - distanceAhead / VIEW_DISTANCE)
      const size = 5 + Math.pow(closeness, 1.5) * 48
      const x = projected.center + projected.roadWidth * lane * 0.39
      const y = projected.y

      ctx.save()
      ctx.translate(x, y)
      if (kind === 'barrier') {
        ctx.fillStyle = '#eef1f2'
        roundedRect(ctx, -size * 0.65, -size * 0.42, size * 1.3, size * 0.48, size * 0.08)
        ctx.fill()
        ctx.fillStyle = '#ff4b37'
        ctx.fillRect(-size * 0.52, -size * 0.35, size * 0.35, size * 0.34)
        ctx.fillRect(size * 0.16, -size * 0.35, size * 0.35, size * 0.34)
      } else {
        ctx.fillStyle = '#ff8a00'
        ctx.beginPath()
        ctx.moveTo(0, -size * 0.72)
        ctx.lineTo(size * 0.42, 0)
        ctx.lineTo(-size * 0.42, 0)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = '#f5f6e9'
        ctx.fillRect(-size * 0.26, -size * 0.26, size * 0.52, size * 0.13)
      }
      ctx.restore()
    }

    const draw = (now: number) => {
      const dt = Math.min((now - previous) / 1000, 0.05)
      previous = now

      if (phase === 'racing' && !finished) {
        if (raceStartedAt === 0) raceStartedAt = now
        const steer = Number(inputRef.current.right) - Number(inputRef.current.left)
        lateral += steer * dt * (1.35 + speed / 520)
        lateral = Math.max(-1.28, Math.min(1.28, lateral))
        const offRoad = Math.abs(lateral) > 0.88
        const boosting = inputRef.current.boost && boost > 0 && !offRoad && penalty <= 0
        boost = Math.max(0, Math.min(100, boost + (boosting ? -25 : 5.5) * dt))
        penalty = Math.max(0, penalty - dt)
        const targetSpeed = speedForState(offRoad, penalty, boosting)
        speed += (targetSpeed - speed) * Math.min(1, dt * (targetSpeed < speed ? 5 : 1.8))
        progress = Math.min(TRACK_LENGTH, progress + (speed / 3.6) * dt)
        topSpeed = Math.max(topSpeed, speed)

        for (const obstacle of obstacles) {
          const delta = obstacle.distance - progress
          if (
            delta > -5 &&
            delta < 8 &&
            Math.abs(lateral - obstacle.lane) < 0.25 &&
            !hitObstacles.has(obstacle.id)
          ) {
            hitObstacles.add(obstacle.id)
            collisions += 1
            penalty = 1.65
            setFlash('IMPACTO — VELOCIDADE REDUZIDA')
            window.setTimeout(() => setFlash(null), 1_200)
            beep(105, 0.24)
          }
        }

        const elapsed = (now - raceStartedAt) / 1000
        if (now - lastHudUpdate > 80) {
          lastHudUpdate = now
          setTelemetry({ progress, speed, boost, elapsed, offRoad, penalty })
        }

        if (progress >= TRACK_LENGTH) {
          finished = true
          setPhase('finished')
          const result = { time: elapsed, topSpeed, collisions }
          setTelemetry((current) => ({ ...current, progress: TRACK_LENGTH, elapsed, speed: 0 }))
          window.setTimeout(() => onFinish(result), 850)
        }
      }

      drawBackdrop()
      drawRoad()

      const visibleObstacles = obstacles
        .map((obstacle) => ({ ...obstacle, ahead: obstacle.distance - progress }))
        .filter((obstacle) => obstacle.ahead > 0 && obstacle.ahead < VIEW_DISTANCE)
        .sort((a, b) => b.ahead - a.ahead)
      for (const obstacle of visibleObstacles) {
        drawObstacle(obstacle.ahead, obstacle.lane, obstacle.kind)
      }

      if (TRACK_LENGTH - progress < VIEW_DISTANCE) {
        const finish = roadGeometry(TRACK_LENGTH - progress)
        const cells = 12
        for (let i = 0; i < cells; i += 1) {
          ctx.fillStyle = i % 2 === 0 ? '#f3f3ed' : '#11151a'
          const cellWidth = finish.roadWidth / cells
          ctx.fillRect(finish.center - finish.roadWidth / 2 + i * cellWidth, finish.y, cellWidth + 1, 5)
        }
      }

      const playerX = width / 2 + lateral * width * 0.32
      if (phase !== 'finished') drawCar(ctx, playerX, height * 0.82, Math.max(0.76, width / 620))

      if (telemetry.offRoad && phase === 'racing') {
        ctx.fillStyle = 'rgba(255, 87, 48, .09)'
        ctx.fillRect(0, 0, width, height)
      }
      animationFrame = requestAnimationFrame(draw)
    }

    animationFrame = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(animationFrame)
      window.removeEventListener('resize', resize)
    }
  }, [beep, onFinish, phase])

  const progressPercent = Math.min(100, (telemetry.progress / TRACK_LENGTH) * 100)
  const isBoosting = inputRef.current.boost && telemetry.boost > 0 && phase === 'racing'

  return (
    <main className="race-shell">
      <canvas ref={canvasRef} className="race-canvas" aria-label="Pista de corrida" />

      <div className="topbar">
        <div className="brand-mini"><i /> CORRIDA FANTASMA</div>
        <div className="pilot-tag"><span>PILOTO</span>{pilotName}</div>
      </div>

      <section className="hud" aria-label="Telemetria">
        <div className="position-block">
          <span>POSIÇÃO</span>
          <strong>SOLO</strong>
        </div>
        <div className="timer-block">
          <span>TEMPO DE CORRIDA</span>
          <strong>{formatTime(telemetry.elapsed)}</strong>
        </div>
        <div className="speed-block">
          <strong>{Math.round(telemetry.speed)}</strong>
          <span>KM/H</span>
        </div>
      </section>

      <div className="progress-wrap">
        <div className="progress-copy">
          <span>SETOR ÚNICO</span>
          <strong>{progressPercent.toFixed(0)}%</strong>
        </div>
        <div className="progress-track"><i style={{ width: `${progressPercent}%` }} /></div>
      </div>

      <div className={`boost-meter ${isBoosting ? 'active' : ''}`}>
        <div className="boost-copy"><span>BOOST</span><b>{Math.round(telemetry.boost)}%</b></div>
        <div className="boost-track"><i style={{ width: `${telemetry.boost}%` }} /></div>
      </div>

      {telemetry.offRoad && phase === 'racing' && <div className="warning">FORA DA PISTA</div>}
      {flash && <div className="impact">{flash}</div>}

      {phase === 'countdown' && (
        <div className="countdown-layer">
          <div className="lights" aria-label={`${countdownLight} de 5 luzes`}>
            {[1, 2, 3, 4, 5].map((light) => (
              <i key={light} className={countdownLight >= light ? 'on' : ''} />
            ))}
          </div>
          <p>{countdownLight === 0 ? 'PREPARE-SE' : 'AGUARDE AS LUZES'}</p>
        </div>
      )}

      {phase === 'racing' && telemetry.elapsed < 1.1 && <div className="go-signal">VAI!</div>}

      <div className="touch-controls" aria-label="Controles de toque">
        <button
          className="steer left"
          aria-label="Virar à esquerda"
          onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setInput('left', true) }}
          onPointerUp={() => setInput('left', false)}
          onPointerCancel={() => setInput('left', false)}
        >‹</button>
        <button
          className="steer right"
          aria-label="Virar à direita"
          onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setInput('right', true) }}
          onPointerUp={() => setInput('right', false)}
          onPointerCancel={() => setInput('right', false)}
        >›</button>
        <button
          className="boost-button"
          aria-label="Ativar boost"
          onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setInput('boost', true) }}
          onPointerUp={() => setInput('boost', false)}
          onPointerCancel={() => setInput('boost', false)}
        ><span>BOOST</span><small>SEGURE</small></button>
      </div>

      <div className="keyboard-hint"><kbd>A</kbd><kbd>D</kbd> DIREÇÃO <kbd>ESPAÇO</kbd> BOOST</div>
    </main>
  )
}

export default RaceCanvas
