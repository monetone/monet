use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::Duration;

use serde::Serialize;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum JobPriority {
    Interactive,
    BatchExport,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum JobState {
    Queued,
    Decoding,
    Developing,
    Converting,
    Writing,
    Validating,
    Finalizing,
    Committed,
    Completed,
    Cancelled,
    Failed,
}

impl JobState {
    pub(crate) fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Committed | Self::Completed | Self::Cancelled | Self::Failed
        )
    }
}

#[derive(Clone, Default)]
pub struct CancellationToken(Arc<AtomicBool>);

impl CancellationToken {
    pub fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }

    pub fn check(&self) -> Result<(), String> {
        if self.0.load(Ordering::Acquire) {
            Err("develop job cancelled".into())
        } else {
            Ok(())
        }
    }

    pub(crate) fn same_instance(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
}

#[derive(Default)]
struct QueueState {
    active: bool,
    interactive_waiting: usize,
    batch_pending: usize,
}

#[derive(Clone, Default)]
pub struct NativeDevelopScheduler {
    inner: Arc<(Mutex<QueueState>, Condvar)>,
}

fn lock_recover<T>(lock: &Mutex<T>) -> MutexGuard<'_, T> {
    lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl NativeDevelopScheduler {
    pub fn acquire(
        &self,
        priority: JobPriority,
        cancellation: &CancellationToken,
    ) -> Result<DevelopPermit, String> {
        let (lock, changed) = &*self.inner;
        let mut state = lock_recover(lock);
        match priority {
            JobPriority::Interactive => state.interactive_waiting += 1,
            JobPriority::BatchExport if state.batch_pending >= 2 => {
                return Err("batch export queue is full".into())
            }
            JobPriority::BatchExport => state.batch_pending += 1,
        }
        changed.notify_all();

        loop {
            if let Err(error) = cancellation.check() {
                decrement_waiting(&mut state, priority);
                changed.notify_all();
                return Err(error);
            }
            if !state.active
                && (priority == JobPriority::Interactive || state.interactive_waiting == 0)
            {
                decrement_waiting(&mut state, priority);
                state.active = true;
                return Ok(DevelopPermit {
                    inner: self.inner.clone(),
                });
            }
            state = changed
                .wait_timeout(state, Duration::from_millis(20))
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .0;
        }
    }

    pub(crate) fn wake(&self) {
        self.inner.1.notify_all();
    }

    #[cfg(test)]
    pub(crate) fn wait_for_queue(&self, interactive_waiting: usize, batch_pending: usize) {
        let (lock, changed) = &*self.inner;
        let mut state = lock_recover(lock);
        while (state.interactive_waiting, state.batch_pending)
            != (interactive_waiting, batch_pending)
        {
            state = changed
                .wait(state)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
        }
    }
}

fn decrement_waiting(state: &mut QueueState, priority: JobPriority) {
    match priority {
        JobPriority::Interactive => state.interactive_waiting -= 1,
        JobPriority::BatchExport => state.batch_pending -= 1,
    }
}

pub struct DevelopPermit {
    inner: Arc<(Mutex<QueueState>, Condvar)>,
}

impl Drop for DevelopPermit {
    fn drop(&mut self) {
        let (lock, changed) = &*self.inner;
        lock_recover(lock).active = false;
        changed.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::thread;

    #[test]
    fn queue_is_bounded_and_interactive_runs_first() {
        let scheduler = NativeDevelopScheduler::default();
        let active = scheduler
            .acquire(JobPriority::Interactive, &CancellationToken::default())
            .unwrap();
        let (send, receive) = mpsc::channel();
        let mut handles = Vec::new();
        for label in ["batch-1", "batch-2"] {
            let scheduler = scheduler.clone();
            let send = send.clone();
            handles.push(thread::spawn(move || {
                let _permit = scheduler
                    .acquire(JobPriority::BatchExport, &CancellationToken::default())
                    .unwrap();
                send.send(label).unwrap();
            }));
        }
        scheduler.wait_for_queue(0, 2);
        assert_eq!(
            scheduler
                .acquire(JobPriority::BatchExport, &CancellationToken::default())
                .err()
                .as_deref(),
            Some("batch export queue is full")
        );
        let scheduler2 = scheduler.clone();
        let send2 = send.clone();
        handles.push(thread::spawn(move || {
            let _permit = scheduler2
                .acquire(JobPriority::Interactive, &CancellationToken::default())
                .unwrap();
            send2.send("interactive").unwrap();
        }));
        scheduler.wait_for_queue(1, 2);
        drop(active);
        assert_eq!(receive.recv().unwrap(), "interactive");
        for handle in handles {
            handle.join().unwrap();
        }
    }

    #[test]
    fn queued_cancellation_is_prompt_and_frees_the_slot() {
        let scheduler = NativeDevelopScheduler::default();
        let active = scheduler
            .acquire(JobPriority::Interactive, &CancellationToken::default())
            .unwrap();
        let token = CancellationToken::default();
        let queued_token = token.clone();
        let queued_scheduler = scheduler.clone();
        let queued = thread::spawn(move || {
            queued_scheduler.acquire(JobPriority::BatchExport, &queued_token)
        });
        scheduler.wait_for_queue(0, 1);
        token.cancel();
        scheduler.wake();
        assert_eq!(
            queued.join().unwrap().err().as_deref(),
            Some("develop job cancelled")
        );

        let replacement_token = CancellationToken::default();
        let replacement_scheduler = scheduler.clone();
        let replacement = thread::spawn(move || {
            replacement_scheduler.acquire(JobPriority::BatchExport, &replacement_token)
        });
        scheduler.wait_for_queue(0, 1);
        drop(active);
        assert!(replacement.join().unwrap().is_ok());
    }

    #[test]
    fn poisoned_lock_recovers_without_losing_accounting() {
        let scheduler = NativeDevelopScheduler::default();
        let inner = scheduler.inner.clone();
        let _ = thread::spawn(move || {
            let _guard = inner.0.lock().unwrap();
            panic!("poison queue");
        })
        .join();
        let permit = scheduler
            .acquire(JobPriority::Interactive, &CancellationToken::default())
            .unwrap();
        drop(permit);
        assert!(scheduler
            .acquire(JobPriority::BatchExport, &CancellationToken::default())
            .is_ok());
    }
}
