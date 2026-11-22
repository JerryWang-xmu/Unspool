pub struct OneTimeLease {
    pub execution_id: String,
    consumed: bool,
}

impl OneTimeLease {
    pub fn new(execution_id: &str) -> Self {
        Self {
            execution_id: execution_id.into(),
            consumed: false,
        }
    }

    pub fn consume(&mut self) -> Result<(), String> {
        if self.consumed {
            return Err("ticket_lease_consumed".into());
        }
        self.consumed = true;
        Ok(())
    }
}
