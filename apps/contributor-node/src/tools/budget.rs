pub fn assert_within_budget(
    output_bytes: u64,
    duration_seconds: u64,
    processes: u64,
    output_limit: u64,
    duration_limit: u64,
    process_limit: u64,
) -> Result<(), String> {
    if output_bytes > output_limit || duration_seconds > duration_limit || processes > process_limit
    {
        return Err("budget_exhausted".into());
    }
    Ok(())
}
