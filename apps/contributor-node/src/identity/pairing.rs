pub struct OneTimePairingCode {
    pub owner_id: String,
    pub expires_at: u64,
    pub used_at: Option<u64>,
}

impl OneTimePairingCode {
    pub fn complete(&mut self, now: u64) -> Result<(), String> {
        if self.used_at.is_some() || self.expires_at <= now {
            return Err("pairing_code_invalid".into());
        }
        self.used_at = Some(now);
        Ok(())
    }
}
