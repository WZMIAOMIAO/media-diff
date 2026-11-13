import { describe, expect, it } from 'vitest';
import { isWithinAnyRoot } from '../utils/path';

describe('isWithinAnyRoot', () => {
  const roots = ['/data/a', '/data/b'];

  it('matches a path inside any of several roots', () => {
    expect(isWithinAnyRoot('/data/a', roots)).toBe(true);
    expect(isWithinAnyRoot('/data/a/sub/x.png', roots)).toBe(true);
    expect(isWithinAnyRoot('/data/b/y.png', roots)).toBe(true);
  });

  it('rejects a path outside every root', () => {
    expect(isWithinAnyRoot('/data/c/z.png', roots)).toBe(false);
    expect(isWithinAnyRoot('/etc/passwd', roots)).toBe(false);
  });

  it('does not treat a sibling with the same prefix as inside', () => {
    expect(isWithinAnyRoot('/data/bar', ['/data/b'])).toBe(false);
  });

  it('handles Windows separators', () => {
    expect(isWithinAnyRoot('C:\\data\\b\\x.png', ['C:/data/b'])).toBe(true);
  });

  it('returns false for an empty root list', () => {
    expect(isWithinAnyRoot('/anything', [])).toBe(false);
  });
});
