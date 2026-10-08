import { mount } from 'svelte';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource/atkinson-hyperlegible-next/400.css';
import '@fontsource/atkinson-hyperlegible-next/700.css';
import './app.css';
import App from './App.svelte';

mount(App, { target: document.getElementById('app')! });
