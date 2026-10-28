use crate::program_sources::manifest::{
    ExecutableLocationRoot, ProgramExecutableDiscovery, ProgramManifest,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

const MAX_DISCOVERY_HINTS: usize = 16;
const MAX_LOCATION_ENTRIES: usize = 512;
const MAX_CANDIDATES: usize = 64;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProgramExecutableCandidate {
    pub path: String,
    pub source: String,
}

pub(crate) struct ProgramExecutableCandidates {
    pub suggested: String,
    pub candidates: Vec<ProgramExecutableCandidate>,
}

fn path_segments(value: &str, allow_wildcards: bool) -> Result<Vec<&str>, String> {
    let segments: Vec<_> = value.split(['/', '\\']).collect();
    if segments.is_empty()
        || segments.len() > 6
        || segments.iter().any(|segment| {
            segment.is_empty()
                || matches!(*segment, "." | "..")
                || segment.ends_with([' ', '.'])
                || segment
                    .chars()
                    .any(|c| c.is_control() || "<>:\"|?[]".contains(c))
                || segment.matches('*').count() > usize::from(allow_wildcards)
        })
        || segments
            .iter()
            .filter(|segment| segment.contains('*'))
            .count()
            > 2
        || segments.last().is_some_and(|segment| {
            segment.contains('*') || !segment.to_ascii_lowercase().ends_with(".exe")
        })
    {
        return Err("Executable discovery paths must name an EXE within 6 relative path segments, with at most 2 single-level directory wildcards.".into());
    }
    Ok(segments)
}

pub(crate) fn validate_discovery(discovery: &ProgramExecutableDiscovery) -> Result<(), String> {
    if discovery.app_paths.len() + discovery.store_packages.len() + discovery.common_locations.len()
        > MAX_DISCOVERY_HINTS
    {
        return Err(format!(
            "executableDiscovery permits at most {MAX_DISCOVERY_HINTS} locations."
        ));
    }
    for executable in &discovery.app_paths {
        if path_segments(executable, false)?.len() != 1 {
            return Err("executableDiscovery.appPaths entries must be EXE file names.".into());
        }
    }
    for package in &discovery.store_packages {
        if package.identity.is_empty()
            || package.identity.len() > 128
            || !package
                .identity
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
        {
            return Err("executableDiscovery Store identities must be exact package names.".into());
        }
        path_segments(&package.executable, false)?;
    }
    for location in &discovery.common_locations {
        path_segments(&location.path, true)?;
    }
    Ok(())
}

fn add_candidate(candidates: &mut Vec<ProgramExecutableCandidate>, path: &Path, source: &str) {
    if candidates.len() >= MAX_CANDIDATES || !path.is_file() {
        return;
    }
    let path = path.to_string_lossy().to_string();
    if !candidates
        .iter()
        .any(|candidate| candidate.path.eq_ignore_ascii_case(&path))
    {
        candidates.push(ProgramExecutableCandidate {
            path,
            source: source.to_string(),
        });
    }
}

fn finish_candidates(
    declared: &str,
    mut candidates: Vec<ProgramExecutableCandidate>,
) -> ProgramExecutableCandidates {
    let suggested = candidates
        .iter()
        .find(|candidate| {
            candidate.source == "Package path" && candidate.path.eq_ignore_ascii_case(declared)
        })
        .or_else(|| (candidates.len() == 1).then(|| &candidates[0]))
        .map(|candidate| candidate.path.clone())
        .unwrap_or_default();
    candidates.sort_by(|left, right| {
        left.path
            .to_ascii_lowercase()
            .cmp(&right.path.to_ascii_lowercase())
    });
    ProgramExecutableCandidates {
        suggested,
        candidates,
    }
}

fn matches_segment(name: &str, pattern: &str) -> bool {
    let name = name.to_ascii_lowercase();
    let pattern = pattern.to_ascii_lowercase();
    match pattern.split_once('*') {
        Some((start, end)) => {
            name.len() >= start.len() + end.len() && name.starts_with(start) && name.ends_with(end)
        }
        None => name == pattern,
    }
}

fn is_plain_directory(entry: &std::fs::DirEntry) -> bool {
    let Ok(metadata) = entry.metadata() else {
        return false;
    };
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return false;
        } // FILE_ATTRIBUTE_REPARSE_POINT
    }
    metadata.is_dir() && !metadata.file_type().is_symlink()
}

// Only the declared directory levels are visited. Never recurse through a drive,
// and never follow directory links/junctions while expanding a wildcard.
fn common_location_paths(root: &Path, pattern: &str) -> Vec<PathBuf> {
    let Ok(segments) = path_segments(pattern, true) else {
        return Vec::new();
    };
    let mut parents = vec![root.to_path_buf()];
    let mut remaining = MAX_LOCATION_ENTRIES;
    for segment in segments {
        let mut next = Vec::new();
        for parent in parents {
            if segment.contains('*') {
                let Ok(entries) = std::fs::read_dir(&parent) else {
                    continue;
                };
                for entry in entries {
                    if remaining == 0 {
                        break;
                    }
                    remaining -= 1;
                    let Ok(entry) = entry else { continue };
                    if is_plain_directory(&entry)
                        && matches_segment(&entry.file_name().to_string_lossy(), segment)
                    {
                        next.push(entry.path());
                    }
                }
            } else {
                next.push(parent.join(segment));
            }
        }
        parents = next;
    }
    parents.into_iter().filter(|path| path.is_file()).collect()
}

fn location_root(root: ExecutableLocationRoot) -> Option<PathBuf> {
    std::env::var_os(match root {
        ExecutableLocationRoot::ProgramFiles => "ProgramFiles",
        ExecutableLocationRoot::ProgramFilesX86 => "ProgramFiles(x86)",
        ExecutableLocationRoot::LocalAppData => "LOCALAPPDATA",
    })
    .map(PathBuf::from)
}

#[cfg(windows)]
fn app_path_candidates(executable: &str) -> Vec<ProgramExecutableCandidate> {
    use windows_sys::Win32::System::Registry::{
        RegGetValueW, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_EXPAND_SZ, RRF_RT_REG_SZ,
        RRF_SUBKEY_WOW6432KEY, RRF_SUBKEY_WOW6464KEY,
    };
    let key: Vec<u16> =
        format!("Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\{executable}")
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
    let mut candidates = Vec::new();
    for hive in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        for view in [RRF_SUBKEY_WOW6464KEY, RRF_SUBKEY_WOW6432KEY] {
            let mut buffer = vec![0_u16; 32768];
            let mut bytes = (buffer.len() * 2) as u32;
            let result = unsafe {
                RegGetValueW(
                    hive,
                    key.as_ptr(),
                    std::ptr::null(),
                    RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ | view,
                    std::ptr::null_mut(),
                    buffer.as_mut_ptr().cast(),
                    &mut bytes,
                )
            };
            if result == 0 {
                let end = buffer
                    .iter()
                    .position(|unit| *unit == 0)
                    .unwrap_or(buffer.len());
                let path = String::from_utf16_lossy(&buffer[..end]);
                add_candidate(
                    &mut candidates,
                    Path::new(path.trim().trim_matches('"')),
                    "Windows App Paths",
                );
            }
        }
    }
    candidates
}

#[cfg(not(windows))]
fn app_path_candidates(_executable: &str) -> Vec<ProgramExecutableCandidate> {
    Vec::new()
}

#[cfg(windows)]
fn store_candidates(discovery: &ProgramExecutableDiscovery) -> Vec<ProgramExecutableCandidate> {
    use std::io::Read;
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};
    if discovery.store_packages.is_empty() {
        return Vec::new();
    }
    // Metadata is passed as JSON data, never interpolated into PowerShell code.
    const SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$locations = ConvertFrom-Json $env:FLOWCELL_EXECUTABLE_DISCOVERY
$rows = @()
foreach ($location in $locations) {
    foreach ($package in @(Get-AppxPackage -Name $location.identity -ErrorAction SilentlyContinue | Select-Object -First 16)) {
        if ($package.Name -ceq $location.identity -and $package.InstallLocation) {
            $rows += @{path=(Join-Path $package.InstallLocation $location.executable);source=('Microsoft Store: '+$package.Name)}
        }
    }
}
ConvertTo-Json -InputObject @($rows) -Compress
"#;
    let Ok(metadata) = serde_json::to_string(&discovery.store_packages) else {
        return Vec::new();
    };
    let Ok(mut child) = Command::new(crate::resolve_powershell_path())
        .args(["-NoProfile", "-NonInteractive", "-Command", SCRIPT])
        .env("FLOWCELL_EXECUTABLE_DISCOVERY", metadata)
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    else {
        return Vec::new();
    };
    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Vec::new();
    };
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stdout.take(65536).read_to_end(&mut bytes);
        bytes
    });
    let deadline = Instant::now() + Duration::from_secs(5);
    let success = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.success(),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(25)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break false;
            }
        }
    };
    let bytes = reader.join().unwrap_or_default();
    if !success {
        return Vec::new();
    }
    serde_json::from_slice(&bytes).unwrap_or_default()
}

#[cfg(not(windows))]
fn store_candidates(_discovery: &ProgramExecutableDiscovery) -> Vec<ProgramExecutableCandidate> {
    Vec::new()
}

pub(crate) fn discover_program_executables(
    manifest: &ProgramManifest,
) -> ProgramExecutableCandidates {
    let declared = manifest.exe_path.trim().trim_matches('"');
    let mut candidates = Vec::new();
    add_candidate(&mut candidates, Path::new(declared), "Package path");
    // Existing PATH/running-process fallbacks remain available for old manifests.
    let mut names = BTreeSet::new();
    if !declared.is_empty() && !declared.contains(['/', '\\', ':']) {
        names.insert(declared.to_string());
    }
    for name in &manifest.process_names {
        let name = if name.to_ascii_lowercase().ends_with(".exe") {
            name.clone()
        } else {
            format!("{name}.exe")
        };
        if path_segments(&name, false).is_ok_and(|segments| segments.len() == 1) {
            names.insert(name);
        }
    }
    if let Some(search_path) = std::env::var_os("PATH") {
        for directory in std::env::split_paths(&search_path).take(128) {
            for name in &names {
                add_candidate(&mut candidates, &directory.join(name), "PATH");
            }
        }
    }
    if let Some(path) =
        crate::commands::windows::find_running_process_executable(&manifest.process_names)
    {
        add_candidate(&mut candidates, Path::new(&path), "Running application");
    }
    if validate_discovery(&manifest.executable_discovery).is_ok() {
        for name in &manifest.executable_discovery.app_paths {
            for candidate in app_path_candidates(name) {
                add_candidate(
                    &mut candidates,
                    Path::new(&candidate.path),
                    &candidate.source,
                );
            }
        }
        for location in &manifest.executable_discovery.common_locations {
            if let Some(root) = location_root(location.root) {
                for path in common_location_paths(&root, &location.path) {
                    add_candidate(&mut candidates, &path, "Package install location");
                }
            }
        }
        for candidate in store_candidates(&manifest.executable_discovery) {
            add_candidate(
                &mut candidates,
                Path::new(&candidate.path),
                &candidate.source,
            );
        }
    }
    finish_candidates(declared, candidates)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovery_rejects_paths_outside_declared_roots_and_recursive_patterns() {
        for pattern in [
            "../host.exe",
            "C:/host.exe",
            "//server/host.exe",
            "vendor/**/host.exe",
            "vendor/../host.exe",
            "vendor/*.exe",
            "vendor/*/*/*/host.exe",
        ] {
            assert!(path_segments(pattern, true).is_err(), "accepted {pattern}");
        }
        assert!(path_segments("Vendor/Host */bin/host.exe", true).is_ok());
        assert!(path_segments("Vendor/Host */host.exe", false).is_err());
    }

    #[test]
    fn multiple_versions_require_a_choice_unless_package_path_is_explicit() {
        let candidates = vec![
            ProgramExecutableCandidate {
                path: "C:/Host 1/host.exe".into(),
                source: "Package path".into(),
            },
            ProgramExecutableCandidate {
                path: "C:/Host 2/host.exe".into(),
                source: "Windows App Paths".into(),
            },
        ];
        assert_eq!(finish_candidates("", candidates.clone()).suggested, "");
        assert_eq!(
            finish_candidates("C:/Host 1/host.exe", candidates.clone()).suggested,
            "C:/Host 1/host.exe"
        );
        assert_eq!(
            finish_candidates("", vec![candidates[1].clone()]).suggested,
            "C:/Host 2/host.exe"
        );
    }

    #[test]
    fn location_discovery_returns_existing_versions_without_searching_other_levels() {
        let root = std::env::temp_dir().join(format!(
            "flowcell-executable-discovery-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        for name in [
            "Vendor/Host 1/bin/host.exe",
            "Vendor/Host 2/bin/host.exe",
            "Other/Host 3/bin/host.exe",
            "Vendor/deeper/Host 4/bin/host.exe",
        ] {
            let path = root.join(name);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, b"fixture").unwrap();
        }
        let paths = common_location_paths(&root, "Vendor/Host */bin/host.exe");
        assert_eq!(paths.len(), 2);
        let mut candidates = Vec::new();
        for path in paths {
            add_candidate(&mut candidates, &path, "fixture");
            add_candidate(&mut candidates, &path, "duplicate");
        }
        assert_eq!(candidates.len(), 2);
        assert!(finish_candidates("", candidates).suggested.is_empty());
        std::fs::remove_dir_all(&root).unwrap(); // Only this test's newly-created temporary files.
    }

    #[test]
    fn store_identity_cannot_supply_wildcards_or_commands() {
        for identity in ["Vendor.*", "Vendor;exit", "Vendor/Host"] {
            let mut discovery = ProgramExecutableDiscovery::default();
            discovery.store_packages.push(
                crate::program_sources::manifest::StoreExecutableLocation {
                    identity: identity.into(),
                    executable: "host.exe".into(),
                },
            );
            assert!(validate_discovery(&discovery).is_err());
        }
    }
}
