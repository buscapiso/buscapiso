import { render, screen } from '@testing-library/svelte';
import ExtensionBanner from './ExtensionBanner.svelte';
import userEvent from '@testing-library/user-event';
import { LATEST_EXTENSION } from '../extension';
import { ext, platform } from '../extensionState.svelte';

const missing = { installed: false, outdated: false, version: null, browser: null };

test('nothing is shown when the extension is there', () => {
  ext.status = { installed: true, outdated: false, version: LATEST_EXTENSION, browser: 'chrome' };
  const { container } = render(ExtensionBanner, { where: 'desktop' });
  expect(container.textContent?.trim()).toBe('');
});

test('on a computer without it, it says what it is for and how to get it', () => {
  ext.status = missing;
  render(ExtensionBanner, { where: 'desktop' });
  expect(screen.getByText(/add the buscapiso extension/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'How to install it' })).toHaveAttribute('href', '#/extension');
  expect(screen.getByRole('button', { name: "I've installed it" })).toBeInTheDocument();
});

test('on an iPad it points to importing instead', () => {
  ext.status = missing;
  render(ExtensionBanner, { where: 'apple' });
  expect(screen.getByText(/Searching needs a computer/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Import a file' })).toHaveAttribute('href', '#/settings/data');
  expect(screen.getByText(/Home Screen/)).toBeInTheDocument();
});

test('an old extension asks to be updated', () => {
  ext.status = { installed: true, outdated: true, version: '0.9.0', browser: 'firefox' };
  render(ExtensionBanner, { where: 'firefox' });
  expect(screen.getByText(/update the buscapiso extension/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'How to update' })).toHaveAttribute('href', '#/extension');
});

test('a working but older extension hears about the new version, until "Not now"', async () => {
  localStorage.clear();
  ext.status = { installed: true, outdated: false, version: '1.0.1', browser: 'chrome' };
  const first = render(ExtensionBanner, { where: 'desktop' });
  expect(screen.getByText(new RegExp(`Version ${LATEST_EXTENSION} of the extension is out`))).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
  expect(screen.queryByText(/of the extension is out/)).toBeNull();
  first.unmount();
  render(ExtensionBanner, { where: 'desktop' });
  expect(screen.queryByText(/of the extension is out/)).toBeNull();
});

test('the platform only chooses the help message', () => {
  expect(platform('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)', false)).toBe('apple');
  expect(platform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari', true)).toBe('apple');
  expect(platform('Mozilla/5.0 (Android 15; Mobile; rv:140.0) Gecko Firefox/140.0', false)).toBe('android-firefox');
  expect(platform('Mozilla/5.0 (Linux; Android 15) Chrome/141 Mobile', false)).toBe('android');
  expect(platform('Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0', false)).toBe('firefox');
  expect(platform('Mozilla/5.0 (Windows NT 10.0) Chrome/141 Edg/141', false)).toBe('desktop');
});
