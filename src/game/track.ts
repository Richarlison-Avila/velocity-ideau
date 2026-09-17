export const TRACK_LENGTH = 4_800
export const VIEW_DISTANCE = 430

export type Obstacle = {
  id: number
  distance: number
  lane: number
  kind: 'barrier' | 'debris'
}

export const obstacles: Obstacle[] = [
  { id: 1, distance: 510, lane: -0.48, kind: 'debris' },
  { id: 2, distance: 940, lane: 0.42, kind: 'barrier' },
  { id: 3, distance: 1_370, lane: 0.02, kind: 'debris' },
  { id: 4, distance: 1_840, lane: -0.52, kind: 'barrier' },
  { id: 5, distance: 2_310, lane: 0.5, kind: 'debris' },
  { id: 6, distance: 2_760, lane: -0.1, kind: 'barrier' },
  { id: 7, distance: 3_210, lane: 0.56, kind: 'debris' },
  { id: 8, distance: 3_680, lane: -0.5, kind: 'barrier' },
  { id: 9, distance: 4_120, lane: 0.08, kind: 'debris' },
  { id: 10, distance: 4_510, lane: -0.42, kind: 'barrier' },
]

export function trackCurve(distance: number) {
  return (
    Math.sin(distance / 310) * 0.46 +
    Math.sin(distance / 790 + 0.8) * 0.35 +
    Math.sin(distance / 1450) * 0.18
  )
}

export function formatTime(seconds: number) {
  const safe = Math.max(0, seconds)
  const minutes = Math.floor(safe / 60)
  const remaining = safe - minutes * 60
  return `${minutes}:${remaining.toFixed(3).padStart(6, '0')}`
}

export function speedForState(offRoad: boolean, penalty: number, boosting: boolean) {
  if (offRoad) return 132
  if (penalty > 0) return 172
  if (boosting) return 314
  return 252
}
