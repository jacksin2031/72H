import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { JudgeFooter, LiveHeaderStatus, ProfileForm } from '../components/live-dashboard';
import { liveMessages } from '../lib/live-i18n';
import type { Language } from '../lib/contracts';

describe.each<Language>(['ja', 'en', 'zh-TW'])('first-use UI in %s', language => {
  const messages = liveMessages[language];
  it('does not claim monitoring or a source failure before the first session', () => {
    for (const networkLabel of [messages.sourceStale, messages.offline, messages.reconnecting]) {
      const html = renderToStaticMarkup(<LiveHeaderStatus hasSession={false} busy={false} networkLabel={networkLabel} messages={messages} />);
      expect(html).toContain(messages.setupRequired);
      expect(html).not.toContain(messages.monitor);
      expect(html).not.toContain(networkLabel);
    }
    const querying = renderToStaticMarkup(<LiveHeaderStatus hasSession={false} busy networkLabel={messages.sourceStale} messages={messages} />);
    expect(querying).toContain(messages.refreshing);
    expect(querying).not.toContain(messages.sourceStale);
  });
  it('preserves source and connectivity warnings once a session exists', () => {
    for (const networkLabel of [messages.sourceStale, messages.offline, messages.reconnecting]) {
      const html = renderToStaticMarkup(<LiveHeaderStatus hasSession busy={false} networkLabel={networkLabel} messages={messages} />);
      expect(html).toContain(messages.monitor);
      expect(html).toContain(networkLabel);
    }
  });
  it('starts mobile setup with only current location and its manually selected area', () => {
    const html = renderToStaticMarkup(<ProfileForm onboarding language={language} busy={false} submit={() => {}} title={messages.setup} copy={messages.startText} startLabel={messages.begin} messages={messages} />);
    expect(html).toContain(messages.whereNow);
    expect(html).toContain(messages.currentLocation);
    expect(html).toContain(messages.noArea);
    expect(html).toContain(messages.next);
    expect(html).not.toContain(messages.accommodation);
    expect(html).not.toContain(messages.partySize);
    expect(html.match(/<input /g)).toHaveLength(1);
  });
  it('renders the translated Judge / Demo footer once', () => {
    const html = renderToStaticMarkup(<JudgeFooter messages={messages} />);
    expect(html).toContain(`${messages.judge} →`);
    expect(html).not.toContain(`${messages.judge} / Demo`);
    expect(html).toContain('href="/demo"');
  });
});
