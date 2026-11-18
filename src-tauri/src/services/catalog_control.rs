//! Pause and stop the background catalog job.

use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

pub struct CatalogControl {
    pub cancel: AtomicBool,
    pub pause: AtomicBool,
}

static CONTROL: OnceLock<CatalogControl> = OnceLock::new();

pub fn control() -> &'static CatalogControl {
    CONTROL.get_or_init(|| CatalogControl {
        cancel: AtomicBool::new(false),
        pause: AtomicBool::new(false),
    })
}

pub fn begin_job() {
    control().cancel.store(false, Ordering::SeqCst);
}

pub fn request_cancel() {
    control().pause.store(false, Ordering::SeqCst);
    control().cancel.store(true, Ordering::SeqCst);
}

pub fn set_paused(paused: bool) {
    control().pause.store(paused, Ordering::SeqCst);
}

pub fn canceled() -> bool {
    control().cancel.load(Ordering::SeqCst)
}

pub fn paused() -> bool {
    control().pause.load(Ordering::SeqCst)
}

pub fn wait_if_paused() {
    while paused() && !canceled() {
        std::thread::sleep(Duration::from_millis(80));
    }
}
