import { describe, it, expect } from 'vitest';
import { parseTags } from '../src/dispatcher.js';

/**
 * Agent tag parsing tests
 *
 * Tests the XML namespace tag extraction logic used in processMessage.
 * Uses parseTags directly since processMessage requires a running Claude CLI subprocess.
 */

describe('Agent Tag Parsing', () => {
  describe('REMEMBER tag', () => {
    it('should extract remember content', () => {
      const response = 'Sure! <kuro:remember>User prefers TypeScript</kuro:remember> I noted that.';
      const result = parseTags(response);
      expect(result.remembers).toHaveLength(1);
      expect(result.remembers[0].content).toBe('User prefers TypeScript');
    });

    it('should handle multiline remember content', () => {
      const response = '<kuro:remember>\nLine 1\nLine 2\n</kuro:remember>';
      const result = parseTags(response);
      expect(result.remembers).toHaveLength(1);
      expect(result.remembers[0].content).toBe('Line 1\nLine 2');
    });

    it('should not match when no tag', () => {
      const response = 'Just a normal response without tags.';
      const result = parseTags(response);
      expect(result.remembers).toHaveLength(0);
    });
  });

  describe('TASK tag', () => {
    it('should extract task with schedule', () => {
      const response = '<kuro:task schedule="every 5 minutes">Write a haiku</kuro:task>';
      const result = parseTags(response);
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].schedule).toBe('every 5 minutes');
      expect(result.tasks[0].content).toBe('Write a haiku');
    });

    it('should extract task without schedule', () => {
      const response = '<kuro:task>Do something</kuro:task>';
      const result = parseTags(response);
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].schedule).toBeUndefined();
      expect(result.tasks[0].content).toBe('Do something');
    });
  });

  describe('tag cleaning', () => {
    it('should remove remember tags from response', () => {
      const response = 'Got it! <kuro:remember>User likes cats</kuro:remember> Anything else?';
      const result = parseTags(response);
      expect(result.cleanContent).toBe('Got it!  Anything else?');
    });

    it('should remove task tags from response', () => {
      const response = 'Scheduled! <kuro:task schedule="daily">Check tasks</kuro:task> Done.';
      const result = parseTags(response);
      expect(result.cleanContent).toBe('Scheduled!  Done.');
    });

    it('should remove multiple tags', () => {
      const response =
        '<kuro:remember>Fact 1</kuro:remember> <kuro:task schedule="hourly">Task 1</kuro:task> Clean text.';
      const result = parseTags(response);
      expect(result.cleanContent).toBe('Clean text.');
    });
  });
});
