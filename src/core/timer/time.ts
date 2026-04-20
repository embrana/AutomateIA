import type { WorklogRoundingMode } from './types.js';

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function nowUtc(): Date {
  return new Date();
}

export function toUtcIso(date: Date): string {
  return date.toISOString();
}

export function toLocalIso(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteOffset = Math.abs(offsetMinutes);
  const offsetHours = Math.floor(absoluteOffset / 60);
  const offsetRemainder = absoluteOffset % 60;

  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
    `${sign}${pad(offsetHours)}:${pad(offsetRemainder)}`,
  ].join('');
}

export function secondsBetween(startIso: string, endDate: Date): number {
  const startDate = new Date(startIso);
  if (Number.isNaN(startDate.getTime())) {
    throw new Error(`Invalid session start time: ${startIso}`);
  }
  return Math.max(0, Math.floor((endDate.getTime() - startDate.getTime()) / 1000));
}

export function roundSeconds(
  seconds: number,
  mode: WorklogRoundingMode = 'minute',
  minSeconds = 60
): number {
  const value = Math.max(seconds, minSeconds);
  if (mode === 'minute') {
    return Math.ceil(value / 60) * 60;
  }
  return value;
}

export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes > 0 && remainingSeconds === 0) {
    return `${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${remainingSeconds}s`;
}
