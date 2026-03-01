export function formatDate(unixtimestamp: number) {
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec'
  ];

  const date = new Date(unixtimestamp * 1000);
  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = date.getFullYear();

  const formattedDate = `${day} ${month} ${year}`;
  return formattedDate;
}

export function formatAmount(amount: number): string {
  if (amount >= 1000000) {
    const formattedAmount = amount / 1000000;
    return formattedAmount % 1 === 0 ? `${formattedAmount}M` : `${formattedAmount.toFixed(1)}M`;
  } else if (amount >= 1000) {
    const formattedAmount = amount / 1000;
    return formattedAmount % 1 === 0 ? `${formattedAmount}K` : `${formattedAmount.toFixed(1)}K`;
  } else {
    return amount.toString();
  }
}

// Format sats with commas for better readability
export function formatSats(sats: number): string {
  return sats.toLocaleString('en-US');
}

// Compact relative timestamps: "now", "3m", "2h", "5d", "1w", "3mo", "1y"
export function formatCompactTime(unixTimestamp: number): string {
  const seconds = Math.floor(Date.now() / 1000) - unixTimestamp;
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  const months = Math.floor(days / 30);
  if (days < 365) return `${months}mo`;
  const years = Math.max(1, Math.floor(days / 365));
  return `${years}y`;
}
