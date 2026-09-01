import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  notificationAsync: vi.fn(),
  platform: { OS: 'web' },
  selectionAsync: vi.fn(),
}));

vi.mock('expo-haptics', () => ({
  NotificationFeedbackType: { Error: 'error', Success: 'success', Warning: 'warning' },
  notificationAsync: mocks.notificationAsync,
  selectionAsync: mocks.selectionAsync,
}));
vi.mock('react-native', () => ({ Platform: mocks.platform }));

describe('haptic feedback', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.notificationAsync.mockReset().mockResolvedValue(undefined);
    mocks.selectionAsync.mockReset().mockResolvedValue(undefined);
  });

  it('is a no-op on web', async () => {
    mocks.platform.OS = 'web';
    const haptics = await import('./haptics');
    haptics.tap();
    haptics.success();
    haptics.warn();
    haptics.error();
    expect(mocks.selectionAsync).not.toHaveBeenCalled();
    expect(mocks.notificationAsync).not.toHaveBeenCalled();
  });

  it('maps native feedback types and absorbs device API failures', async () => {
    mocks.platform.OS = 'ios';
    mocks.selectionAsync.mockRejectedValue(new Error('unavailable'));
    mocks.notificationAsync.mockRejectedValue(new Error('unavailable'));
    const haptics = await import('./haptics');

    haptics.tap();
    haptics.success();
    haptics.warn();
    haptics.error();
    await Promise.resolve();

    expect(mocks.selectionAsync).toHaveBeenCalledOnce();
    expect(mocks.notificationAsync.mock.calls).toEqual([['success'], ['warning'], ['error']]);
  });
});
