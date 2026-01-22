const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const parseTimeToMinutes = (timeString) => {
  if (!timeString) return null;
  const [hoursRaw, minutesRaw] = String(timeString).split(':');
  const hours = Number.parseInt(hoursRaw, 10);
  const minutes = Number.parseInt(minutesRaw, 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
};

const getZonedTimeParts = (timestamp, timeZone) => {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  const weekdayPart = parts.find(part => part.type === 'weekday')?.value;
  const hourPart = parts.find(part => part.type === 'hour')?.value;
  const minutePart = parts.find(part => part.type === 'minute')?.value;

  if (!weekdayPart || !hourPart || !minutePart) {
    return null;
  }

  const weekdayIndex = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(
    weekdayPart.toLowerCase().slice(0, 3)
  );
  if (weekdayIndex < 0) return null;

  return {
    weekday: WEEKDAY_KEYS[weekdayIndex],
    minutes: Number.parseInt(hourPart, 10) * 60 + Number.parseInt(minutePart, 10)
  };
};

const isMinutesWithinWindow = (minutes, openMinutes, closeMinutes) => {
  if (openMinutes === null || closeMinutes === null) return false;
  if (openMinutes === closeMinutes) return false;
  if (openMinutes < closeMinutes) {
    return minutes >= openMinutes && minutes < closeMinutes;
  }
  return minutes >= openMinutes || minutes < closeMinutes;
};

const getPreviousWeekday = (weekdayKey) => {
  const index = WEEKDAY_KEYS.indexOf(weekdayKey);
  if (index < 0) return null;
  return WEEKDAY_KEYS[(index + 6) % WEEKDAY_KEYS.length];
};

export const isStoreOpen = ({ hours, timestamp, timeZone } = {}) => {
  if (!hours?.weekly) return false;
  const zone = timeZone || hours?.timezone || 'UTC';
  const timeParts = getZonedTimeParts(timestamp ?? new Date(), zone);
  if (!timeParts) return false;

  const { weekday, minutes } = timeParts;
  const today = hours.weekly[weekday];
  if (today && !today.closed) {
    const openMinutes = parseTimeToMinutes(today.open);
    const closeMinutes = parseTimeToMinutes(today.close);
    if (isMinutesWithinWindow(minutes, openMinutes, closeMinutes)) {
      return true;
    }
  }

  const previousDayKey = getPreviousWeekday(weekday);
  const previous = previousDayKey ? hours.weekly[previousDayKey] : null;
  if (previous && !previous.closed) {
    const openMinutes = parseTimeToMinutes(previous.open);
    const closeMinutes = parseTimeToMinutes(previous.close);
    if (openMinutes !== null && closeMinutes !== null && openMinutes > closeMinutes) {
      return minutes < closeMinutes;
    }
  }

  return false;
};

export const getStoreHoursForDay = (hours, weekdayKey) => {
  if (!hours?.weekly) return null;
  const key = String(weekdayKey || '').toLowerCase().slice(0, 3);
  return hours.weekly[key] || null;
};
