use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceBudget {
    pub max_output_bytes: u64,
    pub max_duration_seconds: u64,
    pub max_concurrent: u64,
    pub cpu_millicpu: u64,
    pub memory_mb: u64,
    pub processes: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FixedToolTemplate {
    pub id: String,
    pub node_id: String,
    pub version: u64,
    pub digest: String,
    pub display_name: String,
    pub purpose: String,
    pub executable_digest: String,
    pub parameter_schema: serde_json::Value,
    pub working_scope: String,
    pub env_allowlist: Vec<String>,
    pub network_policy: String,
    pub output_limit: u64,
    pub side_effect_class: String,
    pub budget: ResourceBudget,
}

impl FixedToolTemplate {
    pub fn validate(&self) -> Result<(), String> {
        if self.id.is_empty() || self.digest.is_empty() || self.executable_digest.is_empty() {
            return Err("fixed_tool_template_invalid".into());
        }
        if self.network_policy != "disabled" {
            return Err("fixed_tool_network_denied".into());
        }
        if self.output_limit == 0 || self.output_limit > self.budget.max_output_bytes {
            return Err("fixed_tool_budget_invalid".into());
        }
        Ok(())
    }
}
