export interface FeatureFlag {
  key: string;
  enabled: boolean;
  configuration: Record<string, unknown>;
}

export class FeatureFlagRegistry {
  private readonly flags = new Map<string, FeatureFlag>();

  define(flag: FeatureFlag): void {
    this.flags.set(flag.key, { ...flag, configuration: { ...flag.configuration } });
  }

  set(key: string, enabled: boolean, configuration: Record<string, unknown> = {}): void {
    const current = this.flags.get(key);
    this.flags.set(key, {
      key,
      enabled,
      configuration: { ...(current?.configuration ?? {}), ...configuration },
    });
  }

  isEnabled(key: string): boolean {
    return this.flags.get(key)?.enabled ?? false;
  }

  get(key: string): FeatureFlag | undefined {
    const flag = this.flags.get(key);
    return flag ? { ...flag, configuration: { ...flag.configuration } } : undefined;
  }

  list(): FeatureFlag[] {
    return [...this.flags.values()].map((flag) => ({
      ...flag,
      configuration: { ...flag.configuration },
    }));
  }
}
