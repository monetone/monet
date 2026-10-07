use std::collections::{HashMap, VecDeque};
#[cfg(target_os = "macos")]
use std::ffi::{CString, OsString};
use std::fs::File;
use std::io::Read;
#[cfg(target_os = "macos")]
use std::os::fd::{AsRawFd, FromRawFd};
#[cfg(target_os = "macos")]
use std::os::unix::ffi::OsStrExt;
#[cfg(target_os = "macos")]
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use monet_photo_core::{
    develop_with_control, parse_recipe_json, recipe_digest, CoverageView, RenderContext,
    ScratchArena,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, Runtime};

use crate::develop_scheduler::{CancellationToken, JobPriority, JobState, NativeDevelopScheduler};
use crate::raw_decode::{decode_full_resolution, RawDecodeIntent};
use crate::tiff_export::{write_rgb16_tiff, OutputProfile, TiffMetadata, TiffStage};

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum OutputFormat {
    #[default]
    Tiff16,
    LinearDng16,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceIdentity {
    pub path: String,
    pub catalog_id: String,
    pub photo_id: i64,
    pub expected_digest: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DevelopOutputOptions {
    pub path: String,
    pub profile: OutputProfile,
    #[serde(default)]
    pub format: OutputFormat,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DevelopJobRequest {
    pub job_id: String,
    pub source: SourceIdentity,
    pub canonical_recipe_json: String,
    pub output: DevelopOutputOptions,
    pub interactive: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StageTiming {
    pub stage: String,
    pub milliseconds: u128,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevelopJobResult {
    pub job_id: String,
    pub state: JobState,
    pub source_digest: String,
    pub recipe_digest: String,
    pub output: OutputMetadata,
    pub durability_error: Option<String>,
    /// Independent reopen-decode-and-compare pixel evidence for
    /// `LinearDng16` output; `None` for `Tiff16` (unrelated writer/format).
    pub pixel_validation: Option<crate::linear_dng::PixelValidation>,
    pub provenance: serde_json::Value,
    pub timings: Vec<StageTiming>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(untagged)]
pub enum OutputMetadata {
    Tiff(TiffMetadata),
    LinearDng(crate::linear_dng::LinearDngMetadata),
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevelopJobStatus {
    pub job_id: String,
    pub state: JobState,
    pub error: Option<String>,
}

struct JobRecord {
    token: CancellationToken,
    status: DevelopJobStatus,
}

#[derive(Default)]
struct JobRegistry {
    records: HashMap<String, JobRecord>,
    terminal_order: VecDeque<String>,
}

#[derive(Clone)]
pub struct DevelopJobService {
    scheduler: NativeDevelopScheduler,
    jobs: Arc<Mutex<JobRegistry>>,
}

impl Default for DevelopJobService {
    fn default() -> Self {
        Self {
            scheduler: NativeDevelopScheduler::default(),
            jobs: Arc::new(Mutex::new(JobRegistry::default())),
        }
    }
}

const TERMINAL_JOB_LIMIT: usize = 128;

fn file_digest(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|error| format!("open source: {error}"))?;
    let mut hash = Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("read source: {error}"))?;
        if read == 0 {
            break;
        }
        hash.update(&buffer[..read]);
    }
    Ok(hash
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn verify_source_unchanged(path: &Path, expected_digest: &str) -> Result<(), String> {
    if file_digest(path)? == expected_digest {
        Ok(())
    } else {
        Err("source changed during develop/export".into())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct FileIdentity {
    device: u64,
    inode: u64,
}

#[cfg(target_os = "macos")]
fn file_identity(file: &File) -> Result<FileIdentity, String> {
    let metadata = file
        .metadata()
        .map_err(|error| format!("inspect retained output: {error}"))?;
    Ok(FileIdentity {
        device: metadata.dev(),
        inode: metadata.ino(),
    })
}

#[cfg(target_os = "macos")]
#[derive(Debug)]
struct DirectOutput {
    file: File,
    directory: File,
    parent_path: PathBuf,
    name: OsString,
    identity: FileIdentity,
    parent_identity: FileIdentity,
}

#[cfg(target_os = "macos")]
impl DirectOutput {
    fn create(destination: &Path, cancellation: &CancellationToken) -> Result<Self, String> {
        Self::create_with(destination, cancellation, || {}, file_identity)
    }

    fn create_with(
        destination: &Path,
        cancellation: &CancellationToken,
        before_create: impl FnOnce(),
        inspect_identity: impl FnOnce(&File) -> Result<FileIdentity, String>,
    ) -> Result<Self, String> {
        use std::os::raw::{c_char, c_int};

        const O_RDWR: c_int = 0x0002;
        const O_CREAT: c_int = 0x0200;
        const O_EXCL: c_int = 0x0800;
        const O_NOFOLLOW: c_int = 0x0100;
        const O_CLOEXEC: c_int = 0x0100_0000;

        extern "C" {
            fn openat(dirfd: c_int, path: *const c_char, flags: c_int, ...) -> c_int;
        }

        let parent_path = destination
            .parent()
            .ok_or("output destination has no parent directory")?
            .to_path_buf();
        let name = destination
            .file_name()
            .ok_or("output destination has no file name")?
            .to_os_string();
        let directory =
            File::open(&parent_path).map_err(|error| format!("open output directory: {error}"))?;
        if !directory
            .metadata()
            .map_err(|error| format!("inspect output directory: {error}"))?
            .is_dir()
        {
            return Err("output destination parent is not a directory".into());
        }
        let parent_identity = file_identity(&directory)?;
        let name_c = CString::new(name.as_bytes())
            .map_err(|_| "output destination name contains a NUL byte")?;
        before_create();
        cancellation.check()?;
        // SAFETY: the retained directory and NUL-terminated component remain valid for the call.
        let fd = unsafe {
            openat(
                directory.as_raw_fd(),
                name_c.as_ptr(),
                O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
                0o600,
            )
        };
        if fd < 0 {
            return Err(format!(
                "exclusively create output destination: {}",
                std::io::Error::last_os_error()
            ));
        }
        // SAFETY: openat returned a new owned descriptor.
        let file = unsafe { File::from_raw_fd(fd) };
        let identity = inspect_identity(&file).map_err(|error| {
            format!(
                "{error}; incomplete created output may remain at destination and requires manual removal"
            )
        })?;
        Ok(Self {
            file,
            directory,
            parent_path,
            name,
            identity,
            parent_identity,
        })
    }

    fn writer_file(&self) -> Result<File, String> {
        self.file
            .try_clone()
            .map_err(|error| format!("clone retained output: {error}"))
    }

    fn named_file(&self) -> Result<File, String> {
        use std::os::raw::{c_char, c_int};

        const O_RDONLY: c_int = 0;
        const O_NOFOLLOW: c_int = 0x0100;
        const O_CLOEXEC: c_int = 0x0100_0000;

        extern "C" {
            fn openat(dirfd: c_int, path: *const c_char, flags: c_int, ...) -> c_int;
        }

        let name = CString::new(self.name.as_bytes())
            .map_err(|_| "output destination name contains a NUL byte")?;
        // SAFETY: the retained directory and NUL-terminated component remain valid for the call.
        let fd = unsafe {
            openat(
                self.directory.as_raw_fd(),
                name.as_ptr(),
                O_RDONLY | O_NOFOLLOW | O_CLOEXEC,
            )
        };
        if fd < 0 {
            Err(format!(
                "observe output destination without following links: {}",
                std::io::Error::last_os_error()
            ))
        } else {
            // SAFETY: openat returned a new owned descriptor.
            Ok(unsafe { File::from_raw_fd(fd) })
        }
    }

    fn verify_identity(&self) -> Result<(), String> {
        let named = self.named_file()?;
        if file_identity(&named)? != self.identity {
            return Err("output destination identity changed".into());
        }
        let named_parent = std::fs::symlink_metadata(&self.parent_path).map_err(|error| {
            format!("observe named output directory without following links: {error}")
        })?;
        let named_parent_identity = FileIdentity {
            device: named_parent.dev(),
            inode: named_parent.ino(),
        };
        if !named_parent.is_dir() || named_parent_identity != self.parent_identity {
            return Err("output destination parent identity changed".into());
        }
        Ok(())
    }

    fn failure_message(&self, error: impl std::fmt::Display) -> String {
        if self.verify_identity().is_ok() {
            let mode = self
                .file
                .metadata()
                .map(|metadata| metadata.permissions().mode() & 0o777)
                .unwrap_or(0);
            format!(
                "{error}; incomplete output remains at destination with mode {mode:04o} and requires manual removal or replacement"
            )
        } else {
            format!(
                "{error}; output destination changed or was removed; any replacement was left untouched"
            )
        }
    }
}

#[cfg(not(target_os = "macos"))]
struct DirectOutput;

#[cfg(not(target_os = "macos"))]
impl DirectOutput {
    fn create(_destination: &Path, _cancellation: &CancellationToken) -> Result<Self, String> {
        Err("direct exclusive output is unsupported on this platform".into())
    }
}

#[derive(Debug)]
enum FinalizationOutcome {
    Durable,
    Committed { durability_error: String },
}

impl FinalizationOutcome {
    fn job_state(&self) -> JobState {
        match self {
            Self::Durable => JobState::Completed,
            Self::Committed { .. } => JobState::Committed,
        }
    }

    fn durability_error(&self) -> Option<String> {
        match self {
            Self::Durable => None,
            Self::Committed { durability_error } => Some(durability_error.clone()),
        }
    }
}

#[cfg(target_os = "macos")]
fn with_output_failure_message<T>(
    output: &DirectOutput,
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    operation().map_err(|error| output.failure_message(error))
}

#[cfg(target_os = "macos")]
fn finalize_output_with(
    output: &DirectOutput,
    chmod: impl Fn(&File, u32) -> Result<(), String>,
    sync_output: impl FnOnce(&File) -> Result<(), String>,
    sync_directory: impl FnOnce(&File) -> Result<(), String>,
    before_final_observation: impl FnOnce(),
) -> Result<FinalizationOutcome, String> {
    output.verify_identity()?;
    chmod(&output.file, 0o644)?;
    if let Err(sync_error) = sync_output(&output.file) {
        return match chmod(&output.file, 0o600) {
            Ok(()) => Err(sync_error),
            Err(restore_error) => Err(format!(
                "{sync_error}; failed to restore restrictive output permissions: {restore_error}"
            )),
        };
    }
    let durability_error = sync_directory(&output.directory).err();
    before_final_observation();
    output.verify_identity()?;
    Ok(match durability_error {
        Some(durability_error) => FinalizationOutcome::Committed { durability_error },
        None => FinalizationOutcome::Durable,
    })
}

#[cfg(target_os = "macos")]
fn finalize_output(output: &DirectOutput) -> Result<FinalizationOutcome, String> {
    finalize_output_with(
        output,
        |file, mode| {
            file.set_permissions(std::fs::Permissions::from_mode(mode))
                .map_err(|error| format!("set final output permissions: {error}"))
        },
        |file| {
            file.sync_all()
                .map_err(|error| format!("sync final output: {error}"))
        },
        |directory| {
            directory
                .sync_all()
                .map_err(|error| format!("sync output directory: {error}"))
        },
        || {},
    )
}

impl DevelopJobService {
    pub fn run(
        &self,
        request: DevelopJobRequest,
        cancellation: CancellationToken,
    ) -> Result<DevelopJobResult, String> {
        let job_id = request.job_id.clone();
        let result = self.run_inner(request, cancellation.clone());
        match &result {
            Ok(result) => self.transition(&job_id, result.state, result.durability_error.clone()),
            Err(error) if cancellation.check().is_err() || error.contains("cancelled") => {
                self.transition(&job_id, JobState::Cancelled, Some(error.clone()))
            }
            Err(error) => self.transition(&job_id, JobState::Failed, Some(error.clone())),
        }
        result
    }

    fn run_inner(
        &self,
        request: DevelopJobRequest,
        cancellation: CancellationToken,
    ) -> Result<DevelopJobResult, String> {
        let priority = if request.interactive {
            JobPriority::Interactive
        } else {
            JobPriority::BatchExport
        };
        let _permit = self.scheduler.acquire(priority, &cancellation)?;

        let source_path = Path::new(&request.source.path);
        let destination = Path::new(&request.output.path);
        if request.source.catalog_id.trim().is_empty() || request.source.photo_id <= 0 {
            return Err("develop export requires catalog and photo identity".into());
        }
        if request.source.expected_digest.len() != 64
            || !request
                .source
                .expected_digest
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit())
        {
            return Err("develop export requires a SHA-256 source digest".into());
        }
        if !source_path.is_file() {
            return Err("develop source is not a regular file".into());
        }
        if source_path == destination {
            return Err("output destination must differ from source".into());
        }

        let mut timings = Vec::new();
        let started = Instant::now();
        let source_digest = file_digest(source_path)?;
        if request.source.expected_digest != source_digest {
            return Err("source digest does not match catalog identity".into());
        }
        timings.push(StageTiming {
            stage: "sourceValidation".into(),
            milliseconds: started.elapsed().as_millis(),
        });

        let recipe = parse_recipe_json(request.canonical_recipe_json.as_bytes())
            .map_err(|error| error.to_string())?;
        let raw_intent: RawDecodeIntent =
            serde_json::from_value(recipe.value()["rawDecode"].clone())
                .map_err(|error| format!("read RAW decode intent: {error}"))?;
        cancellation.check()?;
        self.transition(&request.job_id, JobState::Decoding, None);
        let started = Instant::now();
        let mut decoded = decode_full_resolution(&request.source.path, &raw_intent)?;
        cancellation.check()?;
        timings.push(StageTiming {
            stage: "decode".into(),
            milliseconds: started.elapsed().as_millis(),
        });

        let started = Instant::now();
        self.transition(&request.job_id, JobState::Developing, None);
        let mut scratch = ScratchArena::default();
        let mut current_stage = "develop";
        let (width, height) = (decoded.frame.width, decoded.frame.height);
        develop_with_control(
            &mut decoded.frame,
            &recipe,
            &RenderContext {
                scale_numerator: decoded.metadata.scale_numerator,
                scale_denominator: decoded.metadata.scale_denominator,
                coverage: CoverageView {
                    width,
                    height,
                    coverage: None,
                },
            },
            &mut scratch,
            |stage| {
                current_stage = stage;
                cancellation.check().map_err(|_| "develop job cancelled")
            },
        )
        .map_err(|error| format!("{current_stage}: {error}"))?;
        drop(scratch);
        timings.push(StageTiming {
            stage: "develop".into(),
            milliseconds: started.elapsed().as_millis(),
        });

        if request.output.format == OutputFormat::LinearDng16 {
            let mut staged = crate::atomic_publish::AtomicStagedFile::create(destination)?;
            cancellation.check()?;
            self.transition(&request.job_id, JobState::Writing, None);
            let recipe_digest: String = recipe_digest(&recipe)
                .map_err(|e| e.to_string())?
                .0
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect();
            let mut writer = staged.writer()?;
            let cancellation_for_write = cancellation.clone();
            let output = crate::linear_dng::write_linear_dng(
                &mut writer,
                &decoded.frame,
                &source_digest,
                &recipe_digest,
                crate::dng::CORE_REVISION,
                // Deterministic cancellation check between every strip, not
                // just once before/after the whole write.
                move || cancellation_for_write.check(),
            )?;
            #[cfg(target_os = "macos")]
            {
                use std::os::unix::fs::PermissionsExt;
                writer
                    .set_permissions(std::fs::Permissions::from_mode(0o644))
                    .map_err(|e| format!("set Linear DNG permissions: {e}"))?;
            }
            // Independently re-derive the expected samples from the
            // developed frame through the pinned inverse LUT and compare
            // them against the just-written strips — never trust the
            // writer's own digest of its own bytes — before this file is
            // ever published.
            let pixel_validation =
                crate::linear_dng::validate_linear_pixels(&mut writer, &decoded.frame)?;
            drop(writer);
            self.transition(&request.job_id, JobState::Finalizing, None);
            let expected = output.clone();
            let guard_source_path = source_path.to_path_buf();
            let guard_source_digest = source_digest.clone();
            let hooks = crate::atomic_publish::PublishHooks {
                // Recheck cancellation and source identity as late as
                // possible — immediately at the publication boundary,
                // right before the rename that makes the file visible —
                // rather than only once, well before the reopen/digest/
                // validate work `publish` itself still has to do.
                final_guard: Box::new(move || {
                    cancellation.check()?;
                    verify_source_unchanged(&guard_source_path, &guard_source_digest)
                }),
                ..Default::default()
            };
            let outcome = staged.publish(
                output.bytes,
                &output.output_digest,
                |file| {
                    let evidence = crate::dng::classify(file)?;
                    if evidence.class != crate::dng::DngClass::LinearRaw
                        || evidence.width != expected.width
                        || evidence.height != expected.height
                        || evidence.photometric != 34892
                    {
                        return Err("published Linear DNG classification mismatch".into());
                    }
                    Ok(())
                },
                hooks,
            )?;
            // The file is visible either way; a later durability failure
            // downgrades the terminal state, it never turns into a hard
            // error that would claim nothing was published (mirrors the
            // TIFF `DirectOutput` path's `Committed` outcome).
            let crate::atomic_publish::PublishOutcome::Committed {
                durability_warning, ..
            } = outcome;
            let state = if durability_warning.is_some() {
                JobState::Committed
            } else {
                JobState::Completed
            };
            return Ok(DevelopJobResult {
                job_id: request.job_id,
                state,
                source_digest,
                recipe_digest,
                output: OutputMetadata::LinearDng(output),
                durability_error: durability_warning,
                pixel_validation: Some(pixel_validation),
                provenance: serde_json::to_value(decoded.metadata).map_err(|e| e.to_string())?,
                timings,
            });
        }
        let direct_output = DirectOutput::create(destination, &cancellation)?;
        let result: Result<DevelopJobResult, String> = (|| {
            cancellation.check()?;
            let started = Instant::now();
            let output = write_rgb16_tiff(
                direct_output.writer_file()?,
                &decoded.frame,
                request.output.profile,
                |stage| {
                    self.transition(
                        &request.job_id,
                        match stage {
                            TiffStage::Converting => JobState::Converting,
                            TiffStage::Writing => JobState::Writing,
                            TiffStage::Validating => JobState::Validating,
                        },
                        None,
                    );
                    cancellation.check()
                },
            )?;
            timings.push(StageTiming {
                stage: "convertWriteValidate".into(),
                milliseconds: started.elapsed().as_millis(),
            });
            cancellation.check()?;

            let recipe_digest = recipe_digest(&recipe)
                .map_err(|error| error.to_string())?
                .0
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect();
            let provenance =
                serde_json::to_value(decoded.metadata).map_err(|error| error.to_string())?;

            let started = Instant::now();
            verify_source_unchanged(source_path, &source_digest)?;
            cancellation.check()?;
            self.transition(&request.job_id, JobState::Finalizing, None);
            let finalization = finalize_output(&direct_output)?;
            timings.push(StageTiming {
                stage: "finalize".into(),
                milliseconds: started.elapsed().as_millis(),
            });

            Ok(DevelopJobResult {
                job_id: request.job_id,
                state: finalization.job_state(),
                source_digest,
                recipe_digest,
                output: OutputMetadata::Tiff(output),
                durability_error: finalization.durability_error(),
                pixel_validation: None,
                provenance,
                timings,
            })
        })();
        with_output_failure_message(&direct_output, || result)
    }

    /// Register `job_id` as active (rejecting a duplicate still-active id)
    /// and return an opaque, owned guard proving it. Registry state exists
    /// synchronously the moment this returns — before any worker task is
    /// spawned — so a concurrent `status`/`cancel`/`start` call can never
    /// race job registration. The real Tauri command
    /// (`run_develop_export`) and the product proof binary
    /// (`dng_product_proof`) both call this, then [`Self::execute_started`],
    /// as the one shared lifecycle boundary — neither may call `run`
    /// directly.
    pub fn start(&self, job_id: &str) -> Result<StartedDevelopJob, String> {
        let mut registry = self
            .jobs
            .lock()
            .map_err(|_| "develop job lock is poisoned")?;
        if registry
            .records
            .get(job_id)
            .is_some_and(|record| !record.status.state.is_terminal())
        {
            return Err("develop job id is already active".into());
        }
        let token = CancellationToken::default();
        registry.terminal_order.retain(|id| id != job_id);
        registry.records.insert(
            job_id.to_owned(),
            JobRecord {
                token: token.clone(),
                status: DevelopJobStatus {
                    job_id: job_id.to_owned(),
                    state: JobState::Queued,
                    error: None,
                },
            },
        );
        Ok(StartedDevelopJob {
            service: self.clone(),
            job_id: job_id.to_owned(),
            token,
        })
    }

    /// Execute a job through the exact lifecycle boundary `start` began:
    /// takes ownership of the started guard so it cannot be dropped (and so
    /// transition the job to `Failed`) until `run` has already driven it to
    /// its own terminal state. This is the single shared implementation
    /// both `run_develop_export` (via `spawn_blocking`) and
    /// `dng_product_proof` call — neither constructs a `CancellationToken`
    /// or drives `run` itself.
    pub fn execute_started(
        &self,
        request: DevelopJobRequest,
        started: StartedDevelopJob,
    ) -> Result<DevelopJobResult, String> {
        let token = started.token.clone();
        let _guard = started;
        self.run(request, token)
    }

    fn transition(&self, job_id: &str, state: JobState, error: Option<String>) {
        self.transition_matching(job_id, None, state, error);
    }

    fn transition_matching(
        &self,
        job_id: &str,
        token: Option<&CancellationToken>,
        state: JobState,
        error: Option<String>,
    ) {
        if let Ok(mut registry) = self.jobs.lock() {
            let Some(record) = registry.records.get_mut(job_id) else {
                return;
            };
            if token.is_some_and(|token| {
                !record.token.same_instance(token) || record.status.state.is_terminal()
            }) {
                return;
            }
            record.status.state = state;
            record.status.error = error;
            if state.is_terminal() {
                registry.terminal_order.retain(|id| id != job_id);
                registry.terminal_order.push_back(job_id.to_owned());
                while registry.terminal_order.len() > TERMINAL_JOB_LIMIT {
                    if let Some(oldest) = registry.terminal_order.pop_front() {
                        if registry
                            .records
                            .get(&oldest)
                            .is_some_and(|record| record.status.state.is_terminal())
                        {
                            registry.records.remove(&oldest);
                        }
                    }
                }
            }
        }
    }

    fn cancel(&self, job_id: &str) -> Result<(), String> {
        let registry = self
            .jobs
            .lock()
            .map_err(|_| "develop job lock is poisoned")?;
        let record = registry
            .records
            .get(job_id)
            .filter(|record| !record.status.state.is_terminal())
            .ok_or_else(|| "develop job is not active".to_string())?;
        record.token.cancel();
        self.scheduler.wake();
        Ok(())
    }

    pub fn status(&self, job_id: &str) -> Result<Option<DevelopJobStatus>, String> {
        Ok(self
            .jobs
            .lock()
            .map_err(|_| "develop job lock is poisoned")?
            .records
            .get(job_id)
            .map(|record| record.status.clone()))
    }
}

fn validate_catalog_binding(
    request: &DevelopJobRequest,
    catalog_id: &str,
    photo_id: i64,
    source_path: &str,
    source_digest: &str,
    canonical_recipe_json: &str,
) -> Result<(), String> {
    if request.source.catalog_id != catalog_id
        || request.source.photo_id != photo_id
        || request.source.path != source_path
        || request.source.expected_digest != source_digest
        || request.canonical_recipe_json != canonical_recipe_json
    {
        return Err("develop export payload does not match current catalog identity".into());
    }
    Ok(())
}

/// An opaque, owned proof that a job was registered active via
/// [`DevelopJobService::start`]. Cannot be constructed outside this module —
/// the only way to obtain one is `start`, and the only thing that can be
/// done with one is pass it to [`DevelopJobService::execute_started`] (or
/// drop it, which fails the job if it was never executed). This is
/// precisely what makes the start/execute boundary shared rather than
/// bypassable: neither `run_develop_export` nor `dng_product_proof` can
/// call `run` without first holding one of these.
pub struct StartedDevelopJob {
    service: DevelopJobService,
    job_id: String,
    token: CancellationToken,
}

impl Drop for StartedDevelopJob {
    fn drop(&mut self) {
        self.service.transition_matching(
            &self.job_id,
            Some(&self.token),
            JobState::Failed,
            Some("develop worker terminated before completion".into()),
        );
    }
}

/// Validate a develop-export request against the catalog-owned identity for
/// its photo. This is the exact command/service boundary check a live
/// client is subject to: shared by the real `run_develop_export` Tauri
/// command and the product proof binary, so a proof run cannot bypass it.
///
/// Validation is against `photo.read_path` — the immutable managed-original
/// read path — never `photo.path`, which is the mutable display/original
/// path and may legitimately differ from what the request's `source.path`
/// carries for a managed DNG.
pub fn validate_develop_export_request(
    catalog: &crate::catalog::CatalogState,
    request: &DevelopJobRequest,
) -> Result<(), String> {
    let identity =
        crate::catalog::current_develop_export_identity(catalog, request.source.photo_id)?;
    validate_catalog_binding(
        request,
        &identity.catalog_id,
        identity.photo.id,
        &identity.photo.read_path,
        &identity.source_digest,
        &identity.canonical_recipe_json,
    )
}

#[tauri::command]
async fn run_develop_export<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: DevelopJobRequest,
) -> Result<DevelopJobResult, String> {
    validate_develop_export_request(
        app.state::<crate::catalog::CatalogState>().inner(),
        &request,
    )?;
    let service = app.state::<DevelopJobService>().inner().clone();
    let started = service.start(&request.job_id)?;
    tauri::async_runtime::spawn_blocking(move || service.execute_started(request, started))
        .await
        .map_err(|error| format!("develop worker failed: {error}"))?
}

#[tauri::command]
fn cancel_develop_export<R: Runtime>(
    app: tauri::AppHandle<R>,
    job_id: String,
) -> Result<(), String> {
    app.state::<DevelopJobService>().cancel(&job_id)
}

#[tauri::command]
fn get_develop_export_status<R: Runtime>(
    app: tauri::AppHandle<R>,
    job_id: String,
) -> Result<Option<DevelopJobStatus>, String> {
    app.state::<DevelopJobService>().status(&job_id)
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("develop-job")
        .setup(|app, _| {
            app.manage(DevelopJobService::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            run_develop_export,
            cancel_develop_export,
            get_develop_export_status
        ])
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;
    use monet_photo_core::{
        AlphaMode, DecodeProvenance, DevelopFrame, OrientationState, PixelEncoding,
    };
    use std::io::Write;

    #[cfg(target_os = "macos")]
    fn create_output(destination: &Path) -> DirectOutput {
        DirectOutput::create(destination, &CancellationToken::default()).unwrap()
    }

    fn test_frame() -> DevelopFrame {
        DevelopFrame::new(
            1,
            1,
            vec![u16::MAX; 4],
            PixelEncoding::SrgbEncodedU16Full,
            OrientationState {
                source_exif: 1,
                output_exif: 1,
            },
            DecodeProvenance {
                source_digest: "00".repeat(32),
                backend: "fixture".into(),
                backend_revision: "1".into(),
                decoder_version: "1".into(),
                active_area: [0, 0, 1, 1],
                working_profile_digest: "11".repeat(32),
                decode_intent_digest: "22".repeat(32),
                alpha_mode: AlphaMode::Opaque,
            },
        )
        .unwrap()
    }

    fn bound_request() -> DevelopJobRequest {
        DevelopJobRequest {
            job_id: "bound".into(),
            source: SourceIdentity {
                path: "/selected.raw".into(),
                catalog_id: "/catalog.galcat".into(),
                photo_id: 7,
                expected_digest: "ab".repeat(32),
            },
            canonical_recipe_json: "{\"processVersion\":6}".into(),
            output: DevelopOutputOptions {
                path: "/output.tiff".into(),
                profile: OutputProfile::Srgb,
                format: OutputFormat::Tiff16,
            },
            interactive: false,
        }
    }

    #[test]
    fn native_command_binding_rejects_every_swapped_catalog_value() {
        let validate = |request: &DevelopJobRequest| {
            validate_catalog_binding(
                request,
                "/catalog.galcat",
                7,
                "/selected.raw",
                &"ab".repeat(32),
                "{\"processVersion\":6}",
            )
        };
        assert!(validate(&bound_request()).is_ok());
        let mut changed = bound_request();
        changed.source.catalog_id = "/other.galcat".into();
        assert!(validate(&changed).is_err());
        let mut changed = bound_request();
        changed.source.photo_id = 8;
        assert!(validate(&changed).is_err());
        let mut changed = bound_request();
        changed.source.path = "/other.raw".into();
        assert!(validate(&changed).is_err());
        let mut changed = bound_request();
        changed.source.expected_digest = "cd".repeat(32);
        assert!(validate(&changed).is_err());
        let mut changed = bound_request();
        changed.canonical_recipe_json = "{}".into();
        assert!(validate(&changed).is_err());
    }

    // --- `DevelopJobService::start`/`StartedDevelopJob` lifecycle ---------
    //
    // The real Tauri command and the product proof binary both call
    // `service.start(...)` (duplicate-job-id rejection, `JobRegistry`
    // bookkeeping, synchronous registry state) followed by
    // `service.execute_started(...)`, which owns the `StartedDevelopJob`
    // guard whose `Drop` marks the job `Failed` if the worker is torn down
    // before `run` reaches a terminal state. Exercised directly here — no
    // Tauri `AppHandle` is required to prove this specific behavior.

    #[test]
    fn start_rejects_a_duplicate_active_job_id() {
        let service = DevelopJobService::default();
        let active = service.start("dup-job").unwrap();
        assert_eq!(
            service.status("dup-job").unwrap().unwrap().state,
            JobState::Queued
        );
        let err = match service.start("dup-job") {
            Err(e) => e,
            Ok(_) => panic!("a duplicate active job id must be rejected"),
        };
        assert!(err.contains("already active"), "{err}");
        // The registry state for the still-active job is untouched by the
        // rejected second `start`.
        assert_eq!(
            service.status("dup-job").unwrap().unwrap().state,
            JobState::Queued
        );
        drop(active);
    }

    #[test]
    fn active_job_drop_transitions_to_failed_when_worker_is_abandoned() {
        let service = DevelopJobService::default();
        let active = service.start("abandoned-job").unwrap();
        assert_eq!(
            service.status("abandoned-job").unwrap().unwrap().state,
            JobState::Queued
        );
        // Simulate a worker task torn down before it ever calls
        // `service.run` (e.g. a panicked or cancelled `spawn_blocking`).
        drop(active);
        let status = service.status("abandoned-job").unwrap().unwrap();
        assert_eq!(status.state, JobState::Failed);
        assert_eq!(
            status.error.as_deref(),
            Some("develop worker terminated before completion")
        );
    }

    #[test]
    fn active_job_drop_does_not_clobber_a_state_already_made_terminal_by_run() {
        // If `run` already drove the job to a terminal state (e.g.
        // `Completed`) before its `StartedDevelopJob` guard is dropped,
        // `transition_matching`'s terminal check must leave that outcome
        // alone rather than overwriting it with `Failed`.
        let service = DevelopJobService::default();
        let active = service.start("finished-job").unwrap();
        service.transition("finished-job", JobState::Completed, None);
        drop(active);
        let status = service.status("finished-job").unwrap().unwrap();
        assert_eq!(status.state, JobState::Completed);
        assert_eq!(status.error, None);
    }

    #[test]
    fn start_allows_reuse_of_a_job_id_once_the_prior_run_reached_a_terminal_state() {
        let service = DevelopJobService::default();
        let first = service.start("reused-job").unwrap();
        drop(first); // -> Failed (abandoned), a terminal state.
        assert_eq!(
            service.status("reused-job").unwrap().unwrap().state,
            JobState::Failed
        );
        let second = service.start("reused-job").unwrap();
        assert_eq!(
            service.status("reused-job").unwrap().unwrap().state,
            JobState::Queued
        );
        drop(second);
    }

    #[test]
    fn execute_started_is_the_exact_shared_boundary_used_by_command_and_proof() {
        // Both `run_develop_export` (the real Tauri command) and
        // `dng_product_proof` (the product proof binary) call exactly
        // `service.start(...)` followed by `service.execute_started(...)` —
        // never `run` directly. Exercise that literal two-call shape and
        // prove: (1) registry state exists synchronously the instant
        // `start` returns, before `execute_started` ever runs — so a
        // concurrent `start`/`status` cannot race registration; (2) a
        // failure inside `execute_started` still leaves the job in a
        // terminal state, not clobbered back to active by the guard's
        // `Drop`; (3) the job id becomes reusable afterward.
        let service = DevelopJobService::default();
        let started = service.start("shared-boundary-job").unwrap();
        assert_eq!(
            service
                .status("shared-boundary-job")
                .unwrap()
                .unwrap()
                .state,
            JobState::Queued
        );
        // The registry entry from `start` already blocks a concurrent
        // `start` before `execute_started` has run at all.
        assert!(service.start("shared-boundary-job").is_err());

        let mut request = bound_request();
        request.job_id = "shared-boundary-job".into();
        request.source.path = "/unused".into();
        let err = service
            .execute_started(request, started)
            .expect_err("an unreadable source must fail");
        assert!(
            err.contains("develop source is not a regular file"),
            "{err}"
        );
        let status = service.status("shared-boundary-job").unwrap().unwrap();
        assert_eq!(status.state, JobState::Failed);
        assert_eq!(status.error.as_deref(), Some(err.as_str()));
        // The guard held inside `execute_started` did not leak: the id is
        // immediately reusable now that `run` already reached a terminal
        // state before the guard was dropped.
        assert!(service.start("shared-boundary-job").is_ok());
    }

    #[test]
    fn native_command_binding_uses_managed_read_path_not_display_path() {
        let path = std::env::temp_dir().join(format!(
            "galerie-managed-read-path-{}.galcat",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        let conn = crate::catalog::db::open(path.to_str().unwrap()).unwrap();
        let id = crate::catalog::db::import_photo(
            &conn,
            &crate::catalog::ImportPhoto {
                path: "/original/on-device.dng".into(),
                fingerprint: "fp-managed".into(),
                format: "raw:DNG".into(),
                byte_size: 1024,
                mtime: 100,
                width: 100,
                height: 100,
                orientation: 1,
                capture_time: None,
                camera_make: None,
                camera_model: None,
                lens: None,
                iso: None,
                f_number: None,
                focal_length: None,
                exposure_time: None,
                gps_lat: None,
                gps_lon: None,
            },
        )
        .unwrap();
        conn.execute(
            "UPDATE source_asset SET managed_path=?1 WHERE id=(SELECT source_asset_id FROM photo WHERE id=?2)",
            rusqlite::params!["/managed/originals/fp-managed.dng", id],
        )
        .unwrap();
        let state = crate::catalog::CatalogState(Mutex::new(Some(conn)));
        let identity = crate::catalog::current_develop_export_identity(&state, id).unwrap();
        assert_ne!(identity.photo.path, identity.photo.read_path);
        assert_eq!(
            identity.photo.read_path,
            "/managed/originals/fp-managed.dng"
        );

        let mut request = bound_request();
        request.source.photo_id = id;
        request.source.catalog_id = identity.catalog_id.clone();
        request.source.expected_digest = identity.source_digest.clone();
        request.canonical_recipe_json = identity.canonical_recipe_json.clone();

        // The real frontend (export.ts) sends `readPath ?? path` — this is
        // the immutable managed copy, and it must validate.
        request.source.path = identity.photo.read_path.clone();
        assert!(validate_develop_export_request(&state, &request).is_ok());

        // The mutable display path must be rejected for a managed DNG: it
        // may be stale, unmounted, or on removable media, and processing it
        // instead of the managed copy would defeat immutable preservation.
        request.source.path = identity.photo.path.clone();
        assert!(validate_develop_export_request(&state, &request).is_err());

        drop(state);
        let _ = std::fs::remove_file(path.with_extension("galcat-shm"));
        let _ = std::fs::remove_file(path.with_extension("galcat-wal"));
        std::fs::remove_file(path).unwrap();
    }

    fn test_root(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "galerie-direct-{label}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    #[cfg(target_os = "macos")]
    fn assert_mode(path: &Path, mode: u32) {
        assert_eq!(
            std::fs::symlink_metadata(path)
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            mode
        );
    }

    #[test]
    fn cancellation_stops_before_source_work() {
        let token = CancellationToken::default();
        token.cancel();
        let request = DevelopJobRequest {
            job_id: "cancelled".into(),
            source: SourceIdentity {
                path: "/missing".into(),
                catalog_id: "catalog".into(),
                photo_id: 1,
                expected_digest: "00".repeat(32),
            },
            canonical_recipe_json: "{}".into(),
            output: DevelopOutputOptions {
                path: "/missing.tiff".into(),
                profile: OutputProfile::Srgb,
                format: OutputFormat::Tiff16,
            },
            interactive: true,
        };
        assert_eq!(
            DevelopJobService::default()
                .run(request, token)
                .unwrap_err(),
            "develop job cancelled"
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn exclusive_creation_preserves_every_existing_entry_kind() {
        use std::os::unix::fs::symlink;

        for kind in ["regular", "directory", "hard-link", "symlink", "dangling"] {
            let root = test_root(kind);
            let destination = root.join("output.tiff");
            let target = root.join("target");
            std::fs::write(&target, b"target").unwrap();
            match kind {
                "regular" => std::fs::write(&destination, b"existing").unwrap(),
                "directory" => std::fs::create_dir(&destination).unwrap(),
                "hard-link" => std::fs::hard_link(&target, &destination).unwrap(),
                "symlink" => symlink(&target, &destination).unwrap(),
                "dangling" => symlink(root.join("missing"), &destination).unwrap(),
                _ => unreachable!(),
            }
            let before = std::fs::symlink_metadata(&destination).unwrap();
            assert!(
                DirectOutput::create(&destination, &CancellationToken::default())
                    .unwrap_err()
                    .contains("exclusively create output destination")
            );
            let after = std::fs::symlink_metadata(&destination).unwrap();
            assert_eq!((before.dev(), before.ino()), (after.dev(), after.ino()));
            assert_eq!(std::fs::read(&target).unwrap(), b"target");
            if kind == "regular" {
                assert_eq!(std::fs::read(&destination).unwrap(), b"existing");
            }
            std::fs::remove_dir_all(root).unwrap();
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn deterministic_creation_races_preserve_regular_and_symlink_winners() {
        use std::os::unix::fs::symlink;

        for symlink_winner in [false, true] {
            let root = test_root(if symlink_winner {
                "race-link"
            } else {
                "race-file"
            });
            let destination = root.join("output.tiff");
            let target = root.join("target");
            std::fs::write(&target, b"target").unwrap();
            let error = DirectOutput::create_with(
                &destination,
                &CancellationToken::default(),
                || {
                    if symlink_winner {
                        symlink(&target, &destination).unwrap();
                    } else {
                        std::fs::write(&destination, b"winner").unwrap();
                    }
                },
                file_identity,
            )
            .unwrap_err();
            assert!(error.contains("exclusively create output destination"));
            if symlink_winner {
                assert_eq!(std::fs::read_link(&destination).unwrap(), target);
                assert_eq!(std::fs::read(&target).unwrap(), b"target");
            } else {
                assert_eq!(std::fs::read(&destination).unwrap(), b"winner");
            }
            std::fs::remove_dir_all(root).unwrap();
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn successful_direct_output_is_the_only_created_entry() {
        let root = test_root("success");
        let destination = root.join("output.tiff");
        let output = create_output(&destination);
        assert_mode(&destination, 0o600);
        output
            .writer_file()
            .unwrap()
            .write_all(b"owned output")
            .unwrap();
        let result = finalize_output(&output).unwrap();
        assert!(matches!(result, FinalizationOutcome::Durable));
        assert_eq!(result.job_state(), JobState::Completed);
        assert_eq!(result.durability_error(), None);
        assert_eq!(std::fs::read(&destination).unwrap(), b"owned output");
        assert_mode(&destination, 0o644);
        assert_eq!(
            root.read_dir()
                .unwrap()
                .map(|entry| entry.unwrap().file_name())
                .collect::<Vec<_>>(),
            vec![std::ffi::OsString::from("output.tiff")]
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn removal_and_replacements_fail_identity_without_touching_replacements() {
        use std::os::unix::fs::symlink;

        for replacement in ["removed", "regular", "symlink"] {
            let root = test_root(replacement);
            let destination = root.join("output.tiff");
            let target = root.join("target");
            std::fs::write(&target, b"target").unwrap();
            let output = create_output(&destination);
            output.writer_file().unwrap().write_all(b"owned").unwrap();
            std::fs::remove_file(&destination).unwrap();
            match replacement {
                "regular" => std::fs::write(&destination, b"replacement").unwrap(),
                "symlink" => symlink(&target, &destination).unwrap(),
                _ => {}
            }
            let error = finalize_output(&output).unwrap_err();
            assert!(output
                .failure_message(error)
                .contains("replacement was left untouched"));
            if replacement == "regular" {
                assert_eq!(std::fs::read(&destination).unwrap(), b"replacement");
            } else if replacement == "symlink" {
                assert_eq!(std::fs::read_link(&destination).unwrap(), target);
                assert_eq!(std::fs::read(&target).unwrap(), b"target");
            } else {
                assert!(std::fs::symlink_metadata(&destination).is_err());
            }
            std::fs::remove_dir_all(root).unwrap();
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn hard_link_alias_honestly_observes_the_owned_output() {
        let root = test_root("hard-link-alias");
        let destination = root.join("output.tiff");
        let alias = root.join("alias.tiff");
        let output = create_output(&destination);
        std::fs::hard_link(&destination, &alias).unwrap();
        output.writer_file().unwrap().write_all(b"owned").unwrap();
        assert!(matches!(
            finalize_output(&output).unwrap(),
            FinalizationOutcome::Durable
        ));
        assert_eq!(std::fs::read(&alias).unwrap(), b"owned");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn digest_source_and_post_create_cancellation_use_production_failure_route() {
        let root = test_root("real-post-create-failures");

        for failed_stage in [
            TiffStage::Converting,
            TiffStage::Writing,
            TiffStage::Validating,
        ] {
            let destination = root.join(format!("{failed_stage:?}.tiff"));
            let output = create_output(&destination);
            let error = with_output_failure_message(&output, || {
                write_rgb16_tiff(
                    output.writer_file()?,
                    &test_frame(),
                    OutputProfile::Srgb,
                    |stage| {
                        if stage == failed_stage {
                            Err(format!("injected {failed_stage:?} failure"))
                        } else {
                            Ok(())
                        }
                    },
                )
            })
            .unwrap_err();
            assert!(error.contains(&format!("injected {failed_stage:?} failure")));
            assert!(error.contains("mode 0600"));
            assert!(error.contains("requires manual removal or replacement"));
            assert!(std::fs::symlink_metadata(&destination).is_ok());
            assert_mode(&destination, 0o600);
        }

        let digest_destination = root.join("digest.tiff");
        let digest_output = create_output(&digest_destination);
        let digest_error = with_output_failure_message(&digest_output, || {
            crate::tiff_export::write_rgb16_tiff_with_digest(
                digest_output.writer_file()?,
                &test_frame(),
                OutputProfile::Srgb,
                |_| Ok(()),
                |_| Err("injected TIFF digest failure".into()),
            )
        })
        .unwrap_err();
        assert!(digest_error.contains("injected TIFF digest failure"));
        assert!(digest_error.contains("mode 0600"));
        assert!(digest_error.contains("requires manual removal or replacement"));
        assert!(!std::fs::read(&digest_destination).unwrap().is_empty());
        assert_mode(&digest_destination, 0o600);

        let source = root.join("source.raw");
        std::fs::write(&source, b"before").unwrap();
        let source_digest = file_digest(&source).unwrap();
        let source_destination = root.join("source-change.tiff");
        let source_output = create_output(&source_destination);
        source_output
            .writer_file()
            .unwrap()
            .write_all(b"partial")
            .unwrap();
        std::fs::write(&source, b"after").unwrap();
        let source_error = with_output_failure_message(&source_output, || {
            verify_source_unchanged(&source, &source_digest)
        })
        .unwrap_err();
        assert!(source_error.contains("source changed during develop/export"));
        assert!(source_error.contains("mode 0600"));
        assert_eq!(std::fs::read(&source_destination).unwrap(), b"partial");
        assert_mode(&source_destination, 0o600);

        let cancel_destination = root.join("cancel.tiff");
        let cancel_output = create_output(&cancel_destination);
        cancel_output
            .writer_file()
            .unwrap()
            .write_all(b"partial")
            .unwrap();
        let cancellation = CancellationToken::default();
        cancellation.cancel();
        let cancel_error =
            with_output_failure_message(&cancel_output, || cancellation.check()).unwrap_err();
        assert!(cancel_error.contains("develop job cancelled"));
        assert!(cancel_error.contains("mode 0600"));
        assert_eq!(std::fs::read(&cancel_destination).unwrap(), b"partial");
        assert_mode(&cancel_destination, 0o600);

        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn cancellation_at_exclusive_create_boundary_creates_nothing() {
        let root = test_root("pre-create-cancel");
        let destination = root.join("output.tiff");
        let cancellation = CancellationToken::default();
        let hook_token = cancellation.clone();
        assert_eq!(
            DirectOutput::create_with(
                &destination,
                &cancellation,
                move || hook_token.cancel(),
                file_identity,
            )
            .unwrap_err(),
            "develop job cancelled"
        );
        assert!(std::fs::symlink_metadata(&destination).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn post_create_identity_inspection_failure_retains_restrictive_output() {
        let root = test_root("post-create-inspection");
        let destination = root.join("output.tiff");
        let error = DirectOutput::create_with(
            &destination,
            &CancellationToken::default(),
            || {},
            |_| Err("injected output identity inspection failure".into()),
        )
        .unwrap_err();
        assert!(error.contains("injected output identity inspection failure"));
        assert!(error.contains("incomplete created output may remain"));
        assert!(error.contains("requires manual removal"));
        assert_eq!(std::fs::read(&destination).unwrap(), b"");
        assert_mode(&destination, 0o600);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn chmod_and_output_sync_failures_are_never_terminal_success() {
        for fail_chmod in [true, false] {
            let root = test_root(if fail_chmod { "chmod" } else { "output-sync" });
            let destination = root.join("output.tiff");
            let output = create_output(&destination);
            output.writer_file().unwrap().write_all(b"owned").unwrap();
            let result = finalize_output_with(
                &output,
                |file, mode| {
                    if fail_chmod && mode == 0o644 {
                        Err("injected chmod failure".into())
                    } else {
                        file.set_permissions(std::fs::Permissions::from_mode(mode))
                            .map_err(|error| error.to_string())
                    }
                },
                |_| {
                    if fail_chmod {
                        Ok(())
                    } else {
                        Err("injected output sync failure".into())
                    }
                },
                |_| Ok(()),
                || {},
            );
            let message = with_output_failure_message(&output, || result).unwrap_err();
            assert!(message.contains(if fail_chmod {
                "injected chmod failure"
            } else {
                "injected output sync failure"
            }));
            assert!(message.contains("mode 0600"));
            assert!(message.contains("requires manual removal or replacement"));
            assert_eq!(std::fs::read(&destination).unwrap(), b"owned");
            assert_mode(&destination, 0o600);
            std::fs::remove_dir_all(root).unwrap();
        }

        let root = test_root("output-sync-restore-failure");
        let destination = root.join("output.tiff");
        let output = create_output(&destination);
        let result = finalize_output_with(
            &output,
            |file, mode| {
                if mode == 0o600 {
                    Err("injected restrictive restoration failure".into())
                } else {
                    file.set_permissions(std::fs::Permissions::from_mode(mode))
                        .map_err(|error| error.to_string())
                }
            },
            |_| Err("injected output sync failure".into()),
            |_| Ok(()),
            || {},
        );
        let message = with_output_failure_message(&output, || result).unwrap_err();
        assert!(message.contains("injected output sync failure"));
        assert!(message.contains("injected restrictive restoration failure"));
        assert!(message.contains("mode 0644"));
        assert!(!message.contains("mode 0600"));
        assert_mode(&destination, 0o644);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn parent_sync_only_failure_is_committed_with_warning() {
        let root = test_root("parent-sync");
        let destination = root.join("output.tiff");
        let output = create_output(&destination);
        output.writer_file().unwrap().write_all(b"owned").unwrap();
        let result = finalize_output_with(
            &output,
            |file, mode| {
                file.set_permissions(std::fs::Permissions::from_mode(mode))
                    .map_err(|error| error.to_string())
            },
            |file| file.sync_all().map_err(|error| error.to_string()),
            |_| Err("injected parent sync failure".into()),
            || {},
        )
        .unwrap();
        assert_eq!(result.job_state(), JobState::Committed);
        assert_eq!(
            result.durability_error().as_deref(),
            Some("injected parent sync failure")
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn final_identity_race_fails_and_preserves_replacement() {
        let root = test_root("final-race");
        let destination = root.join("output.tiff");
        let output = create_output(&destination);
        output.writer_file().unwrap().write_all(b"owned").unwrap();
        let result = finalize_output_with(
            &output,
            |file, mode| {
                file.set_permissions(std::fs::Permissions::from_mode(mode))
                    .map_err(|error| error.to_string())
            },
            |file| file.sync_all().map_err(|error| error.to_string()),
            |_| Ok(()),
            || {
                std::fs::remove_file(&destination).unwrap();
                std::fs::write(&destination, b"replacement").unwrap();
            },
        );
        assert!(result.unwrap_err().contains("identity changed"));
        assert_eq!(std::fs::read(&destination).unwrap(), b"replacement");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn named_parent_replacement_fails_identity_and_is_untouched() {
        use std::os::unix::fs::symlink;

        for symlink_replacement in [false, true] {
            let root = test_root(if symlink_replacement {
                "parent-symlink-race"
            } else {
                "parent-directory-race"
            });
            let parent = root.join("selected");
            let retained_parent = root.join("retained");
            std::fs::create_dir(&parent).unwrap();
            let destination = parent.join("output.tiff");
            let output = create_output(&destination);
            output.writer_file().unwrap().write_all(b"owned").unwrap();
            std::fs::rename(&parent, &retained_parent).unwrap();
            if symlink_replacement {
                symlink(&retained_parent, &parent).unwrap();
            } else {
                std::fs::create_dir(&parent).unwrap();
                std::fs::write(parent.join("replacement"), b"keep").unwrap();
            }
            assert!(finalize_output(&output)
                .unwrap_err()
                .contains("parent identity changed"));
            assert_eq!(
                std::fs::read(retained_parent.join("output.tiff")).unwrap(),
                b"owned"
            );
            if symlink_replacement {
                assert_eq!(std::fs::read_link(&parent).unwrap(), retained_parent);
            } else {
                assert_eq!(std::fs::read(parent.join("replacement")).unwrap(), b"keep");
            }
            std::fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn digest_mismatch_is_rejected_before_decode_and_destination_creation() {
        let root = test_root("digest-mismatch");
        let source = root.join("source.raw");
        let destination = root.join("output.tiff");
        std::fs::write(&source, b"source").unwrap();
        let request = DevelopJobRequest {
            job_id: "digest-mismatch".into(),
            source: SourceIdentity {
                path: source.to_string_lossy().into(),
                catalog_id: "catalog".into(),
                photo_id: 1,
                expected_digest: "00".repeat(32),
            },
            canonical_recipe_json: "not parsed".into(),
            output: DevelopOutputOptions {
                path: destination.to_string_lossy().into(),
                profile: OutputProfile::Srgb,
                format: OutputFormat::Tiff16,
            },
            interactive: false,
        };
        assert_eq!(
            DevelopJobService::default()
                .run(request, CancellationToken::default())
                .unwrap_err(),
            "source digest does not match catalog identity"
        );
        assert!(std::fs::symlink_metadata(destination).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn active_id_cleanup_survives_worker_panic_and_terminal_state_is_observable() {
        let service = DevelopJobService::default();
        let active = service.start("panic-job").unwrap();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
            let _active = active;
            panic!("worker panic");
        }));
        assert!(result.is_err());
        let status = service.status("panic-job").unwrap().unwrap();
        assert_eq!(status.state, JobState::Failed);
        assert!(status.error.unwrap().contains("terminated"));
        assert!(service.start("panic-job").is_ok());
    }

    #[test]
    fn queued_command_cancellation_is_observable_with_terminal_error() {
        let service = DevelopJobService::default();
        let blocker = service
            .scheduler
            .acquire(JobPriority::Interactive, &CancellationToken::default())
            .unwrap();
        // Route through `execute_started` — the exact shared boundary
        // `run_develop_export` and `dng_product_proof` both call — rather
        // than driving `run` directly, so this proves cancellation behaves
        // identically through the real production call shape.
        let active = service.start("queued-job").unwrap();
        let worker_service = service.clone();
        let worker = std::thread::spawn(move || {
            worker_service.execute_started(
                DevelopJobRequest {
                    job_id: "queued-job".into(),
                    source: SourceIdentity {
                        path: "/unused".into(),
                        catalog_id: "catalog".into(),
                        photo_id: 1,
                        expected_digest: "00".repeat(32),
                    },
                    canonical_recipe_json: "{}".into(),
                    output: DevelopOutputOptions {
                        path: "/unused.tiff".into(),
                        profile: OutputProfile::Srgb,
                        format: OutputFormat::Tiff16,
                    },
                    interactive: false,
                },
                active,
            )
        });
        service.scheduler.wait_for_queue(0, 1);
        service.cancel("queued-job").unwrap();
        assert_eq!(worker.join().unwrap().unwrap_err(), "develop job cancelled");
        let status = service.status("queued-job").unwrap().unwrap();
        assert_eq!(status.state, JobState::Cancelled);
        assert_eq!(status.error.as_deref(), Some("develop job cancelled"));
        drop(blocker);
    }

    #[test]
    fn state_history_is_bounded_and_terminal_errors_are_retained() {
        let service = DevelopJobService::default();
        for index in 0..TERMINAL_JOB_LIMIT + 2 {
            let id = format!("job-{index}");
            let active = service.start(&id).unwrap();
            for state in [
                JobState::Decoding,
                JobState::Developing,
                JobState::Converting,
                JobState::Writing,
                JobState::Validating,
                JobState::Finalizing,
            ] {
                service.transition(&id, state, None);
                assert_eq!(service.status(&id).unwrap().unwrap().state, state);
            }
            service.transition(&id, JobState::Failed, Some("injected".into()));
            drop(active);
        }
        assert!(service.status("job-0").unwrap().is_none());
        let status = service
            .status(&format!("job-{}", TERMINAL_JOB_LIMIT + 1))
            .unwrap()
            .unwrap();
        assert_eq!(status.state, JobState::Failed);
        assert_eq!(status.error.as_deref(), Some("injected"));
    }

    #[test]
    fn terminal_id_reuse_cannot_be_evicted_while_active() {
        let service = DevelopJobService::default();
        for index in 0..TERMINAL_JOB_LIMIT {
            let id = format!("job-{index}");
            let active = service.start(&id).unwrap();
            service.transition(&id, JobState::Completed, None);
            drop(active);
        }

        let reused = service.start("job-0").unwrap();
        let completed = service.start("job-128").unwrap();
        service.transition("job-128", JobState::Completed, None);
        drop(completed);

        assert_eq!(
            service.status("job-0").unwrap().unwrap().state,
            JobState::Queued
        );
        assert_eq!(
            service.start("job-0").err().as_deref(),
            Some("develop job id is already active")
        );
        service.cancel("job-0").unwrap();
        assert!(reused.token.check().is_err());
        service.transition("job-0", JobState::Cancelled, Some("cancelled".into()));
        drop(reused);
        assert_eq!(
            service.jobs.lock().unwrap().terminal_order.len(),
            TERMINAL_JOB_LIMIT
        );

        let later = service.start("job-0").unwrap();
        assert!(later.token.check().is_ok());
        drop(later);
        assert_eq!(
            service.status("job-0").unwrap().unwrap().state,
            JobState::Failed
        );
    }

    #[test]
    fn stale_terminal_queue_entries_never_remove_an_active_record() {
        let service = DevelopJobService::default();
        let active = service.start("active").unwrap();
        let finisher = service.start("finisher").unwrap();
        service.jobs.lock().unwrap().terminal_order = std::iter::repeat("active".to_owned())
            .take(TERMINAL_JOB_LIMIT + 1)
            .collect();
        service.transition("finisher", JobState::Completed, None);

        assert_eq!(
            service.status("active").unwrap().unwrap().state,
            JobState::Queued
        );
        assert_eq!(
            service.jobs.lock().unwrap().terminal_order.len(),
            TERMINAL_JOB_LIMIT
        );
        drop(finisher);
        drop(active);
    }
}
