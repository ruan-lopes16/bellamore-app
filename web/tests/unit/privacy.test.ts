import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PRIVACY_KEY, readPrivacyPref, writePrivacyPref } from '@/lib/privacy';

describe('preferência de modo privado', () => {
  beforeEach(() => localStorage.clear());

  it('padrão é falso quando nada foi salvo', () => {
    expect(readPrivacyPref()).toBe(false);
  });

  it('grava e lê true (armazena "1")', () => {
    writePrivacyPref(true);
    expect(localStorage.getItem(PRIVACY_KEY)).toBe('1');
    expect(readPrivacyPref()).toBe(true);
  });

  it('grava e lê false (armazena "0")', () => {
    writePrivacyPref(true);
    writePrivacyPref(false);
    expect(localStorage.getItem(PRIVACY_KEY)).toBe('0');
    expect(readPrivacyPref()).toBe(false);
  });

  it('valor inesperado no storage é tratado como falso', () => {
    localStorage.setItem(PRIVACY_KEY, 'sim');
    expect(readPrivacyPref()).toBe(false);
  });

  describe('resiliência a localStorage indisponível', () => {
    let origGet: typeof Storage.prototype.getItem;
    let origSet: typeof Storage.prototype.setItem;
    beforeEach(() => {
      origGet = Storage.prototype.getItem;
      origSet = Storage.prototype.setItem;
      Storage.prototype.getItem = () => { throw new Error('blocked'); };
      Storage.prototype.setItem = () => { throw new Error('blocked'); };
    });
    afterEach(() => {
      Storage.prototype.getItem = origGet;
      Storage.prototype.setItem = origSet;
    });
    it('readPrivacyPref não lança e devolve false', () => {
      expect(() => readPrivacyPref()).not.toThrow();
      expect(readPrivacyPref()).toBe(false);
    });
    it('writePrivacyPref não lança', () => {
      expect(() => writePrivacyPref(true)).not.toThrow();
    });
  });
});
