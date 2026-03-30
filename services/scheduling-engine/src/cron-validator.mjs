const FIELD_RANGES = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
];

function expandPart(part, min, max) {
  if (part === '*') return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  const values = new Set();
  for (const token of part.split(',')) {
    const [base, stepRaw] = token.split('/');
    const step = stepRaw ? Number(stepRaw) : 1;
    if (!Number.isInteger(step) || step <= 0) throw new Error(`Invalid step value in cron field "${part}"`);
    let rangeStart = min;
    let rangeEnd = max;
    if (base && base !== '*') {
      if (base.includes('-')) {
        [rangeStart, rangeEnd] = base.split('-').map(Number);
      } else {
        rangeStart = Number(base);
        rangeEnd = Number(base);
      }
    }
    if (![rangeStart, rangeEnd].every(Number.isInteger) || rangeStart < min || rangeEnd > max || rangeStart > rangeEnd) {
      throw new Error(`Invalid range in cron field "${part}"`);
    }
    for (let current = rangeStart; current <= rangeEnd; current += step) values.add(current);
  }
  return [...values].sort((a, b) => a - b);
}

function parse(expr) {
  const fields = expr.trim().split(/\s+/);
  if (fields.length === 6) throw new Error('Cron expression must use exactly 5 fields; seconds precision is not supported.');
  if (fields.length !== 5) throw new Error('Cron expression must use exactly 5 fields.');
  return fields.map((field, index) => expandPart(field, FIELD_RANGES[index][0], FIELD_RANGES[index][1]));
}

function matches(date, parsed) {
  const [minutes, hours, days, months, weekdays] = parsed;
  const weekday = date.getUTCDay();
  return minutes.includes(date.getUTCMinutes()) && hours.includes(date.getUTCHours()) && days.includes(date.getUTCDate()) && months.includes(date.getUTCMonth() + 1) && weekdays.includes(weekday === 0 ? 0 : weekday);
}

export function validateCronExpression(expr) {
  try {
    parse(expr);
    return { valid: true, error: null };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

export function nextRunAt(expr, fromDate = new Date()) {
  const parsed = parse(expr);
  const probe = new Date(fromDate.getTime());
  probe.setUTCSeconds(0, 0);
  probe.setUTCMinutes(probe.getUTCMinutes() + 1);
  for (let index = 0; index < 60 * 24 * 366; index += 1) {
    if (matches(probe, parsed)) return probe.toISOString();
    probe.setUTCMinutes(probe.getUTCMinutes() + 1);
  }
  throw new Error('Unable to resolve next cron execution within one year.');
}

export function minimumIntervalSeconds(expr) {
  const first = new Date(nextRunAt(expr, new Date('2026-01-01T00:00:00.000Z')));
  const second = new Date(nextRunAt(expr, first));
  const third = new Date(nextRunAt(expr, second));
  return Math.min((second - first) / 1000, (third - second) / 1000);
}

export function assertAboveFloor(expr, floorSeconds) {
  const minimum = minimumIntervalSeconds(expr);
  if (minimum < floorSeconds) throw new Error(`Cron expression resolves every ${minimum} seconds, below floor ${floorSeconds}.`);
  return true;
}
