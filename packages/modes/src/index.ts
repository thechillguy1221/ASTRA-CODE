export type ProjectFiles = Readonly<Record<string, string>>;

export type LearnDepth = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';

export interface LearnInput {
  files: ProjectFiles;
  path: string;
  depth: LearnDepth;
  question?: string;
}

export interface LearnResult {
  title: string;
  explanation: string;
  relevantPaths: string[];
  depth: LearnDepth;
}

export class LearnService {
  explain(input: LearnInput): LearnResult {
    const source = input.files[input.path];
    if (source === undefined) throw new Error(`Project file not found: ${input.path}`);

    const lines = source.split(/\r?\n/).length;
    const exports = [
      ...source.matchAll(
        /\b(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|const)\s+([A-Za-z_$][\w$]*)/g,
      ),
    ]
      .map((match) => match[1])
      .filter((name): name is string => Boolean(name));
    const symbols =
      exports.length > 0 ? exports.slice(0, 8).join(', ') : 'the code shown in this file';
    const questionText = input.question
      ? ` The question to keep in mind is: “${input.question}”`
      : '';
    const excerpt = source.trim().replace(/\s+/g, ' ').slice(0, 360);
    const detail =
      input.depth === 'BEGINNER'
        ? `At a beginner level, this file is a ${lines}-line part of the project. It defines ${symbols}. Read it as a set of responsibilities: what data enters, what the code changes, and what it returns.`
        : input.depth === 'INTERMEDIATE'
          ? `At an intermediate level, the important project surface is ${symbols}. Trace the inputs and outputs through this file, then check its callers and tests to confirm the intended contract.`
          : `At an advanced level, inspect the contract represented by ${symbols}, its error paths, and its callers. Validate the implementation against tests and the neighboring modules rather than treating the file in isolation.`;

    return {
      title: `Understanding ${input.path}`,
      explanation: `${detail}${questionText} Source snapshot: ${excerpt}`,
      relevantPaths: [input.path],
      depth: input.depth,
    };
  }
}

export type VivaCategory =
  | 'ARCHITECTURE'
  | 'DATABASE'
  | 'API'
  | 'AUTHENTICATION'
  | 'SECURITY'
  | 'DEPENDENCIES'
  | 'CODE_READING'
  | 'IMPLEMENTATION'
  | 'FAILURE_SCENARIOS'
  | 'DEPLOYMENT'
  | 'TESTING';
export type VivaDifficulty = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';

export interface VivaQuestion {
  id: string;
  category: VivaCategory;
  difficulty: VivaDifficulty;
  prompt: string;
  referencePath: string;
  expectedConcepts: string[];
}

export interface VivaGenerateInput {
  files: ProjectFiles;
  categories?: VivaCategory[];
  difficulty: VivaDifficulty;
  count?: number;
}

export interface VivaEvaluation {
  score: number;
  feedback: string;
  relevantPaths: string[];
  missingConcepts: string[];
}

const categoryTokens: Record<VivaCategory, string[]> = {
  ARCHITECTURE: ['architecture', 'server', 'app', 'router', 'service'],
  DATABASE: ['database', 'db', 'sql', 'repository', 'migration', 'schema'],
  API: ['api', 'route', 'controller', 'http', 'request'],
  AUTHENTICATION: ['auth', 'login', 'session', 'password', 'token', 'credential'],
  SECURITY: ['security', 'permission', 'secret', 'auth', 'crypto', 'guard'],
  DEPENDENCIES: ['package', 'lock', 'dependency', 'import', 'require'],
  CODE_READING: ['src', 'lib', 'code', 'function', 'class'],
  IMPLEMENTATION: ['src', 'lib', 'service', 'component'],
  FAILURE_SCENARIOS: ['error', 'catch', 'failure', 'retry', 'fallback'],
  DEPLOYMENT: ['docker', 'deploy', 'config', 'env', 'build'],
  TESTING: ['test', 'spec', 'fixture', 'verify', 'assert'],
};

function chooseReferencePath(files: ProjectFiles, category: VivaCategory): string | undefined {
  const paths = Object.keys(files).sort();
  const tokens = categoryTokens[category];
  const matches = paths.filter((path) =>
    tokens.some((token) => path.toLowerCase().includes(token)),
  );
  return matches.find((path) => !/(?:test|spec|fixture)/i.test(path)) ?? matches[0] ?? paths[0];
}

function conceptsFor(path: string, source: string, category: VivaCategory): string[] {
  const symbols = [
    ...source.matchAll(
      /\b(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|const)\s+([A-Za-z_$][\w$]*)/g,
    ),
  ]
    .map((match) => match[1])
    .filter((name): name is string => Boolean(name));
  const pathWords = path
    .toLowerCase()
    .split(/[\\/_.-]+/)
    .filter((word) => word.length >= 3)
    .slice(0, 3);
  const sourceWords = [...source.matchAll(/\b[A-Za-z][A-Za-z0-9_]{3,}\b/g)]
    .map((match) => match[0]!.toLowerCase())
    .filter((word) => !['export', 'async', 'function', 'return', 'true', 'false'].includes(word));
  return [
    ...new Set([
      category.toLowerCase(),
      ...pathWords,
      ...symbols.slice(0, 3),
      ...sourceWords.slice(0, 5),
    ]),
  ];
}

export class VivaService {
  generate(input: VivaGenerateInput): VivaQuestion[] {
    const categories = input.categories?.length
      ? input.categories
      : (['CODE_READING', 'ARCHITECTURE', 'TESTING'] as VivaCategory[]);
    const count = Math.max(1, Math.min(input.count ?? categories.length, 20));
    const questions: VivaQuestion[] = [];
    for (let index = 0; index < count; index += 1) {
      const category = categories[index % categories.length]!;
      const referencePath = chooseReferencePath(input.files, category);
      if (!referencePath) break;
      const source = input.files[referencePath]!;
      const expectedConcepts = conceptsFor(referencePath, source, category);
      const primaryConcept =
        expectedConcepts.find((concept) => concept !== category.toLowerCase()) ?? referencePath;
      questions.push({
        id: `viva-${index + 1}-${referencePath.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
        category,
        difficulty: input.difficulty,
        prompt: `Using ${referencePath}, explain how ${primaryConcept} contributes to the project's ${category.toLowerCase()} behavior and what could break if it changed.`,
        referencePath,
        expectedConcepts,
      });
    }
    return questions;
  }

  evaluate(question: VivaQuestion, answer: string, files: ProjectFiles): VivaEvaluation {
    const source = files[question.referencePath];
    if (source === undefined) throw new Error(`Project file not found: ${question.referencePath}`);
    const normalized = answer.toLowerCase();
    const matched = question.expectedConcepts.filter((concept) =>
      normalized.includes(concept.toLowerCase()),
    );
    const missingConcepts = question.expectedConcepts.filter(
      (concept) => !matched.includes(concept),
    );
    const score = Math.round(
      (matched.length / Math.max(question.expectedConcepts.length, 1)) * 100,
    );
    const feedback =
      score >= 70
        ? `Good repository-grounded answer. You connected ${question.referencePath} to ${question.category.toLowerCase()} behavior; verify the remaining details in the referenced file.`
        : `Your answer is a useful start, but revisit ${question.referencePath} in the project and explain the missing concepts: ${missingConcepts.join(', ') || 'the failure path'}.`;
    return { score, feedback, relevantPaths: [question.referencePath], missingConcepts };
  }
}

export interface HackathonInput {
  problem: string;
  criteria: string[];
}

export interface HackathonPlan {
  problem: string;
  mvpScope: string[];
  mustHave: string[];
  shouldHave: string[];
  future: string[];
  testing: string[];
  demoPlan: string;
  readmeOutline: string[];
  architectureSummary: string;
  judgeQuestions: string[];
}

export class HackathonService {
  plan(input: HackathonInput): HackathonPlan {
    const criteria = input.criteria.length ? input.criteria : ['working demo'];
    return {
      problem: input.problem,
      mvpScope: [
        `A focused workflow that addresses: ${input.problem}`,
        `A small end-to-end demo measured against: ${criteria.join(', ')}`,
      ],
      mustHave: [
        'One clear user journey',
        'Input validation and an actionable error state',
        'A working local or hosted demo',
        'A short README with setup and verification steps',
      ],
      shouldHave: [
        'One meaningful quality-of-life improvement',
        'A small set of realistic demo data',
        'A visible success metric tied to the judging criteria',
      ],
      future: [
        'Accounts and collaboration',
        'Deeper analytics and integrations',
        'Scale, performance, and accessibility improvements beyond the MVP',
      ],
      testing: [
        'Test the main happy path',
        'Test invalid input and the primary failure path',
        'Run the project verification command before the demo',
      ],
      demoPlan:
        'Demo the problem in one sentence, show the smallest successful workflow, trigger one meaningful result, and close by mapping the result to each judging criterion.',
      readmeOutline: [
        'Problem and target user',
        'MVP scope and non-goals',
        'Architecture and data flow',
        'Setup and verification',
        'Demo script and known limitations',
      ],
      architectureSummary:
        'Keep the MVP flow explicit: user input → validated application boundary → focused domain operation → observable result. Defer infrastructure that does not improve the judging path.',
      judgeQuestions: [
        'What user problem did you prioritize?',
        'Which trade-off kept the MVP credible within the time limit?',
        'How did you verify the main failure path?',
        'What would you build next and why?',
      ],
    };
  }
}
