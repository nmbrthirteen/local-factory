export type PaletteItem = { id: string; group: string; label: string; detail?: string; keywords?: string; run: () => void };

type Searchable = Pick<PaletteItem, 'group' | 'label' | 'detail' | 'keywords'>;

const resultLimit = 60;

function score(item: Searchable, words: string[]) {
  const label = item.label.toLowerCase();
  const rest = `${item.keywords ?? ''} ${item.detail ?? ''}`.toLowerCase();
  let total = 0;
  for (const word of words) {
    const inLabel = label.indexOf(word);
    if (inLabel === 0) continue;
    if (inLabel > 0) total += label[inLabel - 1] === ' ' ? 1 : 2;
    else if (rest.includes(word)) total += 10;
    else return null;
  }
  return total;
}

export function searchPalette<T extends Searchable>(items: T[], query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items.slice(0, resultLimit);
  const groups = [...new Set(items.map(item => item.group))];
  return groups
    .flatMap(group =>
      items
        .filter(item => item.group === group)
        .map(item => ({ item, score: score(item, words) }))
        .filter((entry): entry is { item: T; score: number } => entry.score !== null)
        .sort((a, b) => a.score - b.score)
        .map(entry => entry.item),
    )
    .slice(0, resultLimit);
}
