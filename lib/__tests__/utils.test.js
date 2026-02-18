import { withFallback } from '../utils.js';

describe('withFallback', () => {
  test('should return function result on success', async () => {
    const result = await withFallback(() => Promise.resolve('ok'), 'fallback');
    expect(result).toBe('ok');
  });

  test('should return fallback value on error', async () => {
    const result = await withFallback(
      () => {
        throw new Error('fail');
      },
      'fallback'
    );
    expect(result).toBe('fallback');
  });

  test('should return fallback for rejected promises', async () => {
    const result = await withFallback(() => Promise.reject(new Error('fail')), []);
    expect(result).toEqual([]);
  });
});
