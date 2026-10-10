import React from 'react';

export type IconName = 'home' | 'plan' | 'more' | 'bell' | 'warning' | 'arrow' | 'close';

/** Fixed viewBox and stroke keep icons aligned across fonts, languages and zoom levels. */
export function UiIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v12h5v-7h4v7h5V9" /></>,
    plan: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
    more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
    warning: <><path d="m12 3 10 18H2L12 3ZM12 9v5M12 17v.1" /></>,
    arrow: <><path d="M4 12h16m-6-6 6 6-6 6" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />,
  };
  return <svg className="ui-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}
