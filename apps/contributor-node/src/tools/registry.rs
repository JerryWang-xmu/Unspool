pub fn register_template(current_digest: Option<&str>, next_digest: &str) -> Result<(), String> {
    if let Some(current) = current_digest {
        if current != next_digest {
            return Err("template_reauthorization_required".into());
        }
    }
    Ok(())
}
