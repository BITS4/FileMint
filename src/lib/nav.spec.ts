import { beforeEach, describe, expect, it, vi } from 'vitest';
import { goBack } from './nav';

const router = vi.hoisted(() => ({ back: vi.fn(), canGoBack: vi.fn(), replace: vi.fn() }));

vi.mock('expo-router', () => ({ router }));

describe('safe back navigation', () => {
  beforeEach(() => {
    router.back.mockReset();
    router.canGoBack.mockReset();
    router.replace.mockReset();
  });

  it('uses navigation history when it exists', () => {
    router.canGoBack.mockReturnValue(true);
    goBack();
    expect(router.back).toHaveBeenCalledOnce();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('replaces a history-less deep link with home', () => {
    router.canGoBack.mockReturnValue(false);
    goBack();
    expect(router.replace).toHaveBeenCalledWith('/');
    expect(router.back).not.toHaveBeenCalled();
  });
});
