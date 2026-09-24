import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';

const app = mount(App, {
  target: document.getElementById('app')!
});

// Register PWA
import { registerSW } from 'virtual:pwa-register';
registerSW({ immediate: true });

// Request Wake Lock
if ('wakeLock' in navigator) {
  let wakeLock = null;
  const requestWakeLock = async () => {
    try {
      wakeLock = await (navigator as any).wakeLock.request('screen');
    } catch (err) {
      console.error(err);
    }
  };
  requestWakeLock();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestWakeLock();
  });
}

export default app;