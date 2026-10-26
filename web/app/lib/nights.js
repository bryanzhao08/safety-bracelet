const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function getLocalParts(at, tzOffsetMin = 0) {
  const ms = typeof at === 'string' ? new Date(at).getTime() : (at instanceof Date ? at.getTime() : Number(at));
  const localMs = ms - (tzOffsetMin * 60000);
  const d = new Date(localMs);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    date: d.getUTCDate(),
    day: d.getUTCDay(),
    hours: d.getUTCHours(),
    minutes: d.getUTCMinutes(),
    seconds: d.getUTCSeconds(),
    localMs
  };
}

export function formatTime(at, tzOffsetMin = 0) {
  const parts = getLocalParts(at, tzOffsetMin);
  const h12 = parts.hours % 12 || 12;
  const ampm = parts.hours >= 12 ? 'pm' : 'am';
  const m = String(parts.minutes).padStart(2, '0');
  return `${h12}:${m} ${ampm}`;
}

export function formatNightLabel(at, tzOffsetMin = 0) {
  const parts = getLocalParts(at, tzOffsetMin);
  const nightDateMs = parts.localMs - 12 * 60 * 60 * 1000;
  const nd = new Date(nightDateMs);
  const dayName = DAYS[nd.getUTCDay()];
  const monthName = MONTHS[nd.getUTCMonth()];
  const dayNum = nd.getUTCDate();
  return `${dayName}, ${monthName} ${dayNum}`;
}

export function groupByNight(entries, options = {}) {
  const tzOffsetMin = typeof options === 'number'
    ? options
    : (options?.tzOffsetMin ?? 0);

  const nightsMap = new Map();

  for (const entry of (entries || [])) {
    if (!entry || !entry.at) continue;
    const parts = getLocalParts(entry.at, tzOffsetMin);
    const nightDateMs = parts.localMs - 12 * 60 * 60 * 1000;
    const nd = new Date(nightDateMs);
    const y = nd.getUTCFullYear();
    const m = String(nd.getUTCMonth() + 1).padStart(2, '0');
    const d = String(nd.getUTCDate()).padStart(2, '0');
    const key = `${y}-${m}-${d}`;
    const label = `${DAYS[nd.getUTCDay()]}, ${MONTHS[nd.getUTCMonth()]} ${nd.getUTCDate()}`;

    if (!nightsMap.has(key)) {
      nightsMap.set(key, {
        key,
        label,
        tzOffsetMin,
        rawEntries: []
      });
    }
    nightsMap.get(key).rawEntries.push(entry);
  }

  const sortedKeys = [...nightsMap.keys()].sort((a, b) => b.localeCompare(a));

  const result = [];
  for (const key of sortedKeys) {
    const night = nightsMap.get(key);
    const sortedEntries = [...night.rawEntries].sort((a, b) => {
      const ta = new Date(a.at).getTime();
      const tb = new Date(b.at).getTime();
      return ta - tb;
    });

    const collapsed = [];
    const lastMetByPerson = new Map();

    for (const entry of sortedEntries) {
      if (entry.type === 'met') {
        const pid = entry.personId || entry.id;
        const entryTime = new Date(entry.at).getTime();
        const lastTime = lastMetByPerson.get(pid);

        if (lastTime !== undefined && (entryTime - lastTime) <= 10 * 60 * 1000) {
          continue;
        }
        lastMetByPerson.set(pid, entryTime);
        collapsed.push(entry);
      } else {
        collapsed.push(entry);
      }
    }

    result.push({
      key: night.key,
      label: night.label,
      tzOffsetMin,
      entries: collapsed
    });
  }

  return result;
}

export function recap(night) {
  const entries = Array.isArray(night) ? night : (night?.entries || []);
  const distinctPeople = new Set();
  let first = null;
  let last = null;
  let lastWith = null;
  let wentHome = null;
  const parties = [];

  for (const entry of entries) {
    if (!entry || !entry.at) continue;
    if (!first || new Date(entry.at).getTime() < new Date(first).getTime()) {
      first = entry.at;
    }
    if (!last || new Date(entry.at).getTime() > new Date(last).getTime()) {
      last = entry.at;
    }
    if (entry.type === 'met') {
      const pid = entry.personId || entry.id;
      if (pid) distinctPeople.add(pid);
      if (!lastWith || new Date(entry.at).getTime() >= new Date(lastWith.at).getTime()) {
        lastWith = {
          personId: pid,
          name: entry.name,
          at: entry.at
        };
      }
    } else if (entry.type === 'home') {
      wentHome = entry.at;
    } else if (entry.type === 'arrive' && entry.name && !parties.includes(entry.name)) {
      parties.push(entry.name);
    }
  }

  return {
    people: distinctPeople.size,
    first,
    last,
    lastWith,
    wentHome,
    parties
  };
}

export function shareText(night, options = {}) {
  if (!night) return '';
  const tzOffsetMin = typeof options === 'number'
    ? options
    : (options?.tzOffsetMin ?? night.tzOffsetMin ?? 0);

  const lines = [night.label];
  for (const entry of (night.entries || [])) {
    const time = formatTime(entry.at, tzOffsetMin);
    let desc = '';
    if (entry.type === 'met') {
      desc = entry.again ? `saw ${entry.name} again` : `met ${entry.name}`;
    } else if (entry.type === 'home') {
      desc = 'home';
    } else if (entry.type === 'arrive') {
      desc = `Arrived at ${entry.name}`;
    } else if (entry.type === 'note') {
      desc = entry.text || '';
    } else {
      desc = entry.text || entry.type || '';
    }
    lines.push(`${time} ${desc}`.trimEnd());
  }
  return lines.join('\n');
}
