use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptGap {
    pub node_id: String,
    pub from_sequence: u64,
    pub to_sequence: u64,
    pub detected_at: String,
    pub reason: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_at: Option<String>,
}

impl ReceiptGap {
    pub fn validate(&self) -> Result<(), String> {
        if self.from_sequence == 0 || self.to_sequence < self.from_sequence {
            return Err("receipt_gap_range_invalid".into());
        }
        Ok(())
    }
}
