'use client';
import { useEffect, useState } from 'react';

export type Theme = 'dark' | 'system' | 'contrast';
export function useTheme() {
  const [theme, setTheme] = useState<Theme>('dark');
  useEffect(() => {
    try {
      const saved = localStorage.getItem('72h-theme');
      if (saved === 'dark' || saved === 'system' || saved === 'contrast') setTheme(saved);
    } catch { /* In-memory settings remain usable. */ }
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const chooseTheme = (value: string) => {
    if (value !== 'dark' && value !== 'system' && value !== 'contrast') return;
    setTheme(value);
    try { localStorage.setItem('72h-theme', value); } catch { /* In-memory fallback. */ }
  };
  return { theme, chooseTheme };
}
