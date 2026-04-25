import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private _isDark = signal(false);
  isDark = this._isDark.asReadonly();

  constructor() {
    const stored = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const dark = stored === 'dark' || (!stored && prefersDark);
    this._isDark.set(dark);
    this.applyTheme(dark);
  }

  toggle(): void {
    const next = !this._isDark();
    this._isDark.set(next);
    this.applyTheme(next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
  }

  private applyTheme(dark: boolean): void {
    document.documentElement.classList.toggle('dark', dark);
  }
}
