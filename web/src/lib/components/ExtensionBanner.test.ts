import { render, screen } from '@testing-library/svelte';
import ExtensionBanner from './ExtensionBanner.svelte';
import { ext, platform } from '../extensionState.svelte';

const missing = { installed: false, outdated: false, version: null, browser: null };

test('nothing is shown when the extension is there', () => {
  ext.status = { installed: true, outdated: false, version: '1.0.0', browser: 'chrome' };
  const { container } = render(ExtensionBanner, { where: 'desktop' });
  expect(container.textContent?.trim()).toBe('');
});

test('on a computer without it, it says what it is for and how to get it', () => {
  ext.status = missing;
  render(ExtensionBanner, { where: 'desktop' });
  expect(screen.getByText(/add the buscapiso extension/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'How to install it' })).toHaveAttribute('target', '_blank');
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
});

test('the platform only chooses the help message', () => {
  expect(platform('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)', false)).toBe('apple');
  expect(platform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari', true)).toBe('apple');
  expect(platform('Mozilla/5.0 (Android 15; Mobile; rv:140.0) Gecko Firefox/140.0', false)).toBe('android-firefox');
  expect(platform('Mozilla/5.0 (Linux; Android 15) Chrome/141 Mobile', false)).toBe('android');
  expect(platform('Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0', false)).toBe('firefox');
  expect(platform('Mozilla/5.0 (Windows NT 10.0) Chrome/141 Edg/141', false)).toBe('desktop');
});
