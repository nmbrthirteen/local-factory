import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './styles/app.css';
import { createRoot } from 'react-dom/client';
import App from './components/app/App';
import { ConfirmProvider } from './components/app/ConfirmProvider';

const scheme = matchMedia('(prefers-color-scheme: dark)');
const applyScheme = () => document.documentElement.classList.toggle('dark', scheme.matches);
applyScheme();
scheme.addEventListener('change', applyScheme);

createRoot(document.getElementById('root')!).render(
  <ConfirmProvider>
    <App />
  </ConfirmProvider>,
);
