export interface TerminalNotification {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  subtitle?: string;
}

export interface BezelFlash {
  color: 'green' | 'red' | 'amber';
  key: number;
}

class NotificationManager {
  current = $state<TerminalNotification | null>(null);
  bezel = $state<BezelFlash | null>(null);
  private timer: any = null;
  private bezelTimer: any = null;
  private counter = 0;

  show(type: 'success' | 'error' | 'info' | 'warning', title: string, subtitle?: string, durationMs = 2200) {
    if (this.timer) clearTimeout(this.timer);
    
    this.current = {
      id: String(++this.counter),
      type,
      title,
      subtitle
    };

    // Trigger perimeter bezel flash
    if (type === 'success' || type === 'error' || type === 'warning') {
      this.triggerBezel(type === 'success' ? 'green' : type === 'error' ? 'red' : 'amber');
    }

    this.timer = setTimeout(() => {
      this.current = null;
    }, durationMs);
  }

  triggerBezel(color: 'green' | 'red' | 'amber') {
    if (this.bezelTimer) clearTimeout(this.bezelTimer);
    this.bezel = { color, key: ++this.counter };
    this.bezelTimer = setTimeout(() => {
      this.bezel = null;
    }, 450);
  }

  clear() {
    if (this.timer) clearTimeout(this.timer);
    this.current = null;
  }
}

export const notificationHub = new NotificationManager();
