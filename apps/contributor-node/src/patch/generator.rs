pub fn validate_patch(changes: &[(String, String, String)]) -> Result<(), String> {
    if changes.is_empty() {
        return Err("patch_selection_required".into());
    }
    for (path, _base, _replacement) in changes {
        if path.contains("..") || path.starts_with('/') || path.contains('\\') {
            return Err("patch_path_denied".into());
        }
    }
    Ok(())
}
