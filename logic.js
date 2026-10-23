// Shared rules: Israel time, school year (Sept 1st), grades, prices.
// These match the rules inside the database (supabase/schema.sql).
window.Logic = (() => {
  const TZ = 'Asia/Jerusalem';
  const pad = n => String(n).padStart(2, '0');

  function partsInTZ(date) {
    const f = new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    const p = {};
    for (const x of f.formatToParts(date)) p[x.type] = x.value;
    return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
  }

  // Israel-local "YYYY-MM-DD" for an instant
  function dateISO(instant = new Date()) {
    const p = partsInTZ(new Date(instant));
    return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
  }
  const todayISO = () => dateISO(new Date());

  // Israel-local "HH:MM" for an instant
  function timeHM(instant) {
    const p = partsInTZ(new Date(instant));
    return `${pad(p.h)}:${pad(p.mi)}`;
  }

  // Israel-local date + time → UTC ISO string
  function toUTC(dateStr, timeStr = '00:00') {
    const [y, m, d] = dateStr.split('-').map(Number);
    const [h, mi] = timeStr.split(':').map(Number);
    const guess = Date.UTC(y, m - 1, d, h, mi);
    const offset = ts => { const p = partsInTZ(new Date(ts)); return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - ts; };
    let ts = guess - offset(guess);
    ts = guess - offset(ts);
    return new Date(ts).toISOString();
  }

  function addDays(dateStr, n) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + n));
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  }

  // "YYYY-MM" → [fromUTC, toUTC)
  function monthRange(ym) {
    const [y, m] = ym.split('-').map(Number);
    const next = m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
    return [toUTC(`${ym}-01`), toUTC(`${next}-01`)];
  }
  const dayRange = d => [toUTC(d), toUTC(addDays(d, 1))];

  function schoolYear(dateStr) {
    const [y, m] = dateStr.split('-').map(Number);
    return m >= 9 ? y : y - 1;
  }

  // Levels: 1..12 grades, 13 = college 1st year, 14 = graduated
  function levelAt(base, baseYear, dateStr = todayISO()) {
    if (base == null || baseYear == null) return base ?? null;
    if (base >= 14) return 14;
    const diff = schoolYear(dateStr) - baseYear;
    if (diff <= 0) return base;
    if (base === 13) return 14;
    return base + diff > 12 ? 14 : base + diff;
  }
  const currentLevel = p => levelAt(p.level_base, p.level_base_year, todayISO());

  function levelLabel(l) {
    if (l == null) return '—';
    if (l === 13) return 'College · 1st year';
    if (l === 14) return 'Graduated';
    return `Grade ${l}`;
  }
  const LEVELS = Array.from({ length: 14 }, (_, i) => i + 1);

  function priceGroupFor(level, groups) {
    return groups.find(g => level != null && level >= g.min_level && level <= g.max_level) || null;
  }

  function fmtDateLong(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
      .format(new Date(Date.UTC(y, m - 1, d)));
  }
  function fmtDateShort(instant) {
    return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ })
      .format(new Date(instant));
  }
  function fmtMonth(ym) {
    const [y, m] = ym.split('-').map(Number);
    return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(Date.UTC(y, m - 1, 1)));
  }
  function endTime(instant, minutes) {
    return timeHM(new Date(new Date(instant).getTime() + minutes * 60000));
  }
  function fmtHours(min) {
    const h = Math.floor(min / 60), m = min % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  function overlaps(a, b) {
    const a1 = new Date(a.starts_at).getTime(), a2 = a1 + a.duration_min * 60000;
    const b1 = new Date(b.starts_at).getTime(), b2 = b1 + b.duration_min * 60000;
    return a1 < b2 && b1 < a2;
  }

  return {
    TZ, pad, dateISO, todayISO, timeHM, toUTC, addDays, monthRange, dayRange,
    schoolYear, levelAt, currentLevel, levelLabel, LEVELS, priceGroupFor,
    fmtDateLong, fmtDateShort, fmtMonth, endTime, fmtHours, overlaps,
  };
})();
