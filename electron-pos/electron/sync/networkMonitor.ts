import dns from 'dns';
import { EventEmitter } from 'events';

class NetworkMonitor extends EventEmitter {
  public isOnline = true;
  private interval: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.startMonitoring();
  }

  private startMonitoring() {
    // Check every 10 seconds
    this.interval = setInterval(() => this.checkInternet(), 10000);
    // Initial check
    this.checkInternet();
  }

  private checkInternet() {
    dns.lookup('google.com', (err) => {
      const wasOnline = this.isOnline;
      this.isOnline = !err;

      if (!wasOnline && this.isOnline) {
        this.emit('online');
      } else if (wasOnline && !this.isOnline) {
        this.emit('offline');
      }
    });
  }

  stopMonitoring() {
    if (this.interval) clearInterval(this.interval);
  }
}

export const networkMonitor = new NetworkMonitor();
