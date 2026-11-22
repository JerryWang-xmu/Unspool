use std::collections::HashSet;

#[derive(Default)]
pub struct TicketDeduplicator {
    requests: HashSet<String>,
    nonces: HashSet<String>,
    executions: HashSet<String>,
}

impl TicketDeduplicator {
    pub fn accept(
        &mut self,
        request_id: &str,
        nonce: &str,
        execution_id: &str,
    ) -> Result<(), String> {
        if !self.requests.insert(request_id.to_string()) || !self.nonces.insert(nonce.to_string()) {
            return Err("ticket_replay_denied".into());
        }
        if !self.executions.insert(execution_id.to_string()) {
            return Err("ticket_lease_consumed".into());
        }
        Ok(())
    }
}
