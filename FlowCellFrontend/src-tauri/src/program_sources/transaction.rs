use std::fs::{self, OpenOptions};
use std::hash::{DefaultHasher, Hash, Hasher};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

const ATOMIC_FILE_LOCK_COUNT: usize = 64;
static ATOMIC_FILE_LOCKS: OnceLock<Vec<Mutex<()>>> = OnceLock::new();

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ArtifactKind {
    Writing,
    Backup,
    RecycleFailed,
    Corrupt,
}

#[derive(Clone, Debug)]
struct Artifact {
    kind: ArtifactKind,
    path: PathBuf,
    modified: SystemTime,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum AtomicWriteMode {
    Create,
    Replace,
}

fn atomic_file_lock(path: &Path) -> &'static Mutex<()> {
    let locks = ATOMIC_FILE_LOCKS.get_or_init(|| {
        (0..ATOMIC_FILE_LOCK_COUNT)
            .map(|_| Mutex::new(()))
            .collect()
    });
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    &locks[(hasher.finish() as usize) % locks.len()]
}

fn artifact_path(path: &Path, suffix: &str) -> PathBuf {
    let token = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("record.json");
    path.with_file_name(format!(".{file_name}.{token}.{suffix}"))
}

fn classify_artifact(path: &Path, candidate: &Path) -> Option<ArtifactKind> {
    let file_name = path.file_name()?.to_str()?;
    let candidate_name = candidate.file_name()?.to_str()?;
    let fixed_backup = format!(".{file_name}.backup");
    if candidate_name == fixed_backup {
        return Some(ArtifactKind::Backup);
    }
    let prefix = format!(".{file_name}.");
    if !candidate_name.starts_with(&prefix) {
        return None;
    }
    if candidate_name.ends_with(".writing") {
        Some(ArtifactKind::Writing)
    } else if candidate_name.ends_with(".backup") {
        Some(ArtifactKind::Backup)
    } else if candidate_name.ends_with(".recycle-failed") {
        Some(ArtifactKind::RecycleFailed)
    } else if candidate_name.ends_with(".corrupt") {
        Some(ArtifactKind::Corrupt)
    } else {
        None
    }
}

fn list_artifacts(path: &Path) -> Result<Vec<Artifact>, String> {
    let Some(parent) = path.parent() else {
        return Err(format!("Path has no parent: {}", path.display()));
    };
    if !parent.is_dir() {
        return Ok(Vec::new());
    }
    let mut artifacts = Vec::new();
    for entry in fs::read_dir(parent)
        .map_err(|error| format!("Failed to inspect {}: {error}", parent.display()))?
    {
        let entry =
            entry.map_err(|error| format!("Failed to inspect {}: {error}", parent.display()))?;
        let candidate = entry.path();
        let Some(kind) = classify_artifact(path, &candidate) else {
            continue;
        };
        if !candidate.is_file() {
            continue;
        }
        let modified = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .unwrap_or(UNIX_EPOCH);
        artifacts.push(Artifact {
            kind,
            path: candidate,
            modified,
        });
    }
    artifacts.sort_by(|left, right| {
        right
            .modified
            .cmp(&left.modified)
            .then_with(|| right.path.cmp(&left.path))
    });
    Ok(artifacts)
}

fn remove_staged_artifact(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    fs::remove_file(path)
        .map_err(|error| format!("Failed to remove stale {}: {error}", path.display()))
}

fn recycle_backup_artifacts(paths: &[PathBuf]) {
    if !paths.is_empty() {
        let _ = crate::recycle_file_paths(paths);
    }
}

fn clean_artifacts_with<F>(artifacts: &[Artifact], mut clean_backup: F)
where
    F: FnMut(&Path) -> Result<(), String>,
{
    for artifact in artifacts {
        let _ = match artifact.kind {
            ArtifactKind::Writing => remove_staged_artifact(&artifact.path),
            ArtifactKind::Backup | ArtifactKind::RecycleFailed | ArtifactKind::Corrupt => {
                clean_backup(&artifact.path)
            }
        };
    }
}

fn recover_atomic_file_with<V, F>(
    path: &Path,
    validate: &V,
    mut clean_backup: F,
) -> Result<(), String>
where
    V: Fn(&Path) -> Result<(), String>,
    F: FnMut(&Path) -> Result<(), String>,
{
    let artifacts = list_artifacts(path)?;
    if path.exists() && !path.is_file() {
        return Err(format!(
            "Atomic JSON path is not a file: {}",
            path.display()
        ));
    }
    if path.is_file() {
        if let Err(canonical_error) = validate(path) {
            let mut validation_errors = Vec::new();
            let selected = artifacts
                .iter()
                .filter(|artifact| {
                    matches!(
                        artifact.kind,
                        ArtifactKind::Backup | ArtifactKind::RecycleFailed
                    )
                })
                .find_map(|artifact| match validate(&artifact.path) {
                    Ok(()) => Some(artifact.path.clone()),
                    Err(error) => {
                        validation_errors.push(format!("{}: {error}", artifact.path.display()));
                        None
                    }
                });
            let Some(selected) = selected else {
                return Err(if validation_errors.is_empty() {
                    canonical_error
                } else {
                    format!(
                        "{canonical_error} Recovery artifacts were also invalid: {}",
                        validation_errors.join(" | ")
                    )
                });
            };
            let corrupt = artifact_path(path, "corrupt");
            fs::rename(path, &corrupt).map_err(|error| {
                format!(
                    "Could not quarantine invalid {} before recovery: {error}",
                    path.display()
                )
            })?;
            if let Err(error) = fs::rename(&selected, path) {
                let restore_error = fs::rename(&corrupt, path).err();
                return Err(match restore_error {
                    Some(restore_error) => format!(
                        "Failed to recover {} from {}: {error} Restoring the invalid canonical also failed: {restore_error}",
                        path.display(),
                        selected.display()
                    ),
                    None => format!(
                        "Failed to recover {} from {}: {error}",
                        path.display(),
                        selected.display()
                    ),
                });
            }
            validate(path)?;
            let remaining = artifacts
                .iter()
                .filter(|artifact| artifact.path != selected)
                .cloned()
                .collect::<Vec<_>>();
            clean_artifacts_with(&remaining, &mut clean_backup);
            let _ = clean_backup(&corrupt);
            return Ok(());
        }
        clean_artifacts_with(&artifacts, clean_backup);
        return Ok(());
    }
    if artifacts.is_empty() {
        return Ok(());
    }

    let priorities = [
        ArtifactKind::Backup,
        ArtifactKind::RecycleFailed,
        ArtifactKind::Writing,
        ArtifactKind::Corrupt,
    ];
    let mut validation_errors = Vec::new();
    let mut selected = None;
    'priority: for priority in priorities {
        for artifact in artifacts
            .iter()
            .filter(|artifact| artifact.kind == priority)
        {
            match validate(&artifact.path) {
                Ok(()) => {
                    selected = Some(artifact.path.clone());
                    break 'priority;
                }
                Err(error) => {
                    validation_errors.push(format!("{}: {error}", artifact.path.display()))
                }
            }
        }
    }

    let selected = selected.ok_or_else(|| {
        format!(
            "Could not recover missing {} from its transaction artifacts: {}",
            path.display(),
            validation_errors.join(" | ")
        )
    })?;
    fs::rename(&selected, path).map_err(|error| {
        format!(
            "Failed to recover {} from {}: {error}",
            path.display(),
            selected.display()
        )
    })?;
    validate(path).map_err(|error| {
        format!(
            "Recovered {} from {}, but validation failed: {error}",
            path.display(),
            selected.display()
        )
    })?;

    let remaining = artifacts
        .iter()
        .filter(|artifact| artifact.path != selected)
        .cloned()
        .collect::<Vec<_>>();
    clean_artifacts_with(&remaining, &mut clean_backup);
    Ok(())
}

fn validate_json_file(path: &Path) -> Result<(), String> {
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    serde_json::from_str::<serde_json::Value>(&raw)
        .map(|_| ())
        .map_err(|error| format!("{} is invalid JSON: {error}", path.display()))
}

pub(crate) fn recover_json_file<V>(path: &Path, validate: V) -> Result<(), String>
where
    V: Fn(&Path) -> Result<(), String>,
{
    let mut pending_backups = Vec::new();
    let result = {
        let _guard = atomic_file_lock(path)
            .lock()
            .map_err(|_| "Atomic file transaction lock is poisoned.".to_string())?;
        recover_atomic_file_with(path, &validate, |backup| {
            pending_backups.push(backup.to_path_buf());
            Ok(())
        })
    };
    recycle_backup_artifacts(&pending_backups);
    result
}

pub(crate) fn read_json_file<T, F>(path: &Path, parse: F) -> Result<T, String>
where
    F: Fn(&Path) -> Result<T, String>,
{
    let mut pending_backups = Vec::new();
    let result = {
        let _guard = atomic_file_lock(path)
            .lock()
            .map_err(|_| "Atomic file transaction lock is poisoned.".to_string())?;
        (|| {
            recover_atomic_file_with(path, &|candidate| parse(candidate).map(|_| ()), |backup| {
                pending_backups.push(backup.to_path_buf());
                Ok(())
            })?;
            parse(path)
        })()
    };
    recycle_backup_artifacts(&pending_backups);
    result
}

fn write_synced(path: &Path, content: &[u8]) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .map_err(|error| format!("Failed to stage {}: {error}", path.display()))?;
    if let Err(error) = file.write_all(content) {
        drop(file);
        let cleanup_error = remove_staged_artifact(path).err();
        return Err(match cleanup_error {
            Some(cleanup_error) => format!(
                "Failed to stage {}: {error} Cleanup also failed: {cleanup_error}",
                path.display()
            ),
            None => format!("Failed to stage {}: {error}", path.display()),
        });
    }
    if let Err(error) = file.sync_all() {
        drop(file);
        let cleanup_error = remove_staged_artifact(path).err();
        return Err(match cleanup_error {
            Some(cleanup_error) => format!(
                "Failed to flush {}: {error} Cleanup also failed: {cleanup_error}",
                path.display()
            ),
            None => format!("Failed to flush {}: {error}", path.display()),
        });
    }
    Ok(())
}

fn existing_matches(path: &Path, content: &[u8]) -> bool {
    fs::read(path)
        .map(|existing| existing == content)
        .unwrap_or(false)
}

fn write_file_locked<V>(
    path: &Path,
    content: &[u8],
    mode: AtomicWriteMode,
    pending_backups: &mut Vec<PathBuf>,
    validate: &V,
) -> Result<(), String>
where
    V: Fn(&Path) -> Result<(), String>,
{
    recover_atomic_file_with(path, validate, |backup| {
        pending_backups.push(backup.to_path_buf());
        Ok(())
    })?;

    let parent = path
        .parent()
        .ok_or_else(|| format!("Path has no parent: {}", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
    if mode == AtomicWriteMode::Create && path.exists() {
        if existing_matches(path, content) {
            return Ok(());
        }
        return Err(format!(
            "Refusing to overwrite existing owned record {}.",
            path.display()
        ));
    }

    let staged = artifact_path(path, "writing");
    write_synced(&staged, content)?;
    if mode == AtomicWriteMode::Create && path.exists() {
        let matches = existing_matches(path, content);
        let cleanup_error = remove_staged_artifact(&staged).err();
        if matches && cleanup_error.is_none() {
            return Ok(());
        }
        return Err(match cleanup_error {
            Some(cleanup_error) => format!(
                "Refusing to overwrite existing owned record {}. Cleanup also failed: {cleanup_error}",
                path.display()
            ),
            None => format!(
                "Refusing to overwrite existing owned record {}.",
                path.display()
            ),
        });
    }
    let had_existing = path.is_file();
    let backup = artifact_path(path, "backup");
    if had_existing {
        if let Err(error) = fs::rename(path, &backup) {
            let cleanup_error = remove_staged_artifact(&staged).err();
            return Err(match cleanup_error {
                Some(cleanup_error) => format!(
                    "Failed to prepare {} for replacement: {error} Cleanup also failed: {cleanup_error}",
                    path.display()
                ),
                None => format!(
                    "Failed to prepare {} for replacement: {error}",
                    path.display()
                ),
            });
        }
    }

    if let Err(error) = fs::rename(&staged, path) {
        let mut rollback_errors = Vec::new();
        if had_existing && backup.is_file() {
            if let Err(rollback_error) = fs::rename(&backup, path) {
                rollback_errors.push(format!(
                    "failed to restore {} from {}: {rollback_error}",
                    path.display(),
                    backup.display()
                ));
            }
        } else if had_existing {
            rollback_errors.push(format!(
                "could not restore {} because backup {} is missing",
                path.display(),
                backup.display()
            ));
        }
        if staged.exists() {
            if let Err(cleanup_error) = remove_staged_artifact(&staged) {
                rollback_errors.push(cleanup_error);
            }
        }
        return Err(if rollback_errors.is_empty() {
            format!("Failed to commit {}: {error}", path.display())
        } else {
            format!(
                "Failed to commit {}: {error} Rollback failed: {}",
                path.display(),
                rollback_errors.join(" | ")
            )
        });
    }

    if had_existing {
        // The rename above is the commit point. Failure to recycle the old value must not
        // turn a committed write into a reported failure; a later recovery pass retries it.
        pending_backups.push(backup);
    }
    Ok(())
}

pub(crate) fn write_json_file(
    path: &Path,
    content: &[u8],
    mode: AtomicWriteMode,
) -> Result<(), String> {
    let mut pending_backups = Vec::new();
    let result = {
        let _guard = atomic_file_lock(path)
            .lock()
            .map_err(|_| "Atomic file transaction lock is poisoned.".to_string())?;
        write_file_locked(
            path,
            content,
            mode,
            &mut pending_backups,
            &validate_json_file,
        )
    };
    recycle_backup_artifacts(&pending_backups);
    result
}

pub(crate) fn write_file_atomically<V>(
    path: &Path,
    content: &[u8],
    mode: AtomicWriteMode,
    validate: V,
) -> Result<(), String>
where
    V: Fn(&Path) -> Result<(), String>,
{
    let mut pending_backups = Vec::new();
    let result = {
        let _guard = atomic_file_lock(path)
            .lock()
            .map_err(|_| "Atomic file transaction lock is poisoned.".to_string())?;
        write_file_locked(path, content, mode, &mut pending_backups, &validate)
    };
    recycle_backup_artifacts(&pending_backups);
    result
}

#[cfg(test)]
mod tests {
    use super::{recover_atomic_file_with, write_json_file, AtomicWriteMode};
    use serde_json::Value;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TestRoot(PathBuf);

    impl TestRoot {
        fn new(label: &str) -> Self {
            let token = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "flowcell-atomic-transaction-{label}-{}-{token}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("create transaction test root");
            Self(path)
        }

        fn join(&self, value: &str) -> PathBuf {
            self.0.join(value)
        }
    }

    impl Drop for TestRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn validate_json(path: &Path) -> Result<(), String> {
        let raw = fs::read_to_string(path).map_err(|error| error.to_string())?;
        serde_json::from_str::<Value>(&raw)
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    fn remove_backup(path: &Path) -> Result<(), String> {
        fs::remove_file(path).map_err(|error| error.to_string())
    }

    #[test]
    fn recovery_restores_backup_before_uncommitted_staged_value() {
        let root = TestRoot::new("backup-wins");
        let canonical = root.join("state.json");
        let backup = root.join(".state.json.1.backup");
        let staged = root.join(".state.json.2.writing");
        fs::write(&backup, r#"{"revision":1}"#).expect("write backup");
        fs::write(&staged, r#"{"revision":2}"#).expect("write staged");

        recover_atomic_file_with(&canonical, &validate_json, remove_backup)
            .expect("recover interrupted replacement");

        assert_eq!(
            fs::read_to_string(&canonical).expect("read recovered state"),
            r#"{"revision":1}"#
        );
        assert!(!backup.exists());
        assert!(!staged.exists());
    }

    #[test]
    fn recovery_promotes_complete_staged_value_for_interrupted_first_write() {
        let root = TestRoot::new("staged-first-write");
        let canonical = root.join("record.json");
        let staged = root.join(".record.json.1.writing");
        fs::write(&staged, r#"{"schemaVersion":1}"#).expect("write staged");

        recover_atomic_file_with(&canonical, &validate_json, remove_backup)
            .expect("recover interrupted first write");

        assert!(canonical.is_file());
        assert!(!staged.exists());
    }

    #[test]
    fn recovery_promotes_legacy_recycle_failed_commit_when_it_is_only_copy() {
        let root = TestRoot::new("legacy-recycle-failed");
        let canonical = root.join("state.json");
        let failed_commit = root.join(".state.json.1.recycle-failed");
        fs::write(&failed_commit, r#"{"revision":2}"#).expect("write failed commit");

        recover_atomic_file_with(&canonical, &validate_json, remove_backup)
            .expect("recover legacy failed commit");

        assert_eq!(
            fs::read_to_string(&canonical).expect("read recovered state"),
            r#"{"revision":2}"#
        );
        assert!(!failed_commit.exists());
    }

    #[test]
    fn recovery_keeps_committed_canonical_and_cleans_stale_artifacts() {
        let root = TestRoot::new("canonical-wins");
        let canonical = root.join("state.json");
        let backup = root.join(".state.json.backup");
        let staged = root.join(".state.json.2.writing");
        fs::write(&canonical, r#"{"revision":2}"#).expect("write canonical");
        fs::write(&backup, r#"{"revision":1}"#).expect("write backup");
        fs::write(&staged, r#"{"revision":3}"#).expect("write staged");

        recover_atomic_file_with(&canonical, &validate_json, remove_backup)
            .expect("clean completed replacement");

        assert_eq!(
            fs::read_to_string(&canonical).expect("read canonical"),
            r#"{"revision":2}"#
        );
        assert!(!backup.exists());
        assert!(!staged.exists());
    }

    #[test]
    fn recovery_replaces_invalid_canonical_with_valid_backup() {
        let root = TestRoot::new("invalid-canonical");
        let canonical = root.join("state.json");
        let backup = root.join(".state.json.1.backup");
        fs::write(&canonical, "{").expect("write invalid canonical");
        fs::write(&backup, r#"{"revision":1}"#).expect("write valid backup");

        recover_atomic_file_with(&canonical, &validate_json, remove_backup)
            .expect("recover invalid canonical");

        assert_eq!(
            fs::read_to_string(&canonical).expect("read recovered state"),
            r#"{"revision":1}"#
        );
        assert!(!backup.exists());
        assert_eq!(fs::read_dir(&root.0).expect("list test root").count(), 1);
    }

    #[test]
    fn create_retry_is_idempotent_after_staged_recovery() {
        let root = TestRoot::new("idempotent-create");
        let canonical = root.join("record.json");
        let staged = root.join(".record.json.1.writing");
        let content = br#"{"schemaVersion":1}"#;
        fs::write(&staged, content).expect("write staged");

        write_json_file(&canonical, content, AtomicWriteMode::Create)
            .expect("retry completed first write");

        assert_eq!(
            fs::read(&canonical).expect("read canonical"),
            content.to_vec()
        );
    }

    #[test]
    fn invalid_artifacts_are_left_for_manual_recovery() {
        let root = TestRoot::new("invalid-artifact");
        let canonical = root.join("state.json");
        let backup = root.join(".state.json.1.backup");
        fs::write(&backup, "{").expect("write invalid backup");

        let error = recover_atomic_file_with(&canonical, &validate_json, remove_backup)
            .expect_err("invalid artifact should fail recovery");

        assert!(error.contains("Could not recover missing"));
        assert!(backup.is_file());
        assert!(!canonical.exists());
    }
}
