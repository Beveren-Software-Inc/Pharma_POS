/**
 * Time utility functions for formatting and timezone handling
 */

interface TimeObject {
  hours?: number;
  minutes?: number;
  seconds?: number;
  [key: string]: unknown;
}

/**
 * Format time string to HH:MM:SS format (removes microseconds)
 * @param timeString - Time value (string, number, object, etc.) that may include microseconds
 * @returns Formatted time string in HH:MM:SS format
 */
export const formatTime = (timeString: unknown): string => {
  if (!timeString) return '00:00:00';

  // Convert to string if it's not already
  const timeStr = String(timeString);

  console.log('formatTime input:', timeString, 'converted to string:', timeStr);

  // If it's already in HH:MM:SS format, return as is
  if (/^\d{2}:\d{2}:\d{2}$/.test(timeStr)) {
    console.log('Already in HH:MM:SS format');
    return timeStr;
  }

  // If it includes microseconds (e.g., "16:00:42.582466"), extract just HH:MM:SS
  if (timeStr.includes('.')) {
    const result = timeStr.split('.')[0];
    if (result) {
      console.log('Removed microseconds:', result);
      return result;
    }
  }

  // If it's a full datetime string, extract time part
  if (timeStr.includes('T')) {
    const timePart = timeStr.split('T')[1];
    if (timePart && timePart.includes('.')) {
      const result = timePart.split('.')[0];
      if (result) {
        console.log('Extracted time from datetime:', result);
        return result;
      }
    }
    if (timePart) {
      console.log('Extracted time from datetime (no microseconds):', timePart);
      return timePart;
    }
  }

  // Handle cases where seconds might be truncated (e.g., "16:43:3" or "17:52:1")
  // More specific pattern to catch single-digit seconds
  const timeMatch = timeStr.match(/^(\d{1,2}):(\d{1,2}):(\d{1})$/);
  if (timeMatch && timeMatch[1] && timeMatch[2] && timeMatch[3]) {
    const hours = timeMatch[1];
    const minutes = timeMatch[2];
    const seconds = timeMatch[3];
    const result = `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}:${seconds.padStart(2, '0')}`;
    console.log('Fixed single-digit seconds:', timeStr, '->', result);
    return result;
  }

  // Handle cases where any part might be single digit
  const timeMatchAny = timeStr.match(/^(\d{1,2}):(\d{1,2}):(\d{1,2})$/);
  if (timeMatchAny && timeMatchAny[1] && timeMatchAny[2] && timeMatchAny[3]) {
    const hours = timeMatchAny[1];
    const minutes = timeMatchAny[2];
    const seconds = timeMatchAny[3];
    const result = `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}:${seconds.padStart(2, '0')}`;
    console.log('Fixed any single-digit parts:', timeStr, '->', result);
    return result;
  }

  // Handle cases where time might be in HH:MM format (missing seconds)
  const timeMatchNoSeconds = timeStr.match(/^(\d{1,2}):(\d{1,2})$/);
  if (timeMatchNoSeconds && timeMatchNoSeconds[1] && timeMatchNoSeconds[2]) {
    const hours = timeMatchNoSeconds[1];
    const minutes = timeMatchNoSeconds[2];
    const result = `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}:00`;
    console.log('Added missing seconds:', timeStr, '->', result);
    return result;
  }

  // If it's a time object or number, try to parse it
  if (typeof timeString === 'number' || !isNaN(Number(timeStr))) {
    const date = new Date(timeString as string | number);
    if (!isNaN(date.getTime())) {
      const timeResult = date.toTimeString().split(' ')[0];
      if (timeResult) {
        console.log('Parsed as number/Date:', timeResult);
        return timeResult;
      }
    }
  }

  // Try to parse as a Date and extract time
  const date = new Date(timeStr);
  if (!isNaN(date.getTime())) {
    const timeResult = date.toTimeString().split(' ')[0];
    if (timeResult) {
      console.log('Parsed as Date string:', timeResult);
      return timeResult;
    }
  }

  // If it's a time object with hours, minutes, seconds properties
  if (typeof timeString === 'object' && timeString !== null) {
    const timeObj = timeString as TimeObject;
    if ('hours' in timeObj && 'minutes' in timeObj && 'seconds' in timeObj) {
      const h = String(timeObj.hours || 0).padStart(2, '0');
      const m = String(timeObj.minutes || 0).padStart(2, '0');
      const s = String(timeObj.seconds || 0).padStart(2, '0');
      const result = `${h}:${m}:${s}`;
      console.log('Parsed as time object:', result);
      return result;
    }
  }

  // Final fallback: try to split by colon and pad each part
  const parts = timeStr.split(':');
  if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
    const hours = parts[0];
    const minutes = parts[1];
    const seconds = parts[2];
    if (/^\d{1,2}$/.test(hours) && /^\d{1,2}$/.test(minutes) && /^\d{1,2}$/.test(seconds)) {
      const result = `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}:${seconds.padStart(2, '0')}`;
      console.log('Fallback padding:', timeStr, '->', result);
      return result;
    }
  }

  console.log('No pattern matched, returning original:', timeStr);
  return timeStr;
};

type CalendarDate = { y: number; m: number; d: number };

function parseCalendarDate(dateString: string): CalendarDate | null {
  if (!dateString) return null;
  const datePart = String(dateString).trim().slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (!y || !m || !d) return null;
  return { y, m, d };
}

function localCalendarToday(): CalendarDate {
  const now = new Date();
  return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
}

function calendarToUtcMs(date: CalendarDate): number {
  return Date.UTC(date.y, date.m - 1, date.d);
}

function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const next = new Date(date.y, date.m - 1, date.d + days);
  return { y: next.getFullYear(), m: next.getMonth() + 1, d: next.getDate() };
}

/**
 * Local calendar "now" for date filters.
 * posting_date is a date-only value (YYYY-MM-DD), so compare calendar days
 * rather than UTC timestamps.
 */
export const getSystemDate = (): Date => {
  return new Date();
};

/**
 * Check if a posting date is today in the local calendar.
 */
export const isToday = (dateString: string): boolean => {
  const date = parseCalendarDate(dateString);
  if (!date) return false;
  const today = localCalendarToday();
  return date.y === today.y && date.m === today.m && date.d === today.d;
};

/**
 * Check if a posting date is yesterday in the local calendar.
 */
export const isYesterday = (dateString: string): boolean => {
  const date = parseCalendarDate(dateString);
  if (!date) return false;
  const yesterday = addCalendarDays(localCalendarToday(), -1);
  return date.y === yesterday.y && date.m === yesterday.m && date.d === yesterday.d;
};

/**
 * Check if a posting date is within the current local week (Sunday–Saturday).
 */
export const isThisWeek = (dateString: string): boolean => {
  const date = parseCalendarDate(dateString);
  if (!date) return false;

  const today = localCalendarToday();
  const todayDate = new Date(today.y, today.m - 1, today.d);
  const startOfWeek = new Date(todayDate);
  startOfWeek.setDate(todayDate.getDate() - todayDate.getDay());
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);

  const value = calendarToUtcMs(date);
  return (
    value >= Date.UTC(startOfWeek.getFullYear(), startOfWeek.getMonth(), startOfWeek.getDate()) &&
    value <= Date.UTC(endOfWeek.getFullYear(), endOfWeek.getMonth(), endOfWeek.getDate())
  );
};

/**
 * Check if a posting date is in the current local month.
 */
export const isThisMonth = (dateString: string): boolean => {
  const date = parseCalendarDate(dateString);
  if (!date) return false;
  const today = localCalendarToday();
  return date.y === today.y && date.m === today.m;
};

/**
 * Check if a posting date is in the current local year.
 */
export const isThisYear = (dateString: string): boolean => {
  const date = parseCalendarDate(dateString);
  if (!date) return false;
  return date.y === localCalendarToday().y;
};

/**
 * Format date and time for display
 * @param dateString - Date string
 * @param timeString - Time string (optional)
 * @returns Formatted date and time string
 */
export const formatDateTime = (dateString: string, timeString?: string): string => {
  if (!dateString) return '';

  const date = new Date(dateString);
  const formattedDate = date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });

  if (timeString) {
    const formattedTime = formatTime(timeString);
    return `${formattedDate} ${formattedTime}`;
  }

  return formattedDate;
};
