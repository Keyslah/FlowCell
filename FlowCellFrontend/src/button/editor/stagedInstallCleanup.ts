export interface StagedButtonInstall {
  ownerButtonId: string;
}

export interface StagedInstallCleanupFailure<TInstall extends StagedButtonInstall> {
  installed: TInstall;
  error: unknown;
}

export async function discardStagedButtonInstalls<TInstall extends StagedButtonInstall>(
  stagedInstalls: Map<string, TInstall>,
  uninstall: (installed: TInstall) => Promise<void>
): Promise<StagedInstallCleanupFailure<TInstall>[]> {
  const entries = [...stagedInstalls.entries()];
  const failures: StagedInstallCleanupFailure<TInstall>[] = [];

  for (const [ownerButtonId, installed] of entries) {
    try {
      await uninstall(installed);
      if (stagedInstalls.get(ownerButtonId) === installed) {
        stagedInstalls.delete(ownerButtonId);
      }
    } catch (error) {
      failures.push({ installed, error });
    }
  }

  return failures;
}
