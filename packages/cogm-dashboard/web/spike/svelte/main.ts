import { mount } from 'svelte';

import '../shared/party.css';
import App from './App.svelte';

mount(App, { target: document.getElementById('app')! });
