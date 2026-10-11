import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import ExtensionGuide from './ExtensionGuide.svelte';
import { ext } from '../lib/extensionState.svelte';
import { LATEST_EXTENSION } from '../lib/extension';

// La guia pregunta a la extension cada pocos segundos; aqui el estado se pone a mano.
vi.mock('../lib/extension', async (orig) => ({ ...(await orig<typeof import('../lib/extension')>()),
  detectExtension: async () => ext.status }));

const missing = { installed: false, outdated: false, version: null, browser: null };

test('without the extension: what it reads, and the Chrome steps with the download and the address to copy', async () => {
  ext.status = missing;
  render(ExtensionGuide, { where: 'desktop' });
  expect(await screen.findByText(/Not installed in this browser yet/)).toBeInTheDocument();
  expect(screen.getByText(/It reads only .*Badi.*Spotahome/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Download buscapiso-chrome.zip' })).toHaveAttribute('href', expect.stringContaining('buscapiso-chrome.zip'));
  expect(screen.getByText('chrome://extensions')).toBeInTheDocument();
  expect(screen.getByText(/Load unpacked/)).toBeInTheDocument();
});

test('Firefox gets its two steps, and the other browser is one click away', async () => {
  ext.status = missing;
  render(ExtensionGuide, { where: 'firefox' });
  expect(screen.getByRole('link', { name: 'Download buscapiso-firefox.xpi' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /Chrome, Edge/ }));
  expect(screen.getByRole('link', { name: 'Download buscapiso-chrome.zip' })).toBeInTheDocument();
});

test('an older version gets the update steps', async () => {
  ext.status = { installed: true, outdated: false, version: '1.0.1', browser: 'chrome' };
  render(ExtensionGuide, { where: 'desktop' });
  expect(screen.getByRole('heading', { name: 'Update the extension' })).toBeInTheDocument();
  expect(screen.getByText(new RegExp(`You have version 1.0.1. Version ${LATEST_EXTENSION} adds`))).toBeInTheDocument();
  expect(screen.getByText(/Unzip it into the same folder/)).toBeInTheDocument();
  expect(screen.getByText(/press the reload arrow/)).toBeInTheDocument();
});

test('the latest version says it is ready', () => {
  ext.status = { installed: true, outdated: false, version: LATEST_EXTENSION, browser: 'firefox' };
  render(ExtensionGuide, { where: 'firefox' });
  expect(screen.getByText(new RegExp(`Connected: version ${LATEST_EXTENSION}`))).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Go to Rooms' })).toHaveAttribute('href', '#/');
});

test('on an iPad it says why, and points to importing', () => {
  ext.status = missing;
  render(ExtensionGuide, { where: 'apple' });
  expect(screen.getByText(/iPhone, iPad and Chrome on Android can't run extensions/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Import a file' })).toHaveAttribute('href', '#/settings/data');
});
