pub struct OutboundLongPoll {
    pub endpoint: String,
    pub cursor: u64,
    pub backoff_ms: u64,
}

impl OutboundLongPoll {
    pub fn new(endpoint: &str) -> Result<Self, String> {
        if !endpoint.starts_with("https://") {
            return Err("mtls_https_required".into());
        }
        Ok(Self {
            endpoint: endpoint.into(),
            cursor: 0,
            backoff_ms: 250,
        })
    }

    pub fn poll<T>(&mut self, receipts: Vec<T>, operations: Vec<T>) -> Vec<T> {
        let mut prioritized = receipts;
        prioritized.extend(operations);
        self.cursor += prioritized.len() as u64;
        self.backoff_ms = if prioritized.is_empty() {
            (self.backoff_ms * 2).min(5_000)
        } else {
            250
        };
        prioritized
    }

    pub fn inbound_listener(&self) -> bool {
        false
    }
}
