//! Background workers that keep catalog jobs on most of the CPU.

use std::sync::mpsc;
use std::sync::{Arc, Mutex};

/// About 75% of logical cores, leaving a slice for the window.
pub fn catalog_threads() -> usize {
    let cores = std::thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(4)
        .max(1);
    let target = (cores * 3).div_ceil(4);
    let leave_ui = cores.saturating_sub(1).max(1);
    target.clamp(1, leave_ui).max(1)
}

pub fn video_proxy_threads() -> usize {
    catalog_threads().div_ceil(4).clamp(1, 2)
}

/// Run `work` on `items` across `threads` workers. Results arrive as jobs finish.
pub fn map_unordered<T, R, F>(items: Vec<T>, threads: usize, work: F) -> mpsc::Receiver<R>
where
    T: Send + 'static,
    R: Send + 'static,
    F: Fn(T) -> R + Send + Sync + 'static,
{
    let (tx, rx) = mpsc::channel();
    if items.is_empty() {
        return rx;
    }
    let threads = threads.clamp(1, items.len());
    let jobs = Arc::new(Mutex::new(items.into_iter()));
    let work = Arc::new(work);
    for _ in 0..threads {
        let tx = tx.clone();
        let jobs = jobs.clone();
        let work = work.clone();
        std::thread::spawn(move || loop {
            let job = jobs.lock().unwrap_or_else(|err| err.into_inner()).next();
            let Some(job) = job else {
                break;
            };
            let _ = tx.send(work(job));
        });
    }
    rx
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pool_returns_every_item() {
        let got = map_unordered((0..20).collect(), 4, |value| value * 2);
        let mut values: Vec<_> = got.into_iter().collect();
        values.sort();
        assert_eq!(values, (0..20).map(|value| value * 2).collect::<Vec<_>>());
    }

    #[test]
    fn catalog_threads_use_most_cores() {
        let cores = std::thread::available_parallelism()
            .map(|count| count.get())
            .unwrap_or(1);
        let workers = catalog_threads();
        assert!(workers >= 1);
        assert!(workers <= cores);
        if cores >= 2 {
            assert!(workers * 2 >= cores);
        }
    }
}
