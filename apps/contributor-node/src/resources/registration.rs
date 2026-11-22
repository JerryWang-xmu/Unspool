pub fn validate_registration(alias: &str, operations: &[String]) -> Result<(), String> {
    if alias.trim().is_empty() {
        return Err("resource_alias_required".into());
    }
    if operations.is_empty() {
        return Err("resource_operations_empty".into());
    }
    Ok(())
}
