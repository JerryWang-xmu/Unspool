use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationTicket {
    pub request_id: String,
    pub nonce: String,
    pub execution_id: String,
    pub node_id: String,
    pub run_id: String,
    pub grant_digest: String,
    pub action_digest: String,
    pub recipient_digest: String,
    pub body_digest: String,
    pub not_before: String,
    pub expires_at: String,
    pub signature: String,
}

impl OperationTicket {
    pub fn validate(
        &self,
        now: &str,
        used_request_ids: &[String],
        used_nonces: &[String],
    ) -> Result<(), String> {
        if self.nonce.len() < 16 {
            return Err("ticket_nonce_invalid".into());
        }
        if used_request_ids.contains(&self.request_id) || used_nonces.contains(&self.nonce) {
            return Err("ticket_replay_denied".into());
        }
        if self.not_before.as_str() > now {
            return Err("ticket_not_yet_valid".into());
        }
        if self.expires_at.as_str() <= now {
            return Err("ticket_expired".into());
        }
        for digest in [
            &self.grant_digest,
            &self.action_digest,
            &self.recipient_digest,
            &self.body_digest,
        ] {
            if digest.len() != 71
                || !digest.starts_with("sha256:")
                || !digest[7..].chars().all(|c| c.is_ascii_hexdigit())
            {
                return Err("ticket_digest_invalid".into());
            }
        }
        if self.signature.is_empty() {
            return Err("ticket_signature_invalid".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ticket() -> OperationTicket {
        let digest = format!("sha256:{}", "a".repeat(64));
        OperationTicket {
            request_id: "request".into(),
            nonce: "nonce-at-least-16".into(),
            execution_id: "execution".into(),
            node_id: "node".into(),
            run_id: "run".into(),
            grant_digest: digest.clone(),
            action_digest: digest.clone(),
            recipient_digest: digest.clone(),
            body_digest: digest,
            not_before: "2026-01-01T00:00:00.000Z".into(),
            expires_at: "2026-01-01T00:00:30.000Z".into(),
            signature: "signature".into(),
        }
    }

    #[test]
    fn accepts_a_valid_ticket() {
        assert!(
            ticket()
                .validate("2026-01-01T00:00:15.000Z", &[], &[])
                .is_ok()
        );
    }

    #[test]
    fn rejects_replay_and_expiry() {
        let ticket = ticket();
        assert_eq!(
            ticket
                .validate("2026-01-01T00:00:15.000Z", &["request".into()], &[])
                .unwrap_err(),
            "ticket_replay_denied"
        );
        assert_eq!(
            ticket
                .validate("2026-01-01T00:00:31.000Z", &[], &[])
                .unwrap_err(),
            "ticket_expired"
        );
    }
}
