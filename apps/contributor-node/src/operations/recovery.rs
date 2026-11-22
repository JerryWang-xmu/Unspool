pub fn recover(dispatched: bool, completed: bool) -> (&'static str, bool) {
    if dispatched && !completed {
        ("outcome_unknown", false)
    } else if completed {
        ("settled", false)
    } else {
        ("resumable", false)
    }
}
