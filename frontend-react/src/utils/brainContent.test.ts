import { describe, it, expect } from 'vitest';
import { fetchBrainContent } from './brainContent';

const answer = (data: unknown) => ({ get: async () => ({ data }) });
const online = { aiServiceMode: 'online' };

describe('fetchBrainContent', () => {
  it('passes a pooled joke / fact / exit line through with its translations', async () => {
    const res = await fetchBrainContent(answer({ type: 'EXIT', content: 'Back after one lap!', all_translations: { en: 'x' } }), 'exit', 'en', online);
    expect(res).toEqual({ text: 'Back after one lap!', translations: { en: 'x' } });
  });

  it("marks the cow's / star's daily-quota line so it is shown but never saved", async () => {
    for (const category of ['joke', 'fact'] as const) {
      const res = await fetchBrainContent(answer({ type: 'QUOTA', content: 'More tomorrow!' }), category, 'en', online);
      expect(res).toEqual({ text: 'More tomorrow!', quota: true });
    }
    expect(await fetchBrainContent(answer({ type: 'QUOTA', content: 'x' }), 'exit', 'en', online)).toBeNull();
  });

  it('rejects a mismatched type and falls back when offline or empty', async () => {
    expect(await fetchBrainContent(answer({ type: 'FACT', content: 'A fact' }), 'joke', 'en', online)).toBeNull();
    expect(await fetchBrainContent(answer({ type: 'NONE', content: null }), 'exit', 'en', online)).toBeNull();
    expect(await fetchBrainContent(answer({ type: 'EXIT', content: 'x' }), 'exit', 'en', { aiServiceMode: 'autonomous' })).toBeNull();
  });
});
