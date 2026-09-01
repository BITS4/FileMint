function assertPageCount(total: number): void {
  if (!Number.isSafeInteger(total) || total < 1)
    throw new Error('The PDF does not contain any readable pages.');
}

function assertPage(page: number, total: number): void {
  if (page < 1 || page > total) throw new Error(`Page ${page} is out of range (1–${total}).`);
}

export function parsePageRanges(input: string, total: number): number[][] {
  assertPageCount(total);
  const groups = input.split(',').map((token) => token.trim());
  if (groups.length === 0 || groups.every((token) => !token)) {
    throw new Error('Enter at least one page or range, e.g. 1-3, 5.');
  }
  if (groups.some((token) => !token)) throw new Error('Remove empty entries between page ranges.');

  return groups.map((token) => {
    const range = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      let start = Number(range[1]);
      let end = Number(range[2]);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
        throw new Error(`“${token}” is not a valid page range.`);
      }
      if (start > end) [start, end] = [end, start];
      assertPage(start, total);
      assertPage(end, total);
      return Array.from({ length: end - start + 1 }, (_, index) => start + index - 1);
    }

    if (!/^\d+$/.test(token)) throw new Error(`“${token}” is not a valid page or range.`);
    const page = Number(token);
    if (!Number.isSafeInteger(page)) throw new Error(`“${token}” is not a valid page.`);
    assertPage(page, total);
    return [page - 1];
  });
}

export function groupEveryPages(input: string, total: number): number[][] {
  assertPageCount(total);
  const value = input.trim();
  if (!/^\d+$/.test(value)) throw new Error('Pages per file must be a whole number.');
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size < 1) throw new Error('Pages per file must be at least 1.');

  const groups: number[][] = [];
  for (let index = 0; index < total; index += size) {
    groups.push(Array.from({ length: Math.min(size, total - index) }, (_, offset) => index + offset));
  }
  return groups;
}

export function groupEachPage(total: number): number[][] {
  assertPageCount(total);
  return Array.from({ length: total }, (_, index) => [index]);
}
