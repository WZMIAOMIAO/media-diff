import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import AppDialog from '../dialog/AppDialog';
import { closeDialog, getCurrentDialog, showAlert, showConfirm } from '../dialog/store';
import { setLanguage } from '../i18n/store';

beforeEach(() => setLanguage('zh'));

afterEach(() => {
  cleanup();
  while (getCurrentDialog()) closeDialog(false);
});

describe('AppDialog', () => {
  it('renders and resolves an alert', async () => {
    const done = showAlert('Something happened');
    render(<AppDialog />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('提示')).toBeTruthy();
    expect(screen.getByText('Something happened')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    await done;
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('returns false when a confirm is cancelled', async () => {
    const result = showConfirm('Continue?');
    render(<AppDialog />);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await expect(result).resolves.toBe(false);
  });

  it('returns true when a confirm is accepted', async () => {
    const result = showConfirm('Continue?');
    render(<AppDialog />);
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    await expect(result).resolves.toBe(true);
  });
});
