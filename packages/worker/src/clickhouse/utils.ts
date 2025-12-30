function padNumber(value: number, length: number): string {
  return value.toString().padStart(length, "0");
}

export function formatDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = padNumber(date.getUTCMonth() + 1, 2);
  const day = padNumber(date.getUTCDate(), 2);
  const hours = padNumber(date.getUTCHours(), 2);
  const minutes = padNumber(date.getUTCMinutes(), 2);
  const secondsPart = padNumber(date.getUTCSeconds(), 2);
  const nanoPart = padNumber(date.getUTCMilliseconds(), 3);

  return `${year}-${month}-${day} ${hours}:${minutes}:${secondsPart}.${nanoPart}`;
}
