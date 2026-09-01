import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { confirm } from './confirm';

const mocks = vi.hoisted(() => ({ alert: vi.fn(), platform: { OS: 'web' } }));

vi.mock('react-native', () => ({ Alert: { alert: mocks.alert }, Platform: mocks.platform }));

describe('cross-platform confirmation', () => {
  beforeEach(() => {
    mocks.platform.OS = 'web';
    mocks.alert.mockReset();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('returns the browser confirmation choice with context', async () => {
    const browserConfirm = vi.fn().mockReturnValue(false);
    vi.stubGlobal('window', { confirm: browserConfirm });

    await expect(confirm('Delete file?', 'This cannot be undone.')).resolves.toBe(false);
    expect(browserConfirm).toHaveBeenCalledWith('Delete file?\n\nThis cannot be undone.');
  });

  it('defaults to confirmation during web server rendering where no window exists', async () => {
    await expect(confirm('Continue?', 'Render safely.')).resolves.toBe(true);
  });

  it('maps both native alert actions and preserves destructive intent', async () => {
    mocks.platform.OS = 'android';
    let actions: { text: string; style: string; onPress: () => void }[] = [];
    mocks.alert.mockImplementation((_title, _message, nextActions) => {
      actions = nextActions;
    });

    const canceled = confirm('Delete?', 'Confirm delete.', 'Delete', true);
    actions[0].onPress();
    await expect(canceled).resolves.toBe(false);

    const accepted = confirm('Delete?', 'Confirm delete.', 'Delete', true);
    expect(actions[1]).toMatchObject({ text: 'Delete', style: 'destructive' });
    actions[1].onPress();
    await expect(accepted).resolves.toBe(true);
  });
});
