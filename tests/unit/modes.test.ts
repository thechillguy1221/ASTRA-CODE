import { describe, expect, it } from 'vitest';
import { HackathonService, LearnService, VivaService } from '@lyntar/modes';

const files = {
  'src/auth.ts': `export function validateEmail(value: string): boolean { return value.includes('@'); }`,
  'src/auth.test.ts': `it('rejects invalid email', () => expect(validateEmail('nope')).toBe(false));`,
  'src/server.ts': `export function createServer() { return { auth: true }; }`,
};

describe('student modes', () => {
  it('grounds Learn explanations in the selected file and depth', () => {
    const result = new LearnService().explain({
      files,
      path: 'src/auth.ts',
      depth: 'BEGINNER',
      question: 'Why validate email?',
    });

    expect(result.title).toContain('src/auth.ts');
    expect(result.explanation).toMatch(/validateEmail|email/i);
    expect(result.explanation).toMatch(/beginner/i);
    expect(result.relevantPaths).toEqual(['src/auth.ts']);
  });

  it('generates and evaluates Viva questions against real project paths', () => {
    const service = new VivaService();
    const questions = service.generate({
      files,
      categories: ['AUTHENTICATION'],
      difficulty: 'INTERMEDIATE',
      count: 2,
    });

    expect(questions).toHaveLength(2);
    expect(
      questions.every(
        (question) =>
          question.referencePath === 'src/auth.ts' || question.referencePath === 'src/auth.test.ts',
      ),
    ).toBe(true);

    const evaluation = service.evaluate(
      questions[0]!,
      'The function checks whether the value contains an at sign.',
      files,
    );
    expect(evaluation.score).toBeGreaterThan(0);
    expect(evaluation.relevantPaths).toContain(questions[0]!.referencePath);
    expect(evaluation.feedback).toMatch(/repository|project|file/i);
  });

  it('creates a credible MVP plan from a problem and judging criteria', () => {
    const result = new HackathonService().plan({
      problem: 'Help students track project deadlines.',
      criteria: ['working demo', 'clear user value'],
    });

    expect(result.mvpScope.length).toBeGreaterThan(0);
    expect(result.mustHave.length).toBeGreaterThan(0);
    expect(result.future.length).toBeGreaterThan(0);
    expect(result.testing.length).toBeGreaterThan(0);
    expect(result.demoPlan).toMatch(/demo/i);
    expect(result.judgeQuestions.some((question) => question.toLowerCase().includes('trade'))).toBe(
      true,
    );
  });

  it('rejects Learn requests for files that are not in the local project snapshot', () => {
    expect(() =>
      new LearnService().explain({ files, path: 'src/missing.ts', depth: 'ADVANCED' }),
    ).toThrow('not found');
  });
});
