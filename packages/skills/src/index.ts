export type SkillMode = 'AUTO' | 'ON' | 'OFF';

export interface SkillMetadata {
  id: string;
  name: string;
  publisher: string;
  description: string;
  version: string;
  source: 'built-in' | 'project' | 'installed' | 'available';
  license: string;
  status: 'BUILT_IN' | 'INSTALLED' | 'AVAILABLE';
  mode: SkillMode;
  triggers: string[];
}

export interface SkillEntry extends SkillMetadata {
  instruction: string;
  resources: SkillResource[];
}

export interface SkillResource {
  kind: 'reference' | 'script' | 'template' | 'validation';
  path: string;
  content: string;
}

export interface SkillPackage {
  metadata: SkillMetadata;
  instruction: string;
  resources?: SkillResource[];
}

export class SkillRegistry {
  private readonly entries = new Map<string, SkillEntry>();

  register(metadata: SkillMetadata, instruction: string, resources: SkillResource[] = []): void {
    if (this.entries.has(metadata.id)) throw new Error(`Skill already registered: ${metadata.id}`);
    this.entries.set(metadata.id, {
      ...metadata,
      triggers: [...metadata.triggers],
      instruction,
      resources: resources.map((resource) => ({ ...resource })),
    });
  }

  registerPackage(skill: SkillPackage): void {
    this.register(skill.metadata, skill.instruction, skill.resources);
  }

  list(): Array<SkillMetadata & { instruction?: undefined }> {
    return [...this.entries.values()].map((entry) => {
      const { instruction, ...metadata } = entry;
      void instruction;
      return metadata;
    });
  }

  load(id: string): SkillEntry {
    const skill = this.entries.get(id);
    if (!skill) throw new Error(`Skill not found: ${id}`);
    return {
      ...skill,
      triggers: [...skill.triggers],
      resources: skill.resources.map((resource) => ({ ...resource })),
    };
  }
}

export class SkillRouter {
  constructor(private readonly registry: SkillRegistry) {}

  list(): Array<SkillMetadata & { instruction?: undefined }> {
    return this.registry.list();
  }

  route(task: string): Array<SkillMetadata & { instruction?: undefined }> {
    const normalized = task.toLowerCase();
    return this.registry
      .list()
      .filter((skill) => skill.mode !== 'OFF')
      .map((skill) => ({
        skill,
        score: skill.triggers.filter((trigger) => normalized.includes(trigger)).length,
      }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score)
      .map(({ skill }) => skill);
  }

  load(id: string): SkillEntry {
    return this.registry.load(id);
  }
}

function metadata(
  id: string,
  name: string,
  description: string,
  triggers: string[],
): SkillMetadata {
  return {
    id,
    name,
    publisher: 'Astra Code',
    description,
    version: '1.0.0',
    source: 'built-in',
    license: 'UNLICENSED',
    status: 'BUILT_IN',
    mode: 'AUTO',
    triggers,
  };
}

export function createEssentialsRegistry(): SkillRegistry {
  const registry = new SkillRegistry();
  registry.registerPackage({
    metadata: metadata(
      'ponytail',
      'Ponytail',
      'Smallest sufficient implementation and minimal dependency guidance.',
      ['smallest', 'unnecessary', 'reuse', 'simple'],
    ),
    instruction:
      '# Ponytail\n\nChoose the smallest sufficient implementation. Reuse existing code, avoid unnecessary dependencies and abstractions, and respect explicit user requirements.',
    resources: [
      {
        kind: 'validation',
        path: 'SKILL.md',
        content: '# Ponytail\n\nChoose the smallest sufficient implementation.',
      },
    ],
  });
  registry.registerPackage({
    metadata: metadata(
      'frontend-design',
      'Frontend Design',
      'Design-system-aware interface implementation guidance.',
      ['landing', 'dashboard', 'form', 'responsive', 'component', 'design system'],
    ),
    instruction:
      '# Frontend Design\n\nInspect and reuse the existing design system. Cover responsive, focus, loading, error, and accessibility states without generic AI styling.',
    resources: [
      {
        kind: 'validation',
        path: 'SKILL.md',
        content: '# Frontend Design\n\nReuse the design system.',
      },
    ],
  });
  registry.registerPackage({
    metadata: metadata(
      'ui-ux-quality',
      'UI/UX Quality',
      'Interaction, usability, accessibility, and state-quality guidance.',
      ['interaction', 'navigation', 'spacing', 'accessibility', 'usability', 'motion'],
    ),
    instruction:
      '# UI/UX Quality\n\nReview hierarchy, navigation, spacing, forms, states, reduced motion, keyboard access, and responsive behavior.',
    resources: [
      {
        kind: 'validation',
        path: 'SKILL.md',
        content: '# UI/UX Quality\n\nReview interaction states.',
      },
    ],
  });
  registry.registerPackage({
    metadata: metadata(
      'verification',
      'Verification',
      'Evidence-before-claims completion workflow.',
      ['verify', 'verification', 'test', 'build', 'lint', 'typecheck', 'complete', 'completion'],
    ),
    instruction:
      '# Verification\n\nRun only relevant typecheck, lint, build, tests, runtime, browser, and diff checks before claiming completion. Report blocked checks explicitly.',
    resources: [
      { kind: 'validation', path: 'SKILL.md', content: '# Verification\n\nRequire evidence.' },
    ],
  });
  registry.registerPackage({
    metadata: metadata(
      'security-review',
      'Security Review',
      'Focused security review for sensitive boundaries.',
      [
        'auth',
        'authentication',
        'permission',
        'payment',
        'secret',
        'database',
        'cryptography',
        'security',
      ],
    ),
    instruction:
      '# Security Review\n\nReview authorization, secrets, payment state, database boundaries, cryptography, network inputs, and least privilege. Keep the review scoped to touched behavior.',
    resources: [
      {
        kind: 'validation',
        path: 'SKILL.md',
        content: '# Security Review\n\nReview sensitive boundaries.',
      },
    ],
  });
  return registry;
}
