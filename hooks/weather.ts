// The weather in the band: what to ask Open-Meteo, how to read its answer, and
// how to draw now and tomorrow in a few cells.

import type { Weather } from '../types'

const PLACE = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/

// The forecast to ask for a place given as `lat,lon`; nothing for a text that
// is no place. Only the two numbers reach the URL.
export const weatherUrl = (place: string): string | null => {
  const [, lat, lon] = PLACE.exec(place) ?? []
  if (lat === undefined || lon === undefined) return null
  if (Math.abs(Number(lat)) > 90 || Math.abs(Number(lon)) > 180) return null
  return (
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    '&current=temperature_2m,weather_code,is_day&daily=weather_code,temperature_2m_max&forecast_days=2&timezone=auto'
  )
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

const field = (v: unknown, key: string): unknown => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>)[key] : undefined)

// Open-Meteo's answer as the band draws it: now, and tomorrow's sky and
// maximum. Anything that is not that answer reads as no weather.
export const parseWeather = (text: string, at: number): Weather | null => {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return null
  }
  const current = field(body, 'current')
  const daily = field(body, 'daily')
  const temp = field(current, 'temperature_2m')
  const code = field(current, 'weather_code')
  const nextCode = field(field(daily, 'weather_code'), '1')
  const nextMax = field(field(daily, 'temperature_2m_max'), '1')
  if (!isNumber(temp) || !isNumber(code) || !isNumber(nextCode) || !isNumber(nextMax)) return null
  return { temp: Math.round(temp), code, isDay: field(current, 'is_day') !== 0, nextCode, nextMax: Math.round(nextMax), at }
}

// A reading older than this is no longer "now".
const STALE_MS = 2 * 60 * 60_000

// What the band keeps after asking: the new reading, or with none (no network,
// a refused fetch) the last one while it is fresh. Never an old one as "now".
export const latestWeather = (prev: Weather | null, fresh: Weather | null, at: number): Weather | null =>
  fresh ?? (prev && at - prev.at < STALE_MS ? prev : null)

// What the band draws of a kept reading: nothing once the place is turned off
// (the session's state outlives the reload a change of setting makes) or the
// reading has grown old with no fetch to replace or drop it.
export const shownWeather = (reading: Weather | null, place: string, at: number): Weather | null =>
  reading && weatherUrl(place) !== null && at - reading.at < STALE_MS ? reading : null

// WMO weather codes, as Open-Meteo gives them, up to and including each bound.
// Every icon is one a terminal and the engine agree is two cells wide.
const SKIES: readonly (readonly [number, string])[] = [
  [0, '🌞'],
  [3, '⛅'],
  [48, '🌁'],
  [67, '☔'],
  [77, '⛄'],
  [82, '☔'],
  [86, '⛄'],
  [99, '⚡'],
]
const ICON_WIDTH = 2

const iconOf = (code: number, isDay: boolean): string => {
  if (code === 0 && !isDay) return '🌙'
  return SKIES.find(([upTo]) => code <= upTo)?.[1] ?? ''
}

type Part = { text: string; width: number }

// An icon and a temperature, with the cells they take: an icon's length as a
// string says nothing of its width.
const reading = (icon: string, degrees: number): Part => {
  const label = `${degrees}°`
  return icon ? { text: `${icon} ${label}`, width: ICON_WIDTH + 1 + label.length } : { text: label, width: label.length }
}

// Now alone, and now with tomorrow behind it under `word` ("morgen").
export const weatherParts = (w: Weather, word: string): { short: Part; full: Part } => {
  const short = reading(iconOf(w.code, w.isDay), w.temp)
  const next = reading(iconOf(w.nextCode, true), w.nextMax)
  const joint = ` · ${word} `
  return { short, full: { text: `${short.text}${joint}${next.text}`, width: short.width + joint.length + next.width } }
}
