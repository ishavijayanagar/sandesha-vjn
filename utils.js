function removeEmojis(str) {
  return str.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}]/gu, '');
}

function parseScheduleTime(timeStr) {
  const now = new Date();
  const lower = timeStr.toLowerCase().trim();
  
  let runAt = new Date(now);
  
  const timeMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1]);
    const minutes = parseInt(timeMatch[2] || '0');
    const ampm = timeMatch[3]?.toLowerCase();
    
    if (ampm === 'pm' && hours < 12) hours += 12;
    if (ampm === 'am' && hours === 12) hours = 0;
    
    runAt.setHours(hours, minutes, 0, 0);
  }
  
  if (lower.includes('tomorrow')) {
    runAt.setDate(runAt.getDate() + 1);
  } else if (lower.includes('today') && timeMatch) {
    // Keep today
  } else if (!timeMatch && lower.includes('daily')) {
    // daily - keep today
  }
  
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  for (const day of days) {
    if (lower.includes(day)) {
      const targetDay = days.indexOf(day);
      let currentDay = runAt.getDay();
      let daysUntil = targetDay - currentDay;
      if (daysUntil <= 0) daysUntil += 7;
      runAt.setDate(runAt.getDate() + daysUntil);
      break;
    }
  }
  
  if (runAt <= now) {
    runAt.setDate(runAt.getDate() + 1);
  }
  
  return runAt;
}

function formatTimeUntil(date) {
  const now = new Date();
  const diff = date - now;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days} day(s)`;
  }
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes} minutes`;
}

module.exports = { removeEmojis, parseScheduleTime, formatTimeUntil };
