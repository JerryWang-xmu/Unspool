pub fn assert_read_permissions(
    central_cache: bool,
    offline_read: bool,
    offline: bool,
) -> Result<(), String> {
    if offline && !offline_read {
        return Err("offline_read_denied".into());
    }
    if !offline && !central_cache {
        return Err("central_cache_denied".into());
    }
    Ok(())
}
