import { describe, it, expect } from 'vitest';

/**
 * Agent tag parsing tests
 *
 * Tests the tag extraction logic used in processMessage.
 * We test the regex patterns directly since processMessage
 * requires a running Claude CLI subprocess.
 */

describe('Agent Tag Parsing', () => {
  const REMEMBER_REGEX = /\[REMEMBER\](.*?)\[\/REMEMBER\]/s;
  const TASK_REGEX = /\[TASK(?:\s+schedule="([^"]*)")?\](.*?)\[\/TASK\]/s;
  const CLEAN_REMEMBER = /\[REMEMBER\].*?\[\/REMEMBER\]/gs;
  const CLEAN_TASK = /\[TASK[^\]]*\].*?\[\/TASK\]/gs;

  describe('REMEMBER tag', () => {
    it('should extract remember content', () => {
      const response = 'Sure! [REMEMBER]User prefers TypeScript[/REMEMBER] I noted that.';
      const match = response.match(REMEMBER_REGEX);
      expect(match).not.toBeNull();
      expect(match![1].trim()).toBe('User prefers TypeScript');
    });

    it('should handle multiline remember content', () => {
      const response = '[REMEMBER]\nLine 1\nLine 2\n[/REMEMBER]';
      const match = response.match(REMEMBER_REGEX);
      expect(match).not.toBeNull();
      expect(match![1].trim()).toBe('Line 1\nLine 2');
    });

    it('should not match when no tag', () => {
      const response = 'Just a normal response without tags.';
      expect(response.includes('[REMEMBER]')).toBe(false);
    });
  });

  describe('TASK tag', () => {
    it('should extract task with schedule', () => {
      const response = '[TASK schedule="every 5 minutes"]Write a haiku[/TASK]';
      const match = response.match(TASK_REGEX);
      expect(match).not.toBeNull();
      expect(match![1]).toBe('every 5 minutes');
      expect(match![2].trim()).toBe('Write a haiku');
    });

    it('should extract task without schedule', () => {
      const response = '[TASK]Do something[/TASK]';
      const match = response.match(TASK_REGEX);
      expect(match).not.toBeNull();
      expect(match![1]).toBeUndefined();
      expect(match![2].trim()).toBe('Do something');
    });
  });

  describe('tag cleaning', () => {
    it('should remove REMEMBER tags from response', () => {
      const response = 'Got it! [REMEMBER]User likes cats[/REMEMBER] Anything else?';
      const cleaned = response.replace(CLEAN_REMEMBER, '').trim();
      expect(cleaned).toBe('Got it!  Anything else?');
    });

    it('should remove TASK tags from response', () => {
      const response = 'Scheduled! [TASK schedule="daily"]Check tasks[/TASK] Done.';
      const cleaned = response.replace(CLEAN_TASK, '').trim();
      expect(cleaned).toBe('Scheduled!  Done.');
    });

    it('should remove multiple tags', () => {
      const response =
        '[REMEMBER]Fact 1[/REMEMBER] [TASK schedule="hourly"]Task 1[/TASK] Clean text.';
      const cleaned = response
        .replace(CLEAN_REMEMBER, '')
        .replace(CLEAN_TASK, '')
        .trim();
      expect(cleaned).toBe('Clean text.');
    });
  });
});
