import { createRoot } from 'react-dom/client';

import '../shared/party.css';
import { App } from './App';

createRoot(document.getElementById('app')!).render(<App />);
