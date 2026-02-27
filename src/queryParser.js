const DATE_REGEX = /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/;

function toYyyymmdd(day, month, year) {
  const y = String(year).padStart(4, '0');
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${y}${m}${d}`;
}

export function parseQuestion(question) {
  const q = String(question || '');
  const lower = q.toLowerCase();

  // Date like 14-02-2024 or 14/02/24
  let releaseDate = null;
  const m = q.match(DATE_REGEX);
  if (m) {
    const [, dd, mm, yyyy] = m;
    const year = yyyy.length === 2 ? `20${yyyy}` : yyyy;
    releaseDate = toYyyymmdd(parseInt(dd, 10), parseInt(mm, 10), year);
  }

  // Very simple OS detection for now
  let productBrand = null;
  let productName = null;
  let channel = null;

  if (lower.includes('linux')) {
    productBrand = 'Linux';
    productName = 'Linux';
  } else if (lower.includes('android')) {
    productBrand = 'Alphabet';
    productName = 'Android';
  }

  if (lower.includes('patch')) {
    channel = 'patch';
  } else if (lower.includes('production')) {
    channel = 'production';
  }

  return {
    productBrand,
    productName,
    releaseDate,
    channel
  };
}

