//! Windows shell recycling without PowerShell's legacy MAX_PATH checks.
use std::fs;
use std::os::windows::ffi::OsStrExt;
use std::path::{Component, Path, PathBuf, Prefix};
use std::sync::{Arc, Mutex};
use windows::core::{implement, Error, Ref, HRESULT, PCWSTR};
use windows::Win32::Foundation::E_ABORT;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
    COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Shell::{
    FileOperation, IFileOperation, IFileOperationProgressSink, IFileOperationProgressSink_Impl,
    IShellItem, SHCreateItemFromParsingName, SHQueryRecycleBinW, FOFX_ADDUNDORECORD,
    FOFX_EARLYFAILURE, FOFX_RECYCLEONDELETE, FOF_NOCONFIRMATION, FOF_NOERRORUI,
    FOF_NO_CONNECTED_ELEMENTS, FOF_SILENT, FOF_WANTNUKEWARNING, SHQUERYRBINFO,
    TSF_DELETE_RECYCLE_IF_POSSIBLE,
};

#[derive(Default)]
struct RecycleProgress {
    approved: usize,
    recycled: usize,
    failure: Option<String>,
}

impl RecycleProgress {
    fn reject(&mut self, message: String) -> windows::core::Result<()> {
        self.failure.get_or_insert_with(|| message.clone());
        Err(Error::new(E_ABORT, message))
    }

    fn before_delete(&mut self, flags: u32) -> windows::core::Result<()> {
        if let Some(message) = &self.failure {
            return Err(Error::new(E_ABORT, message));
        }
        if flags & TSF_DELETE_RECYCLE_IF_POSSIBLE.0 as u32 == 0 {
            return self
                .reject("Windows proposed permanent deletion; recycling was cancelled.".into());
        }
        self.approved += 1;
        Ok(())
    }

    fn after_delete(
        &mut self,
        result: HRESULT,
        has_recycled_destination: bool,
    ) -> windows::core::Result<()> {
        if let Some(message) = &self.failure {
            return Err(Error::new(E_ABORT, message));
        }
        if result.is_err() {
            return self.reject(format!("Windows could not recycle the item: {result}"));
        }
        // PostDeleteItem documents a null destination for permanent deletion.
        if !has_recycled_destination || self.recycled >= self.approved {
            return self.reject("Windows did not confirm a Recycle Bin destination.".into());
        }
        self.recycled += 1;
        Ok(())
    }

    fn verify(&self) -> Result<(), String> {
        if let Some(message) = &self.failure {
            return Err(message.clone());
        }
        if self.approved == 0 || self.recycled != self.approved {
            return Err("Windows did not confirm recycling every item.".into());
        }
        Ok(())
    }
}

#[implement(IFileOperationProgressSink)]
struct RecycleOnlySink {
    progress: Arc<Mutex<RecycleProgress>>,
}

#[allow(non_snake_case)]
impl IFileOperationProgressSink_Impl for RecycleOnlySink_Impl {
    fn PreDeleteItem(&self, flags: u32, _item: Ref<'_, IShellItem>) -> windows::core::Result<()> {
        #[cfg(test)]
        eprintln!("Recycle PreDeleteItem flags=0x{flags:08x}");
        self.progress
            .lock()
            .map_err(|_| Error::new(E_ABORT, "Recycle Bin guard failed."))?
            .before_delete(flags)
    }
    fn PostDeleteItem(
        &self,
        flags: u32,
        _item: Ref<'_, IShellItem>,
        result: HRESULT,
        destination: Ref<'_, IShellItem>,
    ) -> windows::core::Result<()> {
        #[cfg(test)]
        eprintln!(
            "Recycle PostDeleteItem flags=0x{flags:08x} result={result} recycled_destination={}",
            !destination.is_null()
        );
        let _ = flags;
        self.progress
            .lock()
            .map_err(|_| Error::new(E_ABORT, "Recycle Bin guard failed."))?
            .after_delete(result, !destination.is_null())
    }
    fn StartOperations(&self) -> windows::core::Result<()> {
        Ok(())
    }
    fn FinishOperations(&self, _result: HRESULT) -> windows::core::Result<()> {
        Ok(())
    }
    fn PreRenameItem(
        &self,
        _flags: u32,
        _item: Ref<'_, IShellItem>,
        _name: &PCWSTR,
    ) -> windows::core::Result<()> {
        Ok(())
    }
    fn PostRenameItem(
        &self,
        _flags: u32,
        _item: Ref<'_, IShellItem>,
        _name: &PCWSTR,
        _result: HRESULT,
        _destination: Ref<'_, IShellItem>,
    ) -> windows::core::Result<()> {
        Ok(())
    }
    fn PreMoveItem(
        &self,
        _flags: u32,
        _item: Ref<'_, IShellItem>,
        _folder: Ref<'_, IShellItem>,
        _name: &PCWSTR,
    ) -> windows::core::Result<()> {
        Ok(())
    }
    fn PostMoveItem(
        &self,
        _flags: u32,
        _item: Ref<'_, IShellItem>,
        _folder: Ref<'_, IShellItem>,
        _name: &PCWSTR,
        _result: HRESULT,
        _destination: Ref<'_, IShellItem>,
    ) -> windows::core::Result<()> {
        Ok(())
    }
    fn PreCopyItem(
        &self,
        _flags: u32,
        _item: Ref<'_, IShellItem>,
        _folder: Ref<'_, IShellItem>,
        _name: &PCWSTR,
    ) -> windows::core::Result<()> {
        Ok(())
    }
    fn PostCopyItem(
        &self,
        _flags: u32,
        _item: Ref<'_, IShellItem>,
        _folder: Ref<'_, IShellItem>,
        _name: &PCWSTR,
        _result: HRESULT,
        _destination: Ref<'_, IShellItem>,
    ) -> windows::core::Result<()> {
        Ok(())
    }
    fn PreNewItem(
        &self,
        _flags: u32,
        _folder: Ref<'_, IShellItem>,
        _name: &PCWSTR,
    ) -> windows::core::Result<()> {
        Ok(())
    }
    fn PostNewItem(
        &self,
        _flags: u32,
        _folder: Ref<'_, IShellItem>,
        _name: &PCWSTR,
        _template: &PCWSTR,
        _attributes: u32,
        _result: HRESULT,
        _item: Ref<'_, IShellItem>,
    ) -> windows::core::Result<()> {
        Ok(())
    }
    fn UpdateProgress(&self, _total: u32, _completed: u32) -> windows::core::Result<()> {
        Ok(())
    }
    fn ResetTimer(&self) -> windows::core::Result<()> {
        Ok(())
    }
    fn PauseTimer(&self) -> windows::core::Result<()> {
        Ok(())
    }
    fn ResumeTimer(&self) -> windows::core::Result<()> {
        Ok(())
    }
}

fn wide(path: &Path) -> Vec<u16> {
    // Rust accepts mixed separators, but Shell parsing requires backslashes.
    path.as_os_str()
        .encode_wide()
        .map(|unit| {
            if unit == b'/' as u16 {
                b'\\' as u16
            } else {
                unit
            }
        })
        .chain(Some(0))
        .collect()
}

fn recycle_volume(path: &Path) -> Result<PathBuf, String> {
    match path.components().next() {
        Some(Component::Prefix(prefix)) => match prefix.kind() {
            Prefix::Disk(drive) | Prefix::VerbatimDisk(drive) if path.is_absolute() => {
                Ok(PathBuf::from(format!("{}:\\", drive as char)))
            }
            _ => Err(format!(
                "No local Recycle Bin is available for {}.",
                path.display()
            )),
        },
        _ => Err(format!(
            "Recycle Bin paths must be absolute: {}",
            path.display()
        )),
    }
}

fn existing_paths(paths: &[PathBuf], directories: bool) -> Result<Vec<PathBuf>, String> {
    let mut existing = Vec::new();
    for path in paths {
        recycle_volume(path)?;
        match fs::symlink_metadata(path) {
            Ok(metadata) if metadata.is_dir() == directories => {
                if !existing.contains(path) {
                    existing.push(path.clone());
                }
            }
            Ok(_) => {
                return Err(format!(
                    "Recycle Bin item has the wrong file type: {}",
                    path.display()
                ))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!(
                    "Cannot inspect {} before recycling: {error}",
                    path.display()
                ))
            }
        }
    }
    Ok(existing)
}

/// Preserve files on unsupported volumes or shell failure; never fall back to deletion.
pub(super) fn recycle_paths(paths: &[PathBuf], directories: bool) -> Result<(), String> {
    let paths = existing_paths(paths, directories)?;
    if paths.is_empty() {
        return Ok(());
    }
    // Tauri callers can have different COM apartments. A small dedicated STA
    // also avoids paying for a fresh PowerShell/.NET process per journal write.
    std::thread::spawn(move || recycle_on_sta(&paths))
        .join()
        .map_err(|_| "Recycle Bin worker failed.".to_string())?
}

fn recycle_on_sta(paths: &[PathBuf]) -> Result<(), String> {
    unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }
        .ok()
        .map_err(|error| format!("Cannot initialize Recycle Bin worker: {error}"))?;
    struct Apartment;
    impl Drop for Apartment {
        fn drop(&mut self) {
            unsafe { CoUninitialize() };
        }
    }
    let _apartment = Apartment;
    let operation: IFileOperation =
        unsafe { CoCreateInstance(&FileOperation, None, CLSCTX_INPROC_SERVER) }
            .map_err(|error| format!("Cannot create Recycle Bin operation: {error}"))?;
    unsafe {
        operation.SetOperationFlags(
            FOFX_RECYCLEONDELETE
                | FOFX_ADDUNDORECORD
                | FOFX_EARLYFAILURE
                | FOF_NOERRORUI
                | FOF_NOCONFIRMATION
                | FOF_SILENT
                | FOF_NO_CONNECTED_ELEMENTS
                | FOF_WANTNUKEWARNING,
        )
    }
    .map_err(|error| format!("Cannot configure Recycle Bin operation: {error}"))?;
    let mut checked_volumes = Vec::new();
    let mut items = Vec::new();
    let mut guards = Vec::new();
    for path in paths {
        let volume = recycle_volume(path)?;
        if !checked_volumes.contains(&volume) {
            let volume_wide = wide(&volume);
            let mut info = SHQUERYRBINFO {
                cbSize: std::mem::size_of::<SHQUERYRBINFO>() as u32,
                ..Default::default()
            };
            unsafe { SHQueryRecycleBinW(PCWSTR(volume_wide.as_ptr()), &mut info) }.map_err(
                |error| {
                    format!(
                        "Recycle Bin is unavailable for {}: {error}",
                        volume.display()
                    )
                },
            )?;
            checked_volumes.push(volume);
        }
        let path_wide = wide(path);
        let item: IShellItem =
            unsafe { SHCreateItemFromParsingName(PCWSTR(path_wide.as_ptr()), None) }.map_err(
                |error| format!("Cannot resolve {} for recycling: {error}", path.display()),
            )?;
        let progress = Arc::new(Mutex::new(RecycleProgress::default()));
        let sink: IFileOperationProgressSink = RecycleOnlySink {
            progress: progress.clone(),
        }
        .into();
        unsafe { operation.DeleteItem(&item, &sink) }
            .map_err(|error| format!("Cannot queue {} for recycling: {error}", path.display()))?;
        items.push(item);
        guards.push((sink, progress));
    }
    unsafe { operation.PerformOperations() }
        .map_err(|error| format!("Recycle Bin operation failed: {error}"))?;
    if unsafe { operation.GetAnyOperationsAborted() }
        .map_err(|error| format!("Cannot verify Recycle Bin operation: {error}"))?
        .as_bool()
    {
        return Err("Recycle Bin operation was cancelled or could not recycle every item.".into());
    }
    for (_, progress) in &guards {
        progress
            .lock()
            .map_err(|_| "Recycle Bin guard failed.".to_string())?
            .verify()?;
    }
    for path in paths {
        match fs::symlink_metadata(path) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Ok(_) => {
                return Err(format!(
                    "Recycle Bin operation left {} in place.",
                    path.display()
                ))
            }
            Err(error) => {
                return Err(format!(
                    "Cannot verify recycling of {}: {error}",
                    path.display()
                ))
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Instant, SystemTime, UNIX_EPOCH};

    #[test]
    fn recycle_guard_cancels_permanent_delete_and_keeps_failure_sticky() {
        let progress = Arc::new(Mutex::new(RecycleProgress::default()));
        let sink: IFileOperationProgressSink = RecycleOnlySink {
            progress: progress.clone(),
        }
        .into();
        // Exercise the actual COM callback without ever asking Shell to delete.
        assert_eq!(
            unsafe { sink.PreDeleteItem(0, None) }.unwrap_err().code(),
            E_ABORT
        );
        assert_eq!(
            unsafe { sink.PreDeleteItem(TSF_DELETE_RECYCLE_IF_POSSIBLE.0 as u32, None) }
                .unwrap_err()
                .code(),
            E_ABORT
        );
        let state = progress.lock().unwrap();
        assert_eq!(state.approved, 0);
        assert!(state.verify().unwrap_err().contains("permanent deletion"));
    }

    #[test]
    fn recycle_guard_requires_successful_destination_for_each_approved_item() {
        let flags = TSF_DELETE_RECYCLE_IF_POSSIBLE.0 as u32;
        let mut missing = RecycleProgress::default();
        assert!(missing.verify().is_err());
        missing.before_delete(flags).unwrap();
        assert!(missing.verify().is_err());
        assert!(missing.after_delete(HRESULT(0), false).is_err());
        assert!(missing.verify().is_err());

        let mut failed = RecycleProgress::default();
        failed.before_delete(flags).unwrap();
        assert!(failed.after_delete(E_ABORT, true).is_err());
        assert!(failed.verify().is_err());

        let mut recycled = RecycleProgress::default();
        recycled.before_delete(flags).unwrap();
        recycled.after_delete(HRESULT(0), true).unwrap();
        recycled.verify().unwrap();
        recycled.before_delete(flags).unwrap();
        assert!(recycled.verify().is_err());
        recycled.after_delete(HRESULT(0), true).unwrap();
        recycled.verify().unwrap();
    }

    #[test]
    fn recycle_guard_veto_preserves_real_file_before_shell_delete() {
        std::thread::spawn(|| {
            unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.ok().unwrap();
            {
                let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
                let file = std::env::temp_dir().join(format!("flowcell-recycle-veto-{stamp}.txt"));
                fs::write(&file, "must survive rejected operation").unwrap();
                let operation: IFileOperation = unsafe { CoCreateInstance(&FileOperation, None, CLSCTX_INPROC_SERVER) }.unwrap();
                unsafe { operation.SetOperationFlags(FOFX_RECYCLEONDELETE | FOFX_EARLYFAILURE | FOF_NOERRORUI | FOF_NOCONFIRMATION | FOF_SILENT | FOF_WANTNUKEWARNING) }.unwrap();
                let path = wide(&file);
                let item: IShellItem = unsafe { SHCreateItemFromParsingName(PCWSTR(path.as_ptr()), None) }.unwrap();
                let progress = Arc::new(Mutex::new(RecycleProgress::default()));
                // A synthetic non-recycle proposal makes the production guard
                // fail closed. Only a normal, tiny recyclable file is queued.
                assert!(progress.lock().unwrap().before_delete(0).is_err());
                let sink: IFileOperationProgressSink = RecycleOnlySink { progress: progress.clone() }.into();
                unsafe { operation.DeleteItem(&item, &sink) }.unwrap();
                let result = unsafe { operation.PerformOperations() };
                let aborted = unsafe { operation.GetAnyOperationsAborted() }.unwrap().as_bool();
                assert!(result.is_err() || aborted);
                assert_eq!(fs::read_to_string(&file).unwrap(), "must survive rejected operation");
                assert!(progress.lock().unwrap().verify().is_err());
                eprintln!("Recycle guard veto preserved the actual queued file; result={result:?} aborted={aborted}");
                recycle_paths(&[file.clone()], false).unwrap();
                assert_eq!(fs::read_to_string(recycled_payload(&file).unwrap()).unwrap(), "must survive rejected operation");
            }
            unsafe { CoUninitialize() };
        }).join().unwrap();
    }

    fn recycled_payload(original: &Path) -> Option<PathBuf> {
        let root = recycle_volume(original).ok()?.join("$Recycle.Bin");
        let expected = original
            .to_string_lossy()
            .trim_start_matches(r"\\?\")
            .to_lowercase();
        for user in fs::read_dir(root).ok()?.filter_map(Result::ok) {
            let Ok(entries) = fs::read_dir(user.path()) else {
                continue;
            };
            for entry in entries.filter_map(Result::ok) {
                let name = entry.file_name().to_string_lossy().into_owned();
                if !name.starts_with("$I") {
                    continue;
                }
                let Ok(raw) = fs::read(entry.path()) else {
                    continue;
                };
                if raw.len() < 28 {
                    continue;
                }
                let version = u64::from_le_bytes(raw[..8].try_into().ok()?);
                let offset = match version {
                    1 => 24,
                    2 => 28,
                    _ => continue,
                };
                let units = raw[offset..]
                    .chunks_exact(2)
                    .map(|unit| u16::from_le_bytes([unit[0], unit[1]]))
                    .take_while(|unit| *unit != 0)
                    .collect::<Vec<_>>();
                let source = String::from_utf16_lossy(&units);
                if source.trim_start_matches(r"\\?\").to_lowercase() == expected {
                    return Some(entry.path().with_file_name(name.replacen("$I", "$R", 1)));
                }
            }
        }
        None
    }

    #[test]
    fn native_recycle_preserves_long_file_and_directory_in_recycle_bin() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("flowcell-recycle-qa-{stamp}"));
        fs::create_dir(&root).unwrap();
        let deep = root
            .join("a".repeat(100))
            .join("b".repeat(100))
            .join("c".repeat(45));
        fs::create_dir_all(&deep).unwrap();
        let file = deep.join("journal-backup.txt");
        let directory = deep.join("committed-install-transaction");
        let content = format!("FlowCell recycle QA {stamp}");
        fs::write(&file, &content).unwrap();
        fs::create_dir(&directory).unwrap();
        fs::write(directory.join("journal.json"), &content).unwrap();
        assert!(file.as_os_str().len() > 300);
        assert!(directory.as_os_str().len() > 300);
        let started = Instant::now();
        recycle_paths(&[file.clone()], false).unwrap();
        recycle_paths(&[directory.clone()], true).unwrap();
        assert!(!file.exists() && !directory.exists());
        let recycled_file =
            recycled_payload(&file).expect("file must have a Recycle Bin identity record");
        let recycled_directory = recycled_payload(&directory)
            .expect("directory must have a Recycle Bin identity record");
        assert_eq!(fs::read_to_string(&recycled_file).unwrap(), content);
        assert_eq!(
            fs::read_to_string(recycled_directory.join("journal.json")).unwrap(),
            content
        );
        // A later source install sees no committed transaction/backups to retry.
        recycle_paths(&[file.clone()], false).unwrap();
        recycle_paths(&[directory.clone()], true).unwrap();
        eprintln!("Native recycle verified: file={}chars directory={}chars elapsed={:?}; retained in Recycle Bin at {} and {}",
            file.as_os_str().len(), directory.as_os_str().len(), started.elapsed(),
            recycled_file.display(), recycled_directory.display());
        assert!(root.starts_with(std::env::temp_dir()));
        fs::remove_dir_all(&root).unwrap(); // Only this test's now-empty temporary ancestry.
    }

    #[test]
    fn native_recycle_refuses_relative_and_network_paths_without_deletion() {
        assert!(recycle_paths(&[PathBuf::from("journal.json")], false).is_err());
        assert!(recycle_paths(&[PathBuf::from(r"\\server\share\journal.json")], false).is_err());
        assert!(recycle_paths(
            &[PathBuf::from(r"\\?\UNC\server\share\journal.json")],
            false
        )
        .is_err());
    }

    #[test]
    fn native_recycle_rejects_wrong_type_instead_of_silently_succeeding() {
        let directory = std::env::temp_dir();
        assert!(recycle_paths(&[directory], false)
            .unwrap_err()
            .contains("wrong file type"));
    }

    #[test]
    fn native_recycle_accepts_mixed_separator_files_and_directories() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("flowcell-recycle-mixed-{stamp}"));
        fs::create_dir(&root).unwrap();
        let file = root.join("journal.backup");
        let directory = root.join("transaction");
        fs::write(&file, "mixed-file").unwrap();
        fs::create_dir(&directory).unwrap();
        fs::write(directory.join("journal.json"), "mixed-directory").unwrap();
        let mixed_file = PathBuf::from(format!("{}/journal.backup", root.display()));
        let mixed_directory = PathBuf::from(format!("{}/transaction", root.display()));
        recycle_paths(&[mixed_file], false).unwrap();
        recycle_paths(&[mixed_directory], true).unwrap();
        assert!(!file.exists() && !directory.exists());
        assert_eq!(
            fs::read_to_string(recycled_payload(&file).unwrap()).unwrap(),
            "mixed-file"
        );
        assert_eq!(
            fs::read_to_string(recycled_payload(&directory).unwrap().join("journal.json")).unwrap(),
            "mixed-directory"
        );
        fs::remove_dir(&root).unwrap(); // Only this test's empty temporary root.
    }
}
