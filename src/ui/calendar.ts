/** The season calendar. Day 0 is Opening Day, a Thursday in late March. */
import { weekdayOf } from '../engine/season/schedule';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export function dateOf(day: number): { month: number; date: number; weekday: number } {
  let month = 2, date = 26 + day;
  while (date > LENGTHS[month]) { date -= LENGTHS[month]; month = (month + 1) % 12; }
  return { month, date, weekday: weekdayOf(day) };
}

/** "THU MAR 26" */
export function dateLabel(day: number): string {
  const d = dateOf(day);
  return `${WEEKDAYS[d.weekday]} ${MONTHS[d.month]} ${d.date}`;
}

/** "MAR 26" */
export function shortDate(day: number): string {
  const d = dateOf(day);
  return `${MONTHS[d.month]} ${d.date}`;
}

export const weekOf = (day: number) => Math.floor(day / 7) + 1;
export const weekdayShort = (day: number) => WEEKDAYS[weekdayOf(day)];
