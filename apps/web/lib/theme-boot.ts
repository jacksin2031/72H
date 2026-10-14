/** Inline pre-hydration script for app/layout.tsx: applies a saved contrast/system theme before first paint so those users
 * never see a dark frame. Any storage error (private mode, disabled storage) leaves the server default (dark). Static text only. */
export const THEME_BOOT_SCRIPT = "try{var t=localStorage.getItem('72h-theme');if(t==='system'||t==='contrast')document.documentElement.dataset.theme=t}catch(e){}";
