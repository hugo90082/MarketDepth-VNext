export const time = (ms: number | null | undefined, seconds = true) => ms == null ? '—' : new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' as const } : {}), hour12: false }).format(ms);
export const dateTime = (ms: number | null | undefined) => ms == null ? '—' : new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(ms);
export const qty = (n: number | null | undefined, digits = 2) => n == null ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
export const compact = (n: number | null | undefined) => n == null ? '—' : new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n);
export const percent = (n: number | null | undefined) => n == null ? '—' : `${n > 0 ? '+' : ''}${(n * 100).toFixed(2)}%`;

export const ratio = (n: number | null | undefined) => n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(3)}`;
