import { describe, expect, it } from 'vitest';

import { collaboraBooleanValue, parseCollaboraLaunch, parseCollaboraMessage } from './collabora-protocol';

describe('Collabora launch validation', () => {
  it('extracts credentials from a validated HTTPS action', () => {
    expect(
      parseCollaboraLaunch(
        'https://office.example.com/browser/abc/cool.html?WOPISrc=https%3A%2F%2Fapi.example.com%2Fwopi&access_token=secret&access_token_ttl=1700000000000',
      ),
    ).toEqual({
      action: 'https://office.example.com/browser/abc/cool.html?WOPISrc=https%3A%2F%2Fapi.example.com%2Fwopi',
      accessToken: 'secret',
      accessTokenTtl: '1700000000000',
      origin: 'https://office.example.com',
    });
  });

  it('allows an HTTP local development server', () => {
    expect(parseCollaboraLaunch('http://localhost:9980/editor?access_token=dev')?.origin).toBe(
      'http://localhost:9980',
    );
  });

  it.each([
    '',
    '/relative/editor',
    '//office.example.com/editor',
    'javascript:alert(1)',
    'data:text/html,unsafe',
    'https://user:password@office.example.com/editor',
  ])('fails closed for unsafe launch URL %j', (url) => {
    expect(parseCollaboraLaunch(url)).toBeNull();
  });

  it('normalizes a malformed token expiry', () => {
    expect(
      parseCollaboraLaunch('https://office.example.com/editor?access_token_ttl=tomorrow')?.accessTokenTtl,
    ).toBe('0');
  });
});

describe('Collabora messages', () => {
  it('parses object and JSON messages with record values', () => {
    expect(parseCollaboraMessage({ MessageId: 'Doc_ModifiedStatus', Values: { Modified: true } })).toEqual({
      MessageId: 'Doc_ModifiedStatus',
      Values: { Modified: true },
    });
    expect(parseCollaboraMessage('{"MessageId":"Action_Save_Resp"}')).toEqual({
      MessageId: 'Action_Save_Resp',
    });
  });

  it.each([null, 4, '{}', '{bad json', { MessageId: '' }, { MessageId: 'save', Values: [] }])(
    'rejects malformed message %j',
    (message) => {
      expect(parseCollaboraMessage(message)).toBeNull();
    },
  );

  it('only accepts explicit boolean representations', () => {
    expect(collaboraBooleanValue({ value: true }, 'value')).toBe(true);
    expect(collaboraBooleanValue({ value: 'FALSE' }, 'value')).toBe(false);
    expect(collaboraBooleanValue({ value: 'yes' }, 'value')).toBeUndefined();
    expect(collaboraBooleanValue({ value: 1 }, 'value')).toBeUndefined();
  });
});
