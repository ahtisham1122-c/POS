import fs from 'fs';
import path from 'path';
import { app } from 'electron';

class Logger {
  private logPath: string | null = null;

  private ensureLogPath() {
    if (this.logPath) return this.logPath;
    const logsDir = app.isReady() ? app.getPath('logs') : path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    this.logPath = path.join(logsDir, 'noon-dairy.log');
    return this.logPath;
  }

  private write(level: string, ...args: any[]) {
    const timestamp = new Date().toISOString();
    const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
    const logLine = `[${timestamp}] [${level}] ${message}\n`;
    
    // Console output for dev
    if (process.env.NODE_ENV === 'development') {
      console.log(logLine.trim());
    }
    
    // File output
    fs.appendFileSync(this.ensureLogPath(), logLine);
  }

  info(...args: any[]) { this.write('INFO', ...args); }
  warn(...args: any[]) { this.write('WARN', ...args); }
  error(...args: any[]) { this.write('ERROR', ...args); }
  debug(...args: any[]) { this.write('DEBUG', ...args); }
}

export default new Logger();
