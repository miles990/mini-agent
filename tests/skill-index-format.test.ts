import { describe, it, expect } from 'vitest';
import { formatSkillIndex } from '../src/perception.js';
import type { LoadedSkill } from '../src/perception.js';

// Helper to build a minimal LoadedSkill fixture
function makeSkill(name: string, keywords: string[] = [], modes: string[] = []): LoadedSkill {
  return { name, content: `# ${name}\nsome content`, keywords, modes, filePath: `/skills/${name}.md`, mtime: 0 };
}

describe('formatSkillIndex', () => {
  it('returns empty string for empty list', () => {
    expect(formatSkillIndex([])).toBe('');
  });

  it('outputs single-line comma-separated names', () => {
    const skills = [makeSkill('github-ops'), makeSkill('delegation'), makeSkill('friction-reducer')];
    const result = formatSkillIndex(skills);
    expect(result).toBe('\nAvailable skills: github-ops, delegation, friction-reducer\n');
  });

  it('does NOT include keywords in index output', () => {
    const skills = [makeSkill('github-ops', ['publish', 'pr', 'issue'])];
    const result = formatSkillIndex(skills);
    expect(result).not.toContain('publish');
    expect(result).not.toContain('pr');
    expect(result).not.toContain('issue');
  });

  it('does NOT include markdown bullet list format', () => {
    const skills = [makeSkill('skill-a'), makeSkill('skill-b')];
    const result = formatSkillIndex(skills);
    expect(result).not.toContain('- skill-a');
    expect(result).not.toContain('## Other Available Skills');
  });

  it('handles single skill', () => {
    const skills = [makeSkill('delegation')];
    const result = formatSkillIndex(skills);
    expect(result).toBe('\nAvailable skills: delegation\n');
  });

  it('output is substantially smaller than old bullet format with keywords', () => {
    const manySkills = Array.from({ length: 10 }, (_, i) =>
      makeSkill(`skill-${i}`, ['kw1', 'kw2', 'kw3', 'kw4', 'kw5'])
    );
    const result = formatSkillIndex(manySkills);
    // New format should be well under 200 chars for 10 skills; old format with keywords was ~350+
    expect(result.length).toBeLessThan(200);
  });
});
