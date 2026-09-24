let ctx: AudioContext | null = null;

function getContext() {
  if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  return ctx;
}

export function playSuccess() {
  const c = getContext();
  const osc = c.createOscillator();
  const gain = c.createGain();
  
  osc.type = 'sine';
  osc.frequency.setValueAtTime(440, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(880, c.currentTime + 0.1);
  
  gain.gain.setValueAtTime(0.1, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, c.currentTime + 0.2);
  
  osc.connect(gain);
  gain.connect(c.destination);
  
  osc.start();
  osc.stop(c.currentTime + 0.2);
}

export function playError() {
  const c = getContext();
  const osc = c.createOscillator();
  const gain = c.createGain();
  
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(150, c.currentTime);
  
  gain.gain.setValueAtTime(0.2, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, c.currentTime + 0.4);
  
  osc.connect(gain);
  gain.connect(c.destination);
  
  osc.start();
  osc.stop(c.currentTime + 0.4);
}

export function playBeep() {
  const c = getContext();
  const osc = c.createOscillator();
  const gain = c.createGain();
  
  osc.type = 'sine';
  osc.frequency.setValueAtTime(600, c.currentTime);
  
  gain.gain.setValueAtTime(0.1, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, c.currentTime + 0.1);
  
  osc.connect(gain);
  gain.connect(c.destination);
  
  osc.start();
  osc.stop(c.currentTime + 0.1);
}
