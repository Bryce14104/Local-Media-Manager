//! Background workers that keep catalog jobs on most of the CPU.

use std::sync::mpsc;
use std::sync::{Arc, Mutex};

/// Logical cores, with a floor so a mis-reported 1-core Mac still gets a pool.
pub fn hardware_threads() -> usize {
    std::thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(8)
        .max(1)
}

/// Use every logical core. If the OS reports 1–2, still start a laptop-sized pool.
pub fn catalog_threads() -> usize {
    hardware_threads().max(6)
}

/// Hashing is mostly disk wait; more workers keep the SSD busy.
pub fn io_threads() -> usize {
    catalog_threads().saturating_mul(2).clamp(8, 24)
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
    eprintln!("shelf index: started {threads} catalog workers");
    for index in 0..threads {
        let tx = tx.clone();
        let jobs = jobs.clone();
        let work = work.clone();
        let _ = std::thread::Builder::new()
            .name(format!("shelf-catalog-{index}"))
            .stack_size(2 * 1024 * 1024)
            .spawn(move || loop {
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
    fn catalog_threads_never_run_as_one_lane() {
        assert!(catalog_threads() >= 6);
        assert!(io_threads() >= catalog_threads());
    }
}
