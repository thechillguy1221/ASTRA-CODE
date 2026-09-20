import { LocalCommandRunner, type CommandResult } from './commands.js';
import { detectProjectProfile, type ProjectProfile } from './project-detector.js';
import type { CanonicalWorkspace } from './path-security.js';

export interface VerificationResult {
  status: 'passed' | 'failed' | 'unavailable' | 'cancelled';
  command?: string;
  result?: CommandResult;
  summary: string;
  profile: ProjectProfile;
}

export async function verifyProject(
  workspace: CanonicalWorkspace,
  signal: AbortSignal,
): Promise<VerificationResult> {
  const profile = await detectProjectProfile(workspace.root);
  if (!profile.verificationCommand) {
    return {
      status: 'unavailable',
      summary: `No supported verification command detected for ${profile.kind} project`,
      profile,
    };
  }
  const command = profile.verificationCommand;
  try {
    const result = await new LocalCommandRunner(workspace).run(command, signal);
    return {
      status: result.exitCode === 0 ? 'passed' : 'failed',
      command: [command.executable, ...command.args].join(' '),
      result,
      summary: result.exitCode === 0 ? 'Verification passed' : 'Verification failed',
      profile,
    };
  } catch (error) {
    if ((error as Error).name === 'AbortError')
      return { status: 'cancelled', summary: 'Verification cancelled', profile };
    throw error;
  }
}
